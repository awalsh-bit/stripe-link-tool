# v0.2 QA Summary

_Date completed: 2026-08-21_

## Browser and JavaScript validation

- All 12 JavaScript files passed `node --check`.
- All 10 HTML pages rendered without JavaScript errors.
- All local HTML, CSS, JavaScript, and image references resolved in the static link check.
- The built-in Node server returned HTTP 200 for the landing page, enrollment pages, internal dashboard, report view, quote view, stylesheet, and logo asset.

## Interaction suite

The prototype passed **39 of 39** automated browser checks covering:

- Standard appliance starting price.
- IMUC default of two annual visits.
- $499.90 annual estimate for one IMUC at two visits.
- Automatic Estate Annual crossover.
- Preservation of entered appliances during plan switching.
- Estate Annual plus separate second-IMUC interval billing.
- Stripe SetupIntent placeholder flow.
- HVAC $200 and $400 plan calculations.
- Two-system HVAC enrollment at $800/year.
- First-interval charge with the second seasonal visit included.
- HVAC filter records marked as managed with material billed separately.
- Unified dashboard due queue.
- Charge-card action state.
- NetSuite service-order placeholder state.
- Appliance report score response and saved corrective action.
- Custom quote overage and annual-total arithmetic.

## SQL static validation

The SQL Server starter schema was checked for:

- Balanced parentheses.
- Balanced `BEGIN` / `END` blocks.
- Unique table, index, and constraint names.
- Foreign-key references to existing tables created earlier in the script.
- Seven plan seed rows matching the 24-column `MERGE` source definition.
- Complete operational view definitions.

The schema has **not** been executed against a live SQL Server instance in this environment. It should be applied first to a disposable development database and reviewed before any production migration.

## PDF validation

Two sample PDFs were generated from the browser prototype and re-rendered to PNG for inspection:

- Seven-page Wilson Appliance Health Report.
- Three-page Wilson Estate Maintenance Proposal.

The initial report render exposed a mobile-print grid collision that clipped subsystem content. Print-specific grid rules were added, the PDFs were regenerated, and all pages were re-rendered and visually checked for clipping, overlap, and missing content.
