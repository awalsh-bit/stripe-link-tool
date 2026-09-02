# Maintenance Plans module (v0.9.50 demo inside Agility)

Updated 2026-09-02. The prototype from `maint-plans/wilson_maintenance_portal_v0950/` now runs inside Agility at `/maintenance/` with all of its functionality — pricing, protocols, scoring, brand tiers and lifespans, water hardness, filter verification, amendments/proration, follow-ups, the visit-launch guardrail, Guardian flag rules, invoice import and Filter Finder. `docs/MAINTENANCE-V095-REVIEW.md` is the fit review that preceded this; this file is what actually shipped.

## Decision recorded

**WashTower / laundry center = two appliances.** Andrew Walsh, 2026-09-02: the washer and dryer are serviced more or less separately. The enrollment tile says "Counts as 2 appliances", the invoice importer expands the line into a washer record and a dryer record, and each is priced and inspected on its own protocol. This supersedes the 2026-08-24 one-asset note that was in the earlier Agility copy.

## Where the data lives (and why no new tables)

The module is a **demo**: operational data (households, assets, subscriptions, visits, inspections, reports, quotes, filters, follow-ups) lives in the browser's localStorage via `WilsonStore` (`maintenance/assets/store.js`), photos in the phone's IndexedDB. Nothing in this module polls Postgres; a page load costs one `/api/auth/session` call, which every Agility page already makes for the shell. "Reset demo data" on the Today screen reseeds the browser.

Three things touch the server, all through code Agility already had:

| Touchpoint | What it uses | Notes |
|---|---|---|
| Technician identity | `/api/auth/session` → `WILSON_SESSION_USER` (cached in `sessionStorage`, announced as `wilson:session`) | The field tool stamps inspections with the signed-in user's display name. The prototype's `?technician=` URL parameter is gone. |
| Field photographs | `POST /api/maintenance/photos` → existing `install_damage_photos` table (`report_ref = "maint:<visitId>"`, `kind = "maint_<kind>"`, new nullable `meta` JSONB column for asset/check/technician provenance); `GET /api/maintenance/photo/:id` | One photo per request, raw image body, provenance in `X-Photo-*` headers — the contract `assets/photo-sync.js` already spoke. Uploads only when the phone can reach the server; the phone keeps its copy. Both routes are gated by the Field Tool page permission. |
| Invoice import | `POST /api/invoice/import` (`lib/maintenance-invoice-parser.js`) | Brought to parity with `invoice_parser.py` v0.9.50: footer/terms detection (a real dryer was being dropped because "installation guides" matched "install"), invoice date anchored to the invoice number with a confidence label and `installYear`, word-boundary exclusions, outdoor-grill classification, WashTower pair, unreadable-file handling, and the file name preferred as the invoice number when the page mentions it. Verified field-for-field against the Python parser on the prototype's five synthetic fixture invoices. Gated by the Invoice Import page permission. |

Not shipped, on purpose: the service worker / PWA manifest (`sw.js`), the Python passcode server, `field-preview.html` (a 1 MB single-file bundle for phone testing outside a server), and the Guardian pilot server (`tools/guardian-pilot-server.js` is standalone and can run on the shop machine for the sensor pilot).

## Look and feel

- `maintenance/assets/ui.js` no longer draws its own header/footer. Internal pages mount `internal-shell.js` (hamburger, tools card, colour scheme) and customer-facing pages mount `public-shell.js`; a row of module links sits under the shell. `internal-shell.js` and `public-shell.js` gained a `data-shell-root` / `data-public-shell-root` attribute so their relative links and logo resolve from a subfolder.
- `wilson.css`: every brand green (68 distinct hexes) now reads from the `--primary*` tokens, so a user's red or purple scheme applies to the whole module; semantic colours (success / warning / danger, confidence badges) stay fixed. Font is Roboto.
- `maintenance/assets/agility-bridge.css` holds the seam styles (module nav, green token defaults for the public pages, compact header on the phone field tool).
- Filter Finder got the same treatment (shell, tokens, Roboto, no dark-mode palette).

## Pages and grants

All sixteen pages are registered under a new **Maintenance Plans** category in User Admin and a **Maintenance Plans** section in the hamburger (Today, Customers, Refrigeration Guardian, Field Tool, New Quote or Enrollment, Invoice Import, Filter Finder, Customer-Facing Site). The customer-facing pages (`index`, `appliance-signup`, `hvac-signup`, `confirmation`, `customer-info`) are served **inside the signed-in dashboard** for the demo; putting them on the service host comes with the real backend, because that is when server-side pricing and Stripe card-on-file exist.

Suggested grants: Client Care gets everything except the Field Tool; technicians get the Field Tool, Customers and the household record; execs see all.

## Verification

- The prototype's own browser suite (`_qa/smoke_browser.py`, 262 checks: pricing, Estate crossover, WashTower expansion and grill scope, dashboard stages, filter verification queue, launch guardrail, field tool on a phone, HVAC workflow, print fidelity, report generation, adding to a plan in the field) was run **against Agility** with a real session cookie — all 262 pass.
- Every page rendered at 1366px and 390px in all three colour schemes: no console errors, no horizontal overflow, shell header and footer present.
- Photo route: upload → stored row with provenance → served back byte-identical; wrong content type 415; unauthenticated 401; install-damage route refuses maintenance photos.
- Invoice parser: JS output equals Python v0.9.50 output on all 24 items, 18 ignored lines, contact block and warnings.

## What the backend will need (unchanged from the review)

Postgres schema + `/api/maintenance/*` replacing `WilsonStore`, Stripe card-on-file and office-initiated charges, Resend report delivery on an explicit click, follow-up notifications into `/api/notifications`, public pages on the service host with server-side pricing. The 40 store methods the pages call are the contract; `docs/MAINTENANCE-V095-REVIEW.md` lists them.
