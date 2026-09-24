# 23 — The board owns the journey (Cayden & Jack's feedback, 2026-09-24)

Andrew's overview, and what changed in the code to match it.

## The rule

The Agility dispatch board is the source of truth for a service call from
request to finish. ePASS is read for three things only:

1. **A blank SO1 exists** for a request — the feed links the ticket to the
   request's board card (`matchCreateTicket`, by phone / last name + ZIP, or
   the office keying the SV on the queue card). The card keeps whatever
   placement the board already gave it; ePASS's schedule date and
   salesperson are recorded on the `epass_*` columns and never move a card.
2. **The parts chain** the parts team drives in ePASS: SO3 (estimate approved
   or warranty → order parts), SO4 (ordered → the board can route on the
   ETA), SO5 (received → customer picks a return date, `notify.parts_in`
   switch). These are the only ePASS status changes the board follows
   (`EPASS_FOLLOW_STATUSES` in `lib/service-journey-postgres.js`), plus a
   ticket finished or cancelled in ePASS.
3. Part lines on the ticket (`sj_job_lines`) for the field tool's truck list.

Everything else — SO1 ↔ SO2, SO6, moves in ePASS — shows as "ePASS says …"
on the card and changes nothing. The Parts Verify button no longer checks
ePASS's status (it stays SO1 until an estimate is approved).

## The flow

- Customer submits a request (appliance / HVAC form) → the queue logs it
  **and the board gets a placeholder card `NEW-<card>` (status REQ)** —
  on the customer's picked day when self-scheduling placed it, else in
  Unscheduled with the engine's suggestions (`upsertRequestJob`,
  `placeRequestJob`). A `create_ticket` packet asks the office for the SO1.
- Office makes the blank SO1 in ePASS. The feed (or the SV keyed on the
  queue card — `attachRequestJobToSv`) moves the placeholder onto the real
  number; status REQ → SO1; placement untouched.
- Tech runs the call in the field tool.
  - **No parts (fixed / declined / replace)** → SO8 / SO7 → **Ready to bill**
    on Service Estimates.
  - **Parts** → Parts Verify (price + availability buttons) → SO2.1 → the
    **estimate is built automatically** (parts, the tech's labor lines,
    freight, tax, ETA from the availability) and waits on Service Estimates
    with an Unsent pill — one click to email or text. **Warranty** lands as
    approved straight away.
  - Estimate approved → office makes the ePASS ticket match and sets SO3.
    Parts team orders (SO4) and receives (SO5) in ePASS; the feed carries
    those to the card and the customer tracker.
  - Return visit → tech marks complete → **Ready to bill**.
- **Ready to bill** (Service Estimates, top): amount from the approved
  estimate (or the verified / tech lines), diagnostic zone fee on
  declined / on-the-spot calls, warranty strips zone + freight + tax.
  "Charge card on file →" opens Charge A Saved Card prefilled (SV, amount,
  description, Stripe customer + payment method from intake). "Billed &
  finished in ePASS" records the amount and closes the card
  (`sj_jobs.billed_*`). Nothing is charged by that page.

## Field tool

- Photos live **inside the visit** (above the outcome, once Arrived) and on
  a done stop's note / change forms — no Photos tab.
- Serial tag "on file" = **a photo of this serial only** (Cayden). ePASS
  history no longer counts.
- Symptom / cause chips are gone; one **Service performed / notes** field.
- Component search: every word matches in any order (`pump drain` finds
  `WASHER DRAIN PUMP`), codes match too, inactive codes are searched when
  nothing active matches, and an empty result says how many codes the rate
  book holds so "no match" and "nothing loaded" read differently.

## Navigation

- Dispatch Board → **⚙ Admin settings** → `service-journey.html?view=settings`
  (zones, booking, notifications, labor pricing, roles by job code). The
  ePASS mirror page is retired from the menus.

## For Cayden

- Roles are **job codes**, never people. On Admin settings → Roles by job
  code, pick the title codes that hold each role; add an email only where
  someone outside those titles must be copied. Jack appears in every role
  today: give his title's code to each role (or put his email in each
  role's extra emails).
- Every tech in the roster (`service_call_journey/reference/tech roster`)
  needs a directory row with that SP code (Vince: VWJ, with VJ as an alias
  on his route settings) and a job title — the field tool finds the route
  by the directory code.
- The labor sanity checks and component-price checks can run once the
  catalogue is on production (it is, as of 9/23).
