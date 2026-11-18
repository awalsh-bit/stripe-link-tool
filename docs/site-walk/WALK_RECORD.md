# The walk record

One walk is one JSON message, schema `wilson.sitewalk/2`, built in the browser by `SW.syncPayload(walk)` in `site-walk-assets/site-walk-core.js` and posted to `POST /api/site-walk/sync`. A real one, from a fictional job, is in `docs/example-walk-payload.json`.

It has two halves, and the difference matters.

| Part | What it is | Who reads it |
|---|---|---|
| `walk`, `rollup`, `openings[]` | **The answers.** Flat values with nothing left to compute: each opening's status, each dimension's verdict in words, each correction with its owner. | The server lifts a few into columns and stores the rest whole in `sw_walks.payload`. Reports and step two read this. |
| `walkDocument` | **The walk itself**, exactly as the browser holds it. | Nobody on the server reads it for meaning. It is stored in `sw_walks.document` and handed to any device that opens the walk. |

**The server never recomputes an answer.** If a report needs a number, it is in `payload`. If it is not there, the fix is to add it to `syncPayload` in the browser, where the rule lives, so the packet and the report cannot disagree.

## `walk`

| Field | Meaning |
|---|---|
| `clientId` | The walk's id, made in the browser (`walk_…`). The primary key everywhere |
| `jobNo` | The ePASS base ticket number, which is also the Steel Cod package number |
| `project`, `address`, `builder`, `builderContact`, `builderEmail` | The job |
| `walkDate`, `walkedBy` | `walkedBy` is the display name of the first signed-in person to record something at the house |
| `salesName`, `salesEmail`, `quoteNo`, `specSource` | Read from the spec package |
| `flooringPending`, `flooringThicknessIn` | Flooring still to go in; heights are judged to the finished floor |
| `access` | How the appliances get in: `route` (`ground`, `entry-steps`, `interior-stairs`, `elevator`, `lift`), `state` (`clear`, `tight`, `blocked`), `tightestIn`, `note`, `findings[]`, `photos[]` |
| `prereqs`, `jobFindings` | The eight before-delivery questions and what they raise |
| `stageCode` | `setup`, `ready-to-walk`, `in-field`, `ready-to-send`, `sent` |
| `updatedAt` | **The revision.** ISO-8601. Newest wins |
| `reviewedAt`, `reviewedBy`, `sentAt`, `sentTo` | Sign-off and send as the page last saw them. On Agility the server's own columns are the truth and are written back into the stored document |
| `ticket` | The last ePASS ticket comparison, when one was run (step two) |

## `rollup`

`openings`, `walked`, `percentWalked`, `readyCount`, `verifyCount`, `modifyCount`, `decisionCount`, `openCount`, `heldCount`, `blockerCount`, `attentionCount`, `deliverable`.

## `openings[]`

One per appliance opening (a merged opening is one entry with its units inside).

| Field | Meaning |
|---|---|
| `clientId`, `sortOrder`, `area`, `location`, `brand`, `model`, `appliance`, `category` | What and where |
| `installBasisCode`, `installBasisLabel`, `specPageRef`, `basisConfirmed`, `basisPending`, `basisConflict` | The install type walked, the spec page it came from, and whether the field opening matches a different one better |
| `status`, `statusLabel` | `ready`, `verify`, `modify`, `decision`, or empty while open |
| `done`, `started`, `notMeasuredReason`, `irregular` | Progress. `started` means something was recorded at the house |
| `dimensions[]` | Per axis: `rule` (`exact`, `min`, `max`, `range`), `specIn`, `actualIn`, `deltaIn`, `verdict`, `verdictText`, `acceptedReason`, three-point `points[]` |
| `utilities[]` | Per connection: `code`, `requirement`, `belongs` (where the sheet puts it, in words), `answer` (`ok`, `misplaced`, `roughed`, `missing`, `na`), the marked position in inches |
| `panel` | Who supplies it, whether it is on site, thickness and size |
| `actions[]` | Corrections as objects: `id`, `text`, `owner`, `severity` (`blocks`, `cosmetic`), `kind` (`fix`, `question`, `note`) |
| `findings[]` | Everything the opening raises, each with `label` and `detail`, and an `owner` where it is a correction somebody has to make |
| `conclusion`, `punchLine`, `fieldNote` | The words that print |
| `photos[]` | Ids of photographs in `sw_photos` |

### Owners

`builder`, `cabinet`, `electrician`, `plumber`, `trim`, `countertop`, `hvac`, `flooring` go on the builder's list. `wilson` and `internal` print on Wilson's own page and never reach the builder. `sales` is a spec decision: flagged on the packet and raised to the salesperson. The same table is `OWNER_GROUP` in `lib/site-walk-rules.js`.

## Where it lands

`sw_walks`, one row per walk.

| Columns | From |
|---|---|
| `walk_id`, `job_no`, `project`, `builder`, `builder_contact`, `builder_email`, `address`, `walk_date`, `walked_by`, `sales_name`, `sales_email` | `walk` |
| `stage`, `opening_count`, `walked_count`, `ready_count`, `verify_count`, `modify_count`, `decision_count`, `open_count`, `blocker_count`, `is_deliverable`, `access_route`, `access_state` | `walk.stageCode`, `rollup`, `walk.access` |
| `document` (JSONB) | `walkDocument` |
| `payload` (JSONB) | `{ schema, exportedAt, walk, rollup, openings }` |
| `client_updated_at` | `walk.updatedAt` |
| `signed_off_at`, `signed_off_by`, `signed_off_by_name`, `sign_off_note`, `packet_sent_at`, `packet_sent_to`, `packet_sent_by` | Set only by the sign-off and sent routes, under a login |
| `archived_at`, `archived_by` | Set by the archive route. An archived walk is out of the queue and the phones' list, and is otherwise untouched |
| `first_synced_at`, `last_synced_at`, `last_synced_by`, `last_sync_device` | The server |

`sw_walk_events` keeps a line per `created`, `synced`, `stale_ignored`, `signed_off`, `reopened`, `sent`, `archived`, `restored`. `sw_photos` holds the photographs and the legible spec pages.

`sw_spec_library` is not part of a walk. It holds the shared spec library: one row per library entry somebody changed (`kind = 'model'`, keyed by the model number's letters and digits) or per set of opening numbers somebody confirmed against a sheet (`kind = 'dims'`, keyed by model and install type), with `doc` as JSONB, who and when, and `deleted_at` set when the row was removed.

Reaching an opening from SQL today:

```sql
SELECT w.job_no, o->>'model' AS model, o->>'statusLabel' AS status
  FROM sw_walks w, jsonb_array_elements(w.payload->'openings') AS o
 WHERE o->>'status' = 'modify';
```

## What a device is offered

`GET /api/site-walk/pull` returns one summary per walk a device may open (`clientId`, `project`, `jobNo`, `address`, `builder`, `walkDate`, `stageCode`, `openings`, `walked`, `updatedAt`, `syncedAt`, `signedOffAt`, `signedOffBy`, `archivedAt`) with `walk: null`. The document comes with `?client=<id>`, which is what the phone asks for when a walk is opened. A phone refreshing its list therefore downloads a few hundred bytes per walk, not the walks.

## What a browser keeps

Each browser keeps the walks it has opened in its own store (about 5 MB), so a phone can work with no signal. Because the server holds every walk, a browser lets go of a walk that has been sent and has nothing left to send the next time a page loads, and lets go of others with nothing to send when the store is full. It never drops a walk with unsent work. Any walk reopens from the server by its link.

## Sizes

A walk is typically 0.3–1.2 MB, most of it small copies of the spec pages inside `walkDocument`. A document over 8 MB is stored without its `document` (the answers are still kept); the cap is `MAX_DOCUMENT_BYTES`. Photographs are capped at 8 MB each and go up one at a time, separately.
