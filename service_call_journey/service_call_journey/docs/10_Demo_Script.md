# Demo script — service team meeting

Total: 10 min slides + 12 min demo + questions. Two demos, two moments, nothing else. Everything below runs on the sample data the prototypes ship with; do not improvise off the listed customers.

## Before the room

- Open three tabs and leave them there: **Wilson Service Field Tool**, **Wilson Dispatch Prototype**, **Wilson Parts & Sync Queues** (the last one only if Noell or Michael asks — otherwise don't show it). Local copies are in `C:\Dev\service_call_journey\prototypes\` if the internet is flaky: `field_tool.html`, `dispatch_board_and_tracker.html`, `office_queues.html` open straight from disk.
- Reload each tab right before you start. The prototypes hold state in memory; a reload resets them to the script's starting point.
- Phone: open the field tool on your phone (or hand it to a tech) and reload it too. Have it mirrored or just hold it up — the point is that it's on a phone.
- Deck: `Wilson_Service_Journey_Team_Deck.pptx`, six slides, speaker notes on each.
- Sample customers you'll use, so the names are familiar when they appear: **Gary & Karen Jones** (Bosch dishwasher, LOCAL zone, new diagnostic), **Jeff McCollum** (Sub-Zero, install with part on the truck), **Lynn Osler** (GE washer, part arrived, waiting to pick a time), **Greta Hartmann** (Fredericksburg, in the West bucket).

## Slides (10 min)

Slide 1 cover — one sentence: "This is about our own numbers and our own process. Two short demos after."
Slide 2 numbers — read the five numbers, pause. Don't explain fixes yet.
Slide 3 what stays the same — say the Demitrius and John lines while looking at them.
Slide 4 what changes — read the STOPS column, row by row. Say: "The tech row is what I'm about to show you."
Slide 5 what the customer sees — 30 seconds. "This ships first and changes nothing about how any of us work."
Slide 6 ship order and the ask — read the three asks. Then go to the demo.

## Demo 1 — a tech's morning, on the phone (6 min)

Tab: **Field Tool**. If a tech is willing, hand them the phone and read the steps; it lands harder when a tech's thumb does it.

1. **Route screen.** "This is Monday. Five stops, two diagnostics, three installs, two with balances to collect. Up next is Gary Jones." Point at *On my way — texts the customer*. Tap it. Toast shows the text that went out. Say: "That's the only thing he taps before driving. The customer's contact preference decides whether that's a text or a Podium call — Jeff McCollum, two stops down, prefers a call, so when he's up next the button says *calls via Podium*."
2. **Tap Arrived — open job.** The on-site timer starts. "That timestamp is how we learn real job durations. Today ePASS says every job is 30 minutes."
3. **Scroll the job card once.** Customer's own words, their photos, gate code, unit, and — in amber — "serial not on file, tag photo required." Say: "The write-up he does tomorrow morning today, he does here, now. And it's taps, not typing."
4. **Serial tag:** tap the photo button, take any photo (or cancel and say "required on a new diagnostic, not on a return trip — Jeff's install shows the tag from his diag and doesn't ask again").
5. **Outcome:** tap **Quote the repair now, in the field**. Point out every option says where the job goes next (SO2, SO8, SO7). "No status dropdown. The status is earned by what he did."
6. **Labor:** tap **Drain Pump Replacement · 1.5h**. "That's our flat-rate book — same task, same hours, priced at $130. No brand codes to hunt."
7. **Parts:** tap **Drain pump · $148**. "Last verified price and the date. Parts still verifies before we order; if it comes back more than 10% higher the customer is texted to re-approve."
8. **Totals:** point at *Diagnostic — included*, *Sales tax — labor: exempt · built-in*, and the total. "Built-in dishwasher, so labor is tax-exempt. The tool knows because the unit is built-in, not because of the brand."
9. **Customer decision:** tap **Approves now — signs on this phone**. Read the authorization text aloud, once. Tick agree, sign with a finger. The bottom bar changes to **Approved → order parts**. Tap it.
10. **Back on the route.** Gary Jones is done with a green "SO3 · field-approved, order parts" pill and the on-site minutes recorded. Say: "Parts just got that in their queue. Noell never saw a PDF. Michael gets a paste-ready packet. Gary got a text. And he's driving to Jeff McCollum."

Optional if time: tap into **Jeff McCollum** and show the install screen — parts on the truck with Installed / Wrong / Damaged, serial tag already on file, one tap **Repair complete → charge card**. Don't submit it; just show it.

**If something breaks:** reload the tab; you're back at the route screen in one second. Nothing is saved, so nothing is lost.

## Demo 2 — the board, with Demitrius driving (6 min)

Tab: **Dispatch Prototype → Dispatch board**. Ask Demitrius to take the mouse if he's willing. If not, you drive and narrate to him.

1. **Fill strip.** "Every tech, Monday to Friday, how full. John and Mark are hatched — not auto-routed, office assigns. John's Wednesday says *trip*." Click **Diogo Mon** and **Diogo Tue** if they aren't already loaded (left/right).
2. **Columns.** Point out: leaves shop 8:00 · parts loaded, arrival times, the afternoon-window divider, COD/A/R chips, the *shop touch* leg if you switch the right column to **Josh Chappell** (home start, installs that day → the board inserts the shop stop before his first install, and there's a *Loaded parts last night?* toggle that removes it).
3. **Drag one.** Drag **Ortega** from Diogo Mon to Diogo Tue. Toast: drive-time delta, and the customer gets a confirmation text. "Nothing here is new to you — that's the two-truck view you already use. What's new is the board arguing back."
4. **Make it argue.** Switch the right column to **Trevor Pate · Mon Sep 14**, then drag **McCollum** (Sub-Zero install, Diogo's call) onto it. Red chip: *Diogo owns this call — ran the diag*. Say: "The tech who diagnoses owns the install. It'll let you override for a sick day, but it makes you say why."
5. **Unscheduled.** Point at the bucket on the right: Lynn Osler with parts in — "Diogo's call, waiting on the customer to pick a time. In the real thing she got a text ten minutes after the part checked in." Greta Hartmann — "Fredericksburg. She's in the West bucket, not on a route."
6. **The West.** Switch the left column to **John Merz · Wed Sep 16**. Header reads *West trip · confirmed by Demitrius · 4 stops in bucket · oldest request 6 business days*. Say: "This is the rule we coach — don't run one Fredericksburg call and four local ones. The system watched the bucket fill and proposed the day. You confirmed it. Nothing went to a customer until you did." Point at the **min drive/stop** number and the ⚠ threshold. "Inter-stop drive. That flag is the lone-San-Antonio-call catch."
7. **Show the replay finding, verbally:** "In the current schedule there are seven days in the next two weeks where a tech drives out for a single far stop — Blanco three times, Horseshoe Bay once, Bulverde once. The bucket would have grouped them."
8. **Tracker, 60 seconds.** Click **Customer tracker → SV00123383 · Lynn**. Show the nine stages, "Your part arrived — pick an install time," and pick **Wed 8–12**. Flip back to the board: she's on Diogo's Wednesday. "The customer scheduled herself, with her tech, in a window we had room for."

**If something breaks:** reload the tab and click the fill strip cell you need. Skip step 7 if time is short; skip step 8 if Demitrius is engaged — let him keep dragging.

## Closing (1 min)

Back to slide 6. Read the three asks again, then stop talking. Write down who volunteers. If nobody does, ask Andrew or Trevor directly for the field-tool pilot (Andrew has the lowest diag-only rate; Trevor has the most quotes out) and ask Demitrius for the hour.

## Questions you'll get, and the short answer

- *"What if the phone has no signal?"* — Photos and notes save on the phone first and upload when there's signal; the tool says so on screen. Same pattern as the maintenance portal.
- *"Who types it into ePASS?"* — Michael, from a packet with copy buttons, until NetSuite. The next 15-minute export confirms it happened. Techs never open ePASS again.
- *"What if the customer picks a bad time?"* — They can only pick windows we have room for, with a tech who covers their zone. Inside 48 hours they only see windows that fit a route already near them.
- *"John does his own thing."* — Still does. The office builds his trip, he sequences it, the optimizer never touches his stops.
- *"Parts prices change daily."* — Verify still happens before ordering. Over 10% higher and the customer re-approves by text before we order.
- *"This is a lot."* — Phase 1 is a tracker and texts driven by what's already in ePASS. It changes nothing about how anyone in this room works, and it's the thing that stops the phone ringing.
