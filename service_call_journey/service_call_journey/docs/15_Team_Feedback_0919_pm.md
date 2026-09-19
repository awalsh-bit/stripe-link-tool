# Testing round · September 19, 2026 (pm) — the other eight

The morning's pass was the field tool. This one is everything else on Cayden's list: three dead buttons on
the customer's page, a way to end a call, two things the office could not do to a price, a quote nobody
could start, and the damage report — which turned out to be the most interesting workflow in the system.

---

## The buttons that did nothing

> "the buttons other than reschedule dont currently work … if they click message client care, it should
> launch a text message to 512-894-0907 automatically that says something generic … cancel request gives
> them a success page … add gate code or note needs to launch a window to input something."

All three are the same shape underneath: the customer acting on their own repair, through their own link,
with nothing sent on their behalf. That link is a bearer credential — whoever holds it is the customer as
far as we can tell — so each one is deliberately narrow about what it can touch. None of them moves money,
changes an address, or reaches another job.

**Message Client Care** opens their messaging app to 512-894-0907 with the first line already written:

> Hi Wilson AC & Appliance — this is Linda, about my repair SV00123373 (GE front-load washer).

Then it stops and gives them the cursor. Generic, as asked, but not empty — because what actually wastes
Client Care's time is not the customer's question, it is working out whose repair they are asking about.
That is now answered before anyone types a word. There is no question mark in it: putting words in their
mouth is how you get an answer to a question nobody asked.

**Add gate code or note** opens a box for a gate, callbox or lockbox code and anything else the tech should
know — where to park, the dog, call first. It reaches his phone and shows on the job before he sets off,
which is the whole point: he should not be standing at a gate ringing them. It writes those two fields and
nothing else. A customer can tell us how to get in; changing where they live is still a phone call.

**Cancel request** asks once, offers the reasons people actually give, and then shows a success page that
leads with the thing they are actually worried about — *you haven't been charged* — names the window that
went back to the route, and offers to put it straight back. It stops being self-service the moment we have
bought a part: from SO3 the page says so and offers Client Care, because by then somebody has to decide
what happens to the part.

## Ending a call

> "we need a way to cancel a customer submitted service request … we just need it as an option to close out
> a call for whatever reason."

There was no way to end a call except by finishing it, so dead tickets sat on the board holding half-days
that should have gone to someone else. There is now one cancel with two doors — the customer's tracker and
the dispatcher's card — landing in the same place: SO9, the half-day back on the route, a reason on the
record, one packet for ePASS, and **Undo**, because the commonest thing after a cancel is finding out it
was the wrong ticket.

The dispatcher gets the reasons a customer would never pick (duplicate, couldn't reach them, no
authorization, do not service, office error) and a *Text the customer* box that is off unless ticked.
Cancelled calls leave the route without falling into Unscheduled. A ticket that already has parts against
it says so on the row: the call can close, the part is still someone's decision.

## Two things the office couldn't do to a price

**Shipping.** *"kezia needs to be able to set shipping in case theres a special order or something we get
charged more for than 25."* $25 is now a default rather than a constant. Kezia sets it per quote, and the
override carries who changed it and an optional why — freight, oversize, expedite — which travels onto the
ePASS packet so the person keying $187.50 can see it was deliberate. Putting it back to $25 clears the
override rather than recording a change to the same number.

> One thing that fell out of this and needs an answer: **we are not taxing S&H.** The spec says we should.
> Nobody noticed while it was always $25 — that is $2.06. On $187.50 of freight it is $15.47. Texas
> generally taxes delivery on taxable goods, but changing it moves every historical comparison, so it wants
> your accountant rather than me. Open item 49.

**Warranty.** *"for warranty calls that go straight to so3 its automatically adding a zone fee here."* It
was, and it shouldn't have been. Three rules now, everywhere a quote gets built:

no zone fee (the manufacturer is not a customer in a band of miles, and the trip is inside the flat rate);
tax exempt throughout (the claim is not a sale); and labor prices only on the brands that pay our COD rate
— True, Scotsman, Zephyr and BlueStar, confirmed by you this morning. Everything else shows the task with
**no figure at all**, marked as the warranty admin's to put on the claim.

That zero is deliberate and it stays until your rate book arrives. All 13,646 rows of the current one are
`Warranty = N`; the real rates only exist as history (`WTYSZ-SZ` $170.31, `WTYGE-GE` $122.58,
`WTYWP-KA` $110.01 and about thirty more). A tool that invents a warranty rate is worse than one that
admits it hasn't got one.

The brand comes off the unit, not the payer — a Sub-Zero billed through a home-warranty company is still a
Sub-Zero, and it is the manufacturer's rate card that decides.

## A quote the office can start

> "we still need a way to draw up a quote … i'm assuming it should live in office queues in estimates where
> the office team can just hit add new quote, add parts and labor themselves, or hit send to tech button if
> they cant find the part."

**Add new quote** in Estimates, exactly there. What matters is that it produces the *same quote object* a
tech submission produces — same zone fee, same $130/h, same warranty and tax rules — so an office-built
quote and a tech-built one are the same thing downstream and nothing further along has to know which it
was. It lands as Ready, never sent; the estimate still leaves on an explicit click like every other one.

**Send to the tech** is the half you asked for by name. When the office can't find the part, the pricing
goes back to the person who stood in front of the machine: the question lands at the top of his
notifications and comes back every morning until he answers, and the row waits in Noell's own list marked
*With the tech* rather than in a queue she doesn't open. When he submits, it becomes Ready, credited to him.

## The damage report

This is the one worth reading properly, because it is the only workflow in the system that starts somewhere
other than the request form and still has to end in the same place.

The form itself is untouched — your four steps, the truck and stop, the invoice lookup, the tag photo, the
damage photos with the side and the spot. It runs on the real sales export now, so typing `R00015638` pulls
the actual customer and every serialised unit on that delivery; a two-unit invoice never guesses which one
is damaged, it asks. The line it produces is the line your queue has printed for years:
*Issue: Dent or ding — Right — Bottom Right.*

Everything after Submit is new, and its shape comes from two facts about this kind of call.

**There is no diagnostic.** Somebody has already stood in front of the unit and photographed the damage.
Sending a tech in a van to go and look at it is precisely the waste we are removing — so the ticket is
created at SO2 with the photos standing in for the findings, and never touches SO1.

**The only missing piece is a part number**, and one person supplies it. So the ticket is born unassigned
and belongs to Mark until he has chosen the part. His review is four fields: the number, what the part is,
when it lands, who fits it. It refuses to move without the first two, because that is the whole of the job
it was waiting on.

From there it is an ordinary ticket on machinery that already exists — SO4 holds a fitting slot two
business days after the expected date, the part checks in as SO5, and the customer picks their install
window on the same tracker as everyone else. Their first contact about a repair they never asked for is a
text saying the part is in and here are some times, which is roughly the opposite of how that conversation
goes today.

One decision I made and want you to push back on if it's wrong: **the customer is never sent an estimate
for this.** We damaged it, we pay for it, so it goes straight to *order the part* rather than through the
quote stages. Routing it the normal way would email somebody a price for a repair they aren't being
charged for. The open question underneath it is whether a damage repair ever bills anyone — a freight
claim, the manufacturer — or whether it is always our cost. I've assumed always ours.

## What I need from you

1. **The warranty rate card** per manufacturer — you're sending the flat-rate book. Until it lands, every
   non-COD warranty job shows a blank where the labor should be.
2. **Is S&H taxed?** Above. Your accountant, not me.
3. **Damage reports** — should converting one into a service order be Mark's alone, since he's the one who
   knows whether it's ours? And does one ever bill anybody?

## Where things are

- Board v22 · Office v13 · Field tool v12 · Spec v20 (=v1.15) · Blueprint v25 (=v0.22).
- 42 Playwright checks on the tracker buttons and the cancel path, 52 on shipping/warranty/the quote
  builder, 69 on the damage report end to end, and the rest of the suite green — 367 in all.
- 72 Phase 0 tests, up from 66: `tracker.set_access` / `cancel` / `client_care_sms`, the warranty and tax
  rules in `labor.py`, and a new `damage.py` carrying the report through to the customer's install pick.
- One thing fixed in the harness rather than the app: the tests load the prototypes straight off disk,
  where there is no charset (the artifact service and `wrap.py` each supply one), so Chromium was
  occasionally decoding UTF-8 as latin-1 and failing every check containing an em dash. That was a test
  artefact producing false failures, and it is gone.
