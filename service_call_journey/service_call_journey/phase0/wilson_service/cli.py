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

from . import __version__, capacity, intake, kpi, placement, schema, seed, serve, statuses, stuck, sync, watcher
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
    # 9/14 — placement, pencil, queue-copy intake, shadow test
    p = sub.add_parser("intake", help="copy one live Service Request Queue row in (JSON file, or - for stdin)"); p.add_argument("path"); p.add_argument("--user", default="queue_copy")
    p = sub.add_parser("attach", help="attach/merge an ePASS SV onto a request"); p.add_argument("job_id", type=int); p.add_argument("sv_number"); p.add_argument("--user", default=os.environ.get("USERNAME") or "office")
    p = sub.add_parser("suggest", help="where the engine would place a job, and why"); p.add_argument("job_id", type=int); p.add_argument("--earliest")
    p = sub.add_parser("offer", help="the dates the customer would be shown, best fit first"); p.add_argument("job_id", type=int)
    p = sub.add_parser("pencil", help="(re)run the SO4 auto-pencil for one job or --all"); p.add_argument("job_id", type=int, nargs="?"); p.add_argument("--all", action="store_true"); p.add_argument("--user", default="engine")
    p = sub.add_parser("set-eta", help="Kezia: record the part ETA on a job (runs the pencil)"); p.add_argument("job_id", type=int); p.add_argument("eta", help="yyyy-mm-dd"); p.add_argument("--user", default="KKD")
    p = sub.add_parser("shadow-report", help="suggested vs actual placement, mirror health, what to look at this morning"); p.add_argument("--since")
    p = sub.add_parser("serve", help="HTTP shim for the queue-copy button and suggest/offer/board reads"); p.add_argument("--port", type=int); p.add_argument("--host", default="127.0.0.1")
    p = sub.add_parser("load-history", help="one-off load of the ePASS back catalogue (§1.4)")
    p.add_argument("--history", required=True, help="SV_HISTORY csv — Invoice Maintenance with no status filter")
    p.add_argument("--customers", help="MAIN Customer Contact Info csv — load this first for the best match rate")
    p = sub.add_parser("load-full", help="load the seven-file ODBC export (§1.6) — run after load-history")
    p.add_argument("--dir", required=True, help="folder holding 01_Customers.csv … 07_Service_Labor.csv")
    p = sub.add_parser("call", help="everything about one past call: complaint, what was done, parts, labor")
    p.add_argument("sv")
    p = sub.add_parser("model", help="Model Insight: this exact model, its family, the brand's product type")
    p.add_argument("brand"); p.add_argument("model"); p.add_argument("--limit", type=int, default=15)
    p = sub.add_parser("customer", help="look a household up the way the office would: phone, name, address, serial or SV")
    p.add_argument("term"); p.add_argument("--full", action="store_true", help="every visit, not just the last ten")

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
    if a.cmd == "intake":
        payload = json.load(sys.stdin if a.path == "-" else open(a.path, encoding="utf-8"))
        res = intake.from_queue(db, payload, now=now, actor_id=a.user); db.commit()
        print(json.dumps(res, indent=1, default=str)); return 0
    if a.cmd == "attach":
        res = intake.attach_sv(db, a.job_id, a.sv_number, a.user, now=now); db.commit()
        print(json.dumps(res)); return 0
    if a.cmd == "suggest":
        _print_cands(placement.suggest(db, a.job_id, earliest=a.earliest, now=now)); return 0
    if a.cmd == "offer":
        for c in placement.offer(db, a.job_id, now=now):
            print(f"  {'★ ' if c['recommended'] else '  '}{c['date']} {c['window']}  {c['sp_code']:<4} cost {c['cost']:>4}  {c['label'] or ''}  — {c['why']}")
        return 0
    if a.cmd == "pencil":
        if a.all:
            n = placement.repencil_all(db, a.user, now=now); db.commit(); print(f"{n} job(s) penciled"); return 0
        res = placement.pencil(db, a.job_id, a.user, now=now); db.commit()
        print(json.dumps(res, indent=1, default=str) if res else "no pencil (status not SO4/SO4B/SO4H, no ETA, or nothing fits)"); return 0
    if a.cmd == "set-eta":
        job = db.fetchone("SELECT status FROM job WHERE job_id=?", (a.job_id,))
        if not job:
            print("no such job"); return 1
        if job["status"] in ("SO3", "SO3PRE"):
            statuses.transition(db, a.job_id, "po.placed", "staff", a.user, now=now, eta=a.eta)
        elif job["status"] in ("SO4", "SO4B", "SO4H", "SO4PRE"):
            statuses.transition(db, a.job_id, "po.eta_changed", "staff", a.user, now=now, eta=a.eta)
        else:
            print(f"job is {job['status']} — ETA applies to SO3/SO4 jobs"); return 1
        db.commit(); j = db.fetchone("SELECT status, parts_eta, penciled_date, penciled_tech_id, pencil_reason FROM job WHERE job_id=?", (a.job_id,))
        print(json.dumps(j, default=str)); return 0
    if a.cmd == "shadow-report":
        _shadow_report(db, a.since, now); return 0
    if a.cmd == "serve":
        serve.run(db, a.port, a.host); return 0
    if a.cmd == "load-history":
        from .importers import history as _h
        res = _h.load_files(db, a.history, a.customers, now=now.isoformat(timespec="seconds"))
        db.conn.commit()
        print(f"tickets {res.tickets:,}  customers {res.customers:,} ({res.customers_created:,} created from tickets)"
              f"  payers {res.payers:,}  appliances {res.assets:,}")
        tot = sum(res.by_identity.values()) or 1
        for k in ("epass_code", "address_zip", "surname_zip", "unmatched"):
            n = res.by_identity.get(k, 0)
            print(f"  {k:<12} {n:>7,}  {n / tot * 100:5.1f}%")
        print(f"  addresses with more than one ePASS account: {res.duplicate_households:,} (shown, never merged)")
        return 0
    if a.cmd == "load-full":
        from .importers import fullexport as _f
        res = _f.load_dir(db, a.dir, now=now.isoformat(timespec="seconds"))
        db.conn.commit()
        for k, v in res.counts.items():
            print(f"  {k:<26} {v:>9,}")
        return 0
    if a.cmd == "call":
        from .importers import fullexport as _f
        x = _f.call_detail(db, a.sv)
        c = x["call"]
        if not c:
            print(f"no record of {a.sv}"); return 1
        print(f"{a.sv}   {c.get('brand_code') or ''} {c.get('model') or ''}   s/n {c.get('serial') or '—'}"
              f"   [{c.get('product_code') or '?'}]")
        print(f"  created {c.get('created_date') or '?'}   tech {c.get('sp_code') or '—'}"
              f"   ${float(c.get('total') or 0):,.2f}   {c.get('in_warranty') or ''}")
        if c.get("complaint_desc"):
            print(f"  COMPLAINT  {c['complaint_desc']}")
        if c.get("performed_desc"):
            print(f"  PERFORMED  {c['performed_desc']}")
        if x["parts"]:
            print("  parts:")
            for q in x["parts"]:
                print(f"     {(q['item_code'] or ''):<16}{(q['item_desc'] or '')[:40]:<42}"
                      f" qty {q['qty_shipped'] or 0:g}  ${float(q['selling_price'] or 0):>8,.2f}"
                      f"{'  installed' if q['installed'] else ''}")
        if x["labor"]:
            print("  labor:")
            for q in x["labor"]:
                print(f"     {q['service_date'] or '':<11} {(q['tech_name'] or q['tech_code'] or ''):<20}"
                      f" {(q['labor_desc'] or '')[:40]:<42} ${float(q['line_total'] or 0):>8,.2f}")
        return 0
    if a.cmd == "model":
        from .importers import fullexport as _f
        x = _f.model_insight(db, a.brand, a.model, limit=a.limit)
        fam = x["family"]
        print(f"{a.brand} {a.model} — {x['total_calls']:,} calls on this exact model · "
              f"{fam['total_calls']:,} in the {fam['stem']} family ({len(fam['models'])} models, {fam['rule']}) · "
              f"{x['product_type_calls']:,} {a.brand} {x['product_code'] or 'of this type'}")
        if fam["models"][:8]:
            print("  family:", " · ".join(f"{m['model']} ({m['n']})" for m in fam["models"][:8]))
        if fam["parts"]:
            print("  parts most often installed across the family:")
            for q in fam["parts"][:6]:
                print(f"     x{q['n']:<4} {(q['item_desc'] or '')[:46]:<48} {q['item_code'] or ''}")
        if x["parts"]:
            print("  parts most often installed:")
            for q in x["parts"]:
                print(f"     x{q['n']:<4} {(q['item_desc'] or '')[:46]:<48} {q['item_code'] or ''}")
        print("  recent calls:")
        for c in x["calls"]:
            print(f"     {c['created_date'] or '?':<11} {(c['sp_code'] or '--'):<5} ${float(c['total'] or 0):>8,.2f}"
                  f"  {(c['complaint_desc'] or '')[:64]}")
            if c.get("performed_desc"):
                print(f"{'':>19}-> {(c['performed_desc'])[:80]}")
        return 0
    if a.cmd == "customer":
        from .importers import history as _h
        hits = _h.search(db, a.term, limit=10)
        if not hits:
            print(f"nothing matches {a.term!r} — try a phone, surname, street, serial or SV"); return 1
        if len(hits) > 1:
            print(f"{len(hits)} matches:")
            for r in hits:
                flag = "  ⛔ DO NOT SERVICE" if r["do_not_service"] else ""
                print(f"  #{r['customer_id']:<7} {(r['display_name'] or ''):<32} {r['phone_primary'] or '':<16}"
                      f" {r['service_count'] or 0:>3} calls  last {r['last_service'] or '—'}{flag}")
            return 0
        _print_household(_h.household(db, hits[0]["customer_id"]), a.full)
        return 0
    return 1


def _print_household(h, full=False):
    c = h["customer"]
    print(f"{c['display_name']}   ePASS {c['epass_customer_code'] or '—'}   {c['phone_primary'] or 'no number'}")
    if c["do_not_service"]:
        print(f"  ⛔ DO NOT SERVICE — {c['do_not_service_note'] or 'no reason recorded'}")
    print(f"  {c['service_count'] or 0} calls, {c['first_service'] or '?'} to {c['last_service'] or '?'},"
          f" ${float(c['lifetime_value'] or 0):,.2f} lifetime")
    for a in h["also_at_address"]:
        print(f"  also at this address: #{a['customer_id']} {a['display_name']} ({a['service_count']} calls) — not merged")
    if h["assets"]:
        print("  appliances:")
        for a in h["assets"]:
            same = f"  (probably the same unit as {len(a['same_as'])} other)" if a.get("same_as") else ""
            print(f"    {(a['brand'] or '?'):<8} {(a['model'] or '?'):<18} s/n {a['serial']:<18}"
                  f" {a['service_count']} call(s) {a['first_seen'] or '?'}–{a['last_seen'] or '?'}{same}")
    rows = h["history"] if full else h["history"][:10]
    print(f"  history ({len(h['history'])} rows{'' if full else ', newest 10 — use --full for all'}):")
    for x in rows:
        print(f"    {x['created_date'] or '?':<11} {(x['epass_status'] or ''):<7} {x['sv_number']:<13}"
              f" {(x['sp_code'] or '--'):<5} ${float(x['total'] or 0):>9,.2f}  {(x['payer_name'] or '')[:22]:<22}"
              f" via {x['identity_source']}")


def _print_cands(cands):
    if not cands:
        print("  nothing fits in the horizon"); return
    for c in cands:
        print(f"  {c['rank']}. {c['date']} {c['window']}  {c['sp_code']:<4} cost {c['cost']:>4}  — {c['why']}")


def _shadow_report(db, since, now):
    """The morning check for the shadow test (spec v1.3 §14.4)."""
    last = db.fetchone("SELECT imported_at, file_name, sv_count, created_count, updated_count FROM import_batch WHERE status='ok' ORDER BY imported_at DESC")
    print(f"Shadow report · {now:%a %b %d %H:%M}")
    print(f"  last good import: {last['imported_at'] if last else '—'}  {last['file_name'] if last else ''}  (sv {last['sv_count'] if last else 0}, +{last['created_count'] if last else 0}, ~{last['updated_count'] if last else 0})")
    rows = db.fetchall("SELECT status, COUNT(*) AS n FROM job WHERE in_feed=1 GROUP BY status ORDER BY status")
    print("  in feed by status: " + ", ".join(f"{r['status']} {r['n']}" for r in rows))
    disc = db.scalar("SELECT COUNT(*) FROM sync_item WHERE state='discrepancy'")
    pend = db.scalar("SELECT COUNT(*) FROM sync_item WHERE state='pending'")
    st = db.scalar("SELECT COUNT(*) FROM job WHERE stale=1 AND closed_at IS NULL")
    since24 = (now - _dt.timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
    rev = db.scalar("SELECT COUNT(*) FROM job WHERE needs_intake_review=1 AND closed_at IS NULL AND created_at>=?", (since24,))
    print(f"  discrepancies {disc} · packets pending {pend} · stale visit tickets {st} · new SVs from ePASS in the last 24h awaiting intake review {rev}")
    reqs = db.fetchall("SELECT j.job_id, j.status, j.sv_number, j.created_at, c.display_name FROM job j LEFT JOIN customer c ON c.customer_id=j.customer_id "
                       "WHERE j.source_ref LIKE 'queue:%' AND j.closed_at IS NULL ORDER BY j.created_at DESC")
    print(f"  copied from the live queue: {len(reqs)} · still without an SV: {sum(1 for r in reqs if not r['sv_number'])}")
    for r in reqs[:8]:
        print(f"     #{r['job_id']:<5} {r['status']:<8} {r['sv_number'] or '(no SV yet)':<14} {str(r['created_at'])[:16]}  {r['display_name'] or ''}")
    sc = placement.scorecard(db, since)
    if sc["decided"]:
        print(f"  placement: {sc['decided']} decided of {sc['suggested']} suggested · same day {sc['agree_day']} ({sc['agree_day'] * 100 // sc['decided']}%) · "
              f"same tech {sc['agree_tech']} ({sc['agree_tech'] * 100 // sc['decided']}%) · both {sc['agree_both']}")
        for m in sc["misses"][:10]:
            print(f"     miss  {m['sv'] or '(no SV)':<14} {m['kind']:<7} suggested {m['suggested']:<16} actual {m['actual']:<16} — {m['why']}")
    else:
        print(f"  placement: {sc['suggested']} suggested, none decided yet")
    pen = db.fetchall("SELECT j.sv_number, j.penciled_date, j.parts_eta, t.sp_code, c.display_name FROM job j JOIN tech t ON t.tech_id=j.penciled_tech_id "
                      "LEFT JOIN customer c ON c.customer_id=j.customer_id WHERE j.penciled_date IS NOT NULL AND j.closed_at IS NULL ORDER BY j.penciled_date")
    print(f"  penciled installs: {len(pen)}")
    for r in pen[:8]:
        print(f"     {r['sv_number'] or '(no SV)':<14} ETA {r['parts_eta']} → penciled {r['penciled_date']} {r['sp_code']}  {r['display_name'] or ''}")


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
