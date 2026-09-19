"""Emit proto_history.js + proto_index.js — the ePASS back catalogue for the office prototype.

    python3 buildhistory.py            (expects /tmp/hist.db, built by the history + full-export importers)

Two files, because 9/17 testing found "ort" and "palomino" did not resolve — the prototype only carried 60
households and the search could only find those.

* **proto_index.js** — every customer on file, one compact row each: id, name, street, zip, visits, last
  year, flags. This is what the search box reads, so any name or any address resolves. It is grouped by
  address in the UI because appliances don't move: 1509 Palomino Ridge Dr has five ePASS accounts over
  twenty years (Carol Call ×41, Lonsdale Enterprises ×18, Josh Hernandez ×5 ...) and the office wants the
  house, not whichever name happened to be typed on the last ticket.
* **proto_history.js** — the full record for the households the office will actually meet in testing:
  every address behind the 615 open tickets, the deepest histories, the Do-Not-Service flags, the
  repeat units, the duplicate-address clusters, and the ones Cayden named. Each history row carries what
  was done (complaint, performed, parts installed) from the ODBC export so an SV opens to something, and
  each asset carries brand, model and serial. Anyone found in the index but outside this set shows the
  index row and says the full record loads from the server in the real build.

Customer phone and email are masked, as everywhere else in the prototypes.
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "repo", "phase0"))
from wilson_service.db import DB                                        # noqa: E402
from wilson_service.importers import history as H                       # noqa: E402
from wilson_service.importers.fullexport import tidy, model_family      # noqa: E402
from linkrule import Index                                              # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DBP = "/tmp/hist.db"
MAX_HIST = 10
MAX_ASSETS = 8
NAMED = ["ORT", "PALOMINO RIDGE", "BAIRD"]         # Cayden 9/17 test cases, plus the DNS one


def mask_phone(v):
    d = re.sub(r"\D", "", str(v or ""))
    return f"(•••) •••-{d[-4:]}" if len(d) >= 10 else ""


def mask_email(e):
    e = (e or "").strip()
    if "@" not in e:
        return ""
    u, _, dom = e.partition("@")
    return (u[0] + "•" * max(1, len(u) - 1)) + "@" + dom


def js(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def cut(s, n):
    s = tidy(s or "").strip()
    return s if len(s) <= n else s[:n - 1].rsplit(" ", 1)[0] + "…"


def street_of(hk):
    return (hk or "|").split("|")[0].title().replace(" Dr", " Dr").strip()


def visit_detail(db, sv):
    d = db.fetchone("SELECT complaint_desc, performed_desc, product_code, brand_code, model, serial, in_warranty,"
                    " item_total, labor_total, trip_charge FROM service_detail WHERE sv_number=?", (sv,)) or {}
    parts = db.fetchall("SELECT item_desc, item_code, qty_shipped, installed, selling_price FROM service_part"
                        " WHERE sv_number=? AND item_desc IS NOT NULL ORDER BY installed DESC, part_line_id LIMIT 6", (sv,))
    labor = db.fetchall("SELECT tech_code, labor_desc, service_date FROM service_labor WHERE sv_number=?"
                        " ORDER BY labor_line_id LIMIT 2", (sv,))
    o = {"c": cut(d.get("complaint_desc"), 200), "p": cut(d.get("performed_desc"), 300),
         "pc": d.get("product_code") or "", "m": d.get("model") or "",
         "parts": [{"d": cut(x["item_desc"], 60), "n": x["item_code"] or "", "i": 1 if x["installed"] else 0}
                   for x in parts]}
    if d.get("in_warranty"):
        o["iw"] = 1
    lab = [cut(x["labor_desc"], 60) for x in labor if x["labor_desc"] and "SERVICE CALL" not in (x["labor_desc"] or "").upper()]
    if lab:
        o["lab"] = lab
    return o


def main():
    db = DB.sqlite(DBP)
    realdata = os.path.join(HERE, "realdata.json")
    jobs = json.load(open(realdata))["jobs"] if os.path.exists(realdata) else []
    idx = Index(db)

    # ---------------------------------------------------------------- 1. which households get the full record
    picked, seen = [], set()

    def take(cids, why):
        for cid in cids:
            if cid in seen:
                continue
            seen.add(cid)
            picked.append((cid, why))

    # today's open calls, resolved by address -> every account at that address
    open_by_cust = {}
    for j in jobs:
        r = idx.resolve(j["addr"], j["zip"], j.get("last") or j["cust"])
        if r["cid"]:
            take([a["cid"] for a in r["accounts"]] or [r["cid"]], "open")
            open_by_cust.setdefault(r["cid"], []).append(
                {"sv": j["sv"], "st": j["st"], "tech": j["tech"] or "", "day": j["day"] or "",
                 "unit": f"{j['brand']} {j['cat']}".strip(), "serial": j.get("serial") or "", "model": j.get("model") or ""})
    for term in NAMED:          # a surname exactly, or a street name as a whole word — never a substring ('ORT' is not 'FORT')
        take([r["customer_id"] for r in db.fetchall(
            "SELECT customer_id FROM customer WHERE UPPER(COALESCE(last_name,''))=?"
            " OR UPPER(COALESCE(display_name,'')) LIKE ? OR UPPER(COALESCE(household_key,'')) LIKE ?",
            (term, f"% {term}", f"% {term} %"))], "named")
    take([r["customer_id"] for r in db.fetchall(
        "SELECT customer_id FROM customer WHERE do_not_service=1 AND service_count>0 ORDER BY service_count DESC LIMIT 12")], "dns")
    take([r["customer_id"] for r in db.fetchall(
        "SELECT c.customer_id FROM customer c JOIN asset a ON a.customer_id=c.customer_id"
        " WHERE a.service_count>=6 GROUP BY c.customer_id ORDER BY MAX(a.service_count) DESC LIMIT 30")], "repeat-unit")
    take([r["customer_id"] for r in db.fetchall(
        "SELECT customer_id FROM customer WHERE household_key IN (SELECT household_key FROM customer WHERE household_key"
        " IS NOT NULL GROUP BY household_key HAVING COUNT(*)>2) AND service_count>0 ORDER BY service_count DESC LIMIT 40")], "dup-address")
    take([r["customer_id"] for r in db.fetchall(
        "SELECT customer_id FROM customer WHERE service_count>3 ORDER BY lifetime_value DESC LIMIT 60")], "deep")
    # and every sibling account at any picked address, so the address view is never half a house
    sib = set()
    for cid, _ in list(picked):
        hk = db.fetchone("SELECT household_key FROM customer WHERE customer_id=?", (cid,))["household_key"]
        if hk:
            sib.update(r["customer_id"] for r in db.fetchall(
                "SELECT customer_id FROM customer WHERE household_key=? AND service_count>0", (hk,)))
    take(sorted(sib), "sibling")            # zero-visit siblings come from the index, not the full record

    # ---------------------------------------------------------------- 2. the full records
    out = []
    for cid, why in picked:
        h = H.household(db, cid)
        if not h:
            continue
        c = h["customer"]
        addr = db.fetchone("SELECT line1, city, state, zip FROM address WHERE customer_id=? ORDER BY address_id LIMIT 1", (cid,)) or {}
        assets = h["assets"][:MAX_ASSETS]
        by_asset = {a["asset_id"]: a for a in h["assets"]}
        hist = []
        for x in h["history"][:MAX_HIST]:
            a = by_asset.get(x["asset_id"]) if x["asset_id"] else None
            hist.append(dict({
                "sv": x["sv_number"].strip(), "d": x["created_date"] or "", "fin": x["finish_date"] or "",
                "st": x["epass_status"] or "", "sp": x["sp_code"] or "", "amt": round(float(x["total"] or 0), 2),
                "zone": x["map_zone"] or "", "units": x["units"] or 1, "kind": x["ticket_kind"] or "field",
                "payer": x["payer_name"] or "", "pk": x["payer_kind"] or "", "src": x["identity_source"],
                "aid": x["asset_id"] or 0, "ser": (a and a["serial"]) or "", "mod": (a and a["model"]) or "", "br": (a and a["brand"]) or "",
            }, **visit_detail(db, x["sv_number"].strip())))
        out.append({
            "id": cid, "name": c["display_name"] or "", "code": c["epass_customer_code"] or "",
            "phone": mask_phone(c["phone_primary"]), "email": mask_email(c["email"]),
            "addr": (addr.get("line1") or street_of(c.get("household_key")) or ""),
            "city": addr.get("city") or "", "zip": addr.get("zip") or (c.get("household_key") or "|").split("|")[-1],
            "hk": c.get("household_key") or "",
            "visits": c["service_count"] or 0, "first": c["first_service"] or "", "last": c["last_service"] or "",
            "ltv": round(float(c["lifetime_value"] or 0), 2),
            "dns": 1 if c["do_not_service"] else 0, "dnsNote": (c["do_not_service_note"] or "")[:80],
            "why": why, "open": open_by_cust.get(cid, []),
            "also": [{"id": a["customer_id"], "name": a["display_name"] or "", "code": a["epass_customer_code"] or "",
                      "visits": a["service_count"] or 0, "last": a["last_service"] or "", "dns": 1 if a.get("do_not_service") else 0}
                     for a in h["also_at_address"]],
            "assets": [{"aid": a["asset_id"], "brand": a["brand"] or "", "model": a["model"] or "", "serial": a["serial"],
                        "fam": model_family(a["brand"] or "", "", a["model"] or "")["stem"],
                        "n": a["service_count"] or 0, "first": a["first_seen"] or "", "last": a["last_seen"] or "",
                        "same": len(a.get("same_as") or []),
                        "bought": 1 if a.get("purchased_from_us") else 0, "boughtOn": a.get("purchase_date") or "",
                        "svs": [x["sv"] for x in hist if x["aid"] == a["asset_id"]]}
                       for a in assets],
            "hist": hist,
        })

    # ---------------------------------------------------------------- 3. the index: everyone
    full = {o["id"] for o in out}
    index = []
    for r in db.fetchall("SELECT customer_id, display_name, household_key, service_count, last_service, do_not_service,"
                         " phone_primary FROM customer ORDER BY customer_id"):
        hk = r["household_key"] or "|"
        street, z = hk.split("|")[0], hk.split("|")[-1] if "|" in hk else ""
        index.append([r["customer_id"], (r["display_name"] or "")[:48], street.title()[:40], z,
                      r["service_count"] or 0, (r["last_service"] or "")[:4],
                      (1 if r["do_not_service"] else 0) + (2 if r["customer_id"] in full else 0),
                      re.sub(r"\D", "", str(r["phone_primary"] or ""))[-4:]])

    stats = {
        "customers": db.fetchone("SELECT COUNT(*) n FROM customer")["n"],
        "withHistory": db.fetchone("SELECT COUNT(*) n FROM customer WHERE service_count>0")["n"],
        "tickets": db.fetchone("SELECT COUNT(*) n FROM service_history")["n"],
        "assets": db.fetchone("SELECT COUNT(*) n FROM asset")["n"],
        "payers": db.fetchone("SELECT COUNT(*) n FROM payer WHERE kind<>'household'")["n"],
        "dns": db.fetchone("SELECT COUNT(*) n FROM customer WHERE do_not_service=1")["n"],
        "repeatUnits": db.fetchone("SELECT COUNT(*) n FROM asset WHERE service_count>1")["n"],
        "dupAddr": db.fetchone("SELECT COUNT(*) n FROM (SELECT household_key FROM customer WHERE household_key IS NOT NULL GROUP BY household_key HAVING COUNT(*)>1) t")["n"],
        "span": [db.fetchone("SELECT MIN(created_date) d FROM service_history WHERE created_date>'2000'")["d"],
                 db.fetchone("SELECT MAX(created_date) d FROM service_history")["d"]],
        "identity": {r["identity_source"]: r["n"] for r in db.fetchall(
            "SELECT identity_source, COUNT(*) n FROM service_history GROUP BY identity_source")},
        "detailed": len(out), "detailedVisits": sum(len(o["hist"]) for o in out),
        "sales": db.fetchone("SELECT COUNT(*) n FROM sale")["n"],
        "assetsBought": db.fetchone("SELECT COUNT(*) n FROM asset WHERE purchased_from_us=1")["n"],
    }
    p1 = os.path.join(HERE, "proto_history.js")
    with open(p1, "w", encoding="utf-8") as f:
        f.write("/* generated by buildhistory.py from the ePASS back catalogue — do not hand-edit */\n")
        f.write(f"const REAL_HH={js(out)};\n")
        f.write(f"const REAL_HHSTATS={js(stats)};\n")
    p2 = os.path.join(HERE, "proto_index.js")
    with open(p2, "w", encoding="utf-8") as f:
        f.write("/* generated by buildhistory.py — every customer on file: [id,name,street,zip,visits,lastYear,flags(1=DNS,2=full record here),phone4]. do not hand-edit */\n")
        f.write(f"const REAL_IDX={js(index)};\n")
    print(f"households {len(out)} · {stats['detailedVisits']} history rows · {sum(len(h['assets']) for h in out)} assets · "
          f"{os.path.getsize(p1):,} bytes   |   index {len(index):,} rows · {os.path.getsize(p2):,} bytes")
    print("mix:", collections.Counter(w for _, w in picked).most_common())
    for o in out:
        if "ORT" == (o["name"].split()[-1].upper() if o["name"] else "") or "PALOMINO" in o["hk"]:
            print("  named:", o["id"], o["name"], o["addr"], o["zip"], o["visits"], "assets", len(o["assets"]), "also", len(o["also"]))


if __name__ == "__main__":
    main()
