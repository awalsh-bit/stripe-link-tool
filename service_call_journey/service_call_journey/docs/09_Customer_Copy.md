# Customer-facing copy — everything a customer reads, in one place

For Cayden and Noell to edit before it's built. Every line here ends up in the `settings` table as an editable template, so changing tone later is a form field, not a code change. Rules the copy follows: plain words, one idea per message, always say what happens next and what (if anything) the customer needs to do, never a status code, never "please be advised." Texts are written to fit one segment where possible (≤160 characters before the link). `{tech_first}` is the tech's first name only; `{link}` is the customer's private tracker link; `{unit}` is the unit in the customer's words ("your dishwasher", "your Sub-Zero").

Sender line on every text: **Wilson AC & Appliance**. Reply handling: replies go to Podium and land with Client Care; the tracker link is the primary action.

---

## 1. Text and email templates (by trigger)

Each template has: when it fires, the text version, the email subject + body, and notes.

### request_received — form submitted
**Text:** We've got your request for {unit}. Your reference is {ref}. Track it and manage your visit here: {link}
**Email subject:** We received your repair request ({ref})
**Email body:** Thanks for choosing Wilson. We have your request for {unit} at {address_short}. Nothing is charged today — the card you saved is used only for approved work. You can see status, pick or change your appointment, and reach us any time from your tracker: {link}
Notes: sent to everyone, every booking mode. If they picked a window on the form, `so1_booked` follows within a minute — the two can be merged into one text (setting `merge_request_and_booked`, default on).

### request_bucketed — form submitted, designated_days zone
**Text:** We group visits in your area so we can get to you efficiently. We'll text you a date within a few days. Need it sooner? {link}
**Email subject:** Scheduling your visit in {area}
**Email body:** We service {area} in grouped trips so a technician can spend the day near you rather than driving out for one stop. We'll text you a date within a few days — most customers hear from us inside a week. If it's urgent, message Client Care from your tracker and we'll see what we can do: {link}

### request_office_only — form submitted, office_only zone
**Text:** Thanks — Client Care will call you within one business day to set up your visit. Your tracker: {link}
**Email body:** Your address is outside our regular routes, so a person will call you within one business day to find a time that works. Your request is saved and your reference is {ref}.

### so1_booked — diagnostic booked (customer or staff)
**Text:** Diagnostic booked {day_long} {window_long}. {tech_first} is your technician. Please make sure we can reach the unit. Change it here: {link}
**Email subject:** Your diagnostic visit is {day_long}
**Email body:** {tech_first} will arrive between {window_long} on {day_long}. Before the visit: clear a path to {unit}, and if it's a built-in, please have anything blocking the panels moved. You'll get a text the day before and another when {tech_first} is on the way. Need to change it? Use your tracker up to 48 hours before: {link}
Notes: for warranty jobs append "This visit is covered under warranty." For landlord/PM bookings, cc the property contact.

### reminder_day_before — 5:00 pm the day before any visit
**Text:** Reminder: {tech_first} arrives tomorrow between {window_long}. Anything changed? {link}

### on_my_way — tech taps On my way
**Text:** {tech_first} from Wilson is on the way, arriving around {eta}.
Notes: no link; this is the one message that shouldn't ask for anything.

### quote_sent — estimate ready (office path)
**Text:** Your estimate for {unit} is ready: {link}. You can approve it, ask a question, or look at replacement options from the same page.
**Email subject:** Your repair estimate for {unit}
**Email body:** {tech_first} diagnosed {unit} on {diag_day}. Your estimate is ready to review. Approve online and we'll order parts right away; the diagnostic you've already had is included in the price. If you'd rather replace than repair, the same page lets you ask our showroom team for options. {link}

### quote_reminder_48h / quote_reminder_5d
**Text (48 h):** Still thinking it over? Your estimate for {unit} is here whenever you're ready: {link}
**Text (5 d):** Your estimate for {unit} is still open. Approve, ask a question, or let us know you've decided otherwise: {link}
Notes: after day 10 a person calls; after day 14 the request closes with the diagnostic fee and `declined_receipt`.

### quote_revised — parts came back higher than quoted in the field
**Text:** A part price changed when we checked with the supplier. Your new total is {total}. Please take a look and re-approve here: {link}
**Email body:** When we placed the order for {unit}, the supplier's price for {part_name} was higher than what {tech_first} had on hand. Your updated total is {total} (was {old_total}). We won't order until you've had a look and re-approved: {link}

### total_down — parts came back lower
**Text:** Good news — a part for {unit} came in lower than quoted. Your total is now {total}. Nothing to do; we're ordering.

### approved_ordering — approval received
**Text:** Thank you! We're ordering parts for {unit} now and will text the expected date. {link}

### parts_ordered — PO placed
**Text:** Parts for {unit} are ordered and expected {eta_day}. We'll text the moment they check in so you can pick your install time. {link}
Notes: if the customer held a date (SO4PRE): "…expected {eta_day}. Your {held_day} appointment is on hold for them and will confirm when they arrive."

### parts_delay — ETA moved more than 2 days
**Text:** Update on {unit}: the part is now expected {eta_day}. Sorry for the wait — the latest is always here: {link}
Notes: if a held date is affected, use `reschedule_needed` instead.

### part_arrived_pick_time — all parts in
**Text:** Your part is in! Pick an install time with {tech_first}: {link}
**Email body:** The part for {unit} checked in at our shop today. {tech_first}, who diagnosed it, will do the install. Pick a window that works for you and it's confirmed instantly: {link}
Notes ⟨9/18⟩: for the interim this is the text that becomes **ready** when the next ePASS import shows SO5 — Kezia received the part and set SO5 in ePASS, not in our tool. It is sent on an explicit click in the office tool, or automatically only when its toggle (`notify.part_arrived_pick_time.auto`, default off) is on. Nothing goes out on its own.

### held_confirmed — SO4PRE part arrived in time
**Text:** Your part arrived — your {day_long} {window_long} appointment with {tech_first} is confirmed.

### install_confirmed — install window picked
**Text:** Install confirmed {day_long} {window_long} with {tech_first}. You'll get a reminder the day before. {link}

### trip_date_offered — a trip to a far area is confirmed
**Text:** We can be in {area} on {day_long}. Tap to confirm a morning or afternoon window: {link}
Notes: if they don't confirm within 2 business days, a second text: "Still want the {day_long} visit in {area}? Confirm here or we'll offer the next trip: {link}"

### reschedule_needed — no access, ETA slipped past a held date, tech out
**Text:** We need to move your {unit} appointment. Pick a new time here and we'll confirm right away: {link}
Notes: variants by cause — no access: "We came by today but couldn't get to {unit}. Pick a new time here: {link}" (diagnostic fee wording only if policy says so — currently not charged for no-access).

### hold_released_apology — held install released because the part didn't arrive (9/11 team ask)
**Text:** We're sorry — the part for {unit} hasn't arrived in time for {day_long}, so we've released that appointment rather than send {tech_first} out without it. It's now expected {eta_day}. Pick a new install time here and we'll confirm the moment the part checks in: {link}
**Email body:** We hold install dates ahead of the part arriving so you get the earliest possible slot, and this one didn't make it. Nothing is charged, your approval stands, and {tech_first} will still do the install. The supplier now shows {eta_day}; pick any window from that day on and it's yours: {link}
Notes: the picker only offers dates on or after the new ETA + 1 business day. Goes out at 2 pm the day before the held date (or earlier when Kezia records a later ETA). No `reminder_day_before` and no auto-confirm text is sent for a hold that is at risk.

### so4h_check_in — direct-ship part, day after the expected date, no "arrived" tap
**Text:** Has the part for {unit} arrived at your door? Tap here when it has and we'll schedule the install with {tech_first}: {link}
Notes: sent once; a second nudge after 3 more days copies Client Care.

### receipt — repair complete and paid
**Text:** {unit} is repaired. Your receipt: {link}. Thanks for choosing Wilson — a quick review means a lot to {tech_first}: {review_link}
**Email subject:** Your Wilson receipt — {unit}
**Email body:** Repair completed by {tech_first} on {day_long}. Charged to card ending {last4}: {total}. Itemized receipt and your signed approval are attached. If anything isn't right in the next 30 days, reply to this email or use your tracker and we'll take care of it.

### declined_receipt — estimate declined / replacement recommended / walked
**Text:** Your diagnostic receipt for {unit}: {link}. If you'd like to see replacement options, our showroom team can help: {showroom_link}
**Email body:** Thanks for having us out. The diagnostic fee of {diag_fee} was charged to card ending {last4}; your itemized receipt is attached. {tech_first}'s findings are on your tracker if you want them for reference. If you decide to repair later, the diagnostic is good for 30 days toward the repair.
Notes: "good for 30 days" is a proposed policy — confirm.

### parts_unavailable_notice — a part is discontinued ⟨9/18 pm⟩
**Text (sent by Noell on a click, through the estimate link — never automatic).** One sentence changes with the diagnostic decision (spec §5.3):

*Charged (standard):* Wilson Appliance: the {part} for your {unit} has been discontinued by the manufacturer and is no longer available from any of our suppliers, so the repair can't go ahead. The $169.95 diagnostic for the visit still applies. If you'd like help choosing a replacement, our showroom team can take it from here: {link}. Questions — reply here or call the office.

*Waived:* …no longer available from any of our suppliers, so the repair can't go ahead. **We're not charging the diagnostic for this visit.** If you'd like help choosing a replacement…

*Credited (proposed, not policy yet):* …The $169.95 diagnostic for the visit still applies, and we'll credit it in full against a replacement if you buy from us. If you'd like help choosing a replacement…

**On the estimate page:** the same sentence, then one button — *Help me choose a replacement* — which is the page's existing "shopping" outcome (the showroom queue). No total, no approve button.

Notes: "discontinued by the manufacturer and is no longer available from any of our suppliers" is deliberate — Cayden, 9/18: *we truly have no control over what the manufacturers do with replacement parts*, and the customer is usually upset, so the sentence should say whose decision it was without sounding defensive. Never write "obsolete" to a customer. If a substitute part exists the office re-quotes instead and this notice is never sent. Warranty tickets: the manufacturer decides on replacement or prorate — the office notes it for the claim; the customer wording stays the same.

### payment_link — card on file failed
**Text:** We couldn't process the card on file for {unit} ({total}). Pay securely here: {pay_link}. Questions? Reply to this text.

### quiet_period — nothing has changed in 7 days
**Text:** Still working on {unit} — nothing needed from you right now. Latest here: {link}
Notes: fires at most once per status; not sent while a quote is awaiting the customer (the reminders cover that).

---

## 2a. The confirmation page ⟨9/18 late⟩

The page a customer lands on the moment they finish the request. Its job is not to congratulate them — it is
to make sure they keep the link, because the link is the portal (`wilsonappliance.com/t/{token}`, no order
number, no password). Three variants off one template; the four sections below are the same in all three.

**Header** — the tick, then:

| variant | heading | second line | under it |
|---|---|---|---|
| booked (`open` zone) | You're booked, {first} | Diagnostic {day_long} · {window_long} | {tech_first} is your technician. You'll get a text the day before, and another when he's on the way. |
| trip bucket (`designated_days`) | Request received, {first} | We'll text you a date within a few days | We run {area} in grouped trips so a technician can spend the day near you. Most customers hear from us inside a week. |
| office only | Request received, {first} | We'll call you within one business day | {area} is outside our regular routes, so Client Care will find a time with you directly. Nothing else is needed right now. |

Then, small: `Reference {ref} · {unit} · we've texted you a confirmation` ("emailed" when the contact
preference is email).

**Section 1 — the link.** Heading: **"Save this link — it's how you follow your repair."** Under it: "It
opens straight to your repair. No order number, no password." Then the URL in a copyable box with a **Copy**
button, then what it is for:

- See exactly where your repair stands, updated as it happens
- Change or cancel your appointment up to 48 hours before *(bucket and office-only variants: "Pick your appointment as soon as we offer dates")*
- Read and approve your estimate — that's where it arrives
- Track the part and pick your install time when it lands
- Message Client Care without hunting for a number

Closing line, in muted text: **"Keep it to yourself — anyone with this link can see your repair. Lost it? We
can send a fresh one."** ⟨This line stays. It is true, it is the reason the reissue button exists, and a
customer who knows it is a customer who doesn't paste the link into a neighbourhood group.⟩

**Section 2 — "Keep it somewhere you'll find it."** Three collapsed rows, in this order:

1. **Put it on your home screen** — *Opens like an app — the surest way not to lose it.* iPhone: "Tap the
   **Share** button at the bottom of Safari (the square with an arrow). / Scroll down and tap **Add to Home
   Screen**. / Tap **Add**. Wilson Repair now sits with your apps." Android: "Tap the **⋮** menu at the top
   right of Chrome. / Tap **Add to Home screen**. / Tap **Add**. Wilson Repair now sits with your apps."
2. **Email me the link** — *A backup copy you can find on a computer.* "We'll send this one link and nothing
   else." Address field + **Send it**. (Customer-initiated, so it needs no template toggle — §6b. The address
   is used for that one send and does not become the email on file.)
3. **Bookmark this page** — *If you're on a computer.* "Press **Ctrl+D** (Windows) or **⌘+D** (Mac) right
   now, or use the copy button above and paste it wherever you keep things."

**Section 3 — "What happens next."** Three numbered steps. Booked: *Before the visit* — "Clear a path to
your {unit} and make sure we can see the model tag." *On the day* — "{tech_first} texts you when he's on the
way, then diagnoses the problem on site." *After the diagnostic* — "If it needs parts, your estimate arrives
on this same link — approve it there and we order." Not yet booked: *Next* — "We'll text you as soon as we
have a date." *When you have a date* — "It appears on your tracker and you can change it there." *After the
diagnostic* — as above.

**Section 4 — "What you'll be charged."** "Nothing today — the card you saved isn't charged for the visit
itself. The diagnostic is **$169.95**. If you approve a repair it's included in that price, not added to it;
if you decide not to go ahead, the $169.95 is what you pay." ⟨One paragraph, on the page, every time. It is
the question every customer asks and the one the confirmation email never answers.⟩

**Button:** "Open my tracker."

**On the tracker afterwards**, once, in a dashed bar under the actions: "This page is your private link —
save it and you can come straight back." + **Copy link**.

---

## 2. Tracker page copy

**Header:** "Hi {first}, here's your repair" · {unit} · {problem_short}

**Stage names** (in order; the active one shows its detail card):
1. Request received
2. Diagnostic scheduled
3. Diagnosed
4. Estimate ready
5. Approved
6. Parts ordered
7. Part arrived
8. Install scheduled
9. Repair complete

**Detail cards by stage** (the "Right now / Next up / Action needed" box):

- Request received (open zone, no time picked): *Action needed* — "Pick your diagnostic time" + picker.
- Request received (designated_days, no trip): *Right now* — "We group visits in your area. We'll text you a date within a few days." + Message Client Care.
- Request received (office_only): *Right now* — "Client Care will call you within one business day."
- Diagnostic scheduled: *Next up* — "Diagnostic visit {day_long} · {window_long}. {tech_first} is your technician. You'll get a text when he's on the way. Please clear access to the unit." Actions: Reschedule (≥48 h), Add gate code or note, Cancel request.
- Diagnosed (SO2/SO2.1): *Right now* — "{tech_first} found {cause_plain}. We're pricing the parts and your estimate will be here shortly."
- Estimate ready (SO2.2): *Action needed* — "Your estimate is ready" + Approve / Ask a question / Look at replacement options.
- Approved (SO3): *Right now* — "Ordering your parts. We'll show the expected date here as soon as the supplier confirms it."
- Parts ordered (SO4): *Right now* — "Your part is on order · expected {eta_day}." Option: "Hold an install time now" (explain: "confirms automatically when the part checks in").
- Parts ordered (SO4B): *Right now* — "Your part is backordered · now expected {eta_day}. We're sorry — we check with the supplier daily."
- Parts ordered (SO4H): *Right now* — "Your part is shipping straight to you · expected {eta_day}. {carrier}. Tap the button below the moment it arrives and you'll pick an install time with {tech_first} right away. If we haven't heard from you the day after it's due, we'll text to check." + **"📦 My part arrived"** button (9/11: this is the GE direct-ship case the team raised; tapping moves the job to *Part arrived* and opens the picker with the owning tech's windows). After the tap: *Action needed* — "Great — your part is there. Pick an install time. {tech_first} will bring the tools and finish the repair; please keep the part boxed until he arrives."
- Install held (SO4PRE) whose part didn't make it: *Right now* — "We've released your {day_long} appointment — the part is now expected {eta_day}. Pick a new install time from {eta_day_plus1} on." (same wording as the `hold_released_apology` text).
- Part arrived (SO5): *Action needed* — "Your part arrived — pick an install time" + picker (owner's openings).
- Install scheduled (SO6): *Next up* — "Install {day_long} · {window_long}. {tech_first} will bring the part and finish the repair. Your card is charged only after the work is complete."
- Repair complete (SO8): *Done* — "Repaired {day_long} by {tech_first}. Receipt and your signed approval are below." + Review link.
- Declined (SO7): "Diagnostic complete. Receipt below. If you'd like replacement options, our showroom team can help."
- Cancelled (SO9): "This request was cancelled on {date}. Need us again? Start a new request."

**The estimate page ⟨9/18⟩:** for the interim it is the existing Agility estimate page, not one of ours. Labor shows as **"Labor (2 entries)"** — the zone fee (`ZN1`–`ZN4`, by the call's distance from the shop) and the component replacement — above parts, S&H, subtotal, tax and total, with the Parts ETA sentence: *Once approved, we will order the parts listed to complete the repair and schedule your technician {tech} to return between {eta_from} and {eta_to}.* The $169.95 diagnostic quoted throughout this document is `DZ1` $157 + 8.25% tax, which is how ePASS books it; the two figures were never in conflict. Whether the customer page should name the zone fee or leave "Labor (2 entries)" as the module renders it is §5 item 6.

**The offer window (9/14 route-first dates, rewritten 9/17 pm after the test bench):** the customer's
calendar *starts* on the day that is best for Wilson within three business days of our first open
capacity (spec §4.3). Earlier windows are simply not offered. The top card is always the first day shown,
so it is always, truthfully from where the customer stands, the earliest available:
- When our route already has stops in the customer's zone that day: **"Earliest available — and our route is
  already in your area"**; body: "Our technician is already in your area that day — picking it means less
  driving for us and a tighter arrival window for you. All other openings are below." Button: "Take this
  window". ⟨Cayden 9/17: keep this wording.⟩
- Otherwise: **"Earliest available"**; body: "{tech_first} covers your area that day. All other openings are below."
- After a penciled install (SO5 with a pencil): **"Earliest available — your installer is already nearby"**;
  body: "{tech_first} is already working near you that day, so this is the quickest we can get your part installed."
- The words "best fit", "closest to our route" and "this week" never appear on a customer screen. Never say
  "only" or "must". Nothing is said about windows that were not offered.
- Parts ordered (SO4) with a pencil on the board: "We've already lined up a spot with {tech_first} for a
  couple of days after it lands — you'll see it first when we text you. You can also hold a time now."

**Picker copy:** "Pick an arrival window" / "Showing openings for technicians who cover {zip}" / "Showing {tech_first}'s openings — he diagnosed your unit and will finish the repair" / "Grey windows are full" / "Confirmation is instant — no call needed." Inside 48 h: "Your visit is soon, so only windows that fit a route already near you are shown." Nothing fits: "Nothing fit? Message Client Care."

**Footer FAQ (three items, expandable):**
- **Why does a part take a week?** Most parts ship from regional warehouses in 2–5 business days; some brands ship from the manufacturer and take longer. We text you the moment it checks in.
- **Why the same technician?** The tech who diagnosed your unit knows exactly what he found and what he needs. Installs stay with him so nothing gets lost in translation.
- **What am I charged and when?** Nothing at the diagnostic visit. If you approve a repair, the diagnostic is included and the total is charged after the work is complete and tested. If you decline, the diagnostic fee of $169.95 is charged.

---

## 3. Field tool — the wording the customer sees on the tech's phone

**Authorization (field quote, shown above the signature):**
"I approve the work above for {total} and authorize Wilson AC & Appliance to charge the card I saved with my service request once the repair is complete. I understand the diagnostic fee applies if I cancel."
Labor-only variant: "…to charge the card I saved with my service request when the repair is complete today."

**Totals block labels:** Diagnostic — included · Labor ({hours} h) · Parts · Shipping & handling · Sales tax — parts · Sales tax — labor (or "exempt · built-in") · **Total charged to card on file**.

**Under the total:** "Charged after the part is installed and the unit is tested. If declined, the $169.95 diagnostic is charged instead."

---

## 4. Intake form — step 2 (new)

Eyebrow: "Appliance repair request · step 2 of 2". Heading: "Almost done — when should we come?" Card line: "✓ Card saved securely ({brand} ····{last4}) — nothing is charged today."
Open zone → picker. Designated days → "We group visits in your area. We run {area} in grouped trips so we can get to you efficiently. We'll text you a date within a few days — most customers hear from us inside a week. Need it sooner? Message Client Care." Button: "Finish request — text me a date". Office only → "Thanks, {first} — we'll call you to schedule. {area} is outside our regular routes. Client Care will call within one business day. You'll get a text confirmation now with your request number." Button: "Finish request".

---

## 5. Open wording decisions

1. "Diagnostic good for 30 days toward a repair" on declined receipts — is that policy?
2. No-access visits: charge nothing (current copy) or the diagnostic fee?
3. Tech first name and photo on the tracker, or first name only? (Copy assumes first name only.)
4. Email as a channel at all, or text-only with email receipts? (Templates include both; Podium handles both.)
5. Review link destination (Google? in-house?).
6. ⟨9/18⟩ The estimate page shows "Labor (2 entries)" for the zone fee and the component replacement. Leave it as the Agility module renders it, or name the zone fee on the customer page? And on the receipt, show the diagnostic as $157 + tax (as ePASS books it) or as $169.95 (as every text here says)?
7. ~~⟨9/18 pm⟩ `parts_unavailable_notice`: does it mention the diagnostic fee?~~ **Answered 9/18 pm** — it says so plainly, and the sentence follows what the office chose (charged / waived / credited). Still open: whether the **credit** wording may be used at all, since that option is a proposal rather than policy.
