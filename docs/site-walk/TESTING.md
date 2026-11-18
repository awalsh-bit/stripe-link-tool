# Testing

Three layers. The first runs in the repo with nothing extra. The other two need Playwright.

## 1. The module's own tests (`node --test`)

```
node --test lib/tests/
```

24 tests in two files, Node's built-in runner, no dependencies.

- `site-walk-rules.test.js` — the rules with no database: reading a payload, newest-wins, the sign-off gate, the notifications feed, the row shapes the pages read, a spec library row.
- `site-walk-postgres.test.js` — the data module against a real Postgres, including archive, the summary-only list and the shared spec library. **Skips, without failing, when `DATABASE_URL` is not set.** Writes only walks whose id starts with `walk_test_` and library rows whose key starts with `WALKTEST`, and deletes them afterwards.

The fixture `lib/tests/fixtures/example-walk-payload.json` is a real payload from the phone for an example job.

## 2. The stand-in server

`stand-in/` is a small Express app with a login, `requirePagePermission`, `recordAudit` and `getPostgresPool`, built from the platform notes. It is how the drop-in was run without the repo, and it is the quickest way to click through everything locally.

```
npm install                                  # express, pg (stand-in only)
createdb agility_standin
DATABASE_URL=postgres://localhost/agility_standin node stand-in/server.js
# http://127.0.0.1:8750  — sign in as Pat Manager, Sam Sales or Olive Office, passcode walk1949
```

It copies `drop-in/` beside a stand-in `lib/data-postgres.js` and serves it the way the repo would. It is not meant for the repo.

## 3. Acceptance tests (a real browser, any server)

```
npm install -D playwright && npx playwright install chromium

node acceptance/run.mjs                                   # against the stand-in
SW_COOKIE="name=value" node acceptance/run.mjs https://<staging>     # against a staging Agility
```

For staging, sign in with a normal browser, copy the session cookie, and pass it as `SW_COOKIE` (several cookies: `a=1; b=2`). Every browser the tests open is then already signed in. See `acceptance/harness.cjs`.

**Run them all, in order, against a server whose site-walk tables start empty** (`sw_walks`, `sw_walk_events`, `sw_photos`, `sw_spec_library`). The page suites were written to run one after another: the first builds a walk at the desk and later ones pick it up on the phone. `run.mjs` holds the order. They create and change walks, and they add and remove rows in the shared spec library, so point them at staging, never production.

What runs:

| Suite | What it proves |
|---|---|
| `verify-agility-journey` | The journey on an Agility-shaped server: login guard, launch by link, live refresh, offline and catch-up, sign-off gate, send, photos, the worker's scope, audit, the library route |
| `verify-handoff` | Desk to phone and back: the walk and its install sheets reach the phone and work with the server unreachable |
| `verify-field-pass` | The phone, opening by opening: measurements, the measurement labels on the drawings, connections on the drawing, ventilation, accepted misses |
| `verify-corrections` | Correction wording, owners, the packet's shape (punch list first, numbered, page references, nothing dropped), the email text, Wilson-only items |
| `verify-showroom` | The office import of a spec package, install types, cleats seeded, min and max |
| `verify-spec-edit` | Reopening an opening's spec at the desk |
| `verify-forms` | The per-appliance forms, cleats and panels, the design-guide entries |
| `verify-merges` | Merged refrigeration openings and their kits |
| `verify-markup` | Marking up photographs |
| `verify-tranche2` | Panels, flush installs, door swing |
| `verify-jobsite` | Access and the before-delivery questions |
| `verify-ticket-panel` | The ePASS ticket panel at the desk |
| `verify-basis-auto` | Install type read from the sheet; flush inset barred for stainless models |
| `verify-sheet-mismatch` | The phone says when the attached sheet draws a different install |
| `verify-cleanup` | The phone's pick-up list, Not started, room, and the measure step |
| `verify-prelive` | Who is named as verifier, a second import of the same job, opening a walk from a summary, letting go of walks the server holds, archive and restore |
| `verify-library-shared` | The shared spec library across two desks: a correction, a revert, confirmed numbers, a change made offline, and a spec book added to the library with no walk |

The suites in `acceptance/suites/` are the standalone tool's own browser suites, copied by `tools/build-acceptance.mjs`. That script changes four things and nothing else: where Playwright comes from, the browser binary, the default address, and three server addresses the suites name directly. The checks are untouched.

Left out, with the reason:

- `verify-library-import` tests `/api/specs/import`, the Python server's package reader. On Agility a package is read in the browser when a walk is built.
- `verify-sw-redirect` tests the Python server's sign-in redirects.
- `verify-real-package` needs a customer's spec package, which never ships.
- The Python suites test the Python reference server and parser.

## What it printed on the stand-in

Run on 17 Nov 2026 against the stand-in, on a clean database: Node 22.23, Postgres 16, Chromium via Playwright 1.63.0. (The platform notes say Agility runs Node 20; nothing here uses a newer feature, but it was not run on 20.)

```
ok   verify-agility-journey       47 passed   0 failed
ok   verify-handoff               37 passed   0 failed
ok   verify-field-pass            98 passed   0 failed
ok   verify-corrections           28 passed   0 failed
ok   verify-showroom             102 passed   0 failed
ok   verify-spec-edit              8 passed   0 failed
ok   verify-forms                 70 passed   0 failed
ok   verify-merges                37 passed   0 failed
ok   verify-markup                16 passed   0 failed
ok   verify-tranche2              19 passed   0 failed
ok   verify-jobsite               20 passed   0 failed
ok   verify-ticket-panel           8 passed   0 failed
ok   verify-basis-auto            36 passed   0 failed
ok   verify-sheet-mismatch         8 passed   0 failed
ok   verify-cleanup               27 passed   0 failed
ok   verify-prelive               23 passed   0 failed
ok   verify-library-shared        18 passed   0 failed

602 checks passed across 17 suites; nothing failed.
```

`node --test lib/tests/`: 24 tests, 24 passed, with the database tests running against a real Postgres.

The same scripts, as the standalone tool on its Python server, also pass their full regression (v0.9.85): the 16 page suites above plus the Python server's own.

One thing the shared library changes about these suites: numbers a suite confirms are now on the server for the next suite. `verify-showroom` and `verify-library-shared` therefore clear the confirmed numbers before they test a book "nobody has checked".

## The register checker

```
node tools/check-register.mjs
```

Verifies that every function and every test named in `docs/rules-register.json` exists, and rewrites `docs/RULES_REGISTER.md` from it. Run it after changing either.
