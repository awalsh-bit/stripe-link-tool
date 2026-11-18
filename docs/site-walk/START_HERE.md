# Site walk for Agility — start here

Andrew: this folder is the pre-delivery site walk tool, ready to drop into `wilson-agility`. It is written against `12_Agility_Platform_Notes.md`. I did not have the repo, so the two places where it meets your code (`server.js` and `lib/data-postgres.js`) are tested against a stand-in built from those notes. Everything else is tested as it will run.

## The one thing to know

**Please do not port or rewrite anything.** The Python server in the standalone tool has already been ported; `lib/site-walk-postgres.js` is the port. The pages are the same scripts the standalone tool runs, moved under `site-walk-assets/`. If something here does not fit Agility, change the fit (the routes file, the settings file, the shell) and leave the rules alone. `docs/RULES_REGISTER.md` lists the rules and the test that proves each one.

## What is in the folder

| Folder | What it is | Goes into the repo? |
|---|---|---|
| `drop-in/` | Three pages, their assets, the offline worker, and `lib/` (data module, rules, routes, tests) | **Yes**, as it stands, at the repo root |
| `stand-in/` | A small Express + Postgres server that imitates the parts of Agility the drop-in touches | No. It is how this was tested without the repo |
| `acceptance/` | Browser tests that run against any server address, stand-in or staging | Your call; they need Playwright |
| `docs/` | This file, the registration lines, the journey, the walk record, the rules register, the open questions | Wherever you keep feature docs |
| `demo/` | The whole tool as one HTML file with example walks, for clicking through with no server | No |
| `tools/` | The scripts that built `drop-in/` and `acceptance/suites/` from the standalone tool, and the register checker | No |

## Putting it in

1. Copy the contents of `drop-in/` to the repo root. Nothing in it has the name of an existing Agility file: pages are `site-walk*.html`, assets are under `site-walk-assets/`, modules are `lib/site-walk-*.js`.
2. Add the routes and register the pages. The exact lines are in `AGILITY_REGISTRATION.md` (two lines for the routes, four small additions for the pages).
3. Deploy. The tables (`sw_walks`, `sw_walk_events`, `sw_photos`, `sw_spec_library`) are created on first use, like every other module.
4. Grant `/site-walk-office.html` to whoever should use it. The phone page and the packet page ride that grant.

## Checking it

```
node --test lib/tests/                                   # 24 tests; the database ones skip without DATABASE_URL
SW_COOKIE="<session cookie>" node acceptance/run.mjs https://<staging>     # browser tests against staging
```

`TESTING.md` has the details, including how to run the stand-in locally and what the acceptance run printed on it.

## What step one covers, and what it leaves

Step one is everything needed to walk jobs: build a walk at the desk from a Steel Cod spec package, open it on a phone from a link, watch it fill in, sign it off, send the packet. Each walk is one row with the walk stored whole as JSONB.

It also includes the shared spec library (added in v0.9.85, after the first handoff). What people correct or add in the library, and the opening numbers they confirm against a sheet, are rows in `sw_spec_library`, so a correction made at one desk is the library at every desk. A spec book can be added to the library with no walk. `SPEC_READING.md` says how a book is read and what is and is not done by code.

Left for step two, on purpose: the reporting tables (the 25-table projection in the standalone tool's `sql/sitewalk_schema.sql`), pushing notifications onto dashboards, and the ePASS ticket comparison (Phase A, already with you). `sw_walks.payload` already stores every derived value those need, so step two reads stored rows; no phone has to re-send anything.

## If you already looked at v0.9.84

This replaces it. Take `drop-in/` whole; do not merge by hand. What is different:

- One more table, `sw_spec_library`, and two more routes, `GET` and `POST /api/site-walk/library`. Both are inside `registerSiteWalkRoutes`, so the lines in `AGILITY_REGISTRATION.md` have not changed.
- `site-walk-assets/site-walk-agility.js` has one more address, `library`.
- The pages changed in three places: the drawings carry the measurements as labels (a miss in red) and the opening's own lines are never coloured; the builder packet opens with a one-page numbered punch list; the spec library is shared and takes a spec book with no walk. `site-walk-assets/` and `site-walk-sw.js` are replaced as a set.
- Tests: 24 module tests (was 22), 17 acceptance suites and 602 checks (was 16 and 571). The acceptance run now needs `sw_spec_library` empty as well.

## Read next

- `AGILITY_REGISTRATION.md` — the lines to add.
- `QUESTIONS_FOR_ANDREW.md` — eight decisions that are yours, each with a default already built so nothing is blocked, and a proposed order for step two.
- `JOURNEY.md` — what the people do, screen by screen.
- `WALK_RECORD.md` — the data.
- `RULES_REGISTER.md` — the rules that must survive, each with its function and its test.
- `SPEC_READING.md` — how a spec book is read today (no model, no tokens), and the options for making it more accurate.
