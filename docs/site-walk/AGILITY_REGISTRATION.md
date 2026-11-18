# The lines to add to Agility

Written from `12_Agility_Platform_Notes.md` §5. Names such as `INTERNAL_PAGE_PATHS` are taken from those notes; if the real ones differ, the intent of each line is stated beside it.

## 1. Routes (`server.js`)

```js
import { registerSiteWalkRoutes } from "./lib/site-walk-routes.js";

// next to the other feature blocks
registerSiteWalkRoutes(app, { requirePagePermission, recordAudit });
```

`registerSiteWalkRoutes` only calls `app.get` / `app.post`. If you would rather have the routes inline like the other features, its body pastes into `server.js` unchanged.

It expects, as the notes describe them:

- `requirePagePermission(pagePath)` returning Express middleware, and `req.authUser = { id, email, displayName }` after it.
- `recordAudit({ ip, actorUserId, action, targetUserId, detail })`. Actions are `site_walk.sync`, `site_walk.sign_off`, `site_walk.reopen`, `site_walk.sent`, `site_walk.archive`, `site_walk.restore`.
- `lib/data-postgres.js` exporting `getPostgresPool()`.

**Body size.** A walk arrives whole, typically 0.3–1.2 MB. The routes carry their own body parsers (33 MB for a walk, 8 MB for a photo), but a global `app.use(express.json())` that runs first will already have refused anything over its own limit (Express's default is 100 kb). Either mount this block before the global parser or raise the global limit for `/api/site-walk/sync`.

### The routes

All under one grant, `/site-walk-office.html`.

| Route | What it does |
|---|---|
| `GET /api/site-walk/session` | Who is signed in. The pages use it to name the walker and the person signing off |
| `GET /api/site-walk/walks` | The queue: every walk that is not archived, summary only. `?archived=1` lists the archived ones |
| `GET /api/site-walk/walks/:id` | One walk: summary, document, history |
| `GET /api/site-walk/pull` | Walks a device may open (not sent, not archived), as summaries with no document. `?client=<id>` returns that one walk with its document, whatever its state |
| `POST /api/site-walk/sync` | One walk from a browser, whole. Newest revision wins. `400` means never retry |
| `POST /api/site-walk/walks/:id/sign-off` | The walker's sign-off, recorded under the login. `409` when the walk is not finished |
| `POST /api/site-walk/walks/:id/reopen` | Takes a sign-off back. Refused once sent |
| `POST /api/site-walk/walks/:id/archive` | Takes the walk out of the queue and off the phones' list. Nothing is deleted |
| `POST /api/site-walk/walks/:id/restore` | Puts an archived walk back |
| `POST /api/site-walk/walks/:id/sent` | Records that the packet went to the builder. `409` before sign-off. Sends nothing itself |
| `GET /api/site-walk/library` | The shared spec library: every row people changed or added, removals included as markers |
| `POST /api/site-walk/library` | One row: `{ kind: "model" or "dims", key, doc }`, or `{ kind, key, deleted: true }`. Newest write wins. `400` when the row is malformed |
| `GET /api/site-walk/notifications` | What the walks have to say to people, derived on every call. `?email=`, `?since=` |
| `POST /api/site-walk/photos` | One photograph, raw body, identity in `X-Photo-Id` / `X-Visit-Id` headers |
| `GET /api/site-walk/photos?visit=<walk id>` | Which photographs the server holds |
| `GET /api/site-walk/photo/:walkId/:photoId.jpg` | The bytes |

To move a route, change it in `lib/site-walk-routes.js` and in `site-walk-assets/site-walk-agility.js`. No other file names a server address.

## 2. Pages

```js
INTERNAL_PAGE_PATHS   += "/site-walk-office.html", "/site-walk.html", "/site-walk-report.html"

PAGE_LABELS["/site-walk-office.html"] = "Site Walks"
PAGE_LABELS["/site-walk.html"]        = "Site Walk — field"
PAGE_LABELS["/site-walk-report.html"] = "Site Walk — builder packet"

PAGE_CATEGORIES["/site-walk-office.html"] = "test_modules"     // until it leaves testing

PAGE_IMPLIED_BY["/site-walk.html"]        = "/site-walk-office.html"
PAGE_IMPLIED_BY["/site-walk-report.html"] = "/site-walk-office.html"
```

One menu entry is enough (`/site-walk-office.html`); the other two pages are reached from it.

## 3. Static files

These must be served from the root, the way the repo's other static files are:

- `/site-walk-assets/**` — scripts, styles, icons, the PDF reader. No login needed for these; they hold no data.
- `/site-walk-sw.js` — the offline worker. Serve it with `Cache-Control: no-cache` so a new deploy is picked up.
- `/site-walk.webmanifest`

## 4. The offline worker

`site-walk-sw.js` is what lets the phone keep working in a house with no signal. It is built to be a quiet neighbour:

- registered with scope `/site-walk`, so it controls only the three pages and their assets;
- it answers only for the files in its own list, and passes every other request through untouched;
- it never touches `/api/`;
- it deletes only caches whose name starts with `wilson-site-walk-agility-`.

Its cache name carries a hash of every shipped file, so a deploy that changes any of them replaces the cache.

## 5. The shell

The pages draw their own header (`site-walk-assets/ui.js`) and do not load `internal-shell.js`. That keeps them identical to the tested standalone pages, and the phone page wants the whole screen. If you want the Agility hamburger on the office page, add `internal-shell.js` to `site-walk-office.html` only; see question 3 in `QUESTIONS_FOR_ANDREW.md`.

## 6. Nothing else

No environment variables, no cron, no migration step, no change to the ePASS agent. Customer and builder contact: the pages open an email draft on the user's own machine when somebody clicks "Email the builder"; nothing is sent by the server.
