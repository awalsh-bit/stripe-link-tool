# Customer-Data Leak Check (recurring)

Run this whenever the owner asks for a "security check" / "leak check" —
ideally after any batch of new pages or endpoints. Last run: **2026-07-14**
(two findings, both fixed same day — see log at bottom).

## The check

1. **Unauthenticated surface.** Enumerate `SERVICE_PUBLIC_PATHS`,
   `SERVICE_PUBLIC_API_PREFIXES`, `ALWAYS_PUBLIC_PATHS`, `PUBLIC_AUTH_PATHS`,
   `UNAUTHENTICATED_INTERNAL_PATHS` in server.js. For every entry that can
   RETURN data (not just accept it), confirm it exposes no stored customer
   record without a strong, expiring token. Watch especially:
   - `/api/service/prefill/:token` — returns a full customer record
     (name, address, gate code). Token must stay ≥192-bit AND expiring.
   - `/api/config` — must return the publishable key ONLY.
2. **Route gating sweep.** `grep -oE 'app\.(get|post|delete|put)\("(/api/[^"]+)"(, [a-zA-Z]+\([^)]*\)|, [a-zA-Z]+)?' server.js`
   and eyeball every route: money/PII routes need `requirePagePermission(...)`
   or `requireExecutiveApi`; routes gated only by the global auth middleware
   must do their own ownership checks (e.g. `/api/me/*`, mileage entries).
3. **Static file server.** `express.static(__dirname)` serves the repo root
   to any authenticated user. The deny middleware above it must block:
   `/data/`, `/sql/`, `/docs/`, `/lib/`, `/scripts/`, `/items/`, `/tmp_*`,
   `server.js`, and all `.json .sql .md .xlsx .csv .log .txt .env` files
   (robots.txt excepted). If new sensitive files or folders are added to the
   repo root, extend the deny rules.
4. **Git hygiene.** `git ls-files | grep -E '\.(json|xlsx|txt|csv)$'` — every
   tracked data-ish file must be empty/config-only. `.env`, `links.json`,
   `terminal-payments.json`, `service-cards.json`, `extra data.txt` stay
   gitignored. Nothing PII-bearing gets committed.
5. **Client-side.** New pages must not interpolate customer/Stripe-derived
   strings into `innerHTML` without escaping (prefer `textContent` /
   `createElement`, as the newer pages do).
6. **Tokens & sessions.** Auth/invite/reset tokens: stored hashed, single-use,
   expiring. Sessions: server-side, revoked on disable/password change.

## Known-open items (accepted for now, revisit)

- Older dashboards still use `innerHTML` interpolation in places
  (CODE-AUDIT-2026-07-07 finding 5) — newer pages build DOM nodes instead.
- No helmet/CSP headers; rate limiting covers auth + spec-create only
  (finding 4, partial).
- `err.message` returned to clients in many handlers (finding 7).
- Customer PII still lives in flat JSON on Render's disk pending the
  Postgres migration phases 2–4 (finding 3).
- Recommended git hygiene: untrack `data/*.json` except `secret-menu.json`
  (`git rm --cached data/deposit-agreements.json data/deposit-payment-events.json data/event-rsvps.json data/events.json data/service-cards-archive.json`
  + add `data/*.json` with `!data/secret-menu.json` to .gitignore) so a dev
  machine with populated ledgers can never commit them.

## Run log

- **2026-07-14** — full sweep. Route gating: clean (all PII/money routes
  page-gated or exec-gated; ungated routes verified to have internal ownership
  checks). Git: tracked data files all empty (2 bytes). FOUND + FIXED same day:
  (1) static server exposed `/data/*.json` ledgers, `server.js`, `lib/`,
  `sql/`, docs, and spreadsheets to any authenticated user — deny middleware
  added; (2) prefill tokens never expired — now 14 days from
  `secureCardPrefillUpdatedAt` (staff can always send a fresh link).
- **2026-07-07** — original code audit (CODE-AUDIT-2026-07-07.md).
