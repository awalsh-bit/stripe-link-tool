# Wilson AC & Appliance — Service Order Journey: Target-State Blueprint

Version 0.12 · September 14, 2026 (replay adjustments; service-team feedback from the 9/11 demo folded in — §13 and the ⟨9/11⟩ marks; **9/14: placement against the real route, the SO4 auto-pencil, route-first dates for customers, and the shadow test instance that replaces the AJH pilot — §6a and §11a, marked ⟨9/14⟩**) · Prepared for Cayden Mayfield and the dashboard dev team

## 1. What this document is

This is the working spec for moving the service repair workflow — from the customer's first contact to the final card charge — into the Wilson dashboard, with the dashboard as the source of truth and ePASS kept in step by a background reconciliation tool until NetSuite arrives with a two-way API. It covers the target flow, the status engine, the automation rules that replace today's manual report-pulling, the capacity and route builder, the customer portal and self-scheduling, notifications, the ePASS mirroring strategy, a data model, and a phased rollout.

Design principles that drove every decision below:

1. **Status changes are earned, not typed.** In the target state, almost no status is set by a person picking from a dropdown. Statuses move because an event happened (customer clicked approve, PO was placed, part was received, tech tapped "complete").
2. **Every hand-off today is a report someone remembers to run.** SO2 → parts manager, SO2.1 → Noell, SO3 → parts manager, SO5 → dispatcher. Each of those becomes a live work queue that fills itself, and most of them shrink to a review step or disappear.
3. **The customer should be able to answer their own question.** "Where's my part?" and "When are you coming?" become a page, not a phone call.
4. **Capacity is data.** Tech zones, shift hours, start/end points, job durations, and parts ETAs are all inputs; the route is an output the dispatcher supervises rather than builds.
5. **ePASS stays correct without anyone hunting.** The dashboard generates the list of exactly what needs to be keyed into ePASS and confirms it happened from the next export.

## 2. Current state (as described and as seen in the screenshots)

| Step | Who | Tool today | Friction |
|---|---|---|---|
| Customer calls/texts, is sent to the web form | Client Care | Phone → web form | The call itself is the waste; form already collects what ePASS needs plus a card on file |
| Form lands in Service Requests queue; ticket keyed into ePASS; ERP # and "TICKET MADE. MSD" typed back | Michael Davidson | Dashboard + ePASS | Double entry, status set by hand ("Call Status Pending" → "Call Scheduled") |
| Scheduler picks date by maps + capacity feel | Dispatcher | ePASS Routing (tech tree, 2-pane day view) | Human optimisation, no customer choice |
| Tech runs diag, moves on; writes notes *next morning*, adds parts/labor, sets SO2 | Tech | ePASS | 12–24 h dead time before anything can happen |
| Parts manager runs SO2 report, price-checks every part, sets SO2.1 | Parts | ePASS report | Daily report pull; prices change daily so it has to be re-done if quote sits |
| Noell runs SO2.1 report, exports quote PDF, uploads to Estimate Approvals tool, emails/texts link | CX (Noell) | ePASS → PDF → Dashboard | PDF scan is a workaround for data that already exists as line items; two report pulls between tech and customer |
| Customer approves / shops via link | Customer | Dashboard estimate page | Works well — keep |
| Approved → Noell sets SO3 (warranty goes SO1 → SO3 directly) | Noell | ePASS | Manual status flip after a digital event |
| Parts manager runs SO3 report, builds POs, orders, sets SO4 | Parts | ePASS report + supplier sites | Daily report pull; ETA not captured in a usable field |
| SO4 tickets parked on "next Saturday" as a dump day | Dispatcher | ePASS routing | Fake dates pollute the calendar (Service Order Health shows 95% of open tickets have dates in the past) |
| Parts arrive → dispatcher pulls SO5, marries installs with routed SO1s, confirms → SO6 | Dispatcher | ePASS | Manual matching; customer called for a date |
| SO4PRE: customer given a firm date before part arrives; jumps to SO6 when part lands | Dispatcher | ePASS | Good idea, manual to track |
| Tech installs, ticket → SO8; Noell charges card, closes in ePASS | Tech, Noell | ePASS + Stripe | Card and approval already exist — charge is a manual last mile |

Screens already in the dashboard that this plan builds on: **Appliance Repair Request Form** (intake + Stripe SetupIntent), **Service Requests queue** (status, ERP #, notes, card status, field damage reports), **Service Estimate Approvals** (quote link, approve/shop, reminders, parts ETA text), and **Service Order Health** (ExportInvoice import matched to queue by ERP order number — this is the seed of the reconciliation engine).

Status codes in use today (from the ePASS list): QUOTE, SI1–SI9 and SI-TEST (in-shop), SO1, SO1.AUTH, SO2, SO2.1, SO2.2, SO3, SO3PRE, SO4, SO4B, SO4H, SO4PRE, SO5, SO6, SO7, SO8, SO8I, SO9, plus WAR3/WAR4/WARADMIN/WARPART/WARPROBLEM on the warranty side and CPU2.

## 3. Target-state flow (one job, start to finish)

```
Customer                Dashboard (source of truth)                 Staff touch            ePASS mirror
────────                ───────────────────────────                 ───────────            ────────────
Submits form  ───────▶  Job created · zone from zip · card saved
Picks SO1 window ─────▶ Tentative appointment on capacity engine     —                      Sync item: create ticket, set SO1 + date
                        Warranty? → flag, skip quote path
                        Confirmation text/email + portal link
                        Route builder places job on a truck           Dispatcher glances
Day before: reminder ◀─ Auto-notify (window + tech name)
Tech en route text   ◀─ Tech taps "On my way" in tech view
                        Tech completes diag ON SITE in tech view:
                        notes, photos, parts, labor → SO2             Tech (on phone)         Sync: SO2 + notes
                        Parts Verify queue: price check → SO2.1       Parts mgr (review)      Sync: SO2.1
                        Quote auto-built from lines, auto-sent by
Gets quote link      ◀─ contact preference → SO2.2                    — (Noell reviews only   Sync: SO2.2
                                                                        flagged quotes)
Approves ─────────────▶ SO3 automatically. Declines → SO7 + sales
                        lead (existing Shopping flow)                  —                       Sync: SO3 / SO7
                        Warranty jobs: SO1 → SO3 when tech submits parts
                        Parts Order queue → PO builder → PO placed
                        with supplier ETA → SO4 (SO4B if backordered)  Parts mgr               Sync: SO4 + ETA
Sees ETA in portal   ◀─ "Parts ordered, expected Sep 18"
Optionally picks     ──▶ SO4PRE with date held on capacity engine
install window now
                        Receiving: scan/check-in part → SO5            Parts mgr / warehouse   Sync: SO5
Gets "part is in,    ◀─ Auto-offer install windows (SO4PRE: auto-
pick a time" text        confirm held date if part arrived in time)
Picks window ─────────▶ SO6 · route builder places install next to
                        nearby SO1s                                   Dispatcher supervises   Sync: SO6 + date
Reminder / en route  ◀─ Auto
                        Tech taps "Repair complete" → SO8              Tech                    Sync: SO8
                        Auto-charge card for approved remaining
                        balance → receipt → job closed                Noell reviews exceptions Sync: payment posted
Receipt + review ask ◀─
```

Where a human is still in the loop, it is a **review** of something the system already did, not a data-entry step. The exception list is deliberately short: parts manager verifies prices and places POs, dispatcher supervises the board, Noell handles quote and payment exceptions, and until NetSuite someone works the ePASS sync list.

## 4. Status engine

Keep the ePASS codes as the canonical status vocabulary so the mirror is one-to-one, but attach the trigger, the customer-facing stage, and who can move it.

| Status | Meaning | Entered by (target) | Exit trigger | Customer tracker stage |
|---|---|---|---|---|
| **REQ** *(dashboard only)* | Form submitted, no appointment yet | Form | Customer or staff picks window | Request received |
| **SO1** | Diagnostic scheduled | Customer picks window / dispatcher | Tech submits diag | Diagnostic scheduled |
| **SO1.AUTH** | New call awaiting authorization (e.g. landlord/PM approval, no card yet) | Rule: card not saved or PM checkbox ticked with no auth | Auth received | Waiting on authorization |
| **SO2** | Tech quote submitted, unverified | Tech view "Submit findings" | Parts manager verifies | Diagnosed — preparing estimate |
| **SO2.1** | Prices verified | Parts Verify queue "Verified" | Auto quote build (instant) | Diagnosed — preparing estimate |
| **SO2.2** | Quote sent, awaiting approval | Auto-send | Customer approves/declines; auto-reminders at 48h/5d | Estimate ready — awaiting your approval |
| **SO3** | Approved (or warranty) — order parts | Customer approve click; warranty rule | PO placed | Approved — ordering parts |
| **SO3PRE** | Pre-schedule parts (order before approval, high-confidence fixes) | Parts manager override | PO placed | Approved — ordering parts |
| **SO4** | Parts on order | PO placed, ETA captured | Part received | Parts ordered — arriving ~date |
| **SO4B** | Backordered | Supplier ETA > threshold or backorder flag | Part received / re-source | Parts delayed — new estimate date |
| **SO4H** | Parts shipped direct to customer | PO ship-to = customer | Customer confirms delivery (portal button) or tracking delivered | Part shipping to you |
| **SO4PRE** | Install date held, part not here yet | Customer/dispatcher picks date while SO4 | Part received → auto SO6 (if ETA ≤ date−1) else re-offer | Install scheduled — awaiting part |
| **SO5** | Parts in, needs scheduling | Receiving | Customer picks window / dispatcher | Part arrived — pick your install time |
| **SO6** | Install scheduled | Window confirmed | Tech completes | Install scheduled |
| **SO7** | Customer declined repair | Decline click / no response after N days | Sales lead created | Estimate declined |
| **SO8 / SO8I** | Complete (SO8I = WACA install) | Tech "Repair complete" | Auto-charge success → Closed | Repair complete |
| **SO9** | Cancelled | Customer cancel / staff | — | Cancelled |
| **SI1–SI9** | In-shop path | Same engine, no routing; uses shop drop-off/pickup windows | — | Mirrors SO stages with "at our shop" wording |
| **WAR\*** | Warranty admin statuses | Kept as a parallel track; SO1 → SO3 skip rule; claims handled by warranty admin queue | — | Same stages; no estimate stage |

Rules the engine enforces:

- A job in SO4/SO4B/SO4H/SO4PRE/SO5 never has a fake routing date. "Saturday dump day" is replaced by an **Unscheduled** bucket on the board. Every job carries a *promised window* (customer-facing) and a *planned slot* (internal) as separate fields.
- Timestamps are recorded on every transition, with actor (customer / tech / staff name / system). This alone gives you cycle-time per stage, which you cannot get from ePASS today.
- Any status a human sets manually requires a reason code, so the automation gaps become visible.
- Aging thresholds per status (e.g. SO2 > 24 h, SO2.2 > 5 days, SO4 past ETA + 2 days, SO5 > 2 days) surface on a **Stuck Jobs** panel — this replaces the "dates in the past" metric on Service Order Health with something actionable.

## 5. Automation rules, step by step

### 5.1 Intake and SO1 self-scheduling

- Form submission creates the Job with units, contact preference, gate code, photos, and card SetupIntent (already done). New: zip → zone lookup → eligible techs; skill filter (HVAC vs appliance, brand certifications, built-in/plumbed coffee, etc.); job type → default duration (diagnostic 60 min, HVAC diagnostic 90 min, multi-unit +30 min each — tunable table).
- After card save, the customer is shown **the next 5–7 available arrival windows** from the capacity engine (see §6) and picks one. Windows are half-day (8–12 / 12–5) by default with an option to offer 2-hour windows later once the engine's accuracy is proven.
- "Purchased within 12 months = Yes" + purchased from us = Yes → warranty flag; the card is still saved but the customer sees "no charge expected for covered repairs" wording and the job later skips SO2–SO2.2.
- Landlord / property-manager checkboxes with no card → SO1.AUTH and a text to the authorizer with a secure card link (the "Copy secure card link" already exists).
- If the customer doesn't pick a window (abandons), the job sits in REQ and Client Care gets a callback task with the same window picker — one click to book.
- ePASS sync item generated: "Create SV ticket for Herzog · SO1 · 9/14 AM · tech Diogo". Staff keys it, enters the SV# (or NetSuite does it automatically later).

### 5.2 Diagnostic and tech submission (kills the next-morning write-up)

- Field tool decisions (9/11): techs use their own phones on a stipend, so this is a **mobile web app**, not an installable app; it replaces Dispatch Track over time (photos and notes move here). It should replicate the maintenance field tool Wilson already built, which Cayden will share. From day one it records **arrive / complete taps** per stop so job durations and tech speed are learned from real data — ePASS has no on-site time history.

- Tech view on phone: today's route in order, one tap "On my way" (sends the customer a text with ETA), job card with the customer's problem text, photos, model/serial, gate code, prior history at that address.
- "Submit findings" form: findings notes (voice-to-text), photos, parts (search by part number, description; pulls last known price), labor entries, flags (cosmetic damage report already exists — fold it in), recommend replace vs repair, "no parts needed — completed on site" shortcut (→ SO8 directly with a diag/labor charge).
- Submission → SO2 instantly, same visit. Parts Verify queue gets the job while the tech is driving to the next call.
- If the tech genuinely can't finish the write-up on site, the job shows on their **Unsubmitted findings** list and nags at 6 pm and 7 am.
- ⟨9/11⟩ Three things the techs asked for at the demo, all in the findings screen: tapping the **Error code** symptom prompts for the code as displayed on the unit (short typed field — one of two deliberate typing exceptions); the labor picker has **Half day · 4h** and **Full day · 8h** chips at the top for sealed-system and other long jobs, which also block that much of the tech's capacity for the install; and *What you found* has a **Custom note** button that opens a text box (voice-to-text friendly) when the tap options don't describe it. The custom note lives on the dashboard job; at most 200 characters of it ever reach an ePASS packet.
- ⟨9/11⟩ **The tech's number, live.** Techs are on commission on parts profit plus labor — the weekly figure from the OE-23 report. The route screen header shows *Today $X · This week $Y · pace $Z/wk* against the tech's weekly target (or their own four-week average when no target is set), ticking up as each stop is completed: labor including the diagnostic and zone fees, plus parts sell minus cost (zero on warranty tickets, where parts are a wash). It's provisional at the tap and reconciled against the closed invoice overnight; nothing about other techs is shown. Office sees the same numbers per route on the board and department totals in a Productivity drawer.

**Where notes live (decided 9/11).** Findings, photos, parts and labor are entered once, in the field tool, and live on the dashboard Service Order. Techs never open ePASS again. Until NetSuite, ePASS still needs two things for invoicing and for the report exports the rest of the shop relies on: the **status** and the **billable lines** (parts, labor, S&H). Those are keyed by the office from the Sync Queue (§9), which renders each job as a ready-to-paste packet: status, one-paragraph auto-summary of the findings (outcome · symptoms · cause · tech's note), and the line items with part numbers, quantities and verified prices. The full notes and photos are referenced by a one-line pointer ("Full findings + 4 photos: dashboard SV00123290") rather than copied. Nobody re-types tech prose.

**New tech workflow, stop by stop.** Open today's route → tap *On my way* (customer texted with ETA) → arrive (timestamp) → job card shows the customer's own problem description and photos, unit, gate code, balance to collect → on a new diagnostic: serial-tag photo (required, fills model/serial), tap an *Outcome*, tap symptoms and cause, tap parts from the appliance's common-parts list or search, tap labor, optional fault photo, one optional note (required only for research / declined / not-worth-repairing / could-not-access outcomes) → *Submit findings* moves the job to SO2 (or SO8 for repaired-on-site, SO7 for declined/replace) and records on-site minutes → back to route, next stop suggested. On an install: parts on the truck are listed with Installed / Wrong / Damaged per line, the serial tag is shown from the diagnostic and not re-required, outcome is one tap (complete → SO8 and the card is charged; additional parts → SO2; wrong/damaged part → SO3 reorder; problem persists → SO1 research), optional finished-work photo, note required for anything but complete. Nothing on this screen requires typing except the note.

### 5.2a Field quoting (decided 9/11 — the default path going forward)

The diagnostic fee covers about an hour of work. If the tech can fix it inside that hour with no parts, it's a quick fix: tap *Quick fix within the diag hour* → SO8, diagnostic fee billed. Anything that needs parts or disassembly beyond that gets a quote, and the tech builds it **on the phone, in the driveway**, from the same flat-rate tasks and parts catalog the office uses:

- **Labor** is picked from the flat-rate task list for that appliance family (most common first, searchable; access-fee and extra-tech modifiers as chips). Price is hours × rate — no typing.
- **Parts** come from the catalog with the last verified price and its date. The parts manager still re-verifies before ordering. **Re-approval rule (percentage-based, decided 9/11):** if the verified parts total comes in **more than 10% above** the field-quoted parts total, or any single part more than 10% above its field price *and* more than $10, the customer is texted the revised total and must re-approve before the order is placed; anything under that just proceeds and the receipt shows the actual price. Decreases apply automatically and the customer is told the total went down. A percentage catches the $5-sensor-that-should-be-$25 case; the $10 floor stops re-approvals over a $0.60 swing on a $6 part. The field tool also shows price age and flags any part not verified in the last 30 days.
- **Totals** show diagnostic *included*, labor, parts, S&H, tax, and the amount that will be charged to the card on file, with the plain-language rule under it ("charged after the part is installed and the unit is tested; if declined, the $169.95 diagnostic is charged instead").
- **Customer decision** is one tap: *Approves now* → the customer reads the authorization text, ticks agreement, and **signs on the tech's phone**; the signature image and text are stored on the Service Order and attached to the receipt. With parts → **SO3** directly (skipping SO2/2.1/2.2), flagged "field-approved" so parts verify is a reconciliation, not a gate. Labor-only → tech starts work now → *Repair complete* → **SO8** and the card is charged. *Wants to think about it* → SO2.2 with the link texted (the office path). *Declines* → SO7, diagnostic fee charged.
- The office quote path (SO2 → verify → auto-send) stays for jobs where the customer isn't home, the tech can't price a part, or research is needed.

### 5.3 Parts verification → automatic quote

- Parts Verify queue shows each new SO2 with tech's parts, last verified price, and days since verification. Parts manager confirms or edits each price and availability (in stock / supplier ETA / backorder) and hits **Verified** → SO2.1.
- Where a supplier offers pricing/availability lookup (Marcone, Reliable, Encompass and similar have APIs or dealer portals), pre-fill so verification is a glance. Prices verified within the last 7 days on the same part number are auto-accepted (tunable).
- SO2.1 → the estimate is built from the structured lines — no PDF scanning. The existing client estimate page is reused as-is (parts with numbers and descriptions, labor, S&H, tax, diag deposit already paid, remaining). The Parts ETA text is generated from the verified availability plus the capacity engine's next install slots.
- Auto-send by the customer's stated contact preference (Text / Email / Phone Call → for "Phone Call" preference, the quote is still sent by text or email *and* a call task is created for Noell). Status → SO2.2. Noell's role becomes reviewing a **Needs review** subset: quotes over a dollar threshold, quotes with zero-priced lines, repair cost > X% of replacement value, or any quote the tech flagged.
- Reminders: automatic at 48 h and 5 days (the buttons exist; make them scheduled). After 10 days with no response → task for Noell to call; after 14 → SO7 with "no response" reason and a sales lead.

### 5.4 Approval → parts order → parts arrival

- Approve click → SO3 (no human). Shopping/decline → SO7 + showroom lead (existing behaviour).
- Warranty jobs: tech "Submit findings" → SO3 directly, with the warranty admin queue notified for claim filing (WAR statuses continue on their own track).
- **Parts Order queue**: all SO3/SO3PRE lines grouped by supplier. PO builder creates the PO, produces the supplier order sheet in the supplier's format (the "supplier order form / website match" step becomes an export), and records PO #, order date, expected ship/arrival date, and ship-to (shop vs customer). Placing the PO → SO4 (or SO4H for direct-ship, SO4B if the supplier ETA exceeds the backorder threshold).
- Expected arrival date drives everything downstream: the customer's tracker, the promised window offered at SO4PRE, and the route builder's look-ahead.
- **Receiving**: check-in by PO/part number or barcode scan at the parts counter → SO5 for every job whose parts are all in (partial arrivals stay SO4 with a "2 of 3 received" indicator). Optional: tracking-number polling to move to "arriving today".
- SO5 → the customer immediately gets "Your part is in — pick an install time" with the same window picker, constrained to **the tech who ran the diagnostic** (call ownership) and to the install duration from the labor lines. Confirm → SO6. Unpicked after 2 days → dispatcher/Client Care callback task with the picker.
- SO4PRE handling: customer may hold a date while parts are on order (portal shows both "part expected Sep 16" and "install held Sep 18"). Part received ≥ 1 day before the held date → auto SO6 and a confirmation text. Part slips past the held date → automatic "we need to move your appointment" with new windows offered, and a Stuck Jobs flag.
- ⟨9/11⟩ **The two-day-out check, as the team described it.** Two business days before a held date, if the parts aren't all checked in, Kezia (parts/receiving) gets a task: *check ETA for SV… held Thursday* with three buttons — **Part is here** (receive it, the hold confirms), **New ETA** (recorded; if it's past the held date the hold is released now), **Wait**. If nothing has changed by 2 pm the day before, the system releases the hold itself: the job goes back to SO4 (ePASS "time out"), Demitrius's route loses the stop, and the customer gets an apology text with the new expected date and a link to pick a fresh install time once the part is in. The 2-day auto-confirm text never goes out for a hold that is at risk.
- ⟨9/11⟩ **Direct-ship parts (SO4H — GE and others ship to the customer).** The tracker shows *Your part is shipping straight to you* with a **My part arrived** button; tapping it moves the job to SO5 and opens the install picker with the owning tech's windows. If nobody taps by the day after the expected date, a check-in text asks. A carrier-tracking webhook can fire the same event later.

### 5.5 Completion and payment

- Tech "Repair complete" → SO8 (or SO8I). Photos of completed work optional; "additional parts needed" branch → back to SO2 with the new lines (the second-visit quote path).
- Billing rule (confirmed by Cayden 9/11): **nothing is charged at the diagnostic visit.** If the customer approves, the diagnostic is rolled into the quote and the full approved total is charged once the tech marks the repair complete per their notes (SO8). If the customer declines or goes silent to SO7, the $169.95 diagnostic fee is charged to the card on file at that moment, with a receipt.
- Auto-charge rule at SO8: charge the card on file for the **approved estimate total**. Charge exactly matches an approved amount → post payment, send receipt with the itemized lines and a review link, mark Closed. Anything else (tech changed lines, discount applied, warranty portion, partial completion) → **Payment review** queue for Noell. Failed charge → retry schedule + text with a secure pay link.
- Sync item: "Post payment $375.22 to SV00123265 and close" until NetSuite does it.

### 5.6 The flat-rate book: what's actually in it and how to restructure it

The 2025.6.21 ePASS import has **13,646 labor lines**, but they collapse to **~460 distinct tasks** (about 750 task × family combinations) repeated across **64 brand suffixes**. Findings from the file:

- Price is simply **time allowance × hourly rate** ($130 appliance, $150 HVAC) in 13,621 of 13,646 rows. There is no independent price data to preserve.
- The "Premium / Standard" rate type is tied to brand but **does not change the price** — both are $130/hr. It's a label, not a rate.
- The time allowance **varies by brand for only 46 of ~750 task-family combinations**, and in nearly every case it's a single-brand outlier (28 brands at 0.75 h, one at 1 h), which looks like data drift rather than a deliberate difficulty judgement. The real difficulty differences are already encoded in the task *names* ("Hidden (Double Oven) — Two Technicians" vs "(Exposed)", "Pro Range" vs "Standard Range", "Front Service" vs "Rear Service", "Built-in" vs "Freestanding").
- There are duplicate tasks differing only by typo or wording (two "Belt Replacement" rows, two LP conversion rows, four near-identical sealed-system compressor rows, two door-gasket wording variants).

Proposed structure (dashboard-native, exported to ePASS/NetSuite codes on demand):

1. **Task catalog** (~450 rows after de-duplication): family, task name, base hours, tags (pro, hidden, built-in, two-tech, sealed-system), and a customer-facing plain-English description.
2. **Modifiers** as separate lines, not baked into the task: difficult access (+0.5 h), stacked/built-in access (+0.35 h), additional tech (+0.5 h), second component (+0.5 h). The book already has these as tasks; making them modifiers removes hundreds of "(Pro Range)" / "(Standard Range)" duplicates.
3. **Rate table**: one hourly rate per department (appliance, HVAC, in-shop), editable without touching tasks. A **brand factor** table (brand × family → multiplier, default 1.0) exists for the genuine cases where a brand really is harder — used sparingly and justified, so the 64-way duplication disappears while the ability to charge more for a Sub-Zero sealed system survives.
4. **Learned times**: because the field tool records arrive/complete per job and the quote records which tasks were sold, the dashboard can show actual vs allowed hours per task per tech. That turns the rate book from a guess into a measured table and is what eventually justifies (or removes) brand factors.
5. **Tax flag from the unit, not the brand.** Texas rule as Wilson applies it: labor is taxable unless the work is on the home itself, so labor on built-in appliances and HVAC is tax-exempt; parts, diagnostic and zone fees are always taxed. The rate book's "Tax 2" column already encodes this, but by *brand*: whole families are N (dishwashers, vent hoods, ice makers, coffee, wall ovens, warming drawers, cooktops, AC) or Y (washers, dryers), and the mixed families — refrigeration, ranges, microwaves, grills — flip to N only for brands assumed to be built-in (Sub-Zero, Miele, Gaggenau, Thermador, Monogram, BlueStar, True). That taxes a Bosch built-in column and exempts a Miele freestanding fridge. In the catalog the taxable flag comes from the **unit's install type** (built-in / freestanding, which the intake form and tech's serial-tag step already capture) plus a family default, and the field quote shows parts tax and labor tax as separate lines with "exempt · built-in" when it applies.
6. **Export**: the ePASS-ready sheet (code-BRAND, description, price) is generated from the catalog whenever it's needed, so ePASS keeps importing exactly what it imports today and nobody maintains 13,646 rows by hand.

## 6. Capacity engine and route builder

### 6.1 Inputs (all tables editable in the dashboard, no code changes)

- **Techs** (real roster in `reference/tech_roster.csv`, confirmed 9/11): DLA Diogo (Dripping Springs, shop→shop), AJH Andrew (Dripping Springs, ends at shop), TDP Trevor (Wimberley, HVAC backup by office decision only), JRC Josh (South Austin, routes to/from home), KJB Kyle (Kyle TX, home→home), CIT Chris (Lakeway 78734), CEM Connor (New Braunfels, master tech, west/far-south overflow), BLL Brady (New Braunfels, the HVAC tech). All techs are sealed-system qualified. Three people are **not auto-routed and not customer-schedulable**: JHM John Merz (near Fredericksburg, builds his own west route, not on commission — the office assigns him work), MAP Mark Perks (service manager — fires, training, Demitrius-only), VJ Vince Jones (HVAC sales — office routes his handful of odd HVAC jobs). Each tech record carries home address, start/end default, shift, skills, `auto_route` and `auto_schedule` flags, max stops/day and **working days** ⟨9/11⟩ (Josh JRC works Mon–Thu and runs more calls on those days; his Friday is closed by default and Demitrius opens a specific Friday with one click when management wants it).
- ⟨9/11⟩ **Capacity is the dispatcher's to bend, quickly.** Cayden's rule from the demo: anything capacity-related has to be quick and easy from the capacity view. Clicking a tech-day cell on the fill strip opens a small popover — *Close day* (PTO, sick, training, other), *Open day* (a normally closed day), *+1 stop / +60 min / −60 min*, *Add block…* for time that isn't a call (haircut, van maintenance, training). Dragging across cells sets a PTO range. Dropping a job on a full column shows *Over capacity* with a **Force it** button — one click, no reason code, just logged with who did it — and the column shows the overage in red rather than refusing the drop. Blocks show as grey cards on the board and in the tech's route, count against capacity, and never go to ePASS.
- **Zones**: use ePASS's existing `Map Zone` codes (DS, LOCAL, AUS C, WIMB, FBURG …) — they are on every ticket and every DispatchTrack row. `reference/zone_table.csv` gives each zone its group, booking mode, distance from shop and primary/secondary tech derived from 2026 completions (e.g. AUS C → JRC, WIMB → KJB, BCAVE/SPICE/LAKE → TDP, DS/LOCAL → DLA with AJH/CIT/CEM secondary); `reference/zip_zone_tech.csv` maps 79 zips the same way. New-request zips resolve to a zone through that table; an unknown zip falls to `office_only`.
- **Job duration model**: seeded by job type and status, then calibrated from the field tool's arrive/complete taps per appliance category and per tech (tech speed factor) — (SO1 diag by appliance category; SO6 install from labor lines; multi-unit adders), with a learned correction from actual on-site times once the tech view records arrive/complete taps.
- **Drive time**: Google Maps Distance Matrix / Routes API (or Mapbox) with departure-time traffic; cached per address pair per time bucket to control cost.
- **Constraints**: promised window must be honoured; skills must match; **the tech who ran the diagnostic owns the call** — every later visit (SO6 install, SO4PRE hold, revisits) is offered and routed only to that tech, and the board flags any attempt to move it to another truck. If the owner is out, the install waits (it is rare for a tech to miss more than a week); past roughly a week Demitrius reassigns manually with a reason code, and the customer is told by text either way; parts must be in (SO6) or in-transit with ETA before date (SO4PRE); customer blackout notes; tech lunch; hard-locked jobs (dispatcher pin).
- **Objective** (weighted, tunable): minimise total drive time; maximise jobs completed; keep techs in primary zone;  balance load across trucks; end-of-day return preference; penalise slack.

### 6.2 How slots are offered to customers

The engine keeps a rolling 10–14 day **capacity ledger** per tech per day: committed minutes (jobs + estimated drive) vs available minutes. A window is offered to a customer when at least one eligible tech in that zone has room in that half-day *after* accounting for a conservative drive estimate from the zone centroid. Booking creates a tentative assignment. Nightly (and on every change), the optimiser re-solves the next N days holding every promised window fixed but freely reassigning techs and sequence — so customer promises never move, but the route keeps improving as new jobs arrive. Offer fewer windows on days that are already dense so the customer is nudged toward where you have room.

**Owed installs count against diagnostic capacity.** Because the diagnosing tech owns the call, every job a tech has in SO2–SO5 is an install that tech will have to run in roughly 7–14 days. The ledger therefore carries two lines per tech per day: *committed* (booked SO1/SO6 minutes plus drive) and *owed* (the tech's open SO2–SO5 jobs, spread across the days their parts ETAs point to, at the install duration from the quote lines). New SO1 windows are offered only where committed + owed leaves room, so a tech who runs a heavy diagnostic week is automatically offered fewer new diagnostics the following week instead of ending up with installs nobody can fit. The board's fill strip shows owed minutes as a hatched segment so the dispatcher can see it coming; a tunable *owed-conversion rate* (share of SO2.2 quotes that historically get approved, per tech or company-wide) keeps unapproved quotes from over-reserving.

### 6.3 Zone groups, booking modes and trip consolidation

Every zone belongs to a group with a **booking mode** (the "customer qualification by zip" Cayden asked for):

| Group | Zones | Booking mode | Cadence |
|---|---|---|---|
| Core Hill Country | DS, SHOP, DRIFT, LOCAL, OAKHL, HENLY | `open` | daily |
| Austin Metro | AUS C/W/S/N/E, LOST, BCAVE, LAKE, SPICE, R2222 | `open` | daily |
| South Corridor | WIMB, KYLE, BUDA, SANMA | `open` | daily (KJB from Kyle) |
| Northwest Lakes | HORSE, MFALL, LLANO, ROUND | `designated_days` | trips form on volume/age; TDP |
| West | JC, BLANC, STONE, FBURG, BOERN | `designated_days` | trips form on volume/age (~weekly at today's volume); JHM |
| Far South | BRAUN, CANYO, FISCH | `designated_days` | trips form on volume/age; CEM/KJB/BLL from the NB/Kyle side |
| Out of area / North | KERR, OUT, SA, CEDAR, GEORG, NOR E | `office_only` | office decides |

`open`: the customer sees normal windows. `designated_days`: the customer is told visits in their area are grouped and sees only an **open trip date** for that group once one exists. `office_only`: the form says "we'll call you within one business day" and drops a Client Care task; nothing is auto-scheduled.

**Trip consolidation (corrected 9/11: there are no standing days).** The Wednesday west pattern in the data is Demitrius's habit and John's schedule, not a rule. What Wilson actually coaches is: *don't run one San Antonio call and four local calls in a day; group the far ones so the day pays.* The engine recreates that judgement instead of a calendar:

1. Every `designated_days` group has a **trip bucket**. A request from the group lands in the bucket, not on a route. The customer sees: "We group visits in your area so we can get to you efficiently — we'll text you a date within a few days. Need it sooner? Message Client Care." (Warranty and parts-in installs enter the same bucket.)
2. The engine **proposes a trip** when any of these is true: the bucket's on-site time reaches a profitability floor (default: enough stops that drive time is under ~45% of the day — for FBURG that's about 4 stops; tunable per group); the oldest request is older than **5 business days**; or an SO5 install in the bucket is aging past 3 days. It picks the day by looking at the trip tech's next 10 days (JHM for West, TDP for Lakes, CEM for Far South, or any tech with a home on that side) and choosing the day that displaces the least local work, then **Demitrius confirms or moves it**. That confirmation is the human touch; nothing goes to customers until he taps it.
3. On confirmation every customer in the bucket gets the date by text with a one-tap confirm; anyone who can't make it stays in the bucket for the next trip. New requests arriving after a trip is open are offered that trip's date first if it still has room, so the trip fills itself.
4. The trip tech's route that day is **bookended with local work** in the direction of travel (e.g. DS → JC → BLANC → FBURG and back through JC), and the optimiser treats the trip as one block with a fixed date rather than movable stops.
5. A **profitability guard** on every route, trip or not: if a day's **inter-stop** drive per stop exceeds 35 minutes (commute legs shown separately, confirmed trips exempt) or a single stop adds more than 60 minutes of out-and-back drive on its own, the board flags the column and the drop toast says so. That is the coaching rule made visible — it catches the lone San Antonio call before it costs a day.
6. `office_only` zones (KERR, SA, OUT and unknown zips) never auto-bucket; they create a Client Care task and the office decides whether to attach them to a trip.
7. John's work: his trips are built by the office and sequenced by him; the optimiser never moves his stops; the field tool gives him on-my-way, findings and field quotes like everyone else.
8. Core and Metro stay daily; the optimiser's zone objective keeps techs in their primary zones and treats a cross-zone stop as a cost, not a rule.

### 6.4 Parts pickup and the shop touch

Every tech picks parts up at the shop, so an install stop is only feasible if the part is on the truck. Modelled as a per-tech-day **"parts loaded" event**:

- A tech-day with any SO6/SO4PRE stop needs a shop touch **before the first install stop**. The route builder inserts the shop as a stop (with a fixed 10-minute dwell) and sequences installs after it.
- Techs who end at the shop (AJH, DLA, TDP on shop-end days, CIT) can **load tomorrow's parts tonight**: the parts manager stages each tech's next-day parts in their bin by 3 pm from the board's next-day route; the tech taps *Loaded for tomorrow* in the field tool at end of day, which flips the "parts loaded" flag for the next day and lets installs sit anywhere in the route, including a home-side install first thing.
- Techs who start from home (JRC, KJB, CEM, BLL) get **wave logic**: Wave 1 is diagnostics between home and the shop (only SO1s, or installs whose parts were loaded the previous evening); shop touch; Wave 2 is everything else, working outward and back to the end point. If a tech has no installs that day, no shop touch is required.
- Simplest fallback, available as a per-tech setting: **"always start at the shop"** — the builder then works away from the shop and back. Cayden is fine with this as the default; the wave logic is the optimisation on top.
- The receiving step (§5.4) writes the bin location (ePASS `Location` field SV02–SV10 / HVAC1 today) to the job, and the field tool's route card shows "Bin SV07" beside each install so pickup is a glance.
- Guard rail: if a customer picks an install window on a day where the owning tech's route can't include a shop touch before it (e.g. a JRC home-side 8 am install without prior-evening loading), the picker simply doesn't offer that window.

### 6.5 Dispatcher board

- **Two-truck view kept** as requested: two side-by-side columns, defaulting to the same tech on consecutive days (Diogo Sep 14 next to Diogo Sep 15), with either column switchable to any tech or date. A full-week fill strip sits above the columns. Drag a job between columns to reassign tech and/or date; the engine re-validates instantly (skill, zone, window, parts ETA) and shows the drive-time delta before you drop. A third strip along the bottom or side is the **Unscheduled** bucket (SO5 waiting on customer, REQ abandoned, SO4PRE holds).
- Each column: sequenced stops with arrival estimates, job status colour, balance flags (COD / A/R overdue — these matter to the tech), parts-in indicator, a mini map. Header shows committed vs capacity, total drive, return-to-base time.
- Locks: dispatcher can pin a job to a tech/sequence; the optimiser respects pins. "Re-optimise this day" and "Accept suggested changes" buttons rather than the engine moving things silently during the day.
- A day/week heat strip above shows fill % per tech per day so the dispatcher sees where to steer customer picks or open capacity.
- Output to ePASS until NetSuite: a per-tech daily route export that mirrors what Routing shows today, plus sync items for date/tech changes.
- ⟨9/11⟩ From the team's demo feedback: a **tech's name is a link** everywhere it appears (column header, fill strip, map legend) to a one-page **route overview** for that tech-day — stops in order with ETAs, the drive legs between them, blocks, that tech's map, dollars delivered so far and alerts; the **map legend** has a toggle per tech so one truck can be shown or hidden; the day-of-week dropdown becomes a **month calendar** tinted by fill, closed days hatched, trips marked, so picking a day is point-and-click; each column's footer shows **delivered dollars** for that route (recognised and projected) and a **Productivity** drawer at the bottom shows the department's day, week and month per tech.

## 6a. Placement: where a call lands, and the SO4 pencil ⟨9/14⟩

Three requests from Cayden on 9/14 turn out to be one mechanism. Every time the dashboard has to decide *where a call should go* — the dispatcher's suggestion on an Unscheduled card, the day an SO4 is penciled onto once the part has an ETA, the order of dates a customer sees — it asks the same question of the route ePASS actually shows: **which tech-day can absorb this stop for the least extra driving, without making the customer wait much longer?**

- The score is in minutes: the extra drive to slot the stop into that day's existing route, minus a credit for every stop already in the same zone, plus a small cost for each business day of waiting (cheap for the first two days, steep after — so a Round Rock request goes onto the Round Rock day two days out rather than an empty truck tomorrow, but nobody is pushed a week for our convenience), plus a penalty when the tech is not that zone's usual one. Every suggestion carries its reason in plain words: *Diogo already has 3 stops in LOCAL that day · +6 min drive · primary tech*.
- **Unscheduled cards** show the suggested day and a *Place there* button; the dispatcher stays in charge and the suggestion is just the engine's opening bid — and, in the shadow test (§11a), what we grade the engine on.
- **The SO4 pencil.** When Kezia keys the part's expected date and the customer has approved (the call is SO4 in ePASS), the engine pencils the install onto the owning tech's best-fit day two business days after the part is due. The pencil blocks that time on the board (a dashed teal card), moves when the ETA moves, and is re-checked after every import as routes fill. It is dashboard-only — ePASS still says SO4; it is not the customer-held SO4PRE date, which keeps its own two-day check. When the part checks in and the customer gets the *your part is here* text, the first date they see is the penciled one: *Best fit — we already have your installer nearby that day.*
- **Route-first dates.** The customer's picker leads with our best-fit day (labelled honestly — *our route is already in your area that day*), then lists the rest in calendar order; the earliest open day is always visible. This is not a Phase 4 luxury: it is the same score as the pencil with a different label, so it ships with it.
- Field tool, parts needed: the component buttons stay, but **the tech keys the part number** — nothing is pre-filled from a catalog any more, and *UNKNOWN + a note* is allowed. The price is optional in a field quote; the parts manager prices anything left as TBD before ordering.

## 7. Customer portal ("Is my repair ready yet?")

- Entry: SV number + phone number or zip to verify (also reachable via the unique link in every text/email, which skips lookup). No account needed.
- Progress tracker with the stages in §4: Request received → Diagnostic scheduled → Diagnosed → Estimate ready → Approved → Parts ordered → Part arrived → Install scheduled → Repair complete. Each stage shows its date; the active stage shows the estimate (e.g. "Part expected Thu Sep 18 · we'll text you to pick a time").
- Reschedule rules (revised 9/11): 48 hours or more out, the customer may change date and window freely among offered slots. **Inside 48 hours a change is still allowed if it makes geographic sense**: the picker only shows windows where the job fits an existing route — for an SO1, any eligible tech (primary or cross-zone secondary) who already has a stop in that zone group that day, so the tech may change; for an SO6/SO4PRE install the owning tech's availability only, since installs follow the diagnosing tech. If nothing fits, the portal offers Message Client Care rather than a bad move. Cancellations inside 48 hours go to Client Care.
- Actions available inline depending on stage: pick/reschedule window, view/approve estimate, **My part arrived** on direct-ship parts (→ SO5 and the install picker, ⟨9/11⟩), cancel request, update gate code/contact preference, message Client Care (creates a task, not a phone call).
- Multi-unit jobs show one tracker per unit under the same SV.
- Warranty jobs hide dollar amounts and show "covered under warranty" where relevant.
- A short FAQ under the tracker ("Why is my part taking a week?") absorbs the second most common call.

## 8. Notification matrix

Channel follows the customer's stated preference (text default; email if chosen; both for estimates). All texts go out through **Podium** (dev API access is in hand), which is already how the estimate tool texts links, so the matrix is a template and trigger build rather than a new integration. All templates editable in the dashboard.

| Trigger | Message intent |
|---|---|
| Form submitted | Confirmation, SV/ref number, portal link, what happens next |
| SO1 booked | Date, window, tech first name, prep tips (clear access, model tag photo) |
| Day before SO1 / SO6 | Reminder + one-tap reschedule |
| Tech "On my way" | ETA text |
| SO2.2 | Estimate link (existing) |
| 48 h / 5 d in SO2.2 | Reminder (existing buttons, automated) |
| SO3 | "Approved — ordering your parts" |
| SO4 / SO4B / SO4H | Parts ordered + expected date; delay notice on ETA change > 2 days; shipping tracking for direct-ship |
| SO5 | "Part is in — pick your install time" with picker link |
| SO6 | Install confirmed |
| SO4PRE → SO6 | "Your part arrived; your Sep 18 appointment is confirmed" |
| SO8 + payment | Receipt with itemization, review request |
| Failed charge | Secure pay link |
| Quiet period | Any job with no status change for 7 days and no customer action pending gets a "still working on it" note — silence is what generates calls |

Internal notifications: Stuck Jobs digest each morning to Cayden/leads; Needs-review quote and Payment-review items to Noell; new SO2 count to the parts manager; ePASS sync backlog count to whoever owns it.

## 9. ePASS mirroring until NetSuite

You said: dashboard is the source of truth, staff make ePASS match, and a background flagging tool catches discrepancies. Concretely:

1. **Imports**: ePASS writes `DispatchTrackDetail_*.csv` to `\\WILSON-EPASS01\Updates\ePASSScheduler\DispDataExport` every 15 minutes (full snapshot, cp1252). Confirmed 9/10: SV rows carry `Truck` = tech SP code, `Delivery Date`, `Job Status` (currently SO1/SO4PRE/SO5/SO6 only — Cayden is asking ePASS to export all service statuses), `Map Zone`, `Latitude/Longitude`, `Balance`, `Priorites` (WTY/RCALL), `Location` (parts bin), `Directions`, `Qualifications`. See docs/04 and docs/06. A push script that already sends ePASS data to Dispatch Track exists on the server; reuse it to push the ExportInvoice (and routing) data to the dashboard on a schedule. Fallback: schedule the ExportInvoice report (and the routing/schedule export if one exists) into the dashboard as often as ePASS allows — hourly if it can be automated from a workstation with a small watcher script that pushes the file, otherwise at least morning and mid-day by a person (the Service Order Health upload button already does the ingest).
2. **Matching**: SV # ⇄ Job ERP order number (already done in Service Order Health). Add: job status, scheduled date, assigned tech (SP code), balance, units.
3. **Sync queue**: every dashboard transition writes a **Sync Item** ("Set SV00123388 to SO4, date blank, note PO 4471 ETA 9/18"). Items are grouped by ticket, oldest first, with copy buttons for each field so keying takes seconds. An item is **auto-closed when the next import shows ePASS matching**; if the import still disagrees after two cycles it becomes a **Discrepancy** with both values shown.
4. **Reverse discrepancies**: if ePASS changes without a dashboard event (someone edits in ePASS directly), the dashboard flags it and asks: accept into dashboard, or re-issue sync item. This keeps the two from silently diverging.
5. **NetSuite readiness**: model the Job, Unit, Quote, PO and Payment entities now so that NetSuite's SuiteTalk/REST records map field-for-field; the sync queue's "apply" step then becomes an API call instead of a human, and the discrepancy engine stays as a safety net.

## 9a. Office search, history and KPIs ⟨9/11⟩

- **One search box** on the service dashboard: customer name in any word order, phone digits, SV number (with or without the `SV000` prefix), serial, model or street address. Results list customers and jobs, open jobs first; one click opens the job or the customer's page.
- **Customer and unit history**: every prior call at that customer (and, separately, on that serial — appliances change hands), with dates, tech, what was found and what was done (quote lines / findings), amounts and links to the receipts. Closed 2026 jobs are back-filled from the completed-invoice exports so the history is useful on day one, before the dashboard has closed a job itself.
- **Recalls, auto-tracked**: when a new call is created on a unit that had a completed repair within the last 30 days (same serial, or same model at the same address), it is flagged as a recall candidate against the original tech; the service manager confirms or dismisses it in a Recalls queue, and a candidate left unreviewed for a week counts anyway. Anything the office already marks RCALL in ePASS is a recall too. A confirmed recall keeps the original owner and is not charged a diagnostic.
- **KPIs** per tech (week, 30 days, 90 days): recall rate, call turnaround (created → complete, split diag-only vs repair), calls per day (completed visits ÷ working days), diag-only rate, quote approval rate, delivered dollars per call/day/week, days part-in → install, plus whatever the team adds later — definitions are data, not code, so the list can change. Techs see their own delivered dollars and calls per day in the field tool; the rest is manager-facing by default.

## 10. Data model (developer summary)

- **Customer** (id, name, phones, emails, contact_pref, addresses[], stripe_customer, tags: landlord/PM)
- **Job** (id, sv_number, customer, address, zone, status, status_history[], type: appliance/HVAC/in-shop, warranty_flag, promised_window, planned_slot, tech, priority, source, created_at)
- **Unit** (job, appliance_type, brand, model, serial, purchase_date, purchased_from_us, merged, problem_text, photos[])
- **Appointment** (job, kind: diag/install/revisit, window_start/end, planned_arrival, tech, sequence, locked, actuals: on_my_way/arrive/complete)
- **Findings** (job, tech, notes, photos, recommend, submitted_at)
- **Quote** (job, version, lines[], subtotal, tax, deposit_applied, remaining, sent_at, viewed_at, decision, decided_at, sent_by, needs_review_reason)
- **QuoteLine** (quote, kind: part/labor/shipping, part_number, description, qty, unit_price, verified_at, verified_by, availability, supplier)
- **PurchaseOrder** (supplier, po_number, lines[], ordered_at, expected_at, ship_to, tracking, received_at per line)
- **Tech** (name, sp_code, home, start_pref, end_pref, shift, skills[], max_jobs, days_off)
- **Zone** (zip, primary_techs[], secondary_techs[], centroid)
- **Notification** (job, trigger, channel, template, sent_at, delivered/opened)
- **SyncItem / Discrepancy** (job, field, dashboard_value, epass_value, created_at, closed_at, closed_by: import/human)
- **Payment** (job, amount, stripe_payment_intent, status, posted_to_erp)

## 11. Phased rollout

Ordered by call-volume relief per unit of build effort, and so each phase is useful on its own.

**Phase 0 — Foundations (weeks 1–3).** Job record with full status engine and status_history; convert the Service Requests queue to it; scheduled ExportInvoice import; Sync Items + Discrepancy view replacing free-text "TICKET MADE. MSD". No process change for staff yet except keying from the sync list.

**Phase 1 — Customer visibility (weeks 3–6).** Portal tracker keyed off imported ePASS status, notification matrix for status changes. This is the biggest call reducer and needs nothing from techs or parts yet — status can still be flowing from ePASS imports at this stage.

**Phase 2 — Quote automation (weeks 5–9).** Tech findings form (mobile web), Parts Verify queue, structured quote replacing PDF scan, auto-send, auto SO3/SO7, scheduled reminders, Needs-review rules for Noell.

**Phase 3 — Parts pipeline (weeks 8–12).** Parts Order queue, PO builder with supplier export, ETA capture, receiving → SO5, SO4PRE auto-confirm logic, partial-receipt handling.

**Phase 4 — Capacity engine and SO1 self-scheduling (weeks 11–16).** Tech/zone/duration tables, drive-time API, capacity ledger, window picker on the form and in Client Care. Run shadow mode first: engine proposes, dispatcher compares against what they'd have done.

**Phase 5 — Route builder and two-truck board (weeks 15–20).** Optimiser, board with drag/drop, pins, re-optimise controls, per-tech route export to ePASS. Dispatcher moves from building to supervising.

**Phase 6 — Install self-scheduling and auto-charge (weeks 19–23).** SO5 → customer picker → SO6; SO8 → auto-charge with Payment-review exceptions.

**Phase 7 — NetSuite two-way (aligned to migration).** Replace human sync with API apply; keep Discrepancy engine.

## 11a. The shadow test instance ⟨9/14⟩

The AJH pilot (three files, one technician, three browser tabs sharing a `localStorage` store) is retired; its two good ideas — a copy button on the live Service Request Queue and a suggested day for everything unscheduled — are kept and applied to the whole crew on the real Phase 0 database.

- **What runs.** One Phase 0 database fed read-only by the DispatchTrack export ePASS already writes every 15 minutes, plus the ExportInvoice file once or twice a day. The three *Service Journey* pages read it. Nothing writes back to ePASS: packets pile up as *pending* and are never keyed, no texts or charges go out.
- **The button.** *Copy to service dashboard test module* on every live request row posts the row (customer, address, contact method, units, photos, card on file, ERP order number) to the instance. It becomes a REQ with a suggested tech-day and the reason. Pressing it twice does nothing new. The live row is untouched — a copy, not a move.
- **No double entry.** The dispatcher keeps booking in ePASS as today. When the SV appears in the next snapshot the instance attaches it to the request (phone, or name + ZIP), adopts the ePASS booking, and scores its own suggestion against what the dispatcher did. Typing the SV into the row's ERP field does the same immediately.
- **The morning check** (`shadow-report`, ten minutes): mirror health against the CSV; requests copied and which still lack an SV; suggested-vs-actual agreement (same day, same tech, both) with every miss listed for the dispatcher to judge — *who was right?*; where the pencils landed and whether they moved sensibly when an ETA changed; whether PTO, blocks and forced calls showed up within a refresh.
- **Done when** the mirror has been clean for three straight days, roughly fifty requests have been scored with ≥ 80 % same-day-or-better and every miss explained by a rule we added or a difference we accept, and the dispatchers have used the day controls on real events. Then customers pick dates for one zone or one tech, with a dispatcher-approves gate in front of the confirmation text for two weeks.
- "Break it" testing (closed days, full days, past dates, double bookings) happens on a separate copy seeded from the latest snapshot, never on the shadow instance.

## 12. Measures of success

Baselines from the Sep 2026 data (docs/06): median created→finished **15 days** (mean 22, p90 46); **33% of billed COD invoices are the $169.95 diagnostic only**; core techs bill 2–2.5 COD jobs per working day; west work is 6% of jobs; 657 open tickets of which ~23% are warranty statuses.

Track from day one so the before/after is real (⟨9/11⟩ the team's own three — recall rate, call turnaround, calls per day — lead the KPI page, §9a): inbound calls per open job per week; hours between diag visit and quote sent (today 24–72 h, target < 4 h); quote approval rate and time-to-decision; days from approval to parts ordered (target same day); days from part received to install (target ≤ 3); % of appointments self-scheduled by customers; drive minutes per completed job; % of jobs with a fake or past date (target 0); ePASS discrepancies open > 1 day; manual status changes with reason codes per week (should trend to near zero).

## 13. Decisions log

Settled 9/11/2026 with Cayden (9/14 additions at the end, marked ⟨9/14⟩):

| Topic | Decision |
|---|---|
| Call ownership | The tech who runs the diagnostic owns every later visit. Board flags cross-truck moves; installs wait for an absent owner up to ~1 week, then Demitrius reassigns manually. |
| Board defaults | Full-week fill strip; two columns default to the same tech on consecutive days. |
| Owed installs | Count a tech's open SO2–SO5 jobs against their future diagnostic capacity (discounted by quote approval rate). |
| Billing | No charge at diag. Approve → diag rolled into quote, full total charged at SO8. Decline/SO7 → $169.95 diag fee charged then. |
| Reschedule | Self-service only ≥48 h out; inside that, Message Client Care. Same-week reschedules keep the AM/PM window, change day only. |
| Texting | Podium, via its API (dev access exists). |
| Field tool | Mobile web on techs' own phones; replaces Dispatch Track; modelled on the existing maintenance field tool (tap-only, 44–52px targets, autosave, photos stored locally before upload); captures arrive/complete times from day one. Serial-tag photo required on SO1 only. |
| Field quoting | Techs quote in the field from flat-rate tasks + catalog parts; customer signs on the phone; card on file is charged at completion. Approve → SO3 (or SO8 for labor-only). Quick fixes within the diag hour are not upsold. |
| Contact preference | Passes through to route and job cards; it just defaults the tech's button — Call (via Podium) or Text. No other UI. |
| Rate book | Restructure to task catalog + modifiers + rate table (+ optional brand factor); generate the ePASS import from it. |
| Sales tax | Labor taxed unless the unit is built-in or HVAC; parts, diagnostic and zone fees always taxed. Flag driven by the unit's install type, not brand. |
| Roster & zones | Real roster in `tech_roster.csv`; ePASS `Map Zone` is the zone vocabulary; primary/secondary techs derived from 2026 completions. JHM, MAP, VJ not auto-routed or customer-schedulable. All techs sealed-system; BLL is HVAC, TDP backup only by office decision. |
| Booking modes | Zone groups carry `open` / `designated_days` / `office_only`. No standing trip days — far groups accumulate in a trip bucket and a trip is proposed on volume, age or an aging install; Demitrius confirms; a drive-per-stop guard flags unprofitable days. |
| Parts / shop touch | Install days require a shop touch before the first install unless parts were loaded the prior evening; home-start techs get wave logic; per-tech "always start at shop" fallback. |
| Reschedule <48h | Allowed when it fits an existing route: SO1 may change to any eligible tech already in that zone group that day; SO6 follows the owning tech only. |
| Requote | Re-approve if verified parts total > 10% above field quote (or a part > 10% and > $10); decreases auto-apply. |
| Notes | Live on the dashboard Service Order. Techs never enter ePASS. Office keys status + billable lines from the Sync Queue packet until NetSuite; prose is never re-typed. |
| HVAC | Brady is the dedicated HVAC tech on the same flow; Vince (HVAC sales) runs a handful of odd jobs and can appear as a tech with limited capacity. |
| In-shop (SI) | Stays on today's process for now. |
| ePASS import | Reuse the existing server script that pushes ePASS data to Dispatch Track. |
| Roles | Demitrius is the service router; Michael Davidson creates tickets; Noell owns quotes and billing; ⟨9/11⟩ Kezia (parts/receiving) owns the two-day-out part check on held installs. |
| Tech's number ⟨9/11⟩ | Delivered dollars = parts profit + all labor including diagnostic and zone fees, exactly as OE-23 reports it; warranty tickets count labor only. Live in the field tool with week pace; per route and department for the office. |
| Working days ⟨9/11⟩ | Josh (JRC) is Mon–Thu; his Friday is closed by default and opened per day with one click. Every tech has working days on the roster. |
| Capacity controls ⟨9/11⟩ | Dispatcher changes capacity from the fill strip in one or two clicks: close/open a day, PTO ranges, ±60 min, +1 stop, non-call blocks (haircut, van maintenance), and *Force it* on an over-capacity drop with no reason code, logged. |
| Recalls ⟨9/11⟩ | Auto-detected: same unit (serial, or model at the same address) with a completed repair in the last 30 days; manager confirms/dismisses; unreviewed after 7 days counts. |
| Field tool inputs ⟨9/11⟩ | Two typing exceptions to tap-only — the error code (prompted when that symptom is tapped) and an optional custom note behind a button. Half-day / full-day labor quick picks. |
| Held installs ⟨9/11⟩ | T−2 business days: Kezia checks ETA if parts aren't in; T−1 2 pm: hold released to SO4 with an apology text and re-pick link. Direct-ship (SO4H): customer taps *My part arrived* → SO5 → picker. |
| ⟨9/14⟩ Part numbers in the field tool | Tech taps the failed component, then keys the part number. Nothing pre-filled from a catalog; UNKNOWN + note allowed; price optional, office prices TBD lines. |
| ⟨9/14⟩ SO4 auto-pencil | Once Kezia's ETA is set, pencil the install ETA + 2 business days on the owning tech's best-fit day; blocks time; dashboard-only; moves with the ETA; first date the customer sees on SO5. |
| ⟨9/14⟩ Route-first dates | Offer the best-fit day first (labelled), earliest always visible, within 5 days of the earliest. Same scoring as the pencil, so it ships now. |
| ⟨9/14⟩ Testing approach | Shadow instance for all techs fed by the existing DT export; *Copy to service dashboard test module* button; AJH pilot retired. |

## 14. Decisions still needed from Wilson

1. Arrival-window size to offer customers at launch (half-day vs 2-hour) and how many days out to allow booking.
2. Dollar thresholds for Needs-review quotes and for auto-charge without review.
3. Backorder threshold (days) that flips SO4 to SO4B and triggers a customer delay notice.
4. Days of silence before a no-response quote becomes SO7 and a sales lead.
5. Whether in-shop (SI) jobs are in scope for phase 1 tracker.
6. Which supplier(s) to attempt pricing/availability integration with first.
7. Confirm `reference/zone_table.csv` primary/secondary assignments, the profitability floor per far group (stops before a trip is proposed) and the drive-per-stop guard threshold, plus shift hours and days off per tech.
8. Who owns the ePASS sync list day to day until NetSuite.
9. Link/upload the existing maintenance field tool and the ePASS→Dispatch Track push script.
11. Confirm the dashboard stack (framework, database, hosting, current Stripe and Maps accounts) so the developer-facing spec for each phase can be written against it.
