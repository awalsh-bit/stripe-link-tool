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

### payment_link — card on file failed
**Text:** We couldn't process the card on file for {unit} ({total}). Pay securely here: {pay_link}. Questions? Reply to this text.

### quiet_period — nothing has changed in 7 days
**Text:** Still working on {unit} — nothing needed from you right now. Latest here: {link}
Notes: fires at most once per status; not sent while a quote is awaiting the customer (the reminders cover that).

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
