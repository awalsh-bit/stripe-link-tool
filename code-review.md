# Wilson AC & Appliance — Codebase Review

**Reviewer:** Claude (Cowork)
**Date:** 2026-05-28
**Scope:** Full repository at `stripe-link-tool/` — every HTML, JS, SQL, config, and lib module.
**Companion files:**
- `sql/002_proposed_schema.sql` — forward-looking Postgres schema (additive to `001_initial_schema.sql`).

---

## 0. TL;DR for a busy day

**Three things to do this week, in order:**

1. **Rotate the live Stripe secret key.** It was visible in chat. Stripe → Developers → API keys → "Roll key".
2. **Set `SESSION_SECRET` in your env.** Right now the cookie-signing HMAC key falls back to `LEADER_USERNAME:LEADER_PASSWORD`. Anyone who learns the password can forge any session cookie indefinitely. A 32+ byte random value fixes this in one line.
3. **Add role checks to the money-handling API routes.** `POST /api/create-payment-link`, `POST /api/terminal/charge`, `POST /api/card-on-file/charge`, `POST /api/intent-lookup/payment_intent/:id/refund`, and `PATCH /api/payment-links/:id/status` only require *any* logged-in user. The page-level access groups don't apply to API calls. A user with "service" access can today initiate refunds and charge saved cards.

**Three things to plan for the quarter:**

1. **Finish the Postgres migration on the schedule already in `postgres-schema.md`**, and apply `sql/002_proposed_schema.sql` as Phase 2 to introduce a canonical `customers` table and a `users` table that replaces the two-user env-based auth.
2. **Extract a shared front-end shell.** The same CSS variable block, `escapeHtml` helper, formatter helpers, and dashboard scaffold are inlined into 19 HTML files. Pull them into `internal-shell.js` / a new `wilson-app.js` to cut roughly 30–40% off the HTML repo size and eliminate XSS-by-omission risks.
3. **Split `server.js` (3,911 lines) into route modules.** It's the single biggest source of merge friction and the second-biggest source of bugs (the largest is the JSON files, which Postgres fixes). Suggested split is below.

---

## 1. Project structure at a glance

```
stripe-link-tool/
├── server.js                     119 KB / 3,911 lines — every Express route lives here
├── lib/
│   ├── data.js                   thin storage dispatcher (json vs. postgres)
│   ├── data-json.js              json fallback (links, terminal, service cards, events, rsvps)
│   ├── data-postgres.js          postgres backend for payment_links only
│   ├── commissions-postgres.js   1,227 lines — commissions module (good shape)
│   └── stripe.js                 stripe client + helpers (lookup, retries, recovery)
├── scripts/
│   ├── apply-postgres-schema.js
│   └── migrate-links-json-to-postgres.js
├── sql/
│   └── 001_initial_schema.sql    payment_links, card_on_file_charges, service_requests
│                                 (+ archive), events, event_rsvps, commission_*
├── data/                          (empty — populated at runtime)
├── 19 HTML pages                  ~250 KB total, each redeclares the same CSS vars
├── internal-shell.css / .js       shared header/footer for internal pages
├── public-shell.css / .js         shared header/footer for customer-facing pages
├── employee-directory.js          22-employee directory hard-coded in JS
├── postgres-schema.md             current schema design notes
└── .env                           STRIPE_SECRET_KEY (and only that)
```

**Two surface areas:**
- **Customer-facing** (`applianceservice.html`, `fireflavor.html`, `terms.html`): served on `service.wilsonappliance.com`. Uses `public-shell.*`.
- **Internal** (everything else): served on `dashboards.wilsonappliance.com` behind a login cookie. Uses `internal-shell.*`.

The split is enforced in `server.js:434-499` by host-based redirects + an auth middleware.

**Notable artifacts that should probably go away:**
- `subscribe.html` — 0 bytes.
- `extra data.txt` — 4 KB of scratch text in the project root.
- `logo-black.base64.txt` — 19 KB base64 of the logo nothing references in code.
- `fireflavor-hero.png` and `fireflavor-what-to-expect.png` — 2.5 MB and 1.8 MB respectively. Compress to WebP or move to a CDN; they're served from your Node process today.
- `tmp_apr_2026_zip/` — leftover migration scratch directory.
- `links.json` listed in `.gitignore` but also referenced as a checked-in file by the README — confirm intent.

---

## 2. Security findings

Severity scale: 🔴 critical (act this week), 🟠 high (act this month), 🟡 medium (act this quarter), 🟢 low / hygiene.

### 🔴 S1. Live Stripe secret key disclosed in chat
The `.env` value was placed into this conversation, which Anthropic retains as a transcript. Stripe treats any disclosed secret key as compromised regardless of medium. **Rotate today.** The good news: I confirmed via `git log --all -- .env` that `.env` was never committed to git history (your `.gitignore` caught it), so the only required action is the rotation.

### 🔴 S2. Auth cookie HMAC key defaults to the login password
`server.js:62-64`:
```js
const AUTH_COOKIE_SECRET =
  process.env.SESSION_SECRET ||
  `${LEADER_USERNAME}:${LEADER_PASSWORD || "wilson"}`;
```
If `SESSION_SECRET` is unset (it likely is, since only `STRIPE_SECRET_KEY` shows up in `.env`), the HMAC key is the username:password pair. Implications:
- Anyone who learns the leader password can mint a cookie for *any* claimed user including `executive`, indefinitely.
- Rotating the password silently invalidates every session.
- The literal default `wilson:wilson` is a known-string fallback that's worse than a random default.

**Fix:** add `SESSION_SECRET=…` to `.env` with 32+ random bytes (`openssl rand -hex 32`). Remove the password-based fallback entirely.

### 🔴 S3. API routes only require "any authenticated user"
The middleware at `server.js:453-499` enforces *login*, but the per-page access groups (`ACCESS_GROUPS` at line 130) are only checked when the request is for an internal **HTML page**. None of the JSON APIs check the role except the commissions ones, which use `requireExecutiveApi`. That leaves these endpoints reachable by any signed-in user — including the limited-access "service" group, in principle:

| Route | What an unauthorized user could do |
|---|---|
| `POST /api/create-payment-link` | Create new Stripe payment links charged to any sales order. |
| `POST /api/terminal/charge` | Push a charge to any of your Stripe Terminal readers. |
| `POST /api/card-on-file/charge` | Charge any saved card you have on file. |
| `POST /api/hvac-deposits/:id/manage` | Cancel or adjust HVAC deposit balances. |
| `POST /api/service-cards/:id/status` | Mark service calls scheduled / cancelled. |
| `POST /api/service-cards/:id/prefill-link` | Mint a prefill token. |
| `PATCH /api/payment-links/:id/status` | Activate/deactivate payment links in Stripe. |
| `POST /api/intent-lookup/payment_intent/:id/refund` | Refund a Stripe charge. |
| `POST /api/events/:slug/status` | Archive or unarchive any event. |

Today this is partially mitigated by the fact that you only have two configured users (the "leader" and the "executive"), both of whom are trusted. The moment you stand up "sales" and "service" group users (which your `ACCESS_GROUPS` config implies is the plan), this becomes a real privilege-escalation surface.

**Fix:** Wrap each route in a `requireAccessGroup(...groups)` middleware that mirrors the page rules, plus an explicit `requireExecutiveApi` on the refund route. I'd treat the refund endpoint as executive-only regardless of other plans.

### 🔴 S4. Plaintext password comparison + no hashing
`server.js:184-189`:
```js
return getConfiguredUsers().find((user) =>
  user.normalizedUsername === normalizedUsername &&
  String(password || "") === user.password
) || null;
```
- Passwords are read from env vars as plaintext.
- `===` is not constant-time; small timing differences are exploitable over the network. Use `crypto.timingSafeEqual` over equal-length buffers.
- There is no password hashing. Move to bcrypt/argon2 when you migrate users to Postgres (the `users.password_hash` column in `sql/002_proposed_schema.sql` is sized for that).

### 🟠 S5. CORS is wide-open
`server.js:67`: `app.use(cors());` sends `Access-Control-Allow-Origin: *`. The cookie is HttpOnly so cross-origin reads of authenticated responses are still blocked, but:
- Combined with `SameSite=Lax` cookies, top-level navigations from any origin can issue `GET` requests with the cookie (Lax allows that). State-changing endpoints that accept `GET` aren't a concern here because everything mutating is POST/PATCH/DELETE, but it's still worth tightening.
- Locks you out of using any future custom request headers (e.g. CSRF token).

**Fix:** Allowlist your two domains:
```js
app.use(cors({
  origin: [`https://${DASHBOARD_HOST}`, `https://${SERVICE_PUBLIC_HOST}`],
  credentials: true,
}));
```

### 🟠 S6. No rate limiting on login
`POST /api/login` accepts unlimited attempts. With only two configured users and 12-hour sessions, brute force against the leader password is a real worry once anyone learns the username. Add `express-rate-limit` (~5 attempts per 15 minutes per IP) or an equivalent. Combine with the audit log table proposed in `002_proposed_schema.sql` to alert on bursts.

### 🟠 S7. No CSP / HSTS / X-Frame-Options / X-Content-Type-Options
The only header set is `X-Robots-Tag: noindex,nofollow,noarchive` (`server.js:429-432`). Add `helmet()` with a tuned CSP. Customer-facing pages can serve a strict CSP that allows only `'self'`, Stripe JS, and inline styles (which you currently use heavily, so be ready to refactor or add `'unsafe-inline'` for styles only).

### 🟠 S8. Service-request prefill token never expires + linear scan
`server.js:3485-3559`: `POST /api/service-cards/:id/prefill-link` mints `crypto.randomBytes(24).toString("hex")` and stores it in the JSON service-card row. `/api/service/prefill/:token` then does `serviceCards.find((card) => card.secureCardPrefillToken === token)` to look it up.

Issues:
- No expiration.
- No single-use marker; the token works forever until the row is archived.
- O(n) scan per lookup.
- Token appears in the URL, which means browser history + HTTP `Referer` leakage to anything the page navigates to.
- 24 bytes is fine, but storing the raw token in the DB means a DB read leaks usable tokens. Hash on write, compare hash on read.

**Fix:** add `secure_card_prefill_token_hash` + `secure_card_prefill_token_expires_at` columns (already in `002_proposed_schema.sql`), hash the token with SHA-256 before storing, set a 7-day expiry, and consume the row on first successful use.

### 🟠 S9. Unescaped customer data in dashboard tables
`dashboard.html:1259-1283` injects `${row.customerName}`, `${row.creatorName}`, `${formatReference(row)}` directly into innerHTML without going through the local `escapeHtml` helper. The helper exists (`dashboard.html:1075-1083`) and is used elsewhere on the same page (e.g. line 1264 for `deactivationReason`). It's just inconsistent.

Customer names and Stripe metadata can contain `<` characters and are sourced externally. Even though this is an internal page, a malicious customer could inject `<script>` into their own name and have it execute when staff open the dashboard. The repo has **75 `innerHTML =` template-literal interpolations** across `*.html`; only 5 files even define `escapeHtml`. This is a class of bugs worth fixing globally by:
1. moving `escapeHtml` into the shared `internal-shell.js`,
2. lint-or-grep-banning template-literal `innerHTML` in favor of a small `el()` helper that takes `textContent`.

### 🟠 S10. `app.set("trust proxy", true)` is unbounded
Setting `trust proxy` to `true` trusts the entire X-Forwarded-For chain, which means a client can forge `req.ip` by sending their own `X-Forwarded-For`. This rarely matters today because you don't use `req.ip` for anything, but if you add rate limiting (S6) the limiter will key on a spoofable IP. Use a numeric hop count (e.g. `1` if you're behind a single proxy like Render/Cloudflare) or an explicit proxy IP list.

### 🟡 S11. 12-hour session TTL with no server-side revocation
`AUTH_COOKIE_TTL_SECONDS = 60 * 60 * 12` and the cookie is a self-contained HMAC token. Logout deletes the cookie client-side but does not invalidate the token. A laptop left open with a copied cookie is good for ~12 hours.

**Fix:** the `user_sessions` table in `002_proposed_schema.sql` lets you check a `revoked_at`/`expires_at` on every request and lets an admin nuke other sessions.

### 🟡 S12. `.env` lives under OneDrive
`stripe-link-tool/` is inside `C:\Users\awalsh.WILSON\OneDrive - Wilson Appliance\…`. If OneDrive sync is on, every `.env` write replicates the live Stripe key to OneDrive's cloud copy and to every other machine signed into that account. Either move the project out of OneDrive or exclude the folder from OneDrive sync (`Files On-Demand → Always free up space`, or right-click → *Free up space*; the more durable fix is **OneDrive settings → Choose what to sync → exclude this folder**).

### 🟡 S13. `express.json({ limit: "10mb" })`
10 MB JSON bodies are needed for commissions imports but mean every endpoint is exposed to a 10 MB DoS surface. Consider switching to a per-route limit: `express.json({ limit: "100kb" })` globally, plus a `express.json({ limit: "10mb" })` only on `/api/commissions/import`.

### 🟢 S14. Webhook handler stores raw events nowhere
`POST /api/stripe/webhook` validates the signature and dispatches, but doesn't record the raw event or enforce idempotency. Stripe will retry on a non-2xx; if processing partially succeeds and you return non-2xx, you'll re-process. The `stripe_webhook_events` table in `002_proposed_schema.sql` gives you a unique-on-`stripe_event_id` log that doubles as an idempotency guard.

### 🟢 S15. Default username pre-filled in login form
`login.html:164`: the `username` input has `value="wilson"`. Cosmetic, but reveals one of two valid usernames before the user has authenticated.

### 🟢 S16. `data-postgres.js:getSslConfig`
Falls back to `false` for any non-render.com URL not explicitly marked `require`. If you ever host on Supabase/Neon/RDS, that's a quiet downgrade. Recommend defaulting to `{ rejectUnauthorized: true }` and requiring an explicit opt-out for self-signed local-pg dev.

---

## 3. Redundancy hotlist (where to deduplicate first)

Ranked by payoff.

### R1. Inline CSS variable block in every HTML file
The exact same `:root { --bg: #f7f8fc; --card: #ffffff; --text: #1f2937; --border: #dbe1ea; --primary: #635bff; … }` block appears in **19 of 19** HTML files. There are 94 individual variable redeclarations across the repo.

Move them into `internal-shell.css` (and a small `public-shell.css` mirror) and delete from each page. Estimated win: ~600 lines and "the eyebrow color is one hex off on this one page" bugs become impossible.

### R2. Inline `escapeHtml`, `formatMoney`, `formatDate`, `toLocalDateInputValue` helpers
Defined in `dashboard.html`, `appliance-service-calls.html`, `archive-service-calls.html`, `link-detail-lookup.html`, `event-rsvps.html`, `bank-balancing.html`, `intent-lookup.html`, `paid-order-detail.html`, `commissions.html`, and others — usually with subtle differences. Extract to a `wilson-utils.js` loaded alongside `internal-shell.js`. Doing so will incidentally fix the unescaped customer name bug from S9.

### R3. Server-side service-request mutation is duplicated three times
`server.js:1491-1599` constructs the same big service-request object three times (update by setup intent → update by ID → insert new). The shape of the object is identical. Factor into a `buildServiceRequestRecord(existing, payload)` helper and let the three call sites differ only in the find-or-create step.

### R4. HVAC deposit state is spread across three places
- `payment_links` row, fields `balanceAmount` / `balanceChargedAt` / `balanceCanceledAt` / `balancePaymentIntentId` / `balanceOriginalAmount` / `balanceUpdatedAt`.
- Mutated by `POST /api/card-on-file/charge` when `hvacDepositRecordId` is present (`server.js:1700-1712`).
- Mutated again by `POST /api/hvac-deposits/:id/manage` (`server.js:1901-1973`).

Pull the "advance HVAC deposit state" logic into `lib/hvac-deposits.js` so both call sites use the same `markHvacBalanceCharged(linkId, paymentIntent)` and `updateHvacBalanceAmount(linkId, amount)` functions. The current shape is correct but fragile — any new HVAC code path has to remember six fields.

### R5. The `normalizeLinkRecordForStorage` function lives twice
- `lib/data-postgres.js:108-147` (used when writing).
- `server.js:3620-3668` as `normalizeLinkRecord` (used everywhere else).

The two implementations agree today but they're 80% the same logic in two files. Promote one to `lib/payment-links.js` and import it in both.

### R6. Hard-coded employee directory in `employee-directory.js`
22 employees + their emails + their departments live in a checked-in JS file that the frontend reads via a global. Two consequences:
- Every employee change is a code deploy.
- The list is delivered to anyone who can load any internal page, in plaintext (it's already inside the auth wall, but still — exposed to a future XSS).

The `employees` + `departments` tables in `sql/002_proposed_schema.sql` let you replace this with `GET /api/employees`.

### R7. Per-page dashboard scaffold
`dashboard.html`, `salesdashboard.html`, `hvac-dashboard.html`, `event-rsvps.html`, `appliance-service-calls.html`, `archive-service-calls.html`, `paid-order-detail.html`, `bank-balancing.html`, `link-detail-lookup.html`, `intent-lookup.html` all implement the same pattern: filter bar at top → table body → fetch JSON → render rows. They each duplicate:
- the search/filter input wiring,
- `setInterval(refresh, 60000)`,
- `attachCopyActions`,
- `escapeHtml`,
- date formatting.

A small `WilsonTable.mount({ endpoint, columns, filters, refreshMs })` helper would let each page be ~50 lines instead of 800–1400.

### R8. `subscribe.html` is empty, `extra data.txt` is scratch
Delete both. They get served by the static handler today and add noise to grep.

### R9. The `ALTER TABLE … ADD COLUMN IF NOT EXISTS discounts_amount` inside the schema string
`lib/commissions-postgres.js:112-113` has an `ALTER` that runs every boot. Harmless but leaves a tell that the schema was patched out of band. Fold the column into the `CREATE TABLE` and delete the `ALTER`.

### R10. `tmp_apr_2026_zip/`
Looks like a one-time migration scratch directory. Move out of repo or delete.

---

## 4. Postgres recommendations

You said "slightly overbuilt for ambitions" and listed: employee portal, external form tool, event RSVP, customer rewards/balance, plus today's payments + repair leads. I took that brief literally and produced `sql/002_proposed_schema.sql`. The high-level shape:

| # | Module | Tables | Purpose |
|---|---|---|---|
| 1 | Auth/identity | `users`, `user_roles`, `user_sessions`, `user_password_tokens` | Replaces env-based auth. Server-side revocable sessions. |
| 2 | Employees | `departments`, `employees` | Replaces `employee-directory.js`. Linked to `users`. |
| 3 | Customers | `customers`, `customer_payment_methods` | **Keystone table.** Today no customer record exists; PII is denormalized across 5 tables. |
| 4 | Rewards | `customer_balance_entries` | Append-only ledger. Models the "customer balance page" you mentioned without committing to a UI shape. |
| 5 | Payments | `payment_refunds`, `stripe_webhook_events` + columns on `payment_links`, `card_on_file_charges` | Local mirror of refunds, idempotency log for webhooks, customer FK on payments. |
| 6 | Service | `service_request_notes`, `service_request_media`, `service_appointments` + columns on `service_requests` | Builds out the repair-lead workflow. |
| 7 | Events | (extends 001 `events` + `event_rsvps`) | Capacity, hero image, optional form-based RSVP. |
| 8 | Forms | `forms`, `form_submissions` | The "external form tool" — JSONB schema + submissions. New forms without new tables. |
| 9 | Notifications | `notification_messages` | Replace the inline Resend call with a queryable, retryable outbox. |
| 10 | Audit | `audit_log` | One BIGSERIAL log of every state-changing action. |
| 11 | Config | `app_settings` | Database-driven feature flags. |
| 12 | Plumbing | `set_updated_at()` trigger function | One trigger function, applied to every `updated_at` table. |
| 13 | RLS | Commented-out `ENABLE ROW LEVEL SECURITY` lines | Forward-looking: enable later for per-department scoping. |

### Specific notes on the existing schema in `001_initial_schema.sql`

The current `001_initial_schema.sql` is solid for what it covers. Three small things worth doing during the Phase-2 migration:

1. **`payment_links` has both `status` and `active`**, which your own design notes flag (`postgres-schema.md:138-152`). Pick `status` as canonical. `active` becomes a generated column: `active BOOLEAN GENERATED ALWAYS AS (status <> 'deactivated') STORED`. (Requires a separate migration since you can't change an existing column to GENERATED in place — drop then re-add.)
2. **`service_requests_archive` duplicates the parent schema via `LIKE … INCLUDING …`** and is kept in sync by hand. Long-term, prefer one `service_requests` table with `archived_at TIMESTAMPTZ` and a partial index `WHERE archived_at IS NULL` for the hot path. The dual-table layout will quietly drift every time you `ALTER TABLE service_requests` and forget the archive twin.
3. **`event_rsvps.attendee_type` CHECK constraint hard-codes the five current attendee types.** When Fire & Flavor gets a second event with different categories, that constraint becomes an obstacle. Either make it `TEXT` with an application-side allowlist, or move to an `event_attendee_types` reference table keyed by `event_slug`.

### Migration order — what I'd actually do

Combine the order from `postgres-schema.md` with the new tables:

**Phase 1 (already done).** `payment_links` in Postgres behind `STORAGE_MODE=postgres`. ✅

**Phase 2 (next 2–4 weeks).** Apply `sql/002_proposed_schema.sql`:
- Stand up `users` and migrate the two env-based logins to bcrypt-hashed rows. Add `SESSION_SECRET` and rewrite cookie minting against `user_sessions`.
- Stand up `customers` + the FK columns on `payment_links`, `card_on_file_charges`, `service_requests`.
- Backfill `customer_uuid` on existing rows from email/phone dedupe.
- Wire `stripe_webhook_events` into `processCheckoutSessionWebhookEvent`.

**Phase 3.** Move `card_on_file_charges` and `service_requests` writes to Postgres (today they're still JSON in `lib/data-json.js`). The data-dispatcher in `lib/data.js` already handles `payment_links` this way — clone the pattern.

**Phase 4.** Replace `employee-directory.js` with `employees` + `GET /api/employees` and have `internal-shell.js` fetch it on load.

**Phase 5.** Build out the `forms` module to host new public forms beyond Fire & Flavor. Migrate `event_rsvps` to a `form_submissions` shape, or keep them separate — both are defensible.

**Phase 6 (when you're ready for rewards).** Turn on `customer_balance_entries`, build the customer-facing balance page, gate it on `app_settings.feature.rewards_enabled`.

### Why I added an audit log even though you didn't ask
Anything that touches money or PII benefits from a "who changed this, when, and what did it used to be" trail. `audit_log` is one table, ~50 lines of helper code (`logAudit(actor, action, entity, before, after)`), and pays for itself the first time someone needs to answer "why did this payment link get deactivated last Tuesday?". Today the answer lives in nobody's head.

---

## 5. Server.js refactor proposal (not urgent, but plan for it)

When you next have a half-day for cleanup, split `server.js` into route modules under `routes/`. Suggested division (route counts come from the grep run on `app.(get|post|put|delete)`):

| File | Routes | Lines today |
|---|---|---|
| `routes/auth.js` | login, logout, session, middleware | 200 |
| `routes/payment-links.js` | create-payment-link, payment-link-status, payment-links/:id/status, link-detail-lookup | 500 |
| `routes/terminal.js` | terminal/readers, terminal/charge, terminal/payment-status | 200 |
| `routes/service.js` | service/setup-intent, setup-intent-result, submit-request, service-cards, prefill-link, prefill/:token, hvac-deposits | 900 |
| `routes/accounting.js` | paid-order-detail, bank-balancing, intent-lookup, refund | 1000 |
| `routes/events.js` | events catalog, RSVP, event status | 300 |
| `routes/commissions.js` | all `/api/commissions/*` routes | 200 |
| `routes/webhooks.js` | stripe webhook + event processing | 300 |
| `lib/auth.js` | cookie sign/verify, access groups | 200 |
| `lib/notify.js` | sendPaymentLinkPaidEmail + future templates | 100 |
| `server.js` | app setup, middleware wiring, listen | ~100 |

Each `routes/*.js` exports a `router` factory. `server.js` becomes essentially `app.use("/api/...", router)` calls.

---

## 6. Quick wins (10–30 minutes each)

- Delete `subscribe.html`, `extra data.txt`, `tmp_apr_2026_zip/`, `logo-black.base64.txt`.
- Add `SESSION_SECRET` to `.env` and remove the password-based fallback in `server.js:62-64`.
- Add `helmet()` middleware.
- Lock down `cors()` to your two domains.
- Replace `===` password compare with `crypto.timingSafeEqual` over equal-length buffers.
- Remove `value="wilson"` from `login.html:164`.
- Compress `fireflavor-hero.png` (2.5 MB → ~150 KB with WebP/quality 80).
- Add an `engines` field and `start` script to `package.json` — it currently lacks both.

---

## 7. Things I didn't review (because they don't exist yet)

You mentioned future plans for an employee portal, customer rewards/balance page, and an external form tool. The proposed schema in `sql/002_proposed_schema.sql` reserves seams for all three, but no application code exists for them yet, so there was nothing to review. When those features start landing, the schema should be enough to keep storage decisions out of the critical path.

---

*End of review.*
