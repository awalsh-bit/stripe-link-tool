# Site walks in Agility: how it was put in (11/18)

Cayden's handoff v0.9.85, installed as he asked: `drop-in/` copied whole, nothing in it changed. These docs
(`START_HERE.md` onward) are his, copied from the handoff's `docs/`.

## What was added to Agility

| Where | What |
| --- | --- |
| repo root | `site-walk.html`, `site-walk-office.html`, `site-walk-report.html`, `site-walk-sw.js`, `site-walk.webmanifest`, `site-walk-assets/` (as delivered) |
| `lib/` | `site-walk-postgres.js`, `site-walk-routes.js`, `site-walk-rules.js`, `tests/` (as delivered) |
| `server.js` | `registerSiteWalkRoutes(app, { requirePagePermission, recordAudit })`, placed **just before the global `express.json` (10 MB)**, after sign-in, CORS and the host and path checks. A walk is posted whole and can pass 10 MB; the routes carry their own 32 MB parser. Every other route keeps 10 MB. |
| `server.js` | The three pages in `INTERNAL_PAGE_PATHS`, `PAGE_LABELS` ("Site Walks", "Site Walk — field", "Site Walk — builder packet"), the Test Modules category, and `PAGE_IMPLIED_BY` (field and packet ride the office grant). |
| `server.js` | `/site-walk-sw.js` is sent with `Cache-Control: no-cache` (handoff §3). |
| `server.js` | `GET /login` forwards to `/login.html`, keeping `?next=`. The site walk's settings file sends a signed-out phone to `/login?next=<the walk>`; this keeps that file as delivered. |
| `login.html` | Honours `?next=` (a path on this site only, never `/api/` or the sign-in page itself): after signing in you land back on the walk. |
| `internal-shell.js` | Menu: Project Management → **Site Walks**. |
| `.gitignore` | The handoff folder itself stays off GitHub. |
| `lib/` + `server.js` | Added later the same day: `site-walk-reporting.sql` and `site-walk-reporting.js`, Cayden's reporting tables and views as Postgres views over the stored walks, put in place 9 seconds after start. Not part of his drop-in. See `REPORTING.md`. |

## Who can use it

Grant **Site Walks** (`/site-walk-office.html`, under Test Modules in User Admin) to each person who builds,
walks or signs off. That one grant opens the phone page and the packet too. Executives need no grant.

## Checked before delivery (local copy of the real `server.js`, test database)

- Cayden's module tests: 24 of 24 against Agility's own `lib/data-postgres.js`. On Node 21 or newer run them as
  `node --test "lib/tests/*.test.js"` (a bare folder name no longer works there).
- Cayden's journey test with Agility's real sign-in: 46 checks, all passing (the 47th reads the stand-in's audit
  list; here the `site_walk.*` rows were checked in `access_audit_log` instead).
- His 16 page suites, signed in with a session cookie, in order on empty tables: 555 checks, all passing.
- Gates: granted person opens all three pages; a person without the grant gets 403 on the pages and the API;
  signed out gets the sign-in page and 401; `lib/` and the test fixtures are never served; a 12 MB walk reaches
  the walk route while every other route keeps the 10 MB limit.

Not checked here: a real phone on the https address (Cayden's dry run: open from the link, airplane mode,
measure, reconnect, sign off, print).
