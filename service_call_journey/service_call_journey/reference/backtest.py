"""Grade the placement priors against what Wilson's dispatchers actually did.

    python3 backtest.py [months]        default 24

The shadow test (spec §14) grades suggestions live, a few dozen a week. The catalogue lets us do the
same thing backwards over thousands of real bookings before a single customer sees a date.

**What this measures, and what it honestly cannot.** The history carries a ZIP and a scheduled date,
not a street-level lat/lng and not the capacity state of the week it was booked in. So this grades the
*priors* — the zone table, the primary/secondary tech assignments, the eligibility rules — which is
exactly the part I could not verify by reasoning. It does not grade the day choice or the drive-time
cost function; those need the full capacity simulation and are left for the live shadow test rather
than faked here with zip centroids.

Three questions:

1. **Tech choice.** For a visit in zone Z, does the zone table's primary/secondary list contain the tech
   who actually went — and is the primary the one who actually went?
2. **Which zones are really owned.** Concentration per zone: if one tech does 80% of a zone it has a
   real primary; if the top tech does 25% it does not, and calling someone "primary" there is fiction.
3. **How wide is a tech's day.** Distinct zones per tech-day is measurable without street geometry and
   says whether routes are tight or scattered.
"""
from __future__ import annotations

import collections
import csv
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "repo", "phase0"))
from wilson_service.db import DB          # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "repo", "reference")
# Cayden 9/16: manage the current eleven only. SAW, MWH and MJI have left; JKO and EHM are office staff
# whose tickets are counter sales (already excluded by ticket_kind='field').
CURRENT = {"DLA", "AJH", "TDP", "JRC", "KJB", "KJB2", "CIT", "CEM", "BLL", "JHM", "MAP", "VWJ"}
ALIAS = {"KJB2": "KJB"}


def load_zones():
    zp, zs = {}, {}
    with open(os.path.join(REF, "zone_table.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            z = (r.get("epass_map_zone") or r.get("zone_code") or "").strip()
            if not z:
                continue
            zp[z] = (r.get("primary_tech") or "").strip()
            zs[z] = (r.get("secondary_techs") or "").replace(",", " ").split()   # the table is space-separated
    return zp, zs


def main():
    months = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    db = DB.sqlite("/tmp/hist.db")
    cutoff = (dt.date(2026, 9, 16) - dt.timedelta(days=30 * months)).isoformat()
    prim, sec = load_zones()

    rows = db.fetchall(
        "SELECT sv_number, sched_date, sp_code, map_zone, zip, epass_status, total, customer_id"
        " FROM service_history WHERE ticket_kind='field' AND sched_date IS NOT NULL"
        " AND sched_date>=? AND sp_code<>'' ORDER BY sched_date", (cutoff,))
    rows = [r for r in rows if r["sp_code"] in CURRENT]
    for r in rows:
        r["tech"] = ALIAS.get(r["sp_code"], r["sp_code"])
    print(f"Backtest window: {cutoff} → 2026-09-16 ({months} months)")
    print(f"Routed field visits by the current roster: {len(rows):,}\n")

    # ---- 1. tech choice against the zone table
    hit_primary = hit_listed = no_zone = 0
    miss_by_zone = collections.Counter()
    for r in rows:
        z = (r["map_zone"] or "").strip()
        if z not in prim:
            no_zone += 1
            continue
        listed = [prim[z]] + sec.get(z, [])
        listed = [ALIAS.get(x, x) for x in listed]
        if r["tech"] == ALIAS.get(prim[z], prim[z]):
            hit_primary += 1
        elif r["tech"] in listed:
            hit_listed += 1
        else:
            miss_by_zone[(z, r["tech"])] += 1
    graded = len(rows) - no_zone
    print("1. TECH CHOICE — would the zone table have named the tech who actually went?")
    print(f"   graded {graded:,} visits ({no_zone:,} in a zone the table does not carry)")
    print(f"   the zone's PRIMARY went          {hit_primary:>7,}  {hit_primary/graded*100:5.1f}%")
    print(f"   a listed SECONDARY went          {hit_listed:>7,}  {hit_listed/graded*100:5.1f}%")
    miss = graded - hit_primary - hit_listed
    print(f"   someone NOT listed for that zone {miss:>7,}  {miss/graded*100:5.1f}%   <- the engine would not have offered them")
    print("   worst zone/tech pairs the table does not know about:")
    for (z, t), n in miss_by_zone.most_common(8):
        print(f"      {z:<7} {t:<5} {n:>5,} visits")

    # ---- 2. is a zone really owned?
    print("\n2. ZONE CONCENTRATION — which zones actually have a primary")
    byzone = collections.defaultdict(collections.Counter)
    for r in rows:
        z = (r["map_zone"] or "").strip()
        if z:
            byzone[z][r["tech"]] += 1
    owned, shared = [], []
    for z, c in byzone.items():
        n = sum(c.values())
        if n < 40:
            continue
        top, tn = c.most_common(1)[0]
        (owned if tn / n >= 0.6 else shared).append((z, n, top, tn / n, prim.get(z, "—")))
    owned.sort(key=lambda x: -x[1])
    shared.sort(key=lambda x: -x[1])
    print(f"   {len(owned)} zones have a real owner (top tech ≥ 60% of visits):")
    for z, n, top, share, p in owned[:10]:
        flag = "" if ALIAS.get(p, p) == top else f"   <- table says {p}"
        print(f"      {z:<7} n={n:>5,}  {top} {share*100:>5.1f}%{flag}")
    print(f"   {len(shared)} zones are genuinely shared (no tech above 60%) — a 'primary' there is fiction:")
    for z, n, top, share, p in shared[:10]:
        print(f"      {z:<7} n={n:>5,}  busiest is {top} at {share*100:>5.1f}%  (table says {p})")

    # ---- 3. how wide is a day
    print("\n3. DAY SHAPE — distinct zones per tech-day")
    day = collections.defaultdict(set)
    stops = collections.Counter()
    for r in rows:
        k = (r["tech"], r["sched_date"])
        day[k].add((r["map_zone"] or "?").strip())
        stops[k] += 1
    multi = {k: v for k, v in day.items() if stops[k] >= 3}
    zc = collections.Counter(len(v) for v in multi.values())
    tot = sum(zc.values())
    print(f"   {tot:,} tech-days with 3+ stops")
    for n in sorted(zc):
        if n <= 6:
            print(f"      {n} zone{'s' if n>1 else ' '}: {zc[n]:>5,}  {zc[n]/tot*100:5.1f}%")
    wide = sum(v for k, v in zc.items() if k >= 4)
    print(f"   {wide:,} of them ({wide/tot*100:.1f}%) span 4 or more zones in one day")
    worst = sorted(multi.items(), key=lambda kv: -len(kv[1]))[:5]
    print("   widest days on record:")
    for (t, d), zs in worst:
        print(f"      {t} {d}  {stops[(t,d)]:>2} stops across {len(zs)} zones: {', '.join(sorted(zs))[:70]}")


if __name__ == "__main__":
    main()
