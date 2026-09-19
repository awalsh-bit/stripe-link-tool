"""Emit proto_links.js — the service history behind the calls that are open right now.

    python3 buildlinks.py       (expects /tmp/hist.db and realdata.json)

The board and the field tool both show *open* tickets, and open tickets are not in the back catalogue —
the two sets are disjoint. So the link between them is the **household**, resolved the same way the
importer resolves a warranty ticket: normalised street + zip first, then surname + zip.

77.6% of the 460 open calls land on an address we have been to before, and 102 of them on a household
with ten or more prior visits. That is the number that makes this worth wiring into the board and the
van rather than leaving it in the office tab.

Kept deliberately small — a summary plus the last few visits per SV, not the whole record — because
this rides inside two prototypes that already carry their own data. The office tab stays the place to
go deep.
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "repo", "phase0"))
from wilson_service.db import DB                                        # noqa: E402
from wilson_service.importers.history import address_key, surname_key   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_VISITS = 6          # per open call, newest first
MAX_UNITS = 5


def js(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def norm_serial(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def main():
    db = DB.sqlite("/tmp/hist.db")
    jobs = json.load(open(os.path.join(HERE, "realdata.json")))["jobs"]

    by_addr, by_sur = {}, {}
    for c in db.fetchall("SELECT customer_id, household_key, last_name, service_count FROM customer WHERE service_count>0"):
        if c["household_key"]:
            by_addr.setdefault(c["household_key"], c["customer_id"])
        if c["last_name"] and c["household_key"] and "|" in c["household_key"]:
            by_sur.setdefault(f"{c['last_name'].upper().split()[0]}|{c['household_key'].split('|')[1]}", c["customer_id"])
    for a in db.fetchall("SELECT a.customer_id, a.address_key FROM address a JOIN customer c"
                         " ON c.customer_id=a.customer_id WHERE a.address_key IS NOT NULL AND c.service_count>0"):
        by_addr.setdefault(a["address_key"], a["customer_id"])

    out, matched = {}, 0
    for j in jobs:
        ak = address_key(j["addr"], j["zip"])
        sk = surname_key(j.get("last") or j["cust"], j["zip"])
        cid = by_addr.get(ak)
        how = "address"
        if cid is None:
            cid, how = by_sur.get(sk), "surname"
        if cid is None:
            continue
        matched += 1
        c = db.fetchone("SELECT display_name, epass_customer_code, service_count, first_service, last_service,"
                        " lifetime_value, do_not_service, do_not_service_note FROM customer WHERE customer_id=?", (cid,))
        assets = db.fetchall("SELECT brand, model, serial, service_count, first_seen, last_seen FROM asset"
                             " WHERE customer_id=? ORDER BY service_count DESC, COALESCE(last_seen,'') DESC", (cid,))
        hist = db.fetchall("SELECT h.sv_number, h.created_date, h.epass_status, h.sp_code, h.total,"
                           " p.name payer_name, p.kind payer_kind, a.serial"
                           " FROM service_history h LEFT JOIN payer p ON p.payer_id=h.payer_id"
                           " LEFT JOIN asset a ON a.asset_id=h.asset_id"
                           " WHERE h.customer_id=? ORDER BY COALESCE(h.created_date,'') DESC", (cid,))
        # has THIS unit been in before? match the open ticket's serial against the household's assets
        this_serial = norm_serial(j.get("serial"))
        same_unit = None
        if this_serial:
            for a in assets:
                if norm_serial(a["serial"]) == this_serial:
                    same_unit = {"serial": a["serial"], "n": a["service_count"] or 0,
                                 "first": a["first_seen"] or "", "last": a["last_seen"] or ""}
                    break
        out[j["sv"]] = {
            "cid": cid, "how": how, "name": c["display_name"] or "", "code": c["epass_customer_code"] or "",
            "visits": c["service_count"] or 0, "first": (c["first_service"] or "")[:4],
            "last": c["last_service"] or "", "ltv": round(float(c["lifetime_value"] or 0)),
            "dns": 1 if c["do_not_service"] else 0, "dnsNote": (c["do_not_service_note"] or "")[:60],
            "unit": same_unit,
            "units": [{"b": a["brand"] or "", "m": a["model"] or "", "s": a["serial"], "n": a["service_count"] or 0,
                       "last": (a["last_seen"] or "")[:4]} for a in assets[:MAX_UNITS]],
            "h": [{"sv": x["sv_number"].strip(), "d": x["created_date"] or "", "st": x["epass_status"] or "",
                   "sp": x["sp_code"] or "", "amt": round(float(x["total"] or 0)),
                   "pay": x["payer_name"] or "", "w": 1 if x["payer_kind"] == "manufacturer" else 0,
                   "s": x["serial"] or ""} for x in hist[:MAX_VISITS]],
        }

    # Each prototype only needs the calls it actually shows, so the payload is emitted per target
    # rather than shipping all 357 households into two files that already carry their own data.
    def subset(svs, name, fname):
        sub = {k: v for k, v in out.items() if k in svs}
        path = os.path.join(HERE, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write("/* generated by buildlinks.py — the back catalogue behind today's open calls. do not hand-edit */\n")
            f.write(f"const REAL_PAST={js(sub)};\n")
        print(f"  {name:<12} {len(sub):>4} of {len(svs):>4} calls linked · {os.path.getsize(path):>9,} bytes")

    board_svs, field_svs = set(), set()
    for f_, var, dest in [("proto_board.js", "REAL_J", board_svs), ("proto_field.js", "REAL_STOPS", field_svs)]:
        fp = os.path.join(HERE, f_)
        if os.path.exists(fp):
            import re as _re
            m = _re.search(r"const %s=(\[.*?\]);" % var, open(fp, encoding="utf-8").read(), _re.S)
            if m:
                dest.update(x["sv"] for x in json.loads(m.group(1)) if x.get("sv"))
    print(f"{matched} of {len(jobs)} open calls linked to a household with history "
          f"({matched / len(jobs) * 100:.1f}%)")
    subset(board_svs, "board", "proto_links_board.js")
    subset(field_svs, "field tool", "proto_links_field.js")
    print(f"  with a prior visit on the SAME unit: {sum(1 for v in out.values() if v['unit'])}")
    print(f"  at a do-not-service household: {sum(1 for v in out.values() if v['dns'])}")


if __name__ == "__main__":
    main()
