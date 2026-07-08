# Access Control

How per-user access works in the Wilson internal tools, after the move away from
shared logins and page-only gating.

## The model

Every person has an individual account in Postgres (`app_users`). An account by
itself grants **nothing**: each internal page must be individually granted to
each user (`user_page_permissions`), from the executive-only **User Admin**
screen (`/user-admin.html`). Enforcement happens in two places:

1. **Page level** — requesting an internal `.html` page without a grant returns
   the "Access restricted" page.
2. **API level** — every sensitive `/api` route carries a
   `requirePagePermission(...)` middleware mapping it to the page(s) that
   legitimately use it. A user without the page grant gets `403` from the API
   too, even with a valid session cookie. Executive-only APIs (user management,
   commissions) additionally require `is_executive`.

Executives (`app_users.is_executive = true`) can reach every page, manage
users, and see the audit log. Whether someone is an executive is a top-level
flag, not a page permission.

Sessions are **server-side** (`sessions` table). The browser cookie holds only
an opaque random token; the server resolves it in Postgres on each request.
Sessions are deleted on logout, password change/reset, and deactivation — so
disabling a user revokes their access on their very next request.

## Registration and its safeguards

Anyone can self-register at `/register.html`. This is safe because of three
enforced safeguards:

1. **Domain restriction** — signup is limited to `@wilsonappliance.com`
   (configurable via `ALLOWED_SIGNUP_DOMAIN`). Anything else is rejected.
2. **Mandatory email verification** — the account cannot log in until the
   single-use verification link (72h expiry) delivered to that mailbox is
   clicked. Only someone who controls a real company mailbox can finish signup.
3. **Zero default access** — a verified account can see and call nothing until
   an executive grants pages in User Admin.

Emails are normalized on signup (lowercased, `+tag` sub-addressing stripped),
so `name+x@wilsonappliance.com` and `Name@wilsonappliance.com` are the same
account. Registration responds identically whether or not the email already
exists (no account enumeration).

Executives can alternatively pre-create accounts with **Invite** in User Admin,
which emails a single-use setup link (72h). Invites are also restricted to the
allowed domain.

> **Ops prerequisites** (confirm with whoever administers Wilson email):
> the domain must NOT be a catch-all (unknown addresses should bounce), and
> offboarded employees' mailboxes must be deactivated promptly — both keep
> email verification meaningful.

## Email lifecycle (Resend)

All auth email uses the existing Resend configuration (`RESEND_API_KEY`,
`RESEND_FROM_EMAIL`): verification on registration, invites, and self-service
password reset ("Forgot password?" on the login page; single-use link, 1h
expiry). Tokens are random 32-byte values stored only as SHA-256 hashes;
the raw token exists solely in the emailed link.

## Legacy shared login and break-glass

- `LEGACY_SHARED_LOGIN_ENABLED` (default `true`): while true, the env-based
  shared leader login (`APP_USERNAME`/`APP_PASSWORD`) keeps working exactly as
  before. Set it to `false` to fully deactivate the shared login; those users
  land on the new login screen, which offers Register / Forgot password.
- **Break-glass admin**: `EXECUTIVE_USERNAME` / `EXECUTIVE_PASSWORD` is the one
  documented env login that always works, even if the flag is off **and even if
  Postgres is down** (it falls back to a signed cookie in that case). When the
  DB is reachable, logging in with it materializes/repairs a real executive row
  in `app_users` — use it to bootstrap the first executive, then manage
  everything from User Admin. Never remove these env vars until at least one
  other executive account exists and has been tested.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Required for individual accounts (uses the existing `pg` pool). Without it only env logins work. |
| `ALLOWED_SIGNUP_DOMAIN` | `wilsonappliance.com` | Domain allowed to self-register / be invited. |
| `LEGACY_SHARED_LOGIN_ENABLED` | `true` | Feature flag for the shared leader login. |
| `SESSION_TTL_SECONDS` | `43200` (12h) | Server-side session lifetime. |
| `APP_USERNAME` / `APP_PASSWORD` | — | Legacy shared leader login (behind the flag). |
| `EXECUTIVE_USERNAME` / `EXECUTIVE_PASSWORD` | — | Break-glass executive login (always on). |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | — | Auth email delivery. |

## Granting / revoking access (day to day)

1. Open **User Admin** from the menu (executives only).
2. New teammate: either send an **Invite**, or have them self-register and
   verify; they then appear in the user table.
3. Click **Edit pages** and toggle the pages they need — or apply a preset
   (Sales, Accounting, Service, Leader) and adjust. Presets expand into
   individual per-user rows; the rows are the source of truth.
4. Toggling a page off immediately blocks both the page and its backing APIs.
5. **Disable** ends a user's sessions immediately (offboarding). **Send reset**
   emails them a password reset. The audit log at the bottom records logins,
   permission changes, invites, deactivations, and resets.

## Schema and code map

- Tables: `app_users`, `user_page_permissions`, `sessions`, `auth_tokens`,
  `access_audit_log` — created by `sql/003_user_access.sql` and automatically
  at boot by `ensureUserAccessTables()` (idempotent). See `postgres-schema.md`.
- `lib/users-postgres.js` — users, scrypt password hashing (per-user salt,
  `scrypt$N$r$p$salt$hash`, `timingSafeEqual` verification), hashed single-use
  tokens, sessions, permissions, audit log. Parameterized queries only;
  multi-step writes in transactions.
- `server.js` — auth middleware (DB session resolution + legacy cookie behind
  the flag), auth endpoints (`/api/auth/*`, `/api/login`, `/api/logout`),
  executive user-management API (`/api/admin/users*`, `/api/admin/audit-log`),
  and `requirePagePermission(...)` on every sensitive route. Auth endpoints are
  rate-limited per IP.
- Front-end: `login.html` (email+password, forgot password, verify handling),
  `register.html`, `set-password.html` (invite + reset), `user-admin.html`.
  The nav (`internal-shell.js`) hides pages the user can't reach.

## Testing

- `node scripts/test-user-access.js` — unit tests for hashing/normalization,
  plus full DB-backed lifecycle tests (registration → verify → sessions →
  permissions → disable → reset) when `DATABASE_URL` is set. Test rows are
  self-cleaning (`__accesstest_*`).
- Definition-of-done spot check: grant a page to a limited user, confirm the
  page and its API work with their cookie, toggle the page off in User Admin,
  and confirm both immediately return 403 (`curl -b "wilson_dashboard_session=<token>"`).
