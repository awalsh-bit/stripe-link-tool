# Wilson Maintenance Portal — Session Handoff Addendum

_Created: 2026-08-24_
_Applies to: prototype generation v0.9 (`wilson_maintenance_portal_v09__4_.zip`)_

## 0. What this file is

A short continuity record of a working session that reviewed the v0.9 prototype
source. It captures findings that are **not** recorded in
`WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md` or `MERGE_GUIDE.md`, plus the
agreed next work order.

Read this **after** the context file and merge guide. It supersedes them only
where explicitly stated in Section 5.

---

## 1. Cowork project setup

### Files to load into the project

| File | Role |
|---|---|
| `WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md` | Authoritative product/business rules |
| `WILSON_MAINTENANCE_MAIN_DASHBOARD_MERGE_GUIDE.md` | Production merge architecture |
| `WILSON_SESSION_HANDOFF_2026-08-24.md` | This file — current findings and work order |

Both of the first two are also present inside the ZIP at the project root and
`docs/MERGE_GUIDE.md`. Loading them as project files makes them available
without unpacking.

### Working directory

Extract `wilson_maintenance_portal_v09__4_.zip` to a working folder. **Keep the
original ZIP untouched elsewhere as a rollback point** — edits made in Cowork
are real edits to real files, unlike the disposable sandbox copy used to produce
this document.

### Read order for whoever picks this up

1. This file (current state and open work)
2. `WILSON_MAINTENANCE_PORTAL_PROJECT_CONTEXT.md` (business rules)
3. `docs/MERGE_GUIDE.md` (production target)
4. `assets/plan-config.js` — the de facto business-rule engine
5. `assets/store.js` — the de facto data model and demo backend
6. `assets/tech-maintenance.js` — the field workflow
7. `sql/maintenance_schema.sql` — current schema (note: stale, see Section 3.2)

Do **not** start from `docs/API_CONTRACT.md`. See Section 3.2.

---

## 2. Verified current state

Confirmed by reading v0.9 source directly:

- Package is complete and internally consistent. The `__4_` ZIP is byte-identical
  to `__3_` except for the addition of `docs/MERGE_GUIDE.md`.
- `plan-config.js` holds pricing constants, all four plan definitions, filter
  service config, the customer-facing category taxonomy, the internal
  `applianceTypes` taxonomy, all eight checkpoint sets, and scoring weights.
- `store.js` (958 lines) is the entire demo backend: seeded households,
  enrollment, visit creation, mock charge/AR, tech inspections, report
  generation, quotes, invoice drafts, localStorage persistence.
- `tech-maintenance.js` implements brand-tier defaults, expected-life lookup,
  lifecycle staging, 75/25 scoring, autosave, readiness gating, and 1–5 tap
  rating buttons.
- `serve_portal.py` + `invoice_parser.py` + vendored pypdf provide a working
  local server with a real PDF invoice-import endpoint.
- `sql/maintenance_schema.sql` creates 24 tables and 3 views.
- `samples/` contains the locked 7-page health report PDF and a 3-page proposal
  PDF — these are the actual visual references, not descriptions of them.

Non-regression spot checks that passed:

- IMUC-aware Estate comparison is real (`appliance-builder.js:162` compares
  `estate_annual` against `estate_preferred`).
- No range sliders in the field tool; scoring is five tap buttons.
- Visit-ID routing guard is present; no sample-household fallback.

---

## 3. Findings not recorded elsewhere

### 3.1 Four appliance protocols are orphaned in stored data — **fix first**

`plan-config.js` defines eight purpose-built checkpoint sets. Four of them are
never assigned by the customer-category config:

| Customer category | Stored `checkpointSet` | Should be |
|---|---|---|
| Ventilation | `generic` | `ventilation` |
| Microwave | `cooking` | `microwave` |
| Washer | `laundry` | `washer` |
| Dryer | `laundry` | `dryer` |

The `ventilation`, `microwave`, `washer`, and `dryer` sets exist and match the
protocols specified in context §24. They are simply not wired up.

**Why it appears to work today:** `tech-maintenance.js:45` defines
`templateKey()`, which re-derives the protocol from appliance type and customer
category using a hardcoded if-chain, ignoring the stored `checkpointSet` value
except as a final fallback. The technician therefore sees the correct protocol.

**Why it is still a defect:** protocol selection is duplicated in two places and
the authoritative-looking one is wrong. Every asset created by enrollment
(`appliance-builder.js:58`, `:88`), invoice import (`invoice-import.js:245`), or
the seed data (`store.js:56`) is persisted with an incorrect `checkpointSet`.

**Why it matters for the merge:** `MERGE_GUIDE.md` §22 calls for versioned
protocol configuration in SQL. At that point the stored value becomes
authoritative and the hardcoded if-chain goes away — so washers would silently
fall back to the three-check generic protocol.

**Fix:** correct the four category mappings, then rewrite `templateKey()` to
resolve from config rather than a hardcoded chain, giving one source of truth
that ports cleanly to SQL.

### 3.2 `docs/API_CONTRACT.md` contradicts the rest of the package

The contract is still v0.3 (dated alongside the original schema). Two problems:

1. §11 specifies `POST /api/maintenance/admin/reports` — the office-built report
   flow. Context §25 and merge guide §23 both state the manual report builder is
   **retired** and that field data is the sole source for health reports. A
   developer building to this contract would rebuild the thing that was
   deliberately removed.
2. It contains essentially no technician/field endpoints. The entire v0.5–v0.9
   field workflow is unrepresented.

Until rewritten, this is the most actively misleading file in the package. Mark
it superseded or delete it if it is not rewritten promptly.

### 3.3 `sql/maintenance_schema.sql` predates the field work

Schema is v0.3 (2026-08-21), before v0.5–v0.9. No tables for technician
inspections, checkpoints, readings, photos, areas, or lifecycle/brand tier.
Health-report tables reflect the retired office-builder model.

`MERGE_GUIDE.md` §7 already specifies the additions required. That section is
the correct basis for the migration; it does not need to be re-derived.

### 3.4 Files referenced but absent from the package

- `wilson_routing_dashboard_context (2).md` — listed second in context §35's read
  order. Not in the ZIP.
- Sample Wilson sales invoices (`S00063887`, `S00063887-1`). `invoice_parser.py`
  cannot be validated against the real format without them.
- Wilson dashboard screenshots. `screenshots_v03/` contains four customer-side
  images only.

### 3.5 Minor

- `_qa/` is empty. There are no automated tests. Per `docs/QA_SUMMARY_V09.md`,
  headless browser QA could not be run.
- Context §32's file map is stale — it omits `assets/` entirely (including
  `store.js`), `sql/`, `serve_portal.py`, `invoice_parser.py`, and `samples/`.

---

## 4. Agreed work order

Items 1–3 are cleanup that makes later work safe. Item 4 is new product.

1. **Consolidate protocol resolution.** Fix the four category mappings in
   `plan-config.js`; rewrite `templateKey()` in `tech-maintenance.js` to read
   config instead of hardcoding. Single source of truth. _(Small.)_
2. **Rewrite `docs/API_CONTRACT.md` to v0.9.** Remove the retired report-builder
   endpoints; add technician/field endpoints. _(Medium.)_
3. **Write the §7 SQL migration.** Areas, AR billing, the three field-inspection
   tables, report delivery tracking, technician user linkage, lifecycle and
   protocol config. Additive `IF NOT EXISTS` guards, matching the existing
   script's conventions (`INT IDENTITY`, `dbo.Maintenance*` prefixes). _(Medium.)_
4. **Build the HVAC field workflow.** The largest remaining feature gap (context
   §34 item 3). Scope how closely it should mirror the appliance flow before
   starting. _(Large.)_

### Blocked vs. not blocked

**Not blocked on main dashboard code:** all of items 1–4, plus protocol wording
refinement, phone field testing, and moving pricing logic server-side. The
maintenance module's business rules, schema, protocols, scoring, field UX, and
report content are all self-contained.

**Blocked on main dashboard code:** only the merge itself — `MERGE_GUIDE.md` §3
discovery and Phase 1 onward. Needs the Flask entry point, auth/session object,
base and nav templates, and the SQL connection helper. Source files, not
screenshots. Redact secrets in any `.env` / `config.py` before sharing; the names
of settings are what matter, never the values.

---

## 5. Edits this file requires to the context document

Per context §36, apply these rather than leaving contradictory statements:

- **§32 (file map):** rewrite to reflect actual package contents (see 3.5).
- **§34 (open questions):** add protocol-config consolidation; note that the
  API contract and SQL schema are stale against v0.9.
- **§33 (non-regression checklist):** add "every customer category resolves to
  its intended checkpoint set from configuration, not from hardcoded logic."
- **§35 (handoff order):** note that `docs/API_CONTRACT.md` is superseded until
  rewritten.

Once those edits are made, Sections 3 and 5 of this file can be deleted and this
document retired.

---

## 6. Standing business context gap

Independent of the technical work: no business context for Wilson AC & Appliance
has been supplied beyond what the project documents imply. Anything about market
position, competitors, values, service economics, or internal roles is inference
only.

Open policy questions in context §34 that cannot be resolved without it:

- filter material billing outside Concierge (item 4),
- cancellation and proration rules (item 6),
- role permissions for dispatcher, technician, sales liaison, and manager
  (item 12),
- whether a WashTower counts as one maintained asset or two (item 13).

These are business decisions, not technical ones. They should be answered by
Wilson rather than assumed.
