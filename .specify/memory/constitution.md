<!--
Sync Impact Report
- Version change: Ø → 1.0.0
- Modified principles: (new) Invoice Data Fidelity; (new) Reliable Automation Flow; (new) Transparent Observability; (new) Secure Credential Stewardship; (new) Spec-Driven Delivery Discipline
- Added sections: Operational Constraints; Development Workflow; Governance
- Removed sections: none
- Templates requiring updates: .specify/templates/plan-template.md (✅ aligns with constitution gates); .specify/templates/spec-template.md (✅ already mandates independently testable stories); .specify/templates/tasks-template.md (✅ already enforces story-based sequencing)
- Follow-up TODOs: none
-->

# Pipedrive to wFirma Integration Constitution

## Core Principles

### Invoice Data Fidelity
Every integration change MUST preserve one-to-one mapping between Pipedrive deal data and wFirma proforma invoices. Required deal fields (title, value, currency, expected close date, invoice type, first product, primary email) MAY NOT be skipped or silently normalized. Any transformation (currency rounding, date adjustment, tag truncation) MUST be explicitly documented in specs and verified with automated or scripted regression tests before deployment.

### Reliable Automation Flow
Scheduler and manual triggers MUST follow the documented control flow: data enrichment → contractor resolution → invoice generation → optional notifications. New logic MUST include guardrails (idempotency keys, duplicate detection, retries with back-off) and explicit failure paths that surface actionable errors without blocking the queue. No code that mutates invoice state MAY bypass central services (`InvoiceProcessingService`, `WfirmaClient`).

### Transparent Observability
All external calls (Pipedrive, wFirma, email) MUST emit structured logs via the shared logger with correlation identifiers per deal. Logs MUST capture request targets, status, and errors without leaking secrets. When adding features, developers MUST include monitoring hooks or documented manual checks so production issues can be triaged using logs alone.

### Secure Credential Stewardship
API keys, secrets, and bank-account mappings MUST reside in environment variables or configuration files explicitly listed in `.gitignore`. Pull requests MUST demonstrate that sensitive data is not introduced into tracked files, logs, or default configs. Any new third-party integration requires a security review covering storage, rotation, and least-privilege access.

### Spec-Driven Delivery Discipline
Every change MUST flow through Spec Kit: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`. Plans MUST resolve all “NEEDS CLARIFICATION” items before implementation. Tasks MUST align to independently testable user stories. Deviations require a documented exception in the plan and approval during review.

## Operational Constraints

- Invoice XML MUST maintain VAT = 0 (`vat_code_id=230`) unless legal requirements change; any deviation mandates legal approval and plan update.
- Payment schedule logic MUST remain deterministic: >30 days until expected close → 50/50 split; ≤30 days → single payment. Changes demand regression scripts and documentation updates.
- Tag names MUST remain ≤16 characters and use the existing helper; any new categorization scheme must document truncation rules.
- Deployment environments MUST provide outbound HTTPS access to both APIs and a persistent log storage strategy.

## Development Workflow

- Use feature branches named `###-feature-name`; run `/speckit.plan` to generate `specs/` artifacts before coding.
- Tests or scripts referenced in spec/plan MUST be executed (or the inability documented) before merging.
- Code review checklists MUST confirm: principles respected, tasks completed, environment variables untouched, and logging coverage sufficient.
- Post-merge, trigger regression run (manual or automated) covering contractor creation, invoice creation, and tag handling flows.

## Governance

- This constitution supersedes informal practices for the integration. Amendments require a `/speckit.constitution` run, summary in the Sync Impact Report, and approval from engineering + business owners.
- Versioning follows semantic rules: MAJOR for principle changes/removals, MINOR for new principles/sections, PATCH for clarifications.
- Compliance reviews occur at plan approval and before release; reviewers MUST verify that templates and tasks reflect current principles.
- Violations discovered post-deployment MUST be logged with remediation steps and scheduled as high-priority tasks.

**Version**: 1.0.0 | **Ratified**: 2025-10-25 | **Last Amended**: 2025-10-25
