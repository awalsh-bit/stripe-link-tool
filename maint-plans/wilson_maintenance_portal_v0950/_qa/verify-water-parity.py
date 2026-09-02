#!/usr/bin/env python3
"""
DOES THE DATABASE AGREE WITH THE APPLICATION ABOUT THIS HOUSE'S WATER?

The water factor now exists in two places: WILSON_WATER.lifeFactorForGpg() in
plan-config.js, and the interpolation inside vw_MaintenanceHouseholdWaterLatest
in the migration. Both turn one number into one multiplier, and that multiplier
sets the expected service life printed on a customer's report. If they drift, a
report and the dashboard quote different years for the same dishwasher and
nothing says which is right.

verify-sql-migration.py already checks that the SQL has the right SHAPE -- the
anchors match, the clamps are present, the rounding is there. Shape is not the
same as answers: a `<` where a `<=` belongs passes every one of those checks and
still disagrees at exactly the anchor points.

So this runs both sides over a dense sweep of readings and compares the numbers.

WHAT THIS DOES AND DOES NOT PROVE
---------------------------------
There is no SQL Server in this environment, so the T-SQL cannot be executed as
written. The view's algorithm is transliterated into SQLite below -- same
anchors (read out of the generated migration, not retyped), same bracketing
logic, same clamps, same ROUND(...,3) -- and SQLite is a real SQL engine, so
this does exercise SQL numeric and rounding behaviour rather than Python's.

It therefore catches: anchor drift, a changed clamp, a changed rounding, a
boundary condition that differs between the two implementations. It does NOT
catch a typo inside the T-SQL text that the transliteration does not share.
That gap is real and is the reason the structural checks exist alongside this
one. Running the migration against a real SQL Server would close it.

Run: python3 _qa/verify-water-parity.py
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MIG = os.path.join(ROOT, "sql", "maintenance_migration_v09.sql")

fails: list[str] = []


def anchors_from_migration():
    """The anchors the DATABASE will actually have, read out of the seed.

    Read from the migration rather than from plan-config.js on purpose: taking
    them from the config would compare the application against itself and pass
    even if the generator never wrote them.
    """
    mig = open(MIG, encoding="utf-8").read()
    seed = re.search(
        r"MERGE dbo\.MaintenanceWaterLifeFactorAnchors AS target(.*?)\n\) AS source",
        mig, re.S)
    if not seed:
        fails.append("no life-factor anchor seed in the migration at all")
        return []
    rows = []
    for row in re.findall(r"^\s+\(([^)]*?)\),?\r?$", seed.group(1), re.M):
        cells = [c.strip() for c in row.split(",")]
        rows.append((float(cells[0]), float(cells[1])))
    return sorted(rows)


def sql_factors(anchors, readings):
    """The view's algorithm, transliterated into SQLite and executed."""
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE anchors (GrainsPerGallon REAL PRIMARY KEY, "
               "LifeFactor REAL NOT NULL, IsActive INTEGER NOT NULL DEFAULT 1)")
    db.executemany("INSERT INTO anchors (GrainsPerGallon, LifeFactor, IsActive) "
                   "VALUES (?, ?, 1)", anchors)
    db.execute("CREATE TABLE tests (WaterTestId INTEGER PRIMARY KEY, "
               "GrainsPerGallon REAL NOT NULL)")
    db.executemany("INSERT INTO tests (WaterTestId, GrainsPerGallon) VALUES (?, ?)",
                   list(enumerate(readings)))
    # The same three arms as the view: flat below the first anchor, flat at and
    # above the last, linear and rounded between the bracketing pair.
    sql = """
    WITH bounds AS (
        SELECT MIN(GrainsPerGallon) AS FirstGpg, MAX(GrainsPerGallon) AS LastGpg
        FROM anchors WHERE IsActive = 1
    )
    SELECT t.GrainsPerGallon,
        CASE
            WHEN t.GrainsPerGallon <= bd.FirstGpg THEN
                (SELECT LifeFactor FROM anchors WHERE GrainsPerGallon = bd.FirstGpg)
            WHEN t.GrainsPerGallon >= bd.LastGpg THEN
                (SELECT LifeFactor FROM anchors WHERE GrainsPerGallon = bd.LastGpg)
            ELSE ROUND(
                lo.LifeFactor
                + ((t.GrainsPerGallon - lo.GrainsPerGallon)
                   / (hi.GrainsPerGallon - lo.GrainsPerGallon))
                  * (hi.LifeFactor - lo.LifeFactor), 3)
        END AS LifeFactor
    FROM tests t
    CROSS JOIN bounds bd
    LEFT JOIN anchors lo ON lo.GrainsPerGallon = (
        SELECT MAX(an.GrainsPerGallon) FROM anchors an
        WHERE an.IsActive = 1 AND an.GrainsPerGallon <= t.GrainsPerGallon)
    LEFT JOIN anchors hi ON hi.GrainsPerGallon = (
        SELECT MIN(an.GrainsPerGallon) FROM anchors an
        WHERE an.IsActive = 1 AND an.GrainsPerGallon > t.GrainsPerGallon)
    ORDER BY t.WaterTestId
    """
    out = {}
    for gpg, factor in db.execute(sql):
        out[gpg] = None if factor is None else round(float(factor), 6)
    db.close()
    return out


def js_factors(readings):
    """The application's answer for the same readings."""
    script = """
    const fs = require("fs");
    global.window = {};
    eval(fs.readFileSync(process.argv[1], "utf8"));
    const W = window.WILSON_WATER;
    const out = {};
    JSON.parse(process.argv[2]).forEach(function (g) { out[g] = W.lifeFactorForGpg(g); });
    process.stdout.write(JSON.stringify(out));
    """
    res = subprocess.run(
        ["node", "-e", script, os.path.join(ROOT, "assets", "plan-config.js"),
         json.dumps(readings)],
        capture_output=True, text=True, check=True)
    return {float(k): (None if v is None else round(float(v), 6))
            for k, v in json.loads(res.stdout).items()}


def main() -> int:
    anchors = anchors_from_migration()
    if not anchors:
        print("no anchors to compare")
        return 1
    print("anchors from the migration:",
          " ".join("%g@%g" % a for a in anchors))

    # A dense sweep, plus every anchor and both sides of it -- boundaries are
    # where a `<` and a `<=` part company, and they are invisible in a coarse
    # sample.
    readings = [round(x * 0.1, 1) for x in range(0, 401)]
    for gpg, _ in anchors:
        for delta in (-0.01, 0.0, 0.01):
            readings.append(round(gpg + delta, 2))
    readings = sorted(set(readings))

    sql = sql_factors(anchors, readings)
    js = js_factors(readings)

    mismatches = []
    for gpg in readings:
        a, b = sql.get(gpg), js.get(gpg)
        if a is None or b is None:
            mismatches.append((gpg, a, b))
        elif abs(a - b) > 1e-9:
            mismatches.append((gpg, a, b))
    if mismatches:
        fails.append("%d of %d readings disagree between SQL and the application"
                     % (len(mismatches), len(readings)))
        for gpg, a, b in mismatches[:12]:
            fails.append("  %g gpg: SQL %s, application %s" % (gpg, a, b))
    else:
        print("%d readings compared, 0 disagreements" % len(readings))
        print("   sampled: " + ", ".join(
            "%g gpg -> %g" % (g, js[g]) for g in (0, 3.5, 5, 10.5, 12.8, 15, 26, 40)))

    # The clamps, stated as their own assertions rather than left implicit in
    # the sweep: these are the two ends where the feature makes its promises.
    if js.get(0.0) != 1.0:
        fails.append("soft water is not free in the application")
    last_gpg, last_factor = anchors[-1]
    if js.get(40.0) != last_factor:
        fails.append("the application extrapolates past %g gpg, which is past the evidence"
                     % last_gpg)
    if sql.get(40.0) != last_factor:
        fails.append("the SQL view extrapolates past %g gpg, which is past the evidence"
                     % last_gpg)

    print()
    if fails:
        print("%d PROBLEM(S):" % len(fails))
        for f in fails:
            print("  -", f)
        return 1
    print("SQL AND APPLICATION AGREE ON EVERY READING")
    return 0


if __name__ == "__main__":
    sys.exit(main())
