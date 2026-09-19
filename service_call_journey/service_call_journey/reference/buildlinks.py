"""Emit proto_links_*.js — the service history behind the calls that are open right now.

    python3 buildlinks.py       (expects /tmp/hist.db and realdata.json)

The board and the field tool both show *open* tickets, and open tickets are not in the back catalogue —
the two sets are disjoint. So the link between them is the **address** (linkrule.py): normalised street +
zip, or the same surname at the same house number. A surname alone somewhere else in the ZIP is offered as
`maybe`, never linked, and never carries a flag — that is the Sammie/Leah Baird fix ⟨9/17⟩.

Since 9/17 each past visit also carries what was done (complaint, work performed, parts installed) from
the full ODBC export, so an SV in "last visits" opens to something, and `unit` points at the last SV on
that exact serial so "this unit has been in before" is a link, not a sentence.

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
from wilson_service.importers.fullexport import tidy                    # noqa: E402
from linkrule import Index                                              # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_VISITS = 6          # per open call, newest first
MAX_UNITS = 6


def js(o):
    return json.dumps(o, separators=(",", ":"), ensure_ascii=False)


def norm_serial(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def cut(s, n):
    s = tidy(s or "").strip()
    return s if len(s) <= n else s[:n - 1].rsplit(" ", 1)[0] + "…"


def visit_detail(db, sv):
    """What was done on one past call, small enough to inline: complaint, performed, parts installed."""
    d = db.fetchone("SELECT complaint_desc, performed_desc, product_code, brand_code, model, serial, in_warranty"
                    " FROM service_detail WHERE sv_number=?", (sv,)) or {}
    parts = db.fetchall("SELECT item_desc, item_code, qty_shipped, installed FROM service_part WHERE sv_number=?"
                        " AND item_desc IS NOT NULL ORDER BY installed DESC, part_line_id LIMIT 6", (sv,))
    labor = db.fetchall("SELECT tech_code, labor_desc FROM service_labor WHERE sv_number=? ORDER BY labor_line_id LIMIT 3", (sv,))
    return {
        "c": cut(d.get("complaint_desc"), 220), "p": cut(d.get("performed_desc"), 320),
        "pc": d.get("product_code") or "", "b": d.get("brand_code") or "", "m": d.get("model") or "",
        "parts": [{"d": cut(x["item_desc"], 60), "n": x["item_code"] or "", "q": x["qty_shipped"] or 1,
                   "i": 1 if x["installed"] else 0} for x in parts],
        "lab": [cut(x["labor_desc"], 60) for x in labor if x["labor_desc"]],
    }


def main():
    db = DB.sqlite("/tmp/hist.db")
    jobs = json.load(open(os.path.join(HERE, "realdata.json")))["jobs"]
    idx = Index(db)

    out, matched, maybes = {}, 0, 0
    for j in jobs:
        r = idx.resolve(j["addr"], j["zip"], j.get("last") or j["cust"])
        if r["cid"] is None:
            if r["maybe"]:
                maybes += 1
                out[j["sv"]] = {"cid": None, "how": "", "maybe": r["maybe"]}
            continue
        matched += 1
        cid = r["cid"]
        c = db.fetchone("SELECT display_name, epass_customer_code, service_count, first_service, last_service,"
                        " lifetime_value, do_not_service_note FROM customer WHERE customer_id=?", (cid,))
        # everything at this address, across every account there — appliances don't move
        cids = [a["cid"] for a in r["accounts"]] or [cid]
        qs = ",".join("?" * len(cids))
        assets = db.fetchall(f"SELECT asset_id, brand, model, serial, service_count, first_seen, last_seen FROM asset"
                             f" WHERE customer_id IN ({qs}) ORDER BY service_count DESC, COALESCE(last_seen,'') DESC", tuple(cids))
        hist = db.fetchall(f"SELECT h.sv_number, h.created_date, h.epass_status, h.sp_code, h.total, h.customer_id,"
                           " p.name payer_name, p.kind payer_kind, a.serial, a.model, a.brand"
                           " FROM service_history h LEFT JOIN payer p ON p.payer_id=h.payer_id"
                           " LEFT JOIN asset a ON a.asset_id=h.asset_id"
                           f" WHERE h.customer_id IN ({qs}) ORDER BY COALESCE(h.created_date,'') DESC", tuple(cids))
        visits_here = len(hist)
        # has THIS unit been in before? match the open ticket's serial against the address's assets
        this_serial = norm_serial(j.get("serial"))
        same_unit = None
        if this_serial:
            for a in assets:
                if norm_serial(a["serial"]) == this_serial:
                    last_sv = next((x["sv_number"].strip() for x in hist if norm_serial(x["serial"]) == this_serial), "")
                    same_unit = {"serial": a["serial"], "b": a["brand"] or "", "m": a["model"] or "",
                                 "n": a["service_count"] or 0, "first": a["first_seen"] or "", "last": a["last_seen"] or "",
                                 "lastSv": last_sv}
                    break
        out[j["sv"]] = {
            "cid": cid, "how": r["how"], "name": c["display_name"] or "", "code": c["epass_customer_code"] or "",
            "visits": visits_here, "first": (c["first_service"] or "")[:4],
            "last": c["last_service"] or "", "ltv": round(float(c["lifetime_value"] or 0)),
            "dns": r["dns"], "dnsNote": (c["do_not_service_note"] or "")[:60] if r["dns"] else "",
            "dnsOther": r["dns_other"],
            "accounts": [{"name": a["name"], "visits": a["visits"]} for a in r["accounts"] if a["cid"] != cid],
            "unit": same_unit,
            "units": [{"b": a["brand"] or "", "m": a["model"] or "", "s": a["serial"], "n": a["service_count"] or 0,
                       "last": (a["last_seen"] or "")[:4],
                       "lastSv": next((x["sv_number"].strip() for x in hist if x["serial"] == a["serial"]), "")}
                      for a in assets[:MAX_UNITS]],
            "h": [dict({"sv": x["sv_number"].strip(), "d": x["created_date"] or "", "st": x["epass_status"] or "",
                        "sp": x["sp_code"] or "", "amt": round(float(x["total"] or 0)),
                        "pay": x["payer_name"] or "", "w": 1 if x["payer_kind"] == "manufacturer" else 0,
                        "s": x["serial"] or "", "m": x["model"] or "", "b": x["brand"] or "",
                        "other": 0 if x["customer_id"] == cid else 1},
                       **visit_detail(db, x["sv_number"].strip())) for x in hist[:MAX_VISITS]],
        }

    def subset(svs, name, fname):
        sub = {k: v for k, v in out.items() if k in svs}
        path = os.path.join(HERE, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write("/* generated by buildlinks.py — the back catalogue behind today's open calls. do not hand-edit */\n")
            f.write(f"const REAL_PAST={js(sub)};\n")
        print(f"  {name:<12} {len(sub):>4} of {len(svs):>4} calls carry a record · {os.path.getsize(path):>9,} bytes")

    board_svs, field_svs = set(), set()
    for f_, var, dest in [("proto_board.js", "REAL_J", board_svs), ("proto_field.js", "REAL_ROUTES", field_svs)]:
        fp = os.path.join(HERE, f_)
        if os.path.exists(fp):
            m = re.search(r"^const %s=(.*);$" % var, open(fp, encoding="utf-8").read(), re.M)
            if m:
                val = json.loads(m.group(1))
                rows = val if isinstance(val, list) else [x for day in val.values() for x in day]   # ⟨9/19 late⟩ the field tool carries a day -> stops map
                dest.update(x["sv"] for x in rows if x.get("sv"))
    print(f"{matched} of {len(jobs)} open calls linked to an address with history ({matched / len(jobs) * 100:.1f}%); "
          f"{maybes} more have only a namesake in the ZIP (shown as 'maybe', never linked)")
    subset(board_svs, "board", "proto_links_board.js")
    subset(field_svs, "field tool", "proto_links_field.js")
    linked = [v for v in out.values() if v.get("cid")]
    print(f"  with a prior visit on the SAME unit: {sum(1 for v in linked if v['unit'])}")
    print(f"  at a do-not-service household (address AND name): {sum(1 for v in linked if v['dns'])}"
          f" · DNS on a different name at the address: {sum(1 for v in linked if v['dnsOther'])}")
    for sv, v in out.items():
        if "baird" in (v.get("name") or "").lower() or any("baird" in m["name"].lower() for m in v.get("maybe", [])):
            print("  Baird check:", sv, {k: v[k] for k in v if k in ("cid", "how", "name", "dns", "maybe")})


if __name__ == "__main__":
    main()
