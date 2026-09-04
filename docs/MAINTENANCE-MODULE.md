# Wilson Guardian module (maintenance plans, v0.9.51 demo inside Agility)

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


## 2026-09-04 — Cayden's first-pass notes (v0.9.51)

- **Rebrand.** The program is **Wilson Guardian** (`WILSON_CONFIG.programName`); the sensor service is **Wilson Guardian Temp Monitoring** (`tempMonitoring.serviceName`), never bare "Guardian". Page titles, the shell badge ("Wilson Guardian · Command Center"), the public badge, the User Admin category and the hamburger all follow. The hamburger section has exactly four entries: Guardian Registration, Guardian Command Center, Guardian Temp Monitoring, Guardian Field Tool; Customers, Invoice Import, Filter Finder and the quote builder are reached from the module's own link row.
- **Registration page.** "How it works" removed from the landing page; the "Your home" hero tile is customer-facing copy; the household label example is "Reynolds Household"; the scheduling section is now just **Getting in** (months / days / time / away-dates stay in the DOM hidden because the scheduling control renders into them) with the "Anything else Wilson should know" box directly under the access chips so a gate code can be typed after "Gated entry".
- **Field tool photos.** Photos are stored in IndexedDB as an ArrayBuffer and rebuilt into a Blob on read (`photo-store.js`) — iOS Safari fails to store camera Blobs directly, which was the "blob failing to save" error. The `capture=` attribute is gone from all three file inputs so a phone offers camera **or** camera roll (needed for the IR image taken in another app).
- **Age verification.** A third age source, `serial` ("Verified from serial tag"), is documented and scores as verified. The tech picks Customer told me / My estimate / ✓ Verified on serial tag; the store upgrades a customer-stated year to serial-verified without recording a correction; reports say "verified by the technician from the manufacture date on the serial tag".
- **Pricing.** Estate Concierge includes two Temp Monitoring sensors (`includedTempSensors: 2`); a third and beyond bill at the member additional rate ($99). HVAC plans are **$199 / system / year** and **$399 with filter service**.
- **HVAC on measureQuick readings.** `hvac_cooling` and `hvac_heatpump` are now two keypad checks — Outdoor measurements (low/high pressure, suction/liquid/discharge line, outdoor air, condenser V/A/PF) and Indoor measurements (return/supply dry & wet bulb, RH, RESP/SESP or TESP, estimated airflow, air-handler V/A) — plus condensate and safety. `hvac-performance.js` turns gauge pressure into saturation temperature through PT tables in config (R-410A and R-22 verified; R-32 and R-454B marked approximate), and derives superheat, subcooling, condenser approach, temperature split, TESP, compression ratio, CFM/ton and filter face velocity. Bands are measureQuick's (superheat 6–24 TXV / 8–30 piston, subcooling 7–13 / 5–15, approach 1.5–13, split 16.5–22.5, TESP ≤ plate max or 0.2–0.7, face velocity ≤ 500 FPM), marked draft in config. Score = charge 30% + split 25% + static 25% + approach 20% (the 75% vitals share), blended with **age at 25%** from a **flat expected life per system type** (15/14/18/12 years) with no brand or efficiency-tier modifier; SEER is recorded and never scored; amps and face velocity are flagged, not scored. The customer report prints the vitals with their bands and the measureQuick-style loss buckets including zero rows. Verified against the 4/7/2026 measureQuick FullReport: same readings give superheat 16.3 / subcooling 8.0 / approach 4.6 / split 21.4, all in range, 87 overall (100 vitals, 13-year-old system) against measureQuick's 85% B. Automating the readings from the same probes is a later step; entry is manual today.
- **Verification.** 28 targeted browser checks pass (menu, registration edits, pricing, HVAC walk with the report numbers, SEER guardrail, age chips, photo round-trip, report rendering); 256 of the prototype's 262 checks pass — the six that fail assert the old names, the old HVAC reading set and the old captions, all changed on purpose.
