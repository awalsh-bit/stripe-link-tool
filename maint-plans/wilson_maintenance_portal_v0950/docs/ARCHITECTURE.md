# Wilson Maintenance Portal - Recommended Production Architecture

## 1. Fit with the existing Wilson dashboard

The existing Wilson routing proof of concept already uses Flask and SQL Server. The maintenance module should share the authenticated Wilson dashboard shell but remain a separate application area instead of adding more routes and HTML strings to one large `dashboard.py` file.

Suggested structure:

```text
WilsonDashboard/
  app.py
  blueprints/
    maintenance_public/
      routes.py
      forms.py
      services.py
    maintenance_admin/
      routes.py
      permissions.py
      services.py
    maintenance_quotes/
      routes.py
      pricing.py
      pdf.py
    appliance_reports/
      routes.py
      templates.py
      scoring.py
      pdf.py
  templates/
    maintenance_public/
    maintenance_admin/
    maintenance_quotes/
    appliance_reports/
  static/
    maintenance/
  integrations/
    stripe_service.py
    netsuite_service.py
    object_storage.py
    email_service.py
  repositories/
    maintenance_repository.py
  jobs/
    maintenance_interval_scheduler.py
    filter_due_scheduler.py
    renewal_scheduler.py
```

Use the same header, footer, typography, cards, buttons, badges, tables, and role model as the routing, accounting, and quote-follow-up tools.

## 2. Separation of public and internal surfaces

### Public application

The public site should expose only:

- maintenance landing page,
- appliance enrollment,
- HVAC enrollment,
- Stripe SetupIntent confirmation,
- enrollment confirmation,
- secure customer acknowledgments.

The public browser should never receive the full household database, due queue, card identifiers, internal notes, reports for other households, or trusted plan calculations.

### Internal application

The internal dashboard should require Wilson authentication and role checks:

- **Maintenance dispatcher / client care:** due queue, contact, payment readiness, scheduling, NetSuite order action.
- **Service technician:** assigned visits, asset inventory, filter records, mobile field health protocol, photos.
- **Sales / house-manager liaison:** custom quote builder and approved household summary.
- **Manager / admin:** pricing configuration, templates, score versions, adjustments, cancellations, audit review.

## 3. Core data model

The household is the shared parent record. Appliance and HVAC programs remain separate subscriptions under the same address.

```text
Household
  |- Contacts
  |- Payment profiles
  |- Assets
  |    |- Appliance / HVAC metadata
  |    |- IMUC frequency
  |    |- Filter inventory
  |- Subscriptions
  |    |- Covered assets
  |    |- Pricing snapshot
  |    |- Renewal and cancellation state
  |- Maintenance intervals / visits
  |    |- Interval charge
  |    |- Stripe PaymentIntent
  |    |- NetSuite service order
  |    |- Report requirement
  |- Health reports
  |- Custom quotes
  |- Activity / audit log
```

Do not infer that two records are the same household from name alone. Use normalized address, verified contact, and deliberate merge tools.

## 4. Confirmed pricing and cadence logic

### Standard appliances and IMUC

- Standard appliance: $149.95 per appliance per year for one visit.
- IMUC: $249.95 per visit.
- A new IMUC defaults to two annual visits.
- If the customer chooses one visit, store that election on the asset/subscription snapshot.

### Estate automatic crossover

The browser may show the crossover in real time, but the server must independently recalculate it:

```text
per_appliance_total =
    standard_count x 149.95
  + imuc_count x 249.95
  + selected_second_imuc_count x 249.95

estate_annual_total =
    1195.00
  + max(0, asset_count - 15) x 60.00
  + selected_second_imuc_count x 249.95
```

When Estate Annual is lower, the server should persist Estate Annual even if a stale or modified browser submits `per_appliance`.

### Estate base-plus proposal

- First 15 appliances included.
- Annual: $60 per appliance above 15.
- Preferred: $100 per appliance above 15.
- Concierge: $150 per appliance above 15.
- 26+ appliances: management review flag; do not block quote calculation.

Keep the pricing snapshot on each subscription and quote so future plan changes do not rewrite historical transactions.

### Two-visit plans

Estate Preferred, Estate Concierge, and both HVAC tiers include two visits. The recommended implementation is:

- charge the annual amount at the first scheduled interval in the plan year,
- create the second interval with zero additional plan charge,
- still allow parts, repairs, or excluded work to generate separate authorized charges.

### One-visit plans with second IMUC service

Create two interval records:

1. whole-home or first IMUC interval,
2. second IMUC interval with $249.95 per selected icemaker.

This makes the office button reflect the exact amount being charged at that time.

## 5. Enrollment workflow

```text
Customer chooses Appliance or HVAC
  -> enters equipment and contact/address
  -> server validates service area and plan rules
  -> server recalculates trusted price and automatic crossover
  -> household/contact/assets saved as pending enrollment
  -> server creates/reuses Stripe Customer
  -> server creates SetupIntent
  -> browser confirms payment method through Stripe.js
  -> webhook/server confirms reusable payment method
  -> customer accepts renewal and scheduled-charge language
  -> subscription saved with pricing snapshot
  -> first plan-year intervals created
  -> internal enrollment-review queue
```

Use an idempotency token for the enrollment submission so a browser retry cannot create duplicate households or subscriptions.

## 6. Stripe design

### Store only references

Store:

- Stripe customer ID,
- Stripe payment-method ID,
- card brand, last four, and expiration for display,
- SetupIntent ID/status,
- PaymentIntent IDs/statuses,
- timestamps and error codes needed for support.

Never store full card number, CVC, or raw payment payloads.

### Charge at scheduled maintenance

When an authorized office user presses **Charge card**:

1. Load the maintenance interval by ID.
2. Recalculate or verify the trusted amount on the server.
3. Verify the interval is chargeable and not already paid.
4. Verify an active payment profile belongs to the same household/subscription.
5. Create a PaymentIntent using an idempotency key such as:

```text
maintenance-visit:{visit_id}:attempt:{attempt_number}
```

6. Let Stripe webhook events become the source of truth for success/failure.
7. Write an audit event.
8. Enable or queue service-order generation according to Wilson policy.

Do not accept the amount, customer ID, or payment-method ID from browser JavaScript as trusted data.

## 7. Renewal and cancellation

Plans renew annually until canceled by the customer.

Recommended model:

- `RenewalDate` begins a new plan year and creates the next year's intervals.
- Renewal itself does not charge the card.
- The annual charge remains attached to the first scheduled maintenance interval.
- Cancellation stops future, unperformed plan-year generation after the effective date.
- Preserve completed visits, reports, payments, quote snapshots, and audit history.
- Store who canceled, the request channel, timestamp, effective date, and notes.

The exact refund/proration policy is not yet defined and should remain a configurable policy rather than hard-coded logic.

## 8. Scheduling and dispatcher prompts

Run a scheduled job daily:

1. Create any missing intervals for active subscriptions.
2. Mark intervals due within the configured lead window.
3. Mark overdue intervals.
4. Refresh charge eligibility.
5. Flag missing/expired payment methods.
6. Attach filters due near the visit.
7. Flag required Concierge health reports.
8. Avoid duplicate service orders.
9. Notify the appropriate internal team.

The interval must exist before the NetSuite service order. This lets the office review contact, amount, filter needs, and access notes before creating operational work.

## 9. NetSuite integration boundary

Keep a provider interface even though NetSuite is the expected destination:

```python
class ServiceOrderProvider:
    def create_maintenance_order(self, visit_id: int) -> ServiceOrderResult:
        ...
```

The service should receive only a visit ID, then load all trusted household, asset, plan, scope, payment, filter, and note data from SQL Server.

Store:

- provider name,
- external order ID/number,
- request idempotency key,
- request/response status,
- created/updated timestamps,
- last error safe for internal display.

The prototype button intentionally stops at `Queued - NetSuite integration pending`.

## 10. Filter management

Track filter records independently from plan coverage.

Suggested coverage codes:

- `INCLUDED` - material is included in the plan.
- `MANAGED_BILLED_SEPARATELY` - Wilson tracks/sources the filter; material is billed separately.
- `TRACK_ONLY` - record exists for service visibility, but no management promise is made.

Current rules:

- Estate Concierge: standard refrigerator water, refrigerator air/food-preservation, freezer water, and IMUC water filters included.
- Other appliance plans: filter material not included.
- HVAC $400 tier: filter inventory and management; material currently modeled as billed separately.

Store part number/size, quantity, location, interval, last changed date, next due date, source, cost, and visit linkage.

## 11. Custom quote workflow

```text
House manager sends complete appliance list
  -> Wilson enters grouped inventory and quantities
  -> quote pricing service calculates base + overage + IMUC add-ons
  -> authorized user may add a labeled adjustment
  -> 26+ appliance flag requires management review
  -> quote snapshot saved
  -> branded PDF/share link generated
  -> status moves Draft -> Sent -> Accepted / Declined / Expired
  -> accepted quote can seed household onboarding
```

Never rebuild an old quote from current plan prices. Persist every line, rate, count, term version, and total used when the quote was issued.

## 12. Appliance health reports

The Wilson report uses the same broad customer experience as the supplied HVAC report:

- overall score and grade,
- useful vitals,
- score breakdown,
- equipment and inspection details,
- corrective measures,
- educational report information,
- service summary and photos.

### Starter score

For v0.2:

- every applicable checkpoint has equal weight,
- rating 5 receives full points,
- ratings 1-4 create category deductions,
- N/A checkpoints are excluded,
- vitals are informational and not scored.

Production must calculate the score server-side and save:

- score-template code/version,
- checkpoint definitions used,
- ratings/status/notes,
- category losses,
- final score/grade/condition.

When Wilson later tunes appliance-specific weights, old reports must continue to render from their saved snapshot.

### Report storage

- Save structured report data in SQL Server.
- Save photos and generated PDFs in private object storage.
- Store only storage keys and metadata in SQL.
- Customer links should be time-limited or authenticated.
- Finalized reports should be immutable; corrections create a revision.

## 13. Background jobs

Recommended jobs:

- `maintenance_interval_scheduler` - creates and updates visit intervals.
- `maintenance_payment_reconciliation` - consumes Stripe webhooks and retries safe failures.
- `maintenance_filter_scheduler` - updates due filter status.
- `maintenance_renewal_scheduler` - creates next plan-year intervals.
- `maintenance_report_pdf_worker` - generates final PDF after report finalization.
- `maintenance_quote_expiration` - marks stale proposals expired.

Use a real job runner and durable queue in production, not browser timers.

## 14. Security and operations

Minimum production requirements:

- single sign-on or authenticated Wilson user accounts,
- role-based permissions,
- internal pages unavailable to public users,
- CSRF protection,
- server-side validation and trusted pricing,
- SQL least-privilege service account,
- HTTPS,
- secret manager/environment variables,
- audit log for pricing, payment, scheduling, reports, quotes, and cancellation,
- file type/size validation and malware scanning for uploads,
- backups and tested restores,
- retention policy for customer records and reports,
- production WSGI server/reverse proxy rather than Flask's development server.

## 15. Recommended implementation sequence

1. Put the current dashboard behind authentication and roles.
2. Create the v0.2 SQL schema in a development database.
3. Replace `assets/store.js` reads with household/plan API endpoints.
4. Implement server-side pricing and enrollment idempotency.
5. Integrate Stripe SetupIntent and PaymentIntent webhooks.
6. Implement due-interval scheduler and dispatcher queue.
7. Implement quote persistence and PDF snapshot.
8. Implement report persistence, photo storage, scoring versions, and PDF generation.
9. Connect the NetSuite service-order provider.
10. Pilot internally before publishing customer enrollment.
