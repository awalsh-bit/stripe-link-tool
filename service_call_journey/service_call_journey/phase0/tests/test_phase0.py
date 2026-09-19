"""Phase 0 acceptance tests (stdlib unittest, in-memory SQLite).

Run from the phase0 folder:   python -m unittest -v
Reference CSVs (tech_roster, zone_table, zip_zone_tech) and the two real export files are read
from ../reference (the repo layout) or from $WILSON_REFERENCE_DIR.
"""
from __future__ import annotations

import csv
import datetime as _dt
import json
import os
import shutil
import tempfile
import unittest

from wilson_service import findings, schema, seed, statuses, stuck, sync
from wilson_service.db import DB
from wilson_service.importers import dispatchtrack, exportinvoice
from wilson_service.importers.common import parse_order_detail, warranty_flags, clean_phone, split_name

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.environ.get("WILSON_REFERENCE_DIR") or os.path.normpath(os.path.join(HERE, "..", "..", "reference"))
DT_FILE = os.path.join(REF, "data", "DispatchTrackDetail_20260910_220003.csv")
EI_FILE = os.path.join(REF, "data", "ExportInvoice_20260910_222420.xlsx")
NOW = _dt.datetime(2026, 9, 10, 22, 5)

DT_HEADER = ("Order Number,Bill Name,Bill Address1,Bill Address2,Bill City,Bill State,Bill Zip,Phone1,Model,Description,Quantity,Delivery Date,Delivery Type,"
             "Customer Code,Ship Name,Ship Address1,Ship Address2,Ship City,Ship State,Ship Zip,Phone2,Phone3,Email,Deliver Quantity,Amount,Delivery Charges,Taxes,"
             "Service Time,Cube,Truck,Account,Request Start Time,Request End Time,Order Detail,Number,Comment1,Comment2,Comment3,Latitude,Longitude,Unload Time,Balance,"
             "Map Zone,Priorites,Installation Estimate,Points,Scheduled Window Start Time,Scheduled Window End Time,Job Status,Location,Directions,Qualifications,"
             "LaborRateCode,Serial#,Salesperson,Branch,SalespersonEmail,ProductCode,Color,").split(",")


def fresh_db() -> DB:
    db = DB.sqlite(":memory:")
    db.init_schema()
    seed.seed_all(db, REF)
    return db


def write_dt(path: str, orders: list[dict]) -> None:
    """Write a minimal DispatchTrack snapshot. Each order dict may override any header column."""
    with open(path, "w", newline="", encoding="cp1252") as f:
        w = csv.DictWriter(f, fieldnames=DT_HEADER, extrasaction="ignore")
        w.writeheader()
        for o in orders:
            row = {h: "" for h in DT_HEADER}
            row.update({"Delivery Type": "SV", "Account": "SV", "Service Time": "30", "Qualifications": "APPL", "Ship State": "TX", "Bill State": "TX"})
            row.update(o)
            w.writerow(row)


class T00Schema(unittest.TestCase):
    def test_ddl_both_dialects(self):
        s = schema.ddl("sqlite")
        m = schema.ddl("mssql")
        self.assertIn("CREATE TABLE IF NOT EXISTS job", s)
        self.assertIn("IF OBJECT_ID('dbo.job','U') IS NULL", m)
        self.assertIn("INT IDENTITY(1,1) PRIMARY KEY", m)
        self.assertIn("CREATE UNIQUE INDEX ux_job_sv_number ON dbo.job(sv_number) WHERE sv_number IS NOT NULL", m)
        # The rule is that COLUMN NAMES avoid T-SQL reserved words, so that the same application SQL
        # runs unquoted on both engines. Test the names themselves — matching " date " against the
        # rendered DDL also catches the *type* of a trailing date column, which is a false positive.
        RESERVED = {"key", "date", "at", "trigger", "user", "order", "index", "table", "column",
                    "check", "primary", "foreign", "group", "having", "select", "from", "where"}
        for table, cols in schema.TABLES.items():
            for c in cols:
                self.assertNotIn(c[0].lower(), RESERVED, f"{table}.{c[0]} is a T-SQL reserved word")

    def test_seed(self):
        db = fresh_db()
        self.assertGreaterEqual(db.scalar("SELECT COUNT(*) FROM status_def"), 30)
        self.assertGreaterEqual(db.scalar("SELECT COUNT(*) FROM tech"), 10)
        self.assertGreaterEqual(db.scalar("SELECT COUNT(*) FROM zone"), 30)
        self.assertGreaterEqual(db.scalar("SELECT COUNT(*) FROM zip_zone"), 50)
        self.assertEqual(db.setting("tax.rate"), 0.0825)
        self.assertEqual(db.setting("sync.mismatch_cycles_before_discrepancy"), 2)
        kjb = db.fetchone("SELECT * FROM tech WHERE sp_code='KJB'")
        self.assertIn("KJB2", kjb["aliases"] or "")
        self.assertIsNone(db.fetchone("SELECT 1 FROM tech WHERE sp_code='KJB2'"))
        # seed is idempotent
        again = seed.seed_all(db, REF)
        self.assertEqual(sum(again.values()), 0)


class T01Parsing(unittest.TestCase):
    def test_order_detail(self):
        d = parse_order_detail("REFRE LG LRFXC2606S 405KRQWKP980 SV There is a chip on the bottom/freezer door. 9/4/2024")
        self.assertEqual((d["category"], d["install_type"], d["brand"], d["model"], d["serial"]), ("refrigerator", "freestanding", "LG", "LRFXC2606S", "405KRQWKP980"))
        self.assertTrue(d["problem_text"].startswith("There is a chip"))
        d = parse_order_detail("WASHT SPEED TR7003WN 2201052021 WTY MADE PER JOHN")
        self.assertEqual((d["brand"], d["kind"]), ("SPEED", "WTY"))
        d = parse_order_detail("REBIF SZ IC 30FI-RH 581 476 0 SV Needs service sign on")
        self.assertEqual(d["install_type"], "built_in")
        self.assertEqual(d["brand"], "SZ")
        self.assertEqual(parse_order_detail("")["raw_detail"], None)

    def test_flags_phones_names(self):
        self.assertEqual(warranty_flags("WTY,RCALL"), warranty_flags("WTYRCALL"))
        self.assertEqual(warranty_flags("  WTY"), ("WTY", 1))
        self.assertEqual(warranty_flags(None), (None, 0))
        self.assertEqual(clean_phone("(512) 970-8938 HIS"), "(512) 970-8938")
        self.assertEqual(clean_phone("830-456-6000 his c"), "(830) 456-6000")
        self.assertIsNone(clean_phone("JB ASSOC"))
        self.assertEqual(split_name("KELLI & KEVIN LASSITER"), ("Kelli & Kevin", "Lassiter", "Kelli & Kevin Lassiter"))


@unittest.skipUnless(os.path.exists(DT_FILE) and os.path.exists(EI_FILE), "real export files not present")
class T02RealFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = fresh_db()
        cls.tmp = tempfile.mkdtemp()
        cls.dt = dispatchtrack.import_file(cls.db, DT_FILE, now=NOW)
        cls.ei = exportinvoice.import_file(cls.db, EI_FILE, now=NOW + _dt.timedelta(minutes=25))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_dt_counts(self):
        r = self.dt
        self.assertEqual((r.rows, r.sv_rows, r.sv_orders), (2164, 709, 236))
        self.assertEqual((r.created, r.updated, r.unchanged), (236, 0, 0))
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM import_row_raw WHERE import_batch_id=?", (r.import_batch_id,)), 709)
        by = {x["epass_status"]: x["n"] for x in self.db.fetchall("SELECT epass_status, COUNT(*) n FROM job WHERE in_feed=1 GROUP BY epass_status")}
        self.assertEqual(by, {"SO1": 123, "SO4PRE": 2, "SO5": 44, "SO6": 67})
        j = self.db.fetchone("SELECT j.*, t.sp_code FROM job j LEFT JOIN tech t ON t.tech_id=j.assigned_tech_id WHERE sv_number='SV00109783'")
        self.assertEqual((j["epass_status"], j["status"], j["sp_code"], j["zone_code"], j["bin_location"], j["is_warranty"], j["source"], j["needs_intake_review"]),
                         ("SO5", "SO5", "JHM", "FBURG", "SV07", 1, "import", 1))
        self.assertEqual(j["route_date"], "2026-09-16")
        self.assertEqual(j["owner_tech_id"], j["assigned_tech_id"])  # install statuses: truck is the owner
        self.assertAlmostEqual(float(j["balance"]), 1008.89)
        u = self.db.fetchone("SELECT * FROM unit WHERE job_id=?", (j["job_id"],))
        self.assertEqual((u["brand"], u["model"], u["serial"]), ("LG", "LRFXC2606S", "405KRQWKP980"))
        a = self.db.fetchone("SELECT * FROM address WHERE address_id=?", (j["address_id"],))
        self.assertAlmostEqual(float(a["lat"]), 30.261211)
        c = self.db.fetchone("SELECT * FROM customer WHERE customer_id=?", (j["customer_id"],))
        self.assertEqual(c["display_name"], "Kelli & Kevin Lassiter")
        self.assertEqual(c["email"], "kelli_lassiter@hotmail.com")
        # every truck code resolved to a tech (VJ -> VWJ alias) except blank
        unresolved = self.db.fetchall("SELECT DISTINCT epass_tech_code FROM job WHERE in_feed=1 AND epass_tech_code IS NOT NULL AND assigned_tech_id IS NULL")
        self.assertEqual(unresolved, [])
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE in_feed=1 AND epass_tech_code='VWJ'"), 3)

    def test_ei_counts(self):
        r = self.ei
        self.assertEqual(r.rows, 657)
        self.assertEqual(r.created + r.updated + r.unchanged, 657)
        self.assertEqual(r.created, 657 - 230)  # 230 of the 236 DT orders are also in the invoice list
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job"), 236 + r.created)
        self.assertEqual(r.new_statuses, 3)  # QUOTE 2, CPU3, CPU5 are not in the seed vocabulary
        self.assertTrue(self.db.fetchone("SELECT 1 FROM status_def WHERE status='QUOTE 2' AND track='unknown'"))
        self.assertEqual(r.sync["followed"], 0)  # KJB2/VJ aliases must not look like tech changes
        j = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00122440'")
        self.assertEqual((j["epass_status"], j["payment_type"], j["epass_tech_code"], j["qualification"], j["job_type"]), ("SO1", "COD", "BLL", "HVAC", "hvac"))
        self.assertIsNone(j["epass_route_date"])  # 2027 placeholder is beyond the horizon = unscheduled
        self.assertEqual(j["epass_created_at"], "2026-07-27")
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE sv_number LIKE '%-1'"), self.db.scalar("SELECT COUNT(*) FROM import_row_raw WHERE import_batch_id=? AND order_number LIKE '%-1'", (r.import_batch_id,)))
        # a DT job also in EI: DT keeps the truck and date, EI adds total/created
        j = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00109783'")
        self.assertEqual((j["epass_tech_code"], j["epass_route_date"], j["in_feed"], j["epass_source"]), ("JHM", "2026-09-16", 1, "DT"))
        self.assertIsNotNone(j["total"])
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE epass_tech_code='KJB2'"), 0)

    def test_reimport_is_idempotent(self):
        copy = os.path.join(self.tmp, "DispatchTrackDetail_20260910_221503.csv")
        shutil.copy(DT_FILE, copy)
        r = dispatchtrack.import_file(self.db, copy, now=NOW + _dt.timedelta(minutes=30))
        self.assertEqual((r.created, r.updated, r.unchanged, r.dropped_from_feed), (0, 0, 236, 0))
        self.assertEqual(r.sync, {"confirmed": 0, "mismatched": 0, "discrepancies": 0, "reverse": 0, "followed": 0})
        with self.assertRaises(dispatchtrack.AlreadyImported):
            dispatchtrack.import_file(self.db, copy, now=NOW)
        with self.assertRaises(exportinvoice.AlreadyImported):
            exportinvoice.import_file(self.db, EI_FILE, now=NOW)
        ei_copy = os.path.join(self.tmp, "ExportInvoice_20260910_230000.xlsx")
        shutil.copy(EI_FILE, ei_copy)
        r2 = exportinvoice.import_file(self.db, ei_copy, now=NOW + _dt.timedelta(minutes=35))
        self.assertEqual((r2.created, r2.updated, r2.unchanged), (0, 0, 657))

    def test_stale_rule(self):
        # SO1/SO6 dated before today (with 18h grace) still open in the feed -> stale; nothing dated today or later is stale
        rows = stuck.stale_jobs(self.db)
        self.assertGreater(len(rows), 0)
        for r in rows:
            self.assertIn(r["epass_status"] or r["status"], ("SO1", "SO6"))
            self.assertLess(r["epass_route_date"] or r["route_date"], "2026-09-10")
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE stale=1 AND route_date >= '2026-09-10'"), 0)
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE status IN ('SO1','SO6') AND route_date < '2026-09-10' AND stale=0"), 0)

    def test_batches_logged(self):
        b = self.db.fetchall("SELECT * FROM import_batch ORDER BY import_batch_id")
        self.assertEqual([x["status"] for x in b][:2], ["ok", "ok"])
        self.assertEqual(b[0]["sv_count"], 236)
        self.assertEqual(b[1]["row_count"], 657)


class T03UpsertRules(unittest.TestCase):
    """The 'dashboard owns' list (spec §3.4) with a tiny hand-made snapshot."""

    def setUp(self):
        self.db = fresh_db()
        self.tmp = tempfile.mkdtemp()
        self.order = {"Order Number": "SV00900001", "Ship Name": "GARY & KAREN JONES", "Ship Address1": "1211 GREEN HILLS DR", "Ship City": "DRIPPING SPRINGS", "Ship Zip": "78620",
                      "Phone2": "(512) 555-0101", "Email": "gk@example.com", "Customer Code": "5125550101", "Delivery Date": "9/14/2026", "Truck": "DLA", "Map Zone": "DS",
                      "Latitude": "30.19", "Longitude": "-98.08", "Balance": "0", "Job Status": "SO1", "Directions": "Gate 4411", "Qualifications": "APPL",
                      "Order Detail": "DISHW BOSCH SHPM88Z75N FD0101 SV Standing water in bottom"}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def snap(self, name, orders, now):
        p = os.path.join(self.tmp, name)
        write_dt(p, orders)
        return dispatchtrack.import_file(self.db, p, now=now)

    def test_create_then_preserve_dashboard_fields(self):
        r = self.snap("DispatchTrackDetail_20260911_080000.csv", [self.order], _dt.datetime(2026, 9, 11, 8))
        self.assertEqual(r.created, 1)
        j = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00900001'")
        self.assertEqual((j["status"], j["route_date"], j["source"], j["needs_intake_review"], j["zone_code"], j["booking_mode"]), ("SO1", "2026-09-14", "import", 1, "DS", "open"))
        a = self.db.fetchone("SELECT * FROM address WHERE address_id=?", (j["address_id"],))
        self.assertEqual(a["access_notes"], "Gate 4411")
        u = self.db.fetchone("SELECT * FROM unit WHERE job_id=?", (j["job_id"],))
        self.assertEqual((u["category"], u["install_type"], u["brand"]), ("dishwasher", "built_in", "BOSCH"))

        # the dashboard takes over: tech ran the diag and field-quoted; office moved the route; import must not touch any of it
        tdp = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='TDP'")["tech_id"]
        self.db.update("job", {"job_id": j["job_id"]}, {"status": "SO3", "route_date": "2026-09-15", "assigned_tech_id": tdp, "owner_tech_id": tdp, "route_sequence": 2,
                                                       "promised_window_start": "2026-09-15 08:00:00", "source": "dashboard"})
        self.db.update("address", {"address_id": a["address_id"]}, {"access_notes": "Gate 4411 - dog in yard", "lat": 30.2, "lng": -98.1})
        o2 = dict(self.order, **{"Job Status": "SO6", "Delivery Date": "9/16/2026", "Truck": "JRC", "Balance": "382.27", "Location": "SV03", "Priorites": "RCALL", "Directions": "changed in ePASS", "Latitude": "31.0"})
        r2 = self.snap("DispatchTrackDetail_20260911_081500.csv", [o2], _dt.datetime(2026, 9, 11, 8, 15))
        self.assertEqual((r2.created, r2.updated), (0, 1))
        j2 = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00900001'")
        # import-owned fields moved
        self.assertEqual((j2["epass_status"], j2["epass_route_date"], j2["epass_tech_code"], j2["bin_location"], j2["warranty_flags"]), ("SO6", "2026-09-16", "JRC", "SV03", "RCALL"))
        self.assertAlmostEqual(float(j2["balance"]), 382.27)
        # dashboard-owned fields untouched
        self.assertEqual((j2["status"], j2["route_date"], j2["assigned_tech_id"], j2["owner_tech_id"], j2["route_sequence"], j2["promised_window_start"]),
                         ("SO3", "2026-09-15", tdp, tdp, 2, "2026-09-15 08:00:00"))
        a2 = self.db.fetchone("SELECT * FROM address WHERE address_id=?", (j["address_id"],))
        self.assertEqual(a2["access_notes"], "Gate 4411 - dog in yard")
        self.assertAlmostEqual(float(a2["lat"]), 30.2)
        # and because nothing in the sync queue explains ePASS saying SO6/9-16/JRC, a reverse discrepancy is raised for the office
        self.assertEqual(r2.sync["reverse"], 1)
        d = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND state='discrepancy'", (j["job_id"],))
        self.assertEqual(json.loads(d["epass_values"]), {"status": "SO6", "route_date": "2026-09-16", "tech": "JRC"})
        self.assertIn("STATUS: SO3", d["packet_text"])
        # a third identical snapshot does not raise a second one
        r3 = self.snap("DispatchTrackDetail_20260911_083000.csv", [o2], _dt.datetime(2026, 9, 11, 8, 30))
        self.assertEqual((r3.updated, r3.sync["reverse"]), (0, 0))

    def test_import_job_follows_epass_until_dashboard_touches_it(self):
        self.snap("DispatchTrackDetail_20260911_080000.csv", [self.order], _dt.datetime(2026, 9, 11, 8))
        o2 = dict(self.order, **{"Job Status": "SO6", "Delivery Date": "9/18/2026", "Truck": "TDP"})
        r2 = self.snap("DispatchTrackDetail_20260911_081500.csv", [o2], _dt.datetime(2026, 9, 11, 8, 15))
        self.assertEqual((r2.sync["followed"], r2.sync["reverse"]), (1, 0))
        j = self.db.fetchone("SELECT j.*, t.sp_code FROM job j LEFT JOIN tech t ON t.tech_id=j.assigned_tech_id WHERE sv_number='SV00900001'")
        self.assertEqual((j["status"], j["route_date"], j["sp_code"]), ("SO6", "2026-09-18", "TDP"))
        h = self.db.fetchall("SELECT * FROM status_history WHERE job_id=? ORDER BY history_id", (j["job_id"],))
        self.assertEqual([x["trigger_event"] for x in h], ["import.create", "epass_follow"])

    def test_dropped_from_feed_and_unknown_zone(self):
        o = dict(self.order, **{"Map Zone": "NEWZN"})
        r = self.snap("DispatchTrackDetail_20260911_080000.csv", [o], _dt.datetime(2026, 9, 11, 8))
        self.assertEqual(r.new_zones, 1)
        z = self.db.fetchone("SELECT * FROM zone WHERE zone_code='NEWZN'")
        self.assertEqual((z["booking_mode"], z["needs_review"]), ("office_only", 1))
        r2 = self.snap("DispatchTrackDetail_20260911_081500.csv", [], _dt.datetime(2026, 9, 11, 8, 15))
        self.assertEqual(r2.dropped_from_feed, 1)
        self.assertEqual(self.db.fetchone("SELECT in_feed FROM job WHERE sv_number='SV00900001'")["in_feed"], 0)

    def test_failed_batch_is_recorded_and_nothing_applied(self):
        self.snap("DispatchTrackDetail_20260911_080000.csv", [self.order], _dt.datetime(2026, 9, 11, 8))
        missing = os.path.join(self.tmp, "DispatchTrackDetail_20260911_081500.csv")  # never written
        with self.assertRaises(FileNotFoundError):
            dispatchtrack.import_file(self.db, missing, now=_dt.datetime(2026, 9, 11, 8, 15))
        b = self.db.fetchone("SELECT * FROM import_batch WHERE file_name='DispatchTrackDetail_20260911_081500.csv'")
        self.assertEqual(b["status"], "failed")
        self.assertIn("FileNotFoundError", b["message"])
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job"), 1)
        self.assertEqual(self.db.fetchone("SELECT in_feed FROM job")["in_feed"], 1)  # the failed run did not drop anything from the feed
        # a corrected file with the same name can be imported later (failed batches do not block the name)
        write_dt(missing, [self.order])
        r = dispatchtrack.import_file(self.db, missing, now=_dt.datetime(2026, 9, 11, 8, 20), file_name="DispatchTrackDetail_20260911_081500_retry.csv")
        self.assertEqual(r.unchanged, 1)


class T04StatusEngine(unittest.TestCase):
    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 14, 8, 0)
        self.dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        self.tdp = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='TDP'")["tech_id"]
        self.job_id = statuses.create_request(
            self.db, customer={"name": "Gary & Karen Jones", "phone": "512-555-0101", "email": "gk@example.com", "contact_pref": "text"},
            address={"line1": "1211 Green Hills Dr", "city": "Dripping Springs", "zip": "78620", "gate_code": "4411"},
            unit={"category": "dishwasher", "install_type": "built_in", "brand": "Bosch", "model": "SHPM88Z75N"},
            problem_text="Standing water in the bottom after every cycle", card_saved=True, now=self.now)

    def job(self):
        return self.db.fetchone("SELECT * FROM job WHERE job_id=?", (self.job_id,))

    def test_request_to_booked_to_field_approved(self):
        j = self.job()
        self.assertEqual((j["status"], j["zone_code"], j["source"], j["sv_number"]), ("REQ", "DS", "dashboard", None))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:request_received'", (self.job_id,)))
        # customer picks a window -> SO1 + create_ticket packet
        r = statuses.transition(self.db, self.job_id, "customer.picked_window", "customer", "web", route_date="2026-09-16", window="AM", tech_id=self.dla, now=self.now)
        self.assertEqual((r["from"], r["to"], r["rule"]), ("REQ", "SO1", 2))
        j = self.job()
        self.assertEqual((j["route_date"], j["assigned_tech_id"], j["promised_window_start"]), ("2026-09-16", self.dla, "2026-09-16 08:00:00"))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND kind='create_ticket'", (self.job_id,))
        self.assertEqual(item["state"], "pending")
        self.assertIn("NEW TICKET  Gary & Karen Jones", item["packet_text"])
        self.assertIn("STATUS: SO1   DATE: 9/16/2026   WINDOW: 8–12   TECH: DLA", item["packet_text"])
        # guard: field approval without a signature is refused
        with self.assertRaises(statuses.GuardFailed):
            statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="field_quote", decision="approve", parts_count=1, signature=False, agree=True)
        self.assertEqual(self.job()["status"], "SO1")
        # with signature -> SO3, owner set, set_status packet with lines and the auto note
        lines = [{"code": "W10348269", "desc": "Drain pump", "qty": 1, "price": 148.00}, {"code": "LAB", "desc": "Drain Pump Replacement 1.5h", "qty": 1, "price": 195.00}]
        r = statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="field_quote", decision="approve", parts_count=1, signature=True, agree=True,
                                tech_id=self.dla, lines=lines, total=382.27, signed_at="9/14 8:52a", summary="Standing water; drain pump seized", labor_exempt=True, photo_count=3,
                                on_site_minutes=48, now=self.now + _dt.timedelta(hours=1))
        self.assertEqual((r["to"], r["rule"]), ("SO3", 4))
        j = self.job()
        self.assertEqual((j["owner_tech_id"], float(j["total"])), (self.dla, 382.27))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND kind='set_status'", (self.job_id,))
        self.assertEqual(item["packet_text"].splitlines()[1], "STATUS: SO3")
        self.assertIn("  W10348269    Drain pump  x1  $148.00", item["packet_text"])
        self.assertIn("NOTE: FIELD-APPROVED $382.27 signed 9/14 8:52a. Standing water; drain pump seized. Labor tax-exempt (built-in). Full findings + 3 photos: dashboard .", item["packet_text"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:approved_ordering'", (self.job_id,)))
        hist = [h["to_status"] for h in self.db.fetchall("SELECT * FROM status_history WHERE job_id=? ORDER BY history_id", (self.job_id,))]
        self.assertEqual(hist, ["REQ", "SO1", "SO3"])

    def test_decline_charges_diag_fee_and_quick_fix(self):
        statuses.transition(self.db, self.job_id, "staff.booked", "staff", "demitrius", route_date="2026-09-16", window="PM", tech_id=self.dla)
        r = statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="field_quote", decision="decline", tech_id=self.dla, note="too expensive")
        self.assertEqual(r["to"], "SO7")
        pay = self.db.fetchone("SELECT * FROM outbox WHERE job_id=? AND effect='payment:diag_fee'", (self.job_id,))
        self.assertEqual(json.loads(pay["payload"])["amount"], 169.95)
        # quick fix path on a second job
        j2 = statuses.create_request(self.db, customer={"name": "Lynn Osler", "phone": "512-555-0202"}, address={"line1": "10 Elm", "zip": "78704"}, card_saved=True)
        statuses.transition(self.db, j2, "staff.booked", "staff", "x", route_date="2026-09-16", window="AM", tech_id=self.tdp)
        r = statuses.transition(self.db, j2, "tech.findings_submitted", "tech", "TDP", outcome="quick_fix", tech_id=self.tdp)
        self.assertEqual(r["to"], "SO8")
        self.assertEqual(self.db.fetchone("SELECT owner_tech_id FROM job WHERE job_id=?", (j2,))["owner_tech_id"], self.tdp)

    def test_parts_flow_and_owner_only_install(self):
        statuses.transition(self.db, self.job_id, "staff.booked", "staff", "x", route_date="2026-09-16", window="AM", tech_id=self.dla)
        statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="office_quote", tech_id=self.dla, lines=[{"code": "P1", "desc": "part", "qty": 1, "price": 50}])
        self.assertEqual(self.job()["status"], "SO2")
        r = statuses.transition(self.db, self.job_id, "parts.verified", "staff", "noell", quote_kind="office")
        self.assertEqual(r["to"], "SO2.1")
        self.assertEqual(self.job()["status"], "SO2.2")  # rule 16 fires immediately
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:quote_sent'", (self.job_id,)))
        statuses.transition(self.db, self.job_id, "customer.approved", "customer", "web", lines=[{"code": "P1", "desc": "part", "qty": 1, "price": 50}], total=245.0)
        self.assertEqual(self.job()["status"], "SO3")
        r = statuses.transition(self.db, self.job_id, "po.placed", "staff", "noell", eta_days=14)
        self.assertEqual(r["to"], "SO4B")
        r = statuses.transition(self.db, self.job_id, "receiving.all_parts_in", "staff", "noell", bin_location="SV03")
        self.assertEqual((r["to"], self.job()["bin_location"]), ("SO5", "SV03"))
        # install must go to the owner (DLA); TDP is refused without a reason
        with self.assertRaises(statuses.GuardFailed):
            statuses.transition(self.db, self.job_id, "staff.booked", "staff", "demitrius", route_date="2026-09-22", window="AM", tech_id=self.tdp)
        r = statuses.transition(self.db, self.job_id, "staff.booked", "staff", "demitrius", route_date="2026-09-22", window="AM", tech_id=self.tdp, reason_code="owner_out_sick")
        self.assertEqual(r["to"], "SO6")
        r = statuses.transition(self.db, self.job_id, "tech.repair_complete", "tech", "TDP", all_parts_installed=True, total=245.0, on_site_minutes=40)
        self.assertEqual(r["to"], "SO8")
        r = statuses.transition(self.db, self.job_id, "payment.succeeded", "system", "stripe", amount=245.0, ref="pi_123")
        self.assertIsNotNone(self.job()["closed_at"])
        pp = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND kind='post_payment'", (self.job_id,))
        self.assertIn("PAYMENT: $245.00 card pi_123", pp["packet_text"])

    def test_manual_change_needs_reason_and_unknown_events_refused(self):
        with self.assertRaises(statuses.TransitionError):
            statuses.transition(self.db, self.job_id, "staff.manual_status", "staff", "cayden", to="SO5")
        r = statuses.transition(self.db, self.job_id, "staff.manual_status", "staff", "cayden", reason_code="data_fix", to="SO5")
        self.assertEqual((r["to"], r["rule"]), ("SO5", 35))
        with self.assertRaises(statuses.TransitionError):
            statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="field_quote", decision="approve", parts_count=1, signature=True, agree=True)
        with self.assertRaises(statuses.TransitionError):
            statuses.transition(self.db, self.job_id, "made.up.event", "staff", "x")
        r = statuses.transition(self.db, self.job_id, "customer.cancelled", "customer", "web", reason="moved")
        self.assertEqual((r["to"], self.job()["cancel_reason"]), ("SO9", "moved"))
        with self.assertRaises(statuses.TransitionError):  # SO9 is terminal for the cancel rule
            statuses.transition(self.db, self.job_id, "customer.cancelled", "customer", "web")

    def test_no_access_unbooks(self):
        statuses.transition(self.db, self.job_id, "staff.booked", "staff", "x", route_date="2026-09-16", window="AM", tech_id=self.dla)
        with self.assertRaises(statuses.GuardFailed):
            statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="no_access")
        r = statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="no_access", note="nobody home, called twice")
        self.assertEqual((r["to"], self.job()["route_date"]), ("SO1", None))


class T05SyncQueue(unittest.TestCase):
    def setUp(self):
        self.db = fresh_db()
        self.tmp = tempfile.mkdtemp()
        self.now = _dt.datetime(2026, 9, 14, 9, 0)
        self.dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        self.job_id = statuses.create_request(self.db, customer={"name": "Gary & Karen Jones", "phone": "(512) 555-0101"}, address={"line1": "1211 Green Hills Dr", "zip": "78620"},
                                              card_saved=True, now=self.now)
        statuses.transition(self.db, self.job_id, "customer.picked_window", "customer", "web", route_date="2026-09-16", window="AM", tech_id=self.dla, now=self.now)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def snap(self, name, orders, now):
        p = os.path.join(self.tmp, name)
        write_dt(p, orders)
        return dispatchtrack.import_file(self.db, p, now=now)

    def base_order(self, **kw):
        o = {"Order Number": "SV00123290", "Ship Name": "GARY & KAREN JONES", "Ship Address1": "1211 GREEN HILLS DR", "Ship Zip": "78620", "Phone2": "(512) 555-0101",
             "Delivery Date": "9/16/2026", "Truck": "DLA", "Map Zone": "DS", "Job Status": "SO1", "Order Detail": "DISHW BOSCH SHPM88Z75N FD0101 SV Standing water"}
        o.update(kw)
        return o

    def test_create_ticket_matched_by_phone_then_confirmed(self):
        item = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=?", (self.job_id,))
        self.assertEqual((item["kind"], item["state"], item["sv_number"]), ("create_ticket", "pending", None))
        sync.mark_keyed(self.db, item["sync_id"], "michael", now="2026-09-14 09:10:00")
        r = self.snap("DispatchTrackDetail_20260914_091500.csv", [self.base_order()], self.now + _dt.timedelta(minutes=15))
        self.assertEqual((r.created, r.attached), (0, 1))
        j = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (self.job_id,))
        self.assertEqual((j["sv_number"], j["status"], j["epass_status"], j["source"]), ("SV00123290", "SO1", "SO1", "dashboard"))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (item["sync_id"],))
        self.assertEqual((item["state"], item["sv_number"]), ("confirmed", "SV00123290"))
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job"), 1)  # no duplicate job created for the SV

    def test_keyed_then_mismatch_twice_becomes_discrepancy_then_accept(self):
        # attach the SV first
        self.snap("DispatchTrackDetail_20260914_091500.csv", [self.base_order()], self.now + _dt.timedelta(minutes=15))
        # tech field-approves -> SO3 set_status item
        statuses.transition(self.db, self.job_id, "tech.findings_submitted", "tech", "DLA", outcome="field_quote", decision="approve", parts_count=1, signature=True, agree=True,
                            tech_id=self.dla, lines=[{"code": "P", "desc": "pump", "qty": 1, "price": 148}], total=382.27, now=self.now + _dt.timedelta(hours=2))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND kind='set_status'", (self.job_id,))
        self.assertEqual(json.loads(item["payload"])["status"], "SO3")
        # DT cannot see SO3 (not an exported status) -> the job simply leaves the feed; the item stays open
        r = self.snap("DispatchTrackDetail_20260914_120000.csv", [], self.now + _dt.timedelta(hours=3))
        self.assertEqual(r.dropped_from_feed, 1)
        self.assertEqual(self.db.fetchone("SELECT state FROM sync_item WHERE sync_id=?", (item["sync_id"],))["state"], "pending")
        sync.mark_keyed(self.db, item["sync_id"], "michael")
        # but ePASS keeps showing SO1 in the feed (Michael keyed the wrong ticket): two cycles -> discrepancy
        r = self.snap("DispatchTrackDetail_20260914_121500.csv", [self.base_order()], self.now + _dt.timedelta(hours=3, minutes=15))
        self.assertEqual((r.sync["mismatched"], r.sync["discrepancies"]), (1, 0))
        r = self.snap("DispatchTrackDetail_20260914_123000.csv", [self.base_order()], self.now + _dt.timedelta(hours=3, minutes=30))
        self.assertEqual((r.sync["mismatched"], r.sync["discrepancies"]), (0, 1))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (item["sync_id"],))
        self.assertEqual((item["state"], json.loads(item["epass_values"])["status"]), ("discrepancy", "SO1"))
        self.assertEqual(r.sync["reverse"], 0)  # the open item explains the difference; no second item
        # re-issue -> pending again, then the office keys it and ePASS follows -> confirmed by the next EI-like snapshot
        sync.resolve(self.db, item["sync_id"], "reissue", "michael")
        self.assertEqual(self.db.fetchone("SELECT state, mismatch_count FROM sync_item WHERE sync_id=?", (item["sync_id"],))["state"], "pending")
        sync.mark_keyed(self.db, item["sync_id"], "michael")
        # simulate ePASS now at SO3 via a DT row (feed widened) -> confirmed
        r = self.snap("DispatchTrackDetail_20260914_124500.csv", [self.base_order(**{"Job Status": "SO3"})], self.now + _dt.timedelta(hours=3, minutes=45))
        self.assertEqual(r.sync["confirmed"], 1)
        self.assertEqual(self.db.fetchone("SELECT state FROM sync_item WHERE sync_id=?", (item["sync_id"],))["state"], "confirmed")

    def test_reverse_discrepancy_and_accept_epass(self):
        self.snap("DispatchTrackDetail_20260914_091500.csv", [self.base_order()], self.now + _dt.timedelta(minutes=15))
        # ePASS moves the date and tech with no dashboard event
        r = self.snap("DispatchTrackDetail_20260914_093000.csv", [self.base_order(**{"Delivery Date": "9/17/2026", "Truck": "TDP"})], self.now + _dt.timedelta(minutes=30))
        self.assertEqual(r.sync["reverse"], 1)
        d = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND state='discrepancy'", (self.job_id,))
        self.assertEqual(json.loads(d["epass_values"]), {"status": "SO1", "route_date": "2026-09-17", "tech": "TDP"})
        sync.resolve(self.db, d["sync_id"], "accept_epass", "demitrius")
        j = self.db.fetchone("SELECT j.*, t.sp_code FROM job j LEFT JOIN tech t ON t.tech_id=j.assigned_tech_id WHERE job_id=?", (self.job_id,))
        self.assertEqual((j["route_date"], j["sp_code"], j["status"]), ("2026-09-17", "TDP", "SO1"))
        self.assertEqual(self.db.fetchone("SELECT state FROM sync_item WHERE sync_id=?", (d["sync_id"],))["state"], "resolved")
        # next snapshot agrees -> nothing new
        r = self.snap("DispatchTrackDetail_20260914_094500.csv", [self.base_order(**{"Delivery Date": "9/17/2026", "Truck": "TDP"})], self.now + _dt.timedelta(minutes=45))
        self.assertEqual((r.sync["reverse"], r.updated), (0, 0))

    def test_so4pre_so6_lenient(self):
        self.snap("DispatchTrackDetail_20260914_091500.csv", [self.base_order()], self.now + _dt.timedelta(minutes=15))
        self.db.update("job", {"job_id": self.job_id}, {"status": "SO4PRE"})
        r = self.snap("DispatchTrackDetail_20260914_093000.csv", [self.base_order(**{"Job Status": "SO6"})], self.now + _dt.timedelta(minutes=30))
        self.assertEqual(r.sync["reverse"], 0)

    def test_packet_rendering_exact(self):
        p = {"status": "SO3", "route_date": "2026-09-16", "window": "AM", "tech": "DLA",
             "lines": [{"code": "W10348269", "desc": "Drain pump", "qty": 1, "price": 148}, {"code": "LAB", "desc": "Drain Pump Replacement 1.5h", "qty": 1, "price": 195}],
             "note": "FIELD-APPROVED $382.27 signed 9/14 8:52a. Standing water; drain pump seized. Labor tax-exempt (built-in). Full findings + 3 photos: dashboard SV00123290."}
        txt = sync.render_packet("SV00123290", "Gary & Karen Jones", "set_status", p)
        self.assertEqual(txt, "SV00123290  Gary & Karen Jones\nSTATUS: SO3   DATE: 9/16/2026   WINDOW: 8–12   TECH: DLA\nLINES:\n"
                              "  W10348269    Drain pump  x1  $148.00\n  LAB          Drain Pump Replacement 1.5h  x1  $195.00\n"
                              "NOTE: FIELD-APPROVED $382.27 signed 9/14 8:52a. Standing water; drain pump seized. Labor tax-exempt (built-in). Full findings + 3 photos: dashboard SV00123290.")
        self.assertEqual(sync.build_note(sv_number="SV1", summary="No power. Board dead", photo_count=2), "No power. Board dead. Full findings + 2 photos: dashboard SV1.")


class T06Stuck(unittest.TestCase):
    def test_thresholds(self):
        db = fresh_db()
        now = _dt.datetime(2026, 9, 14, 9, 0)
        j = statuses.create_request(db, customer={"name": "A B", "phone": "5125550303"}, address={"line1": "1 Main", "zip": "78620"}, card_saved=True, now=now - _dt.timedelta(hours=30))
        rows = stuck.stuck_jobs(db, now)
        self.assertEqual([r["job_id"] for r in rows], [j])  # REQ > 24h
        self.assertEqual(rows[0]["threshold_hours"], 24)
        statuses.transition(db, j, "staff.booked", "staff", "x", route_date="2026-09-15", window="AM", now=now)
        self.assertEqual(stuck.stuck_jobs(db, now), [])  # SO1 has no aging rule
        db.update("job", {"job_id": j}, {"status": "SO2.2", "status_changed_at": "2026-09-08 09:00:00"})
        self.assertEqual(stuck.stuck_jobs(db, now)[0]["threshold_hours"], 120)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class T07Feedback0911(unittest.TestCase):
    """Rules and tables added from the service team's 9/11 demo feedback."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 14, 9, 0)
        self.dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        self.jrc = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='JRC'")["tech_id"]

    def test_work_days_and_day_controls(self):
        from wilson_service import capacity
        self.assertEqual(self.db.fetchone("SELECT work_days FROM tech WHERE sp_code='JRC'")["work_days"], "Mon,Tue,Wed,Thu")
        self.assertTrue(capacity.is_open(self.db, self.jrc, "2026-09-17"))          # Thu
        self.assertFalse(capacity.is_open(self.db, self.jrc, "2026-09-18"))         # Fri closed by roster
        self.assertIn("not a working day", capacity.closed_reason(self.db, self.jrc, "2026-09-18"))
        capacity.set_day(self.db, self.jrc, "2026-09-18", True, "open_day", "demitrius", now=self.now)   # one click opens it
        self.assertTrue(capacity.is_open(self.db, self.jrc, "2026-09-18"))
        n = capacity.close_range(self.db, self.dla, "2026-09-21", "2026-09-25", "pto", "demitrius", now=self.now)
        self.assertEqual(n, 5)
        self.assertEqual(capacity.closed_reason(self.db, self.dla, "2026-09-23"), "pto")
        self.assertEqual(capacity.adjust_day(self.db, self.dla, "2026-09-14", 60, "demitrius", now=self.now), 60)
        bid = capacity.add_block(self.db, self.dla, "2026-09-14", "11:30", "12:15", "Van maintenance", "demitrius", now=self.now)
        s = capacity.day_summary(self.db, self.dla, "2026-09-14")
        self.assertEqual((s["capacity_adjust_min"], s["blocked_min"], s["capacity_min"], len(s["blocks"])), (60, 45, 600, 1))
        capacity.remove_block(self.db, bid, "demitrius", now=self.now)
        self.assertEqual(capacity.blocked_minutes(self.db, self.dla, "2026-09-14"), 0)
        self.assertGreaterEqual(self.db.scalar("SELECT COUNT(*) FROM audit_log WHERE action LIKE 'capacity.%'"), 5)
        with self.assertRaises(ValueError):
            capacity.add_block(self.db, self.dla, "2026-09-14", "13:00", "12:00", "bad", "x")

    def test_force_it(self):
        from wilson_service import capacity
        j = statuses.create_request(self.db, customer={"name": "Force Me", "phone": "5125550404"}, address={"line1": "2 Main", "zip": "78620"}, card_saved=True, now=self.now)
        capacity.force_onto_day(self.db, j, self.jrc, "2026-09-18", "demitrius", now=self.now)  # closed Friday, still allowed
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["assigned_tech_id"], job["route_date"]), (self.jrc, "2026-09-18"))
        self.assertIn("forced", job["flags"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM audit_log WHERE action='capacity.forced' AND entity_id=?", (str(j),)))

    def test_hold_check_and_release(self):
        j = statuses.create_request(self.db, customer={"name": "Erik Jennings", "phone": "5125550505"}, address={"line1": "305 Lakeway Dr", "zip": "78734"}, card_saved=True, now=self.now)
        for ev, kw in (("staff.booked", dict(route_date="2026-09-08", window="AM", tech_id=self.dla)),
                       ("tech.findings_submitted", dict(outcome="office_quote", tech_id=self.dla, lines=[{"code": "WH23X29541", "desc": "Water valve", "qty": 1, "price": 58}])),
                       ("parts.verified", dict(quote_kind="office")), ("customer.approved", dict(total=210.0)), ("po.placed", dict(eta_days=3)),
                       ("customer.held_date", dict(route_date="2026-09-15", window="PM", tech_id=self.dla))):
            statuses.transition(self.db, j, ev, "staff", "x", now=self.now, **kw)
        self.assertEqual(self.db.fetchone("SELECT status, route_date FROM job WHERE job_id=?", (j,))["status"], "SO4PRE")
        # T-2: parts not in -> flag + Kezia task, still SO4PRE
        r = statuses.transition(self.db, j, "timer.hold_check", "system", "timer", all_parts_received=False, now=self.now)
        self.assertEqual((r["to"], r["rule"]), ("SO4PRE", 22.1))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertIn("hold_at_risk", job["flags"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='task:hold_eta_check'", (j,)))
        # guard: if the parts are in, the check must not fire (rule 24 confirms instead)
        with self.assertRaises(statuses.GuardFailed):
            statuses.transition(self.db, j, "timer.hold_release", "system", "timer", all_parts_received=True)
        # T-1 14:00: release -> SO4, date gone, apology text, packet
        r = statuses.transition(self.db, j, "timer.hold_release", "system", "timer", all_parts_received=False, eta="2026-09-18", now=self.now)
        self.assertEqual(r["to"], "SO4")
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertIsNone(job["route_date"]); self.assertIsNone(job["promised_window_start"])
        self.assertNotIn("hold_at_risk", job["flags"] or "")
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:hold_released_apology'", (j,)))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM sync_item WHERE job_id=? AND kind='set_status' AND payload LIKE '%\"SO4\"%'", (j,)))
        # Kezia can also release early from her task
        statuses.transition(self.db, j, "customer.held_date", "customer", "web", route_date="2026-09-22", window="AM", tech_id=self.dla, now=self.now)
        r = statuses.transition(self.db, j, "staff.hold_time_out", "staff", "kezia", all_parts_received=False, eta="2026-09-25", now=self.now)
        self.assertEqual(r["to"], "SO4")

    def test_direct_ship_part_received(self):
        j = statuses.create_request(self.db, customer={"name": "Rosa Delgado", "phone": "5125550233"}, address={"line1": "7900 Lynnwood Trl", "zip": "78735"}, card_saved=True, now=self.now)
        statuses.transition(self.db, j, "staff.booked", "staff", "x", route_date="2026-09-08", window="AM", tech_id=self.dla, now=self.now)
        statuses.transition(self.db, j, "tech.findings_submitted", "tech", "DLA", outcome="office_quote", tech_id=self.dla, lines=[{"code": "P", "desc": "board", "qty": 1, "price": 180}], now=self.now)
        statuses.transition(self.db, j, "parts.verified", "staff", "noell", quote_kind="office", now=self.now)
        statuses.transition(self.db, j, "customer.approved", "customer", "web", total=390.0, now=self.now)
        r = statuses.transition(self.db, j, "po.placed", "staff", "noell", eta_days=4, ship_to="customer", now=self.now)
        self.assertEqual(r["to"], "SO4H")
        r = statuses.transition(self.db, j, "customer.part_received", "customer", "web", now=self.now)   # the tracker's "My part arrived" button
        self.assertEqual((r["to"], r["rule"]), ("SO5", 24.1))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["bin_location"], "CUST")
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:part_arrived_pick_time'", (j,)))
        # owner-only install picker still applies
        with self.assertRaises(statuses.GuardFailed):
            statuses.transition(self.db, j, "customer.picked_window", "customer", "web", route_date="2026-09-16", window="AM", tech_id=self.jrc)
        self.assertEqual(statuses.transition(self.db, j, "customer.picked_window", "customer", "web", route_date="2026-09-16", window="AM", tech_id=self.dla)["to"], "SO6")

    def test_recall_detection(self):
        from wilson_service import kpi
        # a completed repair on serial ZV184220G, finished 8/12, by DLA
        orig = statuses.create_request(self.db, customer={"name": "Nick & Sharon Hippe", "phone": "5125550110"}, address={"line1": "10008 Hillside North", "zip": "78736"},
                                       unit={"category": "washer", "install_type": "freestanding", "brand": "GE", "model": "GFW550SSNWW", "serial": "ZV184220G"}, card_saved=True,
                                       now=_dt.datetime(2026, 8, 10, 9))
        self.db.update("job", {"job_id": orig}, {"status": "SO8", "owner_tech_id": self.dla, "closed_at": "2026-08-12 15:00:00", "status_changed_at": "2026-08-12 15:00:00"})
        self.assertIsNone(self.db.fetchone("SELECT 1 FROM recall WHERE job_id=?", (orig,)))
        # same serial, 23 days later -> candidate against DLA
        new = statuses.create_request(self.db, customer={"name": "Nick & Sharon Hippe", "phone": "5125550110"}, address={"line1": "10008 Hillside North", "zip": "78736"},
                                      unit={"category": "washer", "install_type": "freestanding", "brand": "GE", "model": "GFW550SSNWW", "serial": "ZV184220G"}, card_saved=True,
                                      now=_dt.datetime(2026, 9, 4, 9))
        r = self.db.fetchone("SELECT * FROM recall WHERE job_id=?", (new,))
        self.assertEqual((r["state"], r["basis"], r["days_between"], r["tech_id"], r["original_job_id"]), ("candidate", "serial", 23, self.dla, orig))
        self.assertIn("recall_candidate", self.db.fetchone("SELECT flags FROM job WHERE job_id=?", (new,))["flags"])
        # same model at the same address but no serial -> model_address basis
        new2 = statuses.create_request(self.db, customer={"name": "Nick & Sharon Hippe", "phone": "5125550110"}, address={"line1": "10008 Hillside North", "zip": "78736"},
                                       unit={"category": "washer", "install_type": "freestanding", "brand": "GE", "model": "GFW550SSNWW"}, card_saved=True, now=_dt.datetime(2026, 9, 5, 9))
        self.assertEqual(self.db.fetchone("SELECT basis FROM recall WHERE job_id=?", (new2,))["basis"], "model_address")
        # outside the window -> nothing
        old = statuses.create_request(self.db, customer={"name": "Nick & Sharon Hippe", "phone": "5125550110"}, address={"line1": "10008 Hillside North", "zip": "78736"},
                                      unit={"category": "washer", "install_type": "freestanding", "brand": "GE", "model": "GFW550SSNWW", "serial": "ZV184220G"}, card_saved=True,
                                      now=_dt.datetime(2026, 10, 30, 9))
        self.assertIsNone(self.db.fetchone("SELECT 1 FROM recall WHERE job_id=?", (old,)))
        # manager review
        kpi.review_recall(self.db, r["recall_id"], "dismissed", "mark", "unrelated failure", now=self.now)
        self.assertEqual(self.db.fetchone("SELECT state FROM recall WHERE recall_id=?", (r["recall_id"],))["state"], "dismissed")
        self.assertNotIn("recall", self.db.fetchone("SELECT flags FROM job WHERE job_id=?", (new,))["flags"] or "")
        # listing joins names and SVs without error
        self.assertEqual(len(kpi.recalls(self.db)), 2)

    def test_epass_rcall_flag_is_a_confirmed_recall(self):
        from wilson_service import kpi
        j = statuses.create_request(self.db, customer={"name": "R Call", "phone": "5125550606"}, address={"line1": "9 Oak", "zip": "78620"}, card_saved=True, now=self.now)
        self.db.update("job", {"job_id": j}, {"warranty_flags": "RCALL", "assigned_tech_id": self.dla})
        self.db.execute("DELETE FROM recall WHERE job_id=?", (j,))
        rid = kpi.detect_recall(self.db, j, self.now)
        r = self.db.fetchone("SELECT * FROM recall WHERE recall_id=?", (rid,))
        self.assertEqual((r["state"], r["basis"], r["tech_id"]), ("confirmed", "epass_rcall", self.dla))

    def test_kpis_run_on_real_mirror(self):
        from wilson_service import kpi
        if not (os.path.exists(DT_FILE) and os.path.exists(EI_FILE)):
            self.skipTest("real files not present")
        dispatchtrack.import_file(self.db, DT_FILE, now=NOW)
        exportinvoice.import_file(self.db, EI_FILE, now=NOW + _dt.timedelta(minutes=25))
        rows = kpi.kpis(self.db, "2026-08-01", "2026-09-10", now=NOW)
        self.assertTrue(rows)
        jrc = next(r for r in rows if r["sp_code"] == "JRC")
        self.assertEqual(jrc["working_days"], 24)   # Aug 3–Sep 10: 29 weekdays minus 5 Fridays (JRC is Mon–Thu)
        self.assertTrue(all(r["working_days"] >= 24 for r in rows if r["sp_code"] != "JRC"))
        # the import created RCALL-flagged jobs -> confirmed recalls exist without anyone reviewing
        self.assertGreater(self.db.scalar("SELECT COUNT(*) FROM recall WHERE basis='epass_rcall'"), 0)


class T08Placement0914(unittest.TestCase):
    """9/14: placement against the mirrored route, the SO4 auto-pencil, route-first offers, the queue-copy intake, the shadow scorecard."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 14, 9, 0)          # Monday
        self.tmp = tempfile.mkdtemp()
        self.dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _route_day(self, tech, day, n, zone="LOCAL", zip_code="78737", lat=30.19, lng=-97.99, prefix="SV0012399"):
        """A DispatchTrack snapshot with n SO1 stops for one tech on one day in one zone."""
        orders = [{"Order Number": f"{prefix}{i}", "Job Status": "SO1", "Delivery Date": day, "Truck": tech, "Ship Name": f"ROUTE STOP{i}", "Ship Address1": f"{i} Oak Hill Dr",
                   "Ship City": "Austin", "Ship Zip": zip_code, "Phone1": f"512555{1000 + i:04d}", "Map Zone": zone, "Latitude": str(lat + i * 0.002), "Longitude": str(lng),
                   "Order Detail": "DISHW BOSCH SHX SER1 SV leaks"} for i in range(n)]
        p = os.path.join(self.tmp, f"DispatchTrackDetail_20260914_09{n}500.csv")
        write_dt(p, orders)
        return dispatchtrack.import_file(self.db, p, now=self.now)

    def test_migration_adds_new_columns_to_an_existing_db(self):
        db = DB.sqlite(":memory:")
        db.conn.execute("CREATE TABLE job (job_id INTEGER PRIMARY KEY AUTOINCREMENT, sv_number TEXT UNIQUE, status TEXT)")
        db.init_schema()
        cols = db.existing_columns("job")
        for c in ("parts_eta", "penciled_date", "penciled_tech_id", "source_ref", "card_ref", "est_minutes"):
            self.assertIn(c, cols)
        self.assertIn("IF COL_LENGTH('dbo.job','parts_eta') IS NULL ALTER TABLE dbo.job ADD parts_eta DATE;", schema.ddl("mssql"))
        self.assertIn("placement_log", schema.TABLES)

    def test_suggest_prefers_the_day_our_route_is_already_there(self):
        """The Round Rock example: Tue is empty, Wed already has three LOCAL stops -> a new LOCAL request should land Wed."""
        from wilson_service import placement
        self._route_day("DLA", "9/16/2026", 3)
        j = statuses.create_request(self.db, customer={"name": "Round Rock Customer", "phone": "5125550707"}, address={"line1": "700 Oak Hill Dr", "city": "Austin", "zip": "78737"},
                                    card_saved=True, now=self.now)
        cands = placement.suggest(self.db, j, now=self.now)
        self.assertTrue(cands)
        best = cands[0]
        self.assertEqual((best["sp_code"], best["date"]), ("DLA", "2026-09-16"))
        self.assertIn("3 stops in LOCAL", best["why"])
        self.assertLess(best["cost"], next(c["cost"] for c in cands if c["date"] == "2026-09-15"))
        # 9/17 pm: the customer's calendar STARTS on our day. Wed is first, labelled earliest available, and
        # Tue — open, but not what we want — is not offered at all. Nothing says "best fit".
        offers = placement.offer(self.db, j, now=self.now)
        self.assertTrue(offers[0]["recommended"] and offers[0]["date"] == "2026-09-16")
        self.assertTrue(offers[0]["label"].startswith("Earliest available"), offers[0]["label"])
        self.assertEqual(offers[0]["held_business_days"], 1)
        self.assertNotIn("2026-09-15", [o["date"] for o in offers])
        self.assertFalse(any("est fit" in (o["label"] or "") for o in offers))
        # with the hold turned off the calendar starts at first open capacity
        self.db.execute("UPDATE settings SET value='0' WHERE setting_key='offer.hold_max_business_days'")
        offers0 = placement.offer(self.db, j, now=self.now)
        self.assertEqual(offers0[0]["date"], "2026-09-15")
        self.db.execute("UPDATE settings SET value='3' WHERE setting_key='offer.hold_max_business_days'")
        # a full day is skipped: 9 stops of 60 min + drive leaves no room
        self._route_day("DLA", "9/17/2026", 9, prefix="SV0012388")
        self.assertNotIn(("DLA", "2026-09-17"), [(c["sp_code"], c["date"]) for c in placement.suggest(self.db, j, now=self.now, limit=100)])

    def test_pencil_follows_the_eta_and_becomes_the_first_offer(self):
        from wilson_service import placement
        j = statuses.create_request(self.db, customer={"name": "Jeff McCollum", "phone": "5125550808"}, address={"line1": "12 Sage Hollow", "city": "Austin", "zip": "78737"}, card_saved=True, now=self.now)
        for ev, kw in (("staff.booked", dict(route_date="2026-09-08", window="AM", tech_id=self.dla)),
                       ("tech.findings_submitted", dict(outcome="office_quote", tech_id=self.dla, lines=[{"code": "4200500", "desc": "Evap fan", "qty": 1, "price": 189}])),
                       ("parts.verified", dict(quote_kind="office")), ("customer.approved", dict(total=340.0))):
            statuses.transition(self.db, j, ev, "staff", "x", now=self.now, **kw)
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (j,))["status"], "SO3")
        # Kezia places the PO with a Wednesday ETA -> SO4 -> penciled Friday (ETA + 2 business days), on the owning tech
        statuses.transition(self.db, j, "po.placed", "staff", "KKD", now=self.now, eta="2026-09-16")
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["status"], job["parts_eta"], job["penciled_date"], job["penciled_tech_id"]), ("SO4", "2026-09-16", "2026-09-18", self.dla))
        self.assertIn("penciled", job["flags"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM audit_log WHERE action='placement.penciled' AND entity_id=?", (str(j),)))
        # the pencil counts against that day
        load = placement.day_load(self.db, self.dla, "2026-09-18")
        self.assertEqual((len(load["stops"]), load["stops"][0]["penciled"]), (1, 1))
        # ETA slips a week -> the pencil moves out with it
        statuses.transition(self.db, j, "po.eta_changed", "staff", "KKD", now=self.now, eta="2026-09-21")
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertGreaterEqual(job["penciled_date"], "2026-09-23")
        penciled = job["penciled_date"]
        # part checks in -> SO5; the customer's first offer is the penciled day
        statuses.transition(self.db, j, "receiving.all_parts_in", "staff", "receiving", now=self.now, bin_location="B7")
        offers = placement.offer(self.db, j, now=self.now)
        self.assertEqual((offers[0]["date"], offers[0]["sp_code"], offers[0]["recommended"]), (penciled, "DLA", True))
        self.assertIn("installer is already nearby", offers[0]["label"])
        # customer takes it -> SO6, pencil cleared, scorecard says we agreed with ourselves
        statuses.transition(self.db, j, "customer.picked_window", "customer", "web", now=self.now, route_date=penciled, window=offers[0]["window"], tech_id=self.dla)
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["status"], job["route_date"], job["penciled_date"]), ("SO6", penciled, None))
        self.assertNotIn("penciled", job["flags"] or "")
        rows = self.db.fetchall("SELECT * FROM placement_log WHERE job_id=? AND kind='pencil'", (j,))
        self.assertTrue(rows and all(r["actual_at"] and r["actual_source"] == "dashboard" for r in rows))
        self.assertEqual(rows[-1]["agree_day"], 1)

    def test_queue_copy_intake_then_epass_keys_the_ticket(self):
        """The 'Copy to service dashboard test module' button, then the dispatcher books it in ePASS as today."""
        from wilson_service import intake, placement
        payload = {"request_id": "sr_4821", "submitted_at": "2026-09-14T16:32:00",
                   "customer": {"name": "Thomas Meyer", "email": "tm101352@gmail.com", "phone": "5125579882"},
                   "address": {"line1": "1714 Cielo Ranch rd.", "city": "San Marcos", "state": "TX", "zip": "78666"}, "contact_method": "Text",
                   "purchase_date": "2011", "purchased_within_12_months": False,
                   "units": [{"type": "Sub-Zero Refrigerator (Built-in)", "model": "BI42SD/O", "serial": "F4139786", "purchased_from_us": True,
                              "problem": "I notice a small puddle of water at base of refrigerator door"}],
                   "photos": ["https://x/1.jpg", "https://x/2.jpg"], "card": {"saved": True, "brand": "VISA", "last4": "8241", "setup_intent": "seti_1UFhRX8Mxpn8XucSe8t2KIe3"}}
        res = intake.from_queue(self.db, payload, now=self.now)
        self.assertTrue(res["created"]); self.assertEqual(res["status"], "REQ"); self.assertTrue(res["suggestions"])
        j = res["job_id"]
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["source"], job["source_ref"], job["est_minutes"]), ("dashboard", "queue:sr_4821", 60))
        self.assertTrue(job["card_ref"].startswith("VISA 8241 seti_"))
        u = self.db.fetchone("SELECT * FROM unit WHERE job_id=?", (j,))
        self.assertEqual((u["category"], u["install_type"], u["brand"], u["model"]), ("refrigerator", "built_in", "Sub-Zero", "BI42SD/O"))
        self.assertEqual(self.db.fetchone("SELECT contact_pref FROM customer WHERE customer_id=?", (job["customer_id"],))["contact_pref"], "text")
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='photos.attach'", (j,)))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM placement_log WHERE job_id=? AND kind='intake' AND actual_at IS NULL", (j,)))
        # pressing the button twice does not make two requests
        again = intake.from_queue(self.db, payload, now=self.now)
        self.assertEqual((again["created"], again["job_id"]), (False, j))
        # the dispatcher books it in ePASS as they do today; the next snapshot attaches the SV, adopts the booking and scores our suggestion
        p = os.path.join(self.tmp, "DispatchTrackDetail_20260914_101500.csv")
        write_dt(p, [{"Order Number": "SV00124001", "Job Status": "SO1", "Delivery Date": "9/16/2026", "Truck": "DLA", "Ship Name": "MEYER THOMAS", "Ship Address1": "1714 Cielo Ranch Rd",
                      "Ship City": "San Marcos", "Ship Zip": "78666", "Phone1": "(512) 557-9882", "Map Zone": "SANMA", "Order Detail": "REBIS SUB-ZERO BI42SD/O F4139786 SV puddle"}])
        r = dispatchtrack.import_file(self.db, p, now=self.now + _dt.timedelta(hours=1))
        self.assertEqual((r.attached, r.created), (1, 0))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["sv_number"], job["status"], job["route_date"], job["assigned_tech_id"]), ("SV00124001", "SO1", "2026-09-16", self.dla))
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE customer_id=?", (job["customer_id"],)), 1)
        log = self.db.fetchone("SELECT * FROM placement_log WHERE job_id=? AND kind='intake'", (j,))
        self.assertEqual((log["actual_source"], log["actual_date"], log["actual_tech_id"]), ("epass", "2026-09-16", self.dla))
        sc = placement.scorecard(self.db)
        self.assertEqual((sc["suggested"], sc["decided"]), (1, 1))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM status_history WHERE job_id=? AND trigger_event='epass_attach_booked'", (j,)))

    def test_epass_first_then_erp_number_merges_the_duplicate(self):
        from wilson_service import intake
        p = os.path.join(self.tmp, "DispatchTrackDetail_20260914_083000.csv")
        write_dt(p, [{"Order Number": "SV00124002", "Job Status": "SO1", "Delivery Date": "9/15/2026", "Truck": "CIT", "Ship Name": "ELLIS FRANCOIS", "Ship Address1": "218 Carpenter Hill Dr",
                      "Ship City": "Buda", "Ship Zip": "78610", "Phone1": "6127024026", "Map Zone": "BUDA", "Order Detail": "DISHW KITCHENAID KDTM SER SV noisy"}])
        dispatchtrack.import_file(self.db, p, now=self.now)
        dup = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00124002'")
        self.assertEqual(dup["source"], "import")
        res = intake.from_queue(self.db, {"request_id": "sr_4822", "customer": {"name": "Francois Ellis", "phone": "6127024026", "email": "arnoldusellis@gmail.com"},
                                          "address": {"line1": "218 carpenter hill dr", "city": "Buda", "zip": "78610"}, "contact_method": "Text",
                                          "units": [{"type": "KitchenAid Dishwasher", "problem": "loud grinding"}], "card": {"saved": True}, "erp_order_number": "SV00124002"}, now=self.now)
        self.assertTrue(res["created"]); self.assertEqual(res["sv_number"], "SV00124002"); self.assertTrue(res["merged"])
        self.assertIsNone(self.db.fetchone("SELECT 1 FROM job WHERE job_id=?", (dup["job_id"],)))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (res["job_id"],))
        self.assertEqual((job["status"], job["route_date"], job["epass_status"], job["in_feed"], job["source"]), ("SO1", "2026-09-15", "SO1", 1, "dashboard"))
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE sv_number='SV00124002'"), 1)
        # the next snapshot updates the merged job in place — no new job
        p2 = os.path.join(self.tmp, "DispatchTrackDetail_20260914_084500.csv")
        write_dt(p2, [{"Order Number": "SV00124002", "Job Status": "SO1", "Delivery Date": "9/15/2026", "Truck": "CIT", "Ship Name": "ELLIS FRANCOIS", "Ship Address1": "218 Carpenter Hill Dr",
                       "Ship City": "Buda", "Ship Zip": "78610", "Phone1": "6127024026", "Map Zone": "BUDA", "Order Detail": "DISHW KITCHENAID KDTM SER SV noisy"}])
        r = dispatchtrack.import_file(self.db, p2, now=self.now + _dt.timedelta(minutes=15))
        self.assertEqual((r.created, r.unchanged + r.updated), (0, 1))

    def test_serve_shim_roundtrip(self):
        import threading, urllib.request
        from http.server import ThreadingHTTPServer
        from wilson_service import serve
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), serve.make_handler(self.db, "", "*"))
        port = httpd.server_address[1]
        th = threading.Thread(target=httpd.serve_forever, daemon=True); th.start()
        try:
            def call(method, path, body=None):
                req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode() if body is not None else None, method=method,
                                             headers={"Content-Type": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=5) as r:
                        return r.status, json.loads(r.read() or b"{}")
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read() or b"{}")
            code, h = call("GET", "/health")
            self.assertEqual((code, h["ok"]), (200, True))
            code, res = call("POST", "/api/requests", {"request_id": "sr_9", "customer": {"name": "Shim Test", "phone": "5125550909"},
                                                       "address": {"line1": "1 Test", "zip": "78620"}, "units": [{"type": "GE Dryer", "problem": "no heat"}], "card": {"saved": True}})
            self.assertEqual((code, res["status"]), (201, "REQ"))
            code, s = call("GET", f"/api/jobs/{res['job_id']}/suggest")
            self.assertEqual(code, 200); self.assertTrue(s["suggest"])
            code, b = call("GET", "/api/board?date=2026-09-16")
            self.assertEqual(code, 200); self.assertTrue(any(t["sp_code"] == "DLA" for t in b["techs"]))
            code, sc = call("GET", "/api/shadow")
            self.assertEqual((code, sc["suggested"]), (200, 1))
            code, err = call("POST", "/api/requests", {"request_id": "bad", "customer": {"name": "No Phone"}, "address": {"zip": "78620"}})
            self.assertEqual(code, 400); self.assertIn("phone", err["error"])
        finally:
            httpd.shutdown(); httpd.server_close()


class T09RealExport0915(unittest.TestCase):
    """9/15: the second real invoice export. ePASS parks undated work on the coming Saturday and writes status case
    inconsistently — both are handled on import, and the 460-ticket file lands on top of the 9/10 mirror."""

    EI_0915 = os.path.join(REF, "data", "ExportInvoice_20260915_current_sv.xlsx")

    def setUp(self):
        self.db = fresh_db()
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _ei(self, rows, name="ExportInvoice_test.xlsx"):
        """Write a minimal Invoice Maintenance workbook (header on row 3)."""
        import openpyxl
        hdr = ["Status", "Payment Type Code", "Job Status", "Balance", "* Sched Date", "Route", "Invoice #", "Name", "Address",
               "Finish Date", "SP", "Total", "Map Zone", "PO #", "Reference", "Bill To Customer", "Bill To Customer Name",
               "Service Model", "Service Serial", "Spec Auth #", "Bill To Email", "Service Brand", "Zip Code", "Date Created",
               "Units", "Qualification", "Priorities"]
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Invoice Maintenance"
        ws.append(["Invoice Maintenance"]); ws.append([]); ws.append(hdr)
        for r in rows:
            ws.append([r.get(h, "") for h in hdr])
        path = os.path.join(self.tmp, name)
        wb.save(path)
        return path

    def test_saturday_sched_date_is_a_parking_date_not_a_schedule(self):
        now = _dt.datetime(2026, 9, 15, 8, 0)
        p = self._ei([
            {"Status": "Open", "Payment Type Code": "COD", "Job Status": "SO2.2", "Invoice #": "   SV00900001", "Name": "PARKED JOB",
             "Address": "1 Test", "Zip Code": "78620", "SP": "DLA", "* Sched Date": "2026-09-19", "Balance": "100", "Total": "100", "Units": 1},
            {"Status": "Open", "Payment Type Code": "COD", "Job Status": "SO1", "Invoice #": "   SV00900002", "Name": "REAL DATE",
             "Address": "2 Test", "Zip Code": "78620", "SP": "DLA", "* Sched Date": "2026-09-17", "Balance": "0", "Total": "0", "Units": 1},
        ])
        res = exportinvoice.import_file(self.db, p, now=now)
        self.assertEqual((res.created, res.parked), (2, 1))
        parked = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00900001'")
        booked = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00900002'")
        self.assertIsNone(parked["epass_route_date"])            # Saturday = nobody's route
        self.assertIn("parked", parked["flags"])
        self.assertEqual(booked["epass_route_date"], "2026-09-17")
        self.assertIsNone(booked["flags"])
        # and when ePASS finally gives it a real day the flag clears
        p2 = self._ei([{"Status": "Open", "Payment Type Code": "COD", "Job Status": "SO1", "Invoice #": "   SV00900001", "Name": "PARKED JOB",
                        "Address": "1 Test", "Zip Code": "78620", "SP": "DLA", "* Sched Date": "2026-09-18", "Balance": "100", "Total": "100", "Units": 1}],
                      name="ExportInvoice_test2.xlsx")
        exportinvoice.import_file(self.db, p2, now=now)
        parked = self.db.fetchone("SELECT * FROM job WHERE sv_number='SV00900001'")
        self.assertEqual(parked["epass_route_date"], "2026-09-18")
        self.assertIsNone(parked["flags"])

    def test_status_case_is_normalised(self):
        now = _dt.datetime(2026, 9, 15, 8, 0)
        p = self._ei([{"Status": "Open", "Payment Type Code": "AR", "Job Status": "so8", "Invoice #": "   SV00900003", "Name": "LOWER CASE",
                       "Address": "3 Test", "Zip Code": "78620", "SP": "DLA", "* Sched Date": "2026-09-17", "Finish Date": "2026-09-14",
                       "Balance": "0", "Total": "250", "Units": 1}])
        exportinvoice.import_file(self.db, p, now=now)
        self.assertEqual(self.db.fetchone("SELECT epass_status FROM job WHERE sv_number='SV00900003'")["epass_status"], "SO8")
        self.assertIsNone(self.db.fetchone("SELECT 1 FROM status_def WHERE status='so8'"))

    def test_the_real_9_15_file_on_top_of_the_9_10_mirror(self):
        if not (os.path.exists(DT_FILE) and os.path.exists(EI_FILE) and os.path.exists(self.EI_0915)):
            self.skipTest("real files not present")
        dispatchtrack.import_file(self.db, DT_FILE, now=NOW)
        exportinvoice.import_file(self.db, EI_FILE, now=NOW + _dt.timedelta(minutes=25))
        now = _dt.datetime(2026, 9, 15, 8, 0)
        res = exportinvoice.import_file(self.db, self.EI_0915, now=now)
        self.assertEqual(res.rows, 460)
        self.assertEqual((res.created, res.updated, res.unchanged), (89, 171, 200))
        self.assertEqual(res.parked, 182)                        # 155 of them on Sat 9/19
        self.assertEqual(res.new_statuses, 1)                    # only 'QUOTE 2' is genuinely new
        # the week ePASS has scheduled: every routed status lands on a weekday
        days = self.db.fetchall("SELECT epass_route_date AS d, COUNT(*) AS n FROM job WHERE epass_route_date BETWEEN '2026-09-14' AND '2026-09-18' "
                                "AND closed_at IS NULL AND epass_status IN ('SO1','SO6','SO4PRE','SO5') GROUP BY epass_route_date ORDER BY epass_route_date")
        self.assertEqual([r["d"] for r in days], ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"])
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE epass_route_date='2026-09-19'"), 0)
        # ePASS's own RCALL flag: every flagged ticket is a confirmed recall without anyone reviewing it
        flagged = self.db.scalar("SELECT COUNT(*) FROM job WHERE warranty_flags LIKE '%RCALL%'")
        with_recall = self.db.scalar("SELECT COUNT(*) FROM job j WHERE j.warranty_flags LIKE '%RCALL%' "
                                     "AND EXISTS (SELECT 1 FROM recall r WHERE r.job_id=j.job_id AND r.state='confirmed')")
        self.assertGreaterEqual(flagged, 19)
        self.assertEqual(flagged, with_recall)


class T10History0915(unittest.TestCase):
    """The ePASS back catalogue load (§1.4). Runs against the real exports when they are present."""

    HIST = os.path.join(REF, "data", "SV_HISTORY.csv")
    CUST = os.path.join(REF, "data", "CUSTOMERS.csv")

    def _db(self):
        db = DB.sqlite(":memory:")
        db.init_schema()
        return db

    def test_keys_and_payer_kinds(self):
        from wilson_service.importers.history import address_key, surname_key, payer_kind, serial_core
        self.assertEqual(address_key("1377 Stock Pond Dr.", "78631-1204"), "1377 STOCK POND DR|78631")
        self.assertEqual(address_key("515 Yaupon Valley Road", "78746"), "515 YAUPON VALLEY RD|78746")
        self.assertEqual(surname_key("KLEPAC-UECKER RHONDA", "78606"), "KLEPAC|78606")
        self.assertEqual(payer_kind("5128334870", ""), "household")
        self.assertEqual(payer_kind("WHIRLPOOL", ""), "manufacturer")
        self.assertEqual(payer_kind("WTY_ZEPHYR", ""), "manufacturer")
        self.assertEqual(payer_kind("cash", ""), "cash")
        self.assertEqual(payer_kind("JB ASSOC", ""), "dealer")
        # two spellings of one Sub-Zero serial reduce to the same core, but are never merged
        self.assertEqual(serial_core("P1562739"), serial_core("1562739"))
        self.assertEqual(serial_core("ABC"), "")

    def test_payer_is_not_the_customer(self):
        """A warranty ticket is billed to the manufacturer but must land on the homeowner's record."""
        from wilson_service.importers import history as H
        db = self._db()
        H.load_customers(db, [{"Code": "5125551234", "First Name": "Ada", "Last Name": "Byron",
                               "Address 1": "12 Analytical Way", "Zip ode": "78746", "city": "AUSTIN",
                               "State": "TX", "Phone1": "5125551234", "email 1": "ada@example.com",
                               "Do Not Service": ""}])
        res = H.load_history(db, [
            {"Invoice #": "SV00000001", "Bill To Customer": "5125551234", "Bill To Customer Name": "BYRON",
             "Name": "BYRON ADA", "Address": "12 Analytical Way", "Zip Code": "78746", "Job Status": "SO8",
             "Date Created": "2024-01-05", "Total": "169.95", "Service Serial": "SN1", "Service Brand": "SZ",
             "Service Model": "680/S", "Payment Type Code": "COD", "SP": "DLA"},
            {"Invoice #": "SV00000002", "Bill To Customer": "WHIRLPOOL", "Bill To Customer Name": "WHIRLPOOL",
             "Name": "BYRON ADA", "Address": "12 Analytical Way", "Zip Code": "78746", "Job Status": "WAR1",
             "Date Created": "2022-06-02", "Total": "0", "Service Serial": "SN1", "Service Brand": "SZ",
             "Service Model": "680/S", "Payment Type Code": "AR", "SP": "MAP"}])
        self.assertEqual(res.tickets, 2)
        cust = db.fetchone("SELECT customer_id, service_count FROM customer WHERE epass_customer_code='5125551234'")
        # both tickets, the COD one and the Whirlpool-billed one, sit on the one household
        self.assertEqual(cust["service_count"], 2)
        rows = db.fetchall("SELECT h.sv_number, h.identity_source, p.kind FROM service_history h"
                           " JOIN payer p ON p.payer_id=h.payer_id WHERE h.customer_id=? ORDER BY h.sv_number",
                           (cust["customer_id"],))
        self.assertEqual([r["kind"] for r in rows], ["household", "manufacturer"])
        self.assertEqual([r["identity_source"] for r in rows], ["epass_code", "address_zip"])
        # one serial seen on two visits is one asset, and its dates span both
        a = db.fetchone("SELECT * FROM asset WHERE customer_id=?", (cust["customer_id"],))
        self.assertEqual(a["service_count"], 2)
        self.assertEqual((a["first_seen"], a["last_seen"]), ("2022-06-02", "2024-01-05"))

    def test_namesake_across_town_is_not_the_same_household(self):
        """9/17: Sammie Baird's Do-Not-Service flag surfaced on Leah Baird, a different address in the same
        ZIP. A surname match must also share a house number (an address spelling variant); a namesake at a
        different number gets her own household and none of Sammie's flags."""
        from wilson_service.importers import history as H
        self.assertTrue(H.same_house("156 White Rock Court", "156 WHITE ROCK CT|78620"))
        self.assertFalse(H.same_house("4946 Farm To Market 165", "156 WHITE ROCK CT|78620"))
        self.assertFalse(H.same_house("NEW HOUSE", "156 WHITE ROCK CT|78620"))
        db = self._db()
        H.load_customers(db, [{"Code": "5125653445", "First Name": "Sammie", "Last Name": "Baird",
                               "Address 1": "156 White Rock Ct", "Zip ode": "78620", "Do Not Service": "Do Not Service"}])
        H.load_history(db, [
            # spelling variant of Sammie's own address (not one the suffix table fixes), billed to a
            # manufacturer: attaches by surname + house number
            {"Invoice #": "SV00000021", "Bill To Customer": "SUBZERO", "Name": "BAIRD SAMMIE",
             "Address": "156 Whiterock Ct", "Zip Code": "78620", "Job Status": "WAR1", "Date Created": "2023-02-02"},
            # namesake across town: must NOT attach
            {"Invoice #": "SV00000022", "Bill To Customer": "WHIRLPOOL", "Name": "BAIRD LEAH",
             "Address": "4946 Farm To Market 165", "Zip Code": "78620", "Job Status": "WAR1", "Date Created": "2024-05-05"}])
        sammie = db.fetchone("SELECT customer_id, service_count, do_not_service FROM customer WHERE epass_customer_code='5125653445'")
        self.assertEqual(sammie["service_count"], 1)
        leah = db.fetchone("SELECT c.customer_id, c.do_not_service, h.identity_source FROM service_history h"
                           " JOIN customer c ON c.customer_id=h.customer_id WHERE h.sv_number='SV00000022'")
        self.assertNotEqual(leah["customer_id"], sammie["customer_id"])
        self.assertEqual(leah["do_not_service"], 0)
        self.assertEqual(leah["identity_source"], "unmatched")
        self.assertEqual(db.fetchone("SELECT identity_source FROM service_history WHERE sv_number='SV00000021'")["identity_source"],
                         "surname_zip")

    def test_condo_units_are_separate_households(self):
        """210 Lavaca St is a 37-storey tower with 200 ePASS accounts. Without the unit they were one
        household; with it, 1908 and 2701 are two, and a ticket written '210 LAVACA ST #1908' finds 1908."""
        from wilson_service.importers import history as H
        self.assertEqual(H.address_key("210 LAVACA ST", "78701", "UNIT 1908"), "210 LAVACA ST #1908|78701")
        self.assertEqual(H.address_key("210 Lavaca St #1908", "78701"), "210 LAVACA ST #1908|78701")
        self.assertEqual(H.address_key("210 LAVACA ST UNIT 1908", "78701"), "210 LAVACA ST #1908|78701")
        self.assertEqual(H.address_key("1700 Palomino Ridge Dr 6", "78733"), "1700 PALOMINO RIDGE DR #6|78733")
        self.assertEqual(H.address_key("13319 N ST HWY 16 STANTON RANCH", "78643"), "13319 N ST HWY 16 STANTON RANCH|78643")
        for junk in ("CLAIM SUBMISSION", "NOT PROVIDED", "Dripping Springs", "NEW HOUSE", "-"):
            self.assertEqual(H.address_key(junk, "78620"), "", junk)
        self.assertEqual(H.address_key("BUCKHORN LK RESORT SITE 6234", "78028"), "BUCKHORN LK RESORT SITE 6234|78028")
        db = self._db()
        H.load_customers(db, [
            {"Code": "5125550019", "First Name": "Nineteen", "Last Name": "Oh-Eight", "Address 1": "210 Lavaca St",
             "Address 2": "UNIT 1908", "Zip ode": "78701", "Do Not Service": ""},
            {"Code": "5125550027", "First Name": "Twenty", "Last Name": "Seven-Oh-One", "Address 1": "210 Lavaca St",
             "Address 2": "UNIT 2701", "Zip ode": "78701", "Do Not Service": "abusive"}])
        H.load_history(db, [{"Invoice #": "SV00000031", "Bill To Customer": "SUBZERO", "Name": "OH-EIGHT NINETEEN",
                             "Address": "210 LAVACA ST #1908", "Zip Code": "78701", "Job Status": "WAR1", "Date Created": "2024-01-01"}])
        row = db.fetchone("SELECT c.epass_customer_code code, c.do_not_service dns, h.identity_source src FROM service_history h"
                          " JOIN customer c ON c.customer_id=h.customer_id WHERE h.sv_number='SV00000031'")
        self.assertEqual((row["code"], row["dns"], row["src"]), ("5125550019", 0, "address_zip"))
        keys = {r["household_key"] for r in db.fetchall("SELECT household_key FROM customer")}
        self.assertEqual(len(keys), 2)

    def test_junk_serials_do_not_become_assets(self):
        from wilson_service.importers import history as H
        db = self._db()
        H.load_history(db, [{"Invoice #": f"SV0000000{i}", "Bill To Customer": "5125550000",
                             "Name": "X Y", "Address": "1 A St", "Zip Code": "78746", "Job Status": "SO8",
                             "Date Created": "2024-01-0%d" % (i + 1), "Service Serial": s, "Service Brand": "SZ"}
                            for i, s in enumerate(["VERIFY", "NEED", "N/A", "0000", "REAL123"])])
        self.assertEqual(db.fetchone("SELECT COUNT(*) n FROM asset")["n"], 1)
        self.assertEqual(db.fetchone("SELECT serial FROM asset")["serial"], "REAL123")

    def test_idempotent_and_external_refs(self):
        from wilson_service.importers import history as H
        db = self._db()
        row = [{"Invoice #": "SV00000009", "Bill To Customer": "5125559999", "Name": "Z Q",
                "Address": "9 B St", "Zip Code": "78620", "Job Status": "SO8", "Date Created": "2025-03-03"}]
        H.load_history(db, row)
        H.load_history(db, row)                       # re-running a wider export must not duplicate
        self.assertEqual(db.fetchone("SELECT COUNT(*) n FROM service_history")["n"], 1)
        self.assertEqual(db.fetchone("SELECT COUNT(*) n FROM external_ref WHERE system='epass' AND entity='job'")["n"], 1)

    def test_do_not_service_flag(self):
        from wilson_service.importers import history as H
        db = self._db()
        H.load_customers(db, [{"Code": "5125550001", "First Name": "No", "Last Name": "Service",
                               "Address 1": "5 Stop St", "Zip ode": "78620", "Do Not Service": "abusive 2019"}])
        c = db.fetchone("SELECT do_not_service, do_not_service_note FROM customer WHERE epass_customer_code='5125550001'")
        self.assertEqual(c["do_not_service"], 1)
        self.assertEqual(c["do_not_service_note"], "abusive 2019")

    @unittest.skipUnless(os.path.exists(os.path.join(REF, "data", "SV_HISTORY.csv")),
                         "real ePASS catalogue not present")
    def test_real_catalogue(self):
        from wilson_service.importers import history as H
        db = self._db()
        H.load_customers(db, H.read_csv(self.CUST))
        res = H.load_history(db, H.read_csv(self.HIST))
        self.assertEqual(res.tickets, 117590)
        # the identity mix measured on 9/15, re-measured 9/17 after the surname rule started requiring a
        # house number: 91,545 on a code, ~2.1% unmatched (was 1.2% when namesakes were being merged)
        self.assertEqual(res.by_identity["epass_code"], 91545)
        self.assertLess(res.by_identity["unmatched"] / res.tickets, 0.03)
        self.assertLess(res.by_identity["surname_zip"], 2500)          # was 4,264 before the rule
        self.assertEqual(db.fetchone("SELECT COUNT(*) n FROM payer WHERE kind='manufacturer'")["n"], 29)
        self.assertEqual(db.fetchone("SELECT COUNT(*) n FROM customer WHERE do_not_service=1")["n"], 212)
        # no currently-open SV appears in the catalogue: service_history and job are disjoint
        self.assertEqual(db.fetchone("SELECT COUNT(*) n FROM service_history WHERE sv_number='SV00123467'")["n"], 0)


class T11FullExport0917(unittest.TestCase):
    """The seven-file ODBC export (§1.6). Unit tests always run; the real-file test skips when absent."""

    DIR = os.path.join(REF, "data", "full")

    def _db(self):
        db = DB.sqlite(":memory:")
        db.init_schema()
        return db

    def test_parsers(self):
        from wilson_service.importers.fullexport import d, m, i, b, t, tidy, norm_serial, SALE_TYPES
        self.assertEqual(d("09/20/2007 00:00:00"), "2007-09-20")
        self.assertIsNone(d("12/30/1899 00:00:00"))      # ePASS's null date
        self.assertIsNone(d(""))
        self.assertEqual(m("2,900.4800"), 2900.48)
        self.assertIsNone(m("abc"))
        self.assertEqual(i("1.0"), 1)
        self.assertEqual((b("True"), b("False"), b("")), (1, 0, 0))
        self.assertEqual(t("  x  ", 1), "x")
        # apostrophes are mangled in the source; repaired for display only, and only between letters
        self.assertEqual(tidy("Won?t stop running"), "Won't stop running")
        self.assertEqual(tidy("Is it broken? Maybe"), "Is it broken? Maybe")
        self.assertEqual(norm_serial("p-156 2739"), "P1562739")
        self.assertNotIn("SV", SALE_TYPES)               # service is not a sale

    def test_model_family(self):
        """9/17: SHV78 and SHP78 are one dishwasher with two handles. Family = brand + product code + stem."""
        from wilson_service.importers.fullexport import model_family as mf
        self.assertEqual(mf("BOSCH", "DW", "SHP78CM5N/25")["key"], "BOSCH|DW|SH?78")
        self.assertEqual(mf("BOSCH", "DW", "SHV78B73UC")["key"], "BOSCH|DW|SH?78")
        self.assertEqual(mf("BOSCH", "DW", "SHX78CM5N")["stem"], "SH?78")
        self.assertEqual(mf("BOSCH", "DW", "SHX878ZD5N")["stem"], "SH?878")        # Benchmark stays its own family
        self.assertEqual(mf("BOSCH", "DW", "SHX7PT55UC")["stem"], "SH?7PT")
        # the default: letters + first digit run, production index dropped, brand kept in the key
        self.assertEqual(mf("WP", "RESXS", "WRF555SDFZ00")["stem"], "WRF555")
        self.assertEqual(mf("GE", "REBOT", "GNE27JYMFS")["stem"], "GNE27")
        self.assertEqual(mf("SZ", "REBIS", "648PRO")["stem"], "648PRO")
        self.assertNotEqual(mf("WP", "RESXS", "WRF555SDFZ")["key"], mf("KA", "RESXS", "WRF555SDFZ")["key"])
        self.assertEqual(mf("", "", "")["rule"], "none")

    def test_detail_parts_labor_and_reads(self):
        from wilson_service.importers import fullexport as F, history as H
        db = self._db()
        H.load_history(db, [{"Invoice #": "SV00000100", "Bill To Customer": "5125550100", "Name": "TEST HOUSE",
                             "Address": "1 Test St", "Zip Code": "78620", "Job Status": "SO8",
                             "Date Created": "2026-01-05", "Total": "280.89", "SP": "BLL",
                             "Service Serial": "SN-100", "Service Brand": "CARR"}])
        F.load_service_detail(db, self._csv(db, "detail"))
        F.load_parts(db, self._csv(db, "parts"))
        F.load_labor(db, self._csv(db, "labor"))
        x = F.call_detail(db, "SV00000100")
        self.assertEqual(x["call"]["complaint_desc"], "Won't turn on")     # tidied on the way out
        self.assertEqual(x["call"]["product_code"], "ACCON")
        self.assertEqual(len(x["parts"]), 1)
        self.assertEqual(x["parts"][0]["item_desc"], "DUAL CAPACITOR")
        self.assertEqual(len(x["labor"]), 1)
        self.assertEqual(x["labor"][0]["tech_name"], "Brady Langley")
        mi = F.model_insight(db, "carr", "24ACC436A300")                   # case-insensitive
        self.assertEqual(mi["total_calls"], 1)
        self.assertEqual(mi["parts"][0]["item_desc"], "DUAL CAPACITOR")

    def _csv(self, db, kind):
        import tempfile
        rows = {
            "detail": ("ServiceInvoice,SvcComplaintDesc,SvcPerformedDesc,SvcProductCode,SvcBrandCode,SvcModel,SvcSerial,SvcInWarranty\n"
                       "SV00000100,Won?t turn on,Replaced capacitor,ACCON,CARR,24ACC436A300,SN-100,No Warranty\n"),
            "parts": ("ServiceInvoice,PartLineID,TripNo,ItemCode,ItemDesc,QtyShipped,SellingPrice,UnitCost,Installed\n"
                      "SV00000100,1,1,CAP45/5,DUAL CAPACITOR,1,69.00,21.00,True\n"),
            "labor": ("ServiceInvoice,LaborLineID,TripNo,ServiceDate,TechnicianCode,TechnicianDesc,LaborDescription,TimeCharged,HdthsMin,Total\n"
                      "SV00000100,1,1,01/06/2026,BLL,Brady Langley,Capacitor Replacement,1.0,Minutes,106.25\n"),
        }[kind]
        f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8", newline="")
        f.write(rows); f.close()
        return f.name

    def test_serial_links_service_to_a_sale(self):
        from wilson_service.importers import fullexport as F, history as H
        db = self._db()
        H.load_history(db, [{"Invoice #": "SV00000200", "Bill To Customer": "5125550200", "Name": "BUYER A",
                             "Address": "2 Test St", "Zip Code": "78620", "Job Status": "SO8",
                             "Date Created": "2026-02-02", "Service Serial": "S19323K004F", "Service Brand": "TRANE"}])
        db.insert("sale", {"invoice_code": "AC00010003", "inv_type": "AC"})
        db.insert("sale_line", {"invoice_code": "AC00010003", "model_code": "4TWR6024H1000A", "selling_price": 2900.48})
        db.insert("sale_serial", {"invoice_code": "AC00010003", "model_code": "4TWR6024H1000A",
                                  "serial": "s19323k004f", "taken_date": "2019-09-03"})   # different case
        self.assertEqual(F.link_assets_to_sales(db), 1)
        a = db.fetchone("SELECT purchased_from_us, purchase_date, purchase_price, purchase_invoice FROM asset")
        self.assertEqual(a["purchased_from_us"], 1)
        self.assertEqual(a["purchase_date"], "2019-09-03")
        self.assertEqual(float(a["purchase_price"]), 2900.48)
        self.assertEqual(a["purchase_invoice"], "AC00010003")

    @unittest.skipUnless(os.path.isdir(os.path.join(REF, "data", "full")), "full ODBC export not present")
    def test_real_export(self):
        from wilson_service.importers import fullexport as F
        db = self._db()
        res = F.load_dir(db, self.DIR)
        self.assertEqual(res.counts["service_detail"], 117662)
        self.assertEqual(res.counts["service_part"], 110655)
        self.assertEqual(res.counts["service_labor"], 116829)
        self.assertEqual(res.counts["sale_serial"], 124922)
        self.assertEqual(res.counts["techs"], 51)
        # every technician code resolves to a name — that is what makes retiring one safe
        self.assertEqual(db.scalar("SELECT COUNT(*) FROM tech WHERE name IS NULL"), 0)


class T12Feedback0918(unittest.TestCase):
    """9/18 (owner feedback): per-day route endpoints, the zone fee labor rule, permissions + retire, the estimate hand-off
    and the ePASS watch."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 18, 9, 0)          # Friday
        self.tmp = tempfile.mkdtemp()
        self.dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        self.jrc = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='JRC'")["tech_id"]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _job_at(self, name, phone, lat, lng, *, zip_code="78748", line1="1 Herb Brooks Dr", city="Austin"):
        j = statuses.create_request(self.db, customer={"name": name, "phone": phone}, address={"line1": line1, "city": city, "zip": zip_code}, card_saved=True, now=self.now)
        job = self.db.fetchone("SELECT address_id FROM job WHERE job_id=?", (j,))
        self.db.update("address", {"address_id": job["address_id"]}, {"lat": lat, "lng": lng})
        return j

    def _stop(self, job_id, tech_id, date):
        self.db.update("job", {"job_id": job_id}, {"status": "SO1", "assigned_tech_id": tech_id, "route_date": date, "route_sequence": 1})

    def test_schema_additions(self):
        for tbl in ("app_user", "app_permission", "estimate_handoff"):
            self.assertIn(tbl, schema.TABLES)
        self.assertEqual(schema.columns("tech")[-3:], ["home_lat", "home_lng", "retire_on"])
        self.assertEqual(schema.columns("tech_pattern")[-2:], ["start_at", "end_at"])
        self.assertIn("fee_band", schema.columns("zone"))
        self.assertIn("IF COL_LENGTH('dbo.zone','fee_band') IS NULL ALTER TABLE dbo.zone ADD fee_band INT;", schema.ddl("mssql"))
        # an existing database picks the columns up on init
        db = DB.sqlite(":memory:")
        db.conn.execute("CREATE TABLE tech (tech_id INTEGER PRIMARY KEY AUTOINCREMENT, sp_code TEXT UNIQUE)")
        db.init_schema()
        self.assertTrue({"home_lat", "home_lng", "retire_on"} <= set(db.existing_columns("tech")))
        self.assertTrue(db.existing_columns("estimate_handoff"))

    # ---- 1. per-day start/end points
    def test_per_day_endpoints_change_the_first_leg(self):
        from wilson_service import placement
        # Josh: default home/home from the roster, no coordinates yet -> measured from the shop until the office adds them
        self.assertEqual(self.db.fetchone("SELECT start_default, end_default FROM tech WHERE tech_id=?", (self.jrc,))["start_default"], "home")
        self.assertEqual(placement.route_endpoints(self.db, self.jrc, "2026-09-22"), (placement.SHOP, placement.SHOP))
        home = (30.166, -97.796)                                                    # South Austin (Herb Brooks Dr)
        self.db.update("tech", {"tech_id": self.jrc}, {"home_lat": home[0], "home_lng": home[1]})
        for wd in ("Mon", "Wed"):                                                  # shop both ends: picks up parts
            self.db.insert("tech_pattern", {"tech_id": self.jrc, "weekday": wd, "shift_start": None, "shift_end": None, "reason": "parts pickup",
                                            "set_by": "demitrius", "set_at": "2026-09-18 09:00:00", "start_at": "shop", "end_at": "shop"})
        self.assertEqual(placement.route_endpoints(self.db, self.jrc, "2026-09-21"), (placement.SHOP, placement.SHOP))   # Mon
        self.assertEqual(placement.route_endpoints(self.db, self.jrc, "2026-09-22"), (home, home))                       # Tue: default home/home
        self.assertEqual(placement.route_endpoints(self.db, self.jrc, "2026-09-23"), (placement.SHOP, placement.SHOP))   # Wed
        self.assertEqual(placement.route_endpoints(self.db, self.jrc, "2026-09-24"), (home, home))                       # Thu
        # a pattern row that only changes the shift keeps the default endpoints
        self.db.insert("tech_pattern", {"tech_id": self.jrc, "weekday": "Thu", "shift_start": "08:00", "shift_end": "15:00", "reason": "early", "set_by": "x",
                                        "set_at": "2026-09-18 09:00:00", "start_at": None, "end_at": None})
        self.assertEqual(placement.route_endpoints(self.db, self.jrc, "2026-09-24"), (home, home))
        # the same South Austin stop on Mon (from the shop) and Tue (from home): the Monday route drives much further
        mon = self._job_at("Mon Stop", "5125551101", 30.17, -97.80)
        tue = self._job_at("Tue Stop", "5125551102", 30.17, -97.80, line1="2 Herb Brooks Dr")
        self._stop(mon, self.jrc, "2026-09-21"); self._stop(tue, self.jrc, "2026-09-22")
        load_mon, load_tue = placement.day_load(self.db, self.jrc, "2026-09-21"), placement.day_load(self.db, self.jrc, "2026-09-22")
        self.assertEqual((load_mon["start"], load_tue["start"]), (placement.SHOP, home))
        self.assertEqual(load_mon["drive"], 2 * placement._drive(self.db, placement.SHOP, (30.17, -97.80)))
        self.assertEqual(load_tue["drive"], 2 * placement._drive(self.db, home, (30.17, -97.80)))
        self.assertGreater(load_mon["drive"], load_tue["drive"] + 40)
        # and a second South Austin request costs Josh almost nothing to add on a home day, a lot on a shop day
        new = self._job_at("New Request", "5125551103", 30.175, -97.79, line1="3 Herb Brooks Dr")
        here = placement.location(self.db, self.db.fetchone("SELECT * FROM job WHERE job_id=?", (new,)))
        add_mon, _ = placement.marginal_drive(self.db, load_mon["points"], here, ends=(load_mon["start"], load_mon["end"]))
        add_tue, _ = placement.marginal_drive(self.db, load_tue["points"], here, ends=(load_tue["start"], load_tue["end"]))
        self.assertLessEqual(add_tue, add_mon)
        cands = {(c["sp_code"], c["date"]): c for c in placement.suggest(self.db, new, now=self.now, limit=100)}
        self.assertLess(cands[("JRC", "2026-09-22")]["added_drive"], cands[("JRC", "2026-09-21")]["added_drive"])
        # no pattern and shop/shop defaults (DLA): exactly the old shop -> stops -> shop arithmetic
        self.assertEqual(placement.route_endpoints(self.db, self.dla, "2026-09-21"), (placement.SHOP, placement.SHOP))
        d = self._job_at("DLA Stop", "5125551104", 30.19, -98.08, zip_code="78620", line1="1211 Green Hills Dr", city="Dripping Springs")
        self._stop(d, self.dla, "2026-09-21")
        load = placement.day_load(self.db, self.dla, "2026-09-21")
        self.assertEqual(load["drive"], 2 * placement._drive(self.db, placement.SHOP, (30.19, -98.08)))
        self.assertEqual(placement.marginal_drive(self.db, [], here), (placement._drive(self.db, placement.SHOP, here) * 2, 0))

    # ---- 2. the zone fee labor rule
    def test_zone_bands_and_fee_lines(self):
        from wilson_service import labor
        self.assertEqual([labor.zone_band(m) for m in (3, 7, 12, 26, 30, 47, 60)], [1, 1, 2, 2, 3, 3, 4])
        self.assertEqual(labor.zone_band(12, bands=(10, 20, 30)), 2)
        self.assertEqual(labor.zone_fee_lines(12), [{"code": "ZN2", "desc": "Service Zone 2", "amount": 130.0, "auto": True}])
        two = labor.zone_fee_lines(12, units=2)
        self.assertEqual([(l["code"], l["amount"]) for l in two], [("ZN2", 130.0), ("ZNADD", 85.0)])
        self.assertEqual(two[1]["desc"], "Additional Appliance")
        self.assertEqual([(l["code"], l["amount"]) for l in labor.zone_fee_lines(3)], [("ZN1", 120.0)])
        self.assertEqual([(l["code"], l["amount"]) for l in labor.zone_fee_lines(60, units=3)], [("ZN4", 150.0), ("ZNADD", 85.0), ("ZNADD", 85.0)])
        self.assertEqual(labor.diag_fee_line(3), {"code": "DZ1", "desc": "Diagnostic Zone 1", "amount": 157.0, "auto": True})
        self.assertEqual([labor.diag_fee_line(m)["amount"] for m in (3, 12, 30, 60)], [157.0, 157.0, 179.0, 209.0])
        self.assertEqual([labor.diag_fee_line(m)["code"] for m in (7, 26, 47, 48)], ["DZ1", "DZ2", "DZ3", "DZ4"])
        self.assertAlmostEqual(round(labor.diag_fee_line(5)["amount"] * 1.0825, 2), 169.95)      # what the customer is quoted
        self.assertEqual(labor.miles_from_shop(labor.SHOP), 0.0)
        self.assertAlmostEqual(labor.miles_from_shop((30.19, -98.08)), 4.6, places=1)              # Green Hills Dr: ZN1
        self.assertAlmostEqual(labor.miles_from_shop((30.2672, -97.7431)), 16.5, places=1)         # downtown Austin: ZN2 by distance

    def test_quote_labor_lines_and_zone_override(self):
        from wilson_service import labor
        j = self._job_at("Gary & Karen Jones", "5125550101", 30.19, -98.08, zip_code="78620", line1="1211 Green Hills Dr", city="Dripping Springs")
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["zone_code"], "DS")
        lines = labor.quote_labor_lines(self.db, job, [("Drain Pump Replacement", 1.5)])
        self.assertEqual([(l["code"], l["desc"], l["amount"]) for l in lines],
                         [("ZN1", "Service Zone 1", 120.0), ("LAB", "Drain Pump Replacement 1.5h", 195.0)])
        self.assertTrue(lines[0]["auto"] and not lines[1]["auto"])
        # two appliances, two tasks: zone + additional + one line per task
        self.db.update("job", {"job_id": j}, {"units": 2})
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        lines = labor.quote_labor_lines(self.db, job, [("Drain Pump Replacement", 1.5), ("Door Gasket", 0.5)])
        self.assertEqual([l["code"] for l in lines], ["ZN1", "ZNADD", "LAB", "LAB"])
        self.assertEqual(sum(l["amount"] for l in lines), 120 + 85 + 195 + 65)
        # the per-zone override wins over distance (downtown 78701 is priced ZN3 at 18.8 mi in the history)
        self.db.update("zone", {"zone_code": "DS"}, {"fee_band": 3})
        lines = labor.quote_labor_lines(self.db, job, [("Drain Pump Replacement", 1.5)])
        self.assertEqual((lines[0]["code"], lines[0]["amount"]), ("ZN3", 140.0))
        # settings drive the numbers
        self.db.set_setting("labor.hourly_rate", 150, "cayden")
        self.db.set_setting("labor.zone_fees", {"ZN1": 125, "ZN2": 135, "ZN3": 145, "ZN4": 155, "ZNADD": 90}, "cayden")
        lines = labor.quote_labor_lines(self.db, job, [("Drain Pump Replacement", 1.5)])
        self.assertEqual([l["amount"] for l in lines], [145.0, 90.0, 225.0])
        # no geocode at all: the zone's km_from_shop stands in
        far = statuses.create_request(self.db, customer={"name": "Far Out", "phone": "5125551199"}, address={"line1": "1 Main", "zip": "78624"}, card_saved=True, now=self.now)
        fj = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (far,))
        self.db.execute("UPDATE address SET lat=NULL, lng=NULL WHERE zip LIKE '78624%'")
        self.db.execute("UPDATE zone SET centroid_lat=NULL, centroid_lng=NULL WHERE zone_code=?", (fj["zone_code"],))
        km = self.db.fetchone("SELECT km_from_shop FROM zone WHERE zone_code=?", (fj["zone_code"],))["km_from_shop"]
        self.assertTrue(km and km > 60)                                             # Fredericksburg
        self.assertEqual(labor.quote_labor_lines(self.db, fj, [])[0]["code"], f"ZN{labor.zone_band(float(km) * labor.MILES_PER_KM)}")

    # ---- 3. permissions and retire
    def test_can_for_each_role(self):
        from wilson_service import auth
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM app_permission"), sum(len(v) for v in auth.ROLE_PERMISSIONS.values()))
        for role in ("owner", "manager"):
            for p in ("roster.retire", "zones.publish", "settings.edit", "test_bench"):
                self.assertTrue(auth.can(self.db, role, p), (role, p))
            self.assertFalse(auth.can(self.db, role, "routes.edit"))
        for p in ("routes.edit", "tech.route_settings", "zones.draft"):
            self.assertTrue(auth.can(self.db, "dispatcher", p))
        self.assertFalse(auth.can(self.db, "dispatcher", "zones.publish"))
        self.assertFalse(auth.can(self.db, "dispatcher", "roster.retire"))
        self.assertTrue(auth.can(self.db, "csr", "jobs.book")); self.assertFalse(auth.can(self.db, "csr", "parts.verify"))
        self.assertTrue(auth.can(self.db, "parts", "parts.verify")); self.assertFalse(auth.can(self.db, "parts", "jobs.book"))
        self.assertEqual(auth.permissions_for(self.db, "tech"), [])
        self.assertFalse(auth.can(self.db, None, "test_bench")); self.assertFalse(auth.can(self.db, "nobody@wilsonappliance.com", "test_bench"))
        # by email
        auth.add_user(self.db, "Mark@WilsonAppliance.com", "Mark", "manager", "cayden", now=self.now)
        uid = auth.add_user(self.db, "demitrius@wilsonappliance.com", "Demitrius", "dispatcher", "cayden", now=self.now)
        self.assertTrue(auth.can(self.db, "mark@wilsonappliance.com", "roster.retire"))
        self.assertTrue(auth.can(self.db, "demitrius@wilsonappliance.com", "routes.edit"))
        self.assertFalse(auth.can(self.db, "demitrius@wilsonappliance.com", "roster.retire"))
        auth.add_user(self.db, "demitrius@wilsonappliance.com", "Demitrius", "dispatcher", "cayden", active=False, now=self.now)   # deactivated -> nothing
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM app_user"), 2)
        self.assertFalse(auth.can(self.db, "demitrius@wilsonappliance.com", "routes.edit"))
        with self.assertRaises(ValueError):
            auth.add_user(self.db, "x@y.com", "X", "wizard", "cayden")
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM audit_log WHERE action='auth.user_set' AND entity_id=?", (str(uid),)), 2)

    def test_retire_tech_needs_permission_and_is_logged(self):
        from wilson_service import auth, roster, placement
        auth.add_user(self.db, "mark@wilsonappliance.com", "Mark", "manager", "cayden", now=self.now)
        auth.add_user(self.db, "demitrius@wilsonappliance.com", "Demitrius", "dispatcher", "cayden", now=self.now)
        # two open stops on/after the date, one before it, one cancelled: the count is 2
        for i, (date, st) in enumerate((("2026-09-22", "SO1"), ("2026-09-24", "SO6"), ("2026-09-15", "SO1"), ("2026-09-23", "SO9"))):
            j = self._job_at(f"Stop {i}", f"512555120{i}", 30.19, -98.08, zip_code="78620", line1=f"{i} Green Hills Dr", city="Dripping Springs")
            self._stop(j, self.dla, date)
            self.db.update("job", {"job_id": j}, {"status": st})
        with self.assertRaises(PermissionError):
            roster.retire_tech(self.db, "DLA", "2026-09-21", "demitrius@wilsonappliance.com", now=self.now)
        self.assertEqual(self.db.fetchone("SELECT active, retire_on FROM tech WHERE tech_id=?", (self.dla,))["active"], 1)
        with self.assertRaises(ValueError):
            roster.retire_tech(self.db, "NOPE", "2026-09-21", "mark@wilsonappliance.com", now=self.now)
        n = roster.retire_tech(self.db, "dla", "2026-09-21", "mark@wilsonappliance.com", now=self.now)
        self.assertEqual(n, 2)
        t = self.db.fetchone("SELECT * FROM tech WHERE tech_id=?", (self.dla,))
        self.assertEqual((t["active"], t["retire_on"], t["ended_on"]), (0, "2026-09-21", None))     # ended_on stays import-owned
        a = self.db.fetchone("SELECT * FROM audit_log WHERE action='roster.retired' AND entity='tech' AND entity_id='DLA'")
        self.assertEqual((a["user_id"], json.loads(a["after_json"])["open_jobs_from_date"]), ("mark@wilsonappliance.com", 2))
        # gone from placement, still resolves on history
        new = self._job_at("After Retire", "5125551299", 30.19, -98.08, zip_code="78620", line1="9 Green Hills Dr", city="Dripping Springs")
        self.assertNotIn("DLA", [c["sp_code"] for c in placement.suggest(self.db, new, now=self.now, limit=100)])
        self.assertEqual(self.db.fetchone("SELECT sp_code FROM tech WHERE tech_id=?", (self.dla,))["sp_code"], "DLA")
        # the role name itself works where there is no login (a script, the test bench)
        self.assertEqual(roster.retire_tech(self.db, "AJH", "2026-10-01", "owner", now=self.now), 0)

    # ---- 4. the estimate hand-off and the ePASS watch
    def _snap(self, name, orders, now):
        p = os.path.join(self.tmp, name)
        write_dt(p, orders)
        return dispatchtrack.import_file(self.db, p, now=now)

    def _dt_row(self, **kw):
        o = {"Order Number": "SV00125001", "Ship Name": "GARY & KAREN JONES", "Ship Address1": "1211 GREEN HILLS DR", "Ship City": "DRIPPING SPRINGS", "Ship Zip": "78620",
             "Phone2": "(512) 555-0101", "Delivery Date": "9/21/2026", "Truck": "DLA", "Map Zone": "DS", "Job Status": "SO1", "Latitude": "30.19", "Longitude": "-98.08",
             "Order Detail": "DISHW BOSCH SHPM88Z75N FD0101 SV Standing water"}
        o.update(kw)
        return o

    def _quoted_job(self):
        """REQ -> booked -> SV attached by the import -> office quote -> parts verified (SO2.2)."""
        j = self._job_at("Gary & Karen Jones", "5125550101", 30.19, -98.08, zip_code="78620", line1="1211 Green Hills Dr", city="Dripping Springs")
        statuses.transition(self.db, j, "customer.picked_window", "customer", "web", route_date="2026-09-21", window="AM", tech_id=self.dla, now=self.now)
        r = self._snap("DispatchTrackDetail_20260918_091500.csv", [self._dt_row()], self.now + _dt.timedelta(minutes=15))
        self.assertEqual(r.attached, 1)
        statuses.transition(self.db, j, "tech.findings_submitted", "tech", "DLA", outcome="office_quote", tech_id=self.dla,
                            lines=[{"code": "W10348269", "desc": "Drain pump", "qty": 1, "price": 148.0}], now=self.now + _dt.timedelta(days=3))
        statuses.transition(self.db, j, "parts.verified", "staff", "noell", quote_kind="office", now=self.now + _dt.timedelta(days=3, hours=1))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["status"], job["sv_number"], job["owner_tech_id"]), ("SO2.2", "SV00125001", self.dla))
        return j

    def test_hand_off_approved_then_epass_watch(self):
        from wilson_service import handoff, labor
        j = self._quoted_job()
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        lines = [{"code": "W10348269", "desc": "Drain pump", "qty": 1, "price": 148.0}] + labor.quote_labor_lines(self.db, job, [("Drain Pump Replacement", 1.5)])
        self.assertEqual([l["code"] for l in lines], ["W10348269", "ZN1", "LAB"])            # a part + the two labor lines
        total = round(sum(l.get("price") or l.get("amount") for l in lines), 2)
        t0 = self.now + _dt.timedelta(days=3, hours=2)
        hid = handoff.hand_off(self.db, j, lines, total, "2026-09-23", "noell", now=t0)
        h = self.db.fetchone("SELECT * FROM estimate_handoff WHERE handoff_id=?", (hid,))
        self.assertEqual((h["job_id"], h["sv_number"], h["status"], float(h["total"]), h["parts_eta"], h["handed_by"]), (j, "SV00125001", "ready", 463.0, "2026-09-23", "noell"))
        self.assertEqual(len(json.loads(h["lines"])), 3)
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["status"], float(job["total"]), job["parts_eta"]), ("SO2.2", 463.0, "2026-09-23"))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='estimate.handoff'", (j,)))
        # Agility's estimate page: sent (token), viewed, approved
        handoff.record_response(self.db, hid, "sent", now=t0, external_ref="est_7f3a")
        handoff.record_response(self.db, hid, "viewed", now=t0 + _dt.timedelta(hours=1))
        h = self.db.fetchone("SELECT * FROM estimate_handoff WHERE handoff_id=?", (hid,))
        self.assertEqual((h["status"], h["external_ref"], h["responded_at"]), ("viewed", "est_7f3a", None))
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (j,))["status"], "SO2.2")
        with self.assertRaises(ValueError):
            handoff.record_response(self.db, hid, "maybe")
        res = handoff.record_response(self.db, hid, "approved", now=t0 + _dt.timedelta(hours=2))
        self.assertEqual((res["job_status"], res["status"]), ("SO3", "approved"))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["status"], "SO3")
        self.assertIsNotNone(self.db.fetchone("SELECT responded_at FROM estimate_handoff WHERE handoff_id=?", (hid,))["responded_at"])
        hist = self.db.fetchall("SELECT * FROM status_history WHERE job_id=? ORDER BY history_id", (j,))
        self.assertEqual((hist[-1]["from_status"], hist[-1]["to_status"], hist[-1]["trigger_event"], hist[-1]["reason_code"]), ("SO2.2", "SO3", "estimate.approved", "service_estimates"))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND kind='lines'", (j,))
        self.assertEqual((item["sync_id"], item["state"], item["sv_number"]), (res["sync_id"], "pending", "SV00125001"))
        p = json.loads(item["payload"])
        self.assertEqual((p["status"], len(p["lines"]), p["total"]), ("SO3", 3, 463.0))
        txt = item["packet_text"]
        self.assertEqual(txt.splitlines()[0], "SV00125001  Gary & Karen Jones")
        self.assertIn("STATUS: SO3", txt)
        self.assertIn("  W10348269    Drain pump  x1  $148.00", txt)
        self.assertIn("  ZN1          Service Zone 1  x1  $120.00", txt)
        self.assertIn("  LAB          Drain Pump Replacement 1.5h  x1  $195.00", txt)
        self.assertIn("TOTAL: $463.00", txt)
        self.assertIn("NOTE: Customer approved estimate est_7f3a", txt)
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:approved_ordering'", (j,)))
        # exactly one packet for the office — no second set_status item from the engine
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM sync_item WHERE job_id=? AND state='pending'", (j,)), 1)
        # the office keys it; the next import shows SO3 -> confirmed
        sync.mark_keyed(self.db, item["sync_id"], "michael", now="2026-09-21 12:00:00")
        r = self._snap("DispatchTrackDetail_20260921_121500.csv", [self._dt_row(**{"Job Status": "SO3"})], _dt.datetime(2026, 9, 21, 12, 15))
        self.assertEqual((r.sync["confirmed"], r.sync["reverse"]), (1, 0))
        # ---- the ePASS watch: Kezia orders in ePASS -> SO4 read back -> pencil off the verified ETA; not a discrepancy
        r = self._snap("DispatchTrackDetail_20260921_123000.csv", [self._dt_row(**{"Job Status": "SO4"})], _dt.datetime(2026, 9, 21, 12, 30))
        self.assertEqual((r.sync["reverse"], r.sync["discrepancies"], r.sync["followed"]), (0, 0, 1))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["status"], job["source"], job["parts_eta"], job["penciled_tech_id"], job["penciled_date"]), ("SO4", "dashboard", "2026-09-23", self.dla, "2026-09-25"))
        self.assertIn("penciled", job["flags"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM status_history WHERE job_id=? AND trigger_event='epass_watch' AND to_status='SO4'", (j,)))
        self.assertIsNone(self.db.fetchone("SELECT 1 FROM sync_item WHERE job_id=? AND state='discrepancy'", (j,)))
        # part checks in at the shop -> SO5 read back -> the customer text is ready
        r = self._snap("DispatchTrackDetail_20260924_080000.csv", [self._dt_row(**{"Job Status": "SO5", "Location": "SV07"})], _dt.datetime(2026, 9, 24, 8))
        self.assertEqual((r.sync["reverse"], r.sync["followed"]), (0, 1))
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual((job["status"], job["bin_location"]), ("SO5", "SV07"))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='notify:part_arrived_pick_time' AND payload LIKE '%epass_watch%'", (j,)))
        # a status ePASS moves on a job with no approved hand-off is still a discrepancy (nothing else changed)
        other = self._job_at("No Handoff", "5125550909", 30.19, -98.08, zip_code="78620", line1="5 Green Hills Dr", city="Dripping Springs")
        statuses.transition(self.db, other, "staff.booked", "staff", "x", route_date="2026-09-25", window="AM", tech_id=self.dla, now=self.now)
        self._snap("DispatchTrackDetail_20260924_081500.csv", [self._dt_row(**{"Job Status": "SO5"}), self._dt_row(**{"Order Number": "SV00125002", "Ship Name": "NO HANDOFF",
                   "Ship Address1": "5 GREEN HILLS DR", "Phone2": "(512) 555-0909", "Delivery Date": "9/25/2026"})], _dt.datetime(2026, 9, 24, 8, 15))
        self.assertEqual(self.db.fetchone("SELECT sv_number FROM job WHERE job_id=?", (other,))["sv_number"], "SV00125002")
        r = self._snap("DispatchTrackDetail_20260924_083000.csv", [self._dt_row(**{"Job Status": "SO5"}), self._dt_row(**{"Order Number": "SV00125002", "Ship Name": "NO HANDOFF",
                       "Ship Address1": "5 GREEN HILLS DR", "Phone2": "(512) 555-0909", "Delivery Date": "9/25/2026", "Job Status": "SO4"})], _dt.datetime(2026, 9, 24, 8, 30))
        self.assertEqual((r.sync["reverse"], r.sync["followed"]), (1, 0))
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (other,))["status"], "SO1")

    def test_hand_off_declined_and_shopping(self):
        from wilson_service import handoff
        j = self._quoted_job()
        t0 = self.now + _dt.timedelta(days=3, hours=2)
        hid = handoff.hand_off(self.db, j, [{"code": "P", "desc": "part", "qty": 1, "price": 50}], 245.0, None, "noell", external_ref="est_9", now=t0)
        self.assertEqual(self.db.fetchone("SELECT status FROM estimate_handoff WHERE handoff_id=?", (hid,))["status"], "sent")
        res = handoff.record_response(self.db, hid, "shopping", now=t0 + _dt.timedelta(days=1))
        self.assertEqual(res["job_status"], "SO7")
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["status"], "SO7")
        self.assertTrue(self.db.fetchone("SELECT 1 FROM status_history WHERE job_id=? AND trigger_event='estimate.shopping'", (j,)))
        item = self.db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (res["sync_id"],))
        self.assertEqual((item["kind"], json.loads(item["payload"])["status"]), ("set_status", "SO7"))
        self.assertIn("STATUS: SO7", item["packet_text"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='task:sales_lead'", (j,)))
        # comped is recorded but changes nothing on the job
        j2 = statuses.create_request(self.db, customer={"name": "Comped", "phone": "5125550808"}, address={"line1": "8 Elm", "zip": "78620"}, card_saved=True, now=self.now)
        self.db.update("job", {"job_id": j2}, {"status": "SO2.2"})
        h2 = handoff.hand_off(self.db, j2, [], 0.0, None, "noell", now=t0)
        res = handoff.record_response(self.db, h2, "comped", now=t0)
        self.assertEqual((res["job_status"], res["sync_id"]), ("SO2.2", None))
        self.assertIsNotNone(self.db.fetchone("SELECT responded_at FROM estimate_handoff WHERE handoff_id=?", (h2,))["responded_at"])

    def test_parts_unavailable_notice(self):
        """9/18 pm: Kezia marks a part discontinued -> the hand-off is a notice, not a quote; the customer either moves to
        the showroom (shopping) or the call closes (parts_unavailable); ePASS hears SO7 either way; it can never be approved."""
        from wilson_service import handoff
        j = self._quoted_job()
        t0 = self.now + _dt.timedelta(days=3, hours=2)
        lines = [{"code": "WPW10195416", "desc": "Bake element", "qty": 1, "price": 88.0, "availability": "nla"},
                 {"code": "ZN1", "desc": "Service Zone 1", "qty": 1, "price": 120.0}, {"code": "LAB", "desc": "Bake element replacement · 1 h", "qty": 1, "price": 130.0}]
        hid = handoff.hand_off(self.db, j, lines, 363.0, "2026-09-23", "kezia", now=t0)
        h = self.db.fetchone("SELECT * FROM estimate_handoff WHERE handoff_id=?", (hid,))
        self.assertEqual((h["kind"], h["status"], float(h["total"]), h["parts_eta"]), ("notice", "ready", 0.0, None))
        ob = json.loads(self.db.fetchone("SELECT payload FROM outbox WHERE job_id=? AND effect='estimate.handoff'", (j,))["payload"])
        self.assertEqual((ob["kind"], ob["nla"]), ("notice", ["Bake element"]))
        self.assertEqual(self.db.fetchone("SELECT total FROM job WHERE job_id=?", (j,))["total"], self.db.fetchone("SELECT total FROM job WHERE job_id=?", (j,))["total"])  # untouched
        handoff.record_response(self.db, hid, "sent", now=t0, external_ref="est_nla1")
        with self.assertRaises(ValueError):
            handoff.record_response(self.db, hid, "approved", now=t0)                     # nothing to order
        # customer wants a replacement -> SO7 + sales lead, packet says why
        res = handoff.record_response(self.db, hid, "shopping", now=t0 + _dt.timedelta(hours=3))
        self.assertEqual(res["job_status"], "SO7")
        item = self.db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (res["sync_id"],))
        pl = json.loads(item["payload"])
        self.assertEqual((item["kind"], pl["status"], pl["reason"], pl["nla"]), ("set_status", "SO7", "shopping", ["Bake element"]))
        self.assertIn("discontinued", pl["note"])
        self.assertIn("showroom", pl["note"])
        lead = json.loads(self.db.fetchone("SELECT payload FROM outbox WHERE job_id=? AND effect='task:sales_lead'", (j,))["payload"])
        self.assertEqual(lead["nla"], ["Bake element"])
        self.assertTrue(self.db.fetchone("SELECT 1 FROM status_history WHERE job_id=? AND trigger_event='estimate.shopping' AND note LIKE 'Part discontinued%'", (j,)))
        # the other exit: informed, no replacement wanted -> parts_unavailable, SO7, no sales lead
        j2 = statuses.create_request(self.db, customer={"name": "Closed Nla", "phone": "5125550909"}, address={"line1": "9 Elm", "zip": "78620"}, card_saved=True, now=self.now)
        self.db.update("job", {"job_id": j2}, {"status": "SO2"})
        h2 = handoff.hand_off(self.db, j2, [{"code": "P", "desc": "Control board", "qty": 1, "price": 0, "availability": "NLA"}], 0.0, None, "kezia", external_ref="est_nla2", now=t0)
        res2 = handoff.record_response(self.db, h2, "parts_unavailable", now=t0 + _dt.timedelta(days=1), by="noell")
        self.assertEqual(res2["job_status"], "SO7")
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (j2,))["status"], "SO7")
        pl2 = json.loads(self.db.fetchone("SELECT payload FROM sync_item WHERE sync_id=?", (res2["sync_id"],))["payload"])
        self.assertEqual(pl2["reason"], "parts_unavailable")
        self.assertIn("call closed", pl2["note"])
        self.assertIsNone(self.db.fetchone("SELECT 1 FROM outbox WHERE job_id=? AND effect='task:sales_lead'", (j2,)))
        self.assertEqual(self.db.fetchone("SELECT status, responded_at IS NOT NULL AS r FROM estimate_handoff WHERE handoff_id=?", (h2,))["r"], 1)
        # a normal quote is still kind 'quote' and approves as before
        j3 = statuses.create_request(self.db, customer={"name": "Quote Kind", "phone": "5125551010"}, address={"line1": "10 Elm", "zip": "78620"}, card_saved=True, now=self.now)
        self.db.update("job", {"job_id": j3}, {"status": "SO2.2"})
        h3 = handoff.hand_off(self.db, j3, [{"code": "P", "desc": "part", "qty": 1, "price": 50, "availability": "stock"}], 245.0, "2026-09-22", "kezia", external_ref="est_q", now=t0)
        self.assertEqual(self.db.fetchone("SELECT kind FROM estimate_handoff WHERE handoff_id=?", (h3,))["kind"], "quote")
        self.assertEqual(handoff.record_response(self.db, h3, "approved", now=t0)["job_status"], "SO3")

    def test_diagnostic_fee_on_a_parts_unavailable_notice(self):
        """9/18 pm (Cayden): the diagnostic still stands as standard, but the office frequently waives it while moving the
        customer to the showroom. Default charge, waive in one call, both logged and both on the SO7 packet for billing."""
        from wilson_service import handoff
        t0 = self.now + _dt.timedelta(days=3)
        def notice(name, phone, line_desc="Control board"):
            j = statuses.create_request(self.db, customer={"name": name, "phone": phone}, address={"line1": "11 Elm", "zip": "78620"}, card_saved=True, now=self.now)
            self.db.update("job", {"job_id": j}, {"status": "SO2"})
            return j, handoff.hand_off(self.db, j, [{"code": "P", "desc": line_desc, "qty": 1, "price": 0, "availability": "nla"}], 0.0, None, "kezia", external_ref="est_d", now=t0)
        # 1. nobody touches it → the seeded default, charged, said plainly in the packet
        j1, h1 = notice("Default Charge", "5125551111")
        r1 = handoff.record_response(self.db, h1, "parts_unavailable", now=t0, by="noell")
        self.assertEqual((r1["job_status"], r1["diag"]), ("SO7", "charge"))
        pl1 = json.loads(self.db.fetchone("SELECT payload FROM sync_item WHERE sync_id=?", (r1["sync_id"],))["payload"])
        self.assertEqual((pl1["diag"], pl1["billing"]), ("charge", "bill diagnostic"))
        self.assertIn("169.95 billed as standard", pl1["note"])
        # 2. waived on the way to the showroom → packet says do not bill, sales lead carries it, audited with the actor
        j2, h2 = notice("Waived To Sales", "5125552222", "Compressor")
        r2 = handoff.record_response(self.db, h2, "shopping", now=t0 + _dt.timedelta(hours=1), by="noell", diag="waive")
        self.assertEqual(r2["diag"], "waive")
        pl2 = json.loads(self.db.fetchone("SELECT payload FROM sync_item WHERE sync_id=?", (r2["sync_id"],))["payload"])
        self.assertEqual(pl2["billing"], "waive diagnostic")
        self.assertIn("WAIVED", pl2["note"])
        self.assertIn("do not bill", pl2["note"])
        self.assertIn("showroom lead", pl2["note"])
        lead = json.loads(self.db.fetchone("SELECT payload FROM outbox WHERE job_id=? AND effect='task:sales_lead'", (j2,))["payload"])
        self.assertEqual(lead["diag"], "waive")
        a = self.db.fetchone("SELECT * FROM audit_log WHERE entity_id=? AND action='diag.waive'", (str(j2),))
        self.assertEqual(a["user_id"], "noell")
        self.assertEqual(json.loads(a["after_json"])["amount"], 169.95)
        # 3. the proposed middle: billed now, credited against a replacement
        j3, h3 = notice("Credited", "5125553333")
        r3 = handoff.record_response(self.db, h3, "shopping", now=t0, by="noell", diag="credit")
        pl3 = json.loads(self.db.fetchone("SELECT payload FROM sync_item WHERE sync_id=?", (r3["sync_id"],))["payload"])
        self.assertIn("CREDITED against a replacement", pl3["note"])
        self.assertEqual(pl3["billing"], "bill diagnostic, credit on a replacement")
        # 4. the setting moves the default without touching a call site
        self.db.update("settings", {"setting_key": "billing.diag_on_nla"}, {"value": "waive"})
        j4, h4 = notice("Setting Waives", "5125554444")
        self.assertEqual(handoff.record_response(self.db, h4, "parts_unavailable", now=t0, by="noell")["diag"], "waive")
        self.db.update("settings", {"setting_key": "billing.diag_on_nla"}, {"value": "charge"})
        # 5. a nonsense choice is refused, and an ordinary quote never carries a diag decision
        j5, h5 = notice("Bad Choice", "5125555555")
        with self.assertRaises(ValueError):
            handoff.record_response(self.db, h5, "shopping", now=t0, diag="free")
        j6 = statuses.create_request(self.db, customer={"name": "Plain Quote", "phone": "5125556666"}, address={"line1": "12 Elm", "zip": "78620"}, card_saved=True, now=self.now)
        self.db.update("job", {"job_id": j6}, {"status": "SO2.2"})
        h6 = handoff.hand_off(self.db, j6, [{"code": "P", "desc": "part", "qty": 1, "price": 50, "availability": "stock"}], 245.0, "2026-09-22", "kezia", now=t0)
        r6 = handoff.record_response(self.db, h6, "declined", now=t0, by="noell")
        self.assertIsNone(r6.get("diag"))
        self.assertNotIn("diag", json.loads(self.db.fetchone("SELECT payload FROM sync_item WHERE sync_id=?", (r6["sync_id"],))["payload"]))

    def test_new_ticket_link_sets_the_sv(self):
        from wilson_service import handoff
        # a request booked on Agility's own page (not through rule 2): SO1 with a date, window and tech, no ePASS ticket
        j = self._job_at("Thomas Meyer", "5125579882", 29.88, -97.94, zip_code="78666", line1="1714 Cielo Ranch Rd", city="San Marcos")
        self.db.update("job", {"job_id": j}, {"status": "SO1", "route_date": "2026-09-22", "assigned_tech_id": self.dla,
                                                  "promised_window_start": "2026-09-22 08:00:00", "promised_window_end": "2026-09-22 12:00:00"})
        self.db.insert("unit", {"job_id": j, "category": "refrigerator", "install_type": "built_in", "brand": "Sub-Zero", "model": "BI42SD/O", "serial": "F4139786",
                                "problem_text": "puddle", "raw_detail": None})
        sid = handoff.request_ticket(self.db, j, "web", now=self.now)
        item = self.db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (sid,))
        self.assertEqual((item["kind"], item["state"], item["sv_number"], item["job_id"]), ("new_ticket", "pending", None, j))
        p = json.loads(item["payload"])
        self.assertEqual((p["status"], p["route_date"], p["window"], p["tech"], p["self_booked"]), ("SO1", "2026-09-22", "AM", "DLA", True))
        self.assertEqual((p["customer"]["phone"], p["address"]["zip"], p["unit"]["model"]), ("(512) 557-9882", "78666", "BI42SD/O"))
        txt = item["packet_text"].splitlines()
        self.assertEqual(txt[0], "NEW TICKET  Thomas Meyer")
        self.assertIn("UNIT: refrigerator Sub-Zero BI42SD/O F4139786", txt)
        self.assertIn("STATUS: SO1   DATE: 9/22/2026   WINDOW: 8–12   TECH: DLA", txt)
        # a second request for the same job does not make a second packet
        self.assertEqual(handoff.request_ticket(self.db, j, "web", now=self.now), sid)
        # the office keys the ticket and links the SV
        res = handoff.link_ticket(self.db, sid, "sv00124500", "michael", now=self.now + _dt.timedelta(hours=1))
        self.assertEqual((res["sv_number"], res["merged"], res["job_id"]), ("SV00124500", False, j))
        self.assertEqual(self.db.fetchone("SELECT sv_number FROM job WHERE job_id=?", (j,))["sv_number"], "SV00124500")
        item = self.db.fetchone("SELECT * FROM sync_item WHERE sync_id=?", (sid,))
        self.assertEqual((item["state"], item["sv_number"], item["keyed_by"]), ("keyed", "SV00124500", "michael"))
        with self.assertRaises(ValueError):
            handoff.request_ticket(self.db, j, "web")                        # already has a ticket
        with self.assertRaises(ValueError):
            handoff.link_ticket(self.db, sid, "SV00124501", "michael")      # not open any more
        # the next snapshot shows the ticket as keyed -> confirmed like any other item
        r = self._snap("DispatchTrackDetail_20260918_101500.csv", [{"Order Number": "SV00124500", "Job Status": "SO1", "Delivery Date": "9/22/2026", "Truck": "DLA",
                       "Ship Name": "MEYER THOMAS", "Ship Address1": "1714 Cielo Ranch Rd", "Ship City": "San Marcos", "Ship Zip": "78666", "Phone1": "(512) 557-9882",
                       "Map Zone": "SANMA", "Order Detail": "REBIS SUB-ZERO BI42SD/O F4139786 SV puddle"}], self.now + _dt.timedelta(hours=2))
        self.assertEqual((r.created, r.sync["confirmed"]), (0, 1))
        self.assertEqual(self.db.fetchone("SELECT state FROM sync_item WHERE sync_id=?", (sid,))["state"], "confirmed")
        self.assertEqual(self.db.scalar("SELECT COUNT(*) FROM job WHERE customer_id=(SELECT customer_id FROM job WHERE job_id=?)", (j,)), 1)
        # a rule-2 booking already carries a create_ticket packet: request_ticket hands that one back instead of a duplicate
        j2 = statuses.create_request(self.db, customer={"name": "Rule Two", "phone": "5125550222"}, address={"line1": "2 Oak", "zip": "78620"}, card_saved=True, now=self.now)
        statuses.transition(self.db, j2, "customer.picked_window", "customer", "web", route_date="2026-09-22", window="PM", tech_id=self.dla, now=self.now)
        existing = self.db.fetchone("SELECT sync_id FROM sync_item WHERE job_id=? AND kind='create_ticket'", (j2,))["sync_id"]
        self.assertEqual(handoff.request_ticket(self.db, j2, "web", now=self.now), existing)
        self.assertEqual(handoff.link_ticket(self.db, existing, "SV00124600", "michael", now=self.now)["sv_number"], "SV00124600")
        self.assertEqual(self.db.fetchone("SELECT state FROM sync_item WHERE sync_id=?", (existing,))["state"], "keyed")

    # ---------------------------------------------------------------- 9/18 late: the customer's tracker link
    def test_tracker_link_is_the_whole_of_getting_back_in(self):
        """Cayden, 9/18 late: the confirmation page's job is to get the customer to save this link. So the link
        has to exist from the moment the request does, survive everything, and be killable when it leaks."""
        from wilson_service import tracker
        j = statuses.create_request(self.db, customer={"name": "Rivera, Sam", "phone": "5125551234", "email": "sam@example.com"},
                                    address={"line1": "9 Mesquite", "zip": "78620"}, unit={"category": "dishwasher", "install_type": "built_in"},
                                    problem_text="Won't drain", card_saved=True, now=self.now)
        tok = self.db.fetchone("SELECT tracker_token FROM job WHERE job_id=?", (j,))["tracker_token"]
        self.assertIsNotNone(tok, "a request without a link is a request the customer cannot follow")
        self.assertEqual(len(tok), 14)
        self.assertFalse(set(tok) & set("0O1lI"), "the token gets read aloud to Client Care")
        # the request_received text carries it, so the customer has it before they ever see the page
        ob = self.db.fetchone("SELECT payload FROM outbox WHERE job_id=? AND effect='notify:request_received'", (j,))
        self.assertIn(tok, json.loads(ob["payload"])["link"])
        # issuing is idempotent — a second call must not orphan the link the customer already saved
        self.assertEqual(tracker.issue(self.db, j), tok)
        self.assertEqual(tracker.link_for(self.db, j), "https://wilsonappliance.com/t/" + tok)
        # resolve returns the customer's own view, and nothing that isn't theirs
        row = tracker.resolve(self.db, tok, now=self.now)
        self.assertEqual((row["job_id"], row["first_name"], row["unit"]), (j, "Sam", "dishwasher"))
        self.assertNotIn("card_ref", row)
        self.assertNotIn("customer_id", row)
        # unknown, malformed and revoked all answer the same way: nothing to learn here
        self.assertIsNone(tracker.resolve(self.db, "nope"))
        self.assertIsNone(tracker.resolve(self.db, tracker.new_token()))
        self.assertIsNone(tracker.resolve(self.db, ""))

    def test_tracker_link_reissue_expiry_and_customer_email(self):
        from wilson_service import tracker
        j = statuses.create_request(self.db, customer={"name": "Lost, Pat", "phone": "5125559090"},
                                    address={"line1": "11 Cedar", "zip": "78620"}, card_saved=True, now=self.now)
        old = tracker.issue(self.db, j)
        # "I lost the link" / the phone changed hands: the new one works, the old one is dead immediately
        new = tracker.reissue(self.db, j, by="noell", reason="customer lost it")
        self.assertNotEqual(new, old)
        self.assertIsNone(tracker.resolve(self.db, old))
        self.assertIsNotNone(tracker.resolve(self.db, new))
        self.assertTrue(self.db.fetchone("SELECT 1 FROM audit_log WHERE action='tracker.reissue' AND entity_id=?", (str(j),)))
        # email me the link: customer-initiated, so no template toggle, but it is rate limited and validated
        self.assertFalse(tracker.email_link(self.db, new, "not-an-email")["sent"])
        r = tracker.email_link(self.db, new, "pat@example.com", now=self.now)
        self.assertTrue(r["sent"])
        self.assertTrue(r["url"].endswith(new))
        sent = json.loads(self.db.fetchone("SELECT payload FROM outbox WHERE job_id=? AND effect='tracker.email'", (j,))["payload"])
        self.assertEqual((sent["to"], sent["by"]), ("pat@example.com", "customer"))
        self.assertEqual(self.db.fetchone("SELECT email FROM customer WHERE customer_id=(SELECT customer_id FROM job WHERE job_id=?)", (j,))["email"], None,
                         "typing an address to send a link is not the same as giving us an email on file")
        for _ in range(2):
            tracker.email_link(self.db, new, "pat@example.com", now=self.now)
        blocked = tracker.email_link(self.db, new, "pat@example.com", now=self.now)
        self.assertFalse(blocked["sent"])
        self.assertIn("hour", blocked["reason"])
        # an hour later it is fine again
        self.assertTrue(tracker.email_link(self.db, new, "pat@example.com", now=self.now + _dt.timedelta(hours=2))["sent"])
        # expiry is housekeeping: the receipt stays reachable for a quarter after close, then stops
        self.db.update("job", {"job_id": j}, {"closed_at": self.now.strftime("%Y-%m-%d %H:%M:%S")})
        self.assertIsNotNone(tracker.resolve(self.db, new, now=self.now + _dt.timedelta(days=89)))
        self.assertIsNone(tracker.resolve(self.db, new, now=self.now + _dt.timedelta(days=91)))


class T13Feedback0919(unittest.TestCase):
    """9/19 (owner feedback, the other eight): the three tracker buttons that did nothing, closing a call out,
    Kezia's shipping, warranty on the office side, and the installer's damage report all the way to SO5."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 19, 9, 0)          # Saturday of the 9/19 round

    def _req(self, **kw):
        d = dict(customer={"name": "Ort, Jack", "phone": "5125551234"},
                 address={"line1": "319 Creek Ln", "zip": "78620"},
                 unit={"category": "dishwasher", "install_type": "built_in"},
                 problem_text="Won't drain", card_saved=True, now=self.now)
        d.update(kw)
        return statuses.create_request(self.db, **d)

    # ---------------------------------------------------------------- tracker
    def test_customer_can_say_how_to_get_in_and_nothing_else(self):
        """Cayden: "add gate code or note needs to launch a window to input something." A token is a bearer
        credential, so the write is deliberately two fields wide."""
        from wilson_service import tracker
        j = self._req()
        tok = tracker.issue(self.db, j)
        r = tracker.set_access(self.db, tok, gate_code=" #4416 ", note="Dog in the back yard — please call first.", now=self.now)
        self.assertTrue(r["saved"])
        a = self.db.fetchone("SELECT a.* FROM address a JOIN job j ON j.address_id=a.address_id WHERE j.job_id=?", (j,))
        self.assertEqual(a["gate_code"], "#4416", "trimmed, and on the address the tech's card reads from")
        self.assertIn("Dog in the back yard", a["access_notes"])
        # clearing is allowed: a code that has changed is worse than no code
        tracker.set_access(self.db, tok, gate_code="", note="", now=self.now)
        a = self.db.fetchone("SELECT a.* FROM address a JOIN job j ON j.address_id=a.address_id WHERE j.job_id=?", (j,))
        self.assertIsNone(a["gate_code"])
        # every write is logged as the customer's, not as staff
        log = self.db.fetchone("SELECT * FROM audit_log WHERE action='tracker.set_access' ORDER BY audit_id DESC")
        self.assertEqual(log["user_id"], "customer")
        # a bad token writes nothing at all
        self.assertFalse(tracker.set_access(self.db, tracker.new_token(), gate_code="9999")["saved"])

    def test_customer_cancel_frees_the_slot_and_stops_once_we_have_bought_a_part(self):
        """Cayden: "cancel request gives them a success page." Behind the page it is rule 34, the same path a
        dispatcher's cancel takes — and it closes once a part is on order, because then somebody has to decide
        what happens to the part."""
        from wilson_service import tracker
        j = self._req()
        tok = tracker.issue(self.db, j)
        tech = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        statuses.transition(self.db, j, "customer.picked_window", "customer", "customer", now=self.now,
                            tech_id=tech, route_date="2026-09-22", window="AM")
        self.assertEqual(self.db.fetchone("SELECT status, route_date FROM job WHERE job_id=?", (j,))["status"], "SO1")
        out = tracker.cancel(self.db, tok, reason="cost", note="Landlord is replacing it", now=self.now)
        self.assertTrue(out["cancelled"])
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["status"], "SO9")
        self.assertIsNone(job["route_date"], "the half-day goes back to the route")
        self.assertIn("cost", (job["cancel_reason"] or ""))
        h = self.db.fetchone("SELECT * FROM status_history WHERE job_id=? ORDER BY history_id DESC", (j,))
        self.assertEqual((h["actor_type"], h["to_status"]), ("customer", "SO9"))
        self.assertTrue(self.db.fetchone("SELECT * FROM sync_item WHERE job_id=? AND kind='set_status'", (j,)),
                        "ePASS still has to be told")
        # a reason we do not offer is recorded as 'other' rather than trusted
        j2 = self._req()
        t2 = tracker.issue(self.db, j2)
        self.assertEqual(tracker.cancel(self.db, t2, reason="../../etc/passwd", now=self.now)["why"], "other")
        # once a part is ordered the button is not the answer
        j3 = self._req()
        t3 = tracker.issue(self.db, j3)
        self.db.update("job", {"job_id": j3}, {"status": "SO4"})
        blocked = tracker.cancel(self.db, t3, reason="cost", now=self.now)
        self.assertFalse(blocked["cancelled"])
        self.assertIn("client care", blocked["reason"])
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (j3,))["status"], "SO4")

    def test_client_care_text_says_who_it_is_before_they_type_a_word(self):
        from wilson_service import tracker
        j = self._req()
        self.db.update("job", {"job_id": j}, {"sv_number": "SV00123999"})
        tok = tracker.issue(self.db, j)
        m = tracker.client_care_sms(self.db, tok)
        self.assertTrue(m["ok"])
        self.assertTrue(m["href"].startswith("sms:+15128940907?"), m["href"])
        self.assertIn("SV00123999", m["body"])
        self.assertIn("Jack", m["body"], "Client Care should not have to ask whose repair this is")
        self.assertTrue(m["body"].endswith(" "), "it leaves them somewhere to start typing")
        self.assertNotIn("?", m["body"], "generic means we do not put words in their mouth")

    # ---------------------------------------------------------------- warranty and shipping
    def test_warranty_carries_no_zone_fee_and_no_tax_either_way(self):
        """Cayden 9/19: "for warranty calls that go straight to so3 its automatically adding a zone fee here …
        True / Scotsman / Zephyr / Bluestar all pay cod … warranty calls will all be tax exempt"."""
        from wilson_service import labor
        cod = self._req()
        self.db.update("job", {"job_id": cod}, {"is_warranty": 1})
        self.db.insert("unit", {"job_id": cod, "brand": "True", "model": "TR-24BEV-R-SG-A", "category": "refrigerator"})
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (cod,))
        self.assertEqual(labor.warranty_kind(self.db, job), "cod")
        lines = labor.quote_labor_lines(self.db, job, [("Evaporator fan motor replacement", 1.5)])
        self.assertFalse([l for l in lines if l["code"].startswith("ZN")], "no zone fee on a warranty call")
        self.assertEqual([l["amount"] for l in lines], [195.0], "a COD brand prices labor like any other job")
        self.assertFalse(labor.taxable(self.db, job, "parts"))
        self.assertFalse(labor.taxable(self.db, job, "labor"))

        flat = self._req()
        self.db.update("job", {"job_id": flat}, {"is_warranty": 1})
        self.db.insert("unit", {"job_id": flat, "brand": "Monogram", "model": "ZIR361NBRII", "category": "refrigerator"})
        job2 = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (flat,))
        self.assertEqual(labor.warranty_kind(self.db, job2), "flat")
        lines2 = labor.quote_labor_lines(self.db, job2, [("Evaporator fan motor replacement", 1.5)])
        self.assertEqual([l["code"] for l in lines2], ["WTYMGRAM-MGRAM"], "the ePASS code the warranty admin keys")
        self.assertEqual(lines2[0]["amount"], 151.25, "Cayden's rate card, 9/19 pm — open item 47 is closed")
        self.assertIsNone(lines2[0]["hours"], "a flat rate is per claim, not per hour")

        # a COD job is unchanged: zone fee, priced labor, taxed parts
        plain = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (self._req(),))
        lines3 = labor.quote_labor_lines(self.db, plain, [("Door gasket replacement", 1.0)])
        self.assertTrue([l for l in lines3 if l["code"].startswith("ZN")])
        self.assertTrue(labor.taxable(self.db, plain, "parts"))

    def test_shipping_is_a_setting_kezia_can_move(self):
        """"kezia needs to be able to set shipping in case theres a special order or something we get charged
        more for than 25." So $25 is a default, not a constant."""
        self.assertEqual(float(self.db.setting("parts.shipping_default", 0)), 20.0)
        self.assertEqual([b.lower() for b in self.db.setting("warranty.cod_brands", [])],
                         ["true", "scotsman", "zephyr", "bluestar"])

    # ---------------------------------------------------------------- the damage report
    def test_damage_report_skips_the_diagnostic_and_waits_for_the_manager(self):
        """Cayden, with the form's screenshots: the report funnels into the service request queue, moves into
        unassigned, and goes to Mark Perks for the part number. There is no diagnostic — the installer already
        photographed the damage."""
        from wilson_service import damage
        with self.assertRaises(ValueError):
            damage.report(self.db, by="Foster Anzaldua", photos=2, tag_photo=False)
        with self.assertRaises(ValueError):
            damage.report(self.db, by="Foster Anzaldua", photos=0, tag_photo=True)
        rid = damage.report(self.db, by="Foster Anzaldua", truck="D03", invoice_code="R00015638",
                            customer_name="Sullivan, Ana", address="397 Bridge Water Loop, 78620", zip_code="78620",
                            brand="LG", model="DLEX6500B", serial="502KWTA3H409",
                            issue="Dent or ding", side="Right", spot="Bottom Right",
                            note="Boxed when I found it.", photos=3, tag_photo=True, now=self.now)
        r = damage.open_reports(self.db)[0]
        self.assertEqual(r["summary"], "Issue: Dent or ding — Right — Bottom Right",
                         "the line the service request queue has always printed")
        self.assertEqual(r["photo_count"], 4, "three of the damage plus the tag")
        self.assertEqual(r["state"], "new")
        self.assertIsNone(r["job_id"], "a report is not a ticket until the office says so")

        job_id = damage.to_job(self.db, rid, by="Michael Davidson", now=self.now)
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
        self.assertEqual(job["status"], "SO2", "no diagnostic — the photos are the findings")
        self.assertIsNone(job["assigned_tech_id"], "unassigned: nobody drives out to look at a photographed dent")
        self.assertIsNone(job["route_date"])
        mgr = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='MAP'")["tech_id"]
        self.assertEqual(job["owner_tech_id"], mgr, "it belongs to the service manager until he picks the part")
        self.assertEqual(job["source"], "damage_report")
        self.assertEqual(job["source_ref"], f"damage:{rid}")
        self.assertIn("Dent or ding", job["problem_text"])
        self.assertIn("Foster Anzaldua", job["problem_text"])
        u = self.db.fetchone("SELECT * FROM unit WHERE job_id=?", (job_id,))
        self.assertEqual((u["model"], u["serial"]), ("DLEX6500B", "502KWTA3H409"), "off the delivery invoice")
        self.assertTrue(self.db.fetchone("SELECT * FROM job WHERE job_id=? AND tracker_token IS NOT NULL", (job_id,)),
                        "the customer gets a link for a repair they never asked for")
        self.assertTrue(self.db.fetchone("SELECT * FROM outbox WHERE job_id=? AND effect='task:manager_part_number'", (job_id,)))
        # converting twice must not make a second ticket
        self.assertEqual(damage.to_job(self.db, rid, by="Michael Davidson", now=self.now), job_id)

        # the manager's review is the part number, and it refuses to proceed without one
        with self.assertRaises(ValueError):
            damage.order_part(self.db, rid, part_number="", part_desc="Outer door panel", eta="2026-09-24", by="Mark Perks")
        dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        out = damage.order_part(self.db, rid, part_number=" wr78x30063 ", part_desc="Outer door panel, stainless",
                                eta="2026-09-24", by="Mark Perks", fitting_tech_id=dla, now=self.now)
        self.assertEqual(out["status"], "SO4", "it holds at SO4 while the part is coming")
        self.assertEqual(out["part_number"], "WR78X30063")
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (job_id,))
        self.assertEqual(job["owner_tech_id"], dla, "the tech who fits it owns it from here")
        self.assertEqual(str(job["parts_eta"])[:10], "2026-09-24")
        rep = self.db.fetchone("SELECT * FROM damage_report WHERE report_id=?", (rid,))
        self.assertEqual((rep["state"], rep["reviewed_by"]), ("ordered", "Mark Perks"))
        self.assertFalse(damage.open_reports(self.db)[0]["state"] == "new")

        # from here it is an ordinary ticket: the part lands, the customer picks the window
        statuses.transition(self.db, job_id, "receiving.all_parts_in", "staff", "Kezia",
                            now=self.now + _dt.timedelta(days=5), bin_location="A12")
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (job_id,))["status"], "SO5")
        self.assertTrue(self.db.fetchone("SELECT * FROM outbox WHERE job_id=? AND effect='notify:part_arrived_pick_time'", (job_id,)),
                        "the customer is asked to pick a time, on the same tracker as everyone else")
        statuses.transition(self.db, job_id, "customer.picked_window", "customer", "customer",
                            now=self.now + _dt.timedelta(days=5), tech_id=dla, route_date="2026-09-29", window="AM")
        self.assertEqual(self.db.fetchone("SELECT status FROM job WHERE job_id=?", (job_id,))["status"], "SO6")


class T14RateCard0919pm(unittest.TestCase):
    """9/19 pm: the warranty rate card Cayden sent, freight, and the ETA buckets."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 19, 14, 0)

    def _wty(self, brand, model="", job_type="appliance"):
        j = statuses.create_request(self.db, customer={"name": "Ort, Jack", "phone": "5125551234"},
                                    address={"line1": "319 Creek Ln", "zip": "78620"},
                                    problem_text="x", card_saved=True, now=self.now)
        self.db.update("job", {"job_id": j}, {"is_warranty": 1, "job_type": job_type})
        self.db.insert("unit", {"job_id": j, "brand": brand, "model": model, "category": "refrigerator"})
        return self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))

    def test_every_brand_on_the_card_prices(self):
        from wilson_service import labor
        self.assertEqual(len(labor.WTY_RATES), 30, "thirty brands on Cayden's 9/19 card")
        for key, row in labor.WTY_RATES.items():
            self.assertGreater(row["std"], 0, key)
            self.assertTrue(row["code"], f"{key} needs an ePASS labor code for the packet")
            if row["sealed"]:
                self.assertGreater(row["sealed"], row["std"], f"{key}: sealed work is the dearer rate")

    def test_the_rates_cayden_sent_are_the_rates_quoted(self):
        from wilson_service import labor
        for brand, expected, code in [("Sub-Zero", 174.0, "WTYSZ-SZ"), ("Wolf", 174.0, "WTYWOLF-WOLF"),
                                      ("Whirlpool", 113.68, "WTYWP-WP"), ("LG", 110.0, "WTYLG-LG"),
                                      ("Monogram", 151.25, "WTYMGRAM-MGRAM"), ("Miele", 165.0, "WTYMIELE-MIELE"),
                                      ("Speed Queen", 150.0, "WTY1-SPEED"), ("Bosch", 160.0, "WTYBSH-BOSCH")]:
            job = self._wty(brand)
            lines = labor.quote_labor_lines(self.db, job, [("Door gasket replacement", 1.0)])
            self.assertEqual(len(lines), 1, f"{brand}: one flat rate for the claim, no zone fee")
            self.assertEqual((lines[0]["amount"], lines[0]["code"]), (expected, code), brand)

    def test_a_sealed_system_claim_takes_the_sealed_rate(self):
        from wilson_service import labor
        job = self._wty("Sub-Zero", "BI-36U")
        flat = labor.quote_labor_lines(self.db, job, [("Door gasket replacement", 1.0)])[0]
        self.assertEqual(flat["amount"], 174.0)
        sealed = labor.quote_labor_lines(self.db, job, [("Compressor / sealed system repair", 3.0)])[0]
        self.assertEqual(sealed["amount"], 420.0, "Sub-Zero sealed is the biggest number on the card")
        self.assertEqual(sealed["code"], "WTYSZ-SEALEDSYS", "and ePASS has its own code for it")
        self.assertTrue(sealed["sealed"])
        # a brand with no sealed rate says so rather than quietly billing the standard one as if it covered it
        wolf = labor.warranty_rate(self.db, self._wty("Wolf"), [("Sealed system repair", 3.0)])
        self.assertEqual(wolf["amount"], 174.0)
        self.assertTrue(wolf["no_sealed_rate"], "Wolf has no sealed rate on the card — flag it, don't hide it")
        # ⟨9/19 late audit⟩ 'condenser' alone used to match a condenser FAN motor; and a job's category never makes it sealed
        fan = labor.warranty_rate(self.db, self._wty("KitchenAid"), [("Condenser Fan Motor/Blade Replacement", 1.0)])
        self.assertEqual(fan["amount"], 113.68, "a condenser fan motor is ordinary work")
        self.assertFalse(fan["sealed"])
        coils = labor.warranty_rate(self.db, self._wty("KitchenAid"), [("Vacuum and/or Clean Condenser Coils", 0.5)])
        self.assertFalse(coils["sealed"])
        real = labor.warranty_rate(self.db, self._wty("KitchenAid"), [("Sealed System - Compressor, Filter Drier Replacement", 6.0)])
        self.assertEqual((real["amount"], real["code"]), (237.74, "WTYSEALEDSYS-KA"))

    def test_one_flat_rate_however_many_tasks(self):
        from wilson_service import labor
        job = self._wty("KitchenAid")
        one = labor.quote_labor_lines(self.db, job, [("Drain pump replacement", 1.0)])
        three = labor.quote_labor_lines(self.db, job, [("Drain pump replacement", 1.0),
                                                       ("Door gasket replacement", 1.0), ("Control board replacement", 1.5)])
        self.assertEqual(len(three), 1, "a flat rate is for the claim, not per task")
        self.assertEqual(one[0]["amount"], three[0]["amount"], 113.68)
        self.assertIn("Drain pump", three[0]["desc"])
        self.assertIn("Control board", three[0]["desc"], "the line still says what was done")

    def test_a_brand_we_have_no_rate_for_says_so(self):
        from wilson_service import labor
        line = labor.quote_labor_lines(self.db, self._wty("Smeg"), [("Door gasket replacement", 1.0)])[0]
        self.assertEqual(line["amount"], 0.0)
        self.assertTrue(line["needs_rate_card"], "better an honest blank than an invented rate")

    def test_cod_brands_still_ignore_the_card(self):
        from wilson_service import labor
        job = self._wty("True")
        self.assertEqual(labor.warranty_kind(self.db, job), "cod")
        lines = labor.quote_labor_lines(self.db, job, [("Evaporator fan motor replacement", 1.5)])
        self.assertEqual([l["amount"] for l in lines], [195.0], "True pays our COD rate — hours x $130, no flat rate")
        self.assertFalse([l for l in lines if l["code"].startswith("ZN")], "still no zone fee though")

    def test_freight(self):
        """Cayden 9/19 pm: "we use the code freight in epass for s&h. that should be coded as taxed … shipping should
        just default to $20 unless kezia changes it … no freight on warranty stuff"."""
        from wilson_service import labor
        cod = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (statuses.create_request(
            self.db, customer={"name": "Ort, Jack"}, address={"line1": "319 Creek Ln", "zip": "78620"},
            problem_text="x", card_saved=True, now=self.now),))
        line = labor.shipping_line(self.db, cod)
        self.assertEqual((line["code"], line["amount"], line["taxable"]), ("FREIGHT", 20.0, True))
        self.assertTrue(line["auto"], "the standard figure, nobody touched it")
        over = labor.shipping_line(self.db, cod, override=187.5)
        self.assertEqual(over["amount"], 187.5)
        self.assertFalse(over["auto"], "an override is visible as one")
        self.assertIsNone(labor.shipping_line(self.db, self._wty("Bosch")), "no freight on warranty")
        self.assertIsNone(labor.shipping_line(self.db, self._wty("Bosch"), override=90), "not even an overridden one")

    def test_eta_buckets_are_cayden_s_words(self):
        buckets = self.db.setting("parts.eta_buckets", [])
        self.assertEqual([b[0] for b in buckets], ["in_state", "out_of_state", "cross_country", "backorder"])
        self.assertEqual([b[1] for b in buckets][:3], ["In state", "Out of state", "Cross country"],
                         "'in stock' was never what it meant — it is where it ships from")
        self.assertEqual([b[2] for b in buckets][:3], [2, 3, 7], "1-2 days, 2-3 days, 5-7 days")
        self.assertEqual(int(self.db.setting("parts.backorder_days", 0)), 10)


class T15InShop0919pm(unittest.TestCase):
    """9/19 pm: in-shop tickets — their own lane, bench days that get counted, the tattle, and the delivery owed."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 19, 9, 0)
        self.dla = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='DLA'")["tech_id"]
        self.map_ = self.db.fetchone("SELECT tech_id FROM tech WHERE sp_code='MAP'")["tech_id"]

    def _job(self):
        return statuses.create_request(self.db, customer={"name": "Ort, Jack", "phone": "5125551234"},
                                       address={"line1": "319 Creek Ln", "zip": "78620"},
                                       problem_text="Intermittent, won't fault on site", card_saved=True, now=self.now)

    def test_the_tech_can_take_it_with_him(self):
        """Cayden: "sometimes our techs bring appliances from a house while they are on the so1 call for further eval
        in shop … the tool needs to remember the appliance needs to be delivered on the so6 trip"."""
        from wilson_service import shop
        j = self._job()
        statuses.transition(self.db, j, "customer.picked_window", "customer", "customer", now=self.now,
                            tech_id=self.dla, route_date="2026-09-22", window="AM")
        shop.take_in(self.db, j, tech_id=self.dla, note="Would not fault on site — wants a day on the bench.", now=self.now)
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["status"], "SI1")
        self.assertIsNone(job["route_date"], "it is off the route — it is not a visit any more")
        self.assertIsNone(job["promised_window_start"], "and it has no arrival window, because nobody is waiting in")
        self.assertEqual(job["owner_tech_id"], self.dla, "it stays his: he has it on his van")
        self.assertTrue(self.db.fetchone("SELECT * FROM outbox WHERE job_id=? AND effect='flag:delivery_owed'", (j,)),
                        "we took it off their floor — the tool owes them a delivery back")
        h = self.db.fetchone("SELECT * FROM status_history WHERE job_id=? ORDER BY history_id DESC", (j,))
        self.assertEqual((h["trigger_event"], h["actor_type"]), ("tech.taking_to_shop", "tech"))
        self.assertIn("bench", h["note"])

    def test_bench_days_are_counted_and_the_third_is_marks_problem(self):
        """"si jobs historically get moved a lot … build a notification that taddles on the tech for not getting in
        shops done and puts it in marks notification if it has been scheduled more than twice"."""
        from wilson_service import shop
        j = self._job()
        shop.take_in(self.db, j, tech_id=self.dla, now=self.now)
        first = shop.bench(self.db, j, tech_id=self.dla, work_date="2026-09-21", now=self.now)
        self.assertEqual((first["times"], first["escalated"]), (1, False))
        second = shop.bench(self.db, j, tech_id=self.dla, work_date="2026-09-22", now=self.now)
        self.assertEqual((second["times"], second["escalated"]), (2, False), "twice is bad luck")
        third = shop.bench(self.db, j, tech_id=self.dla, work_date="2026-09-23", now=self.now)
        self.assertTrue(third["escalated"], "three times is a pattern")
        nag = self.db.fetchone("SELECT * FROM outbox WHERE job_id=? AND effect='task:manager_shop_stalled'", (j,))
        self.assertIsNotNone(nag, "and the person told is the service manager, by name")
        pay = json.loads(nag["payload"])
        self.assertEqual((pay["times"], pay["tech_id"], pay["to"]), (3, self.dla, self.map_))
        # scheduling it does not give it a window — a bench day is not an appointment
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertEqual(job["route_date"], "2026-09-23")
        self.assertIsNone(job["promised_window_start"])
        # and once it is repaired, putting it on a day stops escalating
        shop.repaired(self.db, j, by="Kezia", now=self.now)
        self.assertEqual(shop.floating(self.db), [], "a finished unit is not floating")

    def test_repaired_ends_two_different_ways(self):
        from wilson_service import shop
        taken = self._job()
        shop.take_in(self.db, taken, tech_id=self.dla, deliver=True, now=self.now)
        r1 = shop.repaired(self.db, taken, by="Kezia", now=self.now)
        self.assertEqual(r1["effect"], "notify:si_ready_pick_return", "we took it — the customer picks a window for it back")
        self.assertTrue(r1["deliver"])
        dropped = self._job()
        shop.take_in(self.db, dropped, tech_id=self.dla, deliver=False, now=self.now)
        r2 = shop.repaired(self.db, dropped, by="Kezia", now=self.now)
        self.assertEqual(r2["effect"], "notify:si_ready_collect", "they brought it — they collect it")
        for jid in (taken, dropped):
            job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (jid,))
            self.assertEqual(job["status"], "SI5")
            self.assertIsNone(job["route_date"], "it comes off the bench day when it is done")

    def test_the_customer_is_not_texted_about_parts_on_a_bench_job(self):
        """"these should ignore customer notification rules. customer can still view tracker, but we dont want to send
        them a text on part arrival"."""
        from wilson_service import shop, tracker
        j = self._job()
        shop.take_in(self.db, j, tech_id=self.dla, now=self.now)
        job = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (j,))
        self.assertTrue(shop.muted(job, "notify:part_arrived_pick_time"))
        self.assertTrue(shop.muted(job, "notify:parts_ordered"))
        self.assertFalse(shop.muted(job, "notify:si_ready_pick_return"), "the one that IS news still goes")
        self.assertFalse(shop.muted(job, "notify:receipt"))
        routed = self.db.fetchone("SELECT * FROM job WHERE job_id=?", (self._job(),))
        self.assertFalse(shop.muted(routed, "notify:part_arrived_pick_time"), "a routed job is unaffected")
        # the page is still theirs to open — muting a text is not hiding the job
        self.assertIsNotNone(tracker.resolve(self.db, tracker.issue(self.db, j), now=self.now))

    def test_the_lane_puts_the_floating_ones_first(self):
        from wilson_service import shop
        quiet, stale = self._job(), self._job()
        shop.take_in(self.db, quiet, tech_id=self.dla, now=self.now)
        shop.take_in(self.db, stale, tech_id=self.dla, now=self.now)
        for d in ("2026-09-21", "2026-09-22", "2026-09-23"):
            shop.bench(self.db, stale, tech_id=self.dla, work_date=d, now=self.now)
        lane = shop.open_units(self.db)
        self.assertEqual(len(lane), 2)
        self.assertEqual(lane[0]["job_id"], stale, "the one that has been promised three days and touched none")
        self.assertEqual(lane[0]["times_scheduled"], 3)
        self.assertTrue(lane[0]["delivery_owed"])
        self.assertFalse(lane[1]["floating"])


class T16QuoteLifecycle0919pm(unittest.TestCase):
    """9/19 pm: every quote reviewed, three days of silence, and the quote that is kept so it can be reopened."""

    def setUp(self):
        self.db = fresh_db()

    def test_the_rules_cayden_answered(self):
        self.assertEqual(int(self.db.setting("quote.review_all", 0)), 1,
                         "every quote needs review — there is no dollar threshold that lets one out unseen")
        self.assertEqual(int(self.db.setting("quote.silence_days", 0)), 3, "three days, not fourteen")
        self.assertEqual(int(self.db.setting("quote.keep_closed_days", 0)), 90,
                         "a closed quote keeps its lines, because the customer who goes quiet often comes back")
        self.assertEqual(int(self.db.setting("quote.diag_credit_on_reopen", 0)), 1)
        self.assertEqual(int(self.db.setting("quote.diag_credit_on_replacement", 0)), 1,
                         "on a discontinued part the fee stands, and the customer is told it credits against a replacement")


class T17FindingsIntoHistory0919late(unittest.TestCase):
    """9/19 late — Cayden: "where are tech notes stored for current jobs? where do their findings recorded in field tool
    end up? we do need this to record their notes into history."  Every visit is now a `findings` row, and the history
    reader returns it in one list with the twenty-year ePASS catalogue."""

    def setUp(self):
        self.db = fresh_db()
        self.now = _dt.datetime(2026, 9, 17, 9, 40)
        self.dla = self.db.scalar("SELECT tech_id FROM tech WHERE sp_code='DLA'")
        self.job = statuses.create_request(self.db, customer={"name": "Baird, Leah", "phone": "5125550100"},
                                           address={"line1": "4946 Farm To Market 165", "zip": "78620"},
                                           unit={"category": "washer", "install_type": "freestanding", "brand": "GE", "model": "GTW465ASN9WW", "serial": "AV911160G"},
                                           problem_text="Won't drain, standing water after the cycle", card_saved=True, now=self.now)
        statuses.transition(self.db, self.job, "customer.picked_window", "customer", "web", route_date="2026-09-17", window="AM", tech_id=self.dla, now=self.now)

    def _submit(self, **kw):
        ctx = dict(outcome="office_quote", tech_id=self.dla, symptoms=["Won't drain", "Error code"], error_code="E24",
                   cause="Failed component — drain pump", custom_note="pump hums, no flow",
                   lines=[{"kind": "part", "code": "", "desc": "Drain pump", "qty": 1},
                          {"kind": "labor", "code": "LAB-WASH-PUMP", "desc": "Pump/Pump Motor Replacement", "hours": 1.0}],
                   flags=["Return trip required"], note="Customer wants a call before we order.",
                   on_site_minutes=42, photo_count=2, now=self.now.replace(hour=10, minute=25))
        ctx.update(kw)
        return statuses.transition(self.db, self.job, "tech.findings_submitted", "tech", "DLA", **ctx)

    def test_submit_writes_a_findings_row_that_reads_like_the_catalogue(self):
        r = self._submit()
        self.assertEqual(r["to"], "SO2")
        rows = findings.for_job(self.db, self.job)
        self.assertEqual(len(rows), 1, "one visit, one row")
        f = rows[0]
        self.assertEqual(f["sp_code"], "DLA")
        self.assertEqual(f["visit_date"], "2026-09-17")
        self.assertEqual(f["to_status"], "SO2", "the row knows what the visit produced")
        self.assertEqual(f["symptoms"], ["Won't drain", "Error code"])
        self.assertEqual(f["error_code"], "E24")
        self.assertEqual(f["on_site_minutes"], 42)
        self.assertEqual(len(f["parts"]), 1)
        self.assertEqual(len(f["labor"]), 1)
        # the sentence the office and the next tech read — same register as service_detail.performed_desc
        self.assertEqual(f["performed_text"],
                         "Found: Won't drain; error code E24; pump hums, no flow. Cause: Failed component — drain pump. "
                         "Parts needed: Drain pump (no number yet). Labor: Pump/Pump Motor Replacement 1.0 h. Return trip required. "
                         "Note for the office: Customer wants a call before we order. Outcome: office_quote · SO2.")
        self.assertIn("(no number yet)", f["performed_text"], "a blank part number is said, never invented")

    def test_history_is_one_list_across_epass_and_the_dashboard(self):
        # a closed 2024 call from the ePASS catalogue on the same customer and the same serial
        cid = self.db.scalar("SELECT customer_id FROM job WHERE job_id=?", (self.job,))
        self.db.insert("service_history", {"sv_number": "SV00099120", "customer_id": cid, "epass_status": "SO8", "created_date": "2024-03-04",
                                           "finish_date": "2024-03-06", "sp_code": "TDP", "ticket_kind": "field"})
        self.db.insert("service_detail", {"sv_number": "SV00099120", "complaint_desc": "LEAKING FROM UNDERNEATH", "performed_desc": "REPLACED DRAIN HOSE AND CLAMP. TESTED OK.",
                                          "brand_code": "GE", "model": "GTW465ASN9WW", "serial": "AV911160G", "product_code": "WASHT"})
        self._submit()
        h = findings.history(self.db, customer_id=cid)
        self.assertEqual([x["source"] for x in h], ["dashboard", "epass"], "newest first, both worlds in one list")
        self.assertEqual(h[0]["date"], "2026-09-17")
        self.assertTrue(h[0]["did"].startswith("Found: Won't drain"))
        self.assertEqual(h[0]["said"], "Won't drain, standing water after the cycle", "what the customer said stays separate from what we did")
        self.assertEqual(h[1]["sv"], "SV00099120")
        self.assertEqual(h[1]["did"], "REPLACED DRAIN HOSE AND CLAMP. TESTED OK.")
        # by serial: the appliance keeps its record whoever owns it
        hs = findings.history(self.db, serial="av911160g")
        self.assertEqual([x["sv"] for x in hs][-1], "SV00099120")
        self.assertEqual(hs[0]["source"], "dashboard")

    def test_every_visit_event_records_not_only_the_first(self):
        self._submit()
        # the install trip: SO2 -> approve -> order -> arrive -> book -> complete, then the second visit is a row too
        j = self.job
        statuses.transition(self.db, j, "parts.verified", "staff", "KKD", lines=[{"kind": "part", "code": "W10730972", "desc": "Drain pump", "qty": 1, "price": 132}], now=self.now)
        statuses.transition(self.db, j, "customer.approved", "customer", "web", now=self.now)
        statuses.transition(self.db, j, "po.placed", "staff", "KKD", eta_days=3, now=self.now)
        statuses.transition(self.db, j, "receiving.all_parts_in", "staff", "KKD", bin_location="SV05", now=self.now)
        statuses.transition(self.db, j, "customer.picked_window", "customer", "web", route_date="2026-09-22", window="AM", tech_id=self.dla, now=self.now)
        statuses.transition(self.db, j, "tech.repair_complete", "tech", "DLA", tech_id=self.dla, parts_installed=True, amount=None,
                            lines=[{"kind": "labor", "desc": "Pump/Pump Motor Replacement", "hours": 1.0}], symptoms=[], note="Tested three cycles.",
                            on_site_minutes=55, now=_dt.datetime(2026, 9, 22, 9, 10))
        rows = findings.for_job(self.db, j)
        self.assertEqual([r["to_status"] for r in rows], ["SO8", "SO2"], "newest first: the install trip, then the diagnostic")
        self.assertIn("Tested three cycles", rows[0]["performed_text"])
        self.assertEqual(rows[0]["visit_date"], "2026-09-22")
        # and the sync NOTE still carries only a 200-char summary — nothing is re-typed into ePASS
        self.assertLessEqual(len(sync.build_note(sv_number="SV00123478", summary=rows[1]["performed_text"], photo_count=2).split("Full findings")[0]), 220)
