# 21 · ePASS status drives the board (Sept 22, 2026, evening)

Andrew, once every ePASS route was on the feed: *"the dispatch board needs to
stop using the route field / salesperson field and begin strictly watching
ePASS for job status changes, which drive the logic built into the system."*
This doc is the plain-language list of what fires on which status, so the
blueprint (01 §4 status engine, §5 automation rules) and the developer spec
(07) have one place that says which rules run **from an ePASS status change
today**, as opposed to from a click in Agility or not yet.

## 1. The decision

**Agility owns the tech and the date. ePASS owns the status.**

* A ticket is **seeded from ePASS once**, the first time the feed shows it:
  whatever tech (`Salesperson1Code`) and date (`SvcScheduleDate`) the office
  keyed become the starting position. After that, changes to those columns in
  ePASS are recorded (`epass_tech_code`, `epass_route_date`, visible in
  `/api/service-board/diagnose`) but **never move a card** and never raise a
  discrepancy on their own.
* `JobStatusCode` is followed for **every** ticket, whoever created it, on
  every pull (15 minutes). A pending Agility packet (a route move the office
  hasn't keyed yet) does not hide a status change any more.
* Every placement Agility makes still becomes a packet for the office to key
  into ePASS; the next pull confirms it. Nothing here contacts a customer —
  the confirm-route and reschedule texts stay behind their own switches
  (doc 20 §6).
* Setting `routing.agility_owned` (Service Journey → Imports → Settings) is
  the switch; OFF returns to mirroring ePASS routing. `routing.auto_place`
  OFF keeps the rules but lets new calls land in Unscheduled with suggestions
  instead of on a tech's day.

**Cutover (one time, on the first pull after deploy).** Every open ticket
keeps the tech and date it has right now as its seed, except tickets waiting
on parts (SO3 / SO3PRE / SO4 / SO4B / SO4H) whose date is only ePASS's
"Saturday dump" placeholder — those dates were never real and are cleared, so
the tickets show in Unscheduled under the parts buckets. A date a dispatcher
placed on the board (different from ePASS's) is kept. The sweep records
`routing.cutover_done` and never runs again.

## 2. What fires on which status

| ePASS status (arrives or changes to) | What Agility does | Where it shows |
|---|---|---|
| **SO1** — new diagnostic, nothing usable keyed | 1. A customer self-schedule hold for this ticket is applied first (tech/day/window from the hold). 2. Else the engine places it by zone and capacity on an auto-schedule route tech's day (`board.auto_place`), earliest = today + lead days, and queues the route packet. 3. If no capacity inside the horizon → Unscheduled with suggestions. | Board column of that tech · packet in Sync queue |
| **SO1** — keyed in ePASS with a roster tech and a future date | Kept as the seed. | Board column |
| **SO1 → anything else** (SO2, SO3, SO7, SO8 …) | The tech who ran the diagnostic becomes `owner_tech` if not already set — every later visit is offered only to them (blueprint §6.1). | "X's call" chip |
| **SO3 / SO3PRE / SO4 / SO4B / SO4H** — approved, ordering, on order, backordered, shipped direct | The routing date is cleared (no fake dates). Tech stays. Office Queues own the parts ETA / PO; once an ETA exists the board suggests ETA + 2 business days and the dispatcher places it. | Unscheduled → "Waiting on a part ETA" / "Parts due — place after the ETA" · Service Office Queues |
| **SO4PRE** — install held before the part is here | Nothing changes: the held date is the customer's promise. (The two-day-out ETA check from blueprint §5.4 is not live yet.) | Board, held day |
| **SO5** — parts in (Kezia's "Part is here", or ePASS) | Not placed by the engine (Andrew, 9/22 late). The customer is told **by text or email per their contact preference** (request card's Call / Text / Email, else ePASS's preferred-contact field) when `notify.parts_in.enabled` is on; the call goes to **Unscheduled with a "prefers …" pill** ("texted 9/22 · awaiting pick" or "prefers phone call — call to schedule"). A phone preference, or the switch off, means the office reaches out. The owning tech stays on the card so the placement goes to them. | Unscheduled |
| **SO6** — install scheduled | Agility's placement is kept. If for some reason there is no date, it is placed like SO5. | Board |
| **SI1–SI9** — in the shop | Shop lane; no routing. | In-the-shop panel |
| **SO7 / SO8 / SO8I / SO9** — declined, complete, cancelled | Closed in Agility, self-schedule holds released, slot freed; the history keeps the date. | Off the board |
| **Ticket leaves the open-ticket feed** | Same as closed (finished or cancelled in ePASS). | Off the board |
| **Re-opened in ePASS** (closed status → open one) | `closed_at` cleared, then the rule for the new status runs. | Back on the board |

Manual status changes in Agility (Service Journey, reason code required)
still work and still queue a packet; ePASS confirms them on the next pull.

## 3. What is documented but not wired to a status change yet

From blueprint §5, still human-driven or future: SO2 → Parts Verify queue and
the auto-quote (SO2.1 / SO2.2 with reminders); SO4PRE's two-day-out ETA
check and automatic release; SO4H "my part arrived" from the customer; the
SO5 "pick your install time" text (customer contact stays off); SO8
auto-charge and the payment-review queue; SO7 sales lead. Each is a rule to
add to `applyStatusRules` in `lib/service-journey-postgres.js` when its
queue or switch exists.

## 4. Where the code is

`lib/service-journey-postgres.js`: `DEFAULT_SETTINGS` (`routing.agility_owned`,
`routing.auto_place`), `applyStatusRules()` (the table above), `autoPlace()`
(calls `suggestForRequest` with `techOnly` for the owner rule),
`reconcileAfterImport()` (status-only diffs when Agility owns routing), the
cutover sweep in `importServiceFromEpassFeed()`.
`lib/service-scheduling-postgres.js`: `suggestForRequest({ techOnly, minutes })`.
History triggers to look for: `epass_status`, `board.auto_place`,
`board.date_cleared`, `board.from_hold`, `feed.left`.

## 5. Board and office changes that rode along (9/22, late)

* **Master search** (top of the board): every open call wherever it is — a
  tech's day, Unscheduled, Past dated, the shop, John's lane — plus the last
  week's closed ones; picking a result opens that day on the left board and
  flashes the card. `GET /api/service-board/search?q=`.
* **Unscheduled** is SO1s where nobody picked a day, SO5s not yet placed,
  and parts tickets (no ETA / ETA to place after). **Past dated** is its own
  panel: a dated call whose day passed and ePASS hasn't finished — drag it
  onto a new day or let ePASS close it. Lane calls never appear in either.
* **Undo** on "Re-optimize this day" (14 s toast) restores the previous order.
* **In-shop repairs can be dragged** onto a tech's day to route the return
  trip (the earlier "cannot" was a misread prompt).
* **Efficiency**: a tech's "max stops per day" is his units per day — one
  ePASS dispatch unit is 1/12 of Josh's day and 1/6 of DLA's. On such a tech
  a job's planned minutes are units × (shift ÷ max stops), the strip's % and
  the engine's capacity use the same math, and the card says "(2 units of
  12)". Techs without a max keep 1 unit = 1 hour.
* **Service Office Queues**: "Part is here" runs the SO5 rule and says what
  happened (customer texted / emailed, or "prefers phone call — it is in
  Unscheduled") with a link that opens the board on that card; the SO4 rows show ePASS's PO number, supplier, item and the
  buyer's ETA (feed dataset `open-service-po-items`), with a one-click "use
  9/29" — Kezia only types the ETA.
* **Warranty SO3**: a warranty ticket moved to SO3 in Agility (not keyed in
  ePASS yet) raises the same flag + email the estimate approvals do, to
  `notify.warranty_so3.emails`, so the ePASS ticket gets updated.
* **Service Journey is admin-only** (page grant + executive); the board,
  office queues, request queue and estimates link to each other at the top.
