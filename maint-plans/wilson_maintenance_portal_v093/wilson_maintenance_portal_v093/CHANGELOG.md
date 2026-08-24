# v0.9.3 - First end-to-end browser QA

`docs/QA_SUMMARY_V09.md` recorded that headless browser QA could not be run, so nothing had ever driven this prototype end to end. It has now been driven, and it found three real bugs in the v0.9.2 filter pricing work that every unit test passed straight through.

Bugs found and fixed:

- **Estate Concierge left air filter toggles unchecked while labelling them "included".** Concierge's own included-filter list covers refrigerator air / food-preservation filters, but the enrollment UI only force-checked water. A second refrigerator rendered an unticked box captioned "Air / food-preservation filter service included". Both kinds now render checked and locked on Concierge.
- **The Concierge enrollment summary undercounted covered filters.** Coverage was read from the per-asset opt-in flags, which the locked checkboxes never set, so a four-refrigerator Concierge household listed "Water filters x 1" instead of x 4. `filterQuantity()` now treats every eligible kind as selected when the plan covers filters.
- **Duplicate summary line.** "Plan-covered filters - Included" sat directly above the new per-kind lines, which say the same thing with counts. Removed the older generic line.

Added `_qa/smoke_browser.py` - 41 assertions over the real UI:

- all ten pages load with no console errors and with the globals their scripts need
- filter service moves the plan total by exactly the configured unit price, per kind
- the summary never renders a bare "Added" and always flags placeholder pricing
- icemakers are offered water filter service only; refrigeration is offered both
- Concierge locks every filter toggle checked and charges nothing
- the field tool refuses to open without a visit ID
- a seeded washer resolves to the five-check `washer` protocol rather than three-check generic, verified through the field tool against real stored data (the v0.9.1 fix, now covered end to end)
- readiness gating blocks completion until age, serial photo, every checkpoint and every required reading are captured
- completing an inspection generates a health report sourced from field data, which renders with the locked Wilson Estate Care styling
- no horizontal overflow at 390px on the visit list, the appliance detail or the customer report
- every rating button clears the 44px tap-target minimum (they measure 65x56)

Also confirmed, contradicting an earlier suspicion: typing into a reading field does **not** move the viewport and does not drop focus. The v0.8 mobile fix holds. An apparent jump in early runs was Playwright's own scroll-into-view on click, not the application.

The smoke test skips cleanly when Playwright is absent, so `_qa/run_all.sh` stays useful without it.

Added `docs/PHONE_FIELD_TESTING.md`: direct visit links for the seeded demo visits, the LAN/firewall path, the per-device `localStorage` gotcha, and a checklist of what only a real handset can test - camera capture, one-handed reach, iOS Safari focus and zoom behaviour, autosave across app switches, and outdoor legibility.

# v0.9.2 - Filter service is priced

- **Estate Concierge includes filters outright.** Already true in config and the plan seed; the plan feature copy now says so in the customer's terms ("Water and air / food-preservation filters included at no extra charge").
- **Filter service now raises the annual plan price.** Previously the enrollment summary rendered the line as `Added` with no amount and `planCost()` never saw it, so opting in was free. Selecting it now adds Wilson's filter sales price to the annual plan total on Per Appliance, Estate Annual and Estate Preferred; it stays $0 on Estate Concierge.
- **Water and air filters are separate customer choices.** Water is the headline option and is auto-included on Concierge. Air / food-preservation filter service (common on Sub-Zero and similar) is always an explicit opt-in and is never checked by default. Icemakers are offered water only; refrigeration is offered both.
- **Icemakers can now elect filter service.** The checkbox was previously offered on refrigeration alone, and the household count only tallied `customerCategory === "refrigeration"`, so icemaker filter service was unreachable despite the category carrying an icemaker water filter.
- **Priced per filter, not per appliance.** Each kind carries a quantity (default 1), so a Sub-Zero taking two water filters prices at 2x. Quantity falls back to the config default when absent, zero, or non-numeric.
- Pricing lives in one place: `WILSON_FILTERS` in `plan-config.js`. The enrollment builder, summary, household profile, field tool and demo backend all price through it rather than reimplementing the arithmetic.
- The technician's filter banner now names which filters the customer paid for and their counts, so the tech knows what to bring. Filter records created at enrollment are marked `Included - priced into plan` rather than `billed separately`.
- Schema: added `dbo.MaintenanceFilterPrices` (kind-level fallback rows plus part-number rows), per-asset `WaterFilterServiceOptIn` / `AirFilterServiceOptIn` / quantity columns, and `MaintenanceSubscriptions.FilterServiceAnnualAmount` + `FilterServiceDetailJson`.
- Added `_qa/verify-filter-pricing.js` - 33 assertions covering eligibility, per-kind pricing, quantities, the Concierge interaction, household rollups, and that filter cost never distorts the IMUC-aware estate-plan comparison.

**PLACEHOLDER PRICING.** Water and air are both $70/filter pending Wilson's filter sales-price list. The figure is read from config in one place, seeded into `MaintenanceFilterPrices` with `PriceIsPlaceholder = 1`, and surfaced in the enrollment summary as "Placeholder pricing - awaiting Wilson filter sales-price list" so no one mistakes it for an approved number.

# v0.9.1a - SQL migration

- Added `sql/maintenance_migration_v09.sql`, implementing MERGE_GUIDE section 7: property areas, household AR/billing method, the three-table technician field-inspection layer, report delivery tracking, technician user linkage, and versioned lifecycle and protocol configuration. 12 new tables, 11 new columns on existing tables, 3 new views.
- The migration is strictly additive and idempotent: every table is guarded by `OBJECT_ID`, every column by `COL_LENGTH`, every index by a `sys.indexes` check, and every seed is a `MERGE` on a unique key. It redefines no existing object, so re-running `maintenance_schema.sql` afterwards cannot revert it.
- Protocol, brand-tier, expected-life and lifecycle-stage seeds are generated from `assets/plan-config.js` by `sql/generate_migration_v09.py` rather than hand-transcribed, so the database and the JS config cannot drift.
- `dbo.MaintenanceProtocolAssignments` plus `dbo.vw_MaintenanceAssetProtocol` are the SQL form of `WILSON_PROTOCOL.resolveCheckpointSet()`, including the IMUC override and the stored-snapshot fallback. `StoredValueIsStale` finds assets still carrying a pre-v0.9.1 `CheckpointSetCode`.
- Added `dbo.vw_MaintenanceHouseholdPaymentReadiness` so AR households resolve as payment-ready without a card, per MERGE_GUIDE 7.2, and `dbo.vw_MaintenanceFieldProgress` for Command Center field/report progress.
- Status columns carry `CHECK` constraints using the MERGE_GUIDE section 34 vocabularies, so a UI phrase cannot be persisted as state.
- Added `_qa/verify-sql-migration.py` (structure, guards, FK targets, MERGE key backing, N-prefixed literals) and `_qa/verify-protocol-parity.py`, which compares the SQL resolution model against the real JS resolver across all 520 type/category/group combinations. `_qa/run_all.sh` runs everything.

# v0.9.1

- Consolidated inspection-protocol selection into a single source of truth. `plan-config.js` now owns resolution via `WILSON_PROTOCOL.resolveCheckpointSet()`; the duplicate hardcoded if-chain in `tech-maintenance.js` `templateKey()` has been removed.
- Corrected four customer categories that stored the wrong `checkpointSet`: Ventilation (was generic), Microwave (was cooking), Washer and Dryer (both were laundry). The `ventilation`, `microwave`, `washer` and `dryer` protocols were defined but never assigned.
- Corrected the same class of defect in the internal `applianceTypes` taxonomy: Vent Hood and Hood Insert (were generic), Microwave / Speed Oven (was cooking), Washer and Dryer (were laundry).
- Corrected nine seeded demo appliances that persisted the wrong `checkpointSet`.
- Added a `laundry` entry to `lifecycleMatrix`. Laundry-center assets previously fell through to the generic 15/10/8 expected-life curve.
- Added `_qa/verify-protocol-resolution.js`, the first automated test in the package: asserts that every customer category and every exact appliance type resolves to its intended protocol, that no protocol is orphaned, and that legacy assets holding a wrong stored value still resolve correctly without a data migration.
- Marked `docs/API_CONTRACT.md` superseded pending its v0.9 rewrite.

# v0.7

- Fixed mobile technician number-entry fields so age and temperature entry no longer re-render the page or jump back to the top.
- Retired the separate Appliance Health Report Builder and removed all customer-report creation links that bypass field data.
- Health reports now auto-generate from completed technician protocols only.
- Added visit-level report completion: once every in-scope appliance is complete, the visit is marked completed and its report package becomes Ready to email.
- Added Command Center and household prompts to review and queue completed report packages for customer email.
- Added a recovery Generate health report action only when a completed field inspection exists without a generated report.
- Locked the existing seven-page Wilson Estate Care customer health-report styling for all appliance types.
- Added automatic brand-tier defaults in the tech tool: Thermador defaults Luxury; Bosch and KitchenAid default Mass premium; Whirlpool defaults Mass, with additional starter brand mappings.
- Second-visit IMUC scopes now limit the field tool to the icemakers included in that maintenance visit.

# v0.6

- Rebuilt the refrigeration field protocol around five concise health checks.
- Added structured refrigerator and condenser temperature readings plus live condenser TD calculation.
- Required serial-tag photo on every appliance; checkpoint photos remain optional.
- Added Early Life / Mid Life / Mature / Replacement Planning lifecycle labels.
- Corrected the config so field scoring consistently uses the intended 75% condition / 25% lifecycle weighting.
- Added Wilson Filter Service opt-in to every customer-facing refrigeration asset, including per-appliance enrollments.
- Estate Concierge automatically shows refrigeration filter service as included; other plans record the opt-in and bill filter materials at service after verification.
- Backend asset/filter records retain the filter-service selection.

# Changelog

## v0.2 - 2026-08-21

### Customer enrollment

- Added default twice-yearly IMUC frequency with a clear manufacturer-recommended explanation.
- Added one-visit IMUC opt-down and live $249.95 second-visit calculation.
- Changed Estate eligibility from a 10+ unit requirement to automatic price crossover.
- Added automatic plan switching while preserving entered appliances.
- Added draft Estate base-plus pricing and 26+ appliance internal review.
- Replaced the old HVAC membership-plus-visit model with $200 and $400 per-system annual tiers, each including two visits.
- Added filter-capture fields to the HVAC filter-management tier.
- Added annual renewal and scheduled-interval charge authorization.

### Internal operations

- Added exact charge amount by maintenance interval.
- Added future NetSuite service-order integration boundary.
- Added combined household appliance and HVAC records.
- Expanded filter coverage and status tracking.
- Added Custom Quotes and Plan Setup dashboard tabs.

### Custom estate proposals

- Added custom quote builder with grouped appliance quantities.
- Added base, overage, IMUC add-on, and manual-adjustment calculations.
- Added professional printable proposal and Draft / Sent / Accepted statuses.

### Appliance health reports

- Rebuilt the generic template around overall score, vitals, score breakdown, inspection details, corrective measures, report information, and service summary.
- Added appliance-specific vitals and checkpoint sets.
- Added transparent equal-weight starter scoring and category deductions.
- Added maintenance tasks, filters, photos, recommendations, and report history.

### Fixes and QA

- Corrected IMUC default selection when an existing row is changed from a standard appliance to an icemaker.
- Added HVAC filter records to filter-management enrollments.
- Corrected seeded custom-quote count, overage, and IMUC arithmetic.
- Completed JavaScript syntax, full-page render, and 39-step browser interaction testing.
- Added re-rendered sample appliance-health-report and estate-proposal PDFs.
- Added print-specific grid rules after PDF QA identified and corrected clipped subsystem content.
- Added a business-rule decision log and formal QA summary for developer handoff.

## v0.2.1 - launcher and navigation packaging fix

- Added a robust Windows launcher, `OPEN_WILSON_PORTAL.bat`.
- Added `serve_portal.py`, which starts the server before opening the browser and automatically selects an open port from 8080-8090.
- Added an on-page warning when HTML is opened directly with `file://` instead of through the launcher.
- Added `README_FIRST.txt` with extraction and launch instructions.
- Repacked the download so the launcher appears at the top level instead of inside a second nested project folder.
- Revalidated every local HTML, CSS, JavaScript, image, PDF, Markdown, and SQL link target in the package.

## v0.3 - icon-first enrollment and Wilson invoice import

### Customer enrollment

- Replaced model-entry rows with twelve broad, illustrated appliance-category buttons.
- Added custom 2D Wilson appliance icons that reflect high-end built-in and professional product styling.
- Added quantity controls directly on each appliance button.
- Added Main House plus customer-created areas with desktop drag-and-drop and mobile Move To controls.
- Removed customer plan selection below the Estate crossover.
- Kept automatic per-appliance/ Estate Annual selection and reveals Estate Annual, Preferred, and Concierge only after the crossover.
- Preserved exact internal product data when enrollment is created from a Wilson invoice.

### Internal invoice import

- Added an Invoice Import tab to Maintenance Operations.
- Added local multi-PDF parsing for Wilson sales invoices, including split invoices.
- Added Ship To extraction, printed area-heading extraction, brand/model/serial capture, exact-type inference, and broad customer-category mapping.
- Added filtering for installation, accessories, payments, credits, delivery, and support parts.
- Added review flags for unassigned split-invoice items and WashTower/laundry-center expansion.
- Added one-click maintenance-draft creation that opens the customer enrollment with the extracted inventory already arranged.
- Bundled the pure-Python pypdf parser and license for no-install local use.

### QA

- Tested the parser against `S00063887` and `S00063887-1` together.
- Extracted 18 product lines, expanded two laundry centers, and produced 20 maintenance records.
- Verified four areas, exact invoice detail retention, customer-category counts, and Estate plan crossover.

## v0.5 - operations command center, smarter estate selection, and mobile field health workflow

### Internal operations
- Replaced the single dense due queue with a four-module command center: Action Required, Ready to Charge, Schedule / Ticket, and Completed & Health.
- Defined the active charge window as 14 days before through 14 days after the planned interval.
- Added payment-problem prioritization and charged-without-ticket flags.
- Added a future EPASS daily-export verification placeholder so a paid interval can remain flagged until a matching service order is found.
- Moved recent activity into its own navigation section and removed the prototype-workflow block from the landing view.
- Rebuilt the internal section navigation into a cleaner module bar.
- Added household billing mode for Card on File vs Account / AR with terms.

### Customer enrollment
- Estate eligibility now compares Per Appliance against both Estate Annual and Estate Preferred.
- The auto-selected estate tier is the lower-cost starting tier for the actual appliance mix, so IMUC-heavy homes can correctly default to Preferred when two-visit pricing makes it cheaper.
- Added over-the-range microwave to the customer-facing Microwave category description.
- Replaced backend-oriented customer hero statistics with homeowner-facing maintenance benefits.

### Field maintenance and health reports
- Added a mobile-first technician maintenance tool launched by household and visit.
- Organized appliances by household area and tracks completion progress.
- Added simple 1-5 sliders, performed checkboxes, readings, notes, serial-tag photo prompt, and optional condition photos.
- Reduced templates to short actionable field checks for refrigeration, dishwashers, cooking, icemakers, washers, dryers, ventilation, and microwaves.
- Completing all required steps automatically creates a Wilson appliance health report.
- Added draft lifecycle scoring using 75% current-condition vitals and 25% age.
- Added configurable Luxury, Premium, and Mass-market life-expectancy tiers plus category-specific draft life spans and brand defaults.

## v0.8 - Field technician UX

- Fixed the transparent/low-contrast field visit banner caused by an undefined `--green` CSS variable.
- Removed sticky positioning from the residence/visit banner so it no longer follows the tech down the page or blocks controls.
- Added signed-in technician display with production-oriented session handoff and optional prototype URL override.
- Added visit progress stats for complete, remaining, and attention items.
- Added a Suggested Next Step card that resumes in-progress appliances before untouched appliances.
- Added per-area progress and appliance status pills.
- Added persistent Monitor / Needs Follow-up callouts during the visit.
- Added debounced autosave for field data.
- Added larger touch-friendly quick rating buttons while retaining the 1-5 slider.
- Added a clear completion-readiness strip and disabled report generation until required field steps are complete.
- Added a final visit-complete summary once every scoped appliance report exists.
- Added an HVAC guardrail so HVAC maintenance visits do not populate appliance-health workflows.
- Updated report regeneration so corrections to a completed field inspection refresh the existing customer report.


## v0.9
- Field visit links are now strict to the exact visit + household; no first-household fallback.
- Household records split Appliance Maintenance and HVAC Maintenance into separate modules.
- Removed redundant generic field-visit launches; appliance section owns the appliance launch action.
- HVAC launch is separated and intentionally disabled until the HVAC field workflow is built.
- Replaced rating sliders with five large 1-5 tap buttons.
- Local prototype server now prints a same-LAN phone URL for mobile testing.
