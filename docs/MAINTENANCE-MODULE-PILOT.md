# Maintenance Plans — Agility Pilot Mount (2026-08-24)

Cayden's maintenance portal prototype (v0.9.3, `maint-plans/`) is mounted
inside Agility as a **Test Module** so the team can click through it behind
real logins. This is the pilot stage — demo data still lives in each
browser's localStorage; nothing customer-facing is exposed.

## What's mounted

- `maintenance/` — the ten prototype pages + assets, served at
  `/maintenance/...` on the dashboard host. All ten are registered in
  `INTERNAL_PAGE_PATHS`, labeled, and grouped under **Test Modules** in both
  the User Admin permission UI and the nav (Command Center, Field Tool,
  Enrollment Demo).
- `lib/maintenance-invoice-parser.js` — JS port of the prototype's Python
  invoice parser (`invoice_parser.py`), rebuilt on pdfjs layout
  reconstruction. Validated at full parity against the Python parser's
  output on both real Wilson invoice samples in the repo (26/26 fields).
  Serves `POST /api/invoice/import` (permission-gated on
  `/maintenance/admin.html`, audited as `maintenance_invoices_parsed`).

## Decisions made by Wilson (Andrew), 2026-08-24

- **WashTower / laundry center counts as ONE maintained asset** (context §34
  item 13, was blocking). Priced as one appliance, inspected with the
  combined `laundry` checkpoint set (via exactType `laundry_center`), counted
  under the customer-facing Washer category. The invoice importer's
  washer+dryer pair expansion is removed (parser, importer UI, and draft
  creation). The combined `laundry` protocol is therefore KEPT, not retired.

## Still open (from the prototype's own docs)

- Filter pricing is a $70/filter placeholder awaiting Wilson's filter
  sales-price list.
- HVAC field workflow not built.
- Stripe / email / photo storage / NetSuite are placeholders — the full
  production port (Postgres schema translated from the prototype's SQL
  Server migration, Express APIs replacing `store.js`) is the next phase if
  the pilot validates the workflows.
- The prototype's own docs assume a Flask + SQL Server main dashboard
  (`docs/MERGE_GUIDE.md`); Agility is Express + Postgres — schema and API
  layers translate rather than copy.

## Granting access

User Admin → permissions → check the **Test Modules** category (or the
individual `/maintenance/...` pages). Executives see everything by default.
