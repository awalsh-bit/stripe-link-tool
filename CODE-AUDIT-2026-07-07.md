# Wilson Appliance Internal Tool — Code Audit

**Date:** July 7, 2026
**Scope:** `wilson-agility` repo — Express server (`server.js`, ~5,100 lines), `lib/` data + Stripe modules, static HTML dashboards, JSON/Postgres storage layer.
**Purpose:** Identify what is built well and where the code carries risk (data breach, bugs, or fragility) before layering on new capabilities.

---

## Executive summary

This is a competent, pragmatic codebase for a small internal payments and operations tool. The Stripe integration in particular is done carefully — idempotency keys, webhook signature verification, and retry logic are all present and thoughtful. Authentication is real (signed, HMAC-backed session cookies with timing-safe comparison), not the fake client-side gate you often see in tools like this.

The single most important weakness is **authorization**: access is enforced at the *page* level but not at the *API* level. Every logged-in user — regardless of their role — can call every money-moving and PII-exposing API endpoint directly. That is the finding to fix before adding anything new, because each new capability inherits the same gap.

Secondary themes: secrets have weak fallback defaults, PII sits in flat JSON files, there is no rate limiting or security-header middleware, and the app is one giant 5,100-line file that will get harder to reason about as it grows.

Nothing here suggests "lazy" code — the care in the Stripe layer is evidence of the opposite. The issues are the normal gaps of a tool that grew organically and now needs a security pass before scaling.

---

## What's done well

**Stripe handling is genuinely careful.** Idempotency keys are derived deterministically from payload contents (`createStripeIdempotencyKeyFromPayload` with a stable, key-sorted JSON serializer), so retries and double-clicks don't double-charge. The webhook endpoint verifies signatures with `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET` and uses `express.raw` correctly *before* the JSON body parser — a detail that's easy to get wrong. Retry wrappers (`...WithRetry`) wrap the flaky Stripe list calls. The single-use payment-link limiter was added deliberately to prevent duplicate payments.

**Session auth is real and reasonably built.** Cookies carry a base64url JSON payload plus an HMAC-SHA256 signature; verification uses `crypto.timingSafeEqual` (guarding against timing attacks) and checks an `expiresAt` field. Cookies are set `HttpOnly`, `SameSite=Lax`, and `Secure` when the request is HTTPS. Passwords are compared server-side. This is meaningfully better than most internal tools.

**Secret keys stay server-side.** The Stripe *secret* key never leaves the server; only the publishable key is exposed via `/api/config`, which is correct. No API keys are hardcoded in the committed source or the tracked HTML.

**Git hygiene on secrets is good.** `.env`, `links.json`, `terminal-payments.json`, and `service-cards.json` are all in `.gitignore`, and I confirmed `.env` and live Stripe keys never appear anywhere in git history. The data JSON files that *are* tracked contain only empty arrays.

**SQL is parameterized.** The Postgres commission layer uses `$1, $2…` placeholders throughout — no string-interpolated user input into queries. No SQL injection surface in the DB code.

**Executive-only actions are gated where it matters most.** The commissions endpoints use a `requireExecutiveApi` middleware, and the paid-date repair tool uses `requireRepairAccess`. So the pattern for per-endpoint authorization *exists* — it just isn't applied consistently (see below).

---

## Findings, by priority

### 1. HIGH — API endpoints enforce authentication but not authorization

The global middleware does two things: it rejects unauthenticated requests, and — only for `INTERNAL_PAGE_PATHS` (the `.html` files) — it checks `canAccessPathForUser`. For anything under `/api/`, it stops at "is this user logged in at all?" and calls `next()`.

The access-group model (`sales`, `service`, `accounting`, etc.) restricts which *pages* a role can open, but the APIs behind those pages have no matching guard. A `service` user who can only see the service pages can still directly call:

- `POST /api/card-on-file/charge` — charge a saved card
- `POST /api/terminal/charge` — charge via terminal
- `POST /api/intent-lookup/payment_intent/:id/refund` — issue refunds
- `GET /api/bank-balancing`, `/api/incoming-payouts`, `/api/paid-order-detail` — financial data
- `GET /api/hvac-deposits`, `/api/service-cards` — customer PII

with a single `curl` and a valid session cookie. The page-level restriction is cosmetic against anyone who opens dev tools or reads the JS.

This is the core issue to fix first. The fix is straightforward because the pattern already exists: introduce a `requireAccessToApi(group-or-page)` middleware mirroring `requireExecutiveApi`, and attach it to each sensitive route. As new endpoints are added, they should be authorization-gated by default rather than opt-in.

### 2. HIGH — Weak secret fallbacks let the app boot insecurely

Several security-critical values fall back to guessable defaults instead of failing loudly:

- `AUTH_COOKIE_SECRET` falls back to `` `${LEADER_USERNAME}:${LEADER_PASSWORD || "wilson"}` `` if `SESSION_SECRET` is unset. If the env var is ever missing in an environment, the cookie-signing key becomes trivially guessable, and anyone who guesses it can forge a valid admin session cookie.
- `LEADER_PASSWORD` defaults to `""` and `EXECUTIVE_USERNAME` to a real address. `findConfiguredUser` compares `String(password || "") === user.password` — if the password env var is empty, an empty-password login could match.

These should throw on startup when unset in production rather than silently degrading. A `.env` *is* present and populated here (46-char session secret, real passwords), so the running instance is likely fine — but the fallbacks are landmines for the next deploy or environment.

Also worth noting: the app username/password model is a small fixed set of shared logins, not per-user accounts. That's acceptable for a handful of employees but means no individual audit trail and no way to revoke one person without rotating a shared credential. Worth planning for as the team grows.

### 3. MEDIUM — PII stored in flat JSON files on disk

Customer data — names, emails, phones, addresses, gate codes, Stripe customer/payment-method IDs — lives in plaintext JSON files (`data/service-cards.json`, `deposit-agreements.json`, etc.) via the `data-json.js` layer. `extra data.txt` in the repo root contains a real-looking exported service record (name, email, phone, address, gate code) in plaintext and is *not* in `.gitignore` — it currently isn't committed, but nothing prevents it.

Concerns: no encryption at rest, concurrent writes can corrupt or lose data (read-modify-write with no locking — two simultaneous requests can clobber each other), and there's no backup story visible. The Postgres migration already underway (`data-postgres.js`, `STORAGE_MODE`) is the right direction; prioritize moving the PII-bearing collections, not just payment links. In the meantime, delete or gitignore `extra data.txt`.

### 4. MEDIUM — No rate limiting, no security headers

There's no `express-rate-limit`, `helmet`, or CSP anywhere. Consequences:

- The login endpoint can be brute-forced (shared passwords + no lockout + no throttle).
- Refund, charge, and lookup endpoints can be hammered.
- No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, or HSTS headers. Only `X-Robots-Tag` is set.

Adding `helmet()` and a rate limiter on `/api/login` and the money endpoints is low-effort, high-value hardening.

### 5. MEDIUM — Reflected XSS risk in dashboard rendering

Client pages build tables with `innerHTML` from server data using template literals — e.g. `intent-lookup.html` renders `${row.label}`/`${row.value}`, and several pages interpolate `${err.message}` straight into the DOM. Some pages define an `escapeHtml` helper but many `innerHTML` sites don't use it. Because much of this data originates from Stripe metadata and customer-submitted service requests (names, descriptions, problem text), a customer could plant `<script>`/`<img onerror>` payloads that execute in an employee's authenticated dashboard session. Route all customer/Stripe-derived strings through consistent HTML-escaping before interpolation, or build DOM nodes with `textContent`.

### 6. LOW — Open CORS

`app.use(cors())` with no options allows all origins. Because auth is cookie-based and the default `cors()` does *not* enable credentialed CORS, cross-origin sites can't read authenticated responses — so the practical impact is limited today. Still, it's broader than needed for a first-party tool; scope it to the known dashboard/service hosts.

### 7. LOW — Error messages leaked to clients

`err.message` is returned to the client in ~36 handlers. For an internal tool this is a reasonable trade for debuggability, but Stripe and Postgres error strings can expose internal identifiers and structure. Consider a generic client message plus server-side logging for the detail.

### 8. LOW — Maintainability: one 5,100-line server file

`server.js` holds routing, auth, business logic, Stripe orchestration, and HTML generation in a single module. It works, but every new capability makes it harder to review and raises the odds of a subtle regression. Splitting into route modules (payments, service, commissions, admin) with shared middleware would make the authorization fixes above easier to apply uniformly and keep future features from bloating one file.

### 9. NOTE — Prefill token endpoint

`/api/service/prefill/:token` is public and returns a customer's stored details keyed by a token. The token has solid entropy (`crypto.randomBytes(24)` = 192 bits), which is good, but tokens don't expire and aren't single-use — a leaked prefill URL exposes that customer's data indefinitely. Add an expiry and/or one-time consumption.

---

## Suggested order of operations

1. Add per-endpoint authorization middleware to every `/api/` route that moves money or returns PII (Finding 1). Make it the default for new routes.
2. Make `SESSION_SECRET` and passwords required at startup; remove insecure fallbacks (Finding 2).
3. Add `helmet` + rate limiting on login and payment endpoints (Finding 4).
4. Consistently HTML-escape customer/Stripe-derived data before `innerHTML` (Finding 5).
5. Continue the Postgres migration for PII collections; delete/gitignore `extra data.txt` (Finding 3).
6. Tighten CORS, sanitize client-facing errors, add prefill-token expiry (Findings 6, 7, 9).
7. As features grow, split `server.js` into route modules (Finding 8).

The good news is that the hardest parts to get right — Stripe correctness and real session auth — are already done well. The gaps are mostly about applying existing patterns (`requireExecutiveApi`) consistently and adding standard middleware, not rewriting anything.
