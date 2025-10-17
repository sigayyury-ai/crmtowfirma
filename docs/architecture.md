# Architecture Overview

This document describes the current structure of the Pipedrive → wFirma integration module, the main components involved, and the flow of data between them.

## High-Level Flow

1. **Deal trigger** – a deal in Pipedrive is selected manually or detected by the scheduler.
2. **Data enrichment** – the integration fetches the deal, products, customer (person/organization) and the field `expected_close_date` from Pipedrive.
3. **Contractor handling** – the system searches for an existing contractor in wFirma by email and creates one if needed.
4. **Invoice generation** – a Proforma invoice XML payload is generated (prices treated as gross, VAT 0%, description contains the payment schedule) and submitted to wFirma.
5. **Notification** – on success the invoice can be sent by e‑mail via wFirma and the result is logged.
6. **Tag management** – the module ensures that a wFirma tag with the deal/product name exists (limit 16 characters) to help group documents.

## Modules and Responsibilities

### `src/services/pipedrive.js` – `PipedriveClient`
- Stores API credentials (`apiToken`, `baseURL`).
- Wraps axios with logging interceptors.
- Key methods:
  - `getUserInfo()` – sanity check of credentials.
  - `getDeal(dealId)` – returns raw Pipedrive deal (`title`, `value`, `currency`, `expected_close_date`, custom fields).
  - `getDealProducts(dealId)` – retrieves products linked to a deal with quantity, item price, unit etc.
  - `getPerson(personId)` / `getOrganization(orgId)` – supplementary CRM data.

### `src/services/wfirma.js` – `WfirmaClient`
- Stores API credentials (`appKey`, `accessKey`, `secretKey`, `companyId`).
- Provides wrappers over wFirma REST endpoints.
- Key methods:
  - `getBankAccounts()` – fetch and cache company bank accounts.
  - `findContractorByEmail(email)` / `createContractor(data)` – contractor lifecycle.
  - `createProforma(xmlPayload)` – low-level uploader (used by `InvoiceProcessingService`).
  - `sendInvoiceByEmail(invoiceId)` – triggers wFirma mailer.
  - `findLabelByName(labelName)` / `createLabel(labelName)` – tag management. API requires names ≤16 characters.
  - `assignLabelToDocument(...)` – prepared for future use (current API returns `ACTION NOT FOUND`, so only logging is performed).
  - `findOrCreateAndAssignLabel(...)` – high-level helper returning `{ success, labelId, created }` even if assignment is skipped.

### `src/services/invoiceProcessing.js` – `InvoiceProcessingService`
- Constructor initialises:
  - `ADVANCE_PERCENT = 50` – deposit share.
  - `PAYMENT_TERMS_DAYS = 3` – default payment due window.
  - `DEFAULT_LANGUAGE = 'en'`, `DEFAULT_DESCRIPTION = ''`.
  - `VAT_RATE = 0`, `PAYMENT_METHOD = 'transfer'`.
  - `INVOICE_TYPES = { PROFORMA: 70 }` – mapping to Pipedrive custom field option.
  - Bank account cache (`this.bankAccounts`) and config (`BANK_ACCOUNT_CONFIG`).

- Core methods:
  - `processPendingInvoices()` – batch processor for deals marked with the invoice field.
  - `processDealInvoice(deal)` – orchestrates the end-to-end flow for a single deal.
  - `createInvoiceInWfirma(deal, contractor, product, invoiceType)` – derives amounts, prepares data and delegates XML creation.
  - `createProformaInWfirma(deal, contractor, product, amount)` – builds XML payload and posts it to wFirma.
  - `ensureLabelForDeal(deal, product)` – ensures that a tag named after the product (fallback to deal title) exists; returns `{ labelId, created }`.
  - `getBankAccountByCurrency(currency)` – selects the right account using cached API data and config fallbacks.
  - Utility helpers for validation, country normalisation (in contractor logic), XML escaping etc.

- Payment schedule logic (inside `createProformaInWfirma`):
  - If `expected_close_date` is **more than 30 days** away → split into *50% deposit now* and *50% balance one month before camp*.
  - Otherwise (≤30 days) → a single 100% payment due on the default payment date (issue date + 3 days).
  - Description text is generated in Russian: `График платежей: ...`.

- VAT & pricing: values from Pipedrive are treated as **gross** (`is_net=false`, `brutto=<amount>`). VAT rate is forced to zero (`vat_code_id=230`, reason `nie podl.`).

### Other Services
- `src/services/userManagement.js` – placeholder for future user/permission logic.
- `src/services/productManagement.js` – legacy file, currently unused (product data comes directly from Pipedrive).
- `src/routes/api.js` / `src/index.js` – REST endpoints and express bootstrap (manual triggers, status checks).
- `src/utils/logger.js` – Winston logger configuration used across services.
- `config/bank-accounts.js` – mapping of currencies to preferred wFirma bank account IDs/names.

### Testing & Utilities
Ручной запуск выполняется через метод `processDealById` или REST-эндпойнты (`POST /api/invoice-processing/run`, `POST /api/invoice-processing/deal/:id`). Журналы операций пишутся в stdout и при необходимости настраиваются через `src/utils/logger.js`.

## Data Contracts

- **Deals** – require `title`, `value`, `currency`, `person_id` (email), `expected_close_date`, and custom field `Invoice type`.
- **Products** – require `name`, `quantity`, `item_price` or `sum`, `unit`. first product is used (fallback to deal title/value).
- **Invoices** – XML structure based on `<invoicecontents><invoicecontent>...</invoicecontent></invoicecontents>` to avoid empty item names in wFirma.
- **Tags** – names trimmed to 16 characters, created with invoice/good flags = 1.

## Environment Variables

- `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_BASE_URL`.
- `WFIRMA_APP_KEY`, `WFIRMA_ACCESS_KEY`, `WFIRMA_SECRET_KEY`, `WFIRMA_BASE_URL`, `WFIRMA_COMPANY_ID`.
- Optional server settings (`PORT`, `NODE_ENV`).

A template is provided in `env.example`.

## Logging & Error Handling

- All external calls are logged at INFO level with URL and status.
- Errors capture message and stack; wFirma XML error responses are parsed for `<message>`.
- Primary execution path (`processDealInvoice`) wraps each stage with try/catch and returns `{ success, error }` objects consumed by API or scripts.

## Deployment Notes (summary)

- Requires Node.js runtime and outbound HTTPS access to Pipedrive and wFirma.
- Credentials must be provided via environment variables (avoid committing to source control).
- Scheduler/cron must be configured if automatic processing is desired.
- WordPress integration will likely run this service as an external Node app controlled via plugin settings (see business requirements document for details).


