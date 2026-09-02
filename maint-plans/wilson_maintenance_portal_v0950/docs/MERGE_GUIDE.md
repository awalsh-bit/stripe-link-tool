# Wilson Maintenance Portal → Main Wilson Dashboard Merge Guide

_Last updated: 2026-08-24_
_Current maintenance prototype: v0.9_
_Status: architecture / implementation map — merge not yet executed_

## 1. Purpose

This document maps the Wilson Maintenance Portal prototype into the main Wilson internal dashboard/tool. It is intended for the AI/developer who will perform the merge and should be read together with:

1. `WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md` — authoritative maintenance business rules and UX decisions.
2. `wilson_routing_dashboard_context (2).md` — existing routing/SQL Server/EPASS context.
3. Latest maintenance prototype ZIP — currently `wilson_maintenance_portal_v09.zip`.
4. `docs/API_CONTRACT.md` — production API direction.
5. `docs/ARCHITECTURE.md` — maintenance production architecture direction.
6. `docs/V05_DECISIONS.md` through `docs/V09_DECISIONS.md` — field/report UX evolution.

This is **not** a request to copy the standalone prototype into production unchanged. The prototype proves workflows and UX. The merge should preserve those workflows while replacing browser-local demo state with authenticated Flask routes, SQL Server persistence, secure integrations, and the existing Wilson dashboard shell.

---

## 2. Core merge decision

### Maintenance becomes a module inside the Wilson dashboard

Do **not** create a second internal dashboard application for maintenance.

The finished internal architecture should look conceptually like:

```text
Wilson internal dashboard
|
|-- Home
|-- Accounting
|-- Sales Tools
|-- Routing / Capacity
|-- Maintenance               <-- new module
|    |-- Command Center
|    |-- Households
|    |-- Invoice Import
|    |-- Filters
|    |-- Health Reports
|    |-- Quotes
|    |-- Plan Setup
|    `-- Activity
|
|-- User Admin
`-- Sign Out
```

Maintenance should reuse the main tool's:

- authenticated user/session,
- user ID and display name,
- roles/permissions,
- navigation/header/footer,
- visual design system,
- SQL Server connection conventions,
- audit conventions,
- payment integration conventions,
- production hosting/deployment method.

### Public enrollment remains a separate surface

The customer-facing maintenance registration pages should **not** expose the internal Wilson dashboard.

They can live in the same Flask codebase, but must have a separate public route group/blueprint and a tightly restricted public API.

Recommended separation:

```text
/internal/maintenance/...       authenticated Wilson staff only
/field/maintenance/...          authenticated Wilson technicians only
/maintenance/...                public customer enrollment pages
/api/maintenance/public/...     public, rate-limited, narrow API
/api/maintenance/internal/...   authenticated/authorized API
```

Exact prefixes can change to match the main app, but the security boundary should remain.

---

## 3. Important discovery step before touching production code

The routing context describes an earlier Flask proof of concept centered around `C:\WilsonRouting\dashboard.py` and `WilsonRouting` SQL Server. It also records that authentication was not yet implemented in that routing prototype.

The current Wilson home dashboard, however, now has individual user logins and the maintenance field workflow is expected to inherit technician identity from those existing logins.

Therefore, **before coding the merge**, inspect the current live/main dashboard and document these exact integration anchors:

### Application anchors to identify

- repository/root folder,
- Flask app entry point,
- whether an app factory is already used,
- route/blueprint organization,
- base Jinja layout template,
- nav component/template,
- current CSS bundle/design system,
- current JavaScript organization,
- current authentication/session library,
- `current_user` or equivalent object,
- user table and role table,
- current audit/event logging helper,
- current SQL connection/repository helper,
- current Stripe/payment helper,
- current file upload/storage mechanism,
- current PDF-generation mechanism,
- current email helper,
- current background-job/task scheduler,
- deployment process/server.

### Required output of discovery

Before the first maintenance merge commit, create a short implementation note containing:

```text
MAIN APP ROOT:
APP ENTRY POINT:
BASE TEMPLATE:
NAV TEMPLATE:
AUTH CURRENT USER OBJECT:
USER ID FIELD:
USER DISPLAY NAME FIELD:
ROLE/PERMISSION METHOD:
SQL CONNECTION HELPER:
AUDIT HELPER:
STRIPE HELPER:
EMAIL HELPER:
FILE/OBJECT STORAGE:
BACKGROUND JOB METHOD:
PRODUCTION SERVER:
```

Do not invent parallel infrastructure if the main dashboard already provides it.

---

## 4. Target code structure

If the main dashboard is still largely monolithic, the maintenance merge is the right time to create a modular pattern **without breaking existing routes**.

Recommended target:

```text
WilsonDashboard/
  app.py                         # or existing app entry point

  blueprints/
    maintenance_admin/
      __init__.py
      routes.py
      permissions.py

    maintenance_field/
      __init__.py
      routes.py
      permissions.py

    maintenance_public/
      __init__.py
      routes.py

    maintenance_quotes/
      __init__.py
      routes.py

    maintenance_reports/
      __init__.py
      routes.py

  services/
    maintenance/
      pricing.py
      enrollment.py
      scheduling.py
      command_center.py
      field_visits.py
      scoring.py
      lifecycle.py
      filters.py
      reports.py
      quotes.py
      invoice_import.py
      reconciliation.py

  repositories/
    maintenance_repository.py

  integrations/
    stripe_service.py
    netsuite_service.py
    epass_service_order_feed.py
    email_service.py
    object_storage.py

  jobs/
    maintenance_interval_scheduler.py
    maintenance_due_refresh.py
    maintenance_filter_scheduler.py
    maintenance_service_order_reconciliation.py
    maintenance_report_delivery.py

  templates/
    maintenance/
      admin/
      field/
      public/
      reports/
      quotes/

  static/
    maintenance/
      css/
      js/
      icons/
```

If the existing main tool already has equivalent folders, fit maintenance into those conventions instead of forcing this exact tree.

### Hard rule

Do **not** paste the maintenance prototype HTML/JS into the original routing `dashboard.py` as giant strings.

The routing project already became fragile from manual edits to one large file. Maintenance has enough complexity that it needs isolated templates, services, and persistence from the start.

---

## 5. Database decision

### Recommended: use the existing `WilsonRouting` SQL Server database initially

The existing internal routing project already uses:

```text
Server: localhost\SQLEXPRESS
Database: WilsonRouting
```

The maintenance schema intentionally prefixes its objects with `Maintenance...`, so it can coexist with routing objects cleanly.

Example:

```text
Existing routing tables
  dbo.RouteJobs
  dbo.RouteJobLines
  dbo.Trucks
  dbo.SalesHolds
  dbo.RawEpassDispatchRows
  dbo.ImportBatches
  dbo.PointRules

Maintenance tables
  dbo.MaintenanceHouseholds
  dbo.MaintenanceContacts
  dbo.MaintenancePlans
  dbo.MaintenanceAssets
  dbo.MaintenanceSubscriptions
  dbo.MaintenanceVisits
  ...
```

### Why same database is preferred for phase 1

- one SQL connection convention,
- simpler deployment,
- simpler backups,
- easier internal reporting,
- easier EPASS/NetSuite reconciliation,
- less duplicate customer/order mapping infrastructure.

Do **not** create direct foreign keys from maintenance households to `RouteJobs` or other routing tables just because they are in the same database. Operational orders are external-system snapshots and should be linked by explicit external references/match records.

### Production migration rule

Use versioned, non-destructive migration scripts. Do not run a development script that drops/recreates tables against real data.

---

## 6. Existing maintenance SQL schema: what can be reused

The prototype already includes a strong starter schema in:

```text
sql/maintenance_schema.sql
```

Current major objects include:

```text
MaintenanceSchemaVersions
MaintenanceHouseholds
MaintenanceContacts
MaintenancePlans
MaintenanceAssets
MaintenancePaymentProfiles
MaintenanceSubscriptions
MaintenanceSubscriptionAssets
MaintenanceVisits
MaintenanceVisitAssets
MaintenanceFilters
MaintenanceHealthReports
MaintenanceHealthReportMeasurements
MaintenanceHealthReportItems
MaintenanceHealthReportCategoryLosses
MaintenanceHealthReportTasks
MaintenanceHealthReportCorrectiveMeasures
MaintenanceHealthReportPhotos
MaintenanceQuotes
MaintenanceQuoteItems
MaintenanceInvoiceImportBatches
MaintenanceInvoiceImportFiles
MaintenanceInvoiceImportLines
MaintenanceActivityLog
```

These are a good production starting point, but the SQL file predates several v0.5-v0.9 workflow decisions and should **not** be treated as complete.

---

## 7. SQL additions required before the real merge

### 7.1 Property areas

The customer and technician UX now depends heavily on areas such as Main House, Casita, Bar, Game Room, Studio, etc.

Create a normalized area table rather than relying only on `MaintenanceAssets.LocationName`.

Suggested:

```sql
CREATE TABLE dbo.MaintenanceAreas (
    AreaId INT IDENTITY(1,1) PRIMARY KEY,
    HouseholdId INT NOT NULL,
    AreaName NVARCHAR(150) NOT NULL,
    SortOrder INT NULL,
    AreaStatus NVARCHAR(30) NOT NULL DEFAULT 'Active',
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    FOREIGN KEY (HouseholdId) REFERENCES dbo.MaintenanceHouseholds(HouseholdId)
);
```

Add `AreaId` to `MaintenanceAssets`. Keep a text location snapshot if desired for reporting/import history.

### 7.2 Household billing method / AR

Add explicit billing method fields rather than inferring AR from a missing Stripe card.

Suggested fields on `MaintenanceHouseholds` or a dedicated billing profile table:

```text
BillingMethodCode       CARD_ON_FILE | AR_ACCOUNT
AccountTerms            Net 30 / Net 15 / etc.
ExternalARCustomerId    EPASS/NetSuite account reference if applicable
ARStatus                Active / Hold / Review
```

A valid AR household is considered payment-ready for Command Center purposes even with no Stripe payment method.

### 7.3 Raw technician inspection data

Do **not** write technician field input directly into final health-report tables only.

Create an immutable-ish field inspection layer so Wilson can:

- autosave as the technician works,
- resume interrupted visits,
- regenerate a report,
- correct a report with revision history,
- prove what the technician actually entered,
- separate field facts from customer presentation.

Recommended tables:

```text
MaintenanceFieldInspections
MaintenanceFieldInspectionChecks
MaintenanceFieldInspectionPhotos
```

Suggested `MaintenanceFieldInspections` fields:

```text
FieldInspectionId
VisitId
VisitAssetId
HouseholdId
AssetId
TechnicianUserId
TechnicianDisplayNameSnapshot
InspectionStatus            NOT_STARTED | IN_PROGRESS | FIELD_COMPLETE | REPORT_GENERATED
StartedAt
CompletedAt
ApproxAgeYears
LifecycleTierCode
ExpectedLifeYears
LifecycleStage
ConditionScore
LifecycleScore
FinalHealthScore
GradeLabel
SerialTagPhotoStorageKey
TechnicianSummary
CreatedAt
UpdatedAt
VersionStamp
```

Suggested `MaintenanceFieldInspectionChecks` fields:

```text
FieldInspectionCheckId
FieldInspectionId
CheckpointCode
CheckpointLabelSnapshot
Performed
Rating                     1-5
StatusLabel                PASS | MONITOR | ACTION
ObservedValue
ObservedUnit
TargetText
ReadingJson                for multiple structured readings
TechnicianNote
SortOrder
CompletedAt
```

### 7.4 Report delivery tracking

Customer report email state should not be a vague text field on the visit.

Recommended table:

```text
MaintenanceReportDeliveries
```

Store:

```text
ReportDeliveryId
HealthReportId
HouseholdId
RecipientEmail
DeliveryStatus             READY | QUEUED | SENT | FAILED
ProviderMessageId
QueuedAt
SentAt
FailedAt
FailureReason
ReportRevisionNumber
CreatedByUserId
```

This supports resend/audit without overwriting history.

### 7.5 Technician assignment / authenticated user

Add the authenticated Wilson user ID to the visit and/or inspection:

```text
AssignedTechnicianUserId
StartedByUserId
CompletedByUserId
```

Names should be display snapshots for historical reporting, but the internal user ID is the authoritative identity.

### 7.6 Lifecycle configuration

Move brand-tier and expected-life defaults out of JavaScript into server-controlled configuration.

Recommended tables:

```text
MaintenanceBrandTiers
MaintenanceExpectedLifeRules
```

Example:

```text
Brand = Thermador -> Luxury
Brand = KitchenAid -> Mass Premium
Brand = Bosch -> Mass Premium
Brand = Whirlpool -> Mass
```

Expected life should key off both category + tier.

### 7.7 Protocol configuration

Long-term, field protocols should be data-driven rather than hard-coded in browser JS.

Recommended:

```text
MaintenanceProtocolTemplates
MaintenanceProtocolCheckpoints
```

Version them. A completed inspection should retain the protocol version/checkpoint wording that existed on the service date.

---

## 8. Do not migrate `store.js` as production persistence

The prototype's `assets/store.js` is a demo data/state engine.

It contains:

- sample Reynolds/Davenport/Torres/Mercer households,
- demo visits,
- demo payment references,
- browser-local operational state,
- prototype report generation logic,
- prototype enrollment logic.

### Production rule

`store.js` is a behavioral reference only.

Replace its responsibilities with:

```text
browser UI
   -> Flask route/API
      -> maintenance service
         -> repository
            -> SQL Server
```

Do not preserve sample household IDs such as `hh_reynolds` or use localStorage as authoritative state.

---

## 9. Prototype-to-production page map

| Prototype | Production destination | Notes |
|---|---|---|
| `admin.html` | `maintenance/admin/command_center.html` | Main internal maintenance landing page |
| `household.html` | `maintenance/admin/household.html` | One residence, separate appliance + HVAC programs |
| `tech-maintenance.html` | `maintenance/field/visit.html` | Authenticated mobile field tool |
| `report-view.html` | `maintenance/reports/report.html` | Locked customer report presentation |
| `index.html` | `maintenance/public/index.html` | Public Appliances vs HVAC landing |
| `appliance-signup.html` | `maintenance/public/appliance_signup.html` | Public icon-first enrollment |
| `hvac-signup.html` | `maintenance/public/hvac_signup.html` | Public HVAC enrollment |
| _(retired v0.9.23)_ | — | The quote builder was merged into the enrollment screen; a quote is an unaccepted enrollment |
| `quote-view.html` | `maintenance/quotes/view.html` | Proposal / printable customer view |
| invoice import section inside `admin.html` | `maintenance/admin/invoice_import.html` | Internal PDF import workflow |

### Shared styles/icons

The appliance SVG icon library is worth preserving as a maintenance static asset.

The prototype CSS should be split into:

- styles already provided by main Wilson dashboard,
- maintenance-specific component styles,
- mobile field-tool styles,
- report/print styles.

Do not duplicate main header/nav CSS inside maintenance.

---

## 10. Navigation integration

### Main internal navigation

Add one clean top-level item:

```text
Maintenance
```

Recommended sub-navigation inside the maintenance module:

```text
Command Center
Households
Invoice Import
Filters
Health
Quotes
Plan Setup
Activity
```

### Badge behavior

The main `Maintenance` nav item should eventually support an attention count, e.g.:

```text
Maintenance  [4]
```

Count only genuinely actionable exceptions, not every upcoming visit.

Suggested badge sources:

- payment method failed/missing for a due household,
- charged/AR-posted visit with no service order match,
- overdue visit,
- report delivery failure,
- unresolved field `ACTION` item requiring office follow-up.

---

## 11. Authentication and permissions map

Current direction: technician identity comes from the existing Wilson login. Do not add a technician selector in production.

Suggested permission capabilities rather than hard-coded job titles:

```text
maintenance.view
maintenance.manage_households
maintenance.charge
maintenance.schedule
maintenance.manage_filters
maintenance.invoice_import
maintenance.quote
maintenance.plan_admin
maintenance.field_visit
maintenance.report_review
maintenance.report_send
maintenance.audit_view
```

Suggested role mapping:

### Technician

- `maintenance.view` limited to assigned/authorized visits
- `maintenance.field_visit`
- read household/asset details necessary for service
- no card charge
- no pricing configuration
- no customer payment details beyond safe status

### Client Care / Dispatch / Maintenance Office

- view Command Center
- manage household contact/access/timing
- charge card / mark AR action
- generate/verify service order
- manage filters
- review/send reports

### Sales

Potentially:

- maintenance quote builder
- invoice import/draft inventory
- household read access where appropriate
- no service/tech workflow unless separately authorized

### Admin

- all maintenance permissions
- plan/pricing configuration
- lifecycle brand-tier configuration
- protocol template configuration
- audit access

### Security rule

Every mutation must check server-side permission. Hiding a button is not authorization.

---

## 12. Technician identity linkage

Production field visit launch:

```text
Authenticated user clicks Launch Appliance Visit
        ↓
server checks maintenance.field_visit permission
        ↓
server loads exact VisitId
        ↓
server verifies visit belongs to requested household/program
        ↓
current authenticated UserId becomes technician identity
        ↓
field inspection autosave records UserId + display-name snapshot
```

The v0.9 rule must survive the merge:

> The tech tool never falls back to a demo/sample visit. Every launch carries an exact visit ID, and household/visit mismatches are blocked.

This prevents the Reynolds/Torres cross-launch issue that occurred during prototyping.

---

## 13. Household profile merge

A household is the shared parent for all maintenance relationships.

The household page should have two visually separate sections.

### Appliance Maintenance

Show:

- appliance plan,
- enrolled appliance count,
- next appliance interval,
- payment/AR status,
- filter-service status,
- last appliance maintenance,
- health-report status,
- one **Launch Appliance Visit** button when an appliance visit is available.

### HVAC Maintenance

Show:

- HVAC plan,
- system count,
- next HVAC interval,
- filter-management tier,
- payment/AR status,
- last HVAC maintenance,
- one **Launch HVAC Visit** button once that field workflow is built.

Do not use one generic `Launch Tech Tool` button for both categories.

---

## 14. Maintenance Command Center mapping

The Command Center replaces a giant due-queue table.

### Module A — Action Required

Highest priority.

Examples:

- card expired/missing/failed,
- AR account on hold,
- visit overdue,
- charged visit with no service order found,
- report delivery failed,
- field visit completed with an ACTION item requiring separate diagnosis.

Sort by severity, then age.

### Module B — Ready to Charge

A visit qualifies inside the Wilson flexible charge window:

```text
DueDate - 14 days <= today <= DueDate + 14 days
```

Display preferred customer timing but do not make that preference a hard blocker unless Wilson later defines it that way.

For AR households, replace `Charge Card` with the appropriate `Post/Proceed on AR` action.

### Module C — Schedule / Ticket

Visits that are financially cleared but need operational work.

Examples:

- card charged, service order not created,
- AR approved, service order not created,
- service order candidate found but match needs confirmation.

### Module D — Completed & Health

Show:

- recently completed field visits,
- report generation status,
- reports ready to review/email,
- reports sent,
- follow-up flags from health checks.

### Upcoming Maintenance

Lower-priority section below the four operational modules. Show future intervals outside the immediate action window.

---

## 15. Charge workflow integration

The maintenance portal does not charge at customer enrollment.

### Enrollment

Use Stripe SetupIntent to place a reusable payment method on file.

Store only:

- Stripe customer ID,
- payment method ID,
- setup intent ID/reference,
- brand/last4/expiration for display,
- safe status/error metadata.

Never store PAN/CVC.

### Scheduled charge

Office action:

```text
Ready to Charge
  -> staff clicks Charge
  -> server reloads visit/subscription/household/payment profile
  -> server recomputes trusted amount
  -> server checks ±14-day eligibility
  -> server creates/reuses idempotent Stripe PaymentIntent
  -> SQL visit updated
  -> audit event written
  -> visit moves to Schedule / Ticket
```

The browser must never be trusted to submit the authoritative amount or Stripe payment-method ID.

### AR household

```text
Ready to Charge
  -> billing method = AR_ACCOUNT
  -> staff clicks Proceed on AR / Post to Account
  -> no Stripe call
  -> audit event written
  -> visit moves to Schedule / Ticket
```

Exact accounting posting behavior can be tied to NetSuite later.

---

## 16. Public enrollment → internal household flow

Recommended production flow:

```text
Customer visits public maintenance landing page
        ↓
Appliances or HVAC
        ↓
server-backed pricing preview
        ↓
customer enters contact/property details
        ↓
Stripe SetupIntent (if card account)
        ↓
server validates + recalculates plan
        ↓
MaintenanceHousehold created or matched/reviewed
        ↓
assets created
        ↓
subscription + pricing snapshot created
        ↓
maintenance intervals created
        ↓
Command Center shows enrollment review / upcoming visit
```

### Household matching rule

Never merge by display name alone.

Use combinations of:

- normalized service address,
- EPASS/NetSuite customer references,
- contact email/phone,
- manual review when uncertain.

---

## 17. Pricing service: single source of truth

Move all pricing logic from browser JavaScript into:

```text
services/maintenance/pricing.py
```

The customer UI may calculate optimistically for responsiveness, but the server result is authoritative.

The pricing service must preserve:

- $149.95 standard appliance/year,
- $249.95 IMUC/visit,
- IMUC defaults to 2 annual visits,
- Estate Annual $1,195,
- Estate Preferred $1,995,
- Estate Concierge $2,995,
- current base-plus draft above 15 appliances,
- IMUC-aware automatic Estate selection,
- Concierge as an elective upgrade,
- HVAC $200/system/year for two visits,
- HVAC + filter management $400/system/year for two visits.

### Essential regression case

Five IMUCs at two visits each must recommend Estate Preferred rather than Estate Annual:

```text
Per Appliance     = $2,499.50
Estate Annual     = $2,444.75
Estate Preferred  = $1,995.00
```

---

## 18. Wilson invoice import integration

The current PDF parser is valuable and should be retained as a service, not browser logic.

Prototype file:

```text
invoice_parser.py
```

Production direction:

```text
POST PDF(s)
  -> secure upload temp area
  -> invoice parser
  -> MaintenanceInvoiceImportBatches / Files / Lines
  -> staff review classifications/areas/include-exclude
  -> create household/enrollment draft or estate quote
```

Preserve exact backend fields:

- source invoice number,
- quantity,
- model,
- exact product description,
- manufacturer/category line,
- serial when present,
- area heading,
- classification confidence/review flag.

Exclude non-appliance lines such as installs, delivery, panels, accessories, hoses, cords, credits, payments, and promotional lines.

### Split invoices

Support multiple PDFs in one import batch because Wilson invoices can reference a split companion invoice.

Do not silently invent an area when the invoice does not identify one; use `Unassigned — Review`.

---

## 19. Tech field workflow merge

The field tool should be a mobile-first authenticated Jinja/JS page backed by autosave APIs.

### Visit home

Show:

- residence name,
- visit/season/date,
- authenticated tech name if helpful,
- overall completion progress,
- remaining count,
- attention count,
- next suggested appliance,
- appliances grouped by area.

### Appliance card states

```text
Not Started
In Progress
Complete
Monitor
Needs Follow-up
```

### Check interaction

No slider.

Use five large buttons:

```text
1 Poor
2 Concern
3 Monitor
4 Good
5 Excellent
```

Mapping:

```text
1-2 -> ACTION / Needs Follow-up
3   -> MONITOR
4-5 -> PASS
```

`Performed` remains an explicit required field/action. Rating a checkpoint does not automatically mean the tech performed it.

### Autosave

Every material change should autosave to the server with a short debounce:

- age,
- lifecycle override,
- checkpoint performed state,
- 1-5 rating,
- readings,
- notes,
- photos.

Use optimistic concurrency / rowversion so two sessions do not overwrite one another silently.

---

## 20. Photo storage

Production photos should not live in SQL as raw blobs and should not live only in browser memory.

Recommended flow:

```text
phone camera/file picker
  -> authenticated upload endpoint
  -> object storage / approved Wilson file store
  -> DB stores storage key + metadata
```

Every appliance requires one serial-tag photo.

Checkpoint photos are optional and used only when the technician believes they add value.

Store:

- asset ID,
- visit ID,
- inspection ID,
- optional checkpoint ID/code,
- photo type (`SERIAL_TAG`, `CHECKPOINT`, `GENERAL`),
- caption,
- technician user ID,
- timestamp.

---

## 21. Appliance scoring and lifecycle service

Server-side module:

```text
services/maintenance/scoring.py
services/maintenance/lifecycle.py
```

### Current score weighting

```text
75% current condition / field health checks
25% lifecycle age
```

### Lifecycle stages

```text
Early Life             < 40% of expected life
Mid Life               40-70%
Mature                  70-90%
Replacement Planning   90%+
```

### Brand tier defaults

Initial examples:

```text
Luxury / Long-Life
  Sub-Zero
  Wolf
  Cove
  Miele
  Thermador
  True

Mass Premium
  Bosch
  KitchenAid
  Monogram
  Cafe
  Fisher & Paykel
  JennAir

Mass
  Whirlpool
  Maytag
  mainstream GE
  mainstream LG
  Samsung
  Frigidaire
```

The technician can override a misclassification, but the default should come from server configuration based on brand.

### Important philosophy

Age is a planning signal, not a declaration that an older appliance is failing.

A well-performing older luxury appliance can retain a good health score while separately showing `Mature` or `Replacement Planning`.

---

## 22. Health protocol configuration

The master context contains the current appliance protocols.

The first fully detailed production protocol is refrigeration.

### Refrigeration required checks

1. Compartment Temperature Performance
2. Evaporator Frost Pattern
3. Condenser Temperature & Coil Service
4. Components & Operating Sound
5. Airflow & Filter Status

Preserve the specific refrigeration logic in `WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md`, including:

- fresh food 35–38°F target guidance,
- freezer near 0°F,
- actual temp compared with setpoint,
- condenser surface temperature measured by temp gun,
- condenser TD reference roughly 15–30°F above ambient,
- surface heat reference roughly under 110–120°F,
- even evaporator frost pattern,
- no isolated ice ball/oil/leak indicators,
- force accessible components to run/listen for abnormal sound,
- vacuum accessible condenser,
- filter service action where enrolled.

Do not hard-code field interpretations that turn one reading into a definitive repair diagnosis. Flag abnormal data for technician review/follow-up.

---

## 23. Field completion → report generation

This is a critical production workflow.

### Appliance completion gate

An appliance can be completed only when:

- required age/lifecycle context is present,
- required serial-tag photo exists,
- every required checkpoint is marked performed,
- every required checkpoint has a 1-5 rating,
- required structured readings are present.

Then:

```text
FieldInspection -> FIELD_COMPLETE
        ↓
server calculates score
        ↓
server generates/updates HealthReport revision
        ↓
PDF generated from locked report template
        ↓
report status -> READY_TO_REVIEW / READY_TO_EMAIL
```

### Whole visit completion

When all visit assets are complete:

```text
MaintenanceVisit.VisitStatus = Completed
MaintenanceVisit.CompletedAt = now
```

The office Command Center should immediately surface the report package.

### No manual report builder

Do not reintroduce the old standalone Appliance Health Report Builder.

A health report exists because a technician completed field inspection data.

A recovery/regenerate action is acceptable only when valid completed field data already exists.

---

## 24. Locked customer health-report presentation

The customer report style tested with Torres Home is the design baseline for every appliance category.

Preserve the structure:

1. Cover / Appliance Health Report / score / household / address / service date / technician
2. Appliance Vitals
3. Score Breakdown
4. Inspection Details
5. Corrective Measures
6. Report Information / limitations
7. Service Summary / photo record

The data changes by appliance type; the visual report language should remain consistent.

Report revisions should preserve history. If a tech correction regenerates a report, increment the revision rather than silently replacing the historical record.

---

## 25. Report email integration

Recommended office workflow:

```text
tech finishes all appliances
  -> reports auto-generated
  -> visit appears under Completed & Health
  -> office clicks Review Reports
  -> office clicks Email to Client
  -> server queues email
  -> delivery status stored
```

Later Wilson may choose to auto-send low-risk/fully complete reports, but the initial production version should keep an office review/send step.

Email should include either:

- PDF attachment(s), or
- a secure customer share link,

based on Wilson's chosen mail/storage implementation.

Do not expose internal notes that are not intended for the customer report.

---

## 26. EPASS / NetSuite service-order integration strategy

### Important separation from routing import

The existing routing importer intentionally focuses on `S000...` and `R000...` routing tickets and ignores `SV00...` service orders for routing capacity.

Do **not** change routing capacity logic merely to satisfy maintenance reconciliation.

### Transitional maintenance reconciliation

Wilson plans to feed a daily EPASS export containing active sales/service orders into the existing tool.

Create a separate maintenance operational feed path such as:

```text
jobs/import_epass_service_orders.py
integrations/epass_service_order_feed.py
```

Recommended staging tables:

```text
MaintenanceServiceOrderImportBatches
MaintenanceServiceOrderImportRows
MaintenanceServiceOrderMatches
```

Store raw external order data separately from maintenance visits.

### Matching flow

```text
Maintenance visit charged / AR-approved
        ↓
visit expects service order
        ↓
latest EPASS/NetSuite service-order feed imported
        ↓
reconciliation job searches for explicit external reference first
        ↓
if not available, candidate match by customer/address/date/type
        ↓
CONFIRMED / CANDIDATE / MISSING / MANUAL_OVERRIDE
```

### Best long-term method

When NetSuite order creation is available, write the Wilson `MaintenanceVisitId` into an external/custom reference field. Then reconciliation becomes deterministic rather than fuzzy.

### Command Center behavior

A financially cleared visit with no matching ticket should rise to **Action Required**.

Example:

```text
Torres Home
$249.95 charged 2 days ago
Service order: NOT FOUND
Action: Create / verify ticket
```

---

## 27. NetSuite service-order creation boundary

Do not put NetSuite-specific payload construction throughout UI routes.

Use an interface/service:

```python
class ServiceOrderProvider:
    def create_maintenance_order(self, visit_id: int):
        ...
```

The provider loads trusted visit/household/assets/filters/access notes from SQL.

Store on the visit/match record:

- provider,
- external service order ID,
- external order number,
- creation timestamp,
- idempotency key,
- request status,
- last sync time,
- error code/message.

The current prototype button may remain visually similar, but the production handler must be idempotent.

---

## 28. Background jobs

Maintenance needs scheduled server work even when no user has the page open.

Recommended jobs:

### Daily interval refresh

- create missing plan-year intervals,
- update due/overdue state,
- calculate ±14-day charge eligibility,
- flag billing exceptions.

### Filter scheduler

- identify filters due near upcoming visits,
- attach filter needs to visit prep,
- flag missing part numbers.

### Renewal scheduler

- create new plan year after renewal date,
- do not charge simply because renewal occurred,
- preserve existing cancellation rules.

### Service-order reconciliation

- import/read latest external order feed,
- match financially cleared visits,
- flag missing tickets.

### Report delivery

- process queued report emails,
- store provider result,
- retry safe transient failures,
- surface permanent failures in Action Required.

---

## 29. Audit requirements

Use the main Wilson dashboard's audit system if one exists.

At minimum audit:

- enrollment created/edited,
- household merged,
- plan changed,
- AR/card billing method changed,
- payment charged/failed,
- service order created/matched/overridden,
- filter changed,
- field visit started/completed,
- inspection edited after completion,
- report generated/regenerated/finalized,
- report emailed/failed,
- subscription canceled,
- pricing/protocol/lifecycle configuration changed.

Record authenticated user ID, timestamp, entity IDs, and safe before/after context where appropriate.

---

## 30. Public/internal security boundary

### Internal

- Wilson authentication required
- role/permission checks
- CSRF protection
- HTTPS
- no public exposure of internal routes

### Public enrollment

- rate limiting
- server-side validation
- idempotency keys
- Stripe.js / SetupIntent only
- no secret keys in browser
- server recalculates all pricing
- narrow responses; do not leak internal household records

### Photos/reports

- private object storage by default
- time-limited signed links or authenticated download
- no guessable public file paths containing customer names/addresses

---

## 31. Recommended merge implementation phases

### Phase 0 — Snapshot and branch

Before changing the main dashboard:

- back up `C:\WilsonRouting` / current app repository,
- back up `WilsonRouting` SQL database,
- create source-control branch,
- record current production/development behavior.

**Exit criterion:** existing dashboard can be restored quickly.

### Phase 1 — Main app integration anchors

- document auth/session/user object,
- document base template/nav,
- document DB helper,
- document payment/audit/email helpers,
- add empty Maintenance nav + blueprint returning a placeholder page.

**Exit criterion:** authenticated user can open `/maintenance` inside the normal Wilson shell and existing routes are untouched.

### Phase 2 — Maintenance SQL migration

- install `Maintenance...` tables into dev copy of `WilsonRouting`,
- add v0.9-required schema extensions from this guide,
- seed plan configuration,
- add repository layer.

**Exit criterion:** maintenance module can CRUD a test household entirely in SQL without localStorage.

### Phase 3 — Internal read-only Command Center + household

Port:

- Command Center UI,
- Households list/profile,
- appliance/HVAC section separation,
- due-window calculations,
- AR/card status display.

No real charge button yet.

**Exit criterion:** UI is driven entirely from SQL and exact household links are stable.

### Phase 4 — Invoice import and quote tools

- integrate PDF upload/parser,
- persist import batches/lines,
- create enrollment draft,
- port estate quote builder + PDF.

**Exit criterion:** office can upload a real Wilson split invoice and create a reviewed maintenance draft from SQL data.

### Phase 5 — Public appliance/HVAC enrollment

- port icon-first appliance enrollment,
- server pricing endpoint,
- public plan config endpoint,
- household match/review flow,
- SetupIntent integration.

**Exit criterion:** a test public signup creates a correct internal SQL household/subscription with no raw card data.

### Phase 6 — Real scheduled charging / AR

- Stripe PaymentIntent route,
- idempotency,
- ±14-day eligibility,
- AR proceed flow,
- audit events.

**Exit criterion:** test card charge and test AR visit move correctly from Ready to Charge to Schedule/Ticket.

### Phase 7 — Appliance field tool

- exact VisitId launch,
- authenticated technician identity,
- mobile visit home,
- area grouping,
- autosave,
- five-button checkpoint UX,
- serial photo requirement,
- refrigeration protocol first.

**Exit criterion:** technician can complete a real test refrigeration visit from a phone without desktop intervention.

### Phase 8 — Health report pipeline

- raw field inspection -> score,
- lifecycle service,
- locked customer report template,
- PDF generation/storage,
- revisioning,
- review/email queue.

**Exit criterion:** field completion automatically produces the Torres-style customer report with no office re-entry.

### Phase 9 — Service-order reconciliation

- daily EPASS active-order feed during transition,
- reconciliation/missing-ticket flags,
- later NetSuite create/sync provider.

**Exit criterion:** charged/AR-cleared maintenance with no ticket appears automatically in Action Required.

### Phase 10 — HVAC field workflow

Keep HVAC maintenance separate from appliance field visits and integrate the existing HVAC reporting process when ready.

**Exit criterion:** appliance and HVAC techs cannot accidentally launch one another's protocol.

---

## 32. First merge sprint: exact recommended tasks

If starting now, do **only** these tasks first:

1. Locate actual main dashboard source root.
2. Identify auth/current-user implementation.
3. Identify base layout/nav template.
4. Identify SQL helper/repository pattern.
5. Create `maintenance_admin` blueprint/module.
6. Add Maintenance navigation link.
7. Render a placeholder Maintenance Command Center inside the real dashboard shell.
8. Add the maintenance SQL schema to a **development copy** of `WilsonRouting`.
9. Build `maintenance_repository.py` for household + visit read operations.
10. Replace the prototype Command Center's sample/localStorage data with SQL queries.
11. Port the household profile next.
12. Do not connect Stripe, public enrollment, tech photos, or NetSuite until the internal data foundation is stable.

This gives Wilson a visible merged result early without mixing five integration problems into the first commit.

---

## 33. Query/view recommendations for Command Center

Instead of recreating all module logic in Python on every request, consider SQL views or repository queries for operational states.

Examples:

```text
vw_MaintenanceActionRequired
vw_MaintenanceReadyToCharge
vw_MaintenanceScheduleTicket
vw_MaintenanceCompletedHealth
vw_MaintenanceUpcoming
```

### Ready-to-charge condition concept

```sql
DueDate BETWEEN DATEADD(day, -14, CAST(GETDATE() AS date))
            AND DATEADD(day, 14, CAST(GETDATE() AS date))
```

Also require:

- active subscription,
- visit not completed/canceled,
- not already financially cleared,
- card profile Ready OR household AR status Active.

Keep exact business-status values centralized; do not spread magic strings across templates.

---

## 34. Status enums to centralize

Before merge, define shared enums/constants.

### Visit

```text
UPCOMING
DUE
OVERDUE
FINANCIALLY_CLEARED
SCHEDULED
IN_PROGRESS
COMPLETED
CANCELED
```

### Payment

```text
NOT_DUE
READY_TO_CHARGE
CHARGE_PENDING
PAID
AR_APPROVED
FAILED
ACTION_REQUIRED
```

### Service order

```text
NOT_EXPECTED
NOT_CREATED
QUEUED
CREATED
MATCH_CONFIRMED
MATCH_CANDIDATE
MATCH_MISSING
MANUAL_OVERRIDE
ERROR
```

### Field asset

```text
NOT_STARTED
IN_PROGRESS
COMPLETE
MONITOR
NEEDS_FOLLOWUP
```

### Report

```text
FIELD_IN_PROGRESS
GENERATING
GENERATED
READY_TO_REVIEW
READY_TO_EMAIL
EMAIL_QUEUED
SENT
DELIVERY_FAILED
```

Use DB codes + friendly UI labels rather than saving UI phrases as state.

---

## 35. Prototype code worth reusing vs rewriting

### Reuse/adapt

- custom appliance SVG icons,
- customer icon-card interaction concepts,
- drag/move area UX,
- IMUC/estate pricing test cases,
- PDF invoice parsing heuristics,
- quote calculation concepts,
- Command Center visual layout,
- household appliance/HVAC module layout,
- tech field screen hierarchy,
- five-button checkpoint UX,
- refrigeration field protocol,
- customer health-report HTML/CSS structure,
- report wording/limitations.

### Rewrite around server persistence

- `store.js`,
- demo IDs,
- localStorage state,
- client-only report generation,
- client-only pricing authority,
- demo Stripe references,
- fake NetSuite buttons,
- demo email queue,
- placeholder photo filename behavior.

### Do not carry forward

- any fallback that opens a sample household/visit,
- generic appliance/HVAC tech launch button,
- standalone manual health-report builder,
- slider rating control,
- sticky field header that blocks controls,
- plan-selection UX requiring ordinary customers to understand Wilson's pricing matrix.

---

## 36. Regression tests required during merge

### Routing/main dashboard

- existing route board still loads,
- existing sales availability still works,
- existing EPASS importer behavior unchanged,
- routing capacity still uses `Points`,
- maintenance code does not begin treating service orders as route capacity.

### Maintenance pricing

- standard appliance = $149.95/year,
- IMUC = $249.95/visit,
- IMUC default = two visits,
- 5 x two-visit IMUC -> Estate Preferred,
- Concierge remains customer-selectable upgrade,
- Estate >15 appliance adders calculate correctly.

### Household/visit routing

- Torres launch opens Torres only,
- Reynolds launch opens Reynolds only,
- invalid VisitId fails safely,
- household/VisitId mismatch fails safely,
- appliance button never opens HVAC workflow,
- HVAC button never opens appliance workflow.

### Field tool

- typing reading/note does not jump scroll position,
- autosave survives refresh/reopen,
- buttons 1-5 work on mobile,
- serial photo required,
- optional checkpoint photos remain optional,
- completed appliance creates one report revision,
- editing completed inspection creates updated report revision, not duplicate garbage.

### Reports

- report can only be generated from completed field data,
- Torres-style template remains consistent across appliance types,
- report email status is auditable,
- internal-only notes do not leak to customer PDF.

### Billing

- no charge at signup,
- charge only in allowed window unless authorized override exists,
- duplicate button click does not duplicate Stripe charge,
- AR household does not require Stripe card,
- failed payment rises to Action Required.

---

## 37. Open integration questions to resolve before production

These do not block starting the merge skeleton but must be resolved before go-live:

1. What exact authentication/user object exists in the current main Wilson dashboard?
2. What current Stripe wrapper/payment flow should maintenance reuse?
3. Where should maintenance photos and generated PDFs be stored?
4. What email provider/helper does the main tool use?
5. Which exact EPASS daily export will contain active service orders, and what are its columns/status values?
6. Which NetSuite customer/service-order fields will carry `MaintenanceHouseholdId` / `MaintenanceVisitId`?
7. Should report email initially require office approval for every plan or only Concierge?
8. Final cancellation/refund/proration policy.
9. Final Estate >15 appliance pricing after largest-house profitability review.
10. Final brand lifecycle mapping and expected-life matrix.
11. HVAC field/report integration specifics.

---

## 38. Definition of a successful merge

The maintenance project is successfully merged when:

- Wilson staff use the **same login and same internal dashboard shell** for maintenance,
- no production maintenance state depends on browser localStorage,
- customer appliance/HVAC enrollment creates SQL-backed households/subscriptions,
- office staff see exceptions and due work in the Maintenance Command Center,
- card/AR state moves visits through a controlled financial workflow,
- appliance and HVAC programs remain distinct under one residence,
- technicians launch an exact assigned visit from a phone,
- technician identity comes from the authenticated Wilson user,
- field data autosaves to SQL,
- completed appliance checks automatically create the locked Wilson health report,
- reports can be reviewed and emailed with delivery history,
- service-order reconciliation flags charged visits that lack operational tickets,
- existing routing/sales tools continue working exactly as before.

---

## 39. Handoff order for the developer/AI performing the merge

Read in this order:

1. `wilson_routing_dashboard_context (2).md`
2. `WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md`
3. **this `MERGE_GUIDE.md`**
4. latest prototype `README.md`
5. `docs/V09_DECISIONS.md`, then V08/V07/V06/V05 as needed
6. `docs/API_CONTRACT.md`
7. `docs/ARCHITECTURE.md`
8. `sql/maintenance_schema.sql`
9. current prototype UI/code files for behavior reference
10. actual current main Wilson dashboard source code

If the main dashboard source conflicts with assumptions in this document, preserve the **business rules and UX outcomes**, but adapt the implementation to the main tool's established conventions.

