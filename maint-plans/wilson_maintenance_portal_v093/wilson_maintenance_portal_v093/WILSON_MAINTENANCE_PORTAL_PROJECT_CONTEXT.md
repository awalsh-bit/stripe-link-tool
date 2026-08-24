# Wilson Maintenance Portal — Project Context, Business Rules, and Merge Handoff

_Last updated: 2026-08-24_
_Current prototype generation: v0.9.3_

## 1. Purpose of this document

This is the authoritative continuity file for the Wilson Maintenance Portal project. It is intended to let another AI or developer understand the product goals, business rules, UX decisions, current prototype behavior, integration boundaries, and important "do not regress" decisions without needing the original ChatGPT conversation.

This file should travel with every future prototype ZIP and should be updated whenever a business rule, workflow, scoring rule, pricing rule, or architecture decision changes.

For the existing Wilson routing/capacity dashboard, also preserve and read the separate file `wilson_routing_dashboard_context (2).md`. That document describes the existing Flask + SQL Server dashboard, EPASS CSV ingestion, routing rules, and production-hardening direction. The maintenance module is intended to merge into that dashboard shell rather than remain a standalone application.

---

## 2. Business objective

Wilson AC & Appliance is building a customer enrollment and internal operations platform for recurring appliance and HVAC maintenance.

The finished system should:

1. Let customers self-enroll in appliance or HVAC maintenance with as little friction as possible.
2. Automatically choose or recommend the correct maintenance plan based on the customer's actual equipment mix.
3. Keep appliance and HVAC enrollment separate for the customer but merge both into one internal household record.
4. Track upcoming maintenance intervals, payment readiness, filters, service-order creation, completed visits, and health reports.
5. Let technicians complete short, high-value maintenance protocols from a phone in the field.
6. Generate customer-facing appliance health reports directly from the technician's field data.
7. Eventually verify that a service order exists after a maintenance plan is charged by reading Wilson's operational exports / future NetSuite data.
8. Share the existing Wilson internal dashboard's authentication, visual design, navigation shell, and SQL Server infrastructure.

The product should feel polished, simple, visual, and operationally obvious. The customer experience should be "clicky" rather than form-heavy. The technician experience should be fast enough to use consistently in the field.

---

## 3. Product surfaces

### A. Public maintenance landing page

First decision:

- Household Appliances
- HVAC

These are separate customer paths.

### B. Appliance self-registration

Customers select broad appliance categories using polished 2D line icons, choose quantities, create areas, and drag individual appliance cards between areas.

The customer is not expected to know model numbers, serial numbers, or detailed product taxonomy.

### C. HVAC self-registration

Separate HVAC enrollment with its own plan options and cadence.

### D. Internal Maintenance Command Center

Office workflow for:

- exceptions / action required,
- payment readiness,
- maintenance scheduling,
- service-order verification,
- completed maintenance,
- health reports,
- household records,
- invoice import,
- filters,
- quotes,
- plan configuration,
- activity/audit history.

### E. Household profile

One household can contain separate:

- Appliance Maintenance section
- HVAC Maintenance section

Each section owns its own next visit and its own field launch action.

### F. Technician field tool

Mobile-first workflow for completing appliance maintenance and health checks.

### G. Customer Appliance Health Report

Generated only from completed technician field data. There is no manual standalone report-builder workflow anymore.

### H. Wilson invoice import / estate quote builder

Internal tools to use known Wilson sales data to build appliance inventories and maintenance proposals.

---

## 4. Visual and UX direction

The maintenance portal should match Wilson's existing internal dashboard language:

- pale mint / off-white application background,
- Wilson dark green,
- rounded white cards,
- bold dark headings,
- compact status pills,
- strong operational hierarchy,
- clean modules rather than dense tables,
- Wilson logo and typography treatment consistent with the current dashboard screenshots.

Customer appliance selection should visually borrow from the Wilson clearance/product-card experience, but use custom 2D appliance icons rather than product photos.

The iconography should reflect Wilson's actual higher-end appliance mix. Examples:

- professional-style range / rangetop rather than small commodity cooktops,
- top-control premium dishwasher,
- built-in / column-style refrigeration,
- hood liner / professional ventilation,
- premium laundry silhouettes.

---

## 5. Customer-facing appliance categories

Keep the customer taxonomy broad and easy to understand:

1. Refrigeration
   - Full-size refrigerator/freezer
   - Columns
   - Undercounter refrigerator/freezer
   - Wine units
   - Beverage centers
   - Specialty refrigeration
2. Icemaker
3. Cooktop / Rangetop
4. Range
5. Dishwasher
6. Ventilation
7. Microwave
   - Countertop
   - Built-in
   - Speed oven
   - Drawer
   - Over-the-range microwave
8. Ovens
9. Warming Drawer
10. Built-In Coffee
11. Washer
12. Dryer

The backend should preserve exact appliance type, brand, model, serial, description, source invoice, etc., even though the customer sees only these broad categories.

---

## 6. Customer appliance enrollment UX

### Appliance selection

- Customer taps an appliance icon.
- Customer chooses quantity.
- Selected units appear as individual draggable cards.
- Default area is `Main House`.
- Customer can add areas such as Casita, Guest House, Bar, Game Room, Outdoor Kitchen, Pool House, Studio, etc.
- Customer can drag appliances between areas.
- A conventional `Move to` control should remain available for phone/accessibility use.

### Customer data burden

Do not require brand/model/serial during self-registration.

Wilson often has the original sales history and can reconcile exact equipment later.

### Plan visibility

Below the Estate crossover, the customer should not need to compare a grid of maintenance plans. Show the calculated coverage/price only.

When the inventory becomes an Estate-level value, automatically choose the best-value appropriate Estate starting plan and then expose the Estate tier choices.

---

## 7. Appliance pricing and plan rules

### Per appliance

- Standard appliance: **$149.95 per appliance per year**
- Includes one maintenance visit per year.
- Filters are not inherently included.
- No disassembly unless separately approved.

### IMUC / icemaker

Wilson internal acronym: `IMUC` = icemaker.

- **$249.95 per visit per icemaker**
- Manufacturer-recommended cadence is twice per year.
- Customer-facing IMUC enrollment defaults to two visits annually.
- Customer can elect one annual visit where appropriate.

### Estate Annual

- **$1,195/year**
- One coordinated whole-home appliance maintenance visit per year.

### Estate Preferred

- **$1,995/year**
- Two coordinated whole-home appliance maintenance visits per year.
- Two-visit IMUC maintenance is included in the two annual visits.

### Estate Concierge

- **$2,995/year**
- Two coordinated visits per year.
- Hands-off appliance portfolio management.
- Cleaning included within defined plan scope.
- Priority service.
- Standard refrigerator/freezer/IMUC filters included.
- Detailed appliance health reports.
- BBQ / grill cleaning excluded.

### Estate eligibility

There is no minimum appliance-count rule.

The customer should move into an Estate plan whenever it is the better value for the actual equipment/visit mix.

### IMUC-aware automatic plan selection

Do **not** simply compare per-appliance pricing with Estate Annual.

Compare the real annual cost of:

- Per Appliance
- Estate Annual plus any separately billed second IMUC visits
- Estate Preferred, where two visits are already included

Example: 5 icemakers, all selected for two visits.

- Per appliance: 5 x $249.95 x 2 = $2,499.50
- Estate Annual: $1,195 + (5 x $249.95) = $2,444.75
- Estate Preferred: $1,995

Therefore the automatic starting plan should be Estate Preferred.

Concierge remains an elective service upgrade even when it is not the cheapest arithmetic option.

### Draft Estate base-plus structure

Current prototype concept:

- First 15 appliances included in Estate base price.
- Estate Annual: +$60 per appliance above 15.
- Estate Preferred: +$100 per appliance above 15.
- Estate Concierge: +$150 per appliance above 15.
- 26+ appliances can calculate but should receive a management-review flag.

This structure is a working proposal and can be changed after Wilson reviews profitability on the largest residences.

---

## 8. Refrigeration filter service

Every customer should be able to elect filter service on a refrigeration product even when enrolled per appliance.

For non-Concierge refrigeration:

- Wilson tracks applicable filters.
- Wilson verifies exact part numbers.
- Wilson replaces filters during scheduled maintenance when selected.
- Prototype assumption: filter materials are billed at service unless otherwise configured.

Estate Concierge includes standard refrigerator/freezer/IMUC filters.

Backend filter records should support:

- filter type,
- part number,
- quantity,
- replacement interval,
- last replaced,
- next due,
- source/vendor if desired.

Relevant refrigeration filters include water filters and air/food-preservation filters.

---

## 9. HVAC plans

HVAC is a separate customer enrollment path and a separate household program module.

### Standard HVAC maintenance

- **$200 per system per year**
- Two visits per year.
- Wilson contacts the household in spring and fall, weather permitting.

### HVAC + filter management

- **$400 per system per year**
- Two visits per year.
- Filter inventory / sourcing / schedule tracking / replacement management.

The exact policy for whether all HVAC filter material is included in the $400 tier remains configurable / not fully locked.

The appliance technician workflow must never accidentally launch from an HVAC interval. The HVAC field workflow is intentionally separate and not yet built in the prototype.

---

## 10. Payment, AR, renewal, and charge timing

### Card on file

Use Stripe in production.

- Customer saves a reusable payment method during enrollment.
- Use Stripe Customer + SetupIntent / PaymentMethod references.
- Do not store raw card data.
- Do not charge the annual plan at signup.
- Office charges the card when the scheduled maintenance interval is ready to proceed.

### AR accounts

Some large households use Wilson account / AR billing.

Household billing mode must support:

- Card on File
- Account / AR

AR households can store terms such as Net 30 and should not be falsely flagged for missing a credit card.

### Time-to-charge window

A scheduled visit becomes eligible for office action any time within:

**14 days before through 14 days after the initially scheduled interval.**

Customer scheduling preference should be visible, but dispatch has this flexible operating window.

### Renewal

Plans automatically renew annually until canceled by the customer.

Exact proration/refund/cancellation-effective-date policy remains to be finalized.

---

## 11. Internal Maintenance Command Center

The internal landing page should prioritize work rather than show one dense master list.

### Primary modules

#### 1. Action Required

Highest priority. Examples:

- missing/failed payment method,
- payment exception,
- charged interval without a matching service order,
- unresolved workflow exception,
- other blocking issue.

Payment problems on subscribed households should rise to the top immediately.

#### 2. Ready to Charge

Maintenance intervals inside the +/-14 day operating window that are financially ready.

- Card households require valid payment readiness.
- AR households can be considered financially ready according to AR terms.

#### 3. Schedule / Ticket

Intervals already charged / posted to AR that need a maintenance ticket or service order generated / verified.

#### 4. Completed & Health

Completed maintenance and health-report handoff.

Show report readiness and customer-email status.

### Upcoming Maintenance

Future work can appear below the action modules in a quieter list.

### Activity history

Recent Activity is useful but should not dominate the main command-center page. Keep it behind its own menu/tab or secondary surface.

### Navigation direction

Keep navigation clean and modular. Current conceptual modules:

- Command Center
- Households
- Invoice Import
- Filters
- Health
- Quotes
- Plan Setup
- Activity

---

## 12. EPASS / NetSuite operational verification direction

The current maintenance prototype does not create a real EPASS or NetSuite service order.

Future desired workflow:

1. Maintenance interval becomes due.
2. Office charges card or posts to AR.
3. Office creates service order.
4. Wilson's operational export / future integration is ingested.
5. Maintenance tool looks for a matching service ticket.
6. If charged but no matching ticket exists, the household remains flagged in `Action Required`.

Wilson expects NetSuite to be the likely future service-order destination.

The existing routing dashboard already ingests EPASS exports. When this maintenance module is merged into the main Wilson dashboard, reuse that general import architecture rather than building an unrelated ingestion stack.

---

## 13. Wilson sales invoice import

The internal maintenance system should allow staff to upload Wilson sales invoices and create a maintenance inventory from them.

### Known invoice format behavior

Supplied examples:

- `S00063887`
- `S00063887-1`

Invoices can be split across multiple PDF files.

Useful fields:

- invoice number,
- invoice date,
- Ship To name,
- Ship To phone,
- Ship To address,
- printed area headings,
- quantity,
- model,
- product description,
- manufacturer/category line,
- serial number when present.

### Area headings

Examples in the supplied invoice:

- APARTMENT
- MAIN HOUSE
- STUDIO

Use these to populate maintenance areas.

Items with no reliable area heading should go to:

`Unassigned — Review`

Do not guess.

### Exclude non-appliance invoice lines

Do not create maintenance assets from:

- installation charges,
- delivery charges,
- decorative panels,
- hoses,
- cords,
- water kits,
- gas lines,
- payments,
- transfers,
- promotions/credits,
- accessories,
- blower accessories / supporting components.

### Exact backend data

Even though the customer-facing category is broad, imported assets should retain:

- exact brand,
- model,
- serial,
- description,
- source invoice,
- inferred exact product type,
- broad public category,
- area.

### Laundry towers

The current prototype expands a WashTower / laundry center into a washer record and a dryer record for maintenance pricing. This is still a policy decision to revisit.

---

## 14. Custom estate quote builder

Large residences / house managers may send Wilson a complete appliance list.

Internal staff should be able to:

1. Enter/import the appliance inventory.
2. Assign areas.
3. Select/calculate an appropriate Estate plan.
4. Apply approved adjustments if needed.
5. Generate a polished Wilson-branded proposal for the house manager.

This is especially useful for very large homes where fixed public pricing may need management review.

---

## 15. Technician identity and access

Production technician identity should come from Wilson's existing authenticated internal dashboard user session.

Do not ask the technician to select themselves from a dropdown in the field.

Known appliance/service technician demo names supplied during prototype development:

- Mark Perks
- Andrew Horst
- Diogo Assis
- Kyle Bisson
- Josh Chappell
- Trevor Pate
- Connor Montgomery
- Chris Turner
- Brady Langley
- John Merz

The prototype can use `Wilson technician` when no authenticated identity exists.

---

## 16. Household field-visit launch rules

This is a critical non-regression rule.

A tech launch must be tied to the **exact household + exact maintenance interval / visit ID** being viewed.

Never fall back to a sample/default residence.

The field tool must block mismatched household/visit combinations.

Household profile layout:

### Appliance Maintenance module

- appliance plan summary,
- next appliance interval,
- one clear `Launch appliance visit` action.

### HVAC Maintenance module

- HVAC plan summary,
- next HVAC interval,
- one separate HVAC field action.

Do not show redundant `Open field visit` and `Launch tech visit` buttons for the same program.

---

## 17. Technician field UX

The field tool is designed primarily for a phone.

### Visit home screen

Show:

- residence name,
- service date / visit label,
- signed-in technician,
- overall progress,
- completed count,
- remaining count,
- attention count,
- suggested next appliance,
- areas with their own progress,
- appliance cards with 2D icons,
- status badges.

### Appliance statuses

- Not Started
- In Progress
- Complete
- Monitor
- Needs Follow-up

### Suggested next step

If an appliance is already in progress, recommend continuing it.

Otherwise recommend the next incomplete appliance.

### Header behavior

The residence/visit banner must be high contrast and **not sticky**. It must never float over the page or block touch targets while scrolling.

### Autosave

Field inputs should save without rebuilding the page or jumping scroll position.

Typing into age, temperature, notes, or other text fields must not send the viewport back to the top.

### Completion readiness

Before `Complete` is enabled, clearly show what is still missing, e.g.:

- enter age,
- capture serial tag,
- 2 checks remaining,
- required reading missing.

---

## 18. Field rating interaction

Do not use sliders.

Every checkpoint uses five large touch buttons:

1. **Poor**
2. **Concern**
3. **Monitor**
4. **Good**
5. **Excellent**

Interpretation:

- 1–2 = Needs Follow-up / Action
- 3 = Monitor
- 4–5 = Pass

A score selection does not automatically mean the task was performed. Keep an explicit `Performed` control / completion state.

---

## 19. Field photos

Every appliance requires a **serial-tag photo** before completion.

Checkpoint photos are optional. The technician can attach a photo to a checkpoint when useful, but the system should not require a photo for every check.

Future production photo storage should be secure object storage linked to the asset, visit, report, and optional checkpoint.

---

## 20. Appliance health scoring model

### Weighting

Current agreed starting point:

- **75% current condition / health checkpoints**
- **25% lifecycle / age**

Age matters, but should not overwhelm the condition score.

A well-running older premium appliance should still be able to score well while clearly signaling that it is late in its expected lifecycle.

### Lifecycle designations

Based on percentage of expected service life consumed:

- **Early Life:** under 40%
- **Mid Life:** 40% to under 70%
- **Mature:** 70% to under 90%
- **Replacement Planning:** 90%+

The lifecycle designation is deliberately separate from the letter/health grade.

---

## 21. Brand / product tier defaults

The technician tool should automatically default lifecycle tier based on brand. Technician/admin can override when needed.

### Luxury / Long-Life examples

- Sub-Zero
- Wolf
- Cove
- Miele
- Thermador
- True / premium built-in or commercial refrigeration where applicable

### Premium / Mass-Premium examples

- KitchenAid
- Bosch
- Monogram
- Cafe
- Fisher & Paykel
- JennAir
- similar premium/mass-premium positioning

### Mass-Market examples

- Whirlpool
- Maytag
- mainstream GE
- mainstream LG
- Samsung
- Frigidaire
- similar mass-market positioning

Do not treat this initial mapping as permanent truth. It is a configurable default until Wilson develops a more specific brand/product-life table.

---

## 22. Draft expected-life matrix

Current generic starting assumptions in years:

| Appliance category | Luxury / Long-Life | Premium / Mass-Premium | Mass-Market |
|---|---:|---:|---:|
| Refrigeration | 20 | 14 | 10 |
| Dishwasher | 15 | 10 | 8 |
| Cooking | 20 | 15 | 12 |
| Icemaker | 12 | 10 | 8 |
| Washer / Dryer | 15 | 11 | 8 |
| Ventilation | 18 | 14 | 10 |
| Microwave | 10 | 8 | 7 |

Wilson intends to refine this later by brand and potentially by product family.

---

## 23. Final refrigeration field protocol

Keep this short and operationally meaningful.

### Required context

- appliance age,
- brand/model/serial from backend where known,
- lifecycle tier defaulted from brand,
- required serial-tag photo.

### Check 1 — Compartment Temperature Performance

Measure actual compartment temperatures and compare with setpoint.

Reference goals:

- Fresh food: typically **35–38°F**
- Freezer: close to **0°F**
- Verify icemaking where relevant
- Specialty refrigeration should be evaluated against its actual selected setpoint / use case

Capture actual temperature and setpoint rather than forcing one universal range on every refrigeration type.

### Check 2 — Evaporator Frost Pattern

Technician visually evaluates the evaporator/frost pattern and rates 1–5.

Look for:

- consistent frost pattern across the active coil,
- no isolated ice ball,
- no obvious oil residue,
- no visible leak indicators,
- airflow/fan behavior consistent with a healthy frost pattern.

### Check 3 — Condenser Temperature & Coil Service

Use an infrared temperature gun to measure condenser-coil surface temperature.

Record:

- room ambient temperature,
- condenser surface temperature,
- calculated TD = condenser surface temp - ambient.

Current reference guidance:

- typical room ambient: roughly 70–80°F,
- expected condenser temperature difference: roughly **15–30°F above ambient**,
- coils should feel warm/hot but generally not so hot that a hand cannot briefly rest on them,
- rough surface reference: generally below about **110–120°F**.

The technician also inspects/vacuums the accessible condenser coil.

Do **not** automatically diagnose a refrigerant leak from one elevated condenser-temperature reading. Flag abnormal conditions for technician interpretation / follow-up diagnosis.

### Check 4 — Components & Operating Sound

Force accessible components to operate and listen/observe for abnormal behavior.

Examples:

- compressor,
- evaporator/condenser fans,
- dampers where applicable,
- abnormal cycling,
- abnormal vibration or noise.

Rate 1–5.

### Check 5 — Airflow & Filter Status

- Verify fan operation / airflow in conjunction with frost pattern.
- Check applicable water / air / food-preservation filters.
- Replace/reset filters when filter service is included/elected.
- Record filter action.

---

## 24. Simplified protocols for other appliance types

These are current working protocols and should stay simple unless field testing shows a missing high-value check.

### Dishwasher — 5

1. Seals & Leak Check
2. Filter & Sump Condition
3. Stored Codes & Controls
4. Test Cycle & Operating Sound
5. Maintenance Clean Cycle

### Cooking: range / oven / cooktop / rangetop — 4

1. Door Seals & Physical Condition
2. Burner / Element / Flame Test
3. Temperature Accuracy vs Setpoint
4. Controls & Safety Operation

For products without an oven cavity, temperature-accuracy logic can be N/A or adapted to the applicable cooking function.

### Icemaker — 5

1. Ice Pattern & Production
2. Bin Condition & Cleaning
3. Cleaning / Descale Cycle
4. Condenser & Airflow
5. Water, Drain & Filter

### Washer — 5

1. Hoses, Fill & Leak Check
2. Drain Performance
3. Wash / Spin & Vibration
4. Gasket, Filter & Cleaning Condition
5. Stored Codes & Controls

### Dryer — 5

1. Exhaust Airflow & Temperature
2. Lint System & Accessible Cleaning
3. Drum, Rollers & Operating Sound
4. Cycle / Moisture Sensor Operation
5. Vent & Utility Connection

### Ventilation — 5

1. Blower & Capture Performance
2. Filters / Baffles
3. Blower Sound & Vibration
4. Controls, Lights & Heat Sensor
5. Grease / Duct-Entry Condition

### Microwave — 5

1. Door, Seal & Interlock
2. Heating Performance
3. Turntable, Fan & Airflow
4. Controls & Stored Faults
5. Interior / Arcing Condition

These protocols are intended to generate a useful "bill of health" without making maintenance visits unprofitable or the technician workflow burdensome.

---

## 25. Health-report generation workflow

The **technician field tool is the source of truth** for appliance health reports.

The old manual Appliance Health Report Builder is retired and should not return.

### Appliance completion

When a technician completes:

- required age/lifecycle context,
- serial-tag photo,
- all required checks,
- required readings,
- notes as needed,

then `Complete & Generate Report` creates or refreshes that appliance's health report.

If a completed appliance is reopened and corrected, regenerate/refresh its existing report rather than creating duplicate reports.

### Whole visit completion

When every appliance assigned to the maintenance visit is complete and has a valid report:

- maintenance visit becomes Completed,
- report package becomes `Ready to email`,
- Command Center surfaces the report handoff.

### Office report handoff

Desired actions:

- Review Reports
- Email to Client

Email is currently an integration placeholder. Production should use the Wilson email service / authenticated backend.

There should only be a recovery `Generate Health Report` action if completed field data exists but the report object is missing. Office staff should never build a report from scratch.

---

## 26. Locked customer Appliance Health Report style

The uploaded PDF `Appliance Health Report _ Wilson.pdf` is the visual/content reference that worked well during prototype testing and is now considered the locked report style across appliance types.

Maintain the same basic presentation for every appliance:

1. Cover page
   - Wilson Estate Care
   - Appliance Health Report
   - brand/model/type
   - overall appliance score
   - grade/status
   - household
   - service address
   - service date
   - technician

2. Appliance Vitals
   - customer-friendly explanation
   - vital/check cards
   - observed result
   - target / normal
   - status
   - useful technician note
   - visit overview

3. Score Breakdown
   - plain explanation of 75% condition / 25% lifecycle model
   - visible deductions
   - final score/status

4. Inspection Details
   - equipment information
   - visit information
   - approximate age
   - lifecycle tier
   - lifecycle stage
   - subsystem/checkpoint review with 1–5 result/status

5. Corrective Measures
   - corrective measures
   - recommendations
   - maintenance performed
   - filter / consumable summary
   - photo count / record

6. Report Information
   - score explanation
   - operating-vitals explanation
   - status meanings
   - scope and limitations

7. Service Summary
   - field completion summary
   - technician condition summary
   - next planned interval
   - photo record
   - technician/date/report reference

Do not reintroduce a separate office report builder that uses a different visual style.

---

## 27. Technician-to-customer report status flow

Suggested report statuses:

- Field In Progress
- Field Complete / Generating
- Generated
- Ready to Review
- Ready to Email
- Email Queued
- Sent
- Delivery Failed

Future production implementation should store email timestamp, recipient, delivery result, and report version used.

---

## 28. Current prototype data model concept

One shared Household parent with separate programs beneath it.

```text
Household
  |- Contacts
  |- Billing / Payment Profile
  |- Areas
  |- Assets
  |    |- Appliance Assets
  |    |- HVAC Assets
  |    |- Filter Records
  |- Subscriptions
  |    |- Appliance
  |    |- HVAC
  |- Maintenance Intervals / Visits
  |    |- Visit Type
  |    |- Scheduled Interval
  |    |- Charge / AR Status
  |    |- External Service Order
  |    |- Technician
  |- Appliance Field Inspections
  |    |- Checkpoints
  |    |- Readings
  |    |- Photos
  |- Appliance Health Reports
  |- Quotes
  |- Activity / Audit Events
```

Do not merge households by name alone. Production household reconciliation should rely on address/contact/source identifiers and deliberate merge review.

---

## 29. Recommended merge architecture with existing Wilson dashboard

The existing Wilson internal dashboard uses Flask + SQL Server.

Maintenance should become a modular part of that app, not another giant set of HTML strings inside the existing routing `dashboard.py`.

Recommended shape:

```text
WilsonDashboard/
  app.py
  blueprints/
    maintenance_public/
    maintenance_admin/
    maintenance_field/
    maintenance_quotes/
    appliance_reports/
  templates/
    maintenance_public/
    maintenance_admin/
    maintenance_field/
    maintenance_quotes/
    appliance_reports/
  static/
    maintenance/
  integrations/
    stripe_service.py
    netsuite_service.py
    email_service.py
    object_storage.py
    epass_or_sales_export_service.py
  repositories/
    maintenance_repository.py
  jobs/
    maintenance_interval_scheduler.py
    filter_due_scheduler.py
    renewal_scheduler.py
    service_order_reconciliation.py
```

Reuse the main dashboard's:

- login/session,
- user ID,
- roles/permissions,
- header/navigation shell,
- SQL connection/repository conventions,
- audit conventions,
- deployment method.

---

## 30. Production security requirements

The current local prototype is not production hardened.

Production requirements include:

- authenticated internal access,
- role-based authorization,
- HTTPS,
- CSRF protection,
- server-side trusted pricing,
- SQL least-privilege app account,
- audit logging,
- secure secret management,
- secure report/photo storage,
- backups and retention rules,
- Stripe webhook handling,
- no raw card storage,
- no internal dashboard exposed publicly,
- public and internal APIs separated.

---

## 31. Current prototype limitations / integration placeholders

As of v0.9:

- demo operational state primarily uses browser/local prototype storage rather than production SQL,
- real Wilson authentication is not connected,
- technician identity is not yet inherited from the live dashboard session,
- Stripe payment actions are placeholders,
- NetSuite service-order creation is a placeholder,
- email sending is a placeholder,
- secure photo/object storage is not implemented,
- HVAC field workflow is not built,
- EPASS/NetSuite service-order reconciliation is not built,
- public website deployment/integration is not built,
- exact brand/model lifecycle table is still generic,
- report PDF generation/storage needs production implementation,
- customer cancellation/proration policy is not fully defined.

These are intentional prototype boundaries, not forgotten requirements.

---

## 32. Prototype file map (v0.9.1)

```text
index.html                  Public maintenance landing page
appliance-signup.html       Public appliance enrollment
hvac-signup.html            Public HVAC enrollment
confirmation.html           Enrollment confirmation
household.html              Household profile / Appliance + HVAC sections
admin.html                  Internal Maintenance Command Center
tech-maintenance.html       Mobile appliance technician field workflow
report-view.html            Locked customer appliance health-report presentation
quote-builder.html          Internal estate proposal builder
quote-view.html             Proposal presentation

assets/plan-config.js       Business-rule engine: pricing constants, all four plan
                            definitions, filter service config, both appliance
                            taxonomies, all ten checkpoint sets, scoring weights,
                            lifecycle matrix, and WILSON_PROTOCOL.resolveCheckpointSet()
assets/store.js             Demo data/state engine and mock backend (~960 lines):
                            seeded households, enrollment, visit creation, mock
                            charge/AR, tech inspections, report generation, quotes,
                            invoice drafts, localStorage persistence
assets/tech-maintenance.js  Field workflow: brand-tier defaults, expected-life
                            lookup, lifecycle staging, 75/25 scoring, autosave,
                            readiness gating, 1-5 tap ratings
assets/appliance-builder.js Customer appliance enrollment builder (IMUC-aware
                            Estate comparison lives here)
assets/hvac-builder.js      HVAC enrollment builder
assets/invoice-import.js    Wilson sales-invoice import UI and asset drafting
assets/admin.js             Command Center behaviour
assets/household.js         Household profile behaviour
assets/quote-builder.js     Estate proposal builder behaviour
assets/quote-view.js        Proposal presentation behaviour
assets/report-view.js       Health-report rendering
assets/confirmation.js      Confirmation page behaviour
assets/ui.js                Shared UI helpers
assets/wilson.css           All styling
assets/appliance-icons/     Twelve category SVG icons
assets/logo-black.png       Wilson logo

serve_portal.py             Local server plus the PDF invoice-import endpoint
invoice_parser.py           Wilson sales-invoice PDF parser
vendor/pypdf/               Vendored pypdf (third party, unmodified)
start_demo.sh               Local launch (macOS/Linux)
start_demo.bat              Local launch (Windows)
OPEN_WILSON_PORTAL.bat      Windows one-click launch

sql/maintenance_schema.sql  Base schema v0.3: 24 tables, 3 views. Predates the
                            v0.5-v0.9 field workflow -- see Section 34
sql/maintenance_migration_v09.sql  Generated v0.9 migration implementing
                            MERGE_GUIDE Section 7. Do not hand-edit
sql/_migration_v09_ddl.sql  Structure template for the generator
sql/generate_migration_v09.py  Regenerates the migration from plan-config.js
sql/dump_config.js          Dumps WILSON_CONFIG to JSON for the generator

_qa/run_all.sh              Runs every automated check
_qa/verify-protocol-resolution.js  Protocol resolution per category and type
_qa/verify-sql-migration.py Migration structure, guards, FK targets, seed keys
_qa/verify-protocol-parity.py  Proves the SQL and JS resolvers agree
_qa/verify-filter-pricing.js   Filter service pricing and plan interaction
_qa/smoke_browser.py        End-to-end browser test incl. phone viewport

samples/Wilson_Appliance_Health_Report_Sample.pdf   Locked 7-page report
samples/Wilson_Estate_Maintenance_Proposal_Sample.pdf   3-page proposal
screenshots_v03/            Four customer-side reference images

CHANGELOG.md                Version changes
README.md                   Prototype notes
README_FIRST.txt            Local/phone prototype launch instructions
docs/MERGE_GUIDE.md         Production merge architecture (authoritative target)
docs/PHONE_FIELD_TESTING.md Testing the field tool on a real handset
docs/ARCHITECTURE.md        Production architecture direction
docs/API_CONTRACT.md        SUPERSEDED at v0.3 -- do not build to it, see Section 34
docs/DECISIONS.md           Business decision log
docs/INVOICE_IMPORT.md      Wilson sales invoice parsing notes
docs/PRICING_RATIONALE.md   Estate/base-plus pricing rationale
docs/QA_SUMMARY.md          QA notes
docs/QA_SUMMARY_V09.md      v0.9 QA notes
docs/V05_DECISIONS.md       Field/report/scoring evolution
docs/V06_DECISIONS.md       Refrigeration protocol and filter-service decisions
docs/V07_DECISIONS.md       Field-generated-only report workflow and brand tiers
docs/V08_DECISIONS.md       Mobile technician UX decisions
docs/V09_DECISIONS.md       Exact visit routing, appliance/HVAC separation, 1-5 buttons
```

The version-specific docs are useful history, but this file should be treated as the consolidated current-state reference.

---

## 33. Key non-regression checklist

A future AI/developer should verify all of these before declaring a merge/rebuild successful:

- Customer sees broad appliance categories, not model-entry burden.
- Customer can create areas and move appliance cards between them.
- IMUC defaults to 2x annual maintenance.
- Estate auto-selection accounts for second-IMUC economics and can choose Preferred when it is actually cheaper.
- Appliance and HVAC programs remain separate on customer and field workflows but share one household backend.
- Per-appliance refrigeration AND icemaker customers can elect filter service.
- Selecting filter service raises the annual plan price by the filter sales price; it is never silently free. `_qa/verify-filter-pricing.js` enforces this.
- Water and air / food-preservation filter service are independent customer choices. Air is never selected by default.
- Filter service is priced per filter, not per appliance, so multi-filter refrigeration prices correctly.
- Estate Concierge includes water and air filters at no extra charge.
- Filter cost never changes which plan the estate auto-selection picks, since it applies equally to every non-Concierge plan.
- AR households do not require a card to become maintenance-ready.
- Time-to-charge operating window is +/-14 days around interval.
- Payment exceptions appear at top of internal work queue.
- Charged/AR-ready intervals can be flagged when no matching service order is found.
- Household profile has one appliance launch and one separate HVAC launch, not redundant buttons.
- Field launch always carries exact visit ID and never defaults to another residence.
- Tech identity comes from authenticated Wilson user in production.
- Tech banner is not sticky and never blocks scrolling/clicks.
- Typing into field inputs does not jump the viewport to the top.
- Tech ratings use 1–5 buttons, not a slider, and every button clears a 44px tap target.
- No page scrolls horizontally at 390px width.
- The field tool refuses to open without a visit ID.
- Serial-tag photo is required for every appliance.
- Checkpoint photos are optional.
- Field data is the sole source for customer health reports.
- Old manual health-report builder remains retired.
- Every customer category and appliance type resolves to its intended checkpoint set from configuration, not from hardcoded logic. `_qa/verify-protocol-resolution.js` enforces this.
- Protocol resolution has exactly one implementation. If a second one appears, the two must be proven equivalent -- `_qa/verify-protocol-parity.py` does this for the JS resolver and the SQL model.
- Health score is 75% condition / 25% lifecycle.
- Brand tier defaults automatically but remains overridable.
- Lifecycle stage is displayed separately from health score.
- Customer report follows the locked Wilson Estate Care PDF styling.
- Completed field visit produces report package and Ready-to-Email workflow.
- Production server, SQL, Stripe, email, photos, and service-order connections remain server-side and authenticated.

---

## 34. Open questions / next development areas

Likely next work:

1. Continue phone field testing and simplify any remaining technician friction.
2. Refine health protocols/checkpoint wording for dishwasher, cooking, IMUC, washer, dryer, ventilation, and microwave based on real technician feedback.
3. Build the HVAC field workflow or integrate the existing HVAC reporting program without confusing appliance tech workflows.
4. **Load Wilson's filter sales-price list.** The pricing *mechanism* landed in v0.9.2 -- filter service now raises the annual plan price, priced per filter, with water and air as separate customer choices. The *numbers* are placeholders ($70 per filter for both kinds) until Wilson supplies the real price list. Loading it means adding part-number rows to `MaintenanceFilterPrices` and setting `PriceIsPlaceholder = 0`; the JS placeholder in `plan-config.js` should then be retired in favour of server-side pricing (see item 11). Still open alongside it: whether filter *labour* differs from material, and proration when filter service is added mid-term.
5. Build brand/product-family expected-life configuration beyond the generic tier model.
6. Define customer cancellation/proration rules.
7. Build production email/report delivery.
8. Build secure photo storage.
9. Build EPASS/NetSuite service-order reconciliation.
10. Merge maintenance into the authenticated main Wilson Flask + SQL Server dashboard.
11. Move trusted pricing/scoring/business logic out of browser JavaScript and into backend services.
12. Establish role permissions for dispatcher/client care, technician, sales/house-manager liaison, and manager/admin.
13. Decide whether combined WashTower/laundry-center products count as one maintained asset or washer + dryer for pricing. **Now blocking code:** `laundry_center` is the only remaining user of the combined `laundry` checkpoint set. Answering this retires that set entirely.

### Resolved in v0.9.1

- **Protocol configuration consolidated.** Four customer categories (Ventilation, Microwave, Washer, Dryer) and five appliance types stored the wrong `checkpointSet`; the field tool masked it with a duplicate hardcoded if-chain. Resolution now lives only in `WILSON_PROTOCOL.resolveCheckpointSet()` and is covered by tests. See CHANGELOG v0.9.1.

### Stale artifacts to be aware of

- `docs/API_CONTRACT.md` is at v0.3 and **contradicts the current package**. It specifies the retired office-built report endpoint and contains essentially no technician/field endpoints. It carries a SUPERSEDED banner; it must be rewritten to v0.9 before anyone builds against it.
- `sql/maintenance_schema.sql` is at v0.3 (2026-08-21) and predates the v0.5-v0.9 field workflow. `sql/maintenance_migration_v09.sql` supplies the Section 7 additions on top of it; the two are applied in that order. The pre-v0.7 `MaintenanceHealthReport*` tables still reflect the retired office-builder model and should be retired alongside the API contract rewrite.
- Missing from the package entirely: `wilson_routing_dashboard_context (2).md`, the Wilson sales-invoice samples (`S00063887`, `S00063887-1`) needed to validate `invoice_parser.py`, and Wilson dashboard screenshots.

---

## 35. Recommended handoff order for another AI/developer

When recreating or merging this project, read in this order:

1. `WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md` — authoritative product/business state.
2. `wilson_routing_dashboard_context (2).md` — existing Wilson dashboard architecture and EPASS routing context.
3. Latest prototype source files — current UI behavior/reference implementation.
4. `docs/MERGE_GUIDE.md` — the authoritative production merge target, including the Section 7 schema additions.
5. `docs/ARCHITECTURE.md` — target backend direction. **Skip `docs/API_CONTRACT.md`:** it is superseded at v0.3 and actively misleading until rewritten (see Section 34).
6. `docs/DECISIONS.md` plus version-specific decision files — history and rationale.
7. Wilson sales-invoice PDF examples — invoice parser source format. **Not in the package.**
8. `samples/Wilson_Appliance_Health_Report_Sample.pdf` — locked appliance health-report visual standard.
9. Existing HVAC measureQuick report — reference for the broader "health vitals" concept, not a template to copy literally.
10. Wilson dashboard/customer-facing screenshots — visual-language reference. **Only four customer-side images are present (`screenshots_v03/`).**

The latest prototype code is a UX/behavior specification and proof of concept. It should not be treated as production architecture simply because it works locally.

---

## 36. Maintenance of this context file

On every substantial future revision:

- update `Last updated` and current prototype generation,
- update changed business rules here,
- remove obsolete rules rather than leaving contradictory current-state statements,
- keep version-specific rationale in the changelog/decision files,
- add any new non-regression behavior to Section 33,
- keep this file inside the root of every prototype ZIP,
- run `bash _qa/run_all.sh` before declaring a revision complete.

