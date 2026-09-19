# Testing round · September 19, 2026 (night) — seven asks, and what the audit turned up

Seven things in one message, one of them "go through everything you did today and find what's wrong." This round is
all seven, and the last one found more than I expected. The findings are at the end and they are mostly about my own
data, so I'd rather you read them than skim them.

---

## Kelli Kenney's speed oven — where it came from

> "kelli kenney ticket - says ge profile speed oven, its a ge profile built in refrigerator. can you investigate and
> figure out where the bad data came from?"

It came from me. Not from ePASS.

When the export has no product code for a ticket, the data loader guesses the category from the model number's prefix,
and one of the rules I wrote said `PSB → speed oven`. GE Profile's **PSB9** models are speed ovens; her **PSB42YSKSS** is
a 42-inch built-in refrigerator; the rule stopped reading at three letters. A rule that knows less than the history does.

Two fixes. The obvious one: PSB9 and PSB4 (and the same for Café's CSB9/CSB4) are now separate rules. The one that
matters: before any prefix rule fires, the loader now asks **what ePASS's own product code has called this model every
time it has been in before** — the twenty-year catalogue has 337 of the 615 open tickets' models on file — and only
guesses when the history is silent. 175 categories changed across the open book. Hers reads *built-in refrigerator*,
because the last time a PSB42YSKSS came through, in 2019, ePASS coded it REBIS.

Then, underneath that, a second thing I want to own outright. **Her ticket is COD in ePASS.** The warranty flag the
field tool showed on it — the one the whole warranty screen was demonstrated on yesterday morning — was set by hand so
there would be a warranty call on Diogo's Thursday route to show. That is exactly the kind of bad data you asked me to
find, and it was mine. It is gone. The warranty demo now runs on his real Friday: Allison Schmidt, Speed Queen dryer,
billed to Speed Queen Warranty. The field tool carries every one of his real routed days from the export (Thu, Fri, Mon,
Tue) with a picker in the banner, so a story never has to be invented on a real ticket again. Nothing on a stop is
hand-set any more: the flag, the payer and the category all come off the export.

## The part number stays blank

> "this field should just remain blank for the tech to key the part number we need"

Done, and you were right about why: the sample catalog is brand-agnostic, so the number it offered was the right part for
the wrong machine — worse than no number. Component *names* are still one tap (those are brand-agnostic); the number
field starts empty on every line, takes the cursor the moment the line is added, and the tech keys it. Kezia's verify
row flags a blank one and remembers what he keyed if she changes it.

## Where the tech's notes go

> "where are tech notes stored for current jobs? where do their findings recorded in field tool end up? we do need this
> to record their notes into history."

Three honest answers.

**In ePASS today**, the tech tells the office and the office re-types it into the ticket's *Work Performed* box. That
box is the whole reason twenty years of history reads as well as it does — every "read the last visit" in the field tool
is that box.

**In the prototype until tonight**, in the phone's memory and a toast. Nowhere, in other words. That was a gap.

**Now**: every Submit writes the visit the way the history has always been written — what the customer said, what was
found, the cause, the parts and labor, his note, the outcome — and it lands at the **top of that unit's history at
once**, in the same panel the next tech reads before he knocks, marked *This visit · you*. It opens like any past call.
On the office side the customer's record is one list: a call closed in 2019 and a call submitted ten minutes ago read
the same way, side by side. In the reference code the `findings` table — which the spec had described since 9/11 and
nobody had built — now exists, is written on every visit event, and is read back merged with the ePASS catalogue by
customer or by serial. ePASS keeps getting the first two hundred characters as the ticket note, so nothing is re-typed.

## Anyone in the office can edit

> "add the ability for anyone in the office to be able to edit customer, unit, tech notes any info"

Every ticket card has **✎ Edit**. Every field on it is editable — name, phone, email, preference, ZIP; appliance, model,
serial, built-in; the tech's note; the problem as reported — and any office role can do it. Two things keep it from being
loose. Every change goes into the ticket's activity log as *was → is*, with who, when and a **required one-line reason**;
the sheet will not save without one. And because ePASS is still the source of truth for ticket data, the same save puts a
paste-ready correction packet on the sync queue — field, was, is, why, by — so the ticket in ePASS says the same thing by
the end of the day. This tool never writes into ePASS; the office keys it, the next import confirms it.

The Kelli Kenney case is now a thirty-second fix by whoever sees it.

## The damage report — read, not rebuilt

> "you built the damage report into this tool, which isn't needed. it already exists, we just need to read the incoming
> data in the service request queue that already exists as well."

Quite right. The four-step form and its tab are gone from the board. What is left is the **read**: the panel is now
*Service request queue · incoming*, and it shows the row exactly as your queue already writes it — customer, address, ERP
S#, model and serial, *COSMETIC DAMAGE — field report by Foster Anzaldua*, *Issue: Dent or ding — Right — Bottom Right*,
the photos — built on a real delivery from the sales export. The one thing added is the button the queue never had:
*Create the service order*. Everything after that is unchanged from yesterday — Unassigned, owned by Mark, warranty by
default, SO4 hold, SO5, the customer picks the install time. The test bench can drop another incoming report to watch it
land.

## Drag a day onto the board

> "i click on Josh's 9/18 capacity bar and just drag it into the expanded area i want to see it. i drag to right or left
> depending on what i want."

Every capacity cell on the strip is now something you pick up. Drop it anywhere on the left or right board — the board
under the pointer lights up and says *Drop to open Josh Fri Sep 18 here* — and it opens there. A plain click still opens
the day on the left, for one-handed use. The Left / Right buttons are gone. Dragging a job card onto a board still books
it exactly as before; the two drags share one set of listeners and I tested that they don't interfere.

## The full pass

> "check for issues, find broken links and logic"

**Links**: none broken. Every internal anchor in the five pages resolves; the only external links are Google Fonts and
the five artifact URLs, checked against the live list. The README on your C: drive pointed at four stale artifact
addresses from an earlier session and described the prototypes as running on "invented sample data" with a v0.12
blueprint and 40 tests; it now has the five current links and the current state.

**Logic**: two over-claims in the warranty rate, both mine, both fixed with tests on both sides. The sealed-system test
matched the word *condenser*, so replacing a condenser **fan** motor — or cleaning the coils — would have claimed the
sealed-system rate. And the field tool read a ticket's *duration class* (built-in refrigeration takes longer) as
sealed-system work, so every built-in fridge warranty call — Mary Dietz's dripping noise included — would have claimed
$237.74 instead of $113.68. Sealed is now decided only by what the technician recorded: a sealed-system labor line or the
*Sealed-system work* flag. Same rule in the field tool, the office and the reference code.

**Data of our own making**, beyond Kelli Kenney's two. While the field tool was offering a Whirlpool drain-pump number on
a GE washer, the office tool was carrying a Whirlpool bake-element number on Pauline Stephenson's **Vent-A-Hood** — a
hand edit from 9/19 morning — and its sample-part table gave every hood a bake element. Both gone; hoods get a blower
motor sample, and no line anywhere arrives with a number nobody keyed. The office's sync-queue seeds had invented people
on real ticket numbers — "Maria Ortega" on William Blocker's SV, "Kim Cline" on Suzanne Colonna's, "Brandon Cox" on
Lindsay Chang's — and the field tool's notifications had "Ed Taylor" and "Mary Dietz" on tickets that were neither's.
Every seed row is now the real customer, unit, tech and status on that SV. Where the *content* is still illustrative —
a question Noell might ask, the van-maintenance block, the unit coming back from the bench — the screen now says
*sample*, the way the watch-out flag always has.

Smaller: a placeholder part line reported itself as *tech keyed sample-BM — you changed it* the moment Kezia keyed a
number (fixed); the tracker showed *Sep 18* dates on a board whose today is the 17th (derived now); the blueprint's §14
still listed twenty-three questions as open after §14a had answered them (struck through, with pointers, so the numbers
other documents use still hold).

The common thread is the one this whole project is about: data that looks right and isn't costs more than a blank.
Every one of these now has a check that fails if it comes back.

## What I still need

1. **Who may edit what** — any office role for everything, as built, or customer-record changes reserved to Client Care?
   And who keys the correction packets into ePASS, how fast (spec item 55; the default I've assumed is same day, same
   person).
2. **La Cornue and AGA**, and the three missing sealed rates — carried from last round.
3. **Open item 53** — is intake capturing a service address separately from the account address?

## Where things are

- Board v24 · Office v15 · Field tool v14 · Spec v22 (=v1.17) · Blueprint v27 (=v0.24).
- 15 Playwright suites, **499 checks, all green**: 74 on the field tool (23 new — the real warranty day, blank part
  numbers, the visit landing in history, the sealed-rate over-claims), 45 on the damage queue (rewritten for reading
  rather than the form), 39 on the board (10 new for drag-to-load), 20 new on the office edit, 7 on part numbers
  (rewritten so nothing arrives pre-filled), 53 on the office queues (2 new).
- 89 Phase 0 tests, up from 86: the `findings` table, the merged history reader, and the sealed-rate negatives.
- The classifier change touched 175 of 615 open tickets' categories. Sources now: history 337, ePASS code 153, model
  prefix 62, brand 23, none 40.
