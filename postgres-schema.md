# Postgres Schema Draft

This is the first-pass Postgres model for the current Wilson app. The goal is not to invent the perfect enterprise schema yet. The goal is to preserve today's behavior while giving us:

- safer concurrent writes
- better lookup/query performance
- cleaner recovery and auditability
- a low-drama path off JSON files

## Design Principles

1. Mirror the current app first.
- Keep today's record shapes recognizable.
- Avoid a big logic rewrite during the storage swap.

2. Normalize only where the JSON shape is already getting messy.
- Payment links, service requests, events, and RSVPs map cleanly to tables.
- Service addresses, billing addresses, and unit arrays can stay `jsonb` for the first migration.

3. Preserve current IDs when possible.
- Many records already use meaningful string IDs like `svc_...`, `cof_...`, `recovered_...`, `plink_...`.
- Keeping those values avoids painful remapping during migration.

4. Stripe IDs should be first-class indexed columns.
- `payment_link_id`
- `payment_intent_id`
- `setup_intent_id`
- `customer_id`
- `payment_method_id`

## Proposed Tables

### `payment_links`

Primary operational table for:
- appliance payment links
- HVAC deposit links
- queue status
- paid/deactivated/ACH-pending state
- HVAC balance follow-up state

Notes:
- This is the most important table to migrate first.
- This is also the table most likely to benefit from stronger write safety than JSON.

### `card_on_file_charges`

Replaces `terminal-payments.json` as the ledger for:
- terminal charges
- saved-card charges
- HVAC balance charges

Notes:
- Current JSON file name is historical; the records are broader than “terminal”.
- Table name should reflect what it actually stores.

### `service_requests`

Replaces active `service-cards.json`.

Includes:
- queue status
- customer/contact details
- setup intent / saved card linkage
- service/billing addresses
- appliance units

### `service_requests_archive`

Stores the 31-90 day archive rows.

Notes:
- For a future refinement, this could become a single `service_requests` table with a `storage_bucket` or `archived_at`.
- For the first migration, separate active/archive tables keep behavior closest to today's app.

### `events`

Catalog of public events.

Includes:
- slug
- public path
- starts/ends
- location
- active/archived status

### `event_rsvps`

Stores per-event RSVP records.

Includes:
- event slug linkage
- attendee count
- attendee type
- text/email update preferences

## User Access Tables (live — created by `sql/003_user_access.sql`)

These back the per-user access system (see `docs/ACCESS-CONTROL.md`). They are
created idempotently at boot by `ensureUserAccessTables()` in
`lib/users-postgres.js`, or manually via the migration file.

### `app_users`

Individual accounts.
- `id` uuid pk, `email` unique (stored normalized: lowercased, `+tag` stripped)
- `password_hash` (`scrypt$N$r$p$salt$hash`, nullable until set)
- `display_name`
- `status`: `pending_verification` | `invited` | `active` | `disabled`
- `is_executive` bool — full access + user management
- `email_verified_at`, `created_at`, `updated_at`, `created_by`
- Login requires `status = 'active'` AND `email_verified_at IS NOT NULL`.

### `user_page_permissions`

Per-user, per-page boolean grants — the source of truth for what a
non-executive user can reach.
- pk (`user_id`, `page_path`), `granted`, `updated_at`, `updated_by`

### `sessions`

Server-side sessions; the cookie holds only an opaque random token.
- `user_id`, `token_hash` (sha256 of the token, unique), `created_at`,
  `expires_at`, `last_seen_at`, `ip`, `user_agent`
- Deleted on logout, password change/reset, and user deactivation.

### `auth_tokens`

Single-use emailed tokens, stored hashed.
- `user_id`, `kind`: `invite` | `verify` | `reset`, `token_hash` (sha256),
  `expires_at` (invite/verify 72h, reset 1h), `consumed_at`

### `access_audit_log`

Who did what: logins, registrations, permission changes, invites,
deactivations, password resets.
- `actor_user_id`, `action`, `target_user_id`, `detail` jsonb, `created_at`

## Fields That Should Stay `jsonb` First

These are the right places to avoid over-modeling on day one:

### `service_requests.service_address`
Current shape:
- `line1`
- `line2`
- `city`
- `state`
- `zip`

### `service_requests.billing_address`
Same shape as service address.

### `service_requests.units`
Current shape is an array of one or more appliances with slightly inconsistent fields between unit 1 and unit 2.

Keeping these in `jsonb` first gives us:
- easier migration
- no immediate UI rewrite
- room to normalize later if reporting needs it

## Slight Normalization Recommended Before/During Migration

These are the places where the current JSON shape is messy enough that we should clean a little.

### 1. `terminal-payments.json` is really a general charge ledger

Problem:
- It stores terminal charges, card-on-file charges, and HVAC balance charges.
- The file name no longer matches reality.

Recommendation:
- Rename conceptually to `card_on_file_charges` or `payment_charges` in Postgres.
- Keep a `charge_type` column with values like:
  - `terminal`
  - `card_on_file`
  - `hvac_balance`

### 2. `payment_links.status` and `payment_links.active` overlap

Problem:
- `status` and `active` partially duplicate each other.
- `status` drives real meaning:
  - `sent`
  - `viewed`
  - `ach_pending`
  - `paid`
  - `deactivated`
- `active` is basically derivative most of the time.

Recommendation:
- Keep both for the first migration so we do not break logic.
- Treat `status` as canonical.
- Long-term, `active` can become derived or removed.

### 3. HVAC deposit state is spread across generic payment-link fields

Problem:
- HVAC deposit rows are just payment links with extra fields:
  - `workflow_type`
  - `requested_total_amount`
  - `deposit_amount`
  - `balance_amount`
  - `balance_charged_at`
  - `balance_canceled_at`

Recommendation:
- Keep HVAC deposits in `payment_links` for the first migration.
- Add explicit HVAC columns rather than hiding the values in generic metadata.
- That gives you better reporting without forcing a separate HVAC table yet.

### 4. Service request addresses and units are semi-structured

Problem:
- Great fit for the UI
- Not great for SQL analytics

Recommendation:
- Store as `jsonb` now
- Revisit later only if reporting/searching by unit or address becomes more important

### 5. Event RSVPs identify duplicates by email or by name if no email

Problem:
- That duplicate/update rule lives in app logic and is a little fuzzy.

Recommendation:
- Keep it in application logic at first
- Do not try to enforce it as a database uniqueness rule yet
- A future `contact_key` column could help if this grows

## Suggested Migration Order

### Phase 1
- add Postgres schema
- build `lib/data-postgres.js`
- keep `lib/data.js` interface unchanged

### Phase 2
- migrate `payment_links`
- migrate `card_on_file_charges`

### Phase 3
- migrate `service_requests` and archive

### Phase 4
- migrate `events` and `event_rsvps`

### Phase 5
- optional: move auth/users into Postgres

## Highest-Risk Current JSON Areas

If we were only choosing one area to move first, it should be:

1. `payment_links`
- most operationally important
- queue drives multiple teams
- most susceptible to create/write race issues

2. `card_on_file_charges`
- second most important because it is a real money ledger

3. `service_requests`
- important, but more operational than financial

## Questions To Decide Before Cutover

1. Do we want separate `service_requests_archive` or one table with `archived_at`?
- Recommendation for first migration: keep separate archive table

2. Do we want to keep app-generated string IDs as primary keys?
- Recommendation: yes, for first migration

3. Do we want Postgres to become the source of truth for users/logins now?
- Recommendation: no, not in the first cut

## Recommended Immediate Next Step

After this schema file and initial SQL:

1. create `lib/data-postgres.js`
2. implement just the `payment_links` read/write methods
3. add a storage-mode env switch
4. test the app with Postgres only for that dataset first

### `employee_directory` (live — created by `sql/005_employee_directory.sql`)

Employee codes used on the payment tools, editable from User Admin (the
legacy static `employee-directory.js` file is now only a fallback; the
server serves that path from this table).
- `code` (pk, 1–3 chars), `name`, `email` (ties the code to an `app_users`
  account by email — powers code auto-fill and per-employee dashboard
  defaults), `department`, `updated_at`, `updated_by`
- `commission_plan` (added by `sql/011_commission_plan.sql`): one of the fixed
  plan names in `COMMISSION_PLANS` (lib/employee-directory.js) or `''` for
  none. Drives the automatic commission calculation at import.
- Seeded from the legacy static file on first boot when empty.

### Mileage reimbursement (live — created by `sql/007_mileage.sql`)

Replaces the monthly Excel worksheet. Created idempotently at boot by
`lib/mileage-postgres.js` (which also seeds the known IRS rate periods —
2025-01-01→0.67, 2026-01-01→0.725, 2026-07-01→0.76 — for any effective dates
not already present).

- `mileage_rate_periods` (added by `sql/010_mileage_rate_periods.sql`):
  `effective_from` (DATE pk), `rate` — effective-dated so mid-year IRS changes
  work (e.g. 76¢ effective 2026-07-01 while Jan–Jun stays 72.5¢). The rate for a
  month is the most recent period whose `effective_from` is on or before the
  first of that month. Executive-editable on the Mileage Review page. Approval
  snapshots the rate onto the report (`rate_used`), so later period edits never
  change an approved month. The old per-year `mileage_rates` table is folded in
  on migration (year N → effective N-01-01) and otherwise unused.
- `mileage_reports`: one per employee per month (`user_id`, `year`, `month`
  unique). `commute_miles` snapshot (from `employee_directory.commute_miles`
  at creation; reviewer-adjustable), `status`
  (`draft`→`submitted`→`approved`|`denied`), `denial_note`, decision fields.
- `mileage_entries`: `report_id`, `entry_date`, `showroom_start`, `purpose`,
  `miles`. Reimbursed miles are computed, never stored:
  `showroom_start ? miles : max(miles - commute, 0)`.
- `employee_directory.commute_miles`: per-employee standard round-trip
  commute, managed in the User Admin directory editor.

### Commissions (live — managed by `lib/commissions-postgres.js`)

Monthly ePASS workbook imports reviewed on the Commissions pages. Since the
2026 format (`sql/012_commission_plans_calc.sql`) the export carries revenue,
serial type, serial cost, and GM% per line, and commission is **calculated**
from each salesperson's `employee_directory.commission_plan` (snapshotted
per line at import as `salesperson_plan`, so plan changes never rewrite an
existing run). Plan rules live in `computePlanLineCommission` /
`buildSalespersonGroups`:
Showroom Consultant → 5% on DISPLAY/OPEN lines + flat 5% Protect;
Field Sales Consultant → GM-tiered 2–5% on serial type ALL, attach-rate-tiered
Protect (5/10/15%), $500 bonus over $5,000 Protect, gated by `fs_qualified`
($500k/6-month rule, manual toggle, informed by trailing revenue);
HVAC Selling Technician → per-order net-margin payout. Runs without a plan
snapshot keep the legacy department-based behavior.

- `commission_runs`: one per imported workbook (`period_label`, importer,
  status derived from per-salesperson statuses).
- `commission_lines`: line detail (`sell_price`, `serial_type`, `serial_cost`,
  `gm_percent`, `salesperson_plan`, editable `commission_percent`/`_amount`,
  `source_classification` incl. UNPAID/OMIT).
- `commission_salesperson_statuses`: per-run per-person `status`
  (draft→locked→final_paid, 48h auto-finalize) and `fs_qualified`.
- `commission_salesperson_adjustments`: BONUS/DEDUCT/ADVANCE/MISC.
- `commission_hvac_order_settings`: labor/discounts/COGS/overhead per order.
