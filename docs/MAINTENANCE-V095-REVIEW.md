# Maintenance Plans v0.9.50 — fit review for Agility

Reviewed 2026-09-02 against `maint-plans/wilson_maintenance_portal_v0950/` (211 files, dated 2026-09-02 22:36) and the copy of the module already living at `/maintenance/` inside Agility (v0.9.3 plus the 2026-08-24 WashTower change). Every v0.9.50 page was served locally and rendered at 1366px and 390px; no page throws, none overflows horizontally. Screenshots are referenced where they matter.

## The short version

The module is a well-reasoned, self-consistent **prototype** with a large amount of domain logic in it (pricing, protocols, scoring, lifecycle, filters, Guardian monitoring). It is not yet a tool that can be dropped into Agility, for three structural reasons that have nothing to do with code quality:

1. **It was written for a different host.** Every merge document (`MERGE_GUIDE.md`, `MERGE_DISCOVERY_REQUEST.md`, `ARCHITECTURE.md`) assumes the Wilson dashboard is a Flask app on SQL Server with Jinja templates, blueprints and Flask-Login. Agility is Node/Express on Postgres with static HTML pages, `internal-shell.js` and `req.authUser`. The 48 SQL tables are T-SQL (`NVARCHAR`, `DATETIME2`, `IDENTITY`, `GO`), the invoice parser and the whole QA harness are Python, and the serving/auth layer is a Python passcode server. None of that ports by copying.
2. **It has no backend.** All persistence is `WilsonStore` — a 3,600-line localStorage object with ~50 methods — plus IndexedDB for photos. The other AI was explicit that this is throwaway ("the demo data layer is thrown away entirely — it was never production persistence"). The 40 store methods the pages call are the API surface Agility has to provide.
3. **It draws its own shell.** `ui.js` renders a replica of the Wilson header/footer with its own menu, its own green (`#155b26` vs Agility `#21692c`), Inter instead of Roboto, and no awareness of Agility's three colour themes or the hamburger. It looks *related* to Agility but is visibly a second app.

Recommendation: treat v0.9.50 as the **specification and front-end source**, keep the rule engine (`plan-config.js`) and the field tool largely as written, and build the Agility side (Postgres schema, `/api/maintenance/*`, shell, auth, Stripe, photos, notifications) here — phased, starting with what makes real customer stops possible. Details and a phase plan are below. There is also one business decision that has already been made two different ways (WashTower) that Andrew needs to settle before any of it lands.

## What arrived vs. what Agility already has

Agility's `/maintenance/` is v0.9.3. The zip is v0.9.50 — 47 releases later. The changelog is 190 KB; the changes that matter for integration:

| Area | v0.9.3 (in Agility) | v0.9.50 (new) |
|---|---|---|
| Pages | 10 | 17 — adds `customers.html`, `customer-info.html`, `equipment.html`, `monitoring.html`, `invoice-import.html`, `visit-report.html`, `filter-finder.html`, `field-preview.html`; `quote-builder.html` removed (quotes are now built on `appliance-signup.html`) |
| Internal nav | Command-center tabs | "Two screens": **Today** (`admin.html`) and **Customers**, plus Guardian |
| Data layer | `store.js` 30 methods | `store.js` 50 methods, state version 8; adds follow-ups, amendments/proration, filter verification, visit-launch guardrail, equipment gaps, parked equipment, temp dispatches, water tests |
| Rule engine | `plan-config.js` ~150 KB | 291 KB — brand tiers & lifespans, water hardness bands, HVAC protocols, scoring weights, Guardian flag rules, amendment billing, serviceability copy |
| Field tool | `tech-maintenance.js` | 131 KB — keypad auto-advance, evidence photos, nameplate carry-forward, launch guardrail, HVAC path |
| Reports | `report-view` | plus `visit-report` (whole-visit maintenance review), paginated print |
| Offline | none | `sw.js` service worker + `app.webmanifest` (installable PWA), `offline.js` banner |
| Photos | none | `photo-store.js` (IndexedDB on the phone) + `photo-sync.js` → `POST /api/photos` on the Python server, sidecar JSON per photo |
| Auth | none | shared shop passcode in `serve_portal.py` (12h cookie, lockout) — explicitly "not an identity system" |
| Guardian | none | `monitoring.html` + `temp-monitoring.js` (simulated readings) + `tools/guardian-pilot-server.js` (real UbiBot webhook ingest, drill labeling, JSONL/CSV export) |
| Filter Finder | none | Jack Ort's `filter-finder.html` dropped in verbatim (own CSS, no shell) |
| Follow-up handoff | none | `docs/FOLLOWUP_QUOTE_HANDOFF.md` — a contract that expects Agility's **My Notifications** and **Service Estimate Approvals** to receive maintenance follow-ups |
| Invoice parser | JS port in `lib/maintenance-invoice-parser.js` | `invoice_parser.py` gained the footer/`install` word-boundary fix (v0.9.29 — a real dryer was being dropped) and outdoor-grill classification (v0.9.5). The JS port has neither. |
| SQL | v0.9 T-SQL migration | same file regenerated from the current config (15 templates, HVAC rows); still T-SQL |
| Tests | — | `_qa/` 15 Python suites / 372 checks, browser smoke via Playwright-for-Python |

The docs describe the field tool as having been walked on real houses (`PILOT_READINESS.md`, `PHONE_FIELD_TESTING.md`), so the workflow itself has had real use; only the plumbing under it is demo.

## How it is shaped

**Front end.** Static HTML, vanilla JS, no build step. Each page loads `plan-config.js` (rules), `ui.js` (shell), `store.js` (data), then its page script. Everything is exposed as globals: `WILSON_CONFIG`, `WILSON_PRICING`, `WILSON_PROTOCOL`, `WILSON_LIFECYCLE`, `WILSON_BRANDS`, `WILSON_FILTERS`, `WILSON_WATER`, `WILSON_TEMPWATCH`, `WILSON_PHOTOS`, `WILSON_OFFLINE`, `WilsonStore`, `WilsonUI` and about ten more. This is fine for Agility — our pages are the same shape — and it means the pages can be served straight from `/maintenance/` as they are today.

**Data.** `WilsonStore.load()` returns one JSON blob (`households, assets, subscriptions, paymentProfiles, visits, filters, reports, quotes, invoiceImports, activity`) seeded with demo households (Reynolds Estate, Davenport, Torres, Hamilton). Pages read the whole blob synchronously and mutate it through store methods. That synchronous whole-state pattern is the main thing an API layer has to unwind: `admin.js`, `household.js`, `customers.js`, `monitoring.js` and the field tool all call `WilsonStore.load()` and walk arrays. The 40 distinct store methods used outside `store.js` are, grouped:

- Read: `load`, `getHousehold`, `getHouseholdBundle`, `getTechInspection`, `getReport`, `getQuote`, `equipmentGaps`, `openFollowUps`, `quotedFollowUps`, `pendingAmendments`, `unverifiedFilters`, `applianceVisitLaunch`, `scopedAssetsForVisit`, `lastEnrollment`, `lastQuote`, `loadInvoiceDraft`
- Enrollment/quote: `createEnrollment`, `amendEnrollment`, `saveQuote`, `updateQuoteStatus`, `acceptQuote`
- Office actions: `mockCharge`, `connectPayment`, `setHouseholdBilling`, `queueServiceOrder`, `queueReportEmail`, `markFollowUpQuoted`, `handFollowUpToApprovals`, `markFilterVerified`, `markAmendmentCharged`, `recordTempDispatch`
- Field: `saveTechInspection`, `generateReportFromTechInspection`, `saveWaterTest`, `saveAssetDesign`, `setAssetEnvironment`, `applyEquipmentDetails`, `correctAssetDetails`, `replaceAssetMachine`
- Import: `saveInvoiceDraft`, `clearInvoiceDraft`, `recordInvoiceImport`; and `reset` (demo only)

**Rules.** `plan-config.js` is the crown jewel: every price, protocol checkpoint, scoring weight, brand tier, lifespan, water-hardness band, Guardian threshold and customer-facing sentence lives there, with the reasoning in comments. `sql/generate_migration_v09.py` turns it into seed rows, and `_qa/verify-sql-migration.py` fails on drift. Keeping this file as the single source of truth (and generating Postgres seed from it the same way) is the right call.

**Server.** `serve_portal.py` does four things: serve static files, gate everything behind a shared passcode, parse invoice PDFs (`/api/invoice/import`, via vendored pypdf) and accept photos (`/api/photos`, to a local `photo-store/` folder). Agility already replaces the first and third; the second is replaced by Agility login; the fourth maps onto the photo table built for install damage.

**Offline/PWA.** `sw.js` caches the shell assets (cache-first, versioned per release) so the field tool loads without signal. `offline.js` is careful to say "saved on this device, nothing sent yet" because there is no sync. Photos go to IndexedDB and `photo-sync.js` drains them when the server answers. This is a genuinely useful design for a tech in a basement, but note it is *page* caching, not *data* sync — field inspections are saved to localStorage and only become server data when a real API exists.

**Guardian.** `monitoring.html` runs on simulated temperature series today. The real ingest is `tools/guardian-pilot-server.js`: a standalone Node HTTP server that receives UbiBot data-forwarding webhooks (`POST /ubibot`), keeps 48h of readings, evaluates the same flag rules as the page, records drills for a training dataset, and exports JSONL/CSV. It is deliberately separate from the portal. Cayden's stated goal is hundreds of monitored refrigerators with automatic priority dispatch.

**SQL.** 48 `Maintenance*` tables in T-SQL across `maintenance_schema.sql` (v0.3, superseded) and `maintenance_migration_v09.sql` (generated). Foreign keys to a user table are left open for the host. `docs/API_CONTRACT.md` is marked superseded by its own author — do not build to it.

## What it takes to become an Agility tool

Mapping each prototype dependency to what Agility already has:

| Prototype piece | Agility equivalent | Effort |
|---|---|---|
| `serve_portal.py` passcode | Agility session + `requirePagePermission("/maintenance/...")`; technician identity from `req.authUser` (email, display name, directory code). Kills the `?technician=` URL parameter and "Wilson technician" fallback. | Small |
| T-SQL migration (48 tables) | New `lib/maintenance-postgres.js` with `CREATE TABLE IF NOT EXISTS` schema in Agility's style (snake_case, `timestamptz`, `jsonb` for provenance/readings). Fewer tables than 48 is realistic: protocol/lifecycle/brand config can stay in `plan-config.js` rather than being mirrored as tables, as the prototype itself does at runtime. | Large — the schema is the single biggest task |
| `WilsonStore` (50 methods) | `/api/maintenance/*` routes in `server.js` + a thin browser adapter that keeps the `WilsonStore.*` names but calls the API (async). The pages assume synchronous `load()`; the adapter would pre-fetch a household bundle per page instead of the whole world. | Large; mechanical once the schema exists |
| `POST /api/photos` + `photo-store/` | `install_damage_photos` table (`lib/install-damage-postgres.js`) already stores multipart images with kind/claim-token; add kinds `maint_evidence` / `maint_nameplate` and a `visit_ref`. `photo-sync.js` can keep its retry semantics and just change the endpoint and auth. | Small |
| `mockCharge` / `connectPayment` | Agility already creates Stripe customers, SetupIntents and PaymentIntents (service request form, terminal payments, receipts). Card-on-file + office-initiated charge at the visit window is the same pattern as service estimates. Must respect the no-plain-text-card rule; Payment Element on the public signup page, exactly like `applianceservice.html`. | Medium |
| `queueReportEmail` / "Ready to email" | Resend via `CLIENT_FROM_EMAIL`, sent only on an explicit office click (Andrew's no-surprise-contact rule). Report PDF: the pages already paginate for print; server-side PDF would use pdf-lib as the commission statement does, or a headless-Chromium print of `report-view.html` since Playwright is already a dependency. | Medium |
| `queueServiceOrder` (NetSuite adapter) | Nothing exists in Agility for creating NetSuite service orders; today this is a manual ePass step. Keep it as a "create ticket" checklist state + audit entry, as the prototype does. | None now |
| Follow-up → quote → estimate handoff | Agility has `/api/notifications` (mine/claim/close) and Service Estimate Approvals. The contract in `FOLLOWUP_QUOTE_HANDOFF.md` maps cleanly: `open` → a notification to the flagging tech, `quoted` → command-center flag, `handed` → existing estimate flow. | Small–medium |
| Public pages (`index`, `appliance-signup`, `hvac-signup`, `confirmation`, `customer-info`) | Serve on `SERVICE_PUBLIC_HOST` with `public-shell.js/css`, same as `applianceservice.html`; server-side price recalculation before anything is saved (the prototype's own rule: "never trust the browser's total"). | Medium |
| Invoice import | Already ported (`lib/maintenance-invoice-parser.js`, `/api/invoice/import`). Needs the v0.9.29 footer fix and outdoor-grill classification back-ported, plus whichever WashTower rule wins. | Small |
| Guardian pilot server | Either run `guardian-pilot-server.js` as-is on the shop machine for the pilot (it is self-contained), or fold `POST /ubibot` ingest + a `maintenance_temp_readings` table into Agility later. Do not put it in Agility until the pilot has proven the thresholds. | Defer |
| `sw.js` / PWA | Works under Agility only if scoped to `/maintenance/` and the cache list is rewritten to Agility asset paths; must never cache API responses or authenticated pages. Reasonable for the field tool only. | Small, but decide whether you want it at all |
| `_qa/` Python suites | Rewrite the pieces that matter as `/tmp/verify`-style Node tests against the real server (the pattern used for every other Agility module). The rule-engine checks (`verify-*.js`) are already Node and can be kept. | Medium |
| Audit | `recordAudit(...)` on every office action and field save. | Small |
| Roles | The discovery doc asks whether Agility has roles (dispatcher / technician / manager). It does not — it has per-page grants plus executive-only pages. Map: office pages granted to Client Care, field tool granted to techs, plan setup exec-only. | Decision |

## Decisions Andrew needs to make before build

**WashTower — two different "confirmed" answers.** Agility's parser and `plan-config.js` were changed on 2026-08-24 so a combined WashTower is **one** maintained asset (annotated "WILSON DECISION 2026-08-24, context §34 item 13"). v0.9.50's `plan-config.js` (`countsAs: 2`, "Counts as 2 appliances" badge), `invoice_parser.py` (`expand_to: ["washer","dryer"]`) and `PROJECT_CONTEXT.md` §34 item 13 say the opposite: **two** appliances at $299.90/yr, "confirmed by Wilson and implemented in v0.9.5". One of these has to be wrong. This affects pricing, the enrollment tile, the invoice importer and the protocols, so it should be settled first.

**Host assumption.** The other AI is waiting on `MERGE_DISCOVERY_REQUEST.md` (Flask/Jinja/SQL Server questions). The honest answer is "we do that differently": Node/Express, Postgres, static HTML with `internal-shell.js`, `req.authUser`, `requirePagePermission`, `recordAudit`, Resend, Stripe, pdf-lib, Render cron. If that model is going to keep contributing, it should get that answer so it stops producing T-SQL and Python.

**Where the backend gets built.** Two viable paths. (a) Build the Postgres schema and API in Agility (here), keep the prototype's front end, and hand the other AI the API contract so its pages call it. (b) Ask the other AI to rewrite its data layer against an Agility contract we define. Either way the contract has to come from this side; I would write it as `docs/MAINTENANCE-API.md` from the 40 store methods above.

**Roles.** Whether to keep Agility's page-grant model (recommended: no new role system) or introduce dispatcher/tech/manager roles the prototype assumes.

**Offline.** Whether the field tool needs to work with no signal (service worker + local queue + sync) or whether "phone has LTE" is acceptable for the pilot. Offline roughly doubles the field-tool integration work because every save becomes a queued write.

**Guardian.** Pilot on the standalone server first, or wait. Also a note from their patent-landscape doc: they consider the labeled failure-signature dataset a trade secret and want nothing about failure-mode classification customer-visible. That constrains what a future Agility Guardian page can show.

**Customer contact.** The prototype has "Ready to email" report queues, renewal charges and Guardian dispatch calls. Under Andrew's standing rule none of these may fire automatically; each needs an explicit click or an enabled toggle. The prototype already agrees ("a flag here is a phone call and a priority dispatch — not an email") but the merge has to enforce it server-side.

## Look and feel

Measured against Agility's house pages (internal-shell header, tools card, three colour themes, Roboto, `--primary*` tokens):

**What matches.** Pale-mint background, white rounded cards, dark-green primary, small uppercase status pills, the Wilson logo. At a glance an internal page reads as Wilson. Mobile layout is clean; nothing overflows at 390px. The field tool at phone width is the best screen in the module — high-contrast residence banner, large tap targets, one check at a time (`phone-tech-maintenance.png`).

**What does not.**

- *Shell.* `ui.js` builds its own header (logo, "Today / Customers / Guardian / New quote" nav, its own ☰ that toggles a mobile menu of module links) and its own footer. There is no Agility hamburger, no tools card, no `data-shell-label` pill, no theme switching. On a purple- or red-themed Agility the maintenance pages will stay green. Fix: drop `renderHeader`/`renderFooter` from `ui.js`, add `internal-shell.css/js` and a `.shell-wrap` header like `install-damage.html`, keep the module's own sub-navigation as a card row under the shell.
- *Tokens.* `wilson.css` defines `--wilson-green #155b26`, `--wilson-green-dark`, `--wilson-lime`, `--ink`, `--muted`, `--line` etc. and then uses roughly 370 distinct hard-coded hex values on top of them (`#12331f`, `#6b7a70`, `#1f6b39`…). Map the named tokens to `var(--primary)`, `var(--primary-dark)`, `var(--primary-soft)` the way `install-damage.html` was reskinned; the hard-coded values need a pass. At 7,160 lines this is the largest single UI task, but it is mechanical.
- *Typography.* Inter (with a system fallback) vs Agility's Roboto; headings are heavier and larger than Agility's. Switch the font stack and reduce the `h1` scale on internal pages.
- *Hero bands.* The public landing page uses a full-width dark-green hero with white text; `admin.html` opens with a dark "Today" band of stat tiles. Agility's public pages (`applianceservice.html`) and internal pages do not use dark bands. Acceptable on the public marketing landing; on `admin.html` I would convert the stat band to Agility-style white cards.
- *Public pages* should adopt `public-shell.js/css` (header pill, footer with Service Terms link) for consistency with the service request and terms pages that customers already see.
- *Filter Finder* has no shell at all and its own CSS (Jack's original). It needs the same treatment `install-damage.html` got.
- *Demo affordances* ("Reset demo data" button, "Team login" link on the public header, "Signed in as Wilson technician" pill) must go.

None of this changes behaviour; the interaction design is good and should be preserved as-is.

## Suggested phasing

1. **Settle decisions** (WashTower, host answer, roles, offline, Guardian timing). Send the other AI the "we do it differently" answer to its discovery request so its output shifts.
2. **Refresh the copy in Agility** to v0.9.50 pages/assets as a *demo* under Test Modules (still localStorage), reskinned to the internal shell and tokens. This is the look-and-feel work and can be done now without the backend; it lets the team walk the current workflow inside Agility.
3. **Schema + API, enrollment slice first**: households, contacts, assets, subscriptions, pricing snapshot, Stripe card-on-file, public signup on the service host with server-side pricing, command-center "Today" queue, office charge. This is the slice that lets a real customer enroll and be billed.
4. **Field slice**: visits, inspections, checks, readings, evidence photos (existing photo table), report generation and Resend delivery on click, follow-up notifications into `/api/notifications`.
5. **Filters, amendments, invoice-import draft → enrollment, Filter Finder.**
6. **Guardian** ingest into Agility once the standalone pilot has settled thresholds.

Phase 3 is where most of the engineering is; phases 2 and 4 are where most of the field value is. Doing 2 first also gives Cayden a shared thing to look at while the API contract is written.

## Housekeeping

`maint-plans/` is 35 MB and 198 files are already git-tracked, including five ~4 MB zips, vendored `pypdf`, `__pycache__`, and the full extracted v0.9.3 tree. The new v0.9.50 folder is untracked. Suggest: add `maint-plans/*.zip`, `maint-plans/**/vendor/`, `maint-plans/**/__pycache__/`, `maint-plans/**/photo-store/` and `maint-plans/**/.wilson-passcode` to `.gitignore`, `git rm --cached` the zips, and keep only one extracted tree (v0.9.50) plus the handoff docs. Two `maintenance_migration_v09.sql` files show as modified in the working tree — that is line-ending drift from the extract, safe to discard.
