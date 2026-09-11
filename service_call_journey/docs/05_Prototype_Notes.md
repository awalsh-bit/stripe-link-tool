# Prototype notes

## prototypes/dispatch_board_and_tracker.html (published as "Wilson Dispatch Prototype")
- Week fill strip (6 techs × Mon–Fri Sep 14–18); click a cell to load it into the left or right truck column. Defaults to the same tech on consecutive days.
- Two-truck view: drag cards between columns, reorder, or drop to Unscheduled. Re-validates on drop: call ownership (diagnosing tech owns installs — hard flag), skill, primary/secondary zone, parts ETA vs date. Shows drive-time delta.
- Timeline per column: leaves shop/home 8:00, drive minutes, arrival, waits for AM/PM window, late flag, return time; capacity bar (work vs drive of 9h shift).
- Pin locks a stop; "Re-optimize this day" nearest-neighbour re-sequences unpinned stops within AM then PM windows.
- Unscheduled bucket replaces the Saturday dump day.
- Schematic map (no tiles).
- Customer tracker: SV lookup, 9-stage progress list, "right now" card, window picker driven by the same capacity data and restricted to the owning tech. 48-hour reschedule rule; same-week reschedule keeps AM/PM window. Picking a slot books the job onto the board.

## prototypes/field_tool.html (published as "Wilson Service Field Tool")
- Route: next stop with On my way (Call via Podium or Text per customer preference) and Arrived (starts on-site timer). All stops with ETA/status.
- SO1 job: customer's problem + photos, unit, gate, balance flag; required serial-tag photo; one-tap Outcome (field quote / office quote / quick fix / research / replace / declined / no access) with the resulting status shown on each option; symptom + cause chips per appliance; parts and labor; one note (required only for outcomes the office must understand); readiness strip; submit records on-site minutes.
- Field quote: flat-rate tasks (6 common, searchable, show all), modifiers, catalog parts with last-verified price, S&H, tax split parts vs labor (labor exempt when built-in), totals, customer decision, agreement + signature canvas. Approve → SO3 (parts) or start work (labor-only); think → SO2.2; decline → SO7.
- SO6 job: parts on truck with Installed / Wrong / Damaged, serial tag from diag (not re-required), outcome → SO8 charge / SO2 more parts / SO3 reorder / SO1 research.

## Added 9/11 (v3 of the board)
- Real roster (DLA, AJH, TDP, JRC, KJB, CIT, CEM, BLL + JHM and MAP as not-auto-routed, hatched in the fill strip). Zones and primary/secondary techs come from `reference/zip_zone_tech.csv`; every card shows its ePASS Map Zone chip.
- Booking modes in the tracker: Greta Hartmann (Fredericksburg, SV00123420) sees only the open West trip date (Wed 9/16, proposed on volume and confirmed by Demitrius); with no open trip she would see "we will text you a date"; Mary Bennett (Cedar Park, SV00123415) sees "we'll call you" because the zone is office-only.
- Shop touch: home-start techs (Josh, Kyle, Connor, Brady) get a "shop touch · load parts" leg inserted before their first install unless "Loaded parts last night" is toggled on the column header. Shop-start techs show "parts loaded".
- Inside-48h reschedule shows only windows where a route is already in the customer's zone group that day; SO6 stays with the owner.
- Dropping a job on John or Mark flags "office assigns"; dropping a West-zone job on a day with no open trip flags "this starts a trip"; every column shows drive minutes per stop with a ⚠ over 35; Re-optimize is disabled for John.

## Sample data assumptions to replace
- Tech home coordinates are approximate (city-level); shop at 4205 E Hwy 290 Dripping Springs; drive time = 4 min + 1.55 min/km straight-line. Zone→tech mapping is real (2026 completions); the sample jobs are invented.
- Half-day windows 8–12 / 12–5, 240 min per half day, 9h shift.
- Durations: diag 60, HVAC diag 90, installs 60–150.
- Parts prices, verified dates and flat-rate tasks are samples drawn from the real rate book families.
- Tax 8.25%.

## prototypes/office_queues.html (published as "Wilson Parts & Sync Queues") — added 9/11
- Parts verify: every SO2 submission as a card with age, source (field-approved / office quote / warranty), tech's parts with last-verified date; prices ≤7 days pre-accepted; "Look up at supplier" simulates a price/availability pull; the requote banner applies the 10% / $10 rule live (Ana Reyes' control board comes back +34% → "text customer to re-approve"); verify routes to SO3 / SO2.1 / re-approval.
- Parts order: SO3 lines grouped by supplier; select → Create PO → expected date, ship-to, export sheet → Place moves jobs to SO4 (SO4B if ETA > 10 days) and writes sync items.
- Receiving: scan part number or PO; per-line check-in with auto bin; all-in → SO5 with "pick your time" text, or SO4PRE → SO6 auto-confirm (try scanning PO-4471).
- ePASS sync: packets with copy buttons per field; Keyed → awaiting import; "Simulate next import" confirms keyed items and injects a reverse discrepancy (someone moved a date in ePASS); discrepancy cards offer Re-issue or Accept ePASS.

## Intake step 2 (in dispatch_board_and_tracker.html → Customer tracker → "Start a new request") — added 9/11
- Picks a ZIP from the real list and shows the zone, group and booking mode; `open` shows the picker (primary tech preferred, secondary when full), `designated_days` with no open trip shows the bucket message, `office_only` shows "we'll call you". Booking creates the job on the board and opens its tracker page.

## Added 9/11 evening — from the service team's demo feedback (v4 of all three)

**dispatch_board_and_tracker.html**
- Every tech name is a link (fill strip, column 👁 button, map legend double-click) → **route overview drawer**: stops in order with ETAs and drive legs, blocks, that tech's own map, projected/last-week dollars, alerts. Read-only mirror of what the field tool shows the tech.
- Fill-strip cell **⋯** (or right-click) → **day controls** popover: Close day (PTO / sick / training / other), Open day (Josh's Friday — `workDays` Mon–Thu, closed by default, hatched, never offered to customers), PTO range through a day, +1 stop / ±60 min (`capacity_adjust_min`), Add a block (haircut, van maintenance, training…). Closed days are hatched; adjusted days show `*`.
- Dropping onto a **closed day** or over capacity does not refuse: a sticky toast offers **Open the day & keep it** / **Force it** / **Undo**. Forced stops carry a red `forced` chip and the column header says *over capacity · n forced*.
- **Blocks** show as grey ⏸ cards in sequence (removable), count against the fill bar (grey segment) and the picker, never appear in a packet.
- Day dropdown → **calendar button** (📅): month grid tinted by fill, hatched closed days, trip dot, today outline; any weekday is selectable (empty days just show no stops).
- **Map legend** chips toggle each truck, Unscheduled, and every other tech with stops on the left column's day (grey dots).
- Column footer: **projected $** for the route with labor / parts-profit split; **Productivity · department** panel at the bottom: last week actual per tech (OE-23 basis, sample), calls, $/call, vs target, next week projected from the board.
- Tracker: new sample **SV00123433 · Rosa** (SO4H, GE ships direct) with the **📦 My part arrived** button → SO5 → picker with Andrew's windows.
- Picker never offers a tech's closed day (`isOpen`).

**field_tool.html**
- Route header carries the **delivered-dollars strip**: Today / This week / Target with a pace line and a progress bar; tap → per-stop list with labor and parts-profit split, "pending" for field-approved jobs that count on install day, "est. cost" when no PO cost. Warranty installs show *parts: a wash*. Sample: McCollum install = $130 labor + $91 parts profit.
- **Blocks** appear in the stop list as grey ⏸ rows (Van maintenance · 11:15).
- *What you found*: tapping **Error code** opens a required **Code shown** field (the typing exception); **＋ Custom note** button reveals a text box (voice-to-text friendly).
- Field quote labor: **Half day · 4h** and **Full day · 8h** quick-pick chips above the task list (also added to the office-quote labor estimate).
- Submit toast adds "+$X to your day".

**office_queues.html**
- New first tab **Search & history** + a global search box in the header: name (any order), phone digits, SV, serial, model, address → customers / service orders / units. Customer page: contact + card + zone, units with serial and per-unit call count, full history table (date, SV, unit, tech, status, what was found/done, delivered $ with labor/parts split), **recall candidate** banner. Sample: Hippe washer — SV00123302 is 23 days after SV00122731 on the same serial → candidate; Recalls queue with Confirm / Dismiss.
- Receiving tab: **Held install · part not in — check ETA** task for Kezia (SV00123318, held Tue 12–5, valve expected today): *Part is here* (receives → hold confirms), *New ETA — release hold* (→ SO4, apology text, ePASS "time out" packet queued, route loses the stop), *Wait*.

Sample-data notes: delivered dollars in all three files use the OE-23 definition (labor incl. diag/zone fees + parts profit; warranty = labor only); weekly targets are placeholders calibrated to Jan–Sep 2026 actuals (JRC 2,600 · TDP 2,500 · AJH 2,200 · CEM 2,150 · KJB 1,900 · DLA 1,700 · BLL 1,700 · CIT 1,450) until Cayden supplies real quotas.
