# Wilson AC & Appliance — Service Order Journey: Target-State Blueprint

Version 0.24 · September 19, 2026, night (**9/19 night: the audit round.** The tech's findings become history rather than a toast — §5.13; the installer's damage form is read off the queue Agility already has, not rebuilt — §5.10; anyone in the office can edit a ticket, logged and packeted to ePASS — §5.14; a day is dragged onto the board instead of loaded with buttons — §6.5; the field tool never fills a part number; and a full pass found five pieces of bad data of our own making and took them out — §5.15. §14 now shows only what is still open.)

Version 0.23 · September 19, 2026, late (**9/19 late: the round Cayden's answers unlocked — the warranty rate card with real numbers and real ePASS codes, freight at $20 under the FREIGHT code and off the tech's screen entirely, damage reports as warranty by default, parts ETAs by where they ship from, in-shop tickets with their own lane and a tattle when one floats, a quote that survives being closed, and a confirmed route that texts everyone on it — §5.9a, §5.11, §5.12, §6f, §7, §14; 9/19 pm: the other eight — the three tracker buttons that did nothing, closing a call out from the board, Kezia's shipping override, warranty on the office side, a quote the office draws up itself, and the installer's cosmetic damage report from the truck to the customer picking an install time — §5.9, §5.10, §7, decisions log; 9/19: the field tool rebuilt around one estimate flow the tech builds and prices — §5.2a, decisions log; 9/18 late: the confirmation page after a customer books, built around saving the private tracker link — §7, decisions log; 9/18 pm: the diagnostic on a discontinued part — it stands, with a one-click logged waive on the way to the showroom (§5.3); add and remove ZIPs in the zone editor, with randymajors.org as the list source — §6.3; a discontinued part ends the call through the estimate page as a parts-unavailable notice — §5.3; decisions log and §14 extended.** 9/18: ePASS stays the source of truth for the interim — §5.3, §5.4 and §9 rewritten, purchasing moved to the NetSuite phase in §11; the zone map editor in §6.1 and §6.3; the two-line labor rule; the decisions log and §14 extended**; 9/17: the address is the identity — §6e; replay adjustments; service-team feedback from the 9/11 demo folded in — §13 and the ⟨9/11⟩ marks; 9/14: placement against the real route, the SO4 auto-pencil, route-first dates for customers, and the shadow test instance that replaces the AJH pilot — §6a and §11a, marked ⟨9/14⟩; **9/15: the visit group, per-job contacts, honest capacity, and the tech notification loop from the team's test — §6b, marked ⟨9/15⟩; 9/15 pm: the collector lane for John's Fredericksburg route, and the hand-off text — §6c**) · Prepared for Cayden Mayfield and the dashboard dev team

## 1. What this document is

This is the working spec for moving the service repair workflow — from the customer's first contact to the final card charge — into the Wilson dashboard, with the dashboard as the source of truth and ePASS kept in step by a background reconciliation tool until NetSuite arrives with a two-way API. It covers the target flow, the status engine, the automation rules that replace today's manual report-pulling, the capacity and route builder, the customer portal and self-scheduling, notifications, the ePASS mirroring strategy, a data model, and a phased rollout. ⟨9/18⟩ For the interim, until NetSuite, the first sentence is qualified by §9: ePASS remains the source of truth for ticket data, ordering, receiving, accounting and billing, and the dashboard works beside it with the least double work the team will accept.

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

### 5.2a The tech builds and prices every repair ⟨rewritten 9/19⟩

Cayden, 9/19: *even if office is sending quote, we need the tech to be the one to really build and price
it … theyre the only ones that know exactly what theyre going to have to do during the repair trip.*
There is now **one** flow out of a diagnostic that needs parts — parts, then labor, then a total — and
what differs at the end is only who presses send.

- **Labor:** the flat-rate book's hours are hidden. The tech picks the line, then picks how long it will
  take him (30 min through full day), and the price follows his number. A line the book does not have he
  types in, and it is priced the same way.
- **The total is his to move.** The labor figure is editable, with the book's number beside it. Cayden's
  reasoning is the point: a customer who has already spent money twice, a house he knows, a job he can
  see will run short or long. It is a commission role; this is the part of it that is his. We log it and
  report on it rather than gate it.
- **Part numbers** are keyed on the part line itself, and a component we stock brings its number with it.
  Nothing on the screen suggests the office will look it up. On Kezia's side the number arrives
  copyable and correctable, and her card remembers what he sent.
- **Warranty:** True, Scotsman, Zephyr and BlueStar pay our COD rate, so the tech quotes those normally.
  Every other warranty brand shows no labor at all — the flat rate is the warranty admin's to add when
  the claim is filed. Warranty work carries no zone fee and is tax exempt.

**Field quoting — the customer signing on the tech's phone — is switched off for now**, at Cayden's call,
until a part price can be verified at the door instead of guessed. Nothing was deleted. The likely way
back: ePASS already has a Marcone integration that returns live price, stock and a *discontinued* flag,
which is also the signal the parts-unavailable notice (§5.3) currently waits on Kezia to spot.

### 5.3 Parts verification → the estimate ⟨rewritten 9/18⟩

Cayden, 9/18: *we still have to use ePASS for storing ticket data, ordering parts, receiving parts, accounting and billing. It needs to remain the source of truth … minimal double work.* So for the interim, verification is a short step and the estimate goes out through the tool Noell already uses.

- **Parts Verify** shows each new SO2 with the tech's lines. Kezia's only job here is to verify each part's price and put an expected date (ETA) on it, and to finish any line the tech left incomplete. A part line always carries a description — the failed component the tech tapped, or his own words — but the part number is optional in the field (*leave blank if you can't find it — the office adds it from your description*), and a blank is highlighted for her: *tech left this blank — add the number*. She can add a part or a labor line the tech missed (labor from the task list or free text, at hours × $130), remove one, and override the zone-fee band. She does not order anything here. **Verified** completes the quote.
- **Two labor lines.** Every quote carries a zone fee (`ZN1`–`ZN4`, assigned automatically from the call's distance from the shop, with a per-ZIP override the office sets on the zone map — downtown 78701 is ZN3) and the component replacement task. The tech cannot remove the zone fee; the office can change its band. Diagnostics are zoned the same way: `DZ1` $157 + tax is the $169.95 the customer sees. The evidence and the fitted bands are in the spec, §5.1a.
- **Verified → the existing Agility Service Estimate Approvals workflow.** Today Noell scans the ePASS work-order PDF to build the estimate; with structured lines the estimate row is created directly, no PDF. Her list (Created · SV # · Client · Due · Contact · Status · Sent by), the drawer (status, contact with text or call preference, *Not emailed — copy the link or use the button*, the Parts ETA — *In stock · Tue, Sep 22 – Fri, Sep 25* — with the sentence *Once approved, we will order the parts listed to complete the repair and schedule your technician {tech} to return between … and …*, the unit line, the lines including *Labor (2 entries)*, S&H, subtotal, tax, total, Copy client link / Close estimate) and the closed-outcome summary (approved / comped / shopping / went elsewhere / diagnostic only / no response) are reused as-is. Statuses run sent → viewed → approved | declined | comped | shopping | diagnostic. Nothing emails on its own — she copies the link or presses the button.
- A quote the customer already approved in the field, where the verified total is within 10% of the field price, skips the estimate; so does a warranty job (the manufacturer pays).
- ⟨9/18 pm⟩ **A discontinued part.** Cayden: *Kezia needs a toggle to confirm a part is available. We occasionally run into discontinued parts. If we do, we need to inform the customer, and then likely terminate the call and move it into a sales workflow — right back into our estimates tool.* The availability row on Parts Verify has a fifth state, **Discontinued**. Such a line needs only its description — no price, no date — and the card says plainly what happens next. If a substitute exists Kezia adds it as a new line and drops the old one, and the call is an ordinary quote again. Otherwise Verified hands Noell a **parts-unavailable notice** rather than a quote: the row reads *part discontinued · no quote*, the drawer shows the customer wording (*the {part} for your {unit} has been discontinued by the manufacturer and we can't source it, so the repair can't go ahead; if you'd like help choosing a replacement, our showroom team can take it from here*), sent on a click like every other message, and the same estimate link carries the one choice the customer has. Two exits, both SO7 in ePASS through a packet that names the part: **shop for a replacement** — the showroom lead Cayden described, the same *shopping* outcome a quote can end in — or **informed · close the call**, a new closed outcome, *parts unavailable*. A notice can never be approved. Warranty tickets take the same path with a note that the manufacturer decides on replacement or prorate.
- ⟨9/18 pm⟩ **The diagnostic on one of these.** Cayden: *standard process, we still charge diag if we can't get a part. This does become a point of contention, since they are usually upset. We frequently waive it as we pass them over to sales to keep them happy and keep the sale in house, even though we truly have no control over what the manufacturers do with replacement parts.* The notice therefore carries the decision: **charge** (the default), **waive** (one click, no permission gate, logged with who and when) or **credit it against a replacement** (built, but labelled a proposal until Cayden says otherwise). It changes the sentence the customer reads, the billing line on the SO7 packet so ePASS bills correctly, and the sales lead; the Estimates header shows how often it is waived. The history backs the standard up: of **248 COD discontinued-part calls since January 2024** — about eight a month — **56% were billed the diagnostic and 19% billed nothing**. It also shows what the hand-off is worth: **24% of those customers bought from us within 90 days, $187,004 of showroom sales**, roughly **$754 a call**, which is why waiving should take one click rather than an approval. Waived calls converted at 17% against 27% for billed ones — almost certainly because the waive goes to the angriest customers rather than because it costs sales, but ePASS records no reason for a zero, so from now on we log it and stop guessing.
- Reminders at 48 h and 5 days, the call task at 10 days and SO7 at 14 stand as before, under the same explicit-send rule.

**Later, when purchasing returns.** The original design stays on the shelf, not deleted: supplier pricing and availability pre-filled from Marcone, Reliable, Encompass and similar; prices verified within the last 7 days on the same part number auto-accepted; the estimate built from the lines and sent by the customer's contact preference with a call task for "Phone Call", Noell reviewing only a **Needs review** subset (a dollar threshold, zero-priced lines, repair cost against replacement value, anything the tech flagged). It comes back when NetSuite gives us an API and the tool owns ordering.

### 5.4 Approval → ePASS order → parts arrival ⟨rewritten 9/18⟩

The interim flow keeps ordering and receiving in ePASS and reads them back; what we key is the minimum the team accepts.

- **Self-booked requests have no ePASS ticket.** When a customer picks a window on the web form (or the test bench does), the office admins get a pushed notification — *New self-booked request — create the ePASS ticket on {date} · {window} · {tech}* — carrying name, address, phone, unit, problem, date, window and tech. The admin creates the ticket in ePASS and types the SV into the notification to link it; the next DispatchTrack import matches it. Until then the card wears an *ePASS ticket needed* chip.
- **Approved → Noell adds the parts and labor lines to the ePASS ticket** so it matches the approved quote, and sets SO3. This is the one piece of re-keying the team accepts, and the sync queue hands her the packet: every part with its number, every labor line with its ePASS code (`ZN1` …, the task), the total, *set SO3*. Shopping / decline → SO7 and the showroom lead, as before. Warranty jobs: tech *Submit findings* → SO3 directly, warranty admin queue notified for claim filing (WAR statuses continue on their own track).
- **Kezia orders in ePASS as normal and moves the ticket to SO4 there.** Our tool learns SO4 from the next import (every 15 minutes) and pencils the install onto the owning tech's route two business days after the ETA she verified — a held block on the board, dashboard-only (§6a).
- **She receives the part and sets SO5 in ePASS.** The next import shows SO5 and the customer's *your part is in — pick your install time* text becomes ready. It goes out on an explicit click, or automatically only if that template's toggle is on — default off, the standing rule: no automated customer contact without a click or an explicitly enabled toggle.
- Customer picks → SO6, with a packet to key the date and tech into ePASS, as today. Constrained to **the tech who ran the diagnostic** (call ownership) and the install duration from the labor lines; unpicked after 2 days → dispatcher/Client Care callback task with the picker — unchanged.
- SO4PRE holds still work on dates (portal shows both "part expected Sep 16" and "install held Sep 18"; part in ≥ 1 day before the held date → SO6 and a confirmation text; a slip past the held date → "we need to move your appointment" with new windows and a Stuck Jobs flag). The two-day-out check ⟨9/11⟩ — Kezia's task at T−2 with **Part is here** / **New ETA** / **Wait**, the release at 2 pm the day before with the apology text and re-pick link, no auto-confirm for a hold at risk — stands, but "is the part here" is answered by ePASS showing SO5, not by our receiving screen. Direct-ship (SO4H) and the tracker's **My part arrived** button ⟨9/11⟩ are unchanged: tapping it moves the job to SO5 and opens the owning tech's picker; a check-in text asks the day after the expected date if nobody has tapped.

What we key into ePASS: new tickets for self-booked requests; approved lines + SO3; dates and tech changes (the SO1 booking, the SO6 pick, moves). What we only read back: SO4, SO5, everything Kezia does in ePASS, and anything changed there directly — reverse discrepancies stay (§9).

**Later, when purchasing returns.** The Parts Order queue with all SO3/SO3PRE lines grouped by supplier; the PO builder producing the supplier order sheet in the supplier's format and recording PO #, order date, expected arrival and ship-to; placing the PO → SO4 (SO4H direct-ship, SO4B past the backorder threshold); receiving by PO/part number or barcode scan → SO5 with "2 of 3 received" partials and tracking-number polling — all of it is built and hidden behind `purchasing.enabled = false`. Cayden: *we will bring this back when we are on NetSuite and can open an API.*

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
- ⟨9/18⟩ **The zone map is edited by painting.** Cayden asked for *a zip code map with clickable or drawable zones*. The board's **Zones** view is a paint-by-ZIP map: pick a tech, click a ZIP to make him its primary (the old primary stays as a secondary so nothing loses coverage), Shift-click for a secondary, and a side panel for the ZIP's booking mode, trip and zone-fee band. The ZIP is the atom because that is what a customer gives us. Dispatchers draft, with Undo; publishing needs an owner or manager, because it changes where every new call goes, and on publish every tech's zone list is recomputed, every unscheduled call is re-suggested, and every change is logged per ZIP. Free-drawn polygons were considered and set aside — they have to become a ZIP list anyway; street-level splits inside a big ZIP like 78620 are for later, once addresses are geocoded.
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

⟨9/18⟩ The table above is the starting map, not the maintained one. Booking mode, trip day and tech, primary and secondary techs and the zone-fee band are now set per ZIP on the zone map editor (§6.1) and published in one step, in two framings — the whole service area within 60 miles of the shop, and the Austin metro. The prototype draws ZIP cells around centroids; Agility will draw the real Census ZCTA outlines for the ~150 ZIPs we serve on Google Maps, which also fixes the handful of Austin ZIPs that share one centroid in our table today and are assigned from a list until then.

⟨9/18 pm⟩ **Adding and removing ZIPs — and randymajors.org.** Cayden asked whether the map can simply add and remove ZIPs, and pointed at randymajors.org, which he has used to draw ZIP maps of the area and pull lists of ZIPs. Both are in. **Add ZIPs** is a paste box: any text with five-digit Texas ZIPs in it — a spreadsheet column, a text from a tech, or the *Results from Map* box randymajors fills when you draw a radius or a shape on its ZIP-boundary layer — becomes rows painted with the selected tech, drawn where we know the centroid and parked in an *unplaced* list (paste a `lat, lng`) where we do not. Next to it, chips list the ZIPs Wilson has actually worked since 2025 that the zone table never had — 26 of them, 78741 (29 tickets since 2025) at the top — so the map is completed from the company's own history rather than from memory; PO Box ZIPs are explained rather than drawn. **Remove from the service area** sits on each ZIP's panel: open calls keep their tech, new requests there get "we'll call you", Undo restores it, and the publish log counts added and removed ZIPs separately. randymajors itself stays a selection and checking tool — its *Custom Area Maps* are a good look at a draft before publishing — not a data feed: it has no API, its licence forbids embedding (screenshots are fine), and its free tier caps the size of a selection. It draws Census ZCTA boundaries, the same source Agility will use, so what is selected there is what our outlines will show.

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

⟨9/19 late⟩ **Opening a day is a drag, not a click-then-click.** Cayden: *"i click on Josh's 9/18 capacity bar and just drag it into the expanded area i want to see it. i drag to right or left depending on what i want."* Every capacity cell on the strip can be picked up and dropped on either board; the board under the pointer lights up and says what a drop will do; a plain click still opens the day on the left. The Left / Right buttons are gone.

## 6a. Placement: where a call lands, and the SO4 pencil ⟨9/14⟩

Three requests from Cayden on 9/14 turn out to be one mechanism. Every time the dashboard has to decide *where a call should go* — the dispatcher's suggestion on an Unscheduled card, the day an SO4 is penciled onto once the part has an ETA, the order of dates a customer sees — it asks the same question of the route ePASS actually shows: **which tech-day can absorb this stop for the least extra driving, without making the customer wait much longer?**

- The score is in minutes: the extra drive to slot the stop into that day's existing route, minus a credit for every stop already in the same zone, plus a small cost for each business day of waiting (cheap for the first two days, steep after — so a Round Rock request goes onto the Round Rock day two days out rather than an empty truck tomorrow, but nobody is pushed a week for our convenience), plus a penalty when the tech is not that zone's usual one. Every suggestion carries its reason in plain words: *Diogo already has 3 stops in LOCAL that day · +6 min drive · primary tech*.
- **Unscheduled cards** show the suggested day and a *Place there* button; the dispatcher stays in charge and the suggestion is just the engine's opening bid — and, in the shadow test (§11a), what we grade the engine on.
- **The SO4 pencil.** When Kezia keys the part's expected date and the customer has approved (the call is SO4 in ePASS), the engine pencils the install onto the owning tech's best-fit day two business days after the part is due. The pencil blocks that time on the board (a dashed teal card), moves when the ETA moves, and is re-checked after every import as routes fill. It is dashboard-only — ePASS still says SO4; it is not the customer-held SO4PRE date, which keeps its own two-day check. When the part checks in and the customer gets the *your part is here* text, the first date they see is the penciled one: *Best fit — we already have your installer nearby that day.*
- **Route-first dates — revised 9/17 pm.** The first version led with our best-fit day, labelled as such,
  with the earliest open day still visible below. The test bench showed within an hour why that cannot
  work: shown an "earliest" and a "best fit", a customer takes the earliest every time. Cayden's rule
  replaces it — *the first date the customer can choose is the best date for Wilson, unless that is more
  than three business days past the first open capacity; and it is always presented as the earliest
  available.* So the calendar simply starts on our day. Nothing before it is offered, nothing is called
  "best fit", and when our route is already in the area the customer reads the line Cayden liked: *our
  technician is already in your area that day — picking it means less driving for us and a tighter
  arrival window for you.* The wait ramp in the score decides whether waiting is worth anything; the
  three-day hold decides how long we may ever wait. Same score as the pencil, so it ships with it.
- Field tool, parts needed: the component buttons stay, but **the tech keys the part number** — nothing is pre-filled from a catalog any more, and *UNKNOWN + a note* is allowed. The price is optional in a field quote; the parts manager prices anything left as TBD before ordering.

## 6b. One household, one visit — and an honest capacity number ⟨9/15⟩

Four things the team found while testing turn out to be closely related, and they all come back to the same idea: the unit of work is *a visit to a house*, not *a ticket*.

**Two calls at one address should be one visit.** A quarter of the open book — 107 of 443 tickets across 47 addresses — sits at a house that has another open ticket, and seven of those houses are already booked on different days. Diana Preston has two diagnostics with John a week apart. David Worley has an approved repair on the 16th and a parts-in install on the 23rd, same tech, same driveway. Blake Tartt has two installs on one day and a third a month later. Each of those is a second trip we pay for and a second morning the customer has to stay home.

So a **visit group** becomes a real object: one arrival at one address, holding several jobs. Booking any member books every member that is ready. A member still waiting on a part cannot be given a different day — it waits for the group's next visit, and the group's held date follows the *latest* part, not the earliest. When one part is genuinely far out, the office splits that job out on purpose and the customer is told a second visit is coming. Grouping is suggested, never automatic, and it respects skills: the house with an HVAC call and two appliance calls produces two groups, side by side, so the dispatcher can still choose to send both trucks the same morning.

The same object answers the billing ask. When the last unit is finished, the customer gets **one charge and one receipt listing each unit**, instead of three separate card charges the same afternoon. ePASS still gets its per-ticket amounts — the packet carries the split — and each tech's delivered dollars are still counted per job, so grouping changes what the customer sees without moving anyone's number.

**"Whoever is going to be home" needs a phone number.** Contacts move onto the job: the account holder from ePASS, plus any number the office adds for this visit — a tenant, a spouse, a property manager — each with its own "text this one" switch. Adding a number for Tuesday no longer means editing the customer record forever.

**The capacity number was lying, and it was our fault.** The fill bar counted a home-based tech's drive to the first call and home from the last as route time. That is commute. Once it comes out, days over 100% drop from 19 of 38 to 9 — Connor's Tuesday goes from 156% to 99%. In practice we cap how much commute a tech absorbs (45 minutes each way to start), which puts it at 15, and that is the honest answer: Connor's Tuesday still reads 134% — he absorbs an hour each way — because it contains a four-hour round trip to Cherokee. What is left over is real, and it is *on-site minutes*, not driving: Josh and Andrew have days with seven or eight calls and almost no driving between them. (John's Wednesday west list — 14 stops and fourteen and a half hours — has left this count altogether; it was never a route, and §6c says what it is instead.) Those are conversations to have, not a display to fix. Alongside that, each tech gets a settings page — working days, shift, most stops in a day, most on-site minutes, how much commute they absorb, and whether the engine may go past a limit or only a person can.

**And the small one that matters daily:** the number of units on a call is already in ePASS, already drives how long we allow, and now shows on the card. Sixty-nine open tickets have more than one unit; three have eight.

**When a call is stuck waiting on the tech**, the office can mark it *needs tech input* with a one-line question, and it pins to the top of that tech's notifications and comes back every day until he answers — escalating to the service manager after three rounds. Research tickets the tech asked to keep do the same to themselves. It clears when the tech submits, not when someone remembers to tick it off.

## 6c. The collector lane — tracking John, not routing to him ⟨9/15 pm, corrected 9/15 late⟩

One of the eleven names on the board is not a route. John Merz runs the Fredericksburg side on his own clock: we send him a call, he runs it when he runs it, and the ticket gets updated the next time he is at the shop picking up parts. He is grandfathered in, he is not in the long-term plan, and the referrals he brings in are why he is still here. None of that is a scheduling problem — but the board was showing him at **225% on a Wednesday**, because the office had dated fifteen of his tickets to that Wednesday and eighteen more to the one after. That is a pile with a date on it, not a route.

**What this is not.** My first pass had the west zones routing to John and no dates offered there. Cayden corrected it: Fredericksburg customers should still be routed the standard way, and the west ultimately needs a route that can be auto-scheduled. Most of John's customers text him directly at this point; anyone coming through the journey we are building gets scheduled through it. **The lane exists so the office can see what is going on with the work that is already his** — nothing enters it because of a ZIP code. A call reaches the lane only when someone puts it there.

That distinction has a consequence worth naming: the zone table currently makes John the primary *and* the trip tech for all five west zones, which is exactly why "route Fredericksburg normally" cannot happen today — normal routing there resolves to a man with no schedule. The west needs a routed owner, the way Horseshoe Bay has Trevor. Who that is, is a decision for Cayden, and it is the one thing standing between us and an auto-scheduled west route.

**The lane itself.** His column stops being a week of fill bars: no capacity, no dates, no place in the productivity table. The only measure that means anything is **age**, so the row shows how many calls are open, how old the median one is, how many have crossed the line, and what they are worth, over a bar that splits the book into age bands. Opening it sorts the whole book by who it is waiting on — him, us, or the customer.

What that view showed on its first run is the part worth attention. John has **42 open calls with a median age of 85 days**, against 10 to 26 days for the routed techs. **Thirty-one are more than 30 days old; the oldest is 739.** Twenty-one are diagnostics he ran with nothing written up. And **nine are parts that arrived and were never installed — $2,989 of them**, the oldest landing 739 days ago. A part that old is not in a bin; it is almost certainly in his van. Nobody records what leaves the shop with him, which is why it can happen at all.

**Two buttons, and they are the whole feature.** *Took the part*, on the shop-visit screen, writes a part against its order when he carries it out — the one new keystroke this asks anyone to learn. And *Text him the call*, which is the copy-and-paste the office does by hand today: it opens the message with the customer's name, address, numbers, email, gate code, what they said is wrong, and a box for anything on our end, and sends it to his mobile through Podium when someone presses send. It is logged against the ticket, so "did anyone actually send this to John" becomes a question with an answer.

The reverse direction stays manual on purpose. His replies land in the Podium inbox — that thread is where his notes really live — and reading them back into the job is its own piece of work, not something a send button should half-do.

Anything past **30 days** raises a single decision: call the customer, put it on the next west trip, or close it. Once, not every morning.

The lane is deliberately a dead end in the design: no scheduling machinery hangs off it, and because new west work never enters it, it shrinks on its own as the old book closes. When John's arrangement ends, retiring it is deleting a row.

## 6d. Twenty years of history, and who the customer actually is ⟨9/15 late⟩

Cayden handed over the two files that matter: every ePASS service ticket since 2006 — **117,594 of them** — and the 45,239-row customer list being migrated to NetSuite. They join at **98.9%**, and the ePASS customer code turns out to be the customer's phone number, which settles a question the team had been circling: the account number is the identifier, and the phone is what it is made of.

Loading it exposed something that would have quietly ruined the feature. **ePASS bills warranty work to the manufacturer**, so one ticket in five — 25,148 of them — has Whirlpool, Sub-Zero, GE, Bosch or Trane in the customer field instead of the homeowner. Key the history on that column and a fifth of twenty years of work collapses into a dozen accounts named after appliance brands, and a customer's warranty visits vanish from their own record. Which is exactly the call the office is trying to answer: *have you been out here before?* So the household and the payer are now two different things, and warranty tickets are matched back to the house by address and then by surname. Ninety-nine percent of the catalogue lands on a real household, and every ticket records **which way it got there**, so any of it can be re-decided later without a re-import.

What that unlocks is worth more than the lookup itself. **18,682 appliances have been serviced more than once, and 4,361 of them four times or more** — one Sub-Zero at a Westlake address has been visited 26 times between 2009 and 2024. That is the repair-or-replace conversation with evidence behind it, and it is the same record the recall rule needs to know what was done to a serial before. A unit is followed by its serial, not the address, so it keeps its record even when the house changes hands.

Two things are deliberately *not* done. Duplicate accounts — 3,461 addresses carry more than one ePASS code, usually the same house re-entered after a phone change — are shown side by side rather than merged, because merging is a decision the NetSuite model should make, not an importer. And where one appliance appears under two spellings of its serial, the tool says "probably the same unit" and leaves it to a person.

**None of it assumes ePASS is forever.** Every customer, appliance and payer has an id of our own; the ePASS code sits in a table of external references alongside whatever NetSuite eventually issues, and switching which system is authoritative means changing which row is marked primary. Whether NetSuite will hold service history too is still open, and the design works either way.

The last piece is the one the team asked for by name: **212 households are flagged Do Not Service**, and that flag now blocks placement and date offers outright. The request lands in the office queue with the flag showing, and only a named person can override it, with a reason, on the record.

## 6e. The address is the identity — and the other things the second day of real data taught ⟨9/17⟩

The first day the office tested against real history produced one wrong answer that mattered: a
**Do Not Service** banner on Leah Baird, because Sammie Baird — same last name, same ZIP, a different
house with no connection — carries the flag. The rule that produced it, surname + ZIP, had felt safe on
paper. Measured, it was wrong more often than right: of the 4,264 historical tickets it had attached to
a household, 2,222 sat at a different house number from the household they were attached to. So the
rule is now the one Cayden gave: **the address, and only the address** — street, unit and ZIP, or the
same surname at the same house number, which is what a spelling variant of one address looks like. A
namesake elsewhere in the ZIP is *offered* to the office as a possibility, never linked, and never
carries a flag. A Do-Not-Service flag needs the address *and* the last name to match.

Two more things fell out of looking closely. **Condo towers were one household.** 210 Lavaca St has
245 ePASS accounts and, without the unit number, they had all become one address with one history;
the unit is on the customer file and inline on the tickets, and now it is part of the key. And
**"Ort" and "Palomino" did not come up in search** because the office screen only carried sixty
households — it now searches every customer on file and groups what it finds **by address**, because,
as Cayden put it, appliances don't move: 1509 Palomino Ridge Dr is five ePASS accounts across twenty
years and one kitchen, and the office wants the house, not whichever name was typed on the last ticket.

The rest of the round is the office and the trucks asking the history to say more. Every past visit
opens to what the customer said, what we did and what went in. "This unit has been in before" is a
button to that visit. **Model Insight** works in three tiers because SHV78 and SHP78 are one
dishwasher with two handles: this exact model (22 calls), its *family* (107), the brand's whole
product type (2,713) — with the parts we actually installed and the recent calls as typed, and a
tech can flag a watch-out for the family that goes to the service manager before anyone else sees it.

The dispatch board learned what ePASS Routing actually holds. Every tech-day there is a sequence with a
comment row in it — literally "routed" — and everything under that row is a ticket dated today that
nobody is driving to. The stop order above the row is the dispatchers' own and the board now honours it;
the rows under it were modelled for an afternoon and then, at Cayden's direction, left behind: they are
clutter ePASS creates because it cannot be updated from the field, and with techs closing tickets in real
time and the office's questions already bouncing back to the tech as notifications, they go away on their
own. A test bench now sits under the board: generate a customer, see the exact schedule screen they would
get, tap a window as them, and watch the call land on the board — the fastest way to argue with the
engine. Route settings moved off the day and onto the tech — a weekday pattern, so Diogo's Thursdays
and Fridays end at three every week without anyone re-entering it — and a tech calling in sick opens a
walk-through: the engine's suggested slot for each customer, a click to move, and a *separate* click to
text them, with the message shown first. Office notes and dated reminders are internal only. The map
gained a roads view and a full screen; the Google key stays on the server.

## 7. Customer portal ("Is my repair ready yet?")

- **Entry is the link, and the link is the portal ⟨9/18 late⟩.** `wilsonappliance.com/t/{token}` opens the customer's repair with no order number, no phone and no password — the way a parcel tracker works. The SV-plus-phone lookup stays as the way back in for someone who has lost it. No account, and no account to forget.
- **The confirmation page ⟨9/18 late⟩.** Cayden: *a landing or success page after a customer selects a date and completes the registration that makes clear the functionality of saving the customer portal link to monitor their service.* Until now the flow dropped the customer on the tracker with a toast, which hands someone a key without mentioning it is a key. The page now says what was booked, then spends its main section on the link: the URL with a Copy button, what the link actually does in their terms (see where the repair stands, change the appointment, read and approve the estimate, track the part and pick the install time, message Client Care), and one honest line — *anyone with this link can see your repair*. Then three ways to keep it (home screen, with the steps for iPhone and Android; email it to yourself; bookmark), what happens next, and what they'll be charged. Three variants — booked, grouped-trip bucket, office-only callback — off one template. The tracker itself repeats the offer once, quietly. Detail in the spec §6b.
- **We will know whether it worked.** The measure is the share of jobs whose customer opens the link on a *different day* from the one they booked — not page views. Today that number is zero, because there is nothing to come back to.
- Progress tracker with the stages in §4: Request received → Diagnostic scheduled → Diagnosed → Estimate ready → Approved → Parts ordered → Part arrived → Install scheduled → Repair complete. Each stage shows its date; the active stage shows the estimate (e.g. "Part expected Thu Sep 18 · we'll text you to pick a time").
- Reschedule rules (revised 9/11): 48 hours or more out, the customer may change date and window freely among offered slots. **Inside 48 hours a change is still allowed if it makes geographic sense**: the picker only shows windows where the job fits an existing route — for an SO1, any eligible tech (primary or cross-zone secondary) who already has a stop in that zone group that day, so the tech may change; for an SO6/SO4PRE install the owning tech's availability only, since installs follow the diagnosing tech. If nothing fits, the portal offers Message Client Care rather than a bad move. Cancellations inside 48 hours go to Client Care.
- Actions available inline depending on stage: pick/reschedule window, view/approve estimate, **My part arrived** on direct-ship parts (→ SO5 and the install picker, ⟨9/11⟩), cancel request, update gate code/contact preference, message Client Care.
- **The three buttons now work ⟨9/19⟩.** Cayden: *the buttons other than reschedule dont currently work.* They do now, and each one is the same shape — the customer acting on their own repair, through their own link, with nothing sent on their behalf.
  **Message Client Care** opens their messaging app to 512-894-0907 with the first line already written: *Hi Wilson AC & Appliance — this is Linda, about my repair SV00123373 (GE front-load washer).* Then it stops and gives them the cursor. What wastes Client Care's time is not the question, it is working out whose repair it is about, and that is now answered before anyone types. Nothing is sent until the customer presses send on their own phone.
  **Add gate code or note** opens a box for a gate, callbox or lockbox code and anything else the technician should know — where to park, the dog, call first. It reaches his phone and shows on the job before he sets off, so he is not standing at a gate ringing them. It writes those two fields and nothing else: a customer may tell us how to get in, not change where they live.
  **Cancel request** asks once, offers the reasons people actually give, and then shows a success page that leads with the thing they are worried about — *you haven't been charged* — says which window went back to the route, and offers to put it straight back. Cancelling stops being self-service the moment we have bought a part: from SO3 the page says so and offers Client Care, because somebody now has to decide what happens to the part.
- Multi-unit jobs show one tracker per unit under the same SV.
- Warranty jobs hide dollar amounts and show "covered under warranty" where relevant.
- A short FAQ under the tracker ("Why is my part taking a week?") absorbs the second most common call.

## 5.9 Closing a call out ⟨9/19⟩

> Cayden: *"we need a way to cancel a customer submitted service request … we just need it as an option to close out a call for whatever reason."*

There was no way to end a call except by finishing it, which meant dead tickets sat on the board holding half-days that could have gone to someone else. Now there is one cancel with two doors — the customer's own tracker and the dispatcher's card — and both land in the same place: SO9, the half-day back on the route, the reason on the record, one packet for whoever keys ePASS, and Undo for the rest of the day, because the commonest thing that happens after a cancel is finding out it was the wrong ticket.

The dispatcher gets the reasons a customer would never pick — duplicate, could not reach them, no authorization, do not service, office error — and a **Text the customer** box that is off unless ticked. Cancelled calls leave the route without falling into Unscheduled; they sit in their own short list with who did it and why. A ticket that already has parts against it says so plainly: the call can be closed, but the part is still someone's decision.

## 5.10 The installer's damage report ⟨9/19⟩

> Cayden, with the form's screenshots: *"see screenshots of field/install damage report that funnels directly into our existing service request queue … we will need to grab the info from the service request queue, move it into unassigned and have it send to Mark Perks for review/part number add … holds time at so4, when part arrives at so5, customer is prompted to schedule."*

Every other ticket in this system starts with a customer asking for help. This one starts with an installer finding a dent on something we have just delivered, and it still has to end up in the same place — a technician at the house with the right part in his hand.

⟨9/19 late⟩ Cayden: *"you built the damage report into this tool, which isn't needed. it already exists, we just need to read the incoming data in the service request queue that already exists as well."* Quite right. The form the delivery crews use lives in Agility and keeps writing into Agility's **Service Request Queue** exactly as it does today — the customer, the address, the ERP invoice number, the model and serial, *COSMETIC DAMAGE — field report by Foster Anzaldua*, the line *Issue: Other — Right side — Bottom Right* that the queue has printed for years, and the photos. We built a copy of that form on 9/19 and it is gone. What we build is the **read**: that queue row appears on the dispatch board in the queue's own shape, on a real delivery, with the one thing the queue never had — a button that turns it into a service order.

What is new, then, is everything after that button, and the shape of it comes from two facts about this kind of call.

**There is no diagnostic.** Somebody has already stood in front of the unit and photographed the damage. Putting a technician in a van to go and look at it is exactly the waste this project exists to remove, so the ticket is created at SO2 with the photos standing in for the findings, and never touches SO1.

**The only missing piece is a part number**, and one person in the building supplies it. So the ticket is born unassigned and belongs to Mark until he has chosen the part; his review is the part number, what the part is, when it lands, and who fits it. That is a two-minute job that currently happens in somebody's inbox, and it is the single step the whole thing waits on.

From there it is an ordinary ticket and uses machinery that already exists: SO4 holds a fitting slot on that technician's route two business days after the expected date, the part checks in as SO5, and the customer picks their install window on the same tracker as everyone else. The customer's first contact about a repair they never asked for is a text telling them their part is in and offering them times — which is roughly the opposite of how that conversation goes today.

One thing worth saying plainly: the customer is never sent an estimate for this. We damaged it, we pay for it, and the ticket goes straight to *order the part* rather than through the quote stages. Routing it the normal way would email somebody a price for a repair they are not being charged for.

## 5.11 In the shop ⟨9/19 pm⟩

> Cayden: *"SI jobs live in their own section of unassigned and can be used to fill in days that are lighter … si jobs historically get moved a lot if the tech falls behind and doesnt make it back to work on the unit, so they can float for days at a time before being addressed."*

Everything strange about an in-shop ticket comes from one fact: the unit is here and nobody is waiting at home for anybody. There is no arrival window to miss, no drive time, no customer who will ring at 4pm asking where the van is. That is exactly why these float — and it is why they cannot simply live at the bottom of Unscheduled, sorted by an urgency they do not have.

So they get their own lane, and the lane counts something nothing else in the system counts: **how many times a unit has been given a bench day and still not been touched.** Twice is bad luck. On the third, Mark is told, by name, because there is genuinely nobody else who is going to notice. Placement stays manual for now, as Cayden asked — "a light day" is a judgement nobody has written down, and the engine should not pretend otherwise.

The notification rules are muted on purpose. Telling somebody whose washing machine is on our bench that "your part has arrived" is noise, so the part texts do not go. The tracker still shows them everything, because a page they choose to open is not an interruption.

There are two ways a unit gets here and two ways it leaves, and the tool has to keep them straight. A tech who takes something off a customer's floor mid-call creates a debt: we owe them a delivery, and the trip that takes it back has to remember to load it — which is a line on the board card and a line on the tech's job screen, not a note in somebody's head. A unit the customer carried in themselves ends with them carrying it out. The customer's page tells those two stories differently: one asks them to pick a window, the other says come any time we're open.

## 5.12 The quote that survives being closed ⟨9/19 pm⟩

Three of Cayden's answers land here, and the third changes how the office thinks about a dead quote.

**Every quote is reviewed.** No dollar threshold, no amount below which one sends itself. **Three days** of silence, not fourteen — an unanswered quote at three days is a phone call.

And then: *"we need to save a historical quote so that we can reopen it if the customer calls back after a week and wants to move forward. if a call gets reopened, there needs to be a button the office admin hits to credit the diag to the repair."*

A closed quote is not a dead one. The lines are kept, the row says it can come back, and reopening it puts it in front of the customer again with the closure it had before preserved rather than overwritten. The button Cayden asked for puts the $169.95 they already paid on the quote as a credit, so somebody who thought about it for a week and said yes is not charged twice for the same visit. It is ticked by default and it is still a choice.

The same thinking finishes the discontinued-part argument from 9/18. The three-way charge / waive / credit decision collapses into two, because charging now *means* charging-and-crediting: every customer whose part is discontinued is told, in the message we send them, that the fee comes off a replacement bought from us. That is the version that keeps the fee and the goodwill, and it stops the office having to weigh it up one call at a time.

## 5.13 Where the tech's findings go ⟨9/19 late⟩

> Cayden: *"where are tech notes stored for current jobs? where do their findings recorded in field tool end up? we do need this to record their notes into history."*

The honest answer had three parts. In ePASS today, the tech tells the office and the office re-types it into the ticket's *Work Performed* box — and that box is the whole reason twenty years of history reads as well as it does; every "read the last visit" in the field tool is that box. In the prototype until this round, the findings lived in the phone's memory and a toast, which is to say nowhere. That was a gap.

Now every Submit writes the visit the way the history has always been written — what the customer said, what was found, the cause, the parts and the labor, the tech's note, the outcome — and it lands at the top of that unit's history at once, in the same panel the next technician reads before he knocks, marked as this visit. The office sees it on the ticket and in the customer's record, in one list with the twenty years before it: a call closed in 2019 and a call submitted ten minutes ago read the same way, side by side. ePASS keeps getting the first two hundred characters as the ticket note, so nothing is re-typed and nothing is lost when the ticket closes. At NetSuite the record simply becomes the service order's history.

## 5.14 Anyone in the office can fix a ticket ⟨9/19 late⟩

> Cayden: *"i guess we need to add the ability for anyone in the office to be able to edit customer, unit, tech notes any info."*

Kelli Kenney's built-in refrigerator read *speed oven* for a day, and nobody who saw it could fix it where they saw it. So every ticket card has an Edit, every field on it is editable — the customer's name, phone, email and preference; the appliance, model, serial and whether it is built in; the tech's note and the problem as reported — and any office role can do it. Two things keep that from being loose. Every change is written to the ticket's activity log as *was → is*, with who, when and a **required one-line reason**; the sheet will not save without one, because a change with no reason is the thing nobody can untangle a year later. And because ePASS is still the source of truth for ticket data until NetSuite, the same save puts a paste-ready correction packet on the sync queue, so the ticket in ePASS says the same thing by the end of the day. The dashboard never writes into ePASS; the office keys it, and the next import confirms it.

## 5.15 What we got wrong, and how it was found ⟨9/19 late⟩

Cayden asked for a full pass — *check for issues, find broken links and logic* — and the pass found no broken links and five pieces of bad data that were ours, not ePASS's. They are worth listing because each is a habit, not a typo.

**A rule that knew less than the history did.** Kelli Kenney's *speed oven* came from a model-prefix rule of ours — Profile's PSB9 is a speed oven, PSB4 is a built-in fridge, and the rule stopped at three letters. The fix is not a better prefix; it is asking what ePASS's own product code has said this model was, every time it has been in before, and only guessing when the history is silent. 337 of the 615 open tickets now take their category from history, 175 changed, and hers reads *built-in refrigerator*.

**A flag set by hand for a demo.** Her ticket is COD in ePASS. The warranty flag the field tool showed on it was put there on the morning of 9/19 so the warranty screen could be shown. It is gone; the warranty demo now runs on Diogo's real Friday warranty call, and the tool carries every one of his real days so a story never has to be invented on a real ticket again.

**The office-side twin of the wrong part number.** While the field tool was offering a Whirlpool drain-pump number on a GE washer, the office tool was carrying a Whirlpool bake-element number on a Vent-A-Hood — a hand edit — and its sample-part table gave every hood a bake element. Both gone. No line anywhere arrives with a number nobody keyed.

**Invented people on real ticket numbers.** The office's sync-queue seeds had "Maria Ortega" on William Blocker's SV, "Kim Cline" on Suzanne Colonna's, "Brandon Cox" on Lindsay Chang's; the field tool's notifications had "Ed Taylor" and "Mary Dietz" on tickets that were neither's. Every seed row is now the real customer, unit, technician and status on that SV, and where the *content* is still illustrative — a question Noell might ask, a van-maintenance block, a unit coming back from the bench — the screen says *sample*.

**A rate claimed on the wrong evidence.** Two ways: the sealed-system test matched the word *condenser*, so replacing a condenser **fan** motor claimed the sealed-system rate; and the field tool read a ticket's duration class — built-in refrigeration takes longer — as sealed-system work, so every built-in fridge warranty call would have claimed $237.74 instead of $113.68. Sealed is now decided only by what the technician recorded. Both tools and the reference code share the same rule, and each has a test that fails if it drifts.

The common thread is the one the whole project is about: data that looks right and is not is more expensive than a blank. Every one of these now has a check that would catch it coming back.

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

## 6f. Confirming a route ⟨9/19 pm⟩

> Cayden: *"keep half day, until day is closed and we hit confirm route. closing and confirming a route should auto send customers a confirmation text with date and time frame."*

Half-day windows stay. What changes is when the customer hears about theirs. Until a day is settled, half of it will still move, and texting people a window that is about to change is worse than not texting them at all. So the dispatcher presses **Confirm route** and that is the moment: every customer on that day gets the date and the window, the stops are pinned, and the day is closed.

It is the only place in this system where a batch of customer texts is the right thing, and it is right precisely because it is a deliberate act with a button on it. Every message is shown before any of them goes — all of them, on one screen — so a wrong name is caught by the person pressing the button rather than by the customer. A stop moved after that is an ordinary reschedule and gets its own text.

Booking runs **two calendar weeks** out, not ten business days: the two are nearly the same thing until a holiday week, when they are not.

## 9. ePASS mirroring until NetSuite ⟨revised 9/18⟩

Cayden, 9/18: *we still have to use ePASS for storing ticket data, ordering parts, receiving parts, accounting and billing. It needs to remain the source of truth … minimal double work.* So, plainly: **until NetSuite, ePASS is the source of truth for ticket data, ordering, receiving, accounting and billing.** The dashboard owns what it alone produces — requests, placement and the board, findings and photos, quotes and the estimate hand-off, notifications — and keeps ePASS in step with the smallest set of keyed entries the team will accept, confirming each one from the next export. (This section opened until 9/18 with the dashboard as the source of truth and staff making ePASS match; the mechanics below are unchanged, the direction of truth is not.)

| What we key into ePASS | What we only read back from ePASS |
|---|---|
| A new ticket for a self-booked request — a pushed notification to the office admins; the SV typed back links it | SO4 — Kezia ordered |
| The approved parts and labor lines, and SO3 — Noell, one packet per approved estimate | SO5 — the part is received |
| Dates and tech: the SO1 booking, the SO6 pick, any move | Everything Kezia does in ePASS |
| | Anything changed in ePASS directly — a reverse discrepancy, item 4 below |

Purchasing — the Parts Order tab, PO builder, supplier sheets, Receiving, bin scanning — is hidden behind a flag until NetSuite opens an API (§5.4). The mechanics:

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

**Phase 2 — Quote automation (weeks 5–9).** Tech findings form (mobile web), Parts Verify queue, structured quote replacing PDF scan, auto-send, auto SO3/SO7, scheduled reminders, Needs-review rules for Noell. ⟨9/18⟩ For the interim the estimate is created in the existing Agility module from the verified lines and sent by Noell's click, not auto-sent (§5.3); approval → the `lines` packet she keys into ePASS with SO3 (§5.4).

**Phase 3 — Parts pipeline (weeks 8–12).** ⟨9/18⟩ **Purchasing moves to Phase 7.** For the interim, ordering and receiving stay in ePASS: Kezia verifies price and ETA in our tool, orders and receives in ePASS, and the import reads SO4 and SO5 back (§5.4). What remains in this phase is the read-back, the pencil off the verified ETA, the SO4PRE date logic and the `lines` / `new_ticket` packets — small, and mostly Phase 0 code already. The Parts Order queue, PO builder with supplier export, receiving → SO5 and partial-receipt handling are built and hidden behind `purchasing.enabled`.

**Phase 4 — Capacity engine and SO1 self-scheduling (weeks 11–16).** Tech/zone/duration tables, drive-time API, capacity ledger, window picker on the form and in Client Care. Run shadow mode first: engine proposes, dispatcher compares against what they'd have done.

**Phase 5 — Route builder and two-truck board (weeks 15–20).** Optimiser, board with drag/drop, pins, re-optimise controls, per-tech route export to ePASS. Dispatcher moves from building to supervising.

**Phase 6 — Install self-scheduling and auto-charge (weeks 19–23).** SO5 → customer picker → SO6; SO8 → auto-charge with Payment-review exceptions.

**Phase 7 — NetSuite two-way (aligned to migration).** Replace human sync with API apply; keep Discrepancy engine. ⟨9/18⟩ Purchasing returns here — the Parts Order queue, PO builder with supplier order sheets, ETA capture from the PO, receiving → SO5 and partial receipts — *when we are on NetSuite and can open an API.*

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

**Settled 9/19 pm with Cayden:**

| Topic | Decision |
|---|---|
| Client Care from the tracker | One tap opens the customer's own messaging app to 512-894-0907 with their name, SV and unit already written. Nothing is sent on their behalf. |
| Cancelling | The customer may cancel their own visit up to the point where we have bought a part; from SO3 it is a conversation with Client Care. A cancel — theirs or the office's — frees the half-day, records a reason and sends one packet to ePASS. Undo stays available. |
| Gate codes | The customer can add or clear a gate code and an access note from their link. They cannot change anything else about the address from there. |
| Shipping | $25 is a default, not a constant. Kezia sets it per quote for freight or a special order, with who and why recorded. |
| Warranty | No zone fee, tax exempt throughout. True, Scotsman, Zephyr and BlueStar pay our COD rate and quote labor normally; every other brand's labor is the warranty admin's flat rate on the claim — and the tool shows no figure at all until we have a rate card per manufacturer. |
| Quotes the office writes | Live in Estimates, built from the same lines and rules as a tech's. *Send to the tech* hands the pricing back to the person who saw the machine, and the row waits in Noell's own list rather than a queue she does not watch. |
| Damage reports | No diagnostic, no customer estimate: the photos are the findings, Mark's part number is the approval, and Wilson pays. The ticket is unassigned and Mark's until he supplies the number. |

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
| ⟨9/14⟩ Route-first dates | ~~Offer the best-fit day first (labelled), earliest always visible, within 5 days of the earliest.~~ **Superseded 9/17 pm** — see the offer window below. |
| ⟨9/14⟩ Testing approach | Shadow instance for all techs fed by the existing DT export; *Copy to service dashboard test module* button; AJH pilot retired. |
| ⟨9/15⟩ Visit group | One arrival at one address is the scheduling, capacity and billing unit. Booking a member books every ready member; an unready member waits for the group rather than taking its own date; the held date follows the latest part ETA; the office splits on purpose. |
| ⟨9/15⟩ One charge per visit | The customer is charged once for a grouped visit, with a receipt itemised by unit; ePASS still gets per-ticket amounts via an allocation in the packet. |
| ⟨9/15⟩ Contacts | Per-job contacts with their own notify switch; office can add a number for one visit without changing the customer record. |
| ⟨9/15⟩ Capacity | Commute (home→first, last→home) is excluded from the route day and shown separately; per-tech limits live in a settings page; durations stay assumptions until the field tool's on-site timer has 20 samples. |
| ⟨9/17⟩ Identity | The address is the link between an open call and its history: street + unit + ZIP, or surname at the same house number. Surname alone is offered, never linked. A DNS flag needs address and last name. |
| ⟨9/17⟩ Model families | Model Insight in three tiers — exact model, family (brand · product type · stem, rule table seeded with Bosch's handle rule), brand product type. No inference in v1. Watch-out flags go to Mark first. |
| ⟨9/17⟩ Route settings | Live on the tech with a weekday pattern; the day menu is for one day. Tech name on the board opens them. |
| ⟨9/17⟩ Sick day | Engine suggests per customer; CSR moves and texts one at a time, message shown before sending. |
| ⟨9/17⟩ Reminders | Internal only — a dated office note on someone's list; never a customer contact. |
| ⟨9/17 pm⟩ ePASS "routed" rows | Not modelled. Stops are stops; anything needing the tech goes through his notifications. |
| ⟨9/17 pm⟩ The offer window | The customer's calendar starts on Wilson's best slot within 3 business days of first open capacity; earlier windows are not offered; it is labelled "earliest available", never "best fit". Hold limit is a tunable. |
| ⟨9/17 pm⟩ Test bench | A test-only panel under the board: random call → the customer's schedule screen → tap → live on the board. Test calls flagged, never synced, cleared in one click. |
| ⟨9/15⟩ Tech notifications | "Needs tech input" and research tickets pin to the tech's notifications and re-raise daily in his working hours, escalating to the manager after three rounds; cleared only by the tech's own submission. |
| ⟨9/18⟩ ePASS stays the source of truth | Until NetSuite, ePASS holds ticket data, ordering, receiving, accounting and billing. We key new tickets for self-booked requests, approved lines + SO3, and dates/tech; we read back SO4, SO5 and anything else done in ePASS. Purchasing screens stay in the code, hidden behind `purchasing.enabled = false`. |
| ⟨9/18⟩ Kezia's verify | Price and an expected date per part, and finishing lines the tech left incomplete. No ordering in our tool. |
| ⟨9/18⟩ Estimates | Through the existing Agility Service Estimate Approvals module, created from the structured lines (no PDF scan); its statuses and closed-outcome summary reused as-is; nothing emails on its own. Field-approved within 10% and warranty jobs skip it. |
| ⟨9/18⟩ Noell keys approved lines | On approval Noell adds the parts and labor lines to the ePASS ticket and sets SO3, from a `lines` packet — the one re-keying step the team accepts. |
| ⟨9/18⟩ SO4 / SO5 read back | Kezia orders and receives in ePASS; the import brings SO4 (→ pencil two business days after the verified ETA) and SO5 (→ the part-arrived text is ready; sent on a click, or by its toggle, default off). |
| ⟨9/18⟩ Two labor lines | Every job carries a zone fee — `ZN1` ≤ 7 mi, `ZN2` 7–26, `ZN3` 26–47, `ZN4` 47+ straight-line from the shop, fitted at 81% to 3,807 tickets; per-ZIP override, 78701 → ZN3; `ZNADD` per extra unit — and the component replacement. Auto-added in the field, not removable by the tech, band overridable by the office. `DZ1` $157 + tax is the $169.95 diagnostic. |
| ⟨9/18⟩ Part numbers | Description required on every part line (component chip or the tech's words); part number optional — the office adds it at verify. The UNKNOWN convention is retired. The office can add parts and labor at verify. |
| ⟨9/18⟩ Retire a tech | Owner or manager only (`roster.retire`), with type-RETIRE-to-confirm; a dispatcher sees who can. Roles are a permission matrix; a signed-in-as switcher drives the prototype. |
| ⟨9/18⟩ Start and end by day | The broad default lives on the tech; the weekly pattern may override From / To per weekday (Josh: shop→shop Mon and Wed for parts, home→home Tue and Thu). Every drive calculation uses the day's endpoints. |
| ⟨9/18⟩ Zone editor | Paint-by-ZIP on the board; click = primary (old primary kept as secondary), Shift-click = secondary; mode, trip and fee band per ZIP; dispatchers draft, owner/manager publishes; every change logged per ZIP. ZCTA outlines on Google Maps in Agility. |
| ⟨9/18 pm⟩ Add and remove ZIPs | The editor takes a pasted ZIP list (randymajors.org's *Results from Map* pastes straight in), paints the new ZIPs with the selected tech, lists the ZIPs Wilson has served since 2025 that were never on the map as one-click chips, takes a `lat, lng` for a ZIP it cannot place, and removes a ZIP from the service area from its panel (new calls there become "we'll call you"). randymajors is the selection tool, not a data feed: no API, no embedding by licence; it draws the same Census ZCTA boundaries Agility will. |
| ⟨9/18 pm⟩ Discontinued parts | A **Discontinued** state on Kezia's availability row; the call goes to Noell as a parts-unavailable notice, not a quote, and ends at SO7 through the estimate page — showroom lead (*shopping*) or *parts unavailable* (closed). Every estimate close now sends ePASS its SO7 packet. |
| ⟨9/18 pm⟩ The diagnostic when we can't get the part | It stands — standard process. The office may **waive** it in one click while moving the customer to the showroom, with no permission gate and a log of who and when; the choice drives the customer's wording, the SO7 packet's billing line and the sales lead. A **credit against a replacement** is built and labelled a proposal. Default `billing.diag_on_nla = charge`. Measured 2024–26: billed 56%, waived 19%; those calls were followed by $187k of showroom sales inside 90 days. |
| ⟨9/18 late⟩ The confirmation page and the saved link | After a customer picks a date (or is bucketed, or is told we'll call), a confirmation page whose main job is getting them to save their tracker link: the URL with a Copy button, what the link does, the honest line that anyone holding it can see the repair, then home screen / email / bookmark. The link becomes a one-tap `/t/{token}` — no order number, no phone — issued at intake, reissuable by the office when it is lost, expiring 90 days after the job closes. |
| ⟨9/19⟩ The tech prices the job | One estimate flow for both paths. The book's hours are hidden; the tech picks the time and may move the labor total, logged as his. Lines the book lacks are typed in. Field quoting is off until a distributor price feed exists. The outcome is a defaulted dropdown; every free-text box suggests what that model family has actually needed. A read-only look-ahead shows him his own next few days. |

## 14a. Answered by Cayden ⟨9/19 pm⟩

| Question | Answer |
|---|---|
| Arrival-window size and how far out to book | Half-day stays. The customer is texted their date and window when the dispatcher **confirms the route**, not before. Booking runs two calendar weeks out. |
| Dollar thresholds for needs-review and auto-charge | **Every quote needs review.** No threshold. |
| Backorder threshold | **10 days** — beyond that it is SO4B and the customer gets a delay notice. |
| Days of silence before SO7 | **3.** And the quote is kept: if they ring back a week later the office reopens it and credits the diagnostic into the repair. |
| Are in-shop jobs in scope | Yes — their own section of Unassigned, placed manually to fill light days, customer notifications muted, and a tattle to Mark when one has been scheduled twice without being touched. Techs can bring a unit in off an SO1; the tool remembers to take it back on the install trip. |
| Suppliers to integrate first | Reliable, Marcone, Encompass and Great Plains are the bulk — but this waits. |
| Zone fee by straight-line or drive miles | Either; whichever is cleaner. |
| Band vs ePASS zone disagreement | **Per-ZIP overrides win.** The higher central-Austin fees are Josh charging for parking in condo buildings, which is a real cost and should stay. |
| Census ZCTA5 outlines | Yes. |
| Who publishes zone changes | **Mark.** |
| Kezia's ETA: date or bucket | **Bucket** — and rename "in stock" to **in state** (1–2 days), with out of state (2–3) and cross country (5–7). |
| Repainting a ZIP | **Ask each time** whether the old primary stays on as a secondary. |
| The diagnostic on a discontinued part | Charged as standard, **and the customer is told we credit it in full against a replacement bought from us.** |
| The 26 unmapped ZIPs | 78741 and 78652 to Josh, 78726 to Chris, 78611 to Trevor, 78209 office-booked unless the day already has a call on the 281 corridor; the rest to whoever covers the nearest area. |
| Tracker link on paper | Not applicable — techs leave no paper. |
| One link per job or per household | **Per household.** The landlord case is deferred, deliberately. |
| The measure that matters | **Inbound "where's my repair?" call volume**, not link opens. |
| S&H | ePASS code `FREIGHT`, **taxed**, default **$20**, Kezia's to change in Parts Verify, **none on warranty**, and the tech never touches it. |
| Install damage reports | **Warranty by default** — almost always concealed shipping damage. |
| Warranty rates | The full card, thirty brands with sealed-system rates for fourteen. |

## 14. Decisions still needed from Wilson

⟨9/19 late⟩ Items 1–6, 12–20 and 21–23 were answered on 9/19 (§14a) and are struck through here rather than deleted, so the numbering other documents refer to still holds. What remains open is short.

1. ~~Arrival-window size and how far out to book~~ — §14a.
2. ~~Dollar thresholds for review / auto-charge~~ — §14a: every quote is reviewed.
3. ~~Backorder threshold~~ — §14a: 10 days.
4. ~~Days of silence before SO7~~ — §14a: 3, and the quote is kept.
5. ~~In-shop jobs in scope~~ — §14a: yes, their own lane.
6. ~~Which suppliers first~~ — §14a: Reliable, Marcone, Encompass, Great Plains — later.
7. Confirm `reference/zone_table.csv` primary/secondary assignments (the 9/19 ZIP answers are in), the profitability floor per far group, the drive-per-stop guard, and each tech's shift hours and days off — the route settings now carry a weekday pattern per tech and need a pass from Mark.
8. Who owns the ePASS sync list day to day until NetSuite — including, since 9/19 late, the **correction packets** the office edit produces (spec item 55): same day, same person who made the change, is the assumed default.
9. ~~Link the existing maintenance field tool and the ePASS→DispatchTrack push script~~ — both are in the project (doc 14 conventions; Andrew's platform notes).
11. ~~Confirm the dashboard stack~~ — Agility: Node + Postgres on Render (Andrew, doc 12).
12. ~~Zone fee by straight-line or drive miles~~ — §14a: either.
13. ~~Band vs ePASS zone disagreement~~ — §14a: per-ZIP overrides win.
14. ~~Census ZCTA5 outlines~~ — §14a: yes.
15. ~~Who publishes zone changes~~ — §14a: Mark.
16. ~~Kezia's ETA: date or bucket~~ — §14a: bucket, in state / out of state / cross country.
17. ~~Noell keys first, or Kezia orders first~~ — Noell keys ePASS first, then Kezia orders. Next round: make the wait visible on Kezia's side.
18. ~~Repainting a ZIP~~ — §14a: ask each time.
19. ~~The diagnostic on a discontinued part~~ — answered 9/18 pm and again 9/19: charged, credited in full against a replacement from us.
20. ~~The 26 unmapped ZIPs~~ — §14a. Six of the 47 are billing addresses, not places (spec item 53) — is intake capturing a *service* address separately from the account address?
21. ~~Tracker link on paper~~ — §14a: techs leave no paper.
22. ~~One link per job or per household~~ — §14a: per household; the landlord case is spec item 54.
23. ~~The measure that matters~~ — §14a: inbound "where's my repair?" calls.
24. ⟨9/19 pm⟩ **La Cornue and AGA** — the card says $150; the history says $702.50 and $314. And sealed-system rates for **DCS, Hotpoint and Amana** (spec item 52).
25. ⟨9/19 pm⟩ **Damage reports** — is converting one into a service order Mark's alone, and does one ever bill anybody (a freight claim, the manufacturer) or is it always ours (spec item 51)? Warranty-by-default is in; the exception path is a tick box on Mark's review.
26. ⟨9/19 late⟩ **Who may edit what** — any office role for everything (as built), or customer-record changes reserved to Client Care (spec item 55)?
