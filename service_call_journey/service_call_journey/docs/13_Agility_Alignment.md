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

## 4c. The 9/17 round in Agility ⟨added 9/17⟩

**Identity is the address.** `household_key` gains the unit (`210 LAVACA ST #1908|78701`); a
placeholder street line ("CLAIM SUBMISSION", "NOT PROVIDED") yields `NULL`. The fallback from surname
needs the same house number and, when either side has one, the same unit — `same_house()` in
`importers/history.py`; port it as-is. **A DNS banner requires the address and the last name to match**
(spec §1.4h). The read the board and field tool use is one function, `linkrule.Index.resolve(addr,
zip, name) → {cid, how, dns, dns_other, maybe, accounts}`; in Agility that is a query on
`sj_customers` by `household_key`, then by `(last_name, house_number, zip)`, then a "maybe" list by
`(last_name, zip)` that is displayed and never joined.

```sql
-- 9/17 additions (Postgres; CREATE TABLE IF NOT EXISTS, sj_ prefix, snake_case)
CREATE TABLE IF NOT EXISTS sj_tech_pattern (
  tech_pattern_id serial PRIMARY KEY, tech_id int NOT NULL REFERENCES sj_techs(tech_id),
  weekday char(3) NOT NULL, shift_start time, shift_end time, reason varchar(80),
  set_by varchar(60), set_at timestamptz DEFAULT now(), UNIQUE (tech_id, weekday));
CREATE TABLE IF NOT EXISTS sj_office_notes (
  note_id serial PRIMARY KEY, customer_id int REFERENCES sj_customers(customer_id), sv_number varchar(16),
  body text NOT NULL, due_on date, assigned_to varchar(60), done_by varchar(60), done_at timestamptz,
  created_by varchar(60) NOT NULL, created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS ix_office_notes_due ON sj_office_notes (due_on) WHERE done_at IS NULL;
CREATE TABLE IF NOT EXISTS sj_model_family_rules (
  rule_id serial PRIMARY KEY, brand_pattern varchar(60), product_pattern varchar(40), model_regex varchar(120),
  family_template varchar(40), label varchar(120), sort_order int, active boolean DEFAULT true,
  created_by varchar(60), created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS sj_model_flags (
  flag_id serial PRIMARY KEY, family_key varchar(80) NOT NULL, body text NOT NULL,
  state varchar(12) NOT NULL DEFAULT 'pending',          -- pending | published | retired
  raised_by varchar(60), raised_at timestamptz DEFAULT now(), reviewed_by varchar(60), reviewed_at timestamptz, retired_at timestamptz);
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS stop_order_source varchar(12);           -- epass | engine | dispatcher
ALTER TABLE sj_jobs ADD COLUMN IF NOT EXISTS is_test boolean DEFAULT false;            -- test bench rows: never synced, never counted
ALTER TABLE sj_customers ADD COLUMN IF NOT EXISTS house_number varchar(8);            -- derived from household_key, indexed for same_house
CREATE INDEX IF NOT EXISTS ix_customers_house ON sj_customers (last_name, house_number, zip);
```

**Model families.** `model_family(brand, product_code, model)` is ~30 lines of pure function; port it
to `services/modelFamily.js`, read `sj_model_family_rules` ordered by `sort_order` (seed the two Bosch
rows), keep the default rule in code. `GET /api/model-insight?brand=&model=` returns the three tiers
(spec §1.7) — three counts, family members, installed parts by tier, recent calls as typed, published
flags for the family key on top. `POST /api/model-flags` creates `pending`; the service manager's
review screen publishes or retires.

**Stop order.** Until the ODBC export includes ePASS's routing table (spec open item 32),
`stop_order_source='engine'` for everything the engine sequences and `'dispatcher'` after a drag. ePASS's
"routed" comment rows and the tickets parked under them are **not modelled** (Cayden 9/17 pm, spec §4.1e):
nothing is read from them, nothing written to them; a ticket that needs the tech goes through
`sj_tech_notifications`.

**Test bench** (spec §14.6). A route under `/test-bench`, `role in (owner, manager)`, three columns: a
generated call (server picks a ZIP weighted by open tickets and, 30% of the time, a real address so the
history link fires), the customer picker rendered by the same component the public scheduling page uses
(`GET /api/offers?job=` over a ten-business-day horizon), and the engine's candidate table from
`GET /api/suggest?job=&explain=1` (return the cost terms, not just the winner). Booking writes an
`sj_jobs` row with `is_test=true` through the ordinary `PUT /api/jobs/:id/place`, so the board updates
over the same socket everyone else's does. The sync worker and every KPI query filter `NOT is_test`; a
nightly job deletes test rows older than seven days. The board renders the whole schedule, not one week:
`GET /api/board?from=&to=` with the week the dispatcher is looking at, and the strip scrolls.

**Route settings.** `PUT /api/techs/:id/settings` writes `sj_techs` defaults and replaces
`sj_tech_pattern` rows in one transaction; `sj_tech_days` stays today-only. Capacity for a day =
pattern row for that weekday, else the tech default, plus the day's `capacity_adjust_min`. Retire =
`sj_techs.active=false, ended_on=date`; the placement engine filters `active AND (ended_on IS NULL OR
ended_on > day)`; history is untouched.

**Sick day.** No new table: a close with `reason='sick'` returns the affected `sv_number`s; the client
calls the existing suggest endpoint per call, `PUT /api/jobs/:sv/place` per move, and
`POST /api/notifications` with `template='reschedule_offer'` per **explicit** send. Two clicks per
customer by design (doc 12 §5: no automated customer contact without a click).

**Reminders** are `sj_office_notes WHERE due_on <= today AND done_at IS NULL`, one list, no delivery
channel. Internal only — Cayden 9/17.

**Search.** `GET /api/customers/search?q=` over `sj_customers` (name, street, zip, right(phone,4)),
grouped by `household_key` in the response; `GET /api/addresses/:household_key` returns every account,
asset and history row at the house. Word-prefix matching for tokens under five characters.

## 4d. The 9/18 round in Agility ⟨added 9/18⟩

Spec §5.8, §4.4b, §4.1f, §5.1a, §5.3–5.4, §9 and the §13d table, items 58–66. Most of this round
reuses something Agility already has — the estimate module, pushed notifications, page permissions —
and the new tables are small. The one architectural change is the direction of truth: **for the interim
ePASS is the source of truth for ticket data, ordering, receiving, accounting and billing** (Cayden
9/18), so the import watcher adopts two statuses from it rather than the dashboard setting them, and
our purchasing routes go behind a flag.

**The estimate hand-off reuses `service_estimates`.** §2 above already said not to add a second
approval store; this round makes that the whole path. When Kezia marks a job verified, the server
creates the estimate row directly from the structured lines — client, SV, contact and text/call
preference, the unit line, every part with number and description, the labor lines (the module shows
*Labor (2 entries)*: the zone fee and the component task), S&H, subtotal, tax, total, and the Parts ETA
sentence from her verified ETA — and Noell finds it in the same list she works today, no PDF. The
token page, `sent → viewed → approved / declined / comped / shopping / diagnostic`, the closed-outcome
summary and the *copy the link or use the button* sending stay exactly as they are. Our side keeps one
row per hand-off so the job knows where its estimate went and what came back:

```sql
CREATE TABLE IF NOT EXISTS sj_estimate_handoff (
  handoff_id   BIGSERIAL PRIMARY KEY,
  sv_number    TEXT NOT NULL,
  external_ref TEXT NOT NULL,                 -- service_estimates token / id
  status       TEXT NOT NULL DEFAULT 'sent',  -- sent | viewed | approved | declined | comped | shopping | diagnostic | no_response | parts_unavailable
  kind         TEXT NOT NULL DEFAULT 'quote', -- quote | notice  (9/18 pm: a discontinued part — the customer is told, not quoted)
  lines        JSONB NOT NULL,                -- the verified part + labor lines exactly as handed over; a part line may carry availability 'nla'
  total        NUMERIC(12,2) NOT NULL,
  parts_eta    DATE,                          -- Kezia's
  handed_by    TEXT NOT NULL DEFAULT '', handed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sj_estimate_handoff_sv ON sj_estimate_handoff (sv_number);
```

`service_estimates.summary` (JSONB) carries the lines so the customer page renders without a join into
`sj_`; `service_estimates.external_ref` points back at `sj_estimate_handoff.handoff_id`, so the
module's status change is one update on our row. Approved → `sj_jobs` to SO3 and a `lines` sync item
for Noell (every part number, every labor code — `ZN1` and the task — the total, *set SO3*); declined /
shopping / no response / diagnostic → SO7. A field-approved quote within 10% of the field price and any
warranty job never create a row. Phase 0 has this as `handoff.py` with 63 tests; the port is mechanical.

⟨9/18 pm⟩ **A discontinued part is a `notice`, not a quote.** Kezia's availability row gains
`nla` (Discontinued) beside stock / 2-3d / 5-7d / backorder; such a line needs a description and nothing
else. Verify on a job with an `nla` line creates the `service_estimates` row with `kind = 'notice'`,
total 0, no Parts ETA, and a `summary` that carries the notice text instead of a quote — *the {part} for
your {unit} has been discontinued by the manufacturer and we can't source it, so the repair can't go
ahead; if you'd like help choosing a replacement, our showroom team can take it from here.* The token page
shows that text and one action — *help me choose a replacement* — which is the module's existing
`shopping` outcome (the sales queue Cayden means). Two responses come back: `shopping` → SO7 + the sales
lead task, or the office's own **`parts_unavailable`** (informed, no replacement wanted) → SO7. Both write
a `set_status` sync item whose note names the part (`{status:'SO7', reason, nla:[…], diag, billing}`); a
notice can never be `approved` (the route rejects it).

⟨9/18 pm⟩ **The diagnostic rides on that packet.** Cayden's rule: it still stands as standard, but the
office frequently waives it while moving the customer to the showroom. So the close route takes
`diag` ∈ `charge` | `waive` | `credit`, defaulting to `sj_settings.billing.diag_on_nla` (`charge`); it
sets `payload.billing` (`waive diagnostic` / `bill diagnostic` / `bill diagnostic, credit on a
replacement`) so whoever keys the SO7 bills it right, copies onto the `task:sales_lead` outbox row so the
showroom knows what the customer was told, and writes an `audit_log` row `diag.waive` / `diag.credit`
with the user — which is what makes the waive rate measurable (today ePASS records a zero total and no
reason). No permission is required: it is a several-times-a-month kindness at the moment a customer is
upset, and a gate would only add friction. `service_estimates.summary` carries the matching fee sentence
so the token page and the text agree. And every estimate close — shopping, went elsewhere,
diagnostic only, parts unavailable — now writes its SO7 sync item, so ePASS hears every outcome, not only
approvals; the previous build only queued approvals. Open on Cayden's side: whether the diagnostic fee
stands when the part cannot be had (spec item 41) — the notice text carries no fee sentence until then.

**Self-booked requests use `pushed_notifications`.** A request with `source <> 'import'` and no SV
needs an ePASS ticket. `createPushedNotification({ audience: office admins, ref_id: <request id>,
type_label: 'create_ticket', title: 'New self-booked request — create the ePASS ticket on {date} ·
{window} · {tech}', body: name, address, phone, unit, problem })`. The card carries an SV field; typing
the SV calls the attach route (§4) and `retirePushedNotificationsByRef(<request id>)`. The next
DispatchTrack push then matches the SV like any other. Same mechanism as needs-tech-input (§4a) — no
new table; the `new_ticket` sync kind in the Python is this notification.

**Permissions use `user_page_permissions`.** Spec §9's matrix maps onto what exists: `owner` and
`manager` → `roster.retire`, `zones.publish`, `settings.edit`, `test_bench` and everything below;
`dispatcher` → `routes.edit`, `tech.route_settings`, `zones.draft`; `csr` → `jobs.book`; `parts` →
`parts.verify`; `tech` → none. Seed them as `permission_groups` rows; check `roster.retire` on
`PUT /api/techs/:id/retire` (which also wants the typed `RETIRE` in the body, and writes `retire_on`)
and `zones.publish` on `POST /api/zones/publish`. Doc 12 §People already has `app_users`; the
prototype's signed-in-as switcher (Demitrius · dispatcher, Mark Perks · manager, Cayden Mayfield ·
owner) is stand-in for the real login. A dispatcher sees a locked chip naming who can retire, not an
error after the fact.

**Columns.**

```sql
ALTER TABLE sj_tech_pattern ADD COLUMN IF NOT EXISTS start_at TEXT;   -- 'shop' | 'home' | NULL = as usual
ALTER TABLE sj_tech_pattern ADD COLUMN IF NOT EXISTS end_at   TEXT;
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS home_lat  NUMERIC(9,6);
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS home_lng  NUMERIC(9,6);
ALTER TABLE sj_techs ADD COLUMN IF NOT EXISTS retire_on DATE;         -- set by roster.retire; active flips on that date
ALTER TABLE sj_zones ADD COLUMN IF NOT EXISTS fee_band SMALLINT;      -- 1–4; NULL = from distance (spec §5.1a). 78701 → 3
```

Per-day endpoints are a pure-function change once the columns exist: `startAt(tech, day)` /
`endAt(tech, day)` read the pattern row for that weekday, else the tech default, and `startPt` /
`endPt` take the day — so `routeMinutes()`, the marginal-drive term in `suggest`, the optimiser, the
map polylines and the commute split (§4a) all use that day's endpoints. Phase 0 is
`placement.route_endpoints(db, tech, date)`. Josh's pattern is the test: shop→shop Monday and
Wednesday, home→home otherwise. `PUT /api/techs/:id/settings` (§4c) writes the two new columns with the
rest, and the drawer's Save is a sticky footer now, which is what item 59 actually needed.

**The zone map.** Every write in the editor lands on `sj_zones`, keyed by ZIP as it already is:
primary `sp_code`, secondary list, `booking_mode`, trip tech and day, `fee_band`. `POST /api/zones/
publish` takes the whole draft, writes it in one transaction, recomputes each tech's zone list,
re-runs `suggest` for every unscheduled job, and writes one row per changed ZIP (from → to) to the
existing audit log. Where the dispatcher's unpublished draft lives — server-side per user, or the
browser as in the prototype — is a small call to make when it is built; the prototype uses
localStorage so a reload keeps both the draft and the published map. The cells are a **ZCTA GeoJSON
asset**: Census TIGER ZCTA5 2020, clipped to the ~150 ZIPs in `sj_zones`, simplified, served as a static
file. The Zones view loads it into a Google Maps `Data` layer, styles each feature by its primary tech's
colour, and a click on a feature calls the same assign function the prototype has (Shift-click toggles a
secondary). That removes the shared-centroid problem the prototype hit — 78717 / 78727 / 78753 / 78756 /
78759 / 78747 have one centroid in our table and no cell of their own. The Maps key stays in Render's
environment, as for the roads map (spec §4.8a).

⟨9/18 pm⟩ **Adding and removing ZIPs.** `POST /api/zones/publish` already takes the whole draft, so
adding a ZIP is a new row and removing one is a missing row — the publish should diff against the
current table and log `added` / `removed` per ZIP alongside the field changes, and a removed ZIP must
resolve to `office_only` in `suggest` (an unmapped ZIP already does). The editor's paste box extracts
five-digit Texas ZIPs from any text (randymajors.org's *Results from Map* list, a spreadsheet column);
the *served before, not on the map* chips come from one query on `svc_service_history` — ZIPs with
tickets since 2025 that have no `sj_zones` row (26 today; 78741 with 29 tickets leads). With the ZCTA
GeoJSON in place there is no "unplaced" ZIP: any ZCTA in Texas can be added and drawn, and the
prototype's `lat, lng` paste and approximate centroids go away. Two cautions from the history: **PO Box
ZIPs** (78763, 78767, 78716, 78766 …) have no ZCTA and should never be zone rows — place those calls by
the address geocode, which `dsp_service_location` already holds — and 78637 appears on 23 tickets but is
not a ZIP that exists, a keying habit the import can flag.

**The import watcher adopts SO4 and SO5 on hand-off jobs.** In `serviceMirrorFromDispatch()`, after
the upsert: for a job with an `sj_estimate_handoff` row in `approved`, an incoming `SO4` sets the job's
status to SO4 and runs the pencil from `parts_eta` (spec §4.3a — two business days after the ETA, a
held block on the board, never sent to ePASS); an incoming `SO5` sets SO5 and marks
`part_arrived_pick_time` **ready** — a card in the office tool with a Send button, or an automatic send
only when `notify.part_arrived_pick_time.auto` is on (off by default; the doc 12 §5 rule). This is the
one exception to "the import never writes status", and it is scoped to hand-off jobs. Phase 0:
`handoff.watch_epass_status`, called from the import reconcile.

**Purchasing behind a flag.** `/parts/order`, `/po/*`, `/receiving/*`, bin scanning and the T−2
receiving task are mounted only when `sj_settings` `purchasing.enabled` is true (default false), and
the office nav hides the tabs. Nothing is deleted — Cayden: *we will bring this back when we are on
NetSuite and can open an API.* The SO4PRE date logic stays on regardless; the receiving half of the
hold check is answered by ePASS's SO5 now.

**Labor settings.** `labor.zone_bands_miles` [7, 26, 47], `labor.zone_fees` {ZN1 120, ZN2 130, ZN3
140, ZN4 150, ZNADD 85}, `labor.diag_fees` {DZ1 157, DZ2 157, DZ3 179, DZ4 209} and
`labor.hourly_rate` 130 in `sj_settings`; `zoneBand(miles, bands)`, `zoneFeeLines(job, zone)` and
`diagFeeLine(zone)` as pure functions in the `lib/` shape (they are short in `labor.py`, and
`quote_labor_lines` honours `sj_zones.fee_band`). Distance is straight-line from the shop
(30.2054, −98.0605) until Cayden decides on drive miles (spec item 34); with `dsp_service_location`
lat/lng already on the address, switching to a Distance Matrix call is one function, but the bands must
be refitted first. The brand-suffixed code (`ZN1-KA`, `ZN2-SZ`, `DZ1-WP`) is chosen when the labor
table has one for the job's brand, else the plain code. The estimate line the customer sees is *Labor
(2 entries)*; the `lines` packet Noell keys carries the two codes.

## 4e. The confirmation page and the tracker token in Agility ⟨added 9/18 late⟩

**The route.** `GET /t/:token` is a public Express route, outside the `requireAuth` middleware and outside
`/api/`, rendering the tracker for whatever `sj_jobs` row holds that token. Agility already serves the
customer estimate page on a token in exactly this shape (`service_estimates`, doc 12 §Service), so this
follows the pattern the customers there are already used to rather than inventing a second one — and the
estimate link the notice and quote flows hand out can be the *same* page once the tracker exists.

**The column.** `sj_jobs.tracker_token CHAR(14)` with a unique index, plus `tracker_token_at` and
`tracker_token_by`. Issued inside the same transaction that creates the request, so there is no window in
which a job exists without a link. A reissue nulls and re-mints; the audit rows are `tracker.issue`,
`tracker.revoke`, `tracker.reissue` in whatever `sj_audit` is called on that side.

**Two things Render makes easy and one it makes fiddly.** Easy: the rate limit (one `express-rate-limit`
on `/t/:token` keyed by IP) and the `.webmanifest` for add-to-home-screen, which is a static route with a
`start_url` of the token URL. Fiddly: **the email-me-the-link send.** Podium is the SMS path; the email
path on the Agility side is whatever the estimate module already uses to send a quote link — reuse it
rather than adding a provider, and keep the body to one sentence and one link. Per doc 12 §5 the key lives
in Render env only.

**What the page reads.** One query on `sj_jobs` joined to customer, address, unit and tech, filtered
through the allow-list (spec §6b `CUSTOMER_FIELDS`), never `SELECT *` into a public response. The three
variants are chosen by `booking_mode`, which the row already carries.

**Where it does *not* go.** The confirmation page is part of the request form's flow, which is Agility's
existing Appliance Repair Request Form — so this is a new final step on a form that already exists, not a
new page in the service-journey module. The natural home is the form's own success handler, which today
shows a thank-you and nothing else.

## 5. Order I would take it in

1. **Parking date + status case** in the two importers, and a one-off pass over existing `sj_jobs`. Half a day, removes a live data bug, and unblocks everything that reads `route_date`.
2. **RCALL → confirmed recall** in `detectRecall()`. An hour.
3. **The importer-side match** (§4) plus `POST /api/service-journey/jobs/from-request {serviceCardId}` and the re-key attach route. This is what makes the copy button real and stops double rows.
4. **Placement as pure functions** + the new columns + `sj_placement_log`, then `/board`, `/suggest`, `/offer`, `/pencil`, `/shadow`. Fixture tests under `node --test` off the gitignored reference exports, skipping when absent.
5. **Retire the AJH pages** and point the queue button at the new route.
6. Only then the customer-facing picker, one zone or one tech, with the dispatcher-approves gate in front of the confirmation text.

⟨9/18⟩ The interim model in §4d sits **early** — between steps 3 and 4, or alongside them — because it is what lets the tool go live beside ePASS at all: the `create_ticket` notification, the `service_estimates` hand-off, the `lines` packet and the SO4/SO5 read-back are the whole SO1-to-SO6 loop with ePASS still in charge, and every one of them reuses something that already exists; the purchasing flag is small and takes a whole tab off the office's plate.

⟨9/15 pm⟩ Two of the team's items jump this queue because they are cheap and they change what people see: **commute out of the capacity number** (a pure-function edit, and the board is currently telling dispatchers a lie about Connor and Trevor) and **units on the card** (already in the data). **Needs-tech-input** is next — five columns and `pushed_notifications`, which already exists. **Visit groups** are the big one and belong after the placement port, since grouping is mostly a change to how placement counts a stop.

Steps 1–2 are worth doing whoever writes them; they are small and they are wrong in production today. I can hand over 3–4 as Node modules in the `lib/` shape with fixture tests rather than as Python to be ported — say the word and that is what the next pass produces.

---

## 6. Conventions to hold to (from doc 12 §5 and §7)

Parameterised queries only, with explicit casts on nullable date/numeric parameters. Pure rules take plain objects and return plain objects with no pool in them, so they test without a database. Rules as data — status transitions, reason codes, placement weights, offer windows and templates as JSON constants or `sj_settings` rows, so the Sep-10 replay in doc 08 can be re-run by changing numbers. One vocabulary across both sides: the status codes, packet kinds and sync states already match; keep sp_codes and ISO `YYYY-MM-DD` dates in the new columns. Seed demos by pushing a real file through the real import route, not by inserting rows. And reuse before adding — geocoding, photos, estimates, Podium, notifications and audit all exist already.

Customer exports stay in `reference/data/` and stay out of git; that folder now has its own `.gitignore` on our side too.
