# Cosmetic Damage Form: where the trucks and stops come from

*Written 11/16, after reports that a truck was showing the wrong orders, "almost like it stops checking at some point". This covers the truck picker at the top of the form only. The photos, the review step and the Service Request Queue entry are unchanged.*

**Installation → Cosmetic Damage Form** (`install-damage.html`). The installer taps their truck, sees that run's stops, taps the job they're at, and the form looks the invoice up. Typing the invoice number in the box underneath always works, whatever the truck list says.

## What a truck's list is

A stop is on a truck's list when all of these are true in ePASS at the last pull:

- it is an open sales order (types R, S, AC, CAB or MOD; not finished and posted; not void),
- its **Route** field holds that truck (D01, D05, ABC…),
- its **Schedule Date** is today.

If nothing at all is routed for today, the form shows the most recent routed day on file and says so.

## How current it is

Agility pulls open orders from ePASS every 15 minutes. The form reads the result of that pull directly, so the list is as current as the last pull.

- Under the trucks it says **From ePASS as of 2:15 PM**, with a **Refresh** link.
- If ePASS hasn't been read for more than 45 minutes, that line turns amber: *ePASS was last read at 11:02 AM, so this list may be out of date. If your stop isn't here, type the invoice number below.*
- With no signal it keeps the list it has and says what time it's from.

The form asks again by itself whenever it comes back to the front of the phone, every two minutes while it is open, and each time a truck or a stop is tapped. If the stop that was picked has since moved, it says so: *ePASS now shows R00016008 (VALENZUELA VICTOR & ROSE) on D03, not D05.* The report in progress is left alone, since the installer may well still be at that job.

## What was wrong before 11/16

Two faults, both reproduced on the old code before they were fixed:

1. **The form asked once.** The truck list and the day were fetched when the page opened and never again. A phone hands back a page it kept in memory without reloading it, so a form opened yesterday kept yesterday's trucks, and every tap asked for *yesterday's* stops. What came back was whatever from yesterday was still open in ePASS.
2. **It read a copy, not the pull.** The list came from the Sales Order Health snapshot, which is rebuilt from the pull a few minutes later, at the end of a queue that also refreshes the Ordering Report, quotes and projects. The list was always that far behind ePASS, and further if the queue was slow.

A form that was already open on a phone when this went live is covered too: the server now ignores the day the page sends and answers with today's stops.

## What it still can't know

- **A finished order drops off.** Once the office finishes and posts a delivered order, ePASS no longer counts it as open and it leaves the truck's list. Use the invoice box for those.
- **Only ePASS's Route field.** If a stop is moved between trucks somewhere else (DispatchTrack, a phone call) and the Route on the ePASS order isn't changed, the form still shows it on the old truck.
- **Only while the pull runs.** The pull is a scheduled task on the ePASS server. The setup notes in the pull script have it starting at 6 AM and repeating for 14 hours. Outside those hours the list is the last pull of the day, and the amber line says so.
- **Up to about 20 minutes behind.** A change made in ePASS shows after the next pull, which runs every 15 minutes and takes about five.

## For developers

- `lib/epass-feed-orders.js`: `routedOrdersFromFeed()` reads every open sales order that has a route from `epass_open_orders`, with the time the pull was received (`epass_open_orders_meta.received_at`). `truckBoard(rows, today)` is pure: rows in, the day and its trucks with their stops out.
- `server.js`: `getInstallDamageTruckBoard()` builds the board and keeps it for 20 seconds, so many phones cost one read. `GET /api/install-damage/trucks` returns `{ date, today, asOf, ageMinutes, stale, source, routes: [{ route, count, orders }] }`. The two older calls (`/routes`, `/route-orders`) still answer in their old shape from the same board, for pages not yet reloaded.
- `source` is `epass-feed` normally. `upload` means the pull has been quiet for over 45 minutes and someone has since uploaded the Invoice Maintenance export to Sales Order Health by hand, so that newer picture is used. `epass-feed-copy` means the open-orders table couldn't be read and the Sales Order Health copy stood in.
- No new tables. Every response is sent `Cache-Control: no-store`.

# Cosmetic Damage Form: sending on a weak signal

*Added 11/25. Andrew: "install users on chrome browser on android are having issues with image capture on cosmetic damage form - citing that he needs near full service to get it to go through".*

## What was wrong

The photos were never the problem to take. Getting them to dispatch was. The first three points were reproduced on the old form over a test link held to one bar (about 48 kbps up); the last two come from reading its code:

1. **Everything went in one request.** Send posted the whole report, three or four photos and all, in a single upload. A connection that dropped part way lost all of it, and every retry started from nothing.
2. **No progress and no time limit.** On a slow but steady link the button read "Sending…" for a minute and a half with nothing to say it was working.
3. **A failed send was only retried when the signal was good.** The report was parked on the phone and tried again when the browser noticed the signal come back, or when the form was reopened, and again all in one piece. On one bar that fails the same way. It went through once the phone had a strong signal, which is what the installers were describing.
4. **A parked report could be lost without a word.** It was parked in the browser's text storage, which holds about 5 MB. A second or third parked report could overflow it. The form caught the error, said nothing, and still showed "saved on your phone".
5. **A report could be filed twice** if the upload arrived but the answer didn't make it back to the phone.

## What happens now

- **Each photo starts uploading the moment it is taken,** by itself, in small pieces, while the installer fills in the rest of the form. Each photo shows its own mark: *Waiting to upload*, *Uploading 40%*, then a green *✓ Uploaded*.
- **A piece that fails is the only thing sent again.** The piece size follows the signal: smaller when pieces are being lost, larger when they flow.
- **Send saves the report on the phone first,** then finishes any photos still going up and files the report, which by then is a few kilobytes at most (1.7 KB in the test). The screen reads **Report saved** with a progress bar ("Sending to dispatch… 33% (168 KB of 497 KB)") and changes to **Report sent** when dispatch has it.
- **It keeps trying** while the form is open: every second or two at first, slowing to every 30 seconds. **Try again now** tries at once.
- **Closing the form doesn't lose it.** The next time the form is opened, a bar at the top says "Saved report for R00016008: sending, 45%" and it carries on from where it stopped. Nothing is typed or photographed again. **Report another** can be used while an earlier report is still going out.
- **The screen is kept awake** while a saved report is sending and the form is showing, for up to ten minutes from Send, because a phone that sleeps stops sending. It lets go as soon as the report is sent.
- **Signed out?** The screen says so and offers **Sign in**. The saved report sends by itself after signing in.
- **One queue entry per report,** however many times the phone sends it.
- **Reports the old form had parked** on a phone are still sent, the old way, the next time the form opens there.

## Measured

Same test link, same three photos (497 KB after the phone shrinks them), the installer spending a minute on the rest of the form after the first photo:

| Link | Form before 11/25 | Form now |
| --- | --- | --- |
| One bar, steady | At dispatch 85 s after Send. The button read "Sending…" throughout. | At dispatch 44 s after Send, with progress shown. |
| One bar, and every open connection dropped for 3 s in every 9 | Not at dispatch 6 minutes after Send. The screen said it was saved and would send automatically. | At dispatch 151 s after Send. |

## What it still can't do

- **Send while the phone is asleep or the form is closed.** A browser stops a page it isn't showing. The report waits on the phone and goes when the form is next opened. If a report matters today, leave the Report saved screen up until it says Report sent.
- **Make a slow link fast.** The same photos have to travel. They are not smaller than before (1600 px on the long side), so nothing is lost for a manufacturer claim.
- **Survive the browser's data being cleared.** A saved report lives in Chrome's storage for Agility on that phone. Clearing site data, or using an incognito tab, removes it. Where the browser won't keep a copy at all, the screen says to keep it open until it reads Report sent.

## For developers

- **`install-damage.html`, `OUTBOX`:** the sender. Photos and saved reports are kept in IndexedDB (`wilsonDamageOutbox`: `photos`, `reports`); a report sent more than a day ago is tidied away. `track` / `untrack` follow photos as they are taken and removed; `submit` saves a report; `pump` sends one piece or files one report at a time. Pieces are 8 KB to 256 KB, aimed at about four seconds each, cut by a quarter after a loss and grown back by a third per success. Each piece has a time limit of 12 s plus a second per 2 KB.
- **`PUT /api/install-damage/upload/:id`:** the next piece of one photo, raw bytes, at most 1 MB. Headers `X-Report-Key`, `X-Photo-Kind` (`tag` or `damage`), `X-Total`, `X-Offset`. A piece is added only if it starts where the photo so far ends. `200 { received, total, done }`, or `409` with the same when it didn't fit, so the phone carries on from `received`. An empty piece asks how far along a photo is.
- **`GET /api/install-damage/upload-status?ids=`:** the same figures for several photos.
- **`POST /api/install-damage`:** now also takes `reportKey` (the phone's id for the report) and `photoUploads` (the ids of its photos, in order). It answers `409 { incomplete: [...] }` until every named photo is whole, files the report once per `reportKey`, and answers a repeat with `{ ok, id, duplicate: true }`. A form still open from before 11/25 sends neither field and attaches its photos, and is handled as before.
- **`lib/install-damage-postgres.js`:** tables `install_damage_uploads` (a photo while it arrives) and `install_damage_reports` (one row per report key). Filing moves a photo into `install_damage_photos` and empties its upload row. Uploads never filed are purged after 14 days; filed rows and report keys after 60.
- Same permission as the form itself on all three routes. The queue card and the photo route are unchanged; a filed report's `installDamage` gains `reportKey`.

## Checked before delivery

The real `server.js` against a local test database, with a slow, dropping link put in front of it for the page tests. 55 of 55 checks passed.

- **Server (25):** pieces in order, twice, out of order and past the end; another report's id; sizes over the limits; a report held until its photos are whole; stored photos byte-for-byte what was sent; the same report sent again, and three times at the same moment, making one entry; a send that died half way taken over after two minutes; the old all-in-one submit; permissions; audit.
- **Good connection (10):** photos uploading before Send, the Uploaded mark, one small report request, the queue entry and its photos, the phone keeping no photos once sent.
- **Weak signal and interruptions (20):** both links in the table above; no signal at Send, the form closed, then reopened; signed out before Send; the answer to a send lost; a browser with no storage; a report parked by the old form; a photo retaken and one removed mid-upload; the screen held awake and let go.
