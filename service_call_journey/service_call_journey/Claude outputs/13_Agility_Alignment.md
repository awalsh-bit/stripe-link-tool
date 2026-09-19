# 13 — Aligning the Service Journey work with Agility

*Written 2026-09-15, after Andrew's `12_Agility_Platform_Notes.md`. Docs 07 (spec) and 11 (shadow test) stay the source of truth for **intent**; doc 12 and `lib/service-journey-postgres.js` are the source of truth for **where it runs**. This file is the reconciliation: what doc 12 changes, what it retires, what the Agility port is missing from the 9/14–9/15 work, and the order to close it in.*

---

## 1. What changes

Three things in doc 12 move the ground under the later sections of doc 07 and doc 11.

**Node and Postgres, not Python and SQL Server.** `phase0/` was always "the spec as runnable code" rather than the thing that ships, and it did its job: the schema, the two importers, the ownership rules, the status engine, the sync queue and the stale/recall rules are already ported and running as `lib/service-journey-postgres.js`. From here the Python is a reference implementation and a place to prove rules against the real exports; anything new should be written as Node ES-module functions in the `lib/` pattern, with Postgres DDL. Where doc 07 gives SQL Server column types, read them as the neutral vocabulary in §1.2 and translate (TIMESTAMPTZ, JSONB, BIGSERIAL, NUMERIC(12,2)).

**Render cannot reach into the building, so the shim is dead.** Doc 11 §4 and spec §14.3 describe `python -m wilson_service serve` on port 8765 with the live dashboard posting to it. There is no path from Render to that process, and outbound-only is a standing rule rather than an obstacle to route around. Everything in that section survives as *contracts* — the payload, the response, the endpoints — but they become routes under `/api/service-journey/` in `server.js`. `serve.py` is retired, and so is the folder watcher and the CLI: the ePASS agent's push (`POST /api/epass-agent/upload?kind=dispatch`) already does what `watch` did, for every tech, and has since 9/12.

**The Service Request Queue is a JSON file.** `service-cards.json` through `lib/data-json.js`, with card ids `svc_<epoch ms>`. So the intake contract inverts: instead of the dashboard POSTing a payload we defined, the dashboard POSTs `{serviceCardId}` and the server reads the card. `intake.py`'s field mapping still applies — it is now a mapping from the card shape in doc 12 §4.2 rather than from a JSON body we specified. Two of its fields land differently: `photos` are ids into `install_damage_photos` (internal, behind login), and the card already carries `setupIntentId` / `setupIntentStatus`, so `card_ref` should hold those rather than a formatted string.

---

## 2. Retired, kept, and changed

| Doc 07 / 11 | Status |
|---|---|
| `phase0/wilson_service/serve.py`, `watcher.py`, `cli.py` | **Retired.** Agent push + upload routes + `/api/service-journey/*` replace all three. |
| `schema_mssql.sql`, the sqlite/mssql DDL generator | **Retired for production.** Keep for the Python tests; new DDL is Postgres, appended to `SCHEMA_SQL`. |
| Spec §14.2 payload, §14.3 endpoint list | **Kept as contracts, new transport.** Same JSON shapes, now Agility routes; intake takes `{serviceCardId}`. |
| Spec §14.4 morning check (`shadow-report`) | **Kept.** Becomes `GET /api/service-journey/shadow?from=&to=` over `sj_placement_log` vs `epass_route_date` / `epass_tech_code`. |
| Spec §3.1 "ExportInvoice uploaded manually; add a watched folder" | **Confirmed as manual** until Andrew adds an `invoice` kind to `epass-agent.ps1`. One line there and one branch in the upload route. |
| Spec §6 notification matrix | **Changed.** Standing rule: no automated customer contact without an explicit click or a per-template toggle that defaults off. Every template in doc 09 needs a switch in `sj_settings`, off on arrival. |
| Spec §5.4 field quote → customer approval | **Changed.** `service_estimates` already does this (token page on `service.wilsonappliance.com`, Stripe deposit, `sent → viewed → approved/declined/comped/shopping/diagnostic`). Reuse it; do not add a second approval store. |
| Spec §4 geocoding | **Changed.** `dsp_service_location` already keys addresses with lat/lng, map zone, access modifiers and extra minutes. Join it instead of geocoding again. |
| Stuck / discrepancy nudges | **Changed.** `createPushedNotification({...})` + `retirePushedNotificationsByRef(ref)` — no new table. |
| Customer tracker / portal | **Unchanged and still ours.** The one piece with no Agility counterpart: `service.wilsonappliance.com`, per-job token, same pattern as the estimate pages. |
| AJH pilot files and `pilot_*` tables | **Retiring**, as doc 11 §2 proposed; Andrew agrees. Don't build on `lib/pilot-postgres.js`, but `addPilotJobFromCard()` is the working example to copy for the sj version. |

Open items doc 11 raised, now answered: queue ids are `svc_<epoch ms>` and stable across archive; photos are internal-only URLs behind the login, so the field tool can show them and customer pages never get them; `sj_techs` already carries `home_base` / `start_default` / `end_default` from the roster.

---

## 3. What the Agility port does not have yet

The port was taken from Phase 0 before the 9/14 and 9/15 work. Everything below exists in `phase0/` with tests and needs to cross over. Ordered by what it costs to leave out.

### 3.1 The parking-date rule — a live data bug, not a new feature

ePASS writes **the coming Saturday** as the Sched/Delivery date for anything with no real date. In the 9/15 export that is **155 of 460 tickets on Sat 9/19** (SO2.2 43 of 44, SO4 43 of 62, SO4H 8 of 8, SO3 12 of 19); in the 9/10 export it was 121 on Sat 9/12. The DispatchTrack file does it too — 22 of its 236 orders.

`sj_jobs` today therefore carries a parking-Saturday `route_date` / `epass_route_date` on 182 of the 460 open tickets — 155 on 9/19 and the rest on later Saturdays. Consequences, in order of how much they hurt:

1. Any view that groups by date shows a phantom Saturday route of ~155 stops.
2. The routing-status ones age into `listStaleJobs()` a week later and the stale list stops meaning anything.
3. **The one that blocks the 9/14 work**: placement and the pencil read `route_date` to decide what is scheduled. A parked SO4 looks *booked for Saturday*, so it never reaches the queue that needs a date, and it eats capacity on a day nobody works.

The fix is small and does not hard-code Saturday: a date that falls on a day **no active tech works** (union of `sj_techs.work_days`) is not a schedule. In Phase 0 it is `importers/common.py::is_parking_day`, used by both importers, behind setting `import.parking_day_rule` (default on); the job keeps flag `parked`, the import summary counts them, and the flag clears by itself when a real date appears. In Node that is one helper plus two call sites in `upsertFromDispatchTrack()` / `upsertFromInvoiceRow()`:

```js
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
export function anyWorkDays(techs) {            // pure — techs is the sj_techs rows
  const s = new Set();
  for (const t of techs) for (const d of String(t.work_days || "").split(",")) if (d.trim()) s.add(d.trim());
  return s.size ? s : new Set(["Mon","Tue","Wed","Thu","Fri"]);
}
export function isParkingDay(isoDate, workDays) {
  if (!isoDate) return false;
  const d = new Date(`${isoDate}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && !workDays.has(DOW[(d.getUTCDay() + 6) % 7]);
}
```

Worth running once over the existing rows as well, not just on new imports.

### 3.2 Status case

The 9/15 file carries `SO8` and `so8` in the same column. Upper-case `Job Status` before `statusInfo()` / `ensure_status` in both importers, or ePASS typos quietly create parallel statuses. (`QUOTE 2` in the same file is genuine junk and should keep surfacing as unknown for the office to fix at the source.)

### 3.3 Recalls: the RCALL flag

Doc 12 lists the recall basis as `'serial' | 'customer_category'`. ePASS's own `Priorities` column carries **RCALL on 19 of the 460 tickets** — those are recalls the office has already identified, and they should land as `state='confirmed'`, `basis='epass_rcall'` without waiting for a reviewer. Phase 0 does this in `kpi.detect_recall`. Cheap, and it is the only recall signal that is certain.

### 3.4 The 9/14 work — placement, pencil, offers, intake, scorecard

New columns on `sj_jobs` (`parts_eta DATE`, `est_minutes INT`, `penciled_tech TEXT`, `penciled_date DATE`, `pencil_reason TEXT`, `pencil_set_at TIMESTAMPTZ`, `source_ref TEXT`, `card_ref TEXT`) and `sj_placement_log`, as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` lines on `SCHEMA_SQL` per doc 12 §4.1. Note the vocabulary rule from doc 12 §7.4: `penciled_tech` holds an `sp_code`, not a display name, which is a simplification over the Python's `penciled_tech_id`.

`placement.py` is already written as pure functions over plain dicts — `suggest`, `offer`, `pencil`, `record_actual`, `scorecard` — so the port is mechanical, and it matches the signature Andrew proposed. The scoring weights are all settings (`placement.*`, `pencil.*`, `offer.*`, `intake.match_window_days`), which is the "rules as data" shape doc 12 §7.2 asks for. `serve.*` settings are obsolete.

---

## 4. One design decision worth settling first: `sj_jobs.sv_number` as the primary key

Doc 12 §6 proposes giving a copied queue request a provisional key `REQ-<queue id suffix>` and re-keying it to the real SV on attach, rather than adding a surrogate id. That works — but only if the SV is matched to the REQ row **inside the importer**, before it inserts. Otherwise the ordinary case breaks:

1. Office copies the card → `sj_jobs` row, `sv_number = 'REQ-4821'`, status REQ.
2. Dispatcher books it in ePASS as they do today → ticket SV00124001 exists there.
3. The next agent push arrives. `serviceMirrorFromDispatch()` does not know SV00124001, so it **inserts a second row**.
4. Someone types the SV on the queue row → `UPDATE sj_jobs SET sv_number='SV00124001' WHERE sv_number='REQ-4821'` → **unique violation**. Two rows, one job, and the attach path has to become a merge.

The merge is worse under this key than under a surrogate, because `sj_job_lines`, `sj_status_history`, `sj_sync_items`, `sj_recalls` (where `sv_number` is itself UNIQUE) and `sj_placement_log` all key on `sv_number`, so a merge rewrites five child tables instead of one column.

The cheap fix keeps the re-key and avoids the collision: **move the match into the importer.** When it meets an unknown SV, look first for an open dashboard-created row (`source='dashboard'`, no real SV, created within `intake.match_window_days`) whose phone — or name token plus zip — matches, and re-key that row instead of inserting. That is `sync.match_create_ticket` in Phase 0, and it is how the shadow test scores itself: the suggestion logged at intake only lines up with what the dispatcher actually did if the two rows are one row. Attach-by-typed-SV then stays a rename and the merge becomes the rare path rather than the normal one.

Two smaller consequences of re-keying, either way: `sj_placement_log` rows must follow the rename or the scorecard loses exactly the intake suggestions it exists to grade; and anything holding a `ref_id` to the REQ key (a pushed notification, a bookmarked job page) needs to tolerate the change.

---

## 4a. The team's 9/15 items in Agility ⟨added 9/15 pm⟩

Spec §13 items 20–25. Three of them need tables, two need columns, and one needs nothing new because Andrew already built it.

**Visit groups (item 21)** — new table plus one column:

```sql
CREATE TABLE IF NOT EXISTS sj_visit_groups (
  id BIGSERIAL PRIMARY KEY,
  address_key TEXT NOT NULL,                    -- normalised street+zip; sj_jobs has no address_id
  skill TEXT NOT NULL DEFAULT 'appliance',      -- appliance | hvac — different skills are different groups
  owner_tech TEXT,                              -- sp_code
  state TEXT NOT NULL DEFAULT 'open',           -- open | scheduled | done | split
  scheduled_date DATE, window TEXT,
  parts_wait_until DATE,                        -- the latest member parts_eta
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
);
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS visit_group_id BIGINT;
CREATE INDEX IF NOT EXISTS sj_jobs_group ON sj_jobs (visit_group_id);
```

`sj_jobs` keys addresses as loose text, so the grouping key is a normalised `address1 + zip` — worth doing through `dsp_service_location.address_key`, which already exists and already solves this normalisation for the sales side (doc 12 §4.2). Grouping is a **suggestion** endpoint (`GET /api/service-journey/groups/suggestions`) plus `POST /groups` / `POST /groups/:id/split`; never an automatic merge. The booking route applies to the group: booking one member books every ready member in one transaction.

**Per-job contacts (item 20)**:

```sql
CREATE TABLE IF NOT EXISTS sj_job_contacts (
  id BIGSERIAL PRIMARY KEY,
  sv_number TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'on_site',         -- account | on_site | tenant | property_manager | other
  notify BOOLEAN NOT NULL DEFAULT TRUE,
  visit_only BOOLEAN NOT NULL DEFAULT TRUE,     -- true = never written back to the customer
  added_by TEXT NOT NULL DEFAULT '', added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sj_job_contacts_sv ON sj_job_contacts (sv_number);
```

Seed `account` rows from the DispatchTrack Phone1/2/3 on import. The consequence worth flagging: **`sendCustomerText()` for a job should resolve its recipients from this table**, not from `sj_jobs.phone`. That interacts with the standing rule in doc 12 §5 — the per-template toggle still gates *whether* a message goes; this only changes *who* it goes to. Note this is another place the `sv_number`-as-key decision costs: a REQ→SV re-key has to carry these rows too (§4).

**Tech limits (item 23)** — columns on `sj_techs`, and a settings page rather than a table:

```sql
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS shift_start TEXT NOT NULL DEFAULT '08:00';
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS shift_end   TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS max_stops_per_day INT;
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS max_onsite_min INT;
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS max_inter_stop_drive_min INT;
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS commute_allowance_min INT NOT NULL DEFAULT 45;
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS accepts_overflow BOOLEAN NOT NULL DEFAULT TRUE;
```

The commute change is in the pure capacity function, not the schema: `routeMinutes()` must exclude the home→first and last→home legs up to `commute_allowance_min` each way and return `commuteMin` separately, so the fill bar can show it outside the 100%. That is the single edit that takes the board from 19 of 38 tech-days over capacity to 15 (or 9 with no allowance cap) — worth doing before anyone reads the numbers again.

**Needs-tech-input and the research nag (items 22 and 25)** — columns plus something that already exists:

```sql
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS needs_tech_input BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS tech_input_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS tech_input_asked_by TEXT NOT NULL DEFAULT '';
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS tech_input_asked_at TIMESTAMPTZ;
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS nag_last_sent_at TIMESTAMPTZ;
```

The "my notifications section at the top of their dashboard" the team asked for **is `pushed_notifications`** — doc 12 §4.2 already names it as the right home for stuck-job nudges. `createPushedNotification({ audience_email, ref_id: sv, type_label:'needs_tech_input', title, body, claimable:false, action_key })` raises it; `retirePushedNotificationsByRef(sv)` pulls it when the tech submits. The daily re-raise must reuse the **same `ref_id`** so it refreshes one card rather than stacking a week of them, and it should fire only inside that tech's working hours (`sj_techs.work_days` + `shift_start`). Tech → email is the one lookup doc 12 §4.2 describes: `sj_techs.sp_code` → `employee_directory.code` → `email`. No new table.

**One charge per visit (item 21c)** — no schema beyond the group. One Stripe PaymentIntent for Σ member totals; the per-SV allocation rides in the `post_payment` sync packet because ePASS still wants per-ticket amounts. `payment.amount_mismatch` compares the group total. Worth confirming with Noell before it is built (spec §12 item 15).

**Units on the board (item 24)** — nothing to build: `sj_jobs.units` is already imported and already drives duration. It just needs to reach the card.

## 4b. The ePASS back catalogue in Agility ⟨added 9/16⟩

117,594 historical tickets and 45,239 customers now load in Phase 0 (`importers/history.py`, spec §1.4).
Port shape for Postgres — all `sj_`-prefixed, all `CREATE TABLE IF NOT EXISTS` in `SCHEMA_SQL` as usual:

```sql
CREATE TABLE IF NOT EXISTS sj_payers (
  payer_id     BIGSERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,
  name         TEXT,
  kind         TEXT NOT NULL DEFAULT 'household',   -- household|manufacturer|dealer|cash|other
  customer_id  BIGINT,                              -- set only when kind='household'
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sj_assets (
  asset_id      BIGSERIAL PRIMARY KEY,
  customer_id   BIGINT NOT NULL,
  serial        TEXT NOT NULL,
  brand TEXT, model TEXT, category TEXT, install_type TEXT,
  first_seen DATE, last_seen DATE, service_count INT DEFAULT 0,
  purchased_from_us BOOLEAN, purchase_date DATE, retired_at DATE, note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_asset_cust_serial ON sj_assets (customer_id, upper(serial));

CREATE TABLE IF NOT EXISTS sj_service_history (
  sv_number       TEXT PRIMARY KEY,
  customer_id BIGINT, payer_id BIGINT, asset_id BIGINT,
  epass_status TEXT, epass_state TEXT,
  created_date DATE, sched_date DATE, finish_date DATE,
  sp_code TEXT, route_code TEXT, map_zone TEXT, zip TEXT,
  total NUMERIC(12,2), balance NUMERIC(12,2), payment_type TEXT,
  units INT, qualification TEXT, priorities TEXT,
  reference TEXT, spec_auth TEXT, po_number TEXT,
  name_raw TEXT, address_raw TEXT,
  identity_source TEXT,          -- epass_code|address_zip|surname_zip|unmatched
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sj_external_refs (
  external_ref_id BIGSERIAL PRIMARY KEY,
  entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  system TEXT NOT NULL,          -- epass|netsuite|stripe|podium
  external_id TEXT NOT NULL, is_primary BOOLEAN DEFAULT false,
  payload JSONB, linked_at TIMESTAMPTZ DEFAULT now(), synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_extref_uniq ON sj_external_refs (entity, entity_id, system, external_id);
CREATE INDEX IF NOT EXISTS ix_extref_lookup ON sj_external_refs (system, external_id);

ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS do_not_service BOOLEAN DEFAULT false;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS do_not_service_note TEXT;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS do_not_service_set_by TEXT;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS do_not_service_set_at TIMESTAMPTZ;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS household_key TEXT;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS service_count INT DEFAULT 0;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS first_service DATE;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS last_service DATE;
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS lifetime_value NUMERIC(12,2) DEFAULT 0;
ALTER TABLE sj_addresses ADD COLUMN IF NOT EXISTS address_key TEXT;
CREATE INDEX IF NOT EXISTS ix_cust_household ON sj_customers (household_key);
CREATE INDEX IF NOT EXISTS ix_addr_key ON sj_addresses (address_key);
```

**Five things the port must not lose.**

1. **`Bill To Customer` is the payer, not the customer.** 21% of the catalogue is billed to a
   manufacturer. If the Node port keys history on that column the whole feature is wrong in a way that
   is not obvious until someone asks about a warranty visit. `payer` and `customer` stay separate.
2. **The resolution order** — ePASS code (only when numeric), then `address_key`, then `surname_key`,
   then create. `address_key` normalises street suffixes (DRIVE→DR and the rest) and takes the first 5
   digits of the zip; `surname_key` takes the **first** word of the ePASS name because the invoice
   export is last-name-first. Both are pure functions and should be ported verbatim — a different
   normalisation silently changes which household 22% of the catalogue lands on.
3. **`identity_source` per row.** It is what lets a later NetSuite pass re-decide the heuristic matches
   without touching the 78% that came in on a real code.
4. **Junk serials are not identities.** `VERIFY`, `NEED`, `NA`, `NONE`, `TBD`, all-X, all-zero — reject
   them or one household's unlabelled appliances merge into a single asset.
5. **Nothing is merged.** Duplicate accounts at one address share `household_key` and are displayed
   together; two spellings of a serial are flagged, not combined. Cayden 9/15: mirror ePASS until the
   NetSuite model is known.

**Load path.** This is a one-off bulk load, not a feed. The agent on the showroom box pushes the two
CSVs to `POST /api/epass-agent/upload?kind=history` and `kind=customers`; the server loads customers
first (better match rate), then history, both idempotent — history on `sv_number`, customers on the
ePASS code — so a wider re-export can be run over the top. In Phase 0 this is
`python -m wilson_service load-history --history SV_HISTORY.csv --customers CUSTOMERS.csv`,
about 24 seconds for the full file. It writes ~117k rows, so run it once outside business hours and
check `identity_source` counts against §1.4 before trusting it.

**Reads the office and the board need:** `household(customer_id)` (customer + history + assets + other
accounts at the address + external refs) and `search(term)` across phone, name, address, serial and SV.
Both are in `importers/history.py` and are plain SQL.

## 5. Order I would take it in

1. **Parking date + status case** in the two importers, and a one-off pass over existing `sj_jobs`. Half a day, removes a live data bug, and unblocks everything that reads `route_date`.
2. **RCALL → confirmed recall** in `detectRecall()`. An hour.
3. **The importer-side match** (§4) plus `POST /api/service-journey/jobs/from-request {serviceCardId}` and the re-key attach route. This is what makes the copy button real and stops double rows.
4. **Placement as pure functions** + the new columns + `sj_placement_log`, then `/board`, `/suggest`, `/offer`, `/pencil`, `/shadow`. Fixture tests under `node --test` off the gitignored reference exports, skipping when absent.
5. **Retire the AJH pages** and point the queue button at the new route.
6. Only then the customer-facing picker, one zone or one tech, with the dispatcher-approves gate in front of the confirmation text.

⟨9/15 pm⟩ Two of the team's items jump this queue because they are cheap and they change what people see: **commute out of the capacity number** (a pure-function edit, and the board is currently telling dispatchers a lie about Connor and Trevor) and **units on the card** (already in the data). **Needs-tech-input** is next — five columns and `pushed_notifications`, which already exists. **Visit groups** are the big one and belong after the placement port, since grouping is mostly a change to how placement counts a stop.

Steps 1–2 are worth doing whoever writes them; they are small and they are wrong in production today. I can hand over 3–4 as Node modules in the `lib/` shape with fixture tests rather than as Python to be ported — say the word and that is what the next pass produces.

---

## 6. Conventions to hold to (from doc 12 §5 and §7)

Parameterised queries only, with explicit casts on nullable date/numeric parameters. Pure rules take plain objects and return plain objects with no pool in them, so they test without a database. Rules as data — status transitions, reason codes, placement weights, offer windows and templates as JSON constants or `sj_settings` rows, so the Sep-10 replay in doc 08 can be re-run by changing numbers. One vocabulary across both sides: the status codes, packet kinds and sync states already match; keep sp_codes and ISO `YYYY-MM-DD` dates in the new columns. Seed demos by pushing a real file through the real import route, not by inserting rows. And reuse before adding — geocoding, photos, estimates, Podium, notifications and audit all exist already.

Customer exports stay in `reference/data/` and stay out of git; that folder now has its own `.gitignore` on our side too.
