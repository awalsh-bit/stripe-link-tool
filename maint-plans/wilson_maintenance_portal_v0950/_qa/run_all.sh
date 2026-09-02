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
echo "== a quote and the enrollment it becomes are one price =="
node _qa/verify-quote-enrollment-parity.js

echo
echo "== when a visit can happen, and what it takes to get in =="
node _qa/verify-scheduling-preference.js

echo
echo "== two screens, not eight tabs =="
node _qa/verify-command-center.js

echo
echo "== decline detection =="
node _qa/verify-decline-detection.js

echo
echo "== longevity guidance =="
node _qa/verify-lifecycle-advice.js

echo
echo "== HVAC performance and guardrails =="
node _qa/verify-hvac-performance.js

echo
echo "== what a check produces, and what may score =="
node _qa/verify-answer-kinds.js

echo
echo "== does the control match the measurement? =="
node _qa/verify-check-controls.js

echo
echo "== water hardness as a lifecycle modifier =="
node _qa/verify-water-hardness.js

echo
echo "== an invoice, matched onto what the customer enrolled =="
node _qa/verify-equipment-match.js

echo
echo "== anonymous slots become named appliances =="
node _qa/verify-equipment-enrichment.js

echo
echo "== the phone build is generated, not forked =="
python3 _qa/verify-field-preview.py
echo
echo "== a correction and a replacement are not the same thing =="
node _qa/verify-field-equipment.js
echo
echo "== brand, product line, and whether Wilson can touch it =="
node _qa/verify-brand-lifespans.js

echo
echo "== where a draft expected life came from, and whether we say so =="
node _qa/verify-life-provenance.js

echo
echo "== one implementation per rule =="
node _qa/verify-single-implementation.js

echo
echo "== every enrollable appliance gets a protocol that fits it =="
node _qa/verify-protocol-coverage.js

echo
echo "== indoor or outdoor, and who decided =="
node _qa/verify-outdoor-install.js

echo
echo "== Wilson Temp Watch =="
node _qa/verify-temp-watch.js

echo
echo "== the field amendment and the quote pipeline =="
node _qa/verify-amendment.js

echo
echo "== the pilot server catches the forced failures =="
python3 _qa/verify-pilot-server.py

echo
echo "== does the database agree about this house's water? =="
python3 _qa/verify-water-parity.py

echo
echo "== invoice parser =="
python3 _qa/verify-invoice-parser.py

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
echo "== what a customer is allowed to be told =="
python3 _qa/verify-report-honesty.py

echo
echo "== the tool in a hand, measured =="
python3 _qa/verify-field-ergonomics.py

echo
echo "== offline app shell =="
python3 _qa/verify-offline-shell.py

echo
echo "== field tool with the server gone =="
python3 _qa/verify-offline-browser.py

echo
echo "== server passcode and photo endpoints =="
python3 _qa/verify-server-auth.py

echo
echo "== photographs leaving the phone =="
python3 _qa/verify-photo-sync.py

echo
echo "== JS syntax =="
# sw.js runs in a worker scope, not a page, so it is checked here rather than
# loaded by any HTML.
for f in assets/*.js sql/dump_config.js sw.js; do node --check "$f"; done
echo "all files parse"

echo
echo "ALL QA CHECKS PASSED"
