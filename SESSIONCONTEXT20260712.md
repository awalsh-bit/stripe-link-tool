# Session Context — July 11–12, 2026 (User Access hardening, Employee Directory, Audit page, Steel Cod features)

> **MOBILE OPTIMIZATION PLAN (audited 7/13 — team going mobile-first).**
> Shell CSS already adapts <1200px; mileage.html got its mobile pass (committed).
> Remaining, in priority order — additive media-query work only, no rewrites:
> 1. secret-menu.html — card grid `minmax(420px,1fr)` overflows phones; fix is
>    `minmax(min(420px,100%),1fr)`. Field sales page, one-line fix.
> 2. appliance-service-calls.html — ZERO media queries, table min-width 1350px.
> 3. archive-service-calls.html — zero media queries, same family.
> 4. spec-packages.html — forms fine; results table scroll-only, wants card stacking.
> 5. mileage-review.html — tables need the mileage-style card treatment.
> 6. user-admin.html / audit-log.html — scroll-only tables, exec desktop, lowest.
> Already mobile-ready: dashboard, index, terminal, charge-saved-card,
> intent-lookup, paid-order-detail, bank-balancing, incoming-payouts,
> link-detail-lookup, event-rsvps, commissions, salesdashboard, auth pages.

> **DONE 7/14: Issue Refund overhaul** (zero-default amount, required
> product/service note with generic-phrase rejection, irreversibility
> checkbox, refund audit-logged + note in Stripe metadata). Mobile pass also
> complete for the whole priority list. Still open: mileage feature's first
> live end-to-end test (submit → approve from a second account) and page
> grants + commute miles before team rollout.

Handoff for future Claude sessions working in `wilson-agility` (Wilson Appliance
internal payments/ops tool: Express `server.js`, `lib/` layer, static HTML
dashboards, Postgres on Render, Stripe). Owner: Andrew Walsh
(jandrewwalsh@gmail.com / awalsh@wilsonappliance.com). Previous context:
SESSIONCONTEXT20260708.md.

## 0. Repo / deploy state

- Repo `awalsh-bit/stripe-link-tool`, branch `main`. **History was rewritten
  July 9** to purge `extra data.txt` (customer PII) via filter-branch; the file
  is now gitignored and must never be committed again. All commit hashes from
  April 2026 onward changed; any stale clone must `git fetch && git reset --hard
  origin/main` before pushing.
- Owner pushed and deployed most of this session's work to Render on 7/11–12.
  The last change (Save Default View black-border restyle in `dashboard.html`)
  may postdate the final push — check `git status --short` first.
- Old work computer wiped/replaced. New machine setup: clone, drop in `.env`,
  `npm install`. `.env` exists only locally (Stripe keys, session secret, env
  logins); **Resend vars live only in Render env config**, so local dev cannot
  send auth email (by design).
- Process: Claude edits files on the owner's disk via the device bridge but
  NEVER runs git write operations (an early attempt left a stale
  `.git/index.lock` — the bridge cannot delete files). Owner commits/pushes
  from his own terminal, typically at end of session.

## 1. Resend email — WORKING

Owner fixed the domain/API-key issue himself; invites, verification, and
resets all send. Resend config is in Render only.

## 2. Steel Cod (spec packages) — built, compliant, awaiting API key

- Tom Offen (tom@steelcod.com) sent five business guidelines; the integration
  was code-audited against them and is compliant: project-based packages only,
  no public spec exposure (page is internal + permission-gated), user-initiated
  only (single call site behind the create form), no automated triggers, and
  `userEmail` always comes from the server-side session (shared logins get 400).
  A reply accepting the terms was drafted; **API key not yet issued**. No test
  environment — production from day 1: plan is roster check
  (`/api/steelcod-users`), one real test package, executive delete.
- Spec Packages page additions: read-only "Your email (requester)" field;
  salesperson email prepopulates with self + hover helper ("If you are creating
  this spec book on behalf of a salesperson, update the email here").
- **Attach-to-quote PDF merge**: upload a sales order/quote PDF and the compiled
  spec pages (slim or full — user choice) are appended server-side via `pdf-lib`
  (new dependency; pure JS, Render-safe). Endpoint
  `POST /api/spec-packages/:navId/attach-quote` (page-gated, express.raw PDF
  body, nothing stored, URL resolved server-side — no SSRF). Available on the
  create form (auto-merge + download after create) and per search row ("Attach
  quote" panel). Caveat: the retrieve call's package-URL field name is
  uncertain in Steel Cod's docs — the endpoint tries `publicUrl` /
  `specPackageUrl` / `specPackage.publicUrl`; if the first live test says
  "Steel Cod did not return a URL," fix that field.
- Rate-limit guards: HTTP 429 from Steel Cod → friendly "busy, try again"
  message end-to-end; 10-second submit clocks (visible button countdown on
  create + merge; server-side per-user create cooldown map returning 429) —
  added because staff double/triple-click.

## 3. Access-control fixes and features (this session)

- **Fossil bug fixed (was blocking Elliott):** `/api/secret-menu` had a
  pre-overhaul `allowedGroups` check and the paid-date repair tool had a
  `REPAIR_ALLOWED_GROUPS` whitelist — both 403'd every individual (db) account,
  whose `accessGroup` is `"member"`. Both now defer to page grants
  (`requirePagePermission` / `canAccessPathForUser`). No other accessGroup
  whitelists remain; do not reintroduce this pattern.
- **Job-code presets** (`JOB_CODE_PRESETS` in server.js): Sales, Repair Tech,
  Client Care, Accounting, Installer, Warehouse, Leader. Clicking a preset in
  User Admin CHECKS its pages (staged, additive, combinable); nothing applies
  until Save. `ACCESS_GROUPS` now serves ONLY legacy-login authorization.
  NOTE: Repair Tech / Installer / Warehouse page lists were best guesses —
  owner may still want to adjust the mappings.
- **User Admin UX:** permission checkboxes are a vertical one-per-line list
  under category headers; staged (unsaved) edits show amber + "unsaved" tag;
  leaving the page with pending edits triggers a browser warning. (Root cause
  of the Elliott confusion #1: staged edits look granted until Save.)
- **Per-user preferences** (`app_users.preferences` jsonb, `sql/004`):
  - Dashboard hero cards: permission-filtered, 4 personal slots,
    `POST /api/me/dashboard-slots`, picker grouped by function then
    alphabetical; executives can pin User Admin / Activity Audit / Commissions
    (grouped "Executive"). Legacy sessions get defaults, no customization.
  - Default dashboard view: `POST /api/me/dashboard-view` stores
    `{ employee: "self"|"all"|CODE, department }`. "Save Default View" button
    (black 2px border, bold, white fill) in the queue toolbar; saving while
    filtered to yourself stores "self" so it survives code re-keying.
- **Employee directory moved to Postgres** (`employee_directory`, `sql/005`,
  `lib/employee-directory.js`; seeded once from the legacy static file).
  `/employee-directory.js` is now served from the DB (static file is fallback),
  so the consuming pages needed no changes. User Admin has a full editor
  (add/update, inline edit, delete; audit-logged; department datalist).
  **Email is the join** between directory codes and accounts: powers the
  "Code: XXX" chip on user rows, employee-code auto-fill on Send Payment
  Link / Card Reader / Charge Saved Card (dispatches 'input' so existing
  lookups run), and per-employee dashboard defaults. Codes are 1–3 chars
  (page inputs cap at 3). For the future ePASS→NetSuite re-key: edit codes in
  the UI (code changes = add new + delete old); historical rows keep old codes.
- **Directory row account actions:** Send invite (no account yet — uses the
  row's name/email), Resend invite (pending), **Force reset** (active) — the
  compromised-password kill switch: clears `password_hash` and deletes all
  sessions in one transaction, then emails a 1-hour reset link. The Users
  table's "Send reset" remains the gentle email-only variant.
- **Name join:** the directory name is the source of truth — User Admin
  displays it over the account's display_name, saving a directory entry syncs
  the account name (audit `nameSynced`), and registration overrides the typed
  name with the directory name when the email matches (fixes ALL-CAPS
  self-registrations, e.g. Shaun).
- **Audit moved to its own page:** `audit-log.html` — "Agility User Activity
  Audit" (executive-only, in `EXECUTIVE_ONLY_PAGE_PATHS`, in exec nav/footer).
  Empty until a date range is fetched (mirrors Paid Order Detail); filters by
  user (actor OR target) and activity type (distinct actions endpoint); CSV
  export client-side (`agility-audit_<start>_to_<end>.csv`); result cap 2000
  (max 10000) with a "narrow the range" warning. **`access_audit_log.ip`
  column** (`sql/006`): every audit write now stamps the client IP
  (`trust proxy` was already on, so IPs are real). Older rows have ip='' (some
  carry ip in detail; page falls back to it). user-admin's audit section is now
  just a link card.
- **Dashboard polish:** headers "Open Link Queue" / "Paid History" / "Payment
  Queue and Paid History"; employee filter dropdowns on queue AND paid history
  (default to the signed-in employee via directory email match; department
  widens to "all" when self-defaulting); aging dropdown REMOVED (fixed 3-day
  threshold; row colors are the signal); toolbar order: search, User, Dept,
  Status, Save Default View, Link Detail Lookup (far right).

## 4. Zapier → Podium paid-link texts — still pending

Server side done (`maybeSendPaidTextWebhook` → `ZAPIER_PAID_TEXT_HOOK_URL`,
unset = disabled). Remaining: build the Zap (Webhooks Catch Hook → Podium Send
Message, customer is the recipient), set the env var in Render.

## 5. Legacy login flag — still ON

`LEGACY_SHARED_LOGIN_ENABLED` remains true. Rollout path: staff register/verify
(Resend now works), grant pages (job-code presets), then flip the flag off.
Break-glass `EXECUTIVE_USERNAME/PASSWORD` stays regardless.

## 6. Steel Cod user roster note

Wilson has 19 Steel Cod users (Dripping Springs). `Accounting@wilsonappliance.com`
(Will Echols) is billing-contact only — he never creates packages, so the
email mismatch with any tool account doesn't matter. Disabled Steel Cod users
(Eric Hoffmann, helen rayborn, Meg Ort) would hit error 1009 if they ever use
spec packages.

## 7. When adding a new internal page (updated checklist)

`INTERNAL_PAGE_PATHS`, `PAGE_LABELS`, `PAGE_CATEGORIES` (or
`EXECUTIVE_ONLY_PAGE_PATHS` if exec-only), nav + footer in
`internal-shell.js`, gate its APIs with `requirePagePermission("/<page>.html")`,
and (optional) `CARD_TEXT` + exec-group list in `dashboard.html` for the hero
card picker. Presets that should include it: `JOB_CODE_PRESETS`.

## 8. Backlog (owner said add when asked — do not start unprompted)

- SOP documentation / operational checklists living in Agility.
- Old-record employee-code remap tool (only if the NetSuite re-key makes
  historical filtering annoying).
- Postgres migration phases 2–4 (payment_links / charges / service_requests
  still JSON-backed via STORAGE_MODE).
- Remaining items from CODE-AUDIT-2026-07-07: consistent HTML-escaping on the
  older dashboards, CORS scoping, prefill-token expiry.
