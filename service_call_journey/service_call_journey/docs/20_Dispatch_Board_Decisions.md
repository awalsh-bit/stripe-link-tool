# 20 · Service Dispatch Board — decisions record (Sept 21–22, 2026)

The dispatch board went live in Client Care (`service-board.html`) on the
ePASS ODBC feed. This is the record of what was decided along the way and
why, so nobody has to reverse-engineer it from the code. Earlier context:
docs 12–17 (Agility alignment and the 9/19 team feedback), doc 18 (the ODBC
feed), doc 19 (launch plan: self-scheduling, capacity, routing), and
`docs/epass-odbc.md` for the schema facts.

## 1. Source of truth

**The feed, not uploads.** `epass-odbc-pull.ps1` runs every 15 minutes
(Task Scheduler on `AWalsh2026ThkPad`, 7 AM–8 PM, UNC path on
`WILSON-FS02`; to move to the server when convenient) and writes two
bundles; `epass-agent.ps1` pushes them to Agility. Everything below reads
those tables. The Invoice Maintenance / DispatchTrack / OE-04 uploads still
work but are fallbacks.

| Bundle | Tables | Feeds |
|---|---|---|
| `epass-open-orders` | `epass_open_orders`, `_lines`, `_serials`, `_misc`, `_models`, `epass_on_hand_serials`, `epass_open_po_lines` | Ordering Report, **Sales Order Health** (9/22) |
| `epass-open-service` | `epass_open_service`, `_labor`, `_items`, `_comments`, `_notes`, `epass_service_history` | Service Journey mirror (`sj_jobs`), **dispatch board**, **Service Order Health** (9/22), flag routing |

Every ticket that leaves the open-ticket feed is closed in the mirror
(`feed.left` in its history) — the feed is the complete set of open SV
tickets, so absence means finished or cancelled in ePASS.

**Acknowledge, then mirror.** The server stores a service bundle and answers
the agent immediately; the mirror and the health snapshots run afterwards,
one bundle at a time. A slow upload over the VPN (the 9/21 evening run took
9 minutes to pull and 2½ to upload) can no longer time the agent out
mid-mirror. The agent uploads only the newest feed bundle and parks older
ones as `superseded`.

## 2. Who is the tech on a ticket

**`Salesperson1Code` on the invoice header** (Andrew, 9/22). It is the SP
code the office assigns the ticket to — the same code DispatchTrack
exported as "Truck". Fallbacks only when the header has none:
`DispatchRequestedRouteCode`, then the latest labor line's tech — and a
fallback is used only if it is a real roster code (so a dummy route like
`ZZZ` can never become a tech).

Codes are canonicalised against `sj_techs` (`sp_code` + `aliases`, e.g.
`KJB2 → KJB`). An unknown code is kept as-is so it is visible: the card
lands in Unscheduled with a red **"ePASS tech XYZ not in roster"** chip, and
the tech's route-settings drawer has an **ePASS codes** field — add the
alias there and the next feed re-homes the tickets automatically.

The mirror follows ePASS for feed tickets (`sync.follow_epass_for_import_jobs`)
unless a board move is still pending as a packet; `/api/service-board/diagnose`
shows the feed's codes, the roster match, and how many tickets a pending
packet is holding.

## 3. Durations and capacity

**One dispatch unit = one hour** on service tickets (Andrew/Cayden, 9/21):
`est_minutes = DispatchUnits × 60` for 1–12 units. The ePASS clock fields
(`SvcTimeStarted/OnJob/Completed`) are not trusted — they needed a
MobileTech subscription or were admin-heavy and are mostly unused. Measured
durations will come from Samsara GPS dwells (the service vans are on
Samsara); doc 19 §3.

Capacity per tech-day = pattern shift (per-weekday start/end, from
shop/home) minus blocks, with commute counted only up to the tech's
allowance (`commute_allow_min`, default `board.commute_allow_min` 45 each
way) and per-tech limits: max stops, max on-site minutes, max drive
minutes, accepts overflow.

## 4. Roster modes

* **route** — auto-routed, has a column on the board.
* **office** — office assigns; no automatic placement.
* **collector lane** — builds his own route; his tickets live in a lane,
  not a column, with a hand-off drawer. **John Merz is the lane** (Andrew,
  9/22): applied by migration until someone edits his route settings.

Retire dates take a tech off the board from that day; aliases and modes
are edited in the tech's route-settings drawer (click the name in the
strip).

## 5. What the board does, and what it deliberately does not

Ported from `prototypes/dispatch_board_and_tracker.html` (9/22): drag a day
cell onto a board (click = left), week navigation, confirm route (locks
stops, records the confirmation), reschedule a closed day (sick/PTO → best
fit per stop, one click to move), route settings (pattern, limits,
aliases, retire), collector lane, cancel / uncancel with a 3-day undo
panel, in-shop lane (SI statuses, "Repaired — ready to go back" → SI5),
visit groups ("N at this house"), map with route summary and full screen.

Added 9/22 after Andrew's first day on it: the map is interactive (‹ › move
both boards a day, click a stop to move/unschedule/cancel/see history,
click a tech to load/hide/overview/settings), customer names open the
**Service history** drawer, Unscheduled and In-the-shop are filterable and
expandable, and the feed line knows the pull window (an old stamp overnight
is normal; inside 7 AM–8 PM it turns red).

Not ported on purpose: trips/buckets, money and productivity views, the
zone editor, the Google roads map (Mapbox is the choice — doc 19 §4), the
tracker/intake/confirmation/bench/damage queues.

## 6. Customer contact

**No surprise automated customer contact.** Confirming a route or
rescheduling a day shows the exact text per customer; nothing is sent
unless `notify.route_confirm.enabled` / `notify.reschedule.enabled` are
switched on in settings (both default off). The card chip says "confirmed ·
route locked" or "confirmed · customer texted" — never "customer told" when
nothing went out. Every board move becomes a sync packet for the office to
key into ePASS; the next feed confirms it.

## 7. Health reports on the feed (9/22)

Sales Order Health and Service Order Health snapshots are rebuilt from the
feed on every bundle, in the exact row shape the ExportInvoice parser
produced, so the pages, "My Order Flags" on the dashboard, the
install-damage truck picker and the flag routing are unchanged. Column
mapping is checked against `reference/data/ExportInvoice_20260910`:
SP = `Salesperson1Code` (KJB2 stays KJB2), Route = `DispatchRequestedRouteCode`
(D01–D06 on delivery days), Job Status = the code, Name = `LAST FIRST`,
Total = sum of the component totals, Balance = Total − (committed + open
payments). `/api/epass/feed-vs-upload` compares the feed rows with the last
spreadsheet upload field by field; if Total/Balance show a systematic gap,
the formula is the thing to adjust. The SV/COD summary flag is re-issued
only when its numbers change.

## 8. Ordering Report decisions (9/21) — for completeness

Reserved units live in the `Serial` master (`Status` blank +
`OrderedForInvoiceCode`), not `InvoiceSerial`; PO ETAs are inaccurate, so
the badge was removed; every open line is kept with flags (ordered / D1 /
covered / needed) and the PO stays visible even when serial-reserved;
supplier names snap to the NetSuite vendor (numbered, e.g. "0015 Almo
Corporation") with an ePASS→NetSuite mapping panel; on-hand sorted oldest
first; only serial type ALL is "free to rotate" — other types show soft
yellow as "Exclusive Reserve Available" when unreserved.

## 9. Still open

* Roster and zones from `Route` / `MapZoneVertices` (second `-Discover`
  run and copy `schema\` into `odbc\`).
* Mapbox account + `MAPBOX_TOKEN` in Render; `lib/routing.js` wrapper.
* Samsara vehicle ↔ `Route.LocationCode` mapping; stop matcher.
* Move the two scheduled tasks to WILSON-FS02.
* Delivery-side capacity/routing: the planned "smash and redo".
