# 12 — Agility Platform Notes for the Service Journey work

*Written 2026-09-15 for Cayden. Companion to 07_Developer_Spec.md and 11_Shadow_Test_and_Dev_Handoff.md. This is the "where it actually runs" document: what Agility is, how Phase 0 already lives inside it, the live database structure, and the conventions that make new work drop in without rework.*

---

## 1. The short version

Agility is a **Node.js application**, not Python. One Express server (`server.js`, ES modules, `"type": "module"` in package.json) plus a `lib/` folder of feature modules, serving static HTML pages from the repo root. Data lives in a **Postgres** database managed by Render. The whole thing deploys to Render automatically when `main` is pushed on GitHub.

Three points that change how the spec's later sections should be built:

1. **Phase 0 is already ported and running in Agility.** `lib/service-journey-postgres.js` is a line-for-line port of `wilson_service/` (importers, upsert ownership rules, status engine, sync queue with packets, stale/stuck, recalls, KPIs). `service-journey.html` is the Test Modules page on top of it. Section 3 maps your Python modules to the Node functions so you can read either side.
2. **Render cannot reach anything inside the building.** There is no path from the cloud to `localhost\SQLEXPRESS`, the ePASS box, the W: drive, or a shim on port 8765. Everything that comes from ePASS gets there because the showroom server *pushes* it out over HTTPS (`scripts/epass-agent.ps1` → `POST /api/epass-agent/upload?kind=…`). So the shadow instance described in doc 11 §14 should be built as more of the same inside Agility, not as a Python process beside ePASS. Section 6 lays that out.
3. **The Service Request Queue is not in Postgres.** Public form submissions (appliance and HVAC) are rows in a JSON file (`service-cards.json`) read through `lib/data-json.js`. Anything that "attaches a queue request to an SV" reads that file, it does not join a table.

Everything else below is detail in support of those three.

---

## 2. Runtime and topology

| Piece | What it is |
|---|---|
| Runtime | Node 20, ES modules. No Python, no .NET, no SQL Server in production. |
| Web | Express 4. `server.js` holds routes, page registration, permissions, hosts; `lib/*.js` hold data access and business rules. |
| Database | Postgres (Render managed), reached through `pg` via `getPostgresPool()` in `lib/data-postgres.js`, configured by `DATABASE_URL`. |
| Hosting | Render web service, auto-deploy from GitHub `main`. Env vars (keys, secrets) live only in Render's dashboard and never in the repo. |
| Hosts | `dashboards.wilsonappliance.com` — internal, login required (everything you'd call "the dashboard"). `service.wilsonappliance.com` — public customer side (service request forms, estimate approval links, on-my-way tracker would go here). `shop.wilsonappliance.com` — public shop. All three are the same Node process; host + path decide what's served. |
| Time zone | `APP_TIMEZONE` (default `America/Chicago`). Use it for any "today", "route date", "stale after 18h" logic; the server itself runs in UTC. |
| Other deps | `multer` (uploads, memory storage), `xlsx` (SheetJS 0.20.3, reads the ExportInvoice/OE-23 workbooks), `stripe` (card on file for appliance requests, service estimate deposits), `pdf-lib` / `pdfjs-dist`, `cors`, `dotenv`. |
| Integrations | Podium (customer texting, conversation notes), Resend (email), Samsara (fleet GPS / vehicle events), Stripe. |

**Feeds from ePASS.** The showroom server runs `scripts/epass-agent.ps1` on a schedule. It watches `W:\Agility\outbox\<kind>` and POSTs any new file to `/api/epass-agent/upload?kind=<kind>&file=<name>` authenticated by `EPASS_AGENT_KEY`. Kinds today: `inventory`, `quotes`, `open-orders`, `dispatch`. The `dispatch` kind is the DispatchTrack-formatted export from ePASS (the same file your `dt_import.py` reads): the sales side consumes it into the `dsp_*` tables, and since 9/12 the same bytes are also handed to `serviceMirrorFromDispatch()` so the SV rows land in `sj_jobs`. Every kind also has a manual upload page for the days the agent isn't running (`/api/service-journey/import/dispatch` for ours). **ExportInvoice** is manual upload only for now (Andrew's call, 9/12) — it arrives through the Service Order Health page's parser, which passes the rows to `importServiceInvoiceRows()`.

**Outbound only, always.** Agility never initiates a connection into the building, never reads the W: drive, never opens a VPN. That's a standing rule, not a limitation we'll engineer around.

---

## 3. Where Phase 0 lives in Agility

| Your Python (`phase0/wilson_service/`) | Agility equivalent |
|---|---|
| `schema.py` / `schema_mssql.sql` | `SCHEMA_SQL` at the top of `lib/service-journey-postgres.js` (tables prefixed `sj_`, DDL in §4). Applied idempotently on first use — there is no migration step. |
| `seed.py` (roster, zones, zips) | `lib/service-journey-seed.js` — `SEED_TECHS` (12), `SEED_ZONES` (41), `SEED_ZIPS` (79), loaded on first run if `sj_techs` is empty. |
| `dt_import.py` | `importServiceDispatchTrack(bufferOrText, {filename, byEmail})` — cp1252 decode fallback, SV rows only, idempotent by `(source, file_name)`, skips header-only line rows, detects `dtComplete`. |
| `ei_import.py` | `importServiceInvoiceRows(rows, {filename, byEmail})` — rows come pre-parsed from the Service Order Health page (`finishDate, mapZone, serviceModel, serviceSerial, serviceBrand, billToEmail, customerName, units, qualification, priorities`). |
| upsert ownership (import-owned vs fill-only) | `upsertFromDispatchTrack()` / `upsertFromInvoiceRow()` inside the same module; same column ownership as spec §4. |
| `engine.py` (status transitions, reason codes) | `STATUS_DEFS`, `CLOSED_STATUSES`, `DT_ROUTING_STATUSES`, `REASON_CODES`, `statusInfo(code)`, `setJobStatus(sv, {status, reasonCode, note, routeDate, tech, byEmail})`. A dashboard-initiated change flips `source='dashboard'` and queues a packet. |
| `sync.py` (reconcile, packets) | `reconcileAfterImport()` (confirm / mismatch / discrepancy after `sync.mismatch_cycles_before_discrepancy` / follow ePASS / reverse), `renderPacket()`, `listSyncItems(state)`, `markSyncKeyed(id, by)`, `resolveSyncItem(id, 'reissue'|'accept_epass', by)`. |
| stale / stuck rules | `listStaleJobs()`, `listStuckJobs()` using `stale.grace_hours` (18). |
| recalls | `detectRecall()` on import (serial or customer+category within `recall.window_days` 30), `listRecalls(state)`, `reviewRecall(id, state, by, note)`. |
| settings / tunables | `sj_settings` key/value JSON, `getSettings()`, `setSetting(key, value)`, `DEFAULT_SETTINGS` — same keys as spec §12 (`stale.grace_hours`, `sync.follow_epass_for_import_jobs`, `import.ei_sched_horizon_days`, `fee.diagnostic`, `feed.dt_complete`, …). |
| CLI / folder watcher | Not needed: the agent push and the upload routes replace it. |
| tests (`test_phase0.py`) | Verified against the same Sep 10 reference exports in a scratch Postgres: 236 SV orders from the DT file; EI 657 rows → 427 created / 230 updated; re-import is a no-op. There is no committed Node test suite yet (see §7). |

### Routes already live (`/api/service-journey/*`, page grant `/service-journey.html`, executives implicitly)

```
GET  /overview                         counts for the tab badges
GET  /jobs?q=&status=&tech=&zone=&onlyOpen=&stale=&review=&limit=
GET  /jobs/:sv                         job + lines + status history + sync items + recalls + related
POST /jobs/:sv/status                  {status, reasonCode, note, routeDate, tech}
POST /jobs/:sv/reviewed                intake review done
POST /jobs/:sv/owner                   {tech}
GET  /stuck                            stuck + stale lists
GET  /sync?state=                      sync queue with packet text
POST /sync/:id/keyed
POST /sync/:id/resolve                 {resolution: 'reissue' | 'accept_epass'}
GET  /recalls?state=
POST /recalls/:id/review               {state, note}
GET  /kpi?from=&to=
GET  /imports                          batch history
POST /import/dispatch                  multipart DT file (manual)
POST /settings                         {key, value}
```

The three prototypes are hosted as `service-proto-board.html`, `service-proto-field.html`, `service-proto-office.html` behind the same grant (`PAGE_IMPLIED_BY`), refreshed to your 9/14 versions with a banner.

### The AJH pilot (Jack's files) — separate, and slated to go away

`pilot-routing.html`, `pilot-field.html`, `pilot-parts.html` with `lib/pilot-postgres.js` (`pilot_jobs`, `pilot_log`, `pilot_meta`) and `/api/pilot/*`. It is a different data model (one JSONB blob per job in Jack's page shape) and is only there so Jack's live test this week has shared storage. Doc 11's recommendation to retire it once the shadow test is up is fine with Andrew; don't build on it.

---

## 4. Database structure

Every table Agility owns is created by the module that uses it, with `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for later additions. **Write new DDL in Postgres dialect** (TIMESTAMPTZ, JSONB, BIGSERIAL, NUMERIC(12,2), `gen_random_uuid()`); the SQL Server/SQLite variants aren't needed.

### 4.1 Service Journey tables (`sj_*`) — live today

```sql
CREATE TABLE IF NOT EXISTS sj_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sj_import_batches (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,                       -- 'dispatch' | 'invoice'
  file_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  message TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS sj_import_batches_file ON sj_import_batches (source, file_name);
CREATE TABLE IF NOT EXISTS sj_techs (
  sp_code TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'Tech',
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb, -- e.g. KJB → ["KJB2"], VWJ → ["VJ"]
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  home_base TEXT NOT NULL DEFAULT '',
  start_default TEXT NOT NULL DEFAULT 'shop',
  end_default TEXT NOT NULL DEFAULT 'shop',
  work_days TEXT NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  auto_route BOOLEAN NOT NULL DEFAULT TRUE,
  auto_schedule BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sj_zones (
  zone_code TEXT PRIMARY KEY,
  zone_group TEXT NOT NULL DEFAULT '',
  booking_mode TEXT NOT NULL DEFAULT 'office_only',
  km_from_shop NUMERIC(7,1),
  primary_tech TEXT,
  secondary_techs JSONB NOT NULL DEFAULT '[]'::jsonb,
  centroid_lat NUMERIC(9,6),
  centroid_lng NUMERIC(9,6),
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sj_zip_zones (
  zip TEXT PRIMARY KEY,
  zone_code TEXT,
  zone_group TEXT NOT NULL DEFAULT '',
  booking_mode TEXT NOT NULL DEFAULT 'office_only',
  tickets_2026 INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sj_jobs (
  sv_number TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_code TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_alt TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  address2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  zone_code TEXT,
  access_notes TEXT NOT NULL DEFAULT '',
  unit_category TEXT NOT NULL DEFAULT '',
  unit_install_type TEXT NOT NULL DEFAULT '',
  unit_brand TEXT NOT NULL DEFAULT '',
  unit_model TEXT NOT NULL DEFAULT '',
  unit_serial TEXT NOT NULL DEFAULT '',
  problem_text TEXT NOT NULL DEFAULT '',
  raw_detail TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  warranty_flags TEXT NOT NULL DEFAULT '',
  is_warranty BOOLEAN NOT NULL DEFAULT FALSE,
  payment_type TEXT NOT NULL DEFAULT '',
  balance NUMERIC(12,2),
  total NUMERIC(12,2),
  units INT,
  bin_location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  route_date DATE,
  assigned_tech TEXT,
  owner_tech TEXT,
  epass_status TEXT NOT NULL DEFAULT '',
  epass_route_date DATE,
  epass_tech_code TEXT NOT NULL DEFAULT '',
  epass_source TEXT NOT NULL DEFAULT '',
  epass_seen_at TIMESTAMPTZ,
  in_feed BOOLEAN NOT NULL DEFAULT FALSE,
  epass_invoice_status TEXT NOT NULL DEFAULT '',
  epass_finish_date DATE,
  epass_created_at DATE,
  source TEXT NOT NULL DEFAULT 'import',       -- 'import' | 'dashboard'
  needs_intake_review BOOLEAN NOT NULL DEFAULT TRUE,
  stale BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sj_jobs_status   ON sj_jobs (status, route_date);
CREATE INDEX IF NOT EXISTS sj_jobs_serial   ON sj_jobs (unit_serial);
CREATE INDEX IF NOT EXISTS sj_jobs_customer ON sj_jobs (customer_code);
CREATE INDEX IF NOT EXISTS sj_jobs_phone    ON sj_jobs (phone);
CREATE TABLE IF NOT EXISTS sj_job_lines (
  sv_number TEXT NOT NULL,
  line_no INT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC(10,2),
  amount NUMERIC(12,2),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  batch_id BIGINT,
  PRIMARY KEY (sv_number, line_no)
);
CREATE TABLE IF NOT EXISTS sj_status_history (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type TEXT NOT NULL DEFAULT 'system',    -- 'system' | 'import' | 'user'
  actor_id TEXT NOT NULL DEFAULT '',
  trigger_event TEXT NOT NULL DEFAULT '',
  reason_code TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sj_status_history_sv ON sj_status_history (sv_number, changed_at);
CREATE TABLE IF NOT EXISTS sj_sync_items (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- 'status' | 'route' | 'keyed' | ...
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  packet_text TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending',        -- pending | keyed | confirmed | mismatch | discrepancy | resolved
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT '',
  keyed_at TIMESTAMPTZ,
  keyed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by_batch BIGINT,
  epass_values JSONB,
  mismatch_count INT NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sj_sync_items_state ON sj_sync_items (state, sv_number);
CREATE TABLE IF NOT EXISTS sj_recalls (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL UNIQUE,
  original_sv TEXT,
  tech TEXT,
  days_between INT,
  basis TEXT NOT NULL DEFAULT '',              -- 'serial' | 'customer_category'
  state TEXT NOT NULL DEFAULT 'candidate',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Your 9/14 columns (`parts_eta, est_minutes, penciled_tech_id, penciled_date, pencil_reason, pencil_set_at, source_ref, card_ref`) and the `placement_log` table are **not** in Agility yet. When they go in, they go in as `ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS …` lines appended to `SCHEMA_SQL`, plus `CREATE TABLE IF NOT EXISTS sj_placement_log (…)`. Nothing else has to change for the columns to exist in production on the next deploy.

### 4.2 Neighbouring tables you'll touch

**Service Request Queue — JSON file, not a table.** `service-cards.json` (active) and `service-cards-archive.json`, read/written with `readServiceCards()` / `writeServiceCards()` from `lib/data-json.js` (re-exported by `lib/data.js`). Both public forms (`/api/service/submit-request`) write the same card shape:

```js
{
  id: "svc_…",                        // the queue id your doc 11 item 12 asked about
  createdAt, updatedAt,
  requestType: "appliance" | "hvac",
  customerName, firstName, lastName, customerEmail, customerPhone,
  contactMethod: "Text" | "Phone Call" | "Email",
  onBehalfOfTenant, onBehalfManagement, tenantName, tenantPhone,
  serviceAddress: { line1, line2, city, state, zip },
  billingAddress, billingSameAsService,
  gateCode, purchaseDate, purchasedWithin12Months: "Yes" | "No",
  unitCount, units: [{ applianceType, brand, model, serial, problemDescription, ageOfUnit }],
  problemDescription,
  extendedWarranty,                   // HVAC only
  photos: [{ id, kind }],             // ids into install_damage_photos (kind 'customer' | 'signature')
  signatureRef,                       // HVAC only
  consent, termsVersion,
  setupIntentId, setupIntentStatus,   // Stripe card-on-file (appliance requests where cardRequired)
  cardRequired,
  status                              // queue status ("new", "scheduled", … — see appliance-service-calls.html)
}
```

The card is what "Copy to service dashboard test module" (doc 11 §3) would read. `addPilotJobFromCard()` in `lib/pilot-postgres.js` is a working example of turning a card into a job record (category inference from `applianceType`, address join, warranty from `purchasedWithin12Months`); the sj version would write `sj_jobs` with `source='dashboard'`, `source_ref = card.id`, `needs_intake_review = true`, status `REQ`, and no `sv_number` until the office keys it (see §6 on the REQ id).

**Photos** — `install_damage_photos (id SERIAL, report_ref TEXT, kind TEXT, content_type, bytes BYTEA, claim_token, meta JSONB, created_at)`. Served at `/api/install-damage/photo/:id` behind the Agility login (grant: Service Request Queue page) (answers doc 11 item 13: field tool photos are internal-only URLs, not public). Helpers: `saveCustomerRequestPhoto({contentType, buffer, kind})`, `claimCustomerRequestPhotos(refs, reportRef)`.

**Service estimates** — `service_estimates (id, token UNIQUE, sv_number, estimate_name, customer_name, customer_number, contact_phone, contact_email, contact_pref, summary JSONB, status, response JSONB, created_by_email/name, created_at, viewed_at, responded_at, emailed_at, stale_flagged_at, closed_at, closed_by_email)`. Status: `sent → viewed → approved | declined | comped | shopping | diagnostic`. `summary` holds lines/totals/deposit; `response` holds the customer's or staff's resolution. This is the existing "field quote → customer approval" path (public page on service.wilsonappliance.com by token, Stripe deposit optional); the spec's authorization step should reuse it rather than add a second approval store.

**Notifications** — `pushed_notifications (id UUID, severity, type_label, title, body, audience_email, active, ref_id, claimable, claimed_by_*, action_key, created_*)` with closures in `sales_order_flag_closures (kind='notification')`. `createPushedNotification({...})` puts a card on a person's dashboard; `retirePushedNotificationsByRef(ref)` pulls it. Good fit for "stuck job" / "sync discrepancy" nudges to the office — no new table needed.

**People** — `employee_directory (code PK, name, email, department, commute_miles, commission_plan, shirt_size, shoe_size, hire_date, birthday, …)`, `job_titles`, `departments`, `permission_groups`; login/permissions in `app_users` + `user_page_permissions`. `sj_techs.sp_code` is the ePASS salesperson code; `employee_directory.code` is the same code for most techs, so joining tech → person → email is one lookup.

**Sales-side DispatchTrack mirror** — `dsp_imports, dsp_raw_rows, dsp_transaction, dsp_line, dsp_work, dsp_work_status_history, dsp_service_location, dsp_project, dsp_config` (`lib/dispatch-postgres.js`). Same export file, sales/install rows. `dsp_service_location` keys addresses (`address_key` UNIQUE) with `lat/lng`, `map_zone`, access `modifiers` and `extra_minutes`; worth reusing for `sj_jobs.lat/lng` instead of a second geocoder.

**ePASS warehouse** — inventory/open-orders/quotes snapshots in `sales_order_snapshots`, `open_sales_orders`, `sales_order_detail`, `sales_order_lines` — parts availability for the parts pipeline lives here (`bin_location` on `sj_jobs` came from this).

---

## 5. Conventions — how a feature is added to Agility

**A data module** (`lib/<feature>-postgres.js`) is the unit of work:

```js
import { getPostgresPool } from "./data-postgres.js";
const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS … ; ALTER TABLE … ADD COLUMN IF NOT EXISTS …;`;
let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL);
  await ensurePromise;
  return pool;
}
export async function doThing(args, byEmail) {
  const pool = await getReadyPool();
  const client = await pool.connect();
  try { await client.query("BEGIN"); /* … */ await client.query("COMMIT"); return result; }
  catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
  finally { client.release(); }
}
```

Parameterised queries only (`$1, $2`), and cast nullable date/numeric parameters (`$3::text`, `$4::numeric`) or Postgres will refuse to infer the type. Pure rules (status transitions, capacity math, placement scoring) should be plain exported functions with no `pool` in them so they can be unit-tested without a database.

**Routes** go in `server.js` next to the feature's block, guarded by one of:

- `requirePagePermission("/service-journey.html")` — anyone granted that page (executives implicitly). `req.authUser` gives `{ email, displayName, kind, id }`.
- `requireExecutiveApi` — executives only (settings, resets).
- Public (customer) routes: add the path to `SERVICE_PUBLIC_PATHS` / prefix to `SERVICE_PUBLIC_API_PREFIXES` so they answer on `service.wilsonappliance.com` with no login; authenticate by opaque token in the URL (the estimate pages are the model).
- Machine routes (the agent): shared key compared with `crypto.timingSafeEqual`, no session.

Every state change calls `recordAudit({ ip, actorUserId, action, targetUserId, detail })` — the `sjAudit(req, action, detail)` helper wraps that for this feature.

**Pages** are static HTML in the repo root with `internal-shell.js` / `internal-shell.css` for the header, hamburger and Personal Settings. Registering one means: add the path to `INTERNAL_PAGE_PATHS`, a label in `PAGE_LABELS`, a category in `PAGE_CATEGORIES` (`test_modules` for anything still in testing), and if it should ride another page's grant, an entry in `PAGE_IMPLIED_BY`. The hamburger sections are built in `internal-shell.js` (`buildMenuLinks`). Pages call the API with `fetch` and relative paths; there is no front-end framework and no build step — what's in the repo is what's served.

**Uploads** use multer memory storage (`req.file.buffer`); parse CSV yourself (the DT file is cp1252 — `decodeDispatchTrackBuffer()` handles it) and `.xlsx` with SheetJS.

**Customer contact** goes through `sendCustomerText({ phone, body })` (Podium) and Resend for email. Standing rule: **no automated customer contact without an explicit click or an explicitly enabled toggle** — the spec's notification rules (§8) are fine as long as each template is behind a per-template switch that defaults off. Anything Agility does in a Podium conversation must leave the conversation open. The office-facing "packet" pattern you built (copy/paste into ePASS) is exactly how Agility handles the ePASS write side everywhere else; there's no write API to ePASS and we're not going to fake one.

**Secrets and PII.** Keys live in Render env only. Agility does not store SSNs or driver's licences, does not handle card numbers in plain text (Stripe SetupIntents only), and the customer exports in `service_call_journey/reference/data/` are gitignored — keep any new sample pulls there or in a folder with the same rule.

---

## 6. Mapping doc 11 / spec §14 onto Agility

What you wrote for the shadow test translates almost one-for-one; only the transport changes.

| Doc 11 / §14 | In Agility |
|---|---|
| Python shim (`serve.py`) on the ePASS box, port 8765 | Not reachable from Render. The equivalent is more routes under `/api/service-journey/` in `server.js` backed by `lib/service-journey-postgres.js`. Same handlers, same JSON. |
| `GET /health` | Already covered: `GET /api/service-journey/overview` + `/imports` (last batch, counts). |
| Folder watcher for the DT feed (all techs) | Already running: the agent pushes every DT export; `serviceMirrorFromDispatch()` mirrors all SV rows regardless of tech. Shadow mode is the default — the mirror never writes back. |
| `POST /api/requests` (intake payload: request_id, customer, address, contact_method, units[], photos[], card{saved, brand, last4, setup_intent}, erp_order_number) | Source is the queue card (§4.2). Build `POST /api/service-journey/jobs/from-request {serviceCardId}` → `intake.py` logic (match window `intake.match_window_days` against `sj_jobs` by phone/serial/customer) → insert with status `REQ`. |
| `POST /api/requests/<id>/sv` (attach SV) | `POST /api/service-journey/jobs/:id/sv {sv}`. Note `sj_jobs.sv_number` is the primary key, so a REQ needs a provisional key: use `REQ-<queue id suffix>` and re-key to the real SV on attach (update `sv_number`, history and sync rows in one transaction). Alternative is adding a surrogate `id` column — more churn; the re-key is simpler. |
| `GET /api/board?date=` | `GET /api/service-journey/board?date=` — jobs with `route_date = date` grouped by tech, plus pencils. |
| `GET /api/jobs/<id>/suggest` and `/offer` | `placement.py` ported as pure functions (`suggestPlacement(job, techs, zones, boardForDates, settings)` → ranked `{tech, date, why[]}`) with a thin route. All `placement.*`, `pencil.*`, `offer.*` tunables into `sj_settings` via `DEFAULT_SETTINGS`. |
| `POST /api/jobs/<id>/pencil` | Writes the new pencil columns + a `sj_placement_log` row; a pencil is *not* a status change and *not* a sync packet until the office confirms in ePASS. |
| `GET /api/shadow` (scorecard) | `GET /api/service-journey/shadow?from=&to=` reading `sj_placement_log` joined to what ePASS actually did (`epass_route_date`, `epass_tech_code`) — the comparison you described. |
| "Copy to service dashboard test module" button on the queue | The queue page already has the AJH version of that button (`POST /api/pilot/jobs/from-queue`). Retarget it to the from-request route above when that lands; the AJH pages retire at the same time. |
| ExportInvoice via watcher | Stays manual (Service Order Health upload) until Andrew adds it to the agent's outbox kinds — one line in `epass-agent.ps1` and one `kind === "invoice"` branch when he does. |

Answers to your open items in doc 11:

- **Item 12 (queue ids)** — `svc_<epoch ms>` assigned in `submit-request`; stable for the card's life, survives archive.
- **Item 13 (photo URLs)** — internal, behind login, `/api/install-damage/photo/:id`; the field tool is inside the login so it can show them directly. Customer-facing pages never get them.
- **Roster** — `sj_techs` carries `home_base`, `start_default`, `end_default` from your `tech_roster.csv`; nothing further needed for trips.
- **Parts tool pre-filling part numbers** (spec item 17 says it shouldn't) — the AJH parts page does; the sj version should leave the part number blank for the office to enter from ePASS.

---

## 7. Things that would make this go faster

1. **Write in the target shape.** New logic as Node ES-module functions in the `lib/` pattern above, DDL in Postgres dialect, and API contracts as the `/api/service-journey/*` routes rather than a separate service. A Python prototype is still fine for thinking — but the port is the cost, and the port is where 9/14's placement and pencil work is currently stuck.
2. **Rules as data.** Status transitions, reason codes, placement weights, offer windows, templates: JSON constants exported from a module (or `sj_settings` rows for tunables), not code paths. The status engine already works that way (`STATUS_DEFS`); placement should too, so the replay (doc 08) can be re-run by changing numbers.
3. **Pure functions + fixture tests.** Anything scoring, ranking or deciding takes plain objects and returns plain objects. Tests can then run on the reference exports without a database. Node's built-in runner is enough: `node --test lib/tests/` with fixtures parsed from `reference/data/` (never committed — load them from the gitignored folder and skip if absent). That gives Agility its first automated tests and keeps your 37 green as they move over.
4. **One vocabulary.** The spec's status codes, the packet kinds and the sync states are already the same strings on both sides; keep it that way for the new columns (`penciled_tech_id` should hold `sp_code`, not a display name; dates as ISO `YYYY-MM-DD`).
5. **Sample data through the real doors.** For demos, seed by pushing a DT file through `POST /api/service-journey/import/dispatch` and requests through the public form — not by inserting rows. It exercises the same code the shadow test relies on.
6. **Reuse before adding.** Geocoding (`dsp_service_location`), photos, estimates/authorization, Podium send, dashboard notifications, audit — all exist. The spec's customer portal / tracker is the one piece with no counterpart; it belongs on `service.wilsonappliance.com` behind a per-job token, same as the estimate pages.
7. **Keep docs 07 and 11 as the source of truth for *intent*,** and treat this file plus the `lib/service-journey-postgres.js` header comment as the source of truth for *where it lives*. When a decision changes (ExportInvoice via agent, AJH retirement date), a line in the decisions log in doc 01 is enough.

---

*Questions on any of this go to Andrew, who can pull the current `server.js` and `lib/` for you; the repo is `wilson-agility` and everything referenced here is on `main`.*
