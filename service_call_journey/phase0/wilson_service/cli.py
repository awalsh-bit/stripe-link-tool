"""Command line for Phase 0.

    python -m wilson_service.cli --db sqlite:wilson_service.db init-db --reference ../reference
    python -m wilson_service.cli import-dt  \\\\WILSON-EPASS01\\Updates\\ePASSScheduler\\DispDataExport\\DispatchTrackDetail_20260910_220003.csv
    python -m wilson_service.cli import-ei  ExportInvoice_20260910_222420.xlsx
    python -m wilson_service.cli watch --once
    python -m wilson_service.cli sync list | keyed 12 --user michael | reissue 12 | accept 12
    python -m wilson_service.cli stuck | stale | stats | ddl mssql

Connection: --db or env WILSON_SERVICE_DB.  sqlite:PATH  or  mssql:<pyodbc connection string>.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import logging
import os
import sys

from . import __version__, capacity, kpi, schema, seed, stuck, sync, watcher
from .db import DB
from .importers import dispatchtrack, exportinvoice

DEFAULT_DB = os.environ.get("WILSON_SERVICE_DB", "sqlite:wilson_service.db")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="wilson_service", description=f"Wilson service journey Phase 0 v{__version__}")
    ap.add_argument("--db", default=DEFAULT_DB, help="sqlite:PATH or mssql:CONNSTR (default from WILSON_SERVICE_DB)")
    ap.add_argument("--now", help="override 'now' (yyyy-mm-dd HH:MM) for replays and tests")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init-db", help="create tables (idempotent) and seed statuses/settings/techs/zones")
    p.add_argument("--reference", default=os.path.join(os.path.dirname(__file__), "..", "..", "reference"), help="folder with tech_roster.csv, zone_table.csv, zip_zone_tech.csv")
    sub.add_parser("seed", help="re-run the seed (adds anything missing, never overwrites)").add_argument("--reference", default=os.path.join(os.path.dirname(__file__), "..", "..", "reference"))
    p = sub.add_parser("ddl", help="print the schema DDL"); p.add_argument("dialect", choices=["sqlite", "mssql"], nargs="?", default="mssql")
    p = sub.add_parser("import-dt", help="import one DispatchTrack CSV"); p.add_argument("path"); p.add_argument("--encoding")
    p = sub.add_parser("import-ei", help="import one ExportInvoice xlsx"); p.add_argument("path")
    p = sub.add_parser("watch", help="import new files from the watched folders"); p.add_argument("--once", action="store_true", default=True)
    p.add_argument("--dt-folder"); p.add_argument("--ei-folder"); p.add_argument("--all", action="store_true", help="import every unimported DT file, oldest first")
    p = sub.add_parser("sync", help="ePASS sync queue"); ps = p.add_subparsers(dest="sub", required=True)
    ps.add_parser("list").add_argument("--state", choices=["pending", "keyed", "discrepancy", "confirmed"])
    ps.add_parser("show").add_argument("sync_id", type=int)
    q = ps.add_parser("keyed"); q.add_argument("sync_id", type=int); q.add_argument("--user", default=os.environ.get("USERNAME") or os.environ.get("USER") or "office")
    q = ps.add_parser("reissue"); q.add_argument("sync_id", type=int); q.add_argument("--user", default=os.environ.get("USERNAME") or "office")
    q = ps.add_parser("accept"); q.add_argument("sync_id", type=int); q.add_argument("--user", default=os.environ.get("USERNAME") or "office")
    sub.add_parser("stuck", help="jobs past their aging threshold")
    sub.add_parser("stale", help="visit tickets whose date passed without being closed in ePASS")
    sub.add_parser("stats", help="counts by status, tech, zone")
    sub.add_parser("batches", help="import history")
    p = sub.add_parser("day", help="dispatcher capacity controls (9/11)"); pd = p.add_subparsers(dest="sub", required=True)
    for name, hlp in (("close", "close a day: PTO / sick / training / other"), ("open", "open a normally closed day (e.g. Josh's Friday)"), ("adjust", "+/- minutes of capacity"), ("show", "what the fill-strip popover shows")):
        q = pd.add_parser(name, help=hlp); q.add_argument("tech", help="SP code"); q.add_argument("date", help="yyyy-mm-dd")
        if name == "close": q.add_argument("--reason", default="pto", choices=["pto", "sick", "training", "other"]); q.add_argument("--through", help="close every working day through this date")
        if name == "adjust": q.add_argument("minutes", type=int)
        q.add_argument("--user", default=os.environ.get("USERNAME") or "dispatcher")
    q = pd.add_parser("block", help="add a non-call block"); q.add_argument("tech"); q.add_argument("date"); q.add_argument("start", help="HH:MM"); q.add_argument("end", help="HH:MM"); q.add_argument("label"); q.add_argument("--user", default="dispatcher")
    p = sub.add_parser("recalls", help="recall candidates (same unit within 30 days)"); pr = p.add_subparsers(dest="sub", required=True)
    pr.add_parser("list").add_argument("--state", choices=["candidate", "confirmed", "dismissed"])
    for name in ("confirm", "dismiss"):
        q = pr.add_parser(name); q.add_argument("recall_id", type=int); q.add_argument("--note"); q.add_argument("--user", default=os.environ.get("USERNAME") or "manager")
    p = sub.add_parser("kpi", help="per-tech KPIs for a date range"); p.add_argument("from_date"); p.add_argument("to_date")

    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    now = _dt.datetime.fromisoformat(a.now) if a.now else _dt.datetime.now()
    if a.cmd == "ddl":
        print(schema.ddl(a.dialect)); return 0
    db = DB.from_url(a.db)
    try:
        return _dispatch(db, a, now)
    finally:
        db.close()


def _dispatch(db: DB, a, now) -> int:
    if a.cmd == "ddl":
        print(schema.ddl(a.dialect)); return 0
    if a.cmd in ("init-db", "seed"):
        if a.cmd == "init-db":
            db.init_schema(); print(f"schema ok ({db.dialect})")
        counts = seed.seed_all(db, a.reference)
        print("seeded:", counts); return 0
    if a.cmd == "import-dt":
        return _run_import(dispatchtrack, db, a.path, now, encoding=a.encoding)
    if a.cmd == "import-ei":
        return _run_import(exportinvoice, db, a.path, now)
    if a.cmd == "watch":
        for line in watcher.run_once(db, dt_folder=a.dt_folder, ei_folder=a.ei_folder, all_files=True if a.all else None, now=now):
            print(line)
        return 0
    if a.cmd == "sync":
        return _sync_cmd(db, a)
    if a.cmd == "stuck":
        rows = stuck.stuck_jobs(db, now)
        print(f"{len(rows)} stuck jobs")
        for r in rows:
            print(f"  {r['sv_number'] or '(no SV)':<14} {r['status']:<8} {r['hours_in_status']:>7.1f}h (>{r['threshold_hours']}h)  {r['display_name'] or ''}{'  STALE' if r['stale'] else ''}")
        return 0
    if a.cmd == "stale":
        rows = stuck.stale_jobs(db)
        print(f"{len(rows)} stale visit tickets (not closed in ePASS after the visit date)")
        for r in rows:
            print(f"  {r['sv_number']:<14} {r['epass_status'] or r['status']:<6} {r['epass_route_date'] or r['route_date']}  {r['epass_tech_code'] or '-':<4} {r['display_name'] or ''}")
        return 0
    if a.cmd == "stats":
        _stats(db); return 0
    if a.cmd == "day":
        return _day_cmd(db, a, now)
    if a.cmd == "recalls":
        return _recall_cmd(db, a, now)
    if a.cmd == "kpi":
        rows = kpi.kpis(db, a.from_date, a.to_date, now)
        print(f"{'tech':<6}{'visits':>7}{'days':>5}{'calls/day':>10}{'turn med':>9}{'diag-only':>10}{'recalls':>8}{'cand':>5}")
        for r in rows:
            print(f"{r['sp_code']:<6}{r['visits_completed']:>7}{r['working_days']:>5}{str(r['calls_per_day'] or '—'):>10}{str(r['turnaround_median_days'] or '—'):>9}{str(r['diag_only_rate'] or '—'):>10}{r['recalls']:>8}{r['recall_candidates_open']:>5}")
        return 0
    if a.cmd == "batches":
        for b in db.fetchall("SELECT * FROM import_batch ORDER BY import_batch_id"):
            print(f"  #{b['import_batch_id']:<4} {b['source']:<3} {b['status']:<7} {b['imported_at']}  {b['file_name']}  rows={b['row_count']} sv={b['sv_count']} +{b['created_count']} ~{b['updated_count']}")
        return 0
    return 1


def _run_import(mod, db, path, now, **kw) -> int:
    try:
        res = mod.import_file(db, path, now=now, **kw)
    except mod.AlreadyImported as e:
        print(f"already imported: {e}"); return 0
    print(res.summary())
    return 0


def _tech(db, code):
    t = db.fetchone("SELECT * FROM tech WHERE sp_code=?", (code.upper(),))
    if not t:
        raise SystemExit(f"no tech {code}")
    return t


def _day_cmd(db, a, now) -> int:
    t = _tech(db, a.tech)
    if a.sub == "show":
        print(json.dumps(capacity.day_summary(db, t["tech_id"], a.date), indent=1, default=str)); return 0
    if a.sub == "close":
        if a.through:
            n = capacity.close_range(db, t["tech_id"], a.date, a.through, a.reason, a.user, now=now); print(f"{t['sp_code']}: {n} day(s) closed · {a.reason}")
        else:
            capacity.set_day(db, t["tech_id"], a.date, False, a.reason, a.user, now=now); print(f"{t['sp_code']} {a.date} closed · {a.reason}")
    elif a.sub == "open":
        capacity.set_day(db, t["tech_id"], a.date, True, "open_day", a.user, now=now); print(f"{t['sp_code']} {a.date} opened — behaves like any other day")
    elif a.sub == "adjust":
        v = capacity.adjust_day(db, t["tech_id"], a.date, a.minutes, a.user, now=now); print(f"{t['sp_code']} {a.date}: capacity {v:+d} min")
    elif a.sub == "block":
        bid = capacity.add_block(db, t["tech_id"], a.date, a.start, a.end, a.label, a.user, now=now); print(f"block #{bid}: {a.label} {a.start}–{a.end} on {t['sp_code']} {a.date}")
    db.commit(); return 0


def _recall_cmd(db, a, now) -> int:
    if a.sub == "list":
        rows = kpi.recalls(db, a.state)
        print(f"{len(rows)} recall rows")
        for r in rows:
            print(f"  #{r['recall_id']:<4} {r['state']:<10} {r['sv_number'] or '(no SV)':<14} after {r['original_sv'] or '—':<14} {str(r['days_between'] or '—'):>3} d  {r['sp_code'] or '-':<4} {r['basis']:<14} {r['display_name'] or ''}")
        return 0
    kpi.review_recall(db, a.recall_id, "confirmed" if a.sub == "confirm" else "dismissed", a.user, a.note, now=now)
    db.commit(); print(f"recall #{a.recall_id} {a.sub}ed"); return 0


def _sync_cmd(db, a) -> int:
    if a.sub == "list":
        items = sync.open_items(db, a.state)
        print(f"{len(items)} items")
        for it in items:
            print(f"  #{it['sync_id']:<5} {it['state']:<11} {it['kind']:<14} {it['sv_number'] or '(new)':<14} {it['created_at']}  mismatches={it['mismatch_count'] or 0}")
        return 0
    it = db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (a.sync_id,))
    if not it:
        print("no such sync item"); return 1
    if a.sub == "show":
        print(it["packet_text"]); print(); print("state:", it["state"], "| ePASS values:", it["epass_values"] or "-"); return 0
    if a.sub == "keyed":
        sync.mark_keyed(db, a.sync_id, a.user)
    elif a.sub == "reissue":
        sync.resolve(db, a.sync_id, "reissue", a.user)
    elif a.sub == "accept":
        sync.resolve(db, a.sync_id, "accept_epass", a.user)
    db.commit()
    print(f"#{a.sync_id} -> {db.fetchone('SELECT state FROM sync_item WHERE sync_id=?', (a.sync_id,))['state']}")
    return 0


def _stats(db):
    print("jobs by status:")
    for r in db.fetchall("SELECT status, COUNT(*) n, SUM(CASE WHEN stale=1 THEN 1 ELSE 0 END) stale FROM job WHERE closed_at IS NULL GROUP BY status ORDER BY n DESC"):
        print(f"  {r['status'] or '-':<10} {r['n']:>4}{('  stale ' + str(r['stale'])) if r['stale'] else ''}")
    print("open visits by tech (SO1/SO6 with a date):")
    for r in db.fetchall("SELECT t.sp_code, COUNT(*) n FROM job j LEFT JOIN tech t ON t.tech_id=j.assigned_tech_id WHERE j.status IN ('SO1','SO6') AND j.route_date IS NOT NULL AND j.stale=0 GROUP BY t.sp_code ORDER BY n DESC"):
        print(f"  {r['sp_code'] or '-':<6} {r['n']:>4}")
    print("sync queue:", {r['state']: r['n'] for r in db.fetchall("SELECT state, COUNT(*) n FROM sync_item GROUP BY state")})
    print("needs intake review:", db.scalar("SELECT COUNT(*) FROM job WHERE needs_intake_review=1 AND closed_at IS NULL"))
    print("zones needing review:", [r["zone_code"] for r in db.fetchall("SELECT zone_code FROM zone WHERE needs_review=1")])
    print("outbox unhandled:", db.scalar("SELECT COUNT(*) FROM outbox WHERE handled_at IS NULL"))


if __name__ == "__main__":
    sys.exit(main())
