#!/usr/bin/env bash
# Runs every automated check in the package. Exits non-zero on the first failure.
# Usage: bash _qa/run_all.sh   (from the package root)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== protocol resolution (JS) =="
node _qa/verify-protocol-resolution.js

echo
echo "== filter service pricing =="
node _qa/verify-filter-pricing.js

echo
echo "== v0.9 migration structure =="
python3 _qa/verify-sql-migration.py

echo
echo "== SQL <-> JS protocol parity =="
python3 _qa/verify-protocol-parity.py

echo
echo "== end-to-end browser smoke test =="
python3 _qa/smoke_browser.py

echo
echo "== JS syntax =="
for f in assets/*.js sql/dump_config.js; do node --check "$f"; done
echo "all files parse"

echo
echo "ALL QA CHECKS PASSED"
