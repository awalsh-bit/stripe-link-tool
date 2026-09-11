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

from wilson_service import schema, seed, statuses, stuck, sync
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
        for reserved in (" key ", " date ", " at ", " trigger "):
            self.assertNotIn(reserved, m.lower().replace("\n", " "))

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
