#!/usr/bin/env python3
"""
Proves the SQL protocol-resolution model and the JavaScript resolver agree.

v0.9.1 consolidated protocol selection into WILSON_PROTOCOL.resolveCheckpointSet()
in assets/plan-config.js. The v0.9 migration re-expresses that logic as
dbo.MaintenanceProtocolAssignments + dbo.vw_MaintenanceAssetProtocol. Two
implementations of one rule is exactly the arrangement that produced the original
defect, so they have to be tested against each other rather than trusted.

This reads the assignment rows out of the generated migration, applies the SQL
view's resolution semantics in Python, and compares the result with the actual
JS resolver for every (appliance type x customer category) combination.

Run from the package root:  python3 _qa/verify-protocol-parity.py
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, "sql", "maintenance_migration_v09.sql")

# A real template code that is nonetheless the wrong answer for washers and
# dryers -- what every pre-v0.9.1 asset actually has persisted.
STALE_SNAPSHOT = "laundry"


def sql_assignments():
    """Extract (scope, code, template, precedence) from the seeded MERGE."""
    sql = open(MIG, encoding="utf-8").read()
    block = re.search(
        r"MERGE dbo\.MaintenanceProtocolAssignments AS target\nUSING \(VALUES\n(.*?)\n\) AS source",
        sql, re.S,
    )
    if not block:
        sys.exit("could not find the MaintenanceProtocolAssignments seed in the migration")
    rows = {}
    for line in block.group(1).splitlines():
        m = re.match(
            r"\s*\(N'([^']+)', N'([^']+)', (?:N'(?:[^']|'')*'|NULL), N'([^']+)', (\d+), 1\)",
            line,
        )
        if not m:
            sys.exit(f"unparsed assignment row: {line.strip()[:90]}")
        scope, code, template, precedence = m.groups()
        rows[(scope, code)] = (template, int(precedence))
    return rows


def resolve_sql(assignments, templates, asset_type_code, customer_category_code,
                asset_category, stored_code):
    """Mirror of dbo.vw_MaintenanceAssetProtocol."""
    if asset_category == "imuc":
        return "icemaker"
    if asset_category == "hvac":
        # System type, in the resolver's order, falling through to generic.
        sys_type = (asset_type_code or customer_category_code or "").lower()
        if "heat pump" in sys_type or "heatpump" in sys_type:
            return "hvac_heatpump"
        if ("mini split" in sys_type or "mini-split" in sys_type
                or "minisplit" in sys_type or "ductless" in sys_type):
            return "hvac_minisplit"
        if "furnace" in sys_type or "gas heat" in sys_type:
            return "hvac_furnace"
        if ("split" in sys_type or "package" in sys_type
                or "air handler" in sys_type or "condenser" in sys_type):
            return "hvac_cooling"
        return "generic"
    matches = []
    hit = assignments.get(("APPLIANCE_TYPE", asset_type_code))
    if hit:
        matches.append((hit[1], hit[0]))
    hit = assignments.get(("CUSTOMER_CATEGORY", customer_category_code))
    if hit:
        matches.append((hit[1], hit[0]))
    if matches:
        return sorted(matches)[0][1]
    if stored_code in templates:
        return stored_code
    return "generic"


def sql_templates():
    """Template codes seeded into MaintenanceProtocolTemplates."""
    sql = open(MIG, encoding="utf-8").read()
    block = re.search(
        r"MERGE dbo\.MaintenanceProtocolTemplates AS target\nUSING \(VALUES\n(.*?)\n\) AS source",
        sql, re.S,
    )
    if not block:
        sys.exit("could not find the MaintenanceProtocolTemplates seed in the migration")
    return {m.group(1) for m in re.finditer(r"^\s*\(N'([^']+)'", block.group(1), re.M)}


def resolve_js_batch(cases):
    """Run the real JS resolver over every case in one node process."""
    script = """
const fs=require('fs'),vm=require('vm'),path=require('path');
const sandbox={window:{}};vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(%r,'assets','plan-config.js'),'utf8'),sandbox);
const R=sandbox.window.WILSON_PROTOCOL.resolveCheckpointSet;
const cases=JSON.parse(fs.readFileSync('/dev/stdin','utf8'));
process.stdout.write(JSON.stringify(cases.map(c=>R(c))));
""" % ROOT
    out = subprocess.run(
        ["node", "-e", script], input=json.dumps(cases),
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main():
    assignments = sql_assignments()
    templates = sql_templates()
    types = sorted({c for s, c in assignments if s == "APPLIANCE_TYPE"})
    categories = sorted({c for s, c in assignments if s == "CUSTOMER_CATEGORY"})
    print(f"templates seeded: {len(templates)}")
    print(f"assignments seeded: {len(assignments)} "
          f"({len(types)} appliance types, {len(categories)} customer categories)")

    cases, expected = [], []
    for type_code in types + [""]:
        for category_code in categories + [""]:
            # "hvac" was missing here, which is exactly how a migration with
            # zero HVAC protocol templates in it passed this test and printed
            # PARITY CONFIRMED. A resolver test that does not exercise a group
            # cannot notice that the group is gone.
            for asset_category in ("standard", "imuc", "hvac"):
                cases.append({
                    "exactType": type_code,
                    "type": type_code or category_code,
                    "customerCategory": category_code,
                    "group": asset_category,
                    # Deliberately wrong snapshot: pre-v0.9.1 persisted values.
                    "checkpointSet": STALE_SNAPSHOT,
                })
                expected.append(resolve_sql(
                    assignments, templates, type_code, category_code,
                    asset_category, STALE_SNAPSHOT,
                ))

    actual = resolve_js_batch(cases)
    mismatches = [
        (c, want, got)
        for c, want, got in zip(cases, expected, actual) if want != got
    ]

    print(f"cases compared: {len(cases)}")
    if mismatches:
        print(f"\n{len(mismatches)} MISMATCH(ES) between SQL and JS resolution:")
        for c, want, got in mismatches[:25]:
            print("  type=%-26r category=%-16r group=%-9s sql=%-12s js=%s"
                  % (c["exactType"], c["customerCategory"], c["group"], want, got))
        return 1
    print("SQL and JS resolve every combination identically -- PARITY CONFIRMED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
