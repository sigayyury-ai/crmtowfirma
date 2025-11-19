const logger = require('../../utils/logger');
const StripeRepository = require('./repository');
const {
  iterateCheckoutSessions,
  iterateRefunds,
  buildSessionFilters
} = require('./service');
const { fromMinorUnit, normaliseCurrency, roundBankers, toMinorUnit } = require('../../utils/currency');
const { logStripeError } = require('../../utils/logging/stripe');
const ParticipantPaymentPlanService = require('./participantPaymentPlanService');
const { StripeCrmSyncService, STAGES } = require('./crmSync');
const PipedriveClient = require('../pipedrive');
const { getRate } = require('./exchangeRateService');
const { getStripeClient } = require('./client');
const SendPulseClient = require('../sendpulse');

class StripeProcessorService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.repository = options.repository || new StripeRepository();
    this.paymentPlanService = options.paymentPlanService || new ParticipantPaymentPlanService();
    this.crmSyncService = options.crmSyncService || new StripeCrmSyncService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    // Force recreate Stripe client to pick up current STRIPE_MODE
    this.stripe = options.stripe || getStripeClient();
    this.mode = (process.env.STRIPE_MODE || 'live').toLowerCase();
    this.maxSessions = parseInt(process.env.STRIPE_PROCESSOR_MAX_SESSIONS || '500', 10);
    this.crmCache = new Map();
    this.addressTaskCache = new Set();
    this.invoiceTypeFieldKey = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    this.stripeTriggerValue = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75');
    this.invoiceDoneValue = String(process.env.PIPEDRIVE_INVOICE_DONE_VALUE || '73');
    this.checkoutSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL || 'https://comoon.io/comoonity/';
    this.checkoutCancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL || this.checkoutSuccessUrl;
    
    // Initialize SendPulse client (optional, may not be configured)
    this.sendpulseClient = null;
    try {
      const hasSendpulseId = !!process.env.SENDPULSE_ID?.trim();
      const hasSendpulseSecret = !!process.env.SENDPULSE_SECRET?.trim();
      if (hasSendpulseId && hasSendpulseSecret) {
        this.sendpulseClient = new SendPulseClient();
        this.logger.info('SendPulse client initialized for Stripe processor');
      } else {
        this.logger.warn('SendPulse client not initialized (credentials missing)');
      }
    } catch (error) {
      this.logger.warn('SendPulse client initialization failed', { error: error.message });
      this.sendpulseClient = null;
    }
    
    // SendPulse ID field key in Pipedrive (same as invoiceProcessing)
    this.SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
  }

  /**
   * Main entrypoint for scheduler/manual trigger.
   */
  async processPendingPayments(context = {}) {
    const {
      trigger = 'manual',
      runId = null,
      from,
      to,
      dealId,
      skipTriggers = false // Если true, пропускаем создание новых Checkout Sessions
    } = context;

    const dealIdFilter = dealId ? String(dealId) : null;

    this.logger.info('Stripe processor invoked', {
      trigger,
      runId,
      mode: this.mode,
      from,
      to,
      dealId: dealIdFilter,
      skipTriggers
    });

    if (!this.repository.isEnabled()) {
      this.logger.warn('StripeRepository disabled (Supabase missing). Skipping Stripe processing.');
      return {
        success: true,
        summary: { total: 0, successful: 0, errors: 0 },
        results: [],
        skipped: true,
        reason: 'repository_disabled'
      };
    }

    const summary = {
      total: 0,
      successful: 0,
      errors: 0
    };
    const results = [];
    const refundsSummary = {
      total: 0,
      amount: 0,
      amountPln: 0
    };
    const metadata = {
      trigger,
      runId,
      mode: this.mode,
      filters: { from, to, dealId: dealIdFilter }
    };

    let triggerSummary = {
      totalDeals: 0,
      sessionsCreated: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Создаем новые Checkout Sessions только если не пропущено
      if (!skipTriggers) {
        triggerSummary = await this.processCheckoutTriggers({
          trigger,
          runId,
          dealId: dealIdFilter
        });
      } else {
        this.logger.info('Skipping Checkout Sessions creation (skipTriggers=true)', {
          trigger,
          runId
        });
      }

      const filters = buildSessionFilters({ from, to });
      await iterateCheckoutSessions({
        filters,
        maxIterations: Math.ceil(this.maxSessions / 100),
        onPage: async (sessions) => {
          for (const session of sessions) {
            if (dealIdFilter && String(session?.metadata?.deal_id || '') !== dealIdFilter) {
              continue;
            }
            if (!this.shouldProcessSession(session)) continue;
            
            // Check if payment was paid but not processed (webhook might have failed)
            const isPaid = session.payment_status === 'paid';
            const existingPayment = await this.repository.findPaymentBySessionId(session.id);
            const dealId = session.metadata?.deal_id;
            
            // If paid but not processed and more than 1 hour old, create task
            if (isPaid && !existingPayment && dealId) {
              const sessionCreated = session.created ? new Date(session.created * 1000) : null;
              if (sessionCreated) {
                const hoursSinceCreated = (Date.now() - sessionCreated.getTime()) / (1000 * 60 * 60);
                if (hoursSinceCreated > 1) {
                  // Payment was paid more than 1 hour ago but not processed - webhook likely failed
                  await this.createWebhookFailureTask(dealId, session.id);
                }
              }
            }
            
            summary.total += 1;
            try {
              // eslint-disable-next-line no-await-in-loop
              await this.persistSession(session);
              summary.successful += 1;
            } catch (error) {
              summary.errors += 1;
              results.push({
                sessionId: session.id,
                success: false,
                error: error.message
              });
            }
            if (summary.total >= this.maxSessions) {
              throw new Error('Stripe session processing limit reached');
            }
          }
        }
      });

      // Filter refunds by dealId in metadata, not in Stripe API filters
      const refundFilters = { from: filters.from, to: filters.to };
      await this.processRefunds(refundFilters, refundsSummary, dealIdFilter);

      // Process refunds for lost deals (deals with status "lost" and reason "Refund")
      const lostDealsRefundsSummary = {
        totalDeals: 0,
        refundsCreated: 0,
        errors: []
      };
      await this.processLostDealRefunds({
        trigger,
        runId
      });
    } catch (error) {
      logStripeError(error, { scope: 'processPendingPayments' });
      const logPayload = {
        runId,
        trigger,
        summary,
        resultsCount: results.length,
        mode: this.mode
      };
      this.logger.error('Stripe processing finished with errors', logPayload);
      return {
        success: false,
        summary,
        results,
        checkout: triggerSummary,
        metadata,
        error: error.message
      };
    }

    const plans = Array.isArray(this.paymentPlanService)
      ? []
      : this.paymentPlanService;

    return {
      success: summary.errors === 0,
      summary,
      results,
      refunds: refundsSummary,
      plansSummary: plans?.getSummary ? plans.getSummary() : null,
      checkout: triggerSummary,
      metadata
    };
  }

  shouldProcessSession(session) {
    return session?.status === 'complete' && session?.payment_status === 'paid';
  }

  getParticipant(session) {
    const details = session.customer_details || {};
    const email = details.email || session.metadata?.customer_email || null;
    const name = details.name || session.metadata?.customer_name || email || 'Неизвестно';
    const address = details.address || {};
    return {
      email,
      name,
      address: {
        line1: address.line1 || address.line_1 || null,
        line2: address.line2 || address.line_2 || null,
        postalCode: address.postal_code || null,
        city: address.city || null,
        state: address.state || null,
        country: address.country || null
      }
    };
  }

  async convertAmount(amount, currency) {
    const { amountPln } = await this.convertAmountWithRate(amount, currency);
    return amountPln;
  }

  async convertAmountWithRate(amount, currency) {
    const source = normaliseCurrency(currency);
    const now = new Date().toISOString();

    if (!Number.isFinite(amount)) {
      if (source === 'PLN') {
        return { amountPln: 0, rate: 1, fetchedAt: now };
      }
      return { amountPln: 0, rate: null, fetchedAt: null };
    }

    if (source === 'PLN') {
      return {
        amountPln: roundBankers(amount),
        rate: 1,
        fetchedAt: now
      };
    }

    try {
      const rate = await getRate(source, 'PLN');
      return {
        amountPln: roundBankers(amount * rate),
        rate: roundBankers(rate, 6),
        fetchedAt: now
      };
    } catch (error) {
      this.logger.warn('Failed to fetch exchange rate', {
        currency: source,
        amount,
        error: error.message
      });
      return {
        amountPln: 0,
        rate: null,
        fetchedAt: null
      };
    }
  }

  async persistSession(session) {
    const currency = normaliseCurrency(session.currency);
    
    // For inclusive tax rate, use amount_subtotal (price without additional VAT)
    // For exclusive tax rate, use amount_subtotal (price without VAT)
    // amount_total includes VAT, but for inclusive tax, VAT is already in the price
    const taxBehavior = session.total_details?.breakdown?.taxes?.[0]?.tax_behavior || 
                       session.total_details?.tax_behavior || 
                       null;
    const isInclusiveTax = taxBehavior === 'inclusive';
    
    // Use amount_subtotal for display (price from CRM), amount_total for actual payment
    const amountSubtotal = fromMinorUnit(session.amount_subtotal || session.amount_total || 0, currency);
    const amountTotal = fromMinorUnit(session.amount_total || 0, currency);
    
    // For display in notes and reports, use subtotal (price from CRM without additional VAT)
    // For inclusive tax, subtotal should equal the price from CRM
    // Always use subtotal to avoid showing VAT twice
    const amount = amountSubtotal;
    
    const amountConversion = await this.convertAmountWithRate(amount, currency);
    const amountPln = amountConversion.amountPln;
    const amountTax = fromMinorUnit(session.total_details?.amount_tax || 0, currency);
    let amountTaxPln = 0;
    if (amountConversion.rate) {
      amountTaxPln = roundBankers(amountTax * amountConversion.rate);
    } else {
      const taxConversion = await this.convertAmountWithRate(amountTax, currency);
      amountTaxPln = taxConversion.amountPln;
    }
    const participant = this.getParticipant(session);
    const dealId = session.metadata?.deal_id || null;
    const crmContext = await this.getCrmContext(dealId);
    const customerType = crmContext?.isB2B ? 'organization' : 'person';
    const shouldApplyVat = this.shouldApplyVat({
      customerType,
      companyCountry: crmContext?.companyCountry,
      sessionCountry: participant?.address?.country
    });
    const addressValidation = await this.ensureAddress({
      dealId,
      shouldApplyVat,
      participant,
      crmContext
    });

    // Get product_link_id from metadata, or try to find it by crm_product_id for old sessions
    let productLinkId = session.metadata?.product_link_id || null;
    if (!productLinkId && session.metadata?.product_id) {
      // Try to find product link by CRM product ID for old sessions without product_link_id
      const productLink = await this.repository.findProductLinkByCrmId(String(session.metadata.product_id));
      if (productLink?.id) {
        productLinkId = productLink.id;
      } else {
        // If product link doesn't exist, try to create it from Stripe product metadata
        // This handles old sessions that have product_id in metadata but no product_link yet
        const stripeProductId = session.line_items?.data?.[0]?.price?.product || null;
        if (stripeProductId && session.metadata?.product_id) {
          try {
            const stripeProduct = await this.stripe.products.retrieve(stripeProductId);
            const crmProductName = stripeProduct.name || session.metadata.product_id;
            const newLink = await this.repository.upsertProductLink({
              crmProductId: String(session.metadata.product_id),
              crmProductName,
              stripeProductId,
              campProductId: null,
              status: 'active'
            });
            if (newLink?.id) {
              productLinkId = newLink.id;
            }
          } catch (error) {
            this.logger.warn('Failed to create product link from Stripe product', {
              stripeProductId,
              crmProductId: session.metadata.product_id,
              error: error.message
            });
          }
        }
      }
    }

    const paymentRecord = {
      session_id: session.id,
      deal_id: dealId,
      product_id: productLinkId,
      payment_type: session.metadata?.payment_type || null,
      currency,
      // Store subtotal (price from CRM) as original_amount for display
      original_amount: roundBankers(amount),
      amount_pln: amountPln,
      amount_tax: roundBankers(amountTax),
      amount_tax_pln: amountTaxPln,
      tax_behavior: session.total_details?.breakdown?.taxes?.[0]?.tax_behavior || session.total_details?.tax_behavior || null,
      tax_rate_id: session.total_details?.breakdown?.taxes?.[0]?.rate || null,
      status: addressValidation.valid ? 'processed' : 'pending_metadata',
      customer_email: participant.email,
      customer_name: participant.name,
      customer_type: customerType,
      company_name: crmContext?.isB2B ? crmContext.companyName : null,
      company_tax_id: crmContext?.isB2B ? crmContext.companyTaxId : null,
      company_address: crmContext?.isB2B ? crmContext.companyAddress : null,
      company_country: crmContext?.isB2B ? crmContext.companyCountry : null,
      customer_country: participant?.address?.country || crmContext?.companyCountry || null,
      address_validated: addressValidation.valid,
      address_validation_reason: addressValidation.reason || null,
      expected_vat: shouldApplyVat,
      exchange_rate: amountConversion.rate,
      exchange_rate_fetched_at: amountConversion.fetchedAt,
      payment_status: session.payment_status || null,
      payment_mode: session.mode || null,
      created_at: session.created ? new Date(session.created * 1000).toISOString() : new Date().toISOString(),
      processed_at: new Date().toISOString(),
      raw_payload: session
    };

    // Check if payment was already processed to avoid duplicate stage updates
    const existingPayment = await this.repository.findPaymentBySessionId(session.id);
    const isNewPayment = !existingPayment;

    // Get invoice/receipt number before saving
    let invoiceNumber = null;
    let receiptNumber = null;
    
    if (session.payment_status === 'paid') {
      try {
        // For B2B: get invoice number
        if (crmContext?.isB2B) {
          let invoiceId = null;
          if (session.invoice) {
            invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
          } else {
            // Try to retrieve from Checkout Session
            const expandedSession = await this.stripe.checkout.sessions.retrieve(session.id, {
              expand: ['invoice']
            });
            if (expandedSession.invoice) {
              invoiceId = typeof expandedSession.invoice === 'string' 
                ? expandedSession.invoice 
                : expandedSession.invoice.id;
            }
          }
          
          if (invoiceId) {
            try {
              const invoice = await this.stripe.invoices.retrieve(invoiceId);
              invoiceNumber = invoice.number || null;
            } catch (err) {
              this.logger.warn('Failed to retrieve invoice number', {
                invoiceId,
                error: err.message
              });
            }
          }
        } else {
          // For B2C: get receipt number from payment intent
          if (session.payment_intent) {
            const paymentIntentId = typeof session.payment_intent === 'string' 
              ? session.payment_intent 
              : session.payment_intent.id;
            
            try {
              const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
                expand: ['charges.data.receipt']
              });
              
              // Get receipt number from latest charge
              if (paymentIntent.charges?.data?.length > 0) {
                const charge = paymentIntent.charges.data[0];
                receiptNumber = charge.receipt_number || null;
              }
            } catch (err) {
              this.logger.warn('Failed to retrieve receipt number', {
                paymentIntentId,
                error: err.message
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn('Failed to get invoice/receipt number', {
          dealId,
          sessionId: session.id,
          error: error.message
        });
      }
    }
    
    // Add invoice/receipt number to payment record (if columns exist in DB)
    // These fields are optional and may not exist in older database schemas
    if (invoiceNumber !== null) {
      paymentRecord.invoice_number = invoiceNumber;
    }
    if (receiptNumber !== null) {
      paymentRecord.receipt_number = receiptNumber;
    }
    
    // Save payment (repository handles missing invoice_number/receipt_number columns automatically)
    await this.repository.savePayment(paymentRecord);
    await this.paymentPlanService.updatePlanFromSession(paymentRecord, session);

    // Send invoice to customer ONLY for B2B deals (B2C gets receipt automatically)
    // Check if this is B2B by looking for customer object (not just customer_email)
    // Also check if invoice was created (invoice_creation.enabled)
    const isB2B = session.customer && typeof session.customer === 'string';
    const hasInvoice = session.invoice || (session.payment_status === 'paid' && isB2B);
    
    if (isB2B && session.payment_status === 'paid') {
      try {
        let invoiceId = null;
        
        // Get invoice ID from session or retrieve it from Checkout Session
        if (session.invoice) {
          invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
        } else {
          // Try to find invoice by retrieving the Checkout Session with expanded invoice
          const expandedSession = await this.stripe.checkout.sessions.retrieve(session.id, {
            expand: ['invoice']
          });
          if (expandedSession.invoice) {
            invoiceId = typeof expandedSession.invoice === 'string' 
              ? expandedSession.invoice 
              : expandedSession.invoice.id;
          }
        }
        
        if (!invoiceId) {
          this.logger.warn('No invoice found for B2B payment', {
            dealId,
            sessionId: session.id
          });
          return;
        }
        
        const invoice = await this.stripe.invoices.retrieve(invoiceId, {
          expand: ['customer']
        });
        
        // Get customer email from invoice or customer object
        let invoiceEmail = invoice.customer_email;
        if (!invoiceEmail && invoice.customer) {
          if (typeof invoice.customer === 'object' && invoice.customer.email) {
            invoiceEmail = invoice.customer.email;
          } else if (typeof invoice.customer === 'string') {
            // Fetch customer to get email
            try {
              const customer = await this.stripe.customers.retrieve(invoice.customer);
              invoiceEmail = customer.email;
            } catch (error) {
              this.logger.warn('Failed to retrieve customer email for invoice', {
                invoiceId,
                customerId: invoice.customer,
                error: error.message
              });
            }
          }
        }
        
        // If no email in invoice, try to get from session or payment record
        if (!invoiceEmail) {
          const participant = this.getParticipant(session);
          invoiceEmail = participant.email || paymentRecord.customer_email;
        }
        
        // Store invoice URL for adding to note/message
        const invoiceUrl = invoice.hosted_invoice_url || invoice.invoice_pdf || null;
        
        // Check if invoice needs to be sent
        // For paid invoices, we can always send them (Stripe will handle duplicates)
        if (invoice.status === 'paid' || invoice.status === 'open') {
          try {
            // Try to send invoice - Stripe will handle if already sent
            await this.stripe.invoices.sendInvoice(invoiceId);
            this.logger.info('Invoice sent to customer', {
              invoiceId,
              dealId,
              customerEmail: invoiceEmail,
              invoiceUrl
            });
            
            // Add invoice URL to payment note if available
            if (invoiceUrl && isNewPayment) {
              // Update payment note with invoice link
              const paymentRecord = await this.repository.findPaymentBySessionId(session.id);
              if (paymentRecord) {
                await this.addPaymentNoteToDeal(dealId, {
                  paymentType: paymentRecord.payment_type || 'payment',
                  amount: paymentRecord.original_amount,
                  currency: paymentRecord.currency,
                  amountPln: paymentRecord.amount_pln,
                  sessionId: session.id,
                  invoiceUrl: invoiceUrl
                });
              }
            }
          } catch (sendError) {
            // If invoice was already sent, Stripe returns an error - that's OK
            if (sendError.code === 'invoice_already_sent' || sendError.message?.includes('already sent')) {
              this.logger.info('Invoice already sent to customer', {
                invoiceId,
                dealId
              });
              
              // Still add invoice URL to note even if already sent
              if (invoiceUrl && isNewPayment) {
                const paymentRecord = await this.repository.findPaymentBySessionId(session.id);
                if (paymentRecord) {
                  await this.addPaymentNoteToDeal(dealId, {
                    paymentType: paymentRecord.payment_type || 'payment',
                    amount: paymentRecord.original_amount,
                    currency: paymentRecord.currency,
                    amountPln: paymentRecord.amount_pln,
                    sessionId: session.id,
                    invoiceUrl: invoiceUrl
                  });
                }
              }
            } else {
              throw sendError;
            }
          }
        } else if (invoice.status === 'draft') {
          // Finalize draft invoice first, then send
          await this.stripe.invoices.finalizeInvoice(invoiceId);
          await this.stripe.invoices.sendInvoice(invoiceId);
          this.logger.info('Invoice finalized and sent to customer', {
            invoiceId,
            dealId,
            customerEmail: invoice.customer_email || (typeof invoice.customer === 'object' ? invoice.customer.email : null)
          });
        }
      } catch (invoiceError) {
        // Log but don't fail - invoice sending is not critical
        this.logger.warn('Failed to send invoice to customer', {
          dealId,
          sessionId: session.id,
          error: invoiceError.message
        });
      }
    }

    // Send receipt for B2C payments (if not already sent automatically)
    if (!isB2B && session.payment_status === 'paid') {
      try {
        const participant = this.getParticipant(session);
        const receiptEmail = participant.email || paymentRecord.customer_email;
        
        if (receiptEmail && session.payment_intent) {
          const paymentIntentId = typeof session.payment_intent === 'string' 
            ? session.payment_intent 
            : session.payment_intent.id;
          
          try {
            // Get payment intent to check if receipt was sent
            const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
              expand: ['charges.data.receipt']
            });
            
            // Check if receipt email was sent
            const charge = paymentIntent.charges?.data?.[0];
            if (charge && !charge.receipt_email) {
              // Receipt email not set, update charge to send receipt
              try {
                await this.stripe.charges.update(charge.id, {
                  receipt_email: receiptEmail
                });
                this.logger.info('Receipt email sent to customer', {
                  dealId,
                  sessionId: session.id,
                  email: receiptEmail,
                  chargeId: charge.id
                });
              } catch (receiptError) {
                this.logger.warn('Failed to send receipt email', {
                  dealId,
                  sessionId: session.id,
                  email: receiptEmail,
                  error: receiptError.message
                });
              }
            } else if (charge?.receipt_email) {
              this.logger.info('Receipt email already set', {
                dealId,
                sessionId: session.id,
                email: charge.receipt_email
              });
            }
          } catch (piError) {
            this.logger.warn('Failed to retrieve payment intent for receipt email', {
              dealId,
              sessionId: session.id,
              error: piError.message
            });
          }
        }
      } catch (receiptError) {
        // Log but don't fail - receipt sending is not critical
        this.logger.warn('Failed to send receipt email to customer', {
          dealId,
          sessionId: session.id,
          error: receiptError.message
        });
      }
    }

    // Check if payment was refunded before creating notes or updating stages
    let isRefunded = false;
    if (session.payment_intent && session.payment_status === 'paid') {
      try {
        const paymentIntentId = typeof session.payment_intent === 'string' 
          ? session.payment_intent 
          : session.payment_intent.id;
        
        // Check if refund exists in database (by dealId and sessionId)
        const deletions = await this.repository.listDeletions({
          dealId: dealId ? String(dealId) : null
        });
        
        // Filter deletions by session_id from metadata
        const sessionDeletions = deletions.filter(d => {
          const metadata = d.metadata || {};
          const rawPayload = d.raw_payload || {};
          const payloadSession = rawPayload.session || {};
          return payloadSession.id === session.id || metadata.session_id === session.id;
        });
        
        if (sessionDeletions && sessionDeletions.length > 0) {
          isRefunded = true;
          this.logger.info('Payment was refunded, skipping note creation and stage update', {
            dealId,
            sessionId: session.id,
            paymentIntentId,
            deletionCount: sessionDeletions.length
          });
        } else {
          // Also check in Stripe directly
          try {
            const refunds = await this.stripe.refunds.list({
              payment_intent: paymentIntentId,
              limit: 1
            });
            if (refunds.data && refunds.data.length > 0) {
              isRefunded = true;
              this.logger.info('Payment was refunded in Stripe, skipping note creation and stage update', {
                dealId,
                sessionId: session.id,
                paymentIntentId,
                refundId: refunds.data[0].id
              });
            }
          } catch (refundCheckError) {
            // If we can't check refunds, continue (don't block processing)
            this.logger.warn('Failed to check refunds in Stripe', {
              dealId,
              sessionId: session.id,
              error: refundCheckError.message
            });
          }
        }
      } catch (deletionCheckError) {
        // If we can't check deletions, continue (don't block processing)
        this.logger.warn('Failed to check payment deletions', {
          dealId,
          sessionId: session.id,
          error: deletionCheckError.message
        });
      }
    }

    // Only update deal stage if this is a new payment (not a re-processing) and not refunded
    if (dealId && isNewPayment && !isRefunded) {
      const paymentType = session.metadata?.payment_type || 'payment';
      const isFinal = session.metadata?.is_final === 'true' || paymentType === 'final';
      // 'single' payment type means it's the only payment (should go to Camp Waiter)
      const isFirst = paymentType === 'deposit' || paymentType === 'first' || paymentType === 'single';
      const isRest = paymentType === 'rest' || paymentType === 'second';

      // Get deal to check close_date for single payment logic and current stage
      let isSinglePaymentExpected = false;
      let currentDealStageId = null;
      try {
        const dealResult = await this.pipedriveClient.getDeal(dealId);
        if (dealResult.success && dealResult.deal) {
          currentDealStageId = dealResult.deal.stage_id;
          const closeDate = dealResult.deal.expected_close_date || dealResult.deal.close_date;
          if (closeDate) {
            const expectedCloseDate = new Date(closeDate);
            const today = new Date();
            const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
            // If < 30 days, only one payment is expected
            isSinglePaymentExpected = daysDiff < 30;
          }
        }
      } catch (error) {
        this.logger.warn('Failed to check deal close_date for payment logic', {
          dealId,
          error: error.message
        });
      }

      // Logic for stage updates:
      // 1. If deal is in "First payment" stage → Camp Waiter (stage 27) - оплата при одном платеже
      // 2. If rest/second payment → Camp Waiter (stage 27) - второй платеж из двух
      // 3. If first payment AND single payment expected → Camp Waiter (stage 27)
      // 4. If first payment AND two payments expected → Second Payment (stage 32) - ждем второй платеж
      // 5. If final flag → Camp Waiter (stage 27)

      // Если сделка уже в стадии "First payment" и приходит оплата → Camp Waiter (один платеж)
      if (currentDealStageId === STAGES.FIRST_PAYMENT_ID) {
        await this.crmSyncService.updateDealStage(dealId, STAGES.CAMP_WAITER_ID, {
          type: 'first_payment_stage_paid',
          sessionId: session.id,
          paymentType
        });
        
        // Close address tasks if payment received
        await this.closeAddressTasks(dealId);
        
        // Add note to deal about payment
        await this.addPaymentNoteToDeal(dealId, {
          paymentType: 'payment',
          amount: paymentRecord.original_amount,
          currency: paymentRecord.currency,
          amountPln: paymentRecord.amount_pln,
          sessionId: session.id
        });
      } else if (isFinal || isRest) {
        // Second payment (rest) or final payment - move to Camp Waiter (второй платеж получен)
        await this.crmSyncService.updateDealStage(dealId, STAGES.CAMP_WAITER_ID, {
          type: 'final_payment',
          sessionId: session.id,
          paymentType
        });
        
        // Close address tasks if payment received
        await this.closeAddressTasks(dealId);
      } else if (isFirst) {
        // For 'single' payment type, always go to Camp Waiter (it's the only payment)
        if (paymentType === 'single' || isSinglePaymentExpected) {
          // Single payment expected (< 30 days) or 'single' type - move directly to Camp Waiter
          await this.crmSyncService.updateDealStage(dealId, STAGES.CAMP_WAITER_ID, {
            type: 'first_payment_single',
            sessionId: session.id,
            paymentType
          });
          
          // Close address tasks if payment received
          await this.closeAddressTasks(dealId);
        } else {
          // First payment of two (>= 30 days) - move to Second Payment stage (ждем второй платеж)
          await this.crmSyncService.updateDealStage(dealId, STAGES.SECOND_PAYMENT_ID, {
            type: 'first_payment',
            sessionId: session.id
          });
        }

        // Add note to deal about payment (for all first payments including 'single')
        await this.addPaymentNoteToDeal(dealId, {
          paymentType: paymentType === 'single' ? 'payment' : 'deposit',
          amount: paymentRecord.original_amount,
          currency: paymentRecord.currency,
          amountPln: paymentRecord.amount_pln,
          sessionId: session.id
        });
      } else {
        // Fallback: unknown payment type, move to Second Payment stage
        await this.crmSyncService.updateDealStage(dealId, STAGES.SECOND_PAYMENT_ID, {
          type: 'second_payment',
          sessionId: session.id
        });
      }
    } else if (dealId && !isNewPayment && !isRefunded) {
      // Payment was already processed, but check if status needs correction
      // For 'single' payment type, ensure it goes to Camp Waiter
      const paymentType = session.metadata?.payment_type || 'payment';
      if (paymentType === 'single') {
        // Check current deal stage and correct if needed
        try {
          const dealResult = await this.pipedriveClient.getDeal(dealId);
          if (dealResult.success && dealResult.deal) {
            const currentStageId = dealResult.deal.stage_id;
            // If not in Camp Waiter, correct it
            if (currentStageId !== STAGES.CAMP_WAITER_ID) {
              this.logger.info('Correcting deal stage for single payment', {
                dealId,
                currentStage: currentStageId,
                expectedStage: STAGES.CAMP_WAITER_ID
              });
              await this.crmSyncService.updateDealStage(dealId, STAGES.CAMP_WAITER_ID, {
                type: 'single_payment_correction',
                sessionId: session.id,
                paymentType
              });
              
              // Also add note if it doesn't exist (always add for single payment correction)
              // But only if payment is not refunded
              if (!isRefunded) {
                try {
                  await this.addPaymentNoteToDeal(dealId, {
                    paymentType: 'payment',
                    amount: paymentRecord.original_amount,
                    currency: paymentRecord.currency,
                    amountPln: paymentRecord.amount_pln,
                    sessionId: session.id
                  });
                } catch (noteError) {
                  // Note might already exist, that's OK
                  this.logger.debug('Note may already exist or failed to create', {
                    dealId,
                    error: noteError.message
                  });
                }
              }
            }
          }
        } catch (error) {
          this.logger.warn('Failed to correct deal stage for single payment', {
            dealId,
            error: error.message
          });
        }
      } else {
        // Skip stage update for other payment types to avoid chaos
        this.logger.debug('Skipping stage update for already processed payment', {
          dealId,
          sessionId: session.id
        });
      }
    }
  }

  async getCrmContext(dealId) {
    if (!dealId) return null;
    if (this.crmCache.has(dealId)) {
      return this.crmCache.get(dealId);
    }

    const context = {
      deal: null,
      person: null,
      organization: null,
      isB2B: false,
      companyName: null,
      companyTaxId: null,
      companyAddress: null,
      companyCountry: null,
      addressParts: null
    };

    try {
      const dealResponse = await this.pipedriveClient.getDeal(dealId);
      if (!dealResponse.success) {
        this.logger.warn('Failed to load deal for Stripe payment', { dealId });
        this.crmCache.set(dealId, null);
        return null;
      }

      const deal = dealResponse.deal;
      context.deal = deal;

      const personId = this.extractPipedriveId(deal?.person_id);
      const orgId = this.extractPipedriveId(deal?.org_id);

      if (personId) {
        const personResponse = await this.pipedriveClient.getPerson(personId);
        if (personResponse.success) {
          context.person = personResponse.person;
        }
      }

      if (orgId) {
        const orgResponse = await this.pipedriveClient.getOrganization(orgId);
        if (orgResponse.success) {
          context.organization = orgResponse.organization;
        }
      }

      context.isB2B = Boolean(context.organization);
      const addressParts = this.extractAddressParts(context);
      context.addressParts = addressParts;
      context.companyAddress = this.formatAddress(addressParts);
      context.companyCountry = this.extractCountryCode(addressParts);
      context.companyName = this.extractCompanyName(context);
      context.companyTaxId = this.extractTaxId(context.organization);

      this.crmCache.set(dealId, context);
      return context;
    } catch (error) {
      this.logger.error('Failed to load CRM context for Stripe payment', {
        dealId,
        error: error.message
      });
      this.crmCache.set(dealId, null);
      return null;
    }
  }

  extractPipedriveId(value) {
    if (!value) return null;
    if (typeof value === 'object' && value.value) return value.value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
  }

  extractCompanyName(context) {
    if (context.organization?.name) return String(context.organization.name).trim();
    if (context.deal?.org_name) return String(context.deal.org_name).trim();
    return null;
  }

  extractTaxId(organization) {
    if (!organization) return null;
    const candidates = [
      organization.nip,
      organization.tax_id,
      organization.taxId,
      organization.vat_number,
      organization.vatNumber,
      organization.value?.tax_id,
      organization.value?.nip
    ].filter(Boolean);

    // Check custom_fields if they exist
    if (organization.custom_fields && typeof organization.custom_fields === 'object') {
      Object.entries(organization.custom_fields).forEach(([key, value]) => {
        if (!value) return;
        const normalisedKey = key.toLowerCase();
        if (normalisedKey.includes('nip') || normalisedKey.includes('tax')) {
          candidates.push(value);
        }
      });
    }

    // Check all fields in organization object for NIP/tax fields
    // Pipedrive API returns custom fields directly in the organization object
    // Standard Pipedrive fields to exclude from search
    const standardFields = new Set([
      'id', 'name', 'owner_id', 'open_deals_count', 'related_open_deals_count',
      'closed_deals_count', 'related_closed_deals_count', 'email_messages_count',
      'people_count', 'activities_count', 'done_activities_count', 'undone_activities_count',
      'files_count', 'notes_count', 'followers_count', 'won_deals_count', 'related_won_deals_count',
      'lost_deals_count', 'related_lost_deals_count', 'active_flag', 'picture_id', 'country_code',
      'first_char', 'update_time', 'delete_time', 'add_time', 'visible_to', 'next_activity_date',
      'next_activity_time', 'next_activity_id', 'last_activity_id', 'last_activity_date',
      'label', 'label_ids', 'address', 'address_subpremise', 'address_street_number',
      'address_route', 'address_sublocality', 'address_locality', 'address_admin_area_level_1',
      'address_admin_area_level_2', 'address_country', 'address_postal_code', 'address_formatted_address',
      'website', 'linkedin', 'industry', 'annual_revenue', 'employee_count', 'cc_email',
      'owner_name', 'edit_name', 'last_activity', 'next_activity', 'company_id', 'custom_fields'
    ]);
    
    Object.entries(organization).forEach(([key, value]) => {
      if (!value) return;
      const normalisedKey = key.toLowerCase();
      
      // Check if field name contains nip/tax
      if (normalisedKey.includes('nip') || normalisedKey.includes('tax')) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length > 0) {
            candidates.push(trimmed);
          }
        }
      }
      
      // Check custom fields (long hash-like keys) - they might contain NIP
      // Custom fields in Pipedrive are typically 40-character hex strings
      if (key.length === 40 && /^[a-f0-9]+$/i.test(key)) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          // NIP is typically 9-10 digits, sometimes with dashes
          if (trimmed.length >= 9 && trimmed.length <= 15 && /^[\d\-\s]+$/.test(trimmed)) {
            candidates.push(trimmed);
          }
        }
      }
    });

    const taxId = candidates.find((candidate) => {
      if (typeof candidate !== 'string') return false;
      const trimmed = candidate.trim();
      return trimmed.length > 0;
    });

    return taxId ? taxId.trim() : null;
  }

  extractAddressParts(context) {
    const organization = context.organization || {};
    const person = context.person || {};
    const deal = context.deal || {};

    const fromOrganization = {
      // Construct line1 from route + street number, or use formatted address
      line1: (organization.address_route && organization.address_street_number 
        ? `${organization.address_route} ${organization.address_street_number}` 
        : null) || organization.address || organization.address_street || organization.street_address || null,
      line2: organization.address_subpremise || organization.address_line_2 || organization.address_line2 || null,
      postalCode: organization.address_postal_code || organization.postal_code || organization.zip || organization.post_code || null,
      city: organization.address_locality || organization.city || organization.address_city || null,
      state: organization.address_admin_area_level_1 || organization.state || organization.region || null,
      country: organization.address_country || organization.country || null
    };

    const fromPerson = {
      line1: person.postal_address || person.postal_address_route || null,
      line2: person.postal_address_street_number || person.postal_address_neighborhood || null,
      postalCode: person.postal_address_postal_code || null,
      city: person.postal_address_locality || null,
      state: person.postal_address_admin_area_level_1 || null,
      country: person.postal_address_country || null
    };

    const fromDeal = {
      line1: deal.address || deal.address_street || null,
      line2: deal.address_line2 || null,
      postalCode: deal.zip || deal.address_postal_code || null,
      city: deal.city || null,
      state: deal.state || null,
      country: deal.country || deal.country_code || null
    };

    let parts = {
      line1: fromOrganization.line1 || fromDeal.line1 || fromPerson.line1 || null,
      line2: fromOrganization.line2 || fromDeal.line2 || fromPerson.line2 || null,
      postalCode: fromOrganization.postalCode || fromDeal.postalCode || fromPerson.postalCode || null,
      city: fromOrganization.city || fromDeal.city || fromPerson.city || null,
      state: fromOrganization.state || fromDeal.state || fromPerson.state || null,
      country: fromOrganization.country || fromDeal.country || fromPerson.country || null
    };

    // Clean up: if line2 is part of line1 (e.g., duplicate street number), remove it
    if (parts.line1 && parts.line2) {
      const line1Lower = parts.line1.toLowerCase().trim();
      const line2Lower = parts.line2.toLowerCase().trim();
      // If line2 appears in line1, clear line2
      if (line1Lower.includes(line2Lower) && line2Lower.length > 0) {
        parts.line2 = null;
      }
    }

    return parts;
  }

  extractCountryCode(parts = {}) {
    const country = parts.country || null;
    if (!country) return null;
    
    return this.normalizeCountryCode(country);
  }

  normalizeCountryCode(country) {
    if (!country) return null;
    
    const countryMap = {
      // Польские названия из wFirma -> ISO коды
      'Polska': 'PL',
      'Niemcy': 'DE',
      'Francja': 'FR',
      'Wielka Brytania': 'GB',
      'Stany Zjednoczone': 'US',
      'Czechy': 'CZ',
      'Litwa': 'LT',
      'Łotwa': 'LV',
      'Estonia': 'EE',
      
      // Английские названия из CRM -> ISO коды
      'Poland': 'PL',
      'Germany': 'DE',
      'Deutschland': 'DE',
      'France': 'FR',
      'United Kingdom': 'GB',
      'UK': 'GB',
      'United States': 'US',
      'USA': 'US',
      'Czech Republic': 'CZ',
      'Lithuania': 'LT',
      'Latvia': 'LV',
      'Estonia': 'EE',
      'Portugal': 'PT',
      'Spain': 'ES',
      'Italy': 'IT',
      'Netherlands': 'NL',
      'Belgium': 'BE',
      'Austria': 'AT',
      'Switzerland': 'CH',
      'Sweden': 'SE',
      'Norway': 'NO',
      'Denmark': 'DK',
      'Finland': 'FI',
      'Ukraine': 'UA',
      'Україна': 'UA',
      'Ukraina': 'UA'
    };
    
    const trimmed = String(country).trim();
    
    // Если уже двухбуквенный код
    if (trimmed.length === 2) {
      return trimmed.toUpperCase();
    }
    
    // Ищем в мапе (case-insensitive)
    const normalized = countryMap[trimmed] || countryMap[trimmed.toLowerCase()];
    if (normalized) {
      return normalized;
    }
    
    // Если не найдено, возвращаем null (не PL по умолчанию)
    return null;
  }

  formatAddress(parts = {}) {
    const segments = [
      parts.line1,
      parts.line2,
      [parts.postalCode, parts.city].filter(Boolean).join(' '),
      parts.state,
      parts.country
    ].filter((segment) => {
      if (!segment) return false;
      const value = String(segment).trim();
      return value.length > 0;
    });

    return segments.join(', ') || null;
  }

  /**
   * Ensure Poland VAT Tax Rate (23%) exists in Stripe.
   * Creates it if it doesn't exist, or returns existing one.
   * @returns {Promise<string>} Tax Rate ID
   */
  async ensurePolandTaxRate() {
    try {
      // Search for existing Poland VAT 23% tax rate
      const existingRates = await this.stripe.taxRates.list({
        limit: 100,
        active: true
      });

      // Look for Poland VAT 23% rate (inclusive - price already includes VAT)
          // Always prefer inclusive tax rate (VAT already included in price)
          const polandVatRate = existingRates.data.find(
            rate => rate.percentage === 23 && 
            rate.inclusive === true && // MUST be inclusive
            (rate.country === 'PL' || 
             rate.display_name?.toLowerCase().includes('vat') || 
             rate.display_name?.toLowerCase().includes('nds') ||
             rate.display_name?.toLowerCase().includes('poland'))
          );

      if (polandVatRate) {
        this.logger.info('Found existing Poland VAT Tax Rate', {
          taxRateId: polandVatRate.id,
          percentage: polandVatRate.percentage
        });
        return polandVatRate.id;
      }

      // Create new Poland VAT 23% tax rate (inclusive - price already includes VAT)
      // This ensures the final amount matches CRM price (1000 PLN stays 1000 PLN total)
      const newTaxRate = await this.stripe.taxRates.create({
        display_name: 'VAT Poland',
        description: 'VAT 23% для Польши (включен в цену)',
        percentage: 23,
        inclusive: true, // Price already includes VAT - final amount stays the same as CRM
        country: 'PL',
        active: true
      });

      this.logger.info('Created Poland VAT Tax Rate', {
        taxRateId: newTaxRate.id,
        percentage: newTaxRate.percentage
      });

      return newTaxRate.id;
    } catch (error) {
      this.logger.error('Failed to ensure Poland Tax Rate', {
        error: error.message,
        context: 'ensurePolandTaxRate'
      });
      throw error;
    }
  }

  /**
   * Create or get Stripe Customer for B2B companies
   * Ensures company details (name, tax ID, address) appear in Stripe invoices
   */
  async ensureStripeCustomer({ email, name, taxId, address, dealId }) {
    if (!email) {
      this.logger.warn('Cannot create Stripe Customer without email', { dealId });
      return null;
    }

    try {
      // Normalize country code for Stripe (must be ISO 2-letter code)
      let countryCode = null;
      if (address?.country) {
        countryCode = this.normalizeCountryCode(address.country);
        if (!countryCode) {
          this.logger.warn('Failed to normalize country code', {
            dealId,
            country: address.country
          });
        }
      }

      // Search for existing customer by email
      const existingCustomers = await this.stripe.customers.list({
        email: email,
        limit: 1
      });

      let customer;
      if (existingCustomers.data.length > 0) {
        // Update existing customer with latest company details
        customer = existingCustomers.data[0];
        const updateParams = {
          name: name || customer.name,
          metadata: {
            ...customer.metadata,
            deal_id: String(dealId),
            updated_by: 'stripe_processor',
            mode: this.mode
          }
        };

        // Add address if provided (country must be ISO 2-letter code)
        if (address?.line1 && countryCode) {
          updateParams.address = {
            line1: address.line1,
            line2: address.line2 || undefined,
            postal_code: address.postalCode || undefined,
            city: address.city || undefined,
            state: address.state || undefined,
            country: countryCode
          };
        }

        // Add tax ID if provided (especially important for Polish companies)
        // Note: Tax ID is optional - Customer will be created even if Tax ID is invalid
        if (taxId) {
          updateParams.metadata.company_tax_id = taxId;
          
          // Try to add Tax ID, but don't fail if it's invalid
          try {
            // Format tax ID for Stripe: Polish NIP needs PL prefix for eu_vat type
            let formattedTaxId = taxId.trim();
            if (countryCode === 'PL' && !formattedTaxId.toUpperCase().startsWith('PL')) {
              formattedTaxId = `PL${formattedTaxId}`;
            }
            
            // Check if tax ID already exists
            const existingTaxIds = await this.stripe.customers.listTaxIds(customer.id, { limit: 10 });
            const hasTaxId = existingTaxIds.data.some(t => t.value === formattedTaxId || t.value === taxId);
            
            if (!hasTaxId) {
              // Determine tax ID type based on normalized country code
              // For Polish companies, use eu_vat (Stripe doesn't have pl_nip type)
              const taxIdType = countryCode === 'PL' ? 'eu_vat' : 'eu_vat';
              // Add tax ID to customer
              await this.stripe.customers.createTaxId(customer.id, {
                type: taxIdType,
                value: formattedTaxId
              });
              this.logger.info('Added tax ID to Stripe Customer', {
                customerId: customer.id,
                taxId: formattedTaxId,
                taxIdType,
                dealId
              });
            }
          } catch (taxError) {
            // Log but don't fail - tax ID might be invalid format (e.g., test NIP)
            // Customer will still be created/updated without Tax ID
            this.logger.warn('Failed to add tax ID to Stripe Customer (continuing without it)', {
              customerId: customer.id,
              taxId,
              error: taxError.message,
              dealId
            });
          }
        }

        // Ensure email is updated in customer
        if (email && customer.email !== email) {
          updateParams.email = email;
        }
        
        // Update customer (even if Tax ID failed)
        customer = await this.stripe.customers.update(customer.id, updateParams);
        this.logger.info('Updated existing Stripe Customer', {
          customerId: customer.id,
          email: customer.email || email,
          dealId
        });
      } else {
        // Create new customer
        const createParams = {
          email: email,
          name: name || 'Company',
          metadata: {
            deal_id: String(dealId),
            created_by: 'stripe_processor',
            mode: this.mode
          }
        };

        // Add address if provided (country must be ISO 2-letter code)
        if (address?.line1 && countryCode) {
          createParams.address = {
            line1: address.line1,
            line2: address.line2 || undefined,
            postal_code: address.postalCode || undefined,
            city: address.city || undefined,
            state: address.state || undefined,
            country: countryCode
          };
        }

        // Add tax ID to metadata
        if (taxId) {
          createParams.metadata.company_tax_id = taxId;
        }

        customer = await this.stripe.customers.create(createParams);
        this.logger.info('Created new Stripe Customer', {
          customerId: customer.id,
          email,
          dealId
        });

        // Add tax ID separately if provided (for Polish companies)
        if (taxId) {
          try {
            // Format tax ID for Stripe: Polish NIP needs PL prefix for eu_vat type
            let formattedTaxId = taxId.trim();
            if (countryCode === 'PL' && !formattedTaxId.toUpperCase().startsWith('PL')) {
              formattedTaxId = `PL${formattedTaxId}`;
            }
            
            // Determine tax ID type based on normalized country code
            // For Polish companies, use eu_vat (Stripe doesn't have pl_nip type)
            const taxIdType = countryCode === 'PL' ? 'eu_vat' : 'eu_vat';
            await this.stripe.customers.createTaxId(customer.id, {
              type: taxIdType,
              value: formattedTaxId
            });
            this.logger.info('Added tax ID to new Stripe Customer', {
              customerId: customer.id,
              taxId: formattedTaxId,
              taxIdType,
              dealId
            });
          } catch (taxError) {
            // Log but don't fail - tax ID might be invalid format
            this.logger.warn('Failed to add tax ID to Stripe Customer', {
              customerId: customer.id,
              taxId,
              error: taxError.message,
              dealId
            });
          }
        }
      }

      return customer.id;
    } catch (error) {
      this.logger.error('Failed to ensure Stripe Customer', {
        email,
        dealId,
        error: error.message
      });
      return null;
    }
  }

  shouldApplyVat({ customerType, companyCountry, sessionCountry }) {
    if (customerType === 'organization') {
      if (!companyCountry) return false;
      return companyCountry.toUpperCase() === 'PL';
    }

    // B2C — всегда рассчитываем VAT
    if (sessionCountry) return true;
    return true;
  }

  async ensureAddress({ dealId, shouldApplyVat, participant, crmContext }) {
    this.logger.info('Checking address for deal', {
      dealId,
      shouldApplyVat,
      hasParticipant: !!participant,
      hasCrmContext: !!crmContext
    });
    
    if (!shouldApplyVat) {
      this.logger.info('VAT not required, skipping address check', { dealId });
      return { valid: true };
    }

    const customerAddress = participant?.address || {};
    const crmAddressParts = crmContext?.addressParts || {};
    const companyAddress = this.formatAddress(crmAddressParts);

    const hasStripeAddress = Boolean(
      customerAddress?.line1 &&
      customerAddress?.postalCode &&
      (customerAddress?.city || customerAddress?.state) &&
      customerAddress?.country
    );

    const hasCrmAddress = Boolean(
      crmAddressParts.line1 &&
      crmAddressParts.postalCode &&
      (crmAddressParts.city || crmAddressParts.state) &&
      crmAddressParts.country
    );

    this.logger.info('Address validation result', {
      dealId,
      hasStripeAddress,
      hasCrmAddress,
      hasCompanyAddress: !!companyAddress,
      customerAddress: customerAddress ? {
        line1: customerAddress.line1,
        postalCode: customerAddress.postalCode,
        city: customerAddress.city,
        country: customerAddress.country
      } : null,
      crmAddressParts: crmAddressParts ? {
        line1: crmAddressParts.line1,
        postalCode: crmAddressParts.postalCode,
        city: crmAddressParts.city,
        country: crmAddressParts.country
      } : null
    });

    if (hasStripeAddress || hasCrmAddress || companyAddress) {
      return { valid: true };
    }

    if (dealId && !this.addressTaskCache.has(dealId)) {
      this.logger.info('Creating address task for deal', { dealId });
      await this.createAddressTask(dealId);
      this.addressTaskCache.add(dealId);
    } else if (dealId && this.addressTaskCache.has(dealId)) {
      this.logger.info('Address task already created for deal (cached)', { dealId });
    }

    return {
      valid: false,
      reason: 'missing_address'
    };
  }

  async createAddressTask(dealId) {
    if (!dealId) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await this.pipedriveClient.createTask({
        deal_id: dealId,
        subject: 'Stripe: заполнить адрес для расчёта VAT',
        due_date: today,
        type: 'task',
        note: 'Страйп-процессор не нашёл адрес клиента. Заполните адрес (страна, город, индекс) и пересоздайте оплату/инвойс.'
      });
      this.logger.info('Created CRM task for missing address', { dealId });
    } catch (error) {
      this.logger.error('Failed to create CRM task for missing address', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Close address tasks for a deal after payment is received
   * @param {number} dealId - Deal ID
   */
  async closeAddressTasks(dealId) {
    if (!dealId) return;
    
    try {
      // Get all tasks for the deal
      const tasksResult = await this.pipedriveClient.getDealActivities(dealId, 'task');
      if (!tasksResult.success || !tasksResult.activities) {
        return;
      }

      // Find address tasks by subject
      const addressTasks = tasksResult.activities.filter(task => 
        task.subject && task.subject.includes('Stripe: заполнить адрес для расчёта VAT')
      );

      if (addressTasks.length === 0) {
        this.logger.debug('No address tasks found to close', { dealId });
        return;
      }

      // Close each address task
      for (const task of addressTasks) {
        try {
          // Mark task as done by setting done_date
          await this.pipedriveClient.updateActivity(task.id, {
            done: 1,
            done_date: new Date().toISOString().split('T')[0]
          });
          this.logger.info('Closed address task after payment', {
            dealId,
            taskId: task.id,
            taskSubject: task.subject
          });
        } catch (error) {
          this.logger.warn('Failed to close address task', {
            dealId,
            taskId: task.id,
            error: error.message
          });
        }
      }

      // Remove from cache
      this.addressTaskCache.delete(dealId);
    } catch (error) {
      this.logger.error('Failed to close address tasks', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Create a task in CRM when webhook likely failed to process a payment
   * @param {number} dealId - Deal ID
   * @param {string} sessionId - Stripe session ID
   */
  async createWebhookFailureTask(dealId, sessionId) {
    if (!dealId || !sessionId) return;
    
    // Check if task already exists (avoid duplicates)
    if (this.addressTaskCache.has(`webhook-${dealId}-${sessionId}`)) {
      return;
    }
    
    try {
      const stripeMode = this.mode || 'test';
      const dashboardBase = stripeMode === 'test' 
        ? 'https://dashboard.stripe.com/test'
        : 'https://dashboard.stripe.com';
      const sessionLink = `${dashboardBase}/checkout_sessions/${sessionId}`;

      const today = new Date().toISOString().slice(0, 10);
      await this.pipedriveClient.createTask({
        deal_id: dealId,
        subject: '⚠️ Проверить обработку Stripe платежа',
        due_date: today,
        type: 'task',
        note: `Платеж был успешно оплачен в Stripe, но не был обработан через webhook.\n\n` +
              `Session ID: ${sessionId}\n` +
              `Ссылка на Stripe: ${sessionLink}\n\n` +
              `Пожалуйста, проверьте:\n` +
              `1. Статус платежа в Stripe Dashboard\n` +
              `2. Настройки webhook в Stripe\n` +
              `3. Логи сервиса на наличие ошибок\n` +
              `4. Что платеж отображается в отчетах\n\n` +
              `Платеж будет обработан автоматически при следующей периодической проверке.`
      });
      
      this.addressTaskCache.add(`webhook-${dealId}-${sessionId}`);
      this.logger.info('Created CRM task for webhook failure', { dealId, sessionId });
    } catch (error) {
      this.logger.error('Failed to create CRM task for webhook failure', {
        dealId,
        sessionId,
        error: error.message
      });
    }
  }

  /**
   * Process CRM triggers: find deals with invoice_type = "75" (Stripe) and create Checkout Sessions.
   */
  async processCheckoutTriggers(context = {}) {
    const { trigger, runId, dealId } = context;
    const summary = {
      totalDeals: 0,
      sessionsCreated: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Query Pipedrive for deals with Stripe trigger
      const dealsResult = await this.pipedriveClient.getDeals({
        limit: 500,
        start: 0,
        status: 'open'
      });

      if (!dealsResult.success) {
        this.logger.error('Failed to fetch deals for Stripe trigger', {
          error: dealsResult.error
        });
        return summary;
      }

      // Filter deals by invoice_type = "75" (Stripe trigger)
      const stripeDeals = dealsResult.deals.filter((deal) => {
        const invoiceTypeValue = deal[this.invoiceTypeFieldKey];
        if (!invoiceTypeValue) return false;
        const normalizedValue = String(invoiceTypeValue).trim();
        return normalizedValue === this.stripeTriggerValue;
      });

      // If dealId filter is set, only process that specific deal
      const dealsToProcess = dealId
        ? stripeDeals.filter((d) => String(d.id) === String(dealId))
        : stripeDeals;

      summary.totalDeals = dealsToProcess.length;

      this.logger.info('Found deals with Stripe trigger', {
        total: stripeDeals.length,
        toProcess: dealsToProcess.length,
        dealIdFilter: dealId || null
      });

      // Process each deal
      for (const deal of dealsToProcess) {
        try {
          // Check if Checkout Sessions already exist for this deal to avoid duplicates
          const existingPayments = await this.repository.listPayments({
            dealId: String(deal.id),
            limit: 10
          });
          
          // Determine payment schedule based on close_date (expected_close_date)
          const closeDate = deal.expected_close_date || deal.close_date;
          let use50_50Schedule = false;
          
          this.logger.info('Determining payment schedule', {
            dealId: deal.id,
            expected_close_date: deal.expected_close_date,
            close_date: deal.close_date,
            closeDate
          });
          
          if (closeDate) {
            try {
              const expectedCloseDate = new Date(closeDate);
              const today = new Date();
              const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
              
              // If >= 30 days, use 50/50 schedule (two payments)
              if (daysDiff >= 30) {
                use50_50Schedule = true;
                this.logger.info('Using 50/50 payment schedule for deal', {
                  dealId: deal.id,
                  daysDiff,
                  closeDate
                });
              } else {
                this.logger.info('Using 100% payment schedule for deal', {
                  dealId: deal.id,
                  daysDiff,
                  closeDate
                });
              }
            } catch (error) {
              this.logger.warn('Failed to calculate payment schedule', {
                dealId: deal.id,
                closeDate,
                error: error.message
              });
            }
          } else {
            this.logger.warn('No close_date found, defaulting to 100% payment schedule', {
              dealId: deal.id
            });
          }

          // Check if sessions already exist for this deal
          let hasDeposit = false;
          let hasRest = false;
          let hasSinglePayment = false;
          
          if (existingPayments && existingPayments.length > 0) {
            // For 50/50 schedule, check if both deposit and rest exist
            if (use50_50Schedule) {
              hasDeposit = existingPayments.some(p => 
                p.payment_type === 'deposit' || p.payment_type === 'first'
              );
              hasRest = existingPayments.some(p => 
                p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
              );
              
              // If both sessions exist, skip creation
              if (hasDeposit && hasRest) {
                this.logger.info('Deal already has both deposit and rest Checkout Sessions, skipping creation', {
                  dealId: deal.id,
                  existingCount: existingPayments.length
                });
                summary.skipped++;
                continue;
              }
              
              // If only one exists, we'll create the missing one below
              this.logger.info('Deal has partial 50/50 sessions, will create missing ones', {
                dealId: deal.id,
                hasDeposit,
                hasRest,
                existingCount: existingPayments.length
              });
            } else {
              // For 100% schedule, check if any session exists (single payment)
              hasSinglePayment = existingPayments.some(p => 
                p.payment_type === 'single' || p.payment_type === 'payment' || !p.payment_type
              );
              
              // If session exists, skip creation
              if (hasSinglePayment) {
                this.logger.info('Deal already has Checkout Session, skipping creation', {
                  dealId: deal.id,
                  existingCount: existingPayments.length
                });
                summary.skipped++;
                continue;
              }
            }
          }

          if (use50_50Schedule) {
            
            const sessionsToNotify = [];
            
            // Create deposit if it doesn't exist
            if (!hasDeposit) {
              const depositResult = await this.createCheckoutSessionForDeal(deal, {
                trigger,
                runId,
                paymentType: 'deposit',
                paymentSchedule: '50/50',
                paymentIndex: 1,
                skipNotification: true // Skip notification, will send after both sessions created
              });
              
              if (depositResult.success) {
                summary.sessionsCreated++;
                this.logger.info('Created deposit Checkout Session', {
                  dealId: deal.id,
                  sessionId: depositResult.sessionId,
                  sessionUrl: depositResult.sessionUrl
                });
                sessionsToNotify.push({
                  id: depositResult.sessionId,
                  url: depositResult.sessionUrl,
                  type: 'deposit',
                  amount: depositResult.amount
                });
              } else {
                summary.errors.push({
                  dealId: deal.id,
                  reason: `deposit: ${depositResult.error || 'unknown'}`
                });
              }
            } else {
              // Find existing deposit session for notification
              const existingDeposit = existingPayments.find(p => 
                p.payment_type === 'deposit' || p.payment_type === 'first'
              );
              if (existingDeposit) {
                sessionsToNotify.push({
                  id: existingDeposit.session_id,
                  url: `https://dashboard.stripe.com/${this.mode === 'test' ? 'test/' : ''}checkout/sessions/${existingDeposit.session_id}`,
                  type: 'deposit',
                  amount: existingDeposit.original_amount
                });
              }
            }

            // Create rest if it doesn't exist
            if (!hasRest) {
              const restResult = await this.createCheckoutSessionForDeal(deal, {
                trigger,
                runId,
                paymentType: 'rest',
                paymentSchedule: '50/50',
                paymentIndex: 2,
                skipNotification: true // Skip notification, will send after both sessions created
              });
              
              if (restResult.success) {
                summary.sessionsCreated++;
                this.logger.info('Created rest Checkout Session', {
                  dealId: deal.id,
                  sessionId: restResult.sessionId,
                  sessionUrl: restResult.sessionUrl
                });
                sessionsToNotify.push({
                  id: restResult.sessionId,
                  url: restResult.sessionUrl,
                  type: 'rest',
                  amount: restResult.amount
                });
              } else {
                summary.errors.push({
                  dealId: deal.id,
                  reason: `rest: ${restResult.error || 'unknown'}`
                });
              }
            } else {
              // Find existing rest session for notification
              const existingRest = existingPayments.find(p => 
                p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
              );
              if (existingRest) {
                sessionsToNotify.push({
                  id: existingRest.session_id,
                  url: `https://dashboard.stripe.com/${this.mode === 'test' ? 'test/' : ''}checkout/sessions/${existingRest.session_id}`,
                  type: 'rest',
                  amount: existingRest.original_amount
                });
              }
            }

            // Send notification if we have at least one session
            if (sessionsToNotify.length > 0) {
              const firstSession = sessionsToNotify[0];
              await this.sendPaymentNotificationForDeal(deal.id, {
                paymentSchedule: '50/50',
                sessions: sessionsToNotify,
                currency: firstSession.currency || 'PLN',
                totalAmount: sessionsToNotify.reduce((sum, s) => sum + (s.amount || 0), 0) * 2 // Total is sum of both payments
              });
            }
          } else {
            // Create single payment (100%)
            const result = await this.createCheckoutSessionForDeal(deal, {
              trigger,
              runId,
              paymentType: 'single',
              paymentSchedule: '100%'
            });
            
            if (result.success) {
              summary.sessionsCreated++;
              this.logger.info('Created single Checkout Session', {
                dealId: deal.id,
                sessionId: result.sessionId,
                sessionUrl: result.sessionUrl
              });
            } else {
              summary.skipped++;
              summary.errors.push({
                dealId: deal.id,
                reason: result.error || 'unknown'
              });
            }
          }
        } catch (error) {
          summary.errors.push({
            dealId: deal.id,
            reason: error.message
          });
          this.logger.error('Failed to create Checkout Session for deal', {
            dealId: deal.id,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.logger.error('Error in processCheckoutTriggers', {
        error: error.message,
        stack: error.stack
      });
      summary.errors.push({
        reason: error.message
      });
    }

    return summary;
  }

  /**
   * Create Stripe Checkout Session for a single deal.
   */
  async createCheckoutSessionForDeal(deal, context = {}) {
    let { trigger, runId, paymentType, customAmount, paymentSchedule, paymentIndex, skipNotification } = context;
    const dealId = deal.id;

    try {
      // 1. Fetch full deal data with related entities
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!fullDealResult.success || !fullDealResult.deal) {
        return {
          success: false,
          error: `Failed to fetch deal: ${fullDealResult.error || 'unknown'}`
        };
      }

      const fullDeal = fullDealResult.deal;
      
      // Мержим ВСЕ данные из переданного deal (из webhook'а) в fullDeal
      // Это гарантирует, что все поля из webhook будут доступны для обработки
      if (deal && deal !== fullDeal) {
        Object.assign(fullDeal, deal);
      }
      
      // Определяем график платежей, если не передан в context
      if (!paymentSchedule) {
        const closeDate = fullDeal.expected_close_date || fullDeal.close_date;
        if (closeDate) {
          try {
            const expectedCloseDate = new Date(closeDate);
            const today = new Date();
            const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysDiff >= 30) {
              paymentSchedule = '50/50';
              this.logger.info('Auto-determined 50/50 payment schedule', {
                dealId,
                daysDiff,
                closeDate
              });
            } else {
              paymentSchedule = '100%';
              this.logger.info('Auto-determined 100% payment schedule', {
                dealId,
                daysDiff,
                closeDate
              });
            }
          } catch (error) {
            this.logger.warn('Failed to determine payment schedule, defaulting to 100%', {
              dealId,
              closeDate,
              error: error.message
            });
            paymentSchedule = '100%';
          }
        } else {
          this.logger.warn('No close_date found, defaulting to 100% payment schedule', {
            dealId
          });
          paymentSchedule = '100%';
        }
      }
      
      const person = fullDealResult.person;
      const organization = fullDealResult.organization;

      // 2. Get deal products
      const dealProductsResult = await this.pipedriveClient.getDealProducts(dealId);
      if (!dealProductsResult.success || !dealProductsResult.products || dealProductsResult.products.length === 0) {
        return {
          success: false,
          error: 'No products found in deal'
        };
      }

      // 3. Calculate amount and currency from first product
      const firstProduct = dealProductsResult.products[0];
      const quantity = parseFloat(firstProduct.quantity) || 1;
      const itemPrice = typeof firstProduct.item_price === 'number'
        ? firstProduct.item_price
        : parseFloat(firstProduct.item_price) || 0;
      const sumPrice = typeof firstProduct.sum === 'number'
        ? firstProduct.sum
        : parseFloat(firstProduct.sum) || 0;
      let productPrice = itemPrice || sumPrice || parseFloat(fullDeal.value) || 0;
      
      // Override amount if customAmount is provided (for second payment)
      if (customAmount && customAmount > 0) {
        productPrice = customAmount;
      } else if (paymentSchedule === '50/50') {
        // For 50/50 schedule, split amount in half
        productPrice = productPrice / 2;
        this.logger.info('Split payment amount for 50/50 schedule', {
          dealId,
          originalAmount: itemPrice || sumPrice || parseFloat(fullDeal.value) || 0,
          splitAmount: productPrice,
          paymentType,
          paymentIndex
        });
      }
      
      const currency = normaliseCurrency(fullDeal.currency || 'PLN');
      const productName = firstProduct.name || firstProduct.product?.name || fullDeal.title || 'Camp / Tourist service';

      if (productPrice <= 0) {
        return {
          success: false,
          error: 'Product price is zero or invalid'
        };
      }

      // 4. Get CRM context for B2B/VAT logic
      const crmContext = await this.getCrmContext(dealId);
      const customerType = crmContext?.isB2B ? 'organization' : 'person';
      const customerEmail = person?.email?.[0]?.value || person?.email || organization?.email?.[0]?.value || organization?.email || null;
      const customerName = crmContext?.isB2B
        ? (crmContext.companyName || organization?.name || 'Company')
        : (person?.name || 'Customer');

      if (!customerEmail) {
        return {
          success: false,
          error: 'No email found for customer'
        };
      }

      // 5. Determine VAT applicability
      const addressParts = this.extractAddressParts(crmContext);
      const countryCode = this.extractCountryCode(addressParts);
      const shouldApplyVat = this.shouldApplyVat({
        customerType,
        companyCountry: countryCode,
        sessionCountry: countryCode
      });

      // 6. Validate address if VAT is required
      const addressValidation = await this.ensureAddress({
        dealId,
        shouldApplyVat,
        participant: { address: addressParts },
        crmContext
      });

      if (!addressValidation.valid && shouldApplyVat) {
        return {
          success: false,
          error: `Address validation failed: ${addressValidation.reason || 'missing_address'}`
        };
      }

      // 7. Get or create product link
      const crmProductId = firstProduct.product_id || firstProduct.product?.id || null;
      let productLink = null;
      if (crmProductId) {
        productLink = await this.repository.findProductLinkByCrmId(String(crmProductId));
      }

      let stripeProductId = null;
      if (productLink?.stripe_product_id) {
        // Verify product exists in current Stripe account/mode
        try {
          await this.stripe.products.retrieve(productLink.stripe_product_id);
          stripeProductId = productLink.stripe_product_id;
        } catch (error) {
          // Product doesn't exist in current account/mode, search for it
          this.logger.warn('Stripe product from link not found, searching by CRM ID', {
            oldProductId: productLink.stripe_product_id,
            error: error.message
          });
          productLink = null; // Reset to search/create
        }
      }

      // If no product found via link, search by CRM product ID in metadata
      if (!stripeProductId && crmProductId) {
        try {
          const products = await this.stripe.products.list({
            limit: 100,
            expand: ['data']
          });
          const matchingProduct = products.data.find((p) => {
            return p.metadata?.crm_product_id === String(crmProductId) &&
                   p.metadata?.mode === this.mode;
          });
          if (matchingProduct) {
            stripeProductId = matchingProduct.id;
            this.logger.info('Found existing Stripe product by CRM ID', {
              crmProductId,
              stripeProductId,
              productName: matchingProduct.name
            });
            // Update product link if it exists but had wrong ID
            if (productLink) {
              await this.repository.upsertProductLink({
                crmProductId: String(crmProductId),
                crmProductName: productName,
                stripeProductId,
                campProductId: null,
                status: 'active'
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to search for existing product', {
            crmProductId,
            error: error.message
          });
        }
      }

      // Create new product only if not found
      if (!stripeProductId) {
        this.logger.info('Creating new Stripe product', {
          productName,
          crmProductId: crmProductId || 'none'
        });
        const stripeProduct = await this.stripe.products.create({
          name: productName,
          description: `Camp product: ${productName}`,
          metadata: {
            crm_product_id: crmProductId ? String(crmProductId) : null,
            deal_id: String(dealId),
            created_by: 'stripe_processor',
            mode: this.mode
          }
        });
        stripeProductId = stripeProduct.id;

        // Save product link
        if (crmProductId) {
          await this.repository.upsertProductLink({
            crmProductId: String(crmProductId),
            crmProductName: productName,
            stripeProductId,
            campProductId: null,
            status: 'active'
          });
        }
      }

      // Get product link ID for metadata (always, not just when creating new product)
      let productLinkId = null;
      if (crmProductId) {
        const existingLink = await this.repository.findProductLinkByCrmId(String(crmProductId));
        if (existingLink?.id) {
          productLinkId = existingLink.id;
        }
      }

      // 8. Create or get Stripe Customer for B2B companies (to ensure company details appear in invoice)
      let stripeCustomerId = null;
      if (crmContext?.isB2B) {
        stripeCustomerId = await this.ensureStripeCustomer({
          email: customerEmail,
          name: crmContext.companyName || organization?.name || 'Company',
          taxId: crmContext.companyTaxId,
          address: addressParts,
          dealId
        });
      }

      // 9. Prepare Checkout Session parameters
      const amountInMinorUnits = toMinorUnit(productPrice, currency);
      
      // Prepare line item with optional tax rate for Poland
      const lineItem = {
        price_data: {
          currency: currency.toLowerCase(),
          product: stripeProductId,
          unit_amount: amountInMinorUnits
        },
        quantity: quantity
      };

      // Add tax rate for Poland (23% VAT) if VAT should be applied
      let polandTaxRateId = null;
      if (shouldApplyVat && countryCode === 'PL') {
        try {
          polandTaxRateId = await this.ensurePolandTaxRate();
          lineItem.tax_rates = [polandTaxRateId];
          this.logger.info('Added Poland VAT Tax Rate to line item', {
            dealId,
            taxRateId: polandTaxRateId,
            percentage: 23
          });
        } catch (error) {
          this.logger.warn('Failed to add Tax Rate, falling back to automatic_tax', {
            dealId,
            error: error.message
          });
        }
      }

      const sessionParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [lineItem],
        metadata: {
          deal_id: String(dealId),
          product_id: crmProductId ? String(crmProductId) : null,
          product_link_id: productLinkId ? String(productLinkId) : null,
          payment_id: `deal_${dealId}_${Date.now()}`,
          payment_type: paymentType || 'deposit', // Use provided paymentType or default to 'deposit'
          payment_schedule: paymentSchedule || '100%', // '50/50' or '100%'
          payment_part: paymentSchedule === '50/50' ? (paymentType === 'deposit' ? '1 of 2' : '2 of 2') : '1 of 1',
          created_by: 'stripe_processor',
          trigger,
          run_id: runId || null
        },
        success_url: this.buildCheckoutUrl(this.checkoutSuccessUrl, dealId, 'success'),
        cancel_url: this.buildCheckoutUrl(this.checkoutCancelUrl || this.checkoutSuccessUrl, dealId, 'cancel')
      };

      // 10. Set customer (B2B) or customer_email (B2C)
      if (stripeCustomerId) {
        // B2B: Use Customer object to ensure company details appear in invoice
        sessionParams.customer = stripeCustomerId;
        // Enable invoice creation ONLY for B2B companies
        // Add payment part information for partial payments (50/50)
        // Use product name instead of deal ID in description
        let invoiceDescription = productName || 'Camp / Tourist service';
        if (paymentSchedule === '50/50') {
          if (paymentType === 'deposit') {
            invoiceDescription = `${productName || 'Camp / Tourist service'} - Part 1 of 2 (Deposit 50%)`;
          } else if (paymentType === 'rest') {
            invoiceDescription = `${productName || 'Camp / Tourist service'} - Part 2 of 2 (Final payment 50%)`;
          }
        }
        
        sessionParams.invoice_creation = {
          enabled: true,
          invoice_data: {
            description: invoiceDescription
          }
        };
        // Allow Stripe to update customer name/address if needed (required for tax_id_collection)
        sessionParams.customer_update = {
          name: 'auto',
          address: 'auto'
        };
        // Add company details to metadata
        if (crmContext.companyName) {
          sessionParams.metadata.company_name = crmContext.companyName;
        }
        if (crmContext.companyTaxId) {
          sessionParams.metadata.company_tax_id = crmContext.companyTaxId;
        }
        if (crmContext.companyAddress) {
          sessionParams.metadata.company_address = crmContext.companyAddress;
        }
      } else {
        // B2C: Use customer_email (no invoice creation - receipt is enough)
        sessionParams.customer_email = customerEmail;
        // B2C doesn't need invoice_creation - Stripe will send receipt automatically
        // receipt_email is set via customer_email, Stripe will send receipt automatically
      }

      // 11. Configure VAT using fixed 23% Tax Rate for Poland (NOT automatic_tax)
      // Tax Rate is already added to line_item above if shouldApplyVat && countryCode === 'PL'
      // For B2B companies, enable tax_id_collection
      if (shouldApplyVat && countryCode === 'PL') {
        if (stripeCustomerId) {
          // B2B: Enable tax_id_collection for company tax ID
          sessionParams.tax_id_collection = {
            enabled: true
          };
        }
        // Add metadata about VAT collection
        sessionParams.payment_intent_data = {
          metadata: {
            ...sessionParams.metadata,
            vat_collect_only: 'true',
            vat_rate: '23%'
          }
        };
      }

      // 12. Create Checkout Session in Stripe
      const session = await this.stripe.checkout.sessions.create(sessionParams);

      // 13. Create tasks in CRM after successful session creation (if address is missing)
      // Задачи создаются только если адрес не найден и нужен VAT
      if (!addressValidation.valid && shouldApplyVat) {
        // ensureAddress уже создал задачу, но проверяем еще раз для надежности
        if (dealId && !this.addressTaskCache.has(dealId)) {
          await this.createAddressTask(dealId);
          this.addressTaskCache.add(dealId);
        }
      }

      // 14. Update deal invoice_type to "Stripe" (75) in CRM after creating Checkout Session
      // "Done" (73) will be set only after successful payment via webhook
      try {
        await this.pipedriveClient.updateDeal(dealId, {
          [this.invoiceTypeFieldKey]: this.stripeTriggerValue
        });
        this.logger.info('Updated deal invoice_type to Stripe', { dealId });
      } catch (updateError) {
        this.logger.warn('Failed to update deal invoice_type to Stripe', {
          dealId,
          error: updateError.message
        });
      }

      // 15. Send SendPulse notification with payment schedule and links (unless skipped)
      if (!skipNotification) {
        this.logger.info(`📧 Отправка уведомления о создании Checkout Session | Deal ID: ${dealId} | Session ID: ${session.id}`, {
          dealId,
          sessionId: session.id,
          paymentSchedule: paymentSchedule || '100%',
          skipNotification: false
        });
        
        const notificationResult = await this.sendPaymentNotificationForDeal(dealId, {
          paymentSchedule: paymentSchedule || '100%',
          sessions: [{ id: session.id, url: session.url, type: paymentType || 'single', amount: productPrice }],
          currency,
          totalAmount: itemPrice || sumPrice || parseFloat(fullDeal.value) || 0
        });
        
        if (notificationResult.success) {
          this.logger.info(`✅ Уведомление о платеже отправлено | Deal ID: ${dealId} | Session ID: ${session.id}`, {
            dealId,
            sessionId: session.id
          });
        } else {
          this.logger.warn(`⚠️  Не удалось отправить уведомление о платеже | Deal ID: ${dealId} | Session ID: ${session.id} | Ошибка: ${notificationResult.error}`, {
            dealId,
            sessionId: session.id,
            error: notificationResult.error
          });
        }
      } else {
        this.logger.info(`ℹ️  Уведомление пропущено (skipNotification=true) | Deal ID: ${dealId} | Session ID: ${session.id}`, {
          dealId,
          sessionId: session.id
        });
      }

      // 14. Log session creation
      this.logger.info('Stripe Checkout Session created', {
        dealId,
        sessionId: session.id,
        sessionUrl: session.url,
        amount: productPrice,
        currency,
        customerEmail,
        customerType,
        shouldApplyVat
      });

      // Output session URL to console for easy access
      // eslint-disable-next-line no-console
      console.log('\n✅ Stripe Checkout Session created successfully!');
      // eslint-disable-next-line no-console
      console.log(`📋 Session ID: ${session.id}`);
      // eslint-disable-next-line no-console
      console.log(`🔗 Payment URL: ${session.url}`);
      // eslint-disable-next-line no-console
      console.log(`💰 Amount: ${productPrice} ${currency}`);
      // eslint-disable-next-line no-console
      console.log(`📧 Customer: ${customerEmail}`);
      // eslint-disable-next-line no-console
      console.log(`\n💡 To complete the payment, open the URL above in your browser.\n`);

      return {
        success: true,
        sessionId: session.id,
        sessionUrl: session.url,
        amount: productPrice,
        currency,
        totalAmount: itemPrice || sumPrice || parseFloat(fullDeal.value) || 0
      };
    } catch (error) {
      logStripeError(error, {
        scope: 'createCheckoutSessionForDeal',
        dealId
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processRefunds(filters = {}, summary = {}, dealIdFilter = null) {
    if (!this.repository.isEnabled()) return;

    const refunds = [];
    await iterateRefunds({
      filters,
      onPage: async (items) => {
        refunds.push(...items);
      }
    });

    if (refunds.length === 0) return;

    for (const refund of refunds) {
      if (dealIdFilter && String(refund?.metadata?.deal_id || '') !== dealIdFilter) {
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.persistRefund(refund);
        summary.total = (summary.total || 0) + 1;
        const values = await this.convertRefundAmounts(refund);
        summary.amount = (summary.amount || 0) + values.amount;
        summary.amountPln = (summary.amountPln || 0) + values.amountPln;
        await this.paymentPlanService.applyRefund(refund, values);
        await this.crmSyncService.handleRefund(refund);
      } catch (error) {
        logStripeError(error, { scope: 'persistRefund', refundId: refund.id });
      }
    }
  }

  async convertRefundAmounts(refund) {
    const currency = normaliseCurrency(refund.currency);
    const amount = fromMinorUnit(refund.amount || 0, currency);
    const conversion = await this.convertAmountWithRate(amount, currency);
    const amountPln = conversion.amountPln;
    return {
      amount: roundBankers(-Math.abs(amount)),
      amountPln: roundBankers(-Math.abs(amountPln))
    };
  }

  async persistRefund(refund) {
    const currency = normaliseCurrency(refund.currency);
    const amounts = await this.convertRefundAmounts(refund);
    const payload = {
      payment_id: refund.payment_intent || refund.charge || refund.id,
      reason: 'stripe_refund',
      amount: amounts.amount,
      currency,
      amount_pln: amounts.amountPln,
      logged_at: new Date((refund.created || 0) * 1000).toISOString(),
      metadata: refund.metadata || {},
      raw_payload: refund
    };
    await this.repository.logDeletion(payload);
  }

  /**
   * Process refunds for deals with status "lost"
   * This method finds all Stripe payments for a deal and creates refunds in Stripe
   * @param {Object} context - Processing context
   * @param {string} context.trigger - Trigger source (scheduler, manual, etc.)
   * @param {string} context.runId - Run ID for logging
   * @returns {Promise<Object>} Summary of refund processing
   */
  async processLostDealRefunds(context = {}) {
    const { trigger = 'manual', runId = null } = context;
    
    this.logger.info('Processing refunds for lost deals', {
      trigger,
      runId,
      mode: this.mode
    });

    if (!this.repository.isEnabled()) {
      this.logger.warn('StripeRepository disabled. Skipping lost deal refunds.');
      return {
        success: true,
        summary: {
          totalDeals: 0,
          refundsCreated: 0,
          errors: []
        },
        skipped: true,
        reason: 'repository_disabled'
      };
    }

    const summary = {
      totalDeals: 0,
      refundsCreated: 0,
      errors: []
    };

    try {
      // Get all deals with status "lost" from Pipedrive
      const dealsResult = await this.pipedriveClient.getDeals({
        limit: 500,
        start: 0,
        status: 'lost'
      });

      if (!dealsResult.success || !dealsResult.deals || dealsResult.deals.length === 0) {
        this.logger.info('No lost deals found');
        return {
          success: true,
          summary
        };
      }

      summary.totalDeals = dealsResult.deals.length;

      // Process each lost deal
      for (const deal of dealsResult.deals) {
        try {
          // Check lost_reason - only process if reason is "Refund"
          // Get full deal data to check lost_reason (may not be in list response)
          let lostReason = deal.lost_reason || deal.lostReason || deal['lost_reason'];
          
          // If lost_reason not in list response, fetch full deal
          if (!lostReason) {
            try {
              const fullDealResult = await this.pipedriveClient.getDeal(deal.id);
              if (fullDealResult.success && fullDealResult.deal) {
                lostReason = fullDealResult.deal.lost_reason || fullDealResult.deal.lostReason || fullDealResult.deal['lost_reason'];
              }
            } catch (error) {
              this.logger.warn('Failed to fetch full deal data for lost_reason check', {
                dealId: deal.id,
                error: error.message
              });
            }
          }

          const normalizedLostReason = lostReason ? String(lostReason).trim().toLowerCase() : '';
          // Accept both "refund" and "refound" (common typo)
          const isRefundReason = normalizedLostReason === 'refund' || normalizedLostReason === 'refound';

          if (!isRefundReason) {
            this.logger.debug('Skipping lost deal - reason is not "Refund"', {
              dealId: deal.id,
              lostReason: normalizedLostReason
            });
            continue;
          }

          await this.refundDealPayments(deal.id, summary);
        } catch (error) {
          summary.errors.push({
            dealId: deal.id,
            reason: error.message
          });
          this.logger.error('Failed to refund payments for lost deal', {
            dealId: deal.id,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing lost deal refunds', {
        error: error.message,
        stack: error.stack
      });
      summary.errors.push({
        reason: error.message
      });
    }

    return {
      success: summary.errors.length === 0,
      summary
    };
  }

  /**
   * Refund all Stripe payments for a specific deal
   * @param {number} dealId - Deal ID
   * @param {Object} summary - Summary object to update
   * @returns {Promise<void>}
   */
  async refundDealPayments(dealId, summary = {}) {
    if (!dealId) {
      throw new Error('Deal ID is required');
    }

    // Find all Stripe payments for this deal
    const payments = await this.repository.listPayments({
      dealId: String(dealId),
      status: 'processed' // Only refund processed payments
    });

    if (!payments || payments.length === 0) {
      this.logger.info('No Stripe payments found for deal', { dealId });
      return;
    }

    this.logger.info('Found Stripe payments for lost deal', {
      dealId,
      paymentsCount: payments.length
    });

    // Track refunds for summary note
    const refundedPayments = [];

    // Process each payment
    for (const payment of payments) {
      try {
        // Check if refund already exists in database
        const existingRefunds = await this.repository.listDeletions({
          paymentId: payment.session_id
        });

        // Get Checkout Session from Stripe to get payment_intent
        let session;
        try {
          session = await this.stripe.checkout.sessions.retrieve(payment.session_id, {
            expand: ['payment_intent']
          });
        } catch (error) {
          this.logger.warn('Failed to retrieve Checkout Session', {
            dealId,
            sessionId: payment.session_id,
            error: error.message
          });
          continue;
        }

        // Get payment_intent from session
        const paymentIntentId = session.payment_intent;
        if (!paymentIntentId) {
          this.logger.warn('No payment_intent found in Checkout Session', {
            dealId,
            sessionId: payment.session_id
          });
          continue;
        }

        // Check if payment was actually paid
        if (session.payment_status !== 'paid') {
          this.logger.info('Payment not paid, skipping refund', {
            dealId,
            sessionId: payment.session_id,
            paymentStatus: session.payment_status
          });
          continue;
        }

        // Check if refund already exists in Stripe (even if not logged in DB)
        const piId = typeof paymentIntentId === 'string' ? paymentIntentId : paymentIntentId.id;
        const stripeRefunds = await this.stripe.refunds.list({
          payment_intent: piId,
          limit: 1
        });

        if (stripeRefunds.data && stripeRefunds.data.length > 0) {
          // Refund exists in Stripe - log it if not already logged
          const existingRefund = stripeRefunds.data[0];
          if (!existingRefunds || existingRefunds.length === 0) {
            this.logger.info('Refund exists in Stripe but not logged, logging it', {
              dealId,
              sessionId: payment.session_id,
              refundId: existingRefund.id
            });
            await this.logDeletionForLostDeal(payment, dealId, 'already_refunded', existingRefund);
          } else {
            this.logger.info('Refund already exists for payment', {
              dealId,
              sessionId: payment.session_id
            });
          }
          
          // Add to refundedPayments for note/task creation (even if already refunded)
          refundedPayments.push({
            payment,
            refund: existingRefund
          });
          
          // Check if tax correction task needed
          await this.checkAndCreateTaxCorrectionTask(payment, dealId, existingRefund);
          
          continue;
        }

        // No refund in Stripe and no refund in DB - need to create refund

        // Get customer email for refund notification
        let refundEmail = null;
        try {
          if (session.customer && typeof session.customer === 'string') {
            // B2B: Get email from Customer
            const customer = await this.stripe.customers.retrieve(session.customer);
            refundEmail = customer.email;
          } else {
            // B2C: Get email from session
            refundEmail = session.customer_email || payment.customer_email;
          }
        } catch (error) {
          this.logger.warn('Failed to get customer email for refund', {
            dealId,
            sessionId: payment.session_id,
            error: error.message
          });
        }

        // Create refund in Stripe
        let refund;
        try {
          refund = await this.stripe.refunds.create({
            payment_intent: typeof paymentIntentId === 'string' ? paymentIntentId : paymentIntentId.id,
            reason: 'requested_by_customer',
            metadata: {
              deal_id: String(dealId),
              session_id: payment.session_id,
              refund_reason: 'deal_lost',
              refund_note: 'Клиент не едет на кэмп'
            },
            // Enable refund receipt email
            refund_application_fee: false,
            reverse_transfer: false
          });
          
          // Stripe automatically sends refund receipt emails to the original payment's receipt_email
          // But we need to ensure the email is set on the original charge
          if (refundEmail) {
            try {
              // Get the original charge to ensure receipt_email is set
              const paymentIntent = await this.stripe.paymentIntents.retrieve(piId, {
                expand: ['charges.data']
              });
              
              if (paymentIntent.charges?.data?.length > 0) {
                const charge = paymentIntent.charges.data[0];
                // If charge doesn't have receipt_email, set it so refund receipt will be sent
                if (!charge.receipt_email) {
                  await this.stripe.charges.update(charge.id, {
                    receipt_email: refundEmail
                  });
                  this.logger.info('Set receipt_email on charge for refund notification', {
                    chargeId: charge.id,
                    email: refundEmail,
                    dealId
                  });
                }
              }
              
              this.logger.info('Refund receipt email will be sent automatically by Stripe', {
                refundId: refund.id,
                email: refundEmail,
                dealId
              });
            } catch (emailError) {
              this.logger.warn('Failed to set receipt_email for refund notification', {
                refundId: refund.id,
                email: refundEmail,
                error: emailError.message
              });
            }
          }

          this.logger.info('Created refund in Stripe', {
            dealId,
            sessionId: payment.session_id,
            refundId: refund.id,
            amount: refund.amount,
            currency: refund.currency
          });
        } catch (error) {
          // Check if refund already exists
          if (error.code === 'charge_already_refunded') {
            this.logger.info('Payment already refunded', {
              dealId,
              sessionId: payment.session_id
            });
            // Still log the deletion for reporting
            await this.logDeletionForLostDeal(payment, dealId, 'already_refunded');
            continue;
          }
          throw error;
        }

        // Log deletion with refund information
        await this.logDeletionForLostDeal(payment, dealId, 'refunded', refund);

        // Check if refund is in different month than payment - create tax correction task
        await this.checkAndCreateTaxCorrectionTask(payment, dealId, refund);

        // Track refunded payment for note
        refundedPayments.push({
          payment,
          refund
        });

        summary.refundsCreated = (summary.refundsCreated || 0) + 1;
      } catch (error) {
        this.logger.error('Failed to refund payment', {
          dealId,
          sessionId: payment.session_id,
          error: error.message
        });
        if (summary.errors) {
          summary.errors.push({
            dealId,
            sessionId: payment.session_id,
            reason: error.message
          });
        }
      }
    }

    // Add note to deal about refunds (if any were processed)
    if (refundedPayments.length > 0) {
      try {
        await this.addRefundNoteToDeal(dealId, refundedPayments);
      } catch (error) {
        this.logger.warn('Failed to add refund note to deal', {
          dealId,
          error: error.message
        });
      }

      // Send SendPulse notification about refund
      try {
        await this.sendRefundNotificationForDeal(dealId, refundedPayments);
      } catch (error) {
        this.logger.warn('Failed to send refund notification', {
          dealId,
          error: error.message
        });
      }
    }
  }

  /**
   * Log deletion for a lost deal payment
   * @param {Object} payment - Payment record from database
   * @param {number} dealId - Deal ID
   * @param {string} status - Refund status (refunded, already_refunded)
   * @param {Object} refund - Stripe refund object (optional)
   * @returns {Promise<void>}
   */
  async logDeletionForLostDeal(payment, dealId, status, refund = null) {
    const currency = normaliseCurrency(payment.currency || 'PLN');
    const amount = payment.original_amount || 0;
    const amountPln = payment.amount_pln || 0;

    // Convert amounts to negative for refund
    const refundAmount = -Math.abs(amount);
    const refundAmountPln = -Math.abs(amountPln);

    const payload = {
      payment_id: payment.session_id,
      deal_id: String(dealId),
      reason: 'deal_lost',
      amount: refundAmount,
      currency,
      amount_pln: refundAmountPln,
      logged_at: new Date().toISOString(),
      metadata: {
        deal_id: String(dealId),
        session_id: payment.session_id,
        refund_reason: 'deal_lost',
        refund_note: 'Клиент не едет на кэмп',
        refund_status: status,
        refund_id: refund?.id || null
      },
      raw_payload: {
        payment,
        refund: refund || null
      }
    };

    await this.repository.logDeletion(payload);
  }

  /**
   * Add payment note to deal
   * @param {number} dealId - Deal ID
   * @param {Object} paymentInfo - Payment information
   * @param {string} paymentInfo.paymentType - Payment type (deposit, rest, single)
   * @param {number} paymentInfo.amount - Payment amount in original currency
   * @param {string} paymentInfo.currency - Currency code
   * @param {number} paymentInfo.amountPln - Payment amount in PLN
   * @param {string} paymentInfo.sessionId - Stripe session ID
   * @returns {Promise<Object>} - Result of adding note
   */
  async addPaymentNoteToDeal(dealId, paymentInfo) {
    const { paymentType, amount, currency, amountPln, sessionId, invoiceUrl } = paymentInfo;

    try {
      // Check if note with this session ID already exists to avoid duplicates
      try {
        const dealNotes = await this.pipedriveClient.getDealNotes(dealId);
        if (dealNotes && dealNotes.success && dealNotes.notes) {
          const sessionIdInNote = sessionId;
          const existingNote = dealNotes.notes.find(note => {
            const noteContent = note.content || '';
            // Check if note contains this session ID
            return noteContent.includes(sessionIdInNote);
          });
          
          if (existingNote) {
            this.logger.info('Payment note already exists for this session, skipping creation', {
              dealId,
              sessionId,
              existingNoteId: existingNote.id
            });
            return {
              success: true,
              skipped: true,
              reason: 'note_already_exists',
              note: existingNote
            };
          }
        }
      } catch (notesCheckError) {
        // If we can't check notes, continue (don't block note creation)
        this.logger.warn('Failed to check existing notes before creating payment note', {
          dealId,
          sessionId,
          error: notesCheckError.message
        });
      }

      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      const paymentTypeLabel = paymentType === 'deposit' ? 'Предоплата' : paymentType === 'rest' ? 'Остаток' : 'Платеж';

      // Build Stripe Dashboard link for Checkout Session
      const stripeMode = this.mode || 'test';
      const dashboardBaseUrl = stripeMode === 'test' 
        ? 'https://dashboard.stripe.com/test/checkout_sessions'
        : 'https://dashboard.stripe.com/checkout_sessions';
      const stripeDashboardLink = `${dashboardBaseUrl}/${sessionId}`;

      let noteContent = `💳 ${paymentTypeLabel} получена через Stripe\n\n`;
      noteContent += `Сумма: ${formatAmount(amount)} ${currency}`;
      if (amountPln && currency !== 'PLN') {
        noteContent += ` (${formatAmount(amountPln)} PLN)`;
      }
      noteContent += `\n\nСсылка на транзакцию: ${stripeDashboardLink}`;
      if (invoiceUrl) {
        noteContent += `\n\n📄 Инвойс: ${invoiceUrl}`;
      }
      noteContent += `\nДата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}`;

      const result = await this.pipedriveClient.addNoteToDeal(dealId, noteContent);

      if (result.success) {
        this.logger.info('Payment note added to deal', {
          dealId,
          paymentType,
          amount,
          currency,
          noteId: result.note?.id
        });
      } else {
        this.logger.warn('Failed to add payment note to deal', {
          dealId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding payment note to deal', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Add refund note to deal
   * @param {number} dealId - Deal ID
   * @param {Array} refundedPayments - Array of refunded payments with refund info
   * @returns {Promise<Object>} - Result of adding note
   */
  async addRefundNoteToDeal(dealId, refundedPayments) {
    try {
      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      
      let noteContent = `🔄 Возврат средств (Refund)\n\n`;
      
      // For single payment, don't show count
      if (refundedPayments.length > 1) {
        noteContent += `Обработано возвратов: ${refundedPayments.length}\n\n`;
      }

      let totalAmount = 0;
      let totalAmountPln = 0;

      refundedPayments.forEach((item, index) => {
        const { payment, refund } = item;
        const currency = normaliseCurrency(payment.currency || 'PLN');
        const amount = payment.original_amount || 0;
        const amountPln = payment.amount_pln || 0;
        
        totalAmount += amount;
        totalAmountPln += amountPln;

        // Build Stripe Dashboard link for refund
        const stripeMode = this.mode || 'test';
        const refundDashboardUrl = stripeMode === 'test'
          ? `https://dashboard.stripe.com/test/refunds/${refund.id}`
          : `https://dashboard.stripe.com/refunds/${refund.id}`;

        // For multiple payments, show numbered list
        if (refundedPayments.length > 1) {
          noteContent += `${index + 1}. Платеж ${index + 1}:\n`;
          noteContent += `   Сумма возврата: ${formatAmount(amount)} ${currency}`;
          if (amountPln && currency !== 'PLN') {
            noteContent += ` (${formatAmount(amountPln)} PLN)`;
          }
          noteContent += `\n   Refund ID: ${refund.id}\n`;
          noteContent += `   Ссылка на возврат: ${refundDashboardUrl}\n\n`;
        } else {
          // For single payment, show simpler format
          noteContent += `Сумма возврата: ${formatAmount(amount)} ${currency}`;
          if (amountPln && currency !== 'PLN') {
            noteContent += ` (${formatAmount(amountPln)} PLN)`;
          }
          noteContent += `\nRefund ID: ${refund.id}\n`;
          noteContent += `Ссылка на возврат: ${refundDashboardUrl}\n\n`;
        }
      });

      // For multiple payments, show total amount
      if (refundedPayments.length > 1) {
        noteContent += `💰 Общая сумма возврата: ${formatAmount(totalAmount)} ${refundedPayments[0]?.payment?.currency || 'PLN'}`;
        if (totalAmountPln && refundedPayments[0]?.payment?.currency !== 'PLN') {
          noteContent += ` (${formatAmount(totalAmountPln)} PLN)`;
        }
        noteContent += `\n\n`;
      }
      
      noteContent += `Дата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}`;

      const result = await this.pipedriveClient.addNoteToDeal(dealId, noteContent);

      if (result.success) {
        this.logger.info('Refund note added to deal', {
          dealId,
          refundsCount: refundedPayments.length,
          totalAmount,
          noteId: result.note?.id
        });
      } else {
        this.logger.warn('Failed to add refund note to deal', {
          dealId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding refund note to deal', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if refund is in different month than payment and create tax correction task if needed
   * @param {Object} payment - Payment record from database
   * @param {number} dealId - Deal ID
   * @param {Object} refund - Stripe refund object
   * @returns {Promise<void>}
   */
  async checkAndCreateTaxCorrectionTask(payment, dealId, refund) {
    try {
      // Get payment date from payment record
      const paymentDate = payment.created_at ? new Date(payment.created_at) : null;
      if (!paymentDate) {
        this.logger.warn('Cannot determine payment date for tax correction check', {
          dealId,
          sessionId: payment.session_id
        });
        return;
      }

      // Get refund date from refund object (Stripe timestamp)
      const refundDate = refund.created ? new Date(refund.created * 1000) : new Date();
      
      // Compare months (year-month)
      const paymentMonth = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
      const refundMonth = `${refundDate.getFullYear()}-${String(refundDate.getMonth() + 1).padStart(2, '0')}`;

      // If same month, no task needed
      if (paymentMonth === refundMonth) {
        this.logger.debug('Refund and payment in same month, no tax correction needed', {
          dealId,
          paymentMonth,
          refundMonth
        });
        return;
      }

      // Different months - need tax correction task
      this.logger.info('Refund in different month than payment, creating tax correction task', {
        dealId,
        paymentMonth,
        refundMonth,
        paymentDate: paymentDate.toISOString(),
        refundDate: refundDate.toISOString()
      });

      // Get product name
      let productName = 'Неизвестный продукт';
      if (payment.product_id) {
        try {
          const productLink = await this.repository.findProductLinkById(payment.product_id);
          if (productLink?.crm_product_name) {
            productName = productLink.crm_product_name;
          }
        } catch (error) {
          this.logger.warn('Failed to get product name for tax correction task', {
            dealId,
            productId: payment.product_id,
            error: error.message
          });
        }
      }

      // Format month name in Russian
      const monthNames = [
        'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
        'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'
      ];
      const paymentMonthName = monthNames[paymentDate.getMonth()];
      const paymentYear = paymentDate.getFullYear();

      // Create task in Pipedrive
      const taskSubject = `Сделать корректировку по продукту "${productName}" в ${paymentMonthName} ${paymentYear}`;
      const taskNote = `Рефанд был сделан в ${refundMonth}, а платеж был в ${paymentMonth}. ` +
        `Необходимо сделать корректировку налогов.\n\n` +
        `Сумма возврата: ${payment.original_amount || 0} ${payment.currency || 'PLN'}\n` +
        `Refund ID: ${refund.id}\n` +
        `Session ID: ${payment.session_id}`;

      const taskResult = await this.pipedriveClient.createTask({
        deal_id: dealId,
        subject: taskSubject,
        type: 'task',
        note: taskNote,
        due_date: new Date().toISOString().split('T')[0] // Due today
      });

      if (taskResult.success) {
        this.logger.info('Tax correction task created', {
          dealId,
          taskId: taskResult.task?.id,
          productName,
          paymentMonth,
          refundMonth
        });
      } else {
        this.logger.warn('Failed to create tax correction task', {
          dealId,
          error: taskResult.error
        });
      }
    } catch (error) {
      this.logger.error('Error checking/creating tax correction task', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Send refund notification via SendPulse
   * @param {number} dealId - Deal ID
   * @param {Array} refundedPayments - Array of refunded payments with refund info
   * @returns {Promise<Object>} - Result of sending notification
   */
  async sendRefundNotificationForDeal(dealId, refundedPayments) {
    if (!this.sendpulseClient) {
      this.logger.warn('SendPulse client not initialized, skipping refund notification', { dealId });
      return { success: false, error: 'SendPulse client not initialized' };
    }

    try {
      // Get deal with person data
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!fullDealResult.success || !fullDealResult.person) {
        this.logger.warn('Failed to get deal/person data for SendPulse refund notification', { dealId });
        return { success: false, error: 'Failed to get deal/person data' };
      }

      const person = fullDealResult.person;
      const sendpulseId = this.getSendpulseId(person);

      if (!sendpulseId) {
        this.logger.info('SendPulse ID not found for person, skipping refund notification', {
          dealId,
          personId: person.id
        });
        return { success: false, error: 'SendPulse ID not found' };
      }

      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      const stripeMode = this.mode || 'test';

      // Build refund notification message
      let message = `*Возврат средств*\n\n`;
      message += `Мы обработали ваш запрос на возврат средств.\n\n`;

      // Add refund details
      let totalAmount = 0;
      let totalAmountPln = 0;
      const refundLinks = [];

      refundedPayments.forEach((item, index) => {
        const { payment, refund } = item;
        const currency = normaliseCurrency(payment.currency || 'PLN');
        const amount = payment.original_amount || 0;
        const amountPln = payment.amount_pln || 0;
        
        totalAmount += amount;
        totalAmountPln += amountPln;

        // Get refund receipt URL if available (for completed refunds)
        let refundUrl = null;
        if (refund.receipt_url) {
          refundUrl = refund.receipt_url;
        } else {
          // Build Stripe Dashboard link for refund tracking
          refundUrl = stripeMode === 'test'
            ? `https://dashboard.stripe.com/test/refunds/${refund.id}`
            : `https://dashboard.stripe.com/refunds/${refund.id}`;
        }

        if (refundedPayments.length > 1) {
          message += `${index + 1}. Возврат: ${formatAmount(amount)} ${currency}`;
          if (amountPln && currency !== 'PLN') {
            message += ` (${formatAmount(amountPln)} PLN)`;
          }
          message += `\n`;
        }

        refundLinks.push({
          amount,
          currency,
          url: refundUrl,
          refundId: refund.id
        });
      });

      if (refundedPayments.length === 1) {
        message += `*Сумма возврата:* ${formatAmount(totalAmount)} ${refundedPayments[0]?.payment?.currency || 'PLN'}`;
        if (totalAmountPln && refundedPayments[0]?.payment?.currency !== 'PLN') {
          message += ` (${formatAmount(totalAmountPln)} PLN)`;
        }
        message += `\n\n`;
      } else {
        message += `\n*Общая сумма возврата:* ${formatAmount(totalAmount)} ${refundedPayments[0]?.payment?.currency || 'PLN'}`;
        if (totalAmountPln && refundedPayments[0]?.payment?.currency !== 'PLN') {
          message += ` (${formatAmount(totalAmountPln)} PLN)`;
        }
        message += `\n\n`;
      }

      // Add refund timeline information
      message += `*Сроки возврата:*\n`;
      message += `Средства поступят на ваш счет в течение *5-10 рабочих дней* (в зависимости от банка).\n\n`;

      // Add tracking links
      if (refundLinks.length > 0) {
        message += `*Отслеживание возврата:*\n`;
        refundLinks.forEach((link, index) => {
          if (refundLinks.length > 1) {
            message += `${index + 1}. `;
          }
          message += `[Ссылка на возврат](${link.url})\n`;
        });
      }

      // Send message via SendPulse
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('Refund notification sent via SendPulse', {
          dealId,
          sendpulseId,
          refundsCount: refundedPayments.length
        });
      } else {
        this.logger.warn('Failed to send refund notification via SendPulse', {
          dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending refund notification', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get SendPulse ID from person
   * @param {Object} person - Person object from Pipedrive
   * @returns {string|null} - SendPulse ID or null
   */
  getSendpulseId(person) {
    if (!person) return null;
    const sendpulseId = person[this.SENDPULSE_ID_FIELD_KEY];
    if (!sendpulseId || String(sendpulseId).trim() === '') {
      return null;
    }
    return String(sendpulseId).trim();
  }

  /**
   * Send payment notification via SendPulse with payment schedule and links
   * @param {number} dealId - Deal ID
   * @param {Object} options - Notification options
   * @param {string} options.paymentSchedule - Payment schedule type ('50/50' or '100%')
   * @param {Array} options.sessions - Array of session objects with id, url, type, amount
   * @param {string} options.currency - Currency code
   * @param {number} options.totalAmount - Total amount
   * @returns {Promise<Object>} - Result of sending notification
   */
  async sendPaymentNotificationForDeal(dealId, options = {}) {
    const { paymentSchedule, sessions = [], currency, totalAmount } = options;

    this.logger.info(`📧 Попытка отправить уведомление о платеже | Deal ID: ${dealId} | Sessions: ${sessions.length}`, {
      dealId,
      sessionsCount: sessions.length,
      paymentSchedule
    });

    if (!this.sendpulseClient) {
      this.logger.warn(`⚠️  SendPulse клиент не инициализирован, уведомление не отправлено | Deal ID: ${dealId}`, { dealId });
      return { success: false, error: 'SendPulse client not initialized' };
    }

    try {
      // Get deal with person data
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!fullDealResult.success || !fullDealResult.person) {
        this.logger.warn(`⚠️  Не удалось получить данные сделки/персоны для уведомления | Deal ID: ${dealId}`, { dealId });
        return { success: false, error: 'Failed to get deal/person data' };
      }

      const deal = fullDealResult.deal;
      const person = fullDealResult.person;
      const sendpulseId = this.getSendpulseId(person);

      this.logger.info(`📧 Данные персоны получены | Deal ID: ${dealId} | Person ID: ${person.id} | SendPulse ID: ${sendpulseId || 'не найден'}`, {
        dealId,
        personId: person.id,
        personName: person.name,
        personEmails: person.email?.map(e => e.value) || [],
        sendpulseId
      });

      if (!sendpulseId) {
        this.logger.warn(`⚠️  SendPulse ID не найден для персоны, уведомление не отправлено | Deal ID: ${dealId} | Person ID: ${person.id} | Person Name: ${person.name}`, {
          dealId,
          personId: person.id,
          personName: person.name,
          personEmails: person.email?.map(e => e.value) || []
        });
        return { success: false, error: 'SendPulse ID not found' };
      }

      // Calculate payment dates based on close_date
      const closeDate = deal.expected_close_date || deal.close_date;
      let firstPaymentDate = null;
      let secondPaymentDate = null;
      let singlePaymentDate = null;

      if (closeDate) {
        try {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          
          if (paymentSchedule === '50/50') {
            // First payment: now (or today)
            firstPaymentDate = new Date(today);
            firstPaymentDate.setHours(0, 0, 0, 0);
            
            // Second payment: 1 month before close_date
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
            secondPaymentDate.setHours(0, 0, 0, 0);
          } else {
            // Single payment: before close_date (or now if close_date is soon)
            const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
            if (daysDiff > 7) {
              // If more than 7 days, set payment date to 7 days before close_date
              singlePaymentDate = new Date(expectedCloseDate);
              singlePaymentDate.setDate(singlePaymentDate.getDate() - 7);
            } else {
              // If less than 7 days, payment is due now
              singlePaymentDate = new Date(today);
            }
            singlePaymentDate.setHours(0, 0, 0, 0);
          }
        } catch (error) {
          this.logger.warn('Failed to calculate payment dates', {
            dealId,
            closeDate,
            error: error.message
          });
        }
      }

      // Format date helper
      const formatDate = (date) => {
        if (!date) return 'не указана';
        return date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Europe/Warsaw'
        });
      };

      // Build message with payment schedule and links (using Markdown formatting)
      const formatAmount = (amount) => parseFloat(amount).toFixed(2);

      let message = '';
      
      if (paymentSchedule === '50/50' && sessions.length >= 2) {
        // Two payments: deposit and rest
        message = `*Привет! Для тебя созданы ссылки на оплату через Stripe.*\n\n`;
        message += `*График платежей:*\n\n`;
        
        const depositSession = sessions.find(s => s.type === 'deposit');
        const restSession = sessions.find(s => s.type === 'rest');

        if (depositSession) {
          let dateText = '';
          if (firstPaymentDate) {
            dateText = ` до *${formatDate(firstPaymentDate)}*`;
          }
          message += `1️⃣ *Предоплата 50%:* ${formatAmount(depositSession.amount)} ${currency}${dateText}\n`;
          message += `   [Оплатить предоплату](${depositSession.url})\n\n`;
        }

        if (restSession) {
          let dateText = '';
          if (secondPaymentDate) {
            dateText = ` до *${formatDate(secondPaymentDate)}*`;
          }
          message += `2️⃣ *Остаток 50%:* ${formatAmount(restSession.amount)} ${currency}${dateText}\n`;
          message += `   [Оплатить остаток](${restSession.url})\n\n`;
        }

        message += `*Итого:* ${formatAmount(totalAmount)} ${currency}\n`;
      } else if (paymentSchedule === '100%' && sessions.length >= 1) {
        // Single payment - different text
        const singleSession = sessions[0];
        let dateText = '';
        if (singlePaymentDate) {
          dateText = ` до *${formatDate(singlePaymentDate)}*`;
        }
        message = `*Привет! Для тебя создана ссылка на оплату через Stripe.*\n\n`;
        message += `💳 *Полная оплата:* ${formatAmount(singleSession.amount)} ${currency}${dateText}\n`;
        message += `   [Оплатить](${singleSession.url})\n\n`;
        message += `*Итого:* ${formatAmount(totalAmount)} ${currency}\n`;
      } else {
        // Fallback: list all sessions
        sessions.forEach((session, index) => {
          const paymentLabel = session.type === 'deposit' ? 'Предоплата' : session.type === 'rest' ? 'Остаток' : 'Платеж';
          message += `${index + 1}. *${paymentLabel}:* ${formatAmount(session.amount)} ${currency}\n`;
          message += `   [Оплатить](${session.url})\n\n`;
        });
        message += `*Итого:* ${formatAmount(totalAmount)} ${currency}\n`;
      }

      message += `\n💡 Нажми на ссылку выше, чтобы перейти к оплате.`;

      // Send message via SendPulse
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('SendPulse payment notification sent successfully', {
          dealId,
          sendpulseId,
          paymentSchedule,
          sessionsCount: sessions.length,
          messageId: result.messageId
        });
      } else {
        this.logger.warn('Failed to send SendPulse payment notification', {
          dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending SendPulse payment notification', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Строит URL для редиректа после платежа с параметрами deal_id
   * @param {string} baseUrl - Базовый URL из переменной окружения
   * @param {string|number} dealId - ID сделки
   * @param {string} type - Тип редиректа ('success' или 'cancel')
   * @returns {string|null} - URL с параметрами или null если baseUrl не задан
   */
  buildCheckoutUrl(baseUrl, dealId, type = 'success') {
    if (!baseUrl) return null;
    
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('deal_id', String(dealId));
      url.searchParams.set('type', type);
      return url.toString();
    } catch (error) {
      // Если baseUrl не валидный URL, возвращаем как есть с параметрами через ?
      if (baseUrl.includes('?')) {
        return `${baseUrl}&deal_id=${dealId}&type=${type}`;
      }
      return `${baseUrl}?deal_id=${dealId}&type=${type}`;
    }
  }
}

module.exports = StripeProcessorService;

