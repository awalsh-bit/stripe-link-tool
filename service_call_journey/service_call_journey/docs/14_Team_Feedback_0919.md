# Testing round · September 19, 2026 — the field tool, rebuilt around the tech

Cayden's list this time ran to twenty-four items across all four screens. This pass is the field tool,
end to end — sixteen of them — because that is where the techs are and because most of the list is one
idea wearing several hats: **the tech builds and prices the repair, whatever happens to it next.**

---

## One estimate flow, not two

> "field quote generates a different workflow than office sends quote right now. lets make this
> consistent. even if office is sending quote, we need the tech to be the one to really build and price
> it."

Until now there were two paths out of a diagnostic. *Quote the repair now* opened a full pricing screen
with tasks, parts, totals and a signature. *Needs parts — office sends quote* opened something much
thinner: tap a part, tap a single labor bracket, done. The tech who had just spent an hour with the
machine got the weaker tool in the case that happens far more often.

There is now one flow. Parts, then labor, then a total — the same screen whichever way the quote
travels afterwards. What changes at the end is only who presses send.

**Field quoting itself is off**, behind `FIELD_QUOTE = false`, per Cayden's own call: it should not come
back until a part price can be verified at the door rather than guessed. Nothing was deleted; the whole
customer-signature path is still there and is one flag away. What was good about it — the labor lines,
the totals, the tax treatment — is now what everyone uses.

## Labor: the book proposes, the tech decides

> "the tech will select a component install labor line, the system prices it out below, but the tech
> still manually clicks the job time … this is where we let the techs really be salespeople and build
> relationships … theyre the only ones that know exactly what theyre going to have to do."

The flat-rate book's hours are now **hidden**. A labor line arrives with no time on it and the row sits
highlighted until the tech says how long: 30 min, 1 hr, 1.5, 2, 3, half day, full day. The price follows
his number, at $130/hr.

If we have no line for what he is about to do — a pressure sensor on a washer that happens to have one —
he types it and it becomes a line of its own, priced the same way, marked *typed in — not in the book*.
Those are worth collecting: a line that keeps getting typed is a line the book is missing.

Then the **labor total is his to move.** It shows as an editable figure with what the book said beside
it, and any change is recorded as his. The reasons Cayden gave for this are the whole argument — a
customer who has already spent money twice, a house the tech knows, a job he can see will go quicker or
slower than the sheet says. He is on commission; this is the part of the job that is actually his.

## The outcome, as one field

> "make the outcome a dropdown field with all of the options instead of a list of buttons you have to
> scroll past. this makes it easier to look at and less overwhelming."

Seven stacked buttons became one dropdown, already set to the usual answer: a COD diagnostic on *office
sends the quote*, a warranty diagnostic on *straight to SO3 · parts verify*, a part-install trip on
*repair complete*. Under it, one line saying where that outcome sends the ticket. The tech changes it
only when the visit was not the usual one, which is most days never.

## Typing that finishes your sentence

> "can we have the text box pull related one click options as they type? … if on the GTW465 the issue is
> wont drain, failed component, bad pressure sensor, when the tech hits other component, can we have it
> auto populate results as they start typing pressure sensor?"

Every free-text box on the screen — what you found, cause, the component, the labor line — is now also a
picker. What it offers first is **what this model family has actually needed before**, from the ODBC
parts history. On Leah Baird's GE GTW465 it offers valve, main control board, agitator base, auger,
because those are what went into thirty-five of them. Type three letters, tap, move on. Typing still
wins — the list never blocks anything.

Two of these boxes were behind a chip you had to notice and click. They are just boxes now, visible from
the start, which is what Cayden asked: *"actually make the custom note options just a text box they can
start typing in? this way its more visibile that its there."*

## Parts, and the part number

> "remove this text under other component in parts — no part # yet, the office adds it from your
> description — i dont want techs thinking they can just not look up parts."

Gone, along with *leave blank if you can't find it* on the field itself. Tapping a known component now
brings its part number with it from the catalog, so the common case needs no typing at all. The number
is still not a hard block — a tech standing in a crawlspace with no signal should not be stuck — but
nothing on the screen suggests looking it up is optional any more, and the send bar counts what is
missing.

On Kezia's side the number now **arrives on the Parts Verify row in a field she can use**: copy it to
paste into the supplier, or correct it when the tech got it wrong or the supplier superseded it. If she
changes it, the card keeps what he sent — *tech keyed W10779716 — you changed it* — so a pattern of
wrong numbers is visible rather than silently fixed forever.

The component picker also gets out of the way once a part is chosen, and **Add another part** brings it
back, which is the interaction Cayden described.

## Looking ahead at his own week

> "add a button the tech can hit to see the dispatch board and look ahead at their route for upcoming
> days. the techs view through this button should only show them their route and calls and filter out
> the rest. they should not be able to change anything in this view."

**My route ahead** on the route screen: his next working days, his stops, real data from the 9/17 export
— Friday, Monday, Tuesday, nine stops. Windows, addresses, units, SVs, balances to collect. There is
nothing on the screen to press except Back: no inputs, no drag, no save. The banner says so plainly and
says who does own it — *if a date needs to change, message the office and they move it.*

## The smaller ones

- **Notifications sit above the next call now.** They were below it, which meant the thing that comes
  back every morning until you answer it was the thing you scrolled past.
- **"Completed work photo" and "Problem photo" both read "Any relevant photos?"** — Cayden's wording.
  The old labels told a tech what kind of photo counted, which meant the one he wanted to send didn't.
- **Can't-access-unit stops demanding a serial tag photo.** Obvious in hindsight: he couldn't reach the
  unit, so he can't photograph its tag.

## Warranty, the part of it that lives in the field

Cayden listed warranty under office queues, but half of it is a field-tool question, so it is in:
**True, Scotsman, Zephyr and BlueStar pay our COD rate**, so on those the tech quotes labor like any
other job. Every other warranty brand gets no labor screen at all — it says the flat rate is the
warranty admin's to add when the claim is filed. Warranty jobs carry **no zone fee** and are **tax
exempt** throughout.

> **One thing to flag: the flat rates are not in the rate book.** All 13,646 rows of the 2025.6.21 book
> are `Warranty = N`, `Flat Rate = Y`; the only warranty lines in it are two Trane extended-warranty
> entries. The actual rates only exist as history — `WTY1-SPEED` $153.78, `WTYSZ-SZ` $170.31,
> `WTYWOLF-WOLF` $171.83, `WTYGE-GE` $122.58, `WTYBSH-BOSCH` $116.51, `WTYWP-KA` $110.01 and about
> thirty more, averaged off 2024–26 tickets. Before the tool can put a number on a warranty job someone
> has to give it the current rate card per manufacturer. Until then it correctly shows nothing rather
> than a guess.

## On tying parts pricing to a distributor

Cayden asked for suggestions. The useful finding: **ePASS already has a Marcone integration**, and it
does exactly what field quoting was waiting for — live part number, description, price (dealer, retail
and list), warehouse, quantity available, and a status flag that includes **discontinued**. It needs
Marcone to switch on B2B web services for the Wilson account, then the credentials go in the Item
Inventory variables under the integration tab, with per-user security flags.

That is worth pursuing before anything is built, for three reasons. It is already paid for. It would
feed yesterday's discontinued-part work from the supplier rather than from Kezia noticing. And it is the
one thing standing between us and turning field quoting back on — a tech who can see a real Marcone
price at the door can quote at the door.

Two caveats. It is ePASS's integration, not ours, so reaching it from Agility means either ePASS
exposing it or Wilson getting its own Marcone B2B credentials and calling the same service directly —
worth one phone call to Marcone to establish which. And it is one supplier: Reliable and Encompass would
still be manual, so Kezia's verify step does not disappear, it just gets much shorter on the parts that
come from Marcone.

## Where the other eight items are

Not in this pass, and not forgotten — the tracker buttons (text Client Care, cancel, gate code), the
board's cancel-a-request, Kezia's shipping override, the standalone quote builder in Estimates, and the
installer damage-report intake that lands in the service request queue and goes to Mark Perks for a part
number. The damage-report one is the biggest and most interesting: it is the only workflow that starts
somewhere other than the request form and still has to end up in the same place.

## Where things are

- Field tool v12 · Office v12 · Board v21 · Spec v19 (=v1.14) · Blueprint v24 (=v0.21).
- 46 Playwright checks on the new field flow, 6 on the part-number hand-off, and the rest of the suite
  green. `verify_field2.js` is retired — it asserted the field-quote UI that is now behind the flag.
- 66 Phase 0 tests still green; nothing server-side changed this round.
