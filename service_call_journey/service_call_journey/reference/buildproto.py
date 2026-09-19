"""Emit the prototype data blocks from realdata.json (the 9/17 SV export joined to the 9/10 DispatchTrack snapshot).

    python3 buildproto.py        -> writes proto_board.js, proto_field.js, proto_office.js

Real: SV, status, tech (SP), scheduled date, customer name, street address, zip, map zone, balance/payment type,
      brand/model/serial, units, warranty + recall flags, contact preference (the Reference column), created/finish
      dates, warranty payer, and the ePASS category + problem text + lat/lng for the 170 tickets also in the 9/10
      DispatchTrack snapshot.
Derived (the export does not carry it): route sequence and AM/PM window (nearest-neighbour from the tech's start
      point, split at the half-day), visit duration (category + unit count), and projected dollars.
Not in either export, so still sample: part numbers and prices, part ETAs, sync-queue items, phone/email (masked).
"""
from __future__ import annotations

import collections
import datetime as _dt
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "realdata.json")))
JOBS, ZIPGEO, META = D["jobs"], D["zips"], D["meta"]
WEEK = META["week"]
TODAY = META["today"]
SHOP = (30.2054, -98.0605)
ROUTED = {"SO1", "SO6", "SO4PRE", "SO5", "WAR3", "SO1.AUTH"}
# tech start/end points, from reference/tech_roster.csv
TECHS = {
    "DLA": dict(name="Diogo Assis", start="shop", end="shop", home=(30.20, -98.10)),
    "AJH": dict(name="Andrew Horst", start="shop", end="shop", home=(30.21, -98.05)),
    "TDP": dict(name="Trevor Pate", start="shop", end="home", home=(30.00, -98.10)),
    "JRC": dict(name="Josh Chappell", start="home", end="home", home=(30.17, -97.82)),
    "KJB": dict(name="Kyle Bisson", start="home", end="home", home=(30.00, -97.88)),
    "CIT": dict(name="Chris Turner", start="shop", end="home", home=(30.37, -97.97)),
    "CEM": dict(name="Connor Montgomery", start="home", end="home", home=(29.70, -98.12)),
    "BLL": dict(name="Brady Langley", start="shop", end="home", home=(29.70, -98.12)),
    "JHM": dict(name="John Merz", start="home", end="home", home=(30.27, -98.87)),
    "MAP": dict(name="Mark Perks", start="shop", end="home", home=(30.00, -98.10)),
    "VWJ": dict(name="Vince Jones", start="shop", end="shop", home=(30.19, -98.08)),
}


def ll(j):
    if j.get("ll"):
        return tuple(j["ll"])
    z = ZIPGEO.get(j["zip"])
    return tuple(z) if z else SHOP


def drive(a, b):
    R = 6371
    dla, dlo = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(dla / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlo / 2) ** 2
    return round(4 + 2 * R * math.asin(math.sqrt(h)) * 1.55)


def start_pt(t):
    return SHOP if TECHS.get(t, {}).get("start") == "shop" else TECHS.get(t, {}).get("home", SHOP)


def pref_of(j):
    r = (j["ref"] or "").lower()
    return "Call" if "call" in r else "Email" if "email" in r else "Text"


def bal_of(j):
    if j["bal"] <= 0:
        return ""
    if j["pay"] == "AR" and not j["wty"]:
        return "A/R"
    if j["pay"] == "COD" and j["st"] in ("SO6", "SO4PRE", "SO5"):
        return "COD"
    return ""


def unit_line(j):
    """'Sub-Zero built-in refrigerator · evaporator fan seized'."""
    head = f"{j['brand']} {j['cat']}".strip() or (j["model"] or "appliance")
    if j["problem"]:
        return f"{head} · {j['problem']}"          # already tidied and cut on a word boundary
    if j["model"] and j["model"].upper() != "NEED":
        return f"{head} · {j['model']}"
    return head


def mask_email(e):
    e = (e or "").strip()
    if "@" not in e:
        return ""
    a, b = e.split("@", 1)
    return (a[0] + "•" * max(3, len(a) - 1)) + "@" + b


def mask_phone(code):
    d = re.sub(r"\D", "", str(code or ""))
    return f"(•••) •••-{d[-4:]}" if len(d) >= 10 else ""


FT_KEY = [("dish", "dishwasher"), ("washer", "washer"), ("dryer", "dryer"), ("laundry", "dryer"),
          ("refriger", "refrigerator"), ("freezer", "refrigerator"), ("ice", "refrigerator"), ("wine", "refrigerator"),
          ("oven", "oven"), ("range", "oven"), ("cooktop", "oven"), ("microwave", "oven"), ("coffee", "oven"), ("grill", "oven")]


def ft_cat(label):
    """The field tool's symptom/task/part lists are keyed by five families; keep the real label for display."""
    lo = (label or "").lower()
    for frag, key in FT_KEY:
        if frag in lo:
            return key
    return "dishwasher" if "dw" in lo else "oven"


def js(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- sequence + windows
def sequence_day(tech, jobs):
    """Stop order. Where the dispatchers' own order is known (route_order_0917.json, from the ePASS Routing
    screenshots) it wins, verbatim; anything on that tech-day the screenshot did not have is appended
    nearest-neighbour and flagged `unseq`. Days with no screenshot are nearest-neighbour from the tech's start
    point. AM until the half-day fills, then PM — neither the order nor the window is in the export."""
    fixed = sorted([j for j in jobs if j.get("eseq")], key=lambda j: j["eseq"])
    pool = [j for j in jobs if not j.get("eseq")]
    cur, out = (ll(fixed[-1]) if fixed else start_pt(tech)), list(fixed)
    for j in pool:
        j["unseq"] = bool(fixed) or j.get("ordered_day", False)
    while pool:
        nxt = min(pool, key=lambda j: drive(cur, ll(j)))
        pool.remove(nxt)
        out.append(nxt)
        cur = ll(nxt)
    clock = 0
    for i, j in enumerate(out):
        j["seq"] = i + 1
        j["win"] = "AM" if clock < 225 else "PM"
        clock += j["dur"] + 20
    return out


SHOP_RE = re.compile(r"(HWY ?290|HIGHWAY ?290)", re.I)


def visit_groups(jobs):
    """9/15 item 21: open jobs at one address that one tech could do in one arrival. Suggested, never automatic —
    the prototype shows the suggestion. Split by skill (an HVAC call and an appliance call are two groups)."""
    g = collections.defaultdict(list)
    for j in jobs:
        if j["cust"].lower().startswith("wilson, ac") or SHOP_RE.search(j["addr"] or ""):
            continue                                  # the shop is not a household
        key = (re.sub(r"\W+", "", j["addr"] or "").upper()[:28], j["zip"], "hvac" if j["type"] == "hvac" else "appl")
        g[key].append(j)
    out, n = {}, 0
    for key, members in g.items():
        if len(members) < 2:
            continue
        n += 1
        gid = f"G{n}"
        for j in members:
            out[j["sv"]] = (gid, len(members))   # id + how many open calls that address really has
    return out


# ---------------------------------------------------------------- collector lane ⟨9/15 pm⟩
# John Merz runs his own west route: he is sent the call, runs it when he runs it, and updates
# the ticket next time he is at the shop. His column is not a schedule, so a fill % is a lie.
# What the office needs instead is a book of open work sorted by age, and what each one waits on.
WAITING_ON = {
    "SO1":    ("tech",   "diagnostic not written up"),
    "SO1.AUTH": ("tech", "diagnostic not written up"),
    "SO2":    ("office", "quote out to the customer"),
    "SO2.2":  ("office", "quote out to the customer"),
    "SO3":    ("office", "parts to order"),
    "SO4":    ("office", "parts on order"),
    "SO4B":   ("office", "parts on order"),
    "SO4H":   ("customer", "part ships to the customer"),
    "SO4PRE": ("tech",   "install held on a date"),
    "SO5":    ("tech",   "parts in — never installed"),
    "SO6":    ("tech",   "install to run"),
    "SO9":    ("office", "cancelled — needs closing"),
    "WAR3":   ("office", "warranty claim"),
    "WAR4":   ("office", "warranty claim"),
}


def collector_lane(tech):
    """Every open ticket sitting with a collector tech, oldest first, with what each one waits on."""
    today = _dt.date.fromisoformat(TODAY)
    rows = []
    grp = visit_groups([j for j in JOBS if j["tech"] == tech])
    for j in JOBS:
        if j["tech"] != tech:
            continue
        created = _dt.date.fromisoformat(j["created"]) if j["created"] else today
        who, what = WAITING_ON.get(j["st"], ("office", "needs review"))
        o = {"sv": j["sv"], "cust": j["cust"], "addr": j["addr"],
             "zip": int(j["zip"]) if j["zip"].isdigit() else 78624, "zone": j["zone"],
             "st": j["st"], "age": (today - created).days, "created": j["created"],
             "unit": unit_line(j), "units": j["units"], "amt": round(float(j["total"] or 0), 2),
             "who": who, "what": what, "type": j["type"],
             # the hand-off text needs what the office copy-pastes today. Customer numbers and addresses are
             # masked in the prototype; the real send resolves them from job_contact. Note that ExportInvoice
             # carries no phone or email at all — Phone1/2/3 and Email exist only in the DispatchTrack feed.
             "phones": [mask_phone(x) for x in (j.get("phones") or [])],
             "email": mask_email(j.get("dt_email") or j.get("email") or ""),
             "gate": j.get("gate") or "", "pref": pref_of(j),
             "make": f"{j['brand']} {j['cat']}".strip(), "model": j["model"] or "", "serial": j["serial"] or ""}
        if j["problem"]:
            o["problem"] = j["problem"]
        if j["wty"]:
            o["wty"] = 1
        if j["rcall"]:
            o["rcall"] = 1
        if bal_of(j):
            o["bal"] = bal_of(j)
        if grp.get(j["sv"]):
            o["grp"], o["grpN"] = grp[j["sv"]]
        rows.append(o)
    rows.sort(key=lambda r: -r["age"])
    return {"tech": tech, "name": TECHS[tech]["name"], "jobs": rows}


def main():
    by_sv = {j["sv"]: j for j in JOBS}
    GRP = visit_groups(JOBS)
    board, trk = [], {}
    # ---- routed stops this week
    # ⟨9/17 pm⟩ every dated week goes on the board — the week scroll (team item 41) was showing an empty
    # 9/21 because only the export's own week was emitted. Tickets ePASS Routing keeps UNDER its "routed"
    # comment row are left off: Cayden — "those calls are just clutter, a byproduct of what ePASS lacks;
    # now that techs update tickets in the field in real time this will go away". The stop order above
    # the row is still the dispatchers' own and is kept.
    all_days = sorted({j["day"] for j in JOBS if j["day"]})
    for day in all_days:
        for tech in TECHS:
            rows = [j for j in JOBS if j["day"] == day and j["tech"] == tech and j["st"] in ROUTED and not j.get("below")]
            if rows:
                sequence_day(tech, rows)
    for j in JOBS:
        if j["day"] and j["tech"] in TECHS and j["st"] in ROUTED and not j.get("below"):
            st = "WAR" if j["st"] == "WAR3" else ("SO1" if j["st"] == "SO1.AUTH" else j["st"])
            o = {"sv": j["sv"], "cust": j["cust"], "addr": j["addr"], "zip": int(j["zip"]) if j["zip"].isdigit() else 78620,
                 "st": st, "type": j["type"], "unit": unit_line(j), "dur": j["dur"], "win": j.get("win"), "bal": bal_of(j),
                 "tech": j["tech"], "day": j["day"], "seq": j.get("seq", 0), "pref": pref_of(j), "units": j["units"]}
            if j.get("eseq"):
                o["eseq"] = 1           # order is the dispatchers' own, from ePASS Routing
            elif j.get("unseq"):
                o["unseq"] = 1          # on a screenshot day but not in the screenshot: booked since, or not routed
            if GRP.get(j["sv"]):
                o["grp"], o["grpN"] = GRP[j["sv"]]
            if j["ll"]:
                o["ll"] = [round(j["ll"][0], 5), round(j["ll"][1], 5)]
            if st in ("SO6", "SO4PRE", "SO5"):
                o["owner"] = j["tech"]
            if j["wty"]:
                o["wty"] = 1
            if j["rcall"]:
                o["rcall"] = 1
            board.append(o)
    # ---- unscheduled: parts in and no date, plus direct-ship waiting on the customer
    uns = [j for j in JOBS if not j["day"] and j["st"] in ("SO5", "SO4H") and j["tech"] in TECHS]
    uns.sort(key=lambda j: (j["st"] != "SO5", j["created"]))
    for j in uns[:9]:
        o = {"sv": j["sv"], "cust": j["cust"], "addr": j["addr"], "zip": int(j["zip"]) if j["zip"].isdigit() else 78620,
             "st": j["st"], "type": j["type"], "unit": unit_line(j) + (" (ships to customer)" if j["st"] == "SO4H" else " (parts in)"),
             "dur": j["dur"], "win": None, "bal": bal_of(j), "tech": None, "day": None, "seq": 0,
             "owner": j["tech"], "pref": pref_of(j), "units": j["units"]}
        if GRP.get(j["sv"]):
            o["grp"], o["grpN"] = GRP[j["sv"]]
        if j["ll"]:
            o["ll"] = [round(j["ll"][0], 5), round(j["ll"][1], 5)]
        if j["wty"]:
            o["wty"] = 1
        board.append(o)
    # ---- penciled SO4s. The invoice export carries no part ETA, so these are the ETAs Kezia keys in the dashboard.
    so4 = [j for j in JOBS if j["st"] == "SO4" and j["tech"] in TECHS and j["parked_on"]]
    so4.sort(key=lambda j: j["created"])
    picked, seen_tech = [], set()
    for j in so4:                       # one per tech, spread across the lighter routes
        if j["tech"] in ("DLA", "AJH", "CIT", "CEM") and j["tech"] not in seen_tech:
            seen_tech.add(j["tech"])
            picked.append(j)
        if len(picked) == 3:
            break
    etas = ["2026-09-15", "2026-09-16", "2026-09-14"]
    for j, eta in zip(picked, etas):
        o = {"sv": j["sv"], "cust": j["cust"], "addr": j["addr"], "zip": int(j["zip"]) if j["zip"].isdigit() else 78620,
             "st": "SO4", "type": j["type"], "unit": unit_line(j), "dur": j["dur"], "win": None, "bal": bal_of(j),
             "tech": None, "day": None, "seq": 0, "owner": j["tech"], "pref": pref_of(j), "eta": eta,
             "pencilEta": 1}
        if j["ll"]:
            o["ll"] = [round(j["ll"][0], 5), round(j["ll"][1], 5)]
        board.append(o)
    # ---- tracker: one real customer per stage
    def pick(pred, n=1):
        return [j for j in JOBS if pred(j)][:n]

    picks = []
    picks += [(j, "so1") for j in pick(lambda j: j["st"] == "SO1" and j["day"] in WEEK[1:] and j["problem"], 1)]
    picks += [(j, "so6") for j in pick(lambda j: j["st"] == "SO6" and j["day"] in WEEK[1:] and j["problem"], 1)]
    picks += [(j, "so5") for j in pick(lambda j: j["st"] == "SO5" and not j["day"], 1)]
    picks += [(j, "so4") for j in pick(lambda j: j["st"] == "SO4" and j["parked_on"] and j["problem"], 1)]
    picks += [(j, "so4h") for j in pick(lambda j: j["st"] == "SO4H", 1)]
    picks += [(j, "so4pre") for j in pick(lambda j: j["st"] == "SO4PRE", 1)]
    STAGE = {"so1": 1, "so6": 7, "so5": 6, "so4": 5, "so4h": 5, "so4pre": 5}

    def fmt(d):
        try:
            x = _dt.date.fromisoformat(str(d)[:10])
        except Exception:
            return ""
        return x.strftime("%b %-d") + ("" if x.year == 2026 else f", {x.year}")

    for j, kind in picks:
        first = j["cust"].split(", ")[-1].split(" ")[0] if ", " in j["cust"] else j["cust"].split(" ")[0]
        st = STAGE[kind]
        # the export gives the two ends of the timeline (created, and finish when it is closed); the stages in
        # between are spread evenly across it so the tracker shows the right shape
        try:
            a = _dt.date.fromisoformat((j["created"] or "2026-09-01")[:10])
        except Exception:
            a = _dt.date(2026, 9, 1)
        b = _dt.date.fromisoformat(TODAY)
        dates = [""] * 9
        for i in range(st + 1):
            dates[i] = fmt(a + _dt.timedelta(days=round((b - a).days * (i / max(st, 1)))))
        trk[j["sv"]] = {"first": first,
                        "unit": f"{j['brand']} {j['cat']}" + (f" · {j['model']}" if j["model"] and j["model"].upper() != "NEED" else ""),
                        "prob": j["problem"] or "service request", "stage": st, "dates": dates,
                        "detail": kind if kind != "so4pre" else "so4"}
        if kind in ("so4", "so4pre"):
            trk[j["sv"]]["eta"] = "Wed, Sep 16"
            trk[j["sv"]]["po"] = "On order — supplier confirmed"
        if kind == "so4h":
            trk[j["sv"]]["eta"] = "Wed, Sep 16"
            trk[j["sv"]]["carrier"] = f"{j['billto'] or j['brand']} ships direct"
    # real trips: a tech-day that is almost entirely one far zone group
    trips = []
    for day in WEEK:
        rows = [j for j in JOBS if j["day"] == day and j["st"] in ROUTED and j["tech"] == "JHM"]
        if len(rows) >= 5:
            trips.append({"group": "West", "day": day, "tech": "JHM", "confirmed": True,
                          "reason": f"{len(rows)} stops in the bucket — real ePASS route"})
    lane = collector_lane("JHM")
    out = {
        "J": board, "TRK": trk, "TRIPS": trips, "TODAY": TODAY,
        "ZIP": {z: [round(v[0], 4), round(v[1], 4)] for z, v in ZIPGEO.items()},
    }
    open(os.path.join(HERE, "proto_board.js"), "w").write(
        "/* generated by buildproto.py from the 9/17 SV export — do not hand-edit */\n"
        f"const REAL_ZIP={js(out['ZIP'])};\n"
        f"const REAL_J={js(board)};\n"
        f"const REAL_TRK={js(trk)};\n"
        f"const REAL_TRIPS={js(trips)};\n"
        f"const REAL_LANE={js(lane)};\n")

    # ---------------------------------------------------------------- field tool: Diogo's real days, in ePASS order
    # ⟨9/19 late⟩ Every one of his routed days from today forward, not just Thursday, so the tool can show a real
    # warranty call (Fri 9/18: Allison Schmidt, Speed Queen, billed to Speed Queen Warranty) without a flag being
    # hand-set on a COD ticket — which is how Kelli Kenney's SV00123482 came to say "warranty" for a day.
    ft_day, ft_tech = TODAY, "DLA"
    ft_days = sorted({j["day"] for j in JOBS if j["tech"] == ft_tech and j["day"] and j["day"] >= TODAY
                      and j["st"] in ROUTED and not j.get("below")})
    routes, route_meta, stops = {}, {}, []
    for day in ft_days:
        day_stops = sorted([j for j in JOBS if j["day"] == day and j["tech"] == ft_tech and j["st"] in ROUTED and not j.get("below")],
                           key=lambda j: (j.get("seq") or 99, j["win"] != "AM", j["sv"]))
        clock, cur, fstops = 8 * 60, start_pt(ft_tech), []
        for j in day_stops:
            clock += drive(cur, ll(j))
            cur = ll(j)
            hh, mm = divmod(clock, 60)
            ap = "AM" if hh < 12 else "PM"
            hh12 = hh - 12 if hh > 12 else hh
            s = {"sv": j["sv"], "st": j["st"], "cust": j["cust"].split(", ")[-1] + " " + j["cust"].split(", ")[0] if ", " in j["cust"] else j["cust"],
                 "addr": f"{j['addr']}, {j['zip']}", "phone": mask_phone(j.get("billto_phone") or ""), "gate": j["gate"] or "—",
                 "eta": f"{hh12}:{mm:02d} {ap}", "win": "8–12" if j["win"] == "AM" else "12–5",
                 "builtin": j["inst"] == "built", "cat": ft_cat(j["cat"]), "catLabel": j["cat"], "brand": j["brand"], "model": j["model"], "serial": j["serial"],
                 "problem": j["problem_full"] or f"{j['brand']} {j['cat']} — the invoice export carries no problem text; ePASS has it on the ticket",
                 "photos": 0, "pref": pref_of(j), "units": j["units"], "dur": j["dur"], "type": j.get("type") or "appliance",
                 # the warranty flag is the export's, never ours: payer kind on the ticket (billto a manufacturer / warranty account)
                 "wty": 1 if j.get("wty") else 0, "pay": j.get("pay") or "", "billto": j.get("billto") or ""}
            if bal_of(j):
                s["bal"] = f"{bal_of(j)} balance ${j['bal']:,.2f}"
            if j["st"] in ("SO6", "SO4PRE"):
                s["diagBy"] = f"{TECHS[ft_tech]['name'].split()[0]} · {_dt.date.fromisoformat(j['created']).strftime('%-m/%-d') if j['created'] else ''}"
                s["labor"] = "approved in the field quote"
                s["lab"] = 130
                s["parts"] = []          # part lines are not in the invoice export — the tech keys them (9/14 item 17)
            clock += j["dur"]
            fstops.append(s)
        clock += drive(cur, start_pt(ft_tech))
        hh, mm = divmod(clock, 60)
        route_meta[day] = {"back": f"{hh - 12 if hh > 12 else hh}:{mm:02d} {'AM' if hh < 12 else 'PM'}",
                           "wty": sum(1 for x in fstops if x["wty"]), "n": len(fstops)}
        routes[day] = fstops
        stops.extend(day_stops)
    print("field:", ", ".join(f"{d} {route_meta[d]['n']} stops ({route_meta[d]['wty']} warranty)" for d in ft_days))
    # ⟨9/17⟩ Model Insight, three tiers, from the back catalogue: exact model, family (SHP78 = SHV78), brand+type
    insight = {}
    try:
        sys.path.insert(0, os.path.join(HERE, "repo", "phase0"))
        from wilson_service.db import DB as _DB
        from wilson_service.importers.fullexport import model_insight, tidy
        _db = _DB.sqlite("/tmp/hist.db")
        PRODUCT_LABEL = {"DW": "dishwashers", "RESXS": "side-by-side refrigerators", "REBIS": "built-in refrigerators", "WASHT": "top-load washers",
                         "WASHF": "front-load washers", "DRELE": "electric dryers", "DRGAS": "gas dryers", "OVELE": "wall ovens", "RAGAS": "gas ranges",
                         "RADF": "dual-fuel ranges", "IMUC": "undercounter ice makers", "MW": "microwaves", "REFRE": "refrigerators", "CTGAS": "gas cooktops",
                         "VHOOD": "vent hoods", "REBOT": "bottom-freezer refrigerators", "RETOP": "top-freezer refrigerators", "REUC": "undercounter refrigerators"}

        def _calls(rows, n=5):
            return [{"sv": c["sv_number"].strip(), "d": c["created_date"] or "", "sp": c["sp_code"] or "", "m": c.get("model") or "",
                     "c": (tidy(c.get("complaint_desc") or ""))[:160], "p": (tidy(c.get("performed_desc") or ""))[:220]} for c in rows[:n]]

        for j in stops:
            if not j.get("model") or j["model"].upper() in ("NEED", "VERIFY", ""):
                continue
            r = model_insight(_db, j.get("brand_code") or "", j["model"], limit=6)
            fam = r["family"]
            fam_rows = []
            fam_models = [x["model"] for x in fam["models"]]
            if fam_models:
                qs = ",".join("?" * len(fam_models))
                fam_rows = _db.fetchall(
                    "SELECT d.sv_number, d.complaint_desc, d.performed_desc, d.model, h.created_date, h.sp_code"
                    " FROM service_detail d LEFT JOIN service_history h ON h.sv_number=d.sv_number"
                    f" WHERE UPPER(COALESCE(d.brand_code,''))=? AND d.model IN ({qs}) AND UPPER(d.model)<>?"
                    " ORDER BY COALESCE(h.created_date,'') DESC LIMIT 6", (j["brand_code"], *fam_models, j["model"].upper()))
            insight[j["sv"]] = {
                "brand": j["brand"], "code": j.get("brand_code") or "", "model": j["model"], "pc": r["product_code"],
                "typeLabel": PRODUCT_LABEL.get(r["product_code"], (r["product_code"] or "this type").lower()),
                "exact": {"n": r["total_calls"], "calls": _calls([dict(c) for c in r["calls"]]),
                          "parts": [{"d": p["item_desc"], "n": p["n"]} for p in r["parts"][:6]]},
                "family": {"stem": fam["stem"], "rule": fam["rule"], "n": fam["total_calls"],
                           "models": [{"m": x["model"], "n": x["n"]} for x in fam["models"][:10]],
                           "parts": [{"d": p["item_desc"], "n": p["n"]} for p in fam["parts"][:6]],
                           "calls": _calls([dict(c) for c in fam_rows])},
                "type": {"n": r["product_type_calls"]},
            }
        print(f"field: model insight for {len(insight)} of {len(stops)} stops across {len(ft_days)} days")
    except Exception as e:      # the catalogue is optional for the prototype build
        print("field: model insight skipped:", e)

    open(os.path.join(HERE, "proto_field.js"), "w").write(
        "/* generated by buildproto.py from the 9/17 SV export — do not hand-edit */\n"
        f"const REAL_TECH={js(TECHS[ft_tech]['name'])};\nconst REAL_DAY={js(ft_day)};\n"
        f"const REAL_ROUTES={js(routes)};\n"
        f"const REAL_ROUTE_META={js(route_meta)};\n"
        f"const REAL_INSIGHT={js(insight)};\n")

    # ---------------------------------------------------------------- office queues
    # The invoice export has no part lines, prices, suppliers or ETAs — those come from the field quote and the PO
    # builder. Real tickets carry parts:[] and the queue says so; four keep a clearly-labelled sample line so the
    # verify -> order -> receive flow is still clickable.
    SAMPLE = {
        "dishwasher": ("Drain pump", "sample-DP", 148, "Marcone"), "refrigerator": ("Evaporator fan motor", "sample-EFM", 189, "Sub-Zero Direct"),
        "washer": ("Water inlet valve", "sample-WIV", 88, "Marcone"), "dryer": ("Heating element", "sample-HE", 64, "Reliable Parts"),
        "oven": ("Bake element", "sample-BE", 112, "Encompass"), "other": ("Control board", "sample-CB", 236, "Marcone"),
        # ⟨9/19 late⟩ a hood is not an oven: a "bake element" on a Vent-A-Hood is the office-side twin of the field
        # tool's wrong-brand part number, and it sat on Pauline Stephenson's ticket for a week.
        "hood": ("Blower motor", "sample-BM", 168, "Encompass"),
    }

    def fam(cat):
        lo = (cat or "").lower()
        if "hood" in lo or "vent" in lo or "downdraft" in lo:
            return "hood"
        return ft_cat(cat) if ft_cat(cat) in SAMPLE else "other"

    def ojob(j, with_sample=False):
        o = {"sv": j["sv"], "cust": j["cust"],
             "unit": f"{j['brand']} {j['cat']}" + (f" {j['model']}" if j["model"] and j["model"].upper() != "NEED" else ""),
             "zip": int(j["zip"]) if j["zip"].isdigit() else 78620, "tech": j["tech"], "st": j["st"],
             "src": "warranty" if j["wty"] else "office",   # field-vs-office quote is not in the export either
             "submitted": (j["created"] or "2026-09-01") + "T09:00:00",
             "notes": j["problem_full"] or "No problem text in the invoice export — ePASS holds it on the ticket.",
             "labor": [], "parts": [], "wty": 1 if j["wty"] else 0, "payer": j["billto"] if j["wty"] else "",
             "bal": round(j["bal"], 2), "total": round(j["total"], 2), "zone": j["zone"], "pref": pref_of(j),
             "serial": j["serial"], "model": j["model"]}
        if j["rcall"]:
            o["rcall"] = 1
        if with_sample:
            name, pn, price, sup = SAMPLE[fam(j["cat"])]
            o["parts"] = [{"pn": pn, "name": name, "qty": 1, "techPrice": price, "lastVerified": "9/12",
                           "verified": None, "avail": None, "supplier": sup, "sample": 1}]
            o["labor"] = [[f"{name} Replacement", 1.5]]
        return o

    oj, used = [], 0
    for st, want_sample in (("SO2", 2), ("SO2.1", 0), ("SO2.2", 0), ("SO3", 1), ("SO4", 1), ("SO4B", 0), ("SO4H", 0), ("SO4PRE", 0)):
        rows = [j for j in JOBS if j["st"] == st and j["tech"] in TECHS]
        rows.sort(key=lambda j: j["created"])
        cap = {"SO2": 6, "SO2.1": 3, "SO2.2": 10, "SO3": 10, "SO4": 10, "SO4B": 1, "SO4H": 6, "SO4PRE": 5}[st]
        for n, j in enumerate(rows[:cap]):
            oj.append(ojob(j, with_sample=n < want_sample))
    # SO4PRE: the export's sched date IS the held date. The first one gets an ETA past it -> the T-2 check for Kezia.
    held_src = {j["sv"]: (j["day"] or j["parked_on"]) for j in JOBS if j["st"] == "SO4PRE"}
    for n, o in enumerate(x for x in oj if x["st"] == "SO4PRE"):
        d = held_src.get(o["sv"])
        o["held"] = (_dt.date.fromisoformat(d).strftime("%a %-m/%-d") + " · 8–12") if d else "not yet held"
        if n == 0 and d:
            o["eta"] = (_dt.date.fromisoformat(d) + _dt.timedelta(days=2)).isoformat()   # part will miss the held date
    etas = ["2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-24"]
    for n, o in enumerate(x for x in oj if x["st"] in ("SO4", "SO4B", "SO4H", "SO4PRE")):
        o.setdefault("eta", etas[n % len(etas)])   # the ETA is keyed in the dashboard; the export carries none
        o.setdefault("po", "PO-" + o["sv"][-4:])

    # customers with more than one open ticket, plus their history from this export
    byname = collections.defaultdict(list)
    for j in JOBS:
        byname[(j["cust"], j["zip"])].append(j)
    cust, hist = [], []
    for (name, zip5), rows in sorted(byname.items(), key=lambda kv: (-len(kv[1]), kv[0][0]))[:12]:
        r0 = rows[0]
        cid = len(cust) + 1
        units, seen = [], set()
        for r in rows:
            key = (r["model"] or "", r["serial"] or "")
            if key != ("", "") and key not in seen:
                seen.add(key)
                units.append({"serial": r["serial"] or "—", "model": r["model"] or "—", "brand": r["brand"], "cat": r["cat"],
                              "install": "built-in" if r["inst"] == "built" else "freestanding"})
        cust.append({"id": cid, "name": name, "phones": [], "email": mask_email(r0["email"]), "pref": pref_of(r0),
                     "card": "—", "addr": f"{r0['addr']}, {zip5}", "zone": r0["zone"], "units": units})
        for r in sorted(rows, key=lambda r: r["created"] or "", reverse=True):
            done = r["st"].startswith("SO8")
            hist.append({"c": cid, "sv": r["sv"], "date": (r["finish"] if done else r["created"]) or "2026-09-01",
                         "unit": r["model"] or r["cat"], "tech": r["tech"], "st": r["st"],
                         "what": (r["problem"] or f"{r['brand']} {r['cat']}") + (" · warranty" if r["wty"] else ""),
                         "amt": round(r["total"], 2) if done else None, "open": 0 if done else 1,
                         "recallOf": 1 if r["rcall"] else 0})
    # recalls: ePASS's own RCALL flag on this week's tickets
    rec = []
    for j in JOBS:
        if j["rcall"]:
            rec.append({"sv": j["sv"], "orig": "", "c": next((c["id"] for c in cust if c["name"] == j["cust"]), 0),
                        "days": None, "tech": j["tech"], "cust": j["cust"],
                        "basis": "flagged RCALL in ePASS" + (f" · serial {j['serial']}" if j["serial"] and j["serial"] not in ("—", "0") else ""),
                        "state": "confirmed", "unit": f"{j['brand']} {j['cat']}"}) 
    open(os.path.join(HERE, "proto_office.js"), "w").write(
        "/* generated by buildproto.py from the 9/17 SV export — do not hand-edit */\n"
        f"const REAL_OFFICE_J={js(oj)};\nconst REAL_CUST={js(cust)};\nconst REAL_HIST={js(hist)};\nconst REAL_RECALLS={js(rec)};\n")

    print(f"board: {len(board)} jobs ({sum(1 for j in board if j['day'])} routed, {sum(1 for j in board if not j['day'])} unscheduled/penciled)")
    print(f"tracker: {len(trk)} · trips: {len(trips)} · zips: {len(out['ZIP'])}")
    print(f"field: {ft_tech} · {len(ft_days)} days · {sum(len(v) for v in routes.values())} stops")
    print(f"office: {len(oj)} tickets · customers {len(cust)} · history {len(hist)} · recalls {len(rec)}")
    for day in WEEK:
        n = sum(1 for j in board if j["day"] == day)
        print(f"   {day}: {n} stops")


if __name__ == "__main__":
    main()
