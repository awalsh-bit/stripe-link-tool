# Fable 5 Execution Prompt — User Access Overhaul (Wilson Appliance internal tool)

> Paste everything below the line into Fable 5 in Cowork, working in the `wilson-agility` folder. It is written as direct instructions to the executing agent.

---

## Role and context

You are working in `wilson-agility`, the Wilson Appliance internal payments and operations tool: a single-process Express app (`server.js`, ~5,100 lines), a `lib/` layer (`data.js` → `data-json.js` / `data-postgres.js`, `stripe.js`, `commissions-postgres.js`), and static HTML dashboards served from the repo root. Auth today is a stateless HMAC-signed session cookie (`readAuthenticatedUser`, `signAuthPayload`), with two env-based shared logins (leader/executive) and a coarse `ACCESS_GROUPS` map that gates **pages only**. Postgres is already partly wired up (`data-postgres.js`, `STORAGE_MODE`, `DATABASE_URL`, `commissions-postgres.js` uses `pg` with parameterized queries).

Do not break any existing Stripe flow, webhook handling, idempotency logic, or the commissions/Postgres code. Reuse existing patterns (`requireExecutiveApi`, the `pg` pool in `data-postgres.js`, the Resend env vars `RESEND_API_KEY` / `RESEND_FROM_EMAIL`) rather than introducing new frameworks.

## Objective

Replace the shared-login + page-only access model with a real per-user access system stored in Postgres:

1. Individual user accounts via domain-restricted self-registration (email + user-chosen password). A verified account grants **nothing** until an executive assigns pages.
2. Per-user, per-page authorization — each internal page can be individually allowed or denied for each user — managed from an executive-only admin screen.
3. Enforcement at BOTH the page level and the API level (close the current gap where any logged-in user can call any `/api` endpoint).
4. Full email lifecycle via Resend: invite/verify on account setup, and self-service password reset.
5. Server-side (DB-backed) sessions so an admin can disable a user and immediately revoke their access.

## Decisions already made (do not re-litigate; adjust only if you find a hard blocker, and flag it if so)

- **Registration = domain-restricted self-registration.** Anyone with a valid `@wilsonappliance.com` email may register and set their own password. Registration is safe because of three enforced safeguards: (a) the email domain is restricted to `@wilsonappliance.com` (reject anything else at signup); (b) email verification is mandatory — the account cannot log in until the user clicks a verification link delivered to that mailbox, so only someone who controls a real Wilson mailbox can complete signup; (c) **a verified account grants zero access** — the user can see and call nothing until an executive assigns pages. Normalize emails on signup (lowercase, strip `+tag` sub-addressing) so one person cannot create duplicate accounts. Executives may still also pre-create/invite an account, but invite is optional, not the only path.
- **Fix API authorization too.** Every `/api` route that moves money or exposes PII must check the user's per-page/per-permission grant, not just authentication. Page permissions are meaningless without this.
- **Legacy shared login handling:** Keep the existing env-based `wilson` (leader) shared login working during build and testing, gated behind a feature flag (e.g. `LEGACY_SHARED_LOGIN_ENABLED`, default `true` for now). Build it so that flipping the flag off fully deactivates the shared login and redirects those users to the new individual login screen. On that screen, users without an account see a "Register" path (domain-restricted self-registration, described above). Retain one env-configured break-glass admin login, clearly documented, so you can never be locked out of the DB.
- **Full email flows:** email verification on account setup and self-service forgot-password reset, both sent via Resend using the existing env vars.

## Technical decisions (defaults chosen for you — implement these unless there's a concrete reason not to)

- **Password hashing:** Node's built-in `crypto.scrypt` (with a per-user random salt, stored as `scrypt$N$r$p$salt$hash` or similar), verified with `crypto.timingSafeEqual`. This avoids native build dependencies on Render. Never store or log plaintext passwords. Enforce a minimum password policy (length ≥ 12, not equal to email).
- **Sessions:** Move from stateless signed cookies to **server-side sessions stored in Postgres**. Cookie holds only an opaque random session token (`crypto.randomBytes(32).toString("base64url")`); the server looks it up in a `sessions` table on each request. Keep the cookie flags that already exist (`HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS). Sessions carry an expiry and are deleted on logout, on password change, and when a user is deactivated. Preserve `crypto.timingSafeEqual` for any token comparison.
- **Permission model:** per-user, per-page boolean grants in a join table. Keep the current `ACCESS_GROUPS` definitions only as optional **quick-assign templates** in the admin UI ("apply Sales preset"), which expand into individual page rows — the source of truth is the per-user rows, not the group.
- **Storage:** all new tables in Postgres via the existing `pg` pool. Use parameterized queries only (`$1, $2…`), matching `commissions-postgres.js`. Wrap multi-step writes in transactions.
- **Tokens** (invite, email-verify, password-reset): random 32-byte tokens, stored **hashed** in the DB (store `sha256(token)`, put the raw token only in the emailed link), single-use, with expiry (invite/verify 72h, reset 1h).

## Postgres schema (create via a new migration in `sql/` and an idempotent `ensure…Tables()` in a new `lib/users-postgres.js`)

- `app_users`: `id` (uuid/pk), `email` (unique, citext or lower-cased and `+tag`-stripped), `password_hash` (nullable until set), `display_name`, `status` (`pending_verification` | `active` | `disabled`; `invited` also allowed if an exec pre-creates), `is_executive` (bool — can manage users), `email_verified_at`, `created_at`, `updated_at`, `created_by`. A user may only log in when `status = active` AND `email_verified_at` is set.
- `user_page_permissions`: `user_id` (fk), `page_path` (e.g. `/dashboard.html`), `granted` (bool), `updated_at`, `updated_by`. Unique on (`user_id`, `page_path`).
- `sessions`: `id`, `user_id` (fk), `token_hash`, `created_at`, `expires_at`, `last_seen_at`, `ip`, `user_agent`.
- `auth_tokens`: `id`, `user_id`, `kind` (`invite` | `verify` | `reset`), `token_hash`, `expires_at`, `consumed_at`.
- `access_audit_log`: `id`, `actor_user_id`, `action`, `target_user_id`, `detail` (jsonb), `created_at` — record logins, permission changes, invites, deactivations, password resets.

Define the canonical list of manageable pages in one place (derive from the existing `INTERNAL_PAGE_PATHS`) so the admin UI and the enforcement middleware share the same source.

## Server changes

1. **New auth layer** (`lib/users-postgres.js` + wiring in `server.js`): create/find users, hash/verify passwords, issue/verify/consume tokens, create/lookup/destroy sessions, read a user's effective page permissions, write audit entries.
2. **Rewrite the global auth middleware** so it: resolves the session from the DB, attaches `req.authUser` (including `is_executive` and a permission lookup helper), redirects unauthenticated HTML requests to `/login.html`, and returns 401 JSON for unauthenticated `/api` requests — preserving the existing host-routing (dashboard vs service host) and the public path allow-lists (Stripe webhook, service public pages/APIs).
3. **Page enforcement:** for internal `.html` pages, check the per-user grant for that exact path; deny with the existing forbidden page if not granted.
4. **API enforcement (critical):** add a reusable middleware `requirePagePermission(pagePath)` (and/or `requirePermission(key)`) mirroring `requireExecutiveApi`. Attach it to every sensitive `/api` route, mapping each endpoint to the page(s) that legitimately use it. At minimum cover: `create-payment-link`, `terminal/*`, `card-on-file/charge`, `intent-lookup/*` (incl. refund), `hvac-deposits/*`, `service-cards/*`, `paid-order-detail`, `bank-balancing`, `incoming-payouts`, `deposit-agreements`, `link-detail-lookup*`, `payment-link-status`, and the admin repair routes. Executive-only routes (user management, commissions) require `is_executive`.
5. **Auth endpoints:** `POST /api/auth/register` (validate `@wilsonappliance.com` domain, normalize email, create `pending_verification` user, set password, send verification email — respond identically whether or not the email already exists, to avoid enumeration), `POST /api/auth/verify-email` (token → mark verified + activate), `POST /api/login` (email + password → session; rejects unverified/disabled users with a generic message), `POST /api/logout` (destroy session), `GET /api/auth/session` (current user + their granted pages, so the front-end nav can hide what they can't reach), `POST /api/auth/accept-invite` (token + new password, for the optional exec pre-create path), `POST /api/auth/request-reset`, `POST /api/auth/reset` (token + new password). Rate-limit register, login, request-reset, verify, and accept-invite.
6. **Executive user-management API** (all `is_executive`-gated): list users with their permissions; invite a user (create `invited` user + `invite` token + Resend email); resend invite; set/clear individual page permissions; apply a preset template; disable/enable a user (disabling deletes their sessions); trigger a password reset; view audit log.
7. **Legacy shared login:** keep the env leader login working only while `LEGACY_SHARED_LOGIN_ENABLED` is true; when false, `/api/login` rejects it and the login page shows the request-access path. Keep exactly one documented env break-glass executive.

## Front-end

- **`login.html`:** switch to email + password. Add "Forgot password?" and a "Register" link to the new self-registration page.
- **New `register.html`:** email + password (+ confirm) form. Client- and server-side enforce the `@wilsonappliance.com` domain and the password policy. On submit, show a "check your email to verify" confirmation rather than logging in. Make clear that access is granted by an administrator after verification.
- **New `set-password.html` / `accept-invite.html`:** consumes an invite or reset token from the URL and lets the user set a password (with the policy shown and confirmed). Used for the optional exec pre-create path and for password resets.
- **New `user-admin.html` (executive-only, add to `INTERNAL_PAGE_PATHS`):** table of users (email, name, status, last login), per-page permission toggles per user, preset quick-assign buttons, invite form, disable/enable, resend invite, force reset, and a read-only audit log view. Match the visual style of the existing dashboards (`internal-shell.css` / `.js`).
- Escape all user-supplied strings before inserting into the DOM (do not repeat the existing `innerHTML` XSS pattern — use `textContent` or a shared `escapeHtml`).

## Security requirements (non-negotiable)

- Parameterized SQL only; transactions for multi-write operations.
- Passwords hashed with per-user salt; never logged or returned.
- Tokens single-use, expiring, stored hashed; raw token only in the emailed link.
- Sessions revocable; deleted on logout, password change, and deactivation.
- Rate-limit auth endpoints; add `helmet`-style security headers if trivial to include.
- Do not weaken or bypass the existing Stripe webhook signature check or idempotency logic.
- Generic client-facing error messages for auth failures (no user-enumeration: same response whether or not an email exists on login and reset-request).

## Build in phases, verifying each before moving on

1. Schema + `lib/users-postgres.js` + migration; unit-test hashing, token, and session helpers.
2. Session-based auth middleware replacing the stateless cookie, with legacy shared login still working behind the flag; verify existing pages still load when logged in.
3. Self-registration + email verification via Resend (domain check, email normalization, zero-permission default), plus the optional exec pre-create/invite path; create the first real executive from the env break-glass, then register + verify a normal test account end-to-end.
4. Per-user page permission storage + page-level enforcement + `user-admin.html`.
5. API-level enforcement across all sensitive routes; verify a limited user is 403'd on both the page and its API.
6. Forgot-password / reset flow.
7. Prepare legacy-login deactivation (flag off) and confirm redirect-to-login behavior.

## Verification / definition of done

- A new user can self-register with a `@wilsonappliance.com` email, is blocked from logging in until they verify, and after verifying can log in but sees **no pages** until an executive grants them.
- Registration with a non-`@wilsonappliance.com` email is rejected, and `name+tag@wilsonappliance.com` collapses to the same account as `name@wilsonappliance.com`.
- Toggling a page off in `user-admin.html` immediately blocks both the page AND its backing API for that user (test with a direct `curl` using their cookie — this is the whole point).
- Disabling a user kills their active session on the next request.
- Forgot-password issues a working single-use, time-limited reset link.
- With `LEGACY_SHARED_LOGIN_ENABLED=false`, the shared `wilson` login is rejected and routed to the new login screen; with it `true`, existing access is unbroken.
- No plaintext passwords or raw tokens in the DB or logs; all new queries parameterized.
- Existing Stripe payments, refunds, webhooks, and commissions flows still work unchanged.
- Update `postgres-schema.md` and add a short `docs/ACCESS-CONTROL.md` describing the model, the registration + verification flow and its safeguards, the allowed email domain (make it an env var, e.g. `ALLOWED_SIGNUP_DOMAIN=wilsonappliance.com`), the env vars (`LEGACY_SHARED_LOGIN_ENABLED`, break-glass admin, Resend vars), and how to grant/disable users.

## Open items to confirm with the owner (Andrew) if they block you

- Exact page→permission mapping for shared APIs used by more than one page.
- Whether `is_executive` should itself be a managed permission or stay a top-level flag (default: top-level flag).
- Confirm with whoever administers Wilson's email that the domain is **not** a catch-all (unknown addresses should bounce), since a catch-all would weaken email verification. Also confirm offboarded employees' mailboxes are deactivated, so a former employee can't self-register.
- Session lifetime (default: 12h, matching the current `AUTH_COOKIE_TTL_SECONDS`).
