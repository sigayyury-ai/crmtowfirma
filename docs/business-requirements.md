# Business Requirements & Deployment Checklist

This document captures business-level functionality, configuration requirements, and deployment considerations for the Pipedrive ↔ wFirma integration. It should be kept up to date before moving the module to production (e.g., WordPress plugin environment).

## Functional Goals

1. **Synchronise Pipedrive deals to wFirma Proforma invoices**
   - Triggered manually or via scheduler/callback.
   - Uses deal data (value, currency, expected close date) and first associated product.
   - Handles both private persons and organisations (email is mandatory).

2. **Contractor lifecycle**
   - Search by email in wFirma.
   - Create contractor when not found (with normalised country codes, optional fields left blank).

3. **Invoice creation rules**
   - Prices from Pipedrive considered gross (`is_net=false`, `brutto=<amount>`).
   - VAT forcibly set to 0% (`vat_code_id=230`, `vat_exemption_reason=nie podl.`).
   - Payment description in Russian:
     - If `expected_close_date` > 30 days → 50% deposit now, 50% balance one month before camp.
     - Otherwise → 100% due by `issue_date + 3 days`.
   - Payment method fixed to bank transfer. Bank account chosen dynamically based on currency.

4. **Tags (“Labels”) in wFirma**
   - Create or reuse a tag derived from product name (trimmed to 16 characters).
   - Flags enabled for invoices and goods (others optional due to API limitations).
   - Assignment to documents currently disabled (wFirma API returns `ACTION NOT FOUND`).

5. **Logging & Monitoring**
   - Maintain logs of API requests/responses for audit and troubleshooting.
   - Provide CLI scripts for regression checks (e.g., `node test-deal-1516.js`).

## Configuration Requirements

- **Environment variables** (to be stored securely):
  - Pipedrive: `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_BASE_URL`.
  - wFirma: `WFIRMA_APP_KEY`, `WFIRMA_ACCESS_KEY`, `WFIRMA_SECRET_KEY`, `WFIRMA_BASE_URL`, `WFIRMA_COMPANY_ID`.
  - Application: `PORT`, `NODE_ENV` as needed.
- **Bank accounts** – configured in `config/bank-accounts.js` per currency, with fallbacks.
- **Deal prerequisites** – fields required in Pipedrive:
  - Deal `title`, `value`, `currency`.
  - `expected_close_date` to determine payment schedule.
  - Custom field “Invoice type” (option ID = 70 for “PROFORMA”).
  - At least one product linked to the deal (name, price, quantity).
  - Person with primary email (used as contractor key).

## Deployment Considerations

1. **Target environment**
   - WordPress plugin environment (PHP) with existing JS stack.
   - Node.js is required to run the integration; plan to host it alongside or as a separate service.

2. **Integration strategy**
   - Option A: Deploy Node service separately (e.g., on VPS) and expose REST endpoints consumed by the WordPress plugin. Plugin stores settings (API keys, toggles) and triggers processing via HTTP.
   - Option B: Re-implement integration in PHP – high effort, currently not planned.

3. **Security**
   - Avoid storing credentials in code repository; use environment variables or secure WordPress options.
   - Ensure outbound HTTPS access to Pipedrive and wFirma is available from hosting.

4. **Scheduling**
   - Cron or background jobs must trigger `processPendingInvoices`. In WordPress, consider `wp_cron` or external cron hitting a REST endpoint.
   - Provide manual trigger interface for admins (e.g., button in WP admin).

5. **Logging & Monitoring**
   - Plan for log storage on production (rotate, secure access).
   - Add alerts/notifications for repeated failures (optional).

6. **Testing & Migration**
   - Validate with test API keys in staging before switching to production credentials.
   - Document manual test scripts in README (deal IDs, sample workflows).
   - Ensure WordPress plugin includes UI for configuration (API tokens, schedule toggle, test run button).

7. **Potential Risks**
   - API rate limits or downtime (Pipedrive, wFirma).
   - wFirma tag API limitations (no document assignment endpoint).
   - Variations in product data (missing names, multiple products – currently first product is used).
   - Time zone differences (expected close date vs server locale).

## Next Steps

- Finalise documentation in `docs/architecture.md` and update README.
- Implement WordPress plugin interface for settings and manual job trigger.
- Decide on deployment topology (separate Node service vs embedded) and prepare infrastructure.
- Establish staging environment for final verification before production rollout.


