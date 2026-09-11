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
    watcher.py          watched-folder runner (Task Scheduler every 5 min)
    cli.py              python -m wilson_service ...
  schema/schema_mssql.sql, schema/schema_sqlite.sql   generated, idempotent
  tests/test_phase0.py  31 tests, runs in ~2 s
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

## Open items for the dev

- Table names/columns are the spec's, minus T-SQL reserved words (`settings.setting_key`, `tech_day.work_date`,
  `status_history.changed_at/trigger_event`). Quote, appointment, part_line, payment, notification tables are Phase 1–2.
- `import_row_raw` keeps every DT line (parts for SO4–SO6 are there as Model/Description/Quantity) — this is the
  `import_line` table from spec §3.3 until parts get their own table.
- Geocoding: the import stores DispatchTrack lat/lng as `geocode_source='epass'`; nothing re-geocodes yet.
- Not covered here on purpose: capacity ledger, slot offering, trips, routing (spec §4), pricing (§5), Podium (§6), API (§7).
