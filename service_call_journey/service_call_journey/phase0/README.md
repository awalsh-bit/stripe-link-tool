# Phase 0 — mirror ePASS into the dashboard (working code)

This folder is the first slice of `docs/07_Developer_Spec.md` as runnable Python: the schema, the two
ePASS importers written against the real export headers, the "dashboard owns" upsert rules, the status
engine (spec §2 as a data table), the sync queue with paste-ready packets, and the stale / stuck rules.
It is tested against the two real files in `../reference/data`.

Standard library only (plus `openpyxl` for the xlsx export and `pyodbc` for SQL Server). SQLite for
development and tests; SQL Server Express (`localhost\SQLEXPRESS`, same instance as `WilsonRouting`)
in production. Same SQL runs on both.

```
phase0/
  wilson_service/
    schema.py           tables + DDL generator (sqlite | mssql)
    db.py               tiny DB layer, '?' placeholders on both engines
    seed.py             statuses (ePASS vocabulary), settings (spec §11), techs, zones, zips from ../reference
    importers/
      dispatchtrack.py  DispatchTrackDetail_*.csv (cp1252, full snapshot every 15 min)
      exportinvoice.py  ExportInvoice_*.xlsx (Invoice Maintenance, header row 3)
      common.py         parsing helpers, customer/address/unit fill-only upserts
    statuses.py         transition table (spec §2) + create_request (rule 1); 9/11 rules 22.1/22.2 (held install, part not in) and 24.1 (direct-ship part received)
    sync.py             sync items, packet rendering, confirmation, discrepancies, accept/reissue
    stuck.py            stale visit tickets + stuck-jobs thresholds
    capacity.py         9/11: working days (JRC Mon–Thu), open/close a day, PTO ranges, ±minutes, non-call blocks, "Force it" — all audited
    kpi.py              9/11: recall detection on every new job (same unit ≤ 30 d, or ePASS RCALL), Recalls review, first KPIs per tech
    placement.py        9/14: where a call should land judged against the real route (suggest), the SO4 auto-pencil, route-first offers, the scorecard
    intake.py           9/14: "Copy to service dashboard test module" — one live queue row -> REQ + first suggestion; SV attach/merge
    serve.py            9/14: stdlib HTTP shim for that button and for suggest/offer/board/shadow reads
    watcher.py          watched-folder runner (Task Scheduler every 5 min); re-scores pencils after each import
    labor.py            9/18: the zone fee rule (ZN1–4 by miles from the shop, ZNADD per extra unit, DZ1–4 diagnostic) + per-task labor lines
    auth.py             9/18: roles -> dotted permission names; can(db, email_or_role, permission)
    roster.py           9/18: retire_tech — active=0 + retire_on, audited, returns the open work still on that tech
    handoff.py          9/18: estimate hand-off to Agility's service_estimates, 'lines' / 'new_ticket' packets, the ePASS watch (SO4 -> pencil, SO5 -> text)
    cli.py              python -m wilson_service ...
  schema/schema_mssql.sql, schema/schema_sqlite.sql   generated, idempotent, self-migrating (adds new columns to an existing DB)
  tests/test_phase0.py  64 tests (1 skipped without the real files), runs in ~20 s
```

## Run it

```bat
cd C:\Dev\service_call_journey\phase0
python -m unittest -v                                   :: all green before anything else

:: local SQLite copy against the real exports
python -m wilson_service --db sqlite:dev.db init-db
python -m wilson_service --db sqlite:dev.db import-dt ..\reference\data\DispatchTrackDetail_20260910_220003.csv
python -m wilson_service --db sqlite:dev.db import-ei ..\reference\data\ExportInvoice_20260910_222420.xlsx
python -m wilson_service --db sqlite:dev.db stats
python -m wilson_service --db sqlite:dev.db stale
python -m wilson_service --db sqlite:dev.db sync list
python -m wilson_service --db sqlite:dev.db recalls list                 :: 9/11: RCALL-flagged tickets + same-unit candidates
python -m wilson_service --db sqlite:dev.db kpi 2026-08-01 2026-09-10    :: per tech: visits, calls/working day, turnaround, diag-only, recalls
python -m wilson_service --db sqlite:dev.db day close JRC 2026-09-21 --through 2026-09-25 --reason pto
python -m wilson_service --db sqlite:dev.db day open JRC 2026-09-18       :: Josh's Friday, per management
python -m wilson_service --db sqlite:dev.db day adjust DLA 2026-09-14 60  :: one more stop
python -m wilson_service --db sqlite:dev.db day block DLA 2026-09-14 11:30 12:15 "Van maintenance"
python -m wilson_service --db sqlite:dev.db intake request.json          :: 9/14: one live-queue row in -> REQ + where it would land, and why
python -m wilson_service --db sqlite:dev.db suggest 664                  :: ranked tech/day candidates against the real route
python -m wilson_service --db sqlite:dev.db offer 664                    :: the dates the customer would see, best fit first
python -m wilson_service --db sqlite:dev.db set-eta 349 2026-09-16       :: Kezia's ETA -> SO4 -> auto-penciled ETA + 2 business days
python -m wilson_service --db sqlite:dev.db shadow-report                :: the morning check for the shadow test
python -m wilson_service --db sqlite:dev.db serve                        :: HTTP shim the "Copy to service dashboard test module" button posts to
```

Expected on the 9/10 files: DT `2164 rows, 236 SV orders -> created 236`; EI `657 tickets -> created 427, updated 230`;
re-importing a copy of the DT file gives `created 0, updated 0, unchanged 236`; the same file name twice is skipped.
`stale` lists the 18 SO1/SO6 tickets dated on or before 9/9 that ePASS still shows open (the replay finding).

## SQL Server

```bat
pip install pyodbc openpyxl
sqlcmd -S localhost\SQLEXPRESS -Q "CREATE DATABASE WilsonService"
set WILSON_SERVICE_DB=mssql:DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost\SQLEXPRESS;DATABASE=WilsonService;Trusted_Connection=yes
python -m wilson_service init-db --reference C:\Dev\service_call_journey\reference
python -m wilson_service watch
```

`init-db` runs `schema/schema_mssql.sql` (or `python -m wilson_service ddl mssql > x.sql` to hand it to SSMS) and seeds.
Both are idempotent: run them again after pulling a new version and nothing is overwritten.

Task Scheduler: copy the sales-side "Wilson Routing EPASS Import" task, point the action at
`python -m wilson_service watch` with the `WILSON_SERVICE_DB` variable set (see `watch_task.cmd`), every 5 minutes.
`watch` imports the newest `DispatchTrackDetail_*.csv` not yet in `import_batch` (all of them, oldest first, with
`--all` or setting `import.dt_watch_all=1`) and, if `import.ei_folder` is set, the newest `ExportInvoice_*.xlsx`.
A failed parse marks the batch `failed`, applies nothing, and the next run tries the next file.

## What the import does and does not touch

Import-owned (written every snapshot): `epass_status`, `epass_route_date`, `epass_tech_code`, `epass_seen_at`,
`in_feed`, `balance`, `bin_location`, `warranty_flags`/`is_warranty`, `qualification`; from ExportInvoice also
`total`, `payment_type`, `epass_invoice_status`, `epass_finish_date`, `epass_created_at`, `units`.
Fill-only (blank → value, never overwritten): address lat/lng, `access_notes`, `zone_code`, `problem_text`, unit brand/model/serial, customer email/alt phone.
Never written by an import: `status`, `route_date`, `assigned_tech_id`, `owner_tech_id`, `route_sequence`,
`promised_window_*`, `trip_id`, anything on quotes or appointments.

An SV the dashboard has never seen is created with `source='import'`, `status = epass_status`, `route_date`
and tech from the export, and `needs_intake_review=1`. While `source='import'` the job keeps following ePASS
(status, date, tech) with `status_history.trigger_event='epass_follow'`; the first dashboard-originated event
flips `source` to `dashboard` and from then on ePASS differences become sync discrepancies instead.

Two ePASS quirks handled here: `KJB2`/`VJ` are aliases of `KJB`/`VWJ` (tech.aliases); the invoice export writes
priorities as `WTYRCALL` where DispatchTrack writes `WTY,RCALL` — both normalise to `RCALL,WTY`.
`* Sched Date` in the invoice export is a far-future placeholder for unscheduled tickets; it is ignored beyond
`import.ei_sched_horizon_days` (120) and never overrides DispatchTrack's date while the job is in that feed.

## Status engine

`statuses.transition(db, job_id, event, actor_type, actor_id, reason_code=None, **ctx)` — rules 2–34 from spec §2
live in `statuses.RULES` as data (from-statuses, event, ctx match, guard, target, side effects). Rule 1 is
`statuses.create_request(...)`. Anything not in the table is `staff.manual_status` and needs `reason_code`.
Side effects that leave the dashboard are queued, not executed: ePASS packets → `sync_item`; texts, payments,
tasks → `outbox` (`effect`, `payload`) for the Phase 1+ Podium/Stripe workers to drain.

Aging: `stuck.stuck_jobs()` uses `status_def.stuck_after_hours` (SO2 24 h, SO2.1 4 h, SO2.2 5 d, SO3 48 h, SO5 48 h,
REQ 24 h, SO1+research 72 h). For import-created jobs the clock starts at first import — ePASS does not export when
a status was set.

## Sync queue

`sync_item` states: `pending` → `keyed` (Michael taps Keyed) → `confirmed` (next import shows every payload field
matching). Two mismatching imports after `keyed_at` → `discrepancy` with `epass_values`; resolve with
`sync reissue N` (back to pending) or `sync accept N` (dashboard takes the ePASS values, history trigger `epass_accept`).
`create_ticket` items are confirmed when an unknown SV appears whose customer phone (or last name + zip) matches;
the SV is attached to the dashboard job instead of creating a duplicate. Reverse discrepancies (ePASS changed with
no dashboard event) are created directly in `discrepancy`; SO4PRE↔SO6 is treated as equal.

Until ePASS widens the DispatchTrack export (SO1/SO4PRE/SO5/SO6 only today), a keyed `SO3` cannot be confirmed by
DT — the job just drops out of the feed (`in_feed=0`). The ExportInvoice import confirms it. Drop that file into a
watched folder (`import.ei_folder`) or upload it once a day until then.

## Added from the 9/11 team feedback (spec v1.2 §13)

- `tech.work_days` from the roster (`reference/tech_roster.csv` now has the column; JRC = Mon–Thu). `capacity.is_open()` = working day unless a `tech_day` override says otherwise; `set_day` opens/closes, `close_range` does PTO, `adjust_day` is the ±60 button, `route_block` rows are the non-call blocks. Every change writes `audit_log` (`capacity.*`). `force_onto_day` is the one-click "Force it" — no reason code, flag `forced`, audited.
- Rules **22.1** (`timer.hold_check`, T−2: flag `hold_at_risk`, task `hold_eta_check` for Kezia), **22.2** (`timer.hold_release` / `staff.hold_time_out`, T−1: SO4PRE → SO4, date released, `notify:hold_released_apology`, packet) and **24.1** (`customer.part_received` / `carrier.delivered`: SO4H → SO5, `bin_location='CUST'`). The timers themselves are a scheduler job (Phase 3); the transitions and their tests exist now.
- `kpi.detect_recall` runs on every job creation (both importers and `create_request`): same serial, or same model at the same address, with an SO8/SO8I within `recall.window_days` → `recall(candidate)` against the original owner; `warranty_flags` containing RCALL → `recall(confirmed, epass_rcall)`. `review_recall` confirms/dismisses. `kpi.kpis(from, to)` gives visits, calls per working day (respects work_days and closed days), median turnaround, diag-only share and recalls per tech — thin until the completed-invoice back-fill (spec Phase 0.5) lands, because the open-ticket export only carries this month's SO8s.
- `delivered` table exists (per-job labor / parts sell / cost / profit); nothing writes it yet — it needs quote lines (Phase 2) or an ePASS invoice-line feed with cost (spec §12 item 9).

## Added 9/14 — placement, the SO4 pencil, the queue-copy button, the shadow test (spec v1.3 §13.17–19, §14)

Upgrading an existing database: pull, then `python -m wilson_service init-db` again. `init_schema` now adds any column the
code knows and the database lacks (`job.parts_eta, est_minutes, penciled_*, source_ref, card_ref`, table `placement_log`);
the generated `schema_mssql.sql` carries the same `IF COL_LENGTH(...) IS NULL ALTER TABLE ... ADD` guards for SSMS.

**`placement.suggest(job)`** ranks (tech, day) pairs over the next `placement.horizon_business_days` against the stops
DispatchTrack actually shows for that tech/day (plus pencils). Cost, in minutes: marginal drive to insert the stop into
that day's route (nearest insertion; shop → stops → shop) − `same_zone_bonus_min` per stop already in the job's zone (max 3)
+ waiting cost (`defer_min_per_day` for the first `defer_soft_days`, `defer_min_per_day_late` after — so a Round Rock day
two days out beats an empty day tomorrow, but nothing gets pushed a week) + a penalty when the tech is not the zone's
primary. Hard filters: tech open (`capacity.is_open`), skill (`tech.skills`: appliance / HVAC), `auto_schedule`, and the
day must keep `min_slack_min` after the job. Owner tech installs only consider the owner. A job with no geocode is placed
at the average of DispatchTrack-geocoded addresses in its ZIP, else the zone centroid, else the zone's address average,
else geo-neutral — so web requests place sensibly and get better with every import. `why` is the sentence the board shows:
`DLA has 3 stops in LOCAL that day · +9 min drive · 2h 40m left · primary tech`.

**`placement.pencil(job)`** — the SO4 auto-pencil (Cayden 9/14). When Kezia's ETA lands on the job (`po.placed` /
`po.eta_changed` now write `job.parts_eta`), an SO4/SO4B/SO4H job is soft-held on the best-fit day
`pencil.business_days_after_eta` (2) business days after the ETA: `penciled_tech_id/date`, flag `penciled`, audit
`placement.penciled`. Pencils count against that day's capacity in every later suggestion, are re-scored after each import
(`watcher`) and move only when another day is `pencil.move_threshold_min` cheaper. Nothing is sent to ePASS — the ticket
stays SO4 there; SO4PRE (a date the *customer* holds) is a different thing and unchanged. When the part checks in (SO5)
`placement.offer()` puts the penciled day first, labelled; booking it (rule 25) clears the pencil; cancel clears it.

**`placement.offer(job)`** — customer picker order. With `offer.route_first`: the cheapest day within
`offer.max_defer_days` of the earliest open day comes first with a label ("Best fit — our route is already in your area
that day"), then dates in order; the earliest open day is always in the list. `booking.max_offers` caps it.

**`intake.from_queue(payload)`** — the receiving side of the **"Copy to service dashboard test module"** button on the
live Service Request Queue (field mapping in `intake.py`'s docstring; it is the queue row as shown on screen: customer,
address, contact method, units with type/model/serial/problem, photos, card-on-file + SetupIntent, ERP order number).
Creates the REQ through rule 1 (`source='dashboard'`, `source_ref='queue:<request_id>'`, `card_ref`), logs the first
suggestion in `placement_log(kind='intake')`, and is idempotent on `request_id`. When the dispatcher books the call in
ePASS as today, the next DispatchTrack snapshot **attaches** the new SV to the request (phone, or a name token + zip,
within `intake.match_window_days`), adopts the ePASS booking (`status_history.trigger_event='epass_attach_booked'`) and
fills `placement_log.actual_*` — no duplicate job, and the suggestion is scored automatically. If ePASS was keyed first
and the SV arrives later via the queue's ERP field, `intake.attach_sv` merges the import-created job into the request.

**`serve`** — `python -m wilson_service serve` (port `serve.port` 8765, optional `serve.token` → `X-Token`, CORS
`serve.cors_origin`): `POST /api/requests` (the button), `POST /api/requests/<id>/sv`, `GET /api/jobs/<id>/suggest|offer`,
`POST /api/jobs/<id>/pencil`, `GET /api/board?date=`, `GET /api/shadow`, `GET /health`. It is a shim for the demo
instance, not the Phase 1 API (spec §7) — single process, one DB connection behind a lock.

**Shadow test**: `python -m wilson_service shadow-report` is the morning check — last import, in-feed counts by status,
discrepancies / pending packets / stale, requests copied from the queue and which still have no SV, suggested-vs-actual
agreement (same day, same tech, both) with the misses listed, and every penciled install. Tests: `T08Placement0914`.

## Added 9/15 — the second real invoice export

`reference/data/ExportInvoice_20260915_current_sv.xlsx` (460 open SVs) imports onto the 9/10 mirror as
`created 89, updated 171, unchanged 200, parked 182, new statuses 1`. Two ePASS conventions it made obvious, now
handled by both importers (spec §3.3a):

- **The parking date.** ePASS dates work that has no real date to the *coming Saturday* — Sat 9/12 on 121 tickets in
  the 9/10 file, Sat 9/19 on 155 in the 9/15 one (SO2.2 43 of 44, SO4 43 of 62, SO4H 8 of 8). `importers.common.is_parking_day`
  treats a date on a day no active tech works (`tech.work_days`) as unscheduled: `epass_route_date` stays NULL, the job
  is flagged `parked`, the import summary counts it, and the flag clears by itself when a real day shows up. Setting
  `import.parking_day_rule`. It catches 22 of the 236 DispatchTrack orders too. Without it the board grows 155 phantom
  Saturday stops and the stale rule fires on every one of them a week later.
- **Status case.** The same file carries `SO8` and `so8`; both importers upper-case `Job Status` before `ensure_status`,
  so a typo no longer creates a parallel status. (`QUOTE 2` is real junk and still surfaces for the office to fix.)

Tests: `T09RealExport0915` (parking date set and cleared, case normalised, and the whole 460-ticket file on top of the
9/10 mirror — counts, a weekday-only week, and every RCALL-flagged ticket carrying a confirmed recall).

## Added 9/16 — the ePASS back catalogue (spec §1.4, §1.5)

Twenty years of service tickets and the customer list now load:

```
python -m wilson_service load-history --history SV_HISTORY.csv --customers CUSTOMERS.csv
python -m wilson_service customer "bohuslav"          # phone, surname, street, serial or SV
python -m wilson_service customer 5123471078 --full
```

Load the customers first — it lifts the match rate. About 24 seconds for the real files
(117,594 tickets, 45,239 customers). Idempotent: history on `sv_number`, customers on the ePASS code,
so a wider re-export can be run straight over the top.

New tables: **`payer`** (who gets billed — *not* the customer), **`asset`** (the physical appliance by
serial), **`service_history`** (one row per historical ticket) and **`external_ref`** (every other
system's id for anything we own). `customer` gains the Do-Not-Service flag, `household_key` and the
rollups the office page reads; `address` gains `address_key`; `unit` now points at its `asset`.

**The one thing to understand before touching this code:** ePASS's `Bill To Customer` is the *payer*.
25,148 of the 117,594 tickets are billed to Whirlpool, Sub-Zero, GE, Bosch or Trane — every warranty
visit. Key the history on that column and a fifth of the record disappears from the households it
belongs to. `load_history` resolves those back by address and then surname, and writes
`identity_source` on every row so the decision is auditable and reversible.

What the real load produces: 77.8% matched on an ePASS code, 17.3% on address, 3.6% on surname, 1.2%
unmatched; 55,910 assets; 212 Do-Not-Service households; 3,461 addresses with more than one ePASS
account (shown, never merged). `tests/test_phase0.py::T10History0915` asserts those numbers against the
real files and skips when they are not present.

## Added 9/17 — the address rule, condo units, model families (spec §1.4h–j, §1.7)

The first day of office testing against real history found a Do-Not-Service flag on the wrong Baird.
Three importer changes, all in `importers/history.py`, all covered by `T10History0915`:

- **`same_house(line1, household_key)`** — a surname match is only believed at the same house number
  (and the same unit when either side has one). `load_history`'s fallback uses it; 4,264 surname
  attachments became 1,837, and the 2,222 that had pointed at a namesake across town now get their own
  household. `unmatched` rises from 1.2% to 2.3%; that is correct.
- **`unit_of()` / `address_key(line1, zip, line2)`** — the unit ("UNIT 1908", "#2409", "APT 2502" in
  Address 2, or a bare trailing number after a street suffix) is part of the key: `210 LAVACA ST #1908|78701`.
  245 accounts at 210 Lavaca St were one household; they are 174 now.
- Placeholder street lines with no number and under three words produce no key.

Re-run `load-history` from scratch after pulling this (the keys changed); the whole thing, history plus
the seven-file export, is about 50 seconds.

In `importers/fullexport.py`: **`model_family(brand, product_code, model)`** returns the family key
(`BOSCH|DW|SH?78`) from `MODEL_FAMILY_RULES` (seeded with the Bosch handle rule) or the default
letters-plus-first-digit-run stem; **`model_insight()`** now returns three tiers — exact, family,
brand + product type — with parts and recent calls per tier. `python -m wilson_service model BOSCH
SHP78CM5N` prints them. Test: `test_model_family`.

New tables in `schema.py`: `tech_pattern`, `office_note`, `model_family_rule`, `model_flag` (spec §1.2).
The prototypes' shared link rule lives in `scratchpad/linkrule.py` for now; `reference/route_order_0917.json`
holds the ePASS stop order transcribed from Cayden's screenshots.

**9/17 late — the offer window.** `placement.offer()` now starts the customer's calendar on the cheapest
candidate within `offer.hold_max_business_days` (3) of first open capacity and drops the dates before it;
the first row is labelled "Earliest available" (never "best fit"). `offer.max_defer_days` is retired.
Cayden's rule from the test bench; spec §4.3.

## Added 9/18 — per-day route ends, the zone fee, permissions, the estimate hand-off (owner feedback)

- **Route ends per weekday.** `tech.home_lat/home_lng`, `tech_pattern.start_at/end_at` (`shop` | `home` | NULL = default). `placement.route_endpoints()` feeds `day_load` and `suggest`, so Josh's Tue/Thu run home → stops → home and his Mon/Wed parts days still start at the shop. `home` with no coordinates = the shop; no pattern + shop/shop = unchanged. The roster has no home coordinates yet (NULL).
- **`labor.py`** — the zone fee as a rule: `zone_band` over 7/26/47 straight-line miles (81% of 3,807 zoned tickets 2024–26), `zone_fee_lines` (ZN1 $120 · ZN2 $130 · ZN3 $140 · ZN4 $150, ZNADD $85 per extra unit), `diag_fee_line` (DZ1/2 $157, DZ3 $179, DZ4 $209; + 8.25% tax = the $169.95 quoted), `quote_labor_lines(db, job, [(task, hours)])` = zone fee + hours × rate on every quote. `zone.fee_band` overrides distance (downtown 78701 = ZN3). Settings `labor.zone_bands_miles`, `labor.zone_fees`, `labor.diag_fees`, `labor.hourly_rate`.
- **`auth.py`** (`app_user`, `app_permission`): owner/manager → `roster.retire`, `zones.publish`, `settings.edit`, `test_bench`; dispatcher → `routes.edit`, `tech.route_settings`, `zones.draft`; csr → `jobs.book`; parts → `parts.verify`. `can(db, email_or_role, permission)`; dotted strings because Agility's `app_users` + `user_page_permissions` is where this lands.
- **`roster.retire_tech(db, sp_code, on_date, by_email)`** — `PermissionError` without `roster.retire`; `tech.active=0`, `tech.retire_on`, `audit_log roster.retired`; returns the open stops/pencils on or after the date. `ended_on`/`lifecycle` stay import-owned.
- **`handoff.py`** (`estimate_handoff`): `hand_off()` after parts verifies price + ETA → Agility's `service_estimates` page (`external_ref` = its token) → `record_response()`: approved = SO3 + one **`lines`** packet (approved lines + SO3 for the office to key — the engine's set_status is not also queued); declined/shopping/no_response/diagnostic = SO7 + `set_status`. Ordering/receiving stay in ePASS: the **ePASS watch** in `sync.reconcile_after_import` adopts SO4*/SO5 on a job with an approved hand-off (history `epass_watch`, counted as `followed`) — SO4 pencils off the verified ETA, SO5 queues the part-arrived text. A self-booked request (`source<>'import'`, no SV) gets a **`new_ticket`** packet (`request_ticket`, reusing an open `create_ticket`); `link_ticket(sync_id, sv, by)` sets `job.sv_number` via `intake.attach_sv` and marks it keyed.
- **Discontinued parts (9/18 pm)**: a hand-off whose lines carry `availability: 'nla'` is `kind='notice'` (total 0, no ETA) — the customer is told the repair cannot proceed and offered the showroom. `record_response()` accepts **`parts_unavailable`** (informed, call closed) and `shopping` (wants a replacement → `task:sales_lead`); both set SO7 with a `set_status` packet whose note names the part. A notice can never be `approved`. The **diagnostic** on a notice is `record_response(..., diag=)` — `charge` (the standard, and the seeded default `billing.diag_on_nla`), `waive` (one call, no permission needed, audited as `diag.waive` with the actor) or `credit` (billed now, credited against a replacement — modelled, not yet policy). It rides on the SO7 packet as a `billing` instruction so ePASS is billed correctly, and on the sales lead. Measured on 248 COD discontinued-part calls since Jan 2024: billed 56%, waived 19%.

Tests: `T12Feedback0918`. Upgrading an existing database is `init-db` again, as before.

## Open items for the dev

- Table names/columns are the spec's, minus T-SQL reserved words (`settings.setting_key`, `tech_day.work_date`,
  `status_history.changed_at/trigger_event`). Quote, appointment, part_line, payment, notification tables are Phase 1–2.
- `import_row_raw` keeps every DT line (parts for SO4–SO6 are there as Model/Description/Quantity) — this is the
  `import_line` table from spec §3.3 until parts get their own table.
- Geocoding: the import stores DispatchTrack lat/lng as `geocode_source='epass'`; nothing re-geocodes yet.
- Not covered here on purpose: capacity ledger, slot offering, trips, routing (spec §4), pricing (§5), Podium (§6), API (§7).
