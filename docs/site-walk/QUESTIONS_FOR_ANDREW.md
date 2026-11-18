# Decisions that are Andrew's

Each has a default already built, so nothing here blocks going live. Change any of them in the one file named.

## 1. Photos: their own table, or `install_damage_photos`?

**Built:** `sw_photos (walk_id, photo_id, content_type, bytes, meta, …)`, primary key `(walk_id, photo_id)`.

**Why not `install_damage_photos`:** the phone names each photo itself, before it has signal, and re-sends under the same name until the server confirms. That needs a client-chosen id as the key. `install_damage_photos.id` is a `SERIAL` the server assigns.

**If you want one photo store:** only `savePhoto`, `listPhotoIds` and `readPhoto` in `lib/site-walk-postgres.js` touch the table. Point them at `install_damage_photos` with `report_ref = walk id`, `kind = 'sitewalk'` and the phone's id in `meta`, and nothing else changes. Walk photos include the legible spec pages (about 150–400 kB each, one per opening).

## 2. The global JSON body limit

A walk is posted whole (0.3–1.2 MB typical). See "Body size" in `AGILITY_REGISTRATION.md`. If the global `express.json()` limit cannot move, say so and the phone can send openings one at a time; that is a change on my side.

## 3. The Agility shell on these pages

**Built:** the pages draw their own header and do not load `internal-shell.js`, so they are byte-for-byte the tested standalone pages and the phone page keeps the whole screen.

**Yours to decide:** whether `site-walk-office.html` should carry the Agility hamburger. If yes, I would add it to that page only and keep the phone page bare.

## 4. Who is told a walk is ready to sign off

**Built:** `GET /api/site-walk/notifications` derives three kinds of event from the stored walks on every call and sends nothing: `WALK_READY_FOR_REVIEW`, `WALK_PACKET_SENT`, `WALK_SALES_ITEM` (one per spec decision handed to the salesperson). Each has a deterministic `key` to dedupe on.

**Yours to decide:** whether these become `createPushedNotification` cards, and for whom. The salesperson's email comes from the spec package (`sales_email`). The walker is known by login (`last_synced_by` on the walk). My suggestion: `WALK_SALES_ITEM` to the salesperson, `WALK_READY_FOR_REVIEW` to the walker, nothing automatic to the builder (house rule).

## 5. Who may sign off

**Built:** anyone with the page grant can sign off, and the server records who. The page names the walker so it is obvious whose job it is.

**Yours and Cayden's to decide:** whether to restrict sign-off to the walker, or to a role. It is one check in `signOffWalk`.

## 6. How long a login lasts on a phone

If the session ends while somebody is walking a job, the phone keeps everything it records. When it next reaches Agility and is refused, a banner says "Signed out" with a link to sign in again (the `login` address in `site-walk-agility.js`), and sending resumes. Nothing is lost. A walk takes one to three hours. If sessions are shorter than that, a longer one for these three pages would spare people the interruption.

## 7. A screen for archived walks

**Built:** archive from the walk's setup screen; `GET …/walks?archived=1` and `POST …/walks/:id/restore` on the server.

**Not built:** a page listing archived walks with a restore button. Say if you want one.

## 8. A model that proposes dimensions

**Built:** nothing calls a model. A spec book is read by code in the browser, and a person confirms every opening's numbers against its sheet. `SPEC_READING.md` has the whole picture.

**Yours and Cayden's to decide, later:** whether the server should send an install sheet's picture to a vision model and offer its answer as an unconfirmed proposal. It needs an API key on the server, one route, and a budget measured on real sheets first. Filling the library ahead of the jobs gets most of the benefit with no code.

## 9. Step two, when step one is in use

In the order I would take them:

1. **The reporting tables.** The standalone tool projects each walk into 25 tables (`sql/sitewalk_schema.sql`, T-SQL). `sw_walks.payload` holds the same derived values as JSONB, one entry per opening, so the projection can be written in Postgres dialect and filled from stored rows.
2. **The ePASS ticket comparison.** Phase A (`site-walk-ticket.js`, 18 fixture tests) is already with you. It needs the open-orders bundle per job.
3. **Sending changes instead of the whole walk.** Most of a walk's size is spec-page thumbnails that never change after the desk builds it.

## Things I assumed from the notes

Tell me if any is wrong; each is used in exactly one place.

| Assumption | Used in |
|---|---|
| `requirePagePermission(path)` returns middleware that answers `401` JSON on `/api/…` and redirects pages to sign in | `lib/site-walk-routes.js` |
| `req.authUser` has `id`, `email`, `displayName` | `lib/site-walk-routes.js` (`who`) |
| `recordAudit` may return a promise and must not fail the request | `lib/site-walk-routes.js` (`audit`) |
| `getPostgresPool()` resolves to a `pg` Pool, or null without `DATABASE_URL` | `lib/site-walk-postgres.js` |
| Static files in the repo root are served as they are, including a subfolder | `AGILITY_REGISTRATION.md` §3 |
| The sign-in page takes `?next=<path>` | `site-walk-assets/site-walk-agility.js` (`login`) |
| A library row's `updated_by_name` can come from `req.authUser.displayName` | `lib/site-walk-routes.js` (`who`) |
