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
