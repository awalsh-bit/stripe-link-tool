# v0.9.50 - The spotlight gets a real exit

> "adding refrigerator options should have a clickable button for the
> customer to hit after they select guardian or filter service. as it exists
> now, the customer has to click outside of the pop up window to go back to
> registering. right now if you hit guardian on the pop up it feels like
> nothing happens"

Two problems, one footer. The add-on spotlight now ends in a full-width
**Continue registering** button, with the maybe-later link kept beneath it
as the no-thanks path — nobody has to discover that the backdrop is
clickable. And a selection now visibly lands in two places: the add button
confirms ("✓ Added", tinted as picked), and the continue button restates
what was chosen — "Done — Guardian added. Continue registering", turning
green. Same for filter service, and for both together.

QA: the browser smoke walks the whole gesture — button present, starts
plain, Guardian tap relabels it, clicking it closes the spotlight, and the
selection survives onto the appliance card (265 checks). The suite's
spotlight dismissal now tolerates the two explicit exits.

# v0.9.49 - Filter verification, the launch guardrail, drill labeling, and the customer information page

The big work order: prior-art scan filed, failure-signature metrics designed,
the back-end dash de-noised, filters reworked around VERIFICATION, the
visit-launch guardrail, the field fixes, the proration correction, and the
customer-facing expectations page.

## Guardian: the science and the lab notebook

- `docs/GUARDIAN_PATENT_LANDSCAPE.md` — the prior-art scan. Short version:
  the threshold+dispatch layer is long-expired prior art (safe to ship); the
  whitespace worth a provisional is multi-compartment differential diagnosis
  from aftermarket probes. The labeled drill DATASET is a trade secret; keep
  it out of anything customer-visible, and nothing about failure-mode
  classification goes public before counsel files.
- `docs/GUARDIAN_FAILURE_SIGNATURES.md` — the failure taxonomy (door /
  gasket / no-compressor / no-evap-fan / failed-defrost / condenser / damper
  / power-loss), the eight metrics that separate them, and the showroom
  drill protocol that will produce the training data.
- The pilot server grew DRILL LABELING: `POST /drill {channelId, mode}`
  before inducing a failure, `POST /drill/end` after full recovery. Readings
  during a drill are appended to a durable training file the moment they
  arrive (never pruned with the 48h live store), incidents during a drill
  are stamped with the mode (detection latency straight off the log), and
  `/export.jsonl` + `/export.csv` are the labeled dataset. Modes are a
  strict list — a training set with three spellings of "no evap fan" is a
  training set someone cleans by hand. 36 pilot-server checks now.

## The back end: functionality and simplicity, no noise

- **"Appliances trending down" is gone from the command center.** There is
  no office action on a drifting reading; the customer sees the trend in
  their reports year over year, which is the product doing its job. Decline
  detection is untouched — household files and reports still surface it.
- **"Filters due" became "Filter verification."** The filter is always
  replaced at the maintenance visit, so a due date was queue noise. The
  office's real filter job is confirming the PART NUMBER: every filter
  record now carries `verified`, new registrations land unverified by
  construction (the customer is never asked for a model number), and the
  queue holds only unverified filters — no part on file sorts first.
- **Jack Ort's Filter Finder is in the portal** as `filter-finder.html`
  (his handoff option 2: dropped in as a page, data and confidence badges
  verbatim). Queue cards deep-link it with the unit's brand, model and
  serial prefilled, and the lookup runs itself on arrival. "Mark verified"
  records the confirmed part number through the store.

## Registration filter pricing: frictionless, priced as an estimate

Registration stays exactly as it is — no model-number hurdle. Filter service
prices at the standard per-filter rate, the builder and the quote both say
it is an estimate verified before the first charge, and the Filter
verification queue is what trues it up. (`estimateNote` in plan-config is
the one sentence that promise lives in.)

## The visit-launch guardrail

`WilsonStore.applianceVisitLaunch()` makes one decision the household page
renders: RESUME an open visit that already has field work (the button says
"Resume appliance visit (3 of 7 done)"), LAUNCH only a visit that is billed
(or bills at the visit by design, or costs nothing) AND has its service
order, and otherwise BLOCKED — with the button and a toast saying exactly
which office step is missing. No more launching a new visit at any time.

## Field fixes

- **Keypad auto-advance.** "time to boil on a range didn't pass to step 6
  fan operation automatically" — when the reading IS the completion (a
  trend number or a not-measured waiver), the keypad now advances exactly
  as a rating tap does, with the same debt test holding a card open when it
  still owes a required field, reason, or photo.
- **Icemaker drain test pours a gallon**, not 500 ml — half a litre clears
  even a half-blocked line. (The microwave delta-T keeps its 500 ml; that
  test is about temperature, not volume.)

## The proration correction

Cayden: "the tech is going to perform the maintenance while hes there. so we
should charge full price for it. i thought about this wrong." New rule, one
implementation (`WILSON_PRICING.amendmentBilling`): an amendment that ADDS
appliances bills the full-year difference — the customer gets the whole year
of service starting today. Everything else (removals, plan changes, add-on
tweaks) keeps the v0.9.43 proration. The approval screen, the store record,
the activity line and the admin card all say which rule applied.

## The customer information page

`customer-info.html`: guiding principles ("our play is to be observant"),
what a visit is and deliberately is not (no annual teardowns — "a dryer
isn't meant to be taken apart once or twice a year every year"; deep work
quoted separately when the data says so), Guardian expectations (monitoring,
not magic — it cannot prevent failure and cannot see through a dead Wi-Fi),
a ten-question FAQ, and plain-language terms marked as a working draft for
counsel. Linked from the public footer, the registration picker, and the
confirmation page. The one-pager truth it leads with: well-maintained
components can still fail without warning, and we say so before the sale.

## Scoring: the age weight stays 25%, now with the reasoning in the config

`reportScoring` is the one knob (field tool, HVAC path, and seeded history
all read it — the seeds' hardcoded 0.75/0.25 is gone). Held at 25%: age
already compounds through expected-life adjustments, and a score that leans
harder on age than on measurements starts to look like a replacement-sales
tool, which this product is explicitly not.

## QA

verify-pilot-server grew the labeling drill (36 checks); verify-amendment
grew the serviced-now rule and its mutation (additions prorated again =
caught); verify-answer-kinds asserts the gallon pour; verify-command-center
grew "filters mean verification" and "trending down is the customer's page"
sections (51 checks); the browser smoke covers the verification queue end to
end (prompt and all), Filter Finder deep links, the customer information
page, and the launch guardrail through its three states — 259 checks.

# v0.9.36 - A link you can open on a phone, and why the LAN address never worked

> "Is there a way to launch the field tool with a link you can send my phone? I
> haven't been able to test it in a few days. No matter what I do I cannot get it
> to load on phone by trying to go to the address listed for phone in command
> prompt of the prototype tool"

Two separate things: a way to test without a laptop at all, and the reason the
laptop route was never going to work.

## Why the address on screen could not load

`OPEN_WILSON_PORTAL.bat` runs the server WITHOUT `--lan`. It binds 127.0.0.1 and
prints one address:

    Computer: http://127.0.0.1:8080/index.html

127.0.0.1 means "this device". Typed into a phone it points at the phone, so it
can never reach the laptop -- and the failure looks identical to a firewall
problem, which is what makes it worth an hour of anybody's evening.

That line now says so out loud, and names the two files that do work:

    THIS MACHINE ONLY. The address above will NOT work from a phone --
    127.0.0.1 means 'this device', so on a phone it points at the phone.
    To test on a phone:  1) SET_PASSCODE.bat   2) OPEN_FOR_PHONES.bat

The passcode step is not optional and is not new: `--lan` refuses to start
without one, because it would otherwise put customer names, addresses and job
photographs on a network with nothing in front of them.

**And the phone address itself could be the wrong one.** `local_network_ip()`
returns the address on the DEFAULT ROUTE, which is right on a plain laptop and
wrong on a developer's -- a VPN, a Docker bridge or a Hyper-V switch owns the
default route, and the printed address is then one no phone on the Wi-Fi can
reach. `--lan` now prints every IPv4 the machine has, private home-network ranges
first and Docker's 172.16-31 last, so there is something to try next. It also
says the phone must be on the same Wi-Fi rather than guest Wi-Fi or cellular.

## The field tool as a single file

`tools/build_field_preview.py` inlines every script, stylesheet and icon into one
HTML file. No server, no LAN, no passcode -- it opens from a link.

**It is generated, not forked.** Every line comes from the shipped assets, so a
change to tech-maintenance.js reaches the phone build the next time the script
runs. That matters more here than anywhere: this codebase has been bitten
repeatedly by two implementations of one rule, and a hand-ported field tool would
be the worst instance of it yet.

Four things differ, each deliberate:

  * `offline.js` is omitted -- it registers a service worker and there is no
    sw.js beside a single file. Its absence is a comment in the output, not a
    silence.
  * Photographs stay in the browser's IndexedDB, because /api/photos does not
    exist here. That is the offline path working, not a fault.
  * The invoice importer is a different page and needs the Python parser.
  * A visit picker is added, because the field tool is always reached as
    `?visit=...` from a household's launch button and a link has no query
    string. It is additive, labelled preview-only in the source, and runs only
    when there is no visit in the URL.

The builder also rewrites the two places tech-maintenance.js builds an icon path
at runtime. Rewriting somebody's source text is a thing to do carefully, so both
targets are asserted: rename either one and the build FAILS with the expression
it could not find, rather than shipping a page of broken images.

## QA

`_qa/verify-field-preview.py` -- 23 checks. It runs the builder, then proves the
output has no reference to a file that will not be there, that every script the
real page declares is actually inlined, that all 14 icons made it, that the
preview-only scaffolding is labelled, and that the fragment form restores the
body attributes `ui.js` reads to choose the internal chrome.

Mutation-tested against the failure it exists for: renaming an icon expression in
tech-maintenance.js makes both the builder and the suite fail, by name.

# v0.9.35 - Two buttons, because they are two different facts

> "the tech needs to be able to easily edit the pre filled info just in case its
> wrong. it wouldn't be surprising to me if i got sent to do maintenance on
> appliances the customer bought 6 years ago from us, but maybe they replaced the
> dishwasher in between with someone else."

The field half of the enrichment loop. A technician opens an appliance and the
brand, model, serial and age are already there, each saying where it came from.
And when the machine in front of them is not the machine on the screen, there are
two buttons rather than one.

## The two buttons

**"These details are wrong"** corrects a record about a machine that has been
there all along. Everything already measured on it stays.

**"This is a different machine"** says the machine itself changed. Its age starts
again, its expected life is recomputed from a different brand, and its trend
history CLOSES.

One combined edit button is the natural thing to build and the wrong thing to
have. Readings from the Bosch that left are not readings from the Miele that
arrived, and the decline block is the one screen that turns a reading into a call
to a customer -- so a signal computed across two machines is a phone call about a
problem their new dishwasher does not have.

A replacement sets `lineageStartedAt` on the appliance, and `trend-analysis.js`
ignores every report before it. **The reports are not deleted.** They stay in the
store and on the household page; what changes is what may be called a trend. The
filter lives in the trend module rather than at each call site, because a second
caller that forgot it would be the same bug again.

The machine that left is kept on the record with who retired it, when, and
whether Wilson had sold it. That Wilson sold the original and somebody else
replaced it is a fact about the customer worth having.

A blank field in a replacement reads as UNKNOWN, not as the old machine's value.
Carrying a Sub-Zero's serial onto a Miele would be the quietest wrong answer in
the whole tool.

## Two bugs I shipped into my own first draft

**The install year came out as the year 2.** After a replacement the card set
`draft.age` to the install year -- but `draft.age` is AGE IN YEARS, and the
store's `applyFieldAge` derives the year back out as `currentYear - age`. So a
refrigerator was recorded as 2024 years old and the next autosave wrote its
install year as 2. The replacement itself was correct; the autosave that followed
undid it. Found by reading the value back out of the store after the browser
round trip rather than trusting the form.

**A replacement reported itself as a correction.** Provenance read "corrected in
the field by R. Vasquez" for a machine nobody had ever described. The first
record of a new machine is a different claim from a correction to an existing
one, and it now says so.

## Provenance the seed data was lying about

`seedProvenance` read `source` only, so a Sub-Zero transcribed from invoice
SV0009120 was labelled "as the customer stated" on the technician's card. A
technician reads that line to decide how hard to look, so understating it is a
worse lie than saying nothing. An appliance whose install year came off an
invoice now says its brand and model did too.

Related: a year the technician typed was rendering as "on the appliance record,
unverified". The vocabulary already had a name for it -- technician estimate --
and the card now uses it.

## The guardrail's third surface

An unserviced brand entered in the field shows the technician's own sentence from
`serviceabilityCopy`, and the check runs as they type. It never stops the visit:
the appliance comes off the plan, the technician still works, the office still
gets told through the household's equipment gap.

## QA

`_qa/verify-field-equipment.js` -- 40 checks, 6 mutations. The mutations edit the
store and trend sources, reload the broken copies in a fresh VM context, and
require the property to stop holding. Among them: the lineage filter removed, the
lineage date never set, the decline list left unfiltered, a replacement carrying
the old serial over, a correction quietly closing the history, and the retired
machine being overwritten instead of kept.

# v0.9.34 - Anonymous slots become named appliances

> "Auto match with confirmation, park the extras."

Everything built in the last four releases was asleep. 109 brand rows, the tier
corrections, the Gaggenau fix, the serviced-brand guardrail -- and a real
customer registers, pays, lands in the command center, and every appliance
carries an empty brand. All of it resolved to the category median. The only place
brands existed in this tool was the seed data.

This is the office half of the loop that turns it on.

## The matcher is a proposal engine, and nothing else

`assets/equipment-match.js` takes the appliances a household enrolled and the
lines a parser found, and returns matches with a confidence and a WRITTEN REASON,
the slots it could not fill, and the lines nobody enrolled. It writes nothing and
decides nothing. A person confirms.

The office is being asked "is this the dishwasher we priced", which is a
judgement about somebody's kitchen. A tool that silently attaches a serial number
to the wrong machine is worse than one that asks, so every proposal says why it
was made:

    Same appliance type and the same area (Kitchen)          high
    Same appliance type, but the invoice says Main House      medium
    Only the category matches — worth checking                low

Low-confidence matches and anything that would replace details already on file
start UNTICKED. "Only the category matches" is a question, not a proposal.

Rules, in order: nothing crosses a customer category; inside one, exact type and
area beat exact type, which beats area, which beats category alone; a line with
quantity 3 offers three units; a WashTower is one line and two appliances;
surplus lines are parked; surplus slots keep asking.

The pairing is deterministic. Reversing the order files were dropped in changes
nothing -- an office confirming a screen that reshuffles between loads is not
confirming anything.

## A mapping that only existed in one direction

Matching found a silent bug that had nothing to do with matching. A customer
category knew which appliance types it expands to; a type could not say which
category it belongs to. So a seeded slot carrying `type: "hood"` and a parsed
line classified `ventilation` were two different categories, and the same Wolf
hood on both sides never matched. No error, no warning -- a gap that survives a
demo. `customerCategory` is now declared on all 20 appliance types and both sides
normalise through it.

## The guardrail's first two real surfaces

Registration cannot catch an unserviced brand, because it deliberately does not
ask for one. Import is the first moment it can be caught:

  - **On the import screen**, in the office's own wording from
    `serviceabilityCopy` -- one string, three surfaces.
  - **In the work queue, afterwards.** The screen warns while somebody is looking
    at it; the queue is what remembers after they clicked save. Cayden's call on
    the money was "Flag it, no money math", so the card names the appliance and
    the brand and stops. It does not compute a credit and it does not take the
    appliance off the plan by itself.

The keyed form runs the same check as you type, so an unserviced brand is caught
at the keystroke rather than at the truck.

## A queue stage that holds nothing up

"Needs equipment info" sits below everything that stops money or a truck and
above the quote nudge -- that placement IS "nothing is blocked", expressed where
the queue can see it. It only appears within `equipmentLeadDays` (45) of a visit:
a gap on a household whose first visit is eight months out is real and is not
today's work, and a queue that lists it teaches people to skim.

## Provenance on every field

`detailProvenance` records where brand, model and serial each came from --
invoice (with the number), keyed by the office, or corrected in the field. A
pre-filled field on a technician's card that cannot say its source tells them
nothing about how hard to look.

Age is the exception on purpose: it already had `ageSource` and `ageSourceRef`,
the report and the score read them, and a second set that could disagree with the
first is exactly the failure this codebase keeps finding. The install year writes
through the fields that already exist.

Blanks never erase. An invoice with no serial does not wipe a serial a technician
photographed, and neither does an empty box on the keyed form.

## A seeded household that is actually unfilled

Every seeded household already had brands on everything, so the new queue stage
read a permanent zero and the whole loop was invisible in the demo. Okafor
Residence is what registration actually leaves behind: seven appliances, types
and areas only, a visit in 21 days, and nothing else. A prototype whose data only
shows the finished state cannot be evaluated in the unfinished one.

## QA

`_qa/verify-equipment-match.js` -- 41 checks, 8 mutations.
`_qa/verify-equipment-enrichment.js` -- 40 checks.

**The mutation block was written wrong and is recorded rather than quietly
fixed.** The first version called a function that asserted the CORRECT behaviour
and treated a true result as "caught". Nothing was ever mutated, so all eight
passed by construction -- the same mistake made in verify-brand-lifespans.js,
where a mutation asserted that the HVAC exemption holds, which is the exemption
working. The rewrite edits the module's source, reloads the broken copy in a
fresh VM context, and requires the property to STOP holding. It also checks the
property still holds on the real module, because a property that fails on both is
measuring nothing.

# v0.9.33 - Vent-A-Hood, and a tier I got wrong by one year

> "VAH 12 YEARS" ... "PREMIUM"

The last brand outstanding. Vent-A-Hood, ventilation, 12 years in the field.

I put it in luxury -- Texas-made, proprietary blower, the American premium hood,
so alongside Wolf and Thermador rather than beside Broan. Cayden corrected it to
premium before the build finished.

That correction is worth exactly one year: luxury anchors on the 18-year hood
column and turns his 12 into 15; premium anchors on 16 and makes it 14. Which is
the whole argument for `tierDrafted`. A tier is not a label -- it picks the column
the anchored half of every average comes from, so a tier I chose is a number he
will be asked to defend. The Vent-A-Hood row is now recorded as HIS call and is
absent from the drafted set; 56 of 109 rows still carry mine.

Aliases added for `ventahood` and `VAH`, since "VentAHood" resolved to nothing on
the first pass and the office types it both ways.

109 rows, 59 brands. QA green: 100 checks, 14 mutations, exclusions and lifespans
parity-checked against the migration in both directions.

# v0.9.32 - Cayden fills the gaps, and one number he gave would have come out wrong

Forty-two new figures from him, ten new brands, sixteen more brands ruled out.
The table went from 66 rows to 108 and from 48 brands to 58.

## The one thing that needed flagging before it landed

He gave 8 years for outdoor undercounter refrigeration on Alfresco, Blaze,
Coyote, Lynx and DCS. Run through the averaging rule against `lifecycleMatrix`:

    Alfresco  [luxury]  your 8  + indoor 20  ->  14
    Lynx      [luxury]  your 8  + indoor 20  ->  14
    Kalamazoo [luxury]  your 12 + indoor 20  ->  16

NAHB's refrigerator row is INDOOR refrigeration. Averaging a Hill Country outdoor
fridge against it turns the figure of the man who services them into 14 years, on
a customer's report. Nobody would defend that number.

So those rows carry `anchored: null` and a `noAnchorReason`: where no published
figure covers the equipment, there is nothing to average with, and inventing one
to average against is worse than saying so. His 8 stands, to the year. Same
treatment Miele coffee already had, now a stated rule rather than one exception:

  - unanchored rows must record WHY, in both the config and the SQL seed;
  - the reason must be true -- only a line whose category genuinely has no figure
    for that equipment may go unanchored, so it cannot become a per-row opt-out;
  - an indoor brand cannot borrow the exemption. Sub-Zero refrigeration is still
    averaged, and still 23.

That widens the brand-driven score spread on refrigeration back to 9 points from
5 -- but only because outdoor and indoor equipment are now both in the range, and
an outdoor fridge at 7 years really is 88% through its life. The INDOOR spread is
still 5. Both are printed by the QA suite; neither is claimed to be the other.

## What he supplied

New lines on brands that were split: Miele laundry and vent, Sub-Zero ice, Viking
and Monogram dish/vent/microwave/ice, Hestan cooking and vent, U-Line and Marvel
ice, Perlick ice, BlueStar vent, LG dish/microwave/cooking, and outdoor
refrigeration and ice across the grill brands.

New brands: Sharp, Broan, Twin Eagles, Fire Magic, American Outdoor Grill,
Summerset, Delta Heat, Bull, Napoleon, Solaire.

**Smeg gets a tier and nothing else.** "WE ARE PICKING UP SMEG SOON BUT I DONT
KNOW MUCH ABOUT IT YET. GO WITH STANDARD FOR SMEG." So it is premium, has no row
in `brandLifespans`, resolves to the published median, and the basis says
"category". The temptation was to invent a field figure from the tier, which would
make a number nobody has measured indistinguishable from a hundred that were.

Sixteen brands ruled out by name: Vinotemp, EuroCave, Allavino, Hoshizaki,
Ice-O-Matic, ILVE, Verona, Lacanche, Hallman, Z-Line, Thor, Kamado Joe, Primo,
Traeger, Memphis, Green Mountain. The list is still an allowlist underneath -- an
unrecognised brand is an office question, not a silent acceptance -- but these are
the ones a customer is actually likely to own, so the tool can answer instead of
queueing a question whose answer is known.

Kamado and pellet grills are NOT in the Big Green Egg bucket. BGE is
nothing-to-maintain: Wilson sells it and would service it, but a ceramic charcoal
grill has no maintenance to perform. These Wilson does not sell or service at all.
Different fact, different sentence, and the suite asserts they never merge.

## Whose judgement each number rests on

`tierDrafted: true` now marks a row whose TIER I chose rather than Cayden --
56 of 108. Tier picks the column the anchored half comes from, so it moves the
number, and whose call it was belongs in the data rather than in a comment. The
three he ruled on directly (U-Line and Marvel mass, Asko luxury) are recorded as
his and asserted as his.

## Corrections to my own work

  - **My check said Marvel was luxury.** He said "uline and marvel are terrible
    and we have stopped selling them for this reason. make them mass" -- both
    mass. The data was right and the check was wrong.
  - **The microwave line was my inference and is now his data.** It existed only
    so "across all product" could reach a speed oven, and the suite FORBADE a
    microwave-specific row on the grounds that it would be a number he never
    gave. He gave four. The check had to be inverted.
  - **"Zline" was my stand-in for an unrecognised brand** in two checks. It is now
    a brand he has ruled out by name, so it resolves. Replaced -- and the
    replacement "Bertazzoni Heritage Nonesuch" also resolved, correctly, on the
    whole word "bertazzoni".
  - **The exclusion seed was never compared with the config.** Only its absence
    from the tier table was checked, so a brand silently dropped from the seed
    passed: the dashboard would have priced a Traeger the field tool refuses.
    Now parity-checked both ways, and mutation-tested three ways.

## Still open

**Vent-A-Hood.** Asked, not answered -- and it is the one I would most expect on
a Texas luxury list. No row, no tier, so it currently resolves to "unknown brand"
and becomes an office question.

The 20 brand-wide coverage lists are still mine, drafted from catalogues.

# v0.9.31 - Asko does not make a grill

> "ASKO DOESNT HAVE GRILLS AND BERT DOESNT DO COFFEE."

Both true, and both were in the table an hour after it shipped.

A brand-wide row -- `line: "*"`, which is how "thermador 15y across all product"
is expressed -- answered on every product line. So the tool held an expected-life
figure for an Asko outdoor grill and a Bertazzoni coffee system. Neither is
reachable: no such appliance will ever exist on a plan, so no customer would ever
have seen one. But this is a table of claims about what Wilson sells, and a claim
nobody would stand behind does not belong in it.

## The fix

Every brand-wide row now carries `covers` -- the lines that brand actually sells.
Outside it the row does not answer at all and the category median takes over.

An absent or empty `covers` list means NO lines, never all of them. That
direction matters: the failure mode of a missing list is a figure quietly
reverting to the category median, not a wildcard silently reopening.

`coversDrafted: true` marks the 19 coverage lists as MINE -- drafted from public
catalogues, not given by Cayden. They are wrong in both directions cheaply (too
narrow and a line falls to the median, too wide and a row exists for an appliance
nobody makes) but they are still wrong, so they are flagged rather than presented
as his.

## Also

Three alias spellings -- `subzero`, `café`, `jenn-air` -- were carrying their own
rows in `brandTierDefaults` alongside the canonical keys. A spelling belongs in
`brandAliases`, where `normalizeBrand` resolves it. Two copies of one fact is how
the copies drift, so they are gone and the tier still resolves through the alias.
Brand-tier rules: 70 -> 67.

## QA

Brand suite: 80 checks, 14 mutations. Asko-has-no-grill and
Bertazzoni-has-no-coffee are asserted by name.

**The SQL parity check was rewritten rather than patched.** It scraped numbers out
of each seeded row with a regex and indexed them from the end, which broke twice
in one sitting: once when `CoversLines` was added and shifted the slice, and again
because a NULL `CoversLines` is captured by a number regex while a JSON string is
not -- so named-line and brand-wide rows needed different offsets. Positional
scraping of a SQL value list is not worth defending. Rows are now split on
top-level commas with quote handling and looked up BY COLUMN NAME. Seven
mutations against it, including a coverage list stripped of one line and a
coverage list added to a named-line row.

# v0.9.30 - Brand and product line, and two reasons to say no

> "we service everything we sell, so those lists are the same. no matter what i
> dont want to prompt the customer for brand during registration."
>
> "my life ratings are based on experience because we do service. i know what
> product fails prematurely, but we dont need to rate based on that. shoot the
> gap with everything. do the average of what i said and what the code says now.
> especially since the code was based on industry expectations (i think)"

The "(i think)" was worth checking, and the half that was wrong changed the job.

## The code's number was only half an industry expectation

`lifecycleMatrix` anchors ONE tier column per category to the published survey --
NAHB refrigerator 13, dishwasher 9, hood 14, ASHRAE for HVAC. The other two
columns were offset from it here, by me, not by data. Grills, icemakers and
coffee have no published figure at all.

Worse for averaging: 30 of the brands on Cayden's table were not in
`brandTierDefaults`, so every one of them returned the same "mass premium"
column. **Gaggenau and U-Line were both coming back as 16 years.** Splitting the
difference with that is not splitting with an industry expectation; it is
splitting with a placeholder.

So each unmapped brand got a tier first, then the average. That moved 19 rows,
almost all of them luxury names the placeholder was underselling.

## Two live bugs in the brand matcher

`tierForBrand` matched with `b.includes(name)` -- plain substring:

    "gaggenau".includes("ge")  -> true, so a EUR 25k range scored as mass-market
    "fulgor".includes("lg")    -> true, so Fulgor did too

Both then inherited a mass-market expected life, which feeds 25% of the appliance
score through the age term. Neither would ever have surfaced as an error, just as
a quietly wrong number of years on somebody's report. Brands now match as whole
words, through one resolver, with an alias table in front of it -- and both are
named in the QA suite so they cannot come back.

## Brand tier and brand lifespan are two different lookups now

Cayden's table could not be expressed by the old brand -> tier -> years chain:

  - It is brand AND product line specific. Miele is 15 on dish, 12 on
    refrigeration, 15 on cooking, 10 on coffee. One tier cannot say four things.
  - Years and tier do not track. Speed Queen resolves to 17 and True commercial
    to 23 without either being luxury.
  - Amana is premium on the HVAC side and mass on the appliance side. A single
    brand->tier row has to be wrong about one of them, and it was wrong about the
    appliance.
  - GE Profile is a PREMIUM SERIES OF A MASS BRAND, so tier belongs on the row
    rather than the brand.

`brandLifespans` is 66 rows -- one per line of his table. Resolution runs
this line's series row, this line's plain row, a brand-wide series row, the
brand-wide plain row, then the category median.

### A brand-wide figure is a wildcard, not an expansion

The first cut of this table expanded "thermador 15y across all product" into rows
for the lines I guessed Thermador sells -- and a Thermador vent hood fell
straight through to the category median anyway. A `line: "*"` row now says what
he said, and the midpoint is computed against whichever line it lands on: the
same 15 resolves to 17 on a hood and 18 on a range, because the published figure
behind each is different.

Halves round UP, toward the longer life. A short expected life inflates "life
used", which lowers the age score, so the rounding error belongs on the side that
does not cost somebody points for arithmetic.

## The tier dropdown stopped doing what its label said

On the field card the tier hint read "Defaults from brand". Once a brand row
supplies the years, the dropdown chooses nothing for anything Wilson sells -- a
Sub-Zero refrigerator is 23 years whatever it says. A control that appears to
drive a number and does not is worse than no control, so the hint now says what
tier is for (protocol depth) and the expected-life field states its own source:

    Sub-Zero refrigeration - midpoint of Wilson's 25 yr and the published 20 yr

## Two reasons an appliance cannot go on a plan, and two sentences

`notServicedBrands` -- Samsung, Dacor, Frigidaire, Electrolux. Wilson neither
sells nor services them. Samsung and Frigidaire were sitting in
`brandTierDefaults` as mass-market, which implied coverage that does not exist;
they are out of it.

`notMaintainable` -- Big Green Egg. Wilson sells it and would service it, but a
ceramic charcoal grill has no maintenance to perform, and charging for a visit
that does nothing is precisely what this product exists not to do. That is a
better thing to tell a customer than a refusal, so it has its own wording.

Each state carries one sentence per audience -- customer report, office queue
card, technician appliance card -- because a guardrail all parties can understand
means one string, not three explanations that agree. An unrecognised brand has
NO customer-facing sentence: it is an internal question, and printing it would
leak uncertainty onto a report.

Nothing here blocks anything. An appliance comes off a plan; a household still
enrolls, a technician still works, and a brand nobody recognises is a queue item
with a next action.

**HVAC is exempt.** Wilson services any system, so no brand check fires on one.
The 19 HVAC rows in `brandTierDefaults` are a lifecycle input and nothing more.

## The wording on `reportedNotScored.brand` was a lie

It read: "Used only to look up a draft expected service life. It never adjusts a
score up or down." That was not true when it was written. Brand picks expected
life, expected life is 25% of the appliance score, so brand moves the number.

Averaging halved the effect rather than removing it: two seven-year-old
refrigerators measuring perfectly on every check still differ by 5 points on the
badge alone, down from 9 on the raw field table and against 3 before any of this.
The honest claim -- that brand never scores CONDITION -- is what the config says
now, and the 5-point spread is asserted in the QA suite so widening it again is a
visible decision rather than a side effect.

## Also in this release

  - A `coffee` row in `lifecycleMatrix`. Built-in coffee was falling through to
    `generic`, which means "unclassified" rather than "an estimate for coffee
    machines", and was silently getting the generic 15/12/9. Flagged unsourced:
    there is no published figure anywhere, and the luxury column is drafted from
    Miele's single row -- which is why the Miele coffee row carries NO anchor.
    Averaging a number against itself is not corroboration.
  - A `microwave` product line, so "across all product" can reach a speed oven.
    Cayden's table does not mention microwaves at all, so no brand carries a
    microwave-specific row and the QA suite forbids one. Worth him confirming.
  - Gladiator kept -- garage refrigeration, mass, resolves to 12. Rare enough it
    may never appear on a plan, but a row costs nothing.
  - Four new SQL tables, seeded from `plan-config.js` and parity-checked against
    it row by row: `MaintenanceApplianceLines`, `MaintenanceBrandLifespans`,
    `MaintenanceBrandExclusions`, `MaintenanceServiceabilityCopy`. The brand-tier
    seed now emits MatchType `WORD` rather than `CONTAINS`, so the dashboard is
    not invited to reproduce the substring bug.

## QA

`_qa/verify-brand-lifespans.js` -- 73 checks and 12 mutation tests. The table is
never trusted: every precomputed figure is recomputed from its own two parents,
every anchored value is rechecked against `lifecycleMatrix`, and every brand-wide
row is resolved onto every line and rechecked there.

Three of my own checks were wrong before they were right, each recorded in the
file rather than quietly fixed:

  - The HVAC mutation asserted the exemption HOLDS, which is the exemption
    working -- a positive check wearing a mutation's clothes.
  - The exclusion-kind check searched the table body for the two kind names and
    matched the COMMENT above the constraint, so replacing the constraint with
    `CHECK (1=1)` sailed through.
  - The tier-hint check searched the whole file for "Defaults from brand" and
    matched the comment explaining its removal, so it failed on the very change
    it was written to confirm.

An existing check in `verify-answer-kinds.js` listed the five unsourced lifecycle
rows by name and broke the moment `coffee` was added -- correctly flagged, and the
suite objected anyway. It now asserts the rule instead of the spelling.

# v0.9.29 - The dryer the importer threw away

> "i imported this invoice and found that it did not recognize the dryer and
> determined it was an install/ support line. probably because the demo invoices
> included install. this example is a customer pickup where only product existed
> on the invoice"

Reproduced on the first try, and the symptom was exactly as described. The cause
was one layer below the guess.

## What actually happened

Every Wilson invoice ends with a terms block. On this one:

```
25 | 1  T7VXLW   24in. Electric Smart Dryer, 7 Series, Vented...     ← last product
...
54 | EXTENDED WARRANTY      YES   NO   REMOVAL OF OLD UNITS   YES   NO
55 | *      Above order confirmed with  no changes.
57 | *      Please refer to owners manual/installation guides for important details.
```

Lines 54 onward were being **appended to the dryer's description**, because the
parser's fallback swallows any unrecognised line into the current item. Line 57
contains `installation` — and `install` is an exclusion phrase. So the dryer was
dropped as `Excluded support line: install`.

**There was already a guard for this**, and it was broken:

```python
stripped.startswith("*Above order")
```

Layout extraction emits that line as `*` followed by **six spaces**. The guard
never fired on a real invoice. Cayden's instinct about install lines was the
reason it stayed hidden: on invoices *with* an install section, the swallowed
footer landed on a line that was already being excluded, so nothing looked wrong.

Footer markers are now matched against whitespace-collapsed text, and the list
covers every line this footer actually produces rather than the one somebody
noticed first.

**All three products now import, and nothing is ignored.**

## The fixtures could not have caught it

None of them emitted a footer. A 51-check suite passed a parser that mangled the
last product of every real invoice, because no fixture was shaped like a real
invoice.

`_qa/invoice_fixtures.py` now writes the terms block **by default** — including
the asterisk-then-alignment-spaces shape, since a fixture written snug
(`*Above order`) would pass where a real invoice fails. Every existing case in
the suite now runs against that stronger bed, and a new `customer_pickup()`
fixture reproduces Cayden's exact shape: product lines only, dryer last.

Asserted: with the old guards the fixture drops the dryer; with the fix all three
survive, and no terms text reaches any product description.

## Something I got wrong, and backed out

I also made exclusion phrases word-boundary-matched — sensible, and it stays.

But I added `installs` and `installed` to the phrase list, guessing at coverage I
had not verified. Building a fixture to test it showed the hazard runs the other
way: `installed` threw out a refrigerator described as **"Pre-Installed Water
Line"**, which is product copy, not a support line. Both invented phrases are
removed. The list holds only forms a real Wilson invoice has been seen to use.

The word-boundary change is also honestly labelled in the suite as defence in
depth rather than the fix — with the footer no longer reaching the description,
reverting it breaks no test. The observable fix is the footer repair.

## Two weak assertions of mine, replaced

- `check(..., b"Above order" in snug or True, True)` — a tautology. An assertion
  that cannot fail is worse than none, because it reads like coverage. It now
  extracts the built fixture and asserts the asterisk-then-spaces shape survives,
  plus that a snug-asterisk guard would *not* have matched it.
- A `for text, _ in blob_cases: pass` loop that did nothing at all.

## Handling of the real invoice

`mayfield_household.pdf` carries a customer name and service address. It was read
from the upload area to diagnose the shape and **never copied into the
repository**, in line with how the parser suite has always worked: synthetic
fixtures, with `WILSON_REAL_INVOICES` for pointing at real files locally.

## Still open

- ePass reconciliation, waiting on the dump's headers and its join key
- Real filter price list, API contract rewrite to v0.9, the payment link loop
# v0.9.28 - Two screens, not eight tabs

> "im still not in love with the command center and the menu above it."

The measurements said why. Eight tabs, and this is what three of them held:

| tab | contents | already on household.html? |
|---|---|---|
| **Filters** | **4 rows**, 3 due, 1 overdue | ✅ `household-filter-list` |
| **Health** | 74 reports, almost all *history* | ✅ `report-history-body` |
| **Activity** | **4 entries** | ✅ `household-activity-list` |
| **Plan Setup** | no data at all — prose restating plan-config.js | — |

Three global copies of panels that already exist per household, where they are
about somebody rather than about everybody, and one reference document. Retiring
them removes duplication, not capability — and that is now asserted by checking
the per-household panels still exist.

## The two screens

**`admin.html` — Today.** What needs doing, and nothing else. One queue, six
stages, ordered the way the office works.

**`customers.html` — Customers.** Everybody, searchable, every row opening the
household's own page.

**`invoice-import.html`** got its own page. It was an 86-line upload-review-create
flow sitting inside a screen whose job is showing today's work, and it is not
per-household anyway — it *creates* a customer, so it belongs beside the other
way of creating one.

## What the Filters tab became

A queue stage. Its one piece of real work — which filters need ordering — is now
a row in the queue, overdue first. A screen for a four-row to-do list was the
wrong shape for it.

Sent quotes gone quiet became a stage too, and it is last in the order because
it is a nudge rather than a blocker. Only a **Sent** quote can be quiet: a draft
nobody sent is waiting on Wilson, and calling that "quiet" blames the customer
for Wilson's inbox.

**What deliberately did not become a stage:** households with no water test. It
is a real gap in the data — hardness drives expected life on every water-bearing
appliance — but nobody sitting at a desk can test the water. The technician's
visit screen already asks. An item the reader cannot action is how a queue
teaches people to stop reading it, so it went on the customer list as a filter,
where it is a question rather than a task.

## The stat bar summarises itself now

It was four buttons hardcoded in the markup, and their ids had **drifted from
their contents** — `hero-filter-count` was displaying the charge count,
`hero-payment-count` the ticket count. One of them changed meaning at zero.

It is now generated from the stage list, with counts read off the assembled
queue, so the bar cannot fall behind the queue it describes. Adding a stage
cannot leave it behind.

## The menu above it

- The **decorative pencil glyph** is gone. It did nothing and never did.
- The **"Internal tools" rail** is gone — two non-interactive spans naming Podium
  and DispatchTrack, which looked like navigation and went nowhere when clicked.
  In its place: the two screens the tool actually has, with the current one
  marked.
- The **section pill** is public-only now. On internal pages it printed the same
  word as the current nav item *and* the page's own `<h1>` — "TODAY" beside
  "Today" beside "Today".
- The mobile menu and footer pointed at `admin.html#households`, `#imports`,
  `#filters`, `#reports`, `#quotes`. All five relinked, along with the back-links
  on the report, quote and field-tool pages. Asserted: no internal page links to
  a retired anchor.

## Thresholds became policy

The 14-day charge window and the 30-day filter horizon were literals scattered
through `admin.js`, which meant Wilson's operating policy could not be read
without reading a screen's source, and two screens could disagree about what
"due soon" meant. They live in `config.operations` now, and both screens read the
same numbers.

## Two errors this shook out

**A dropped button took the queue's handlers with it.** Removing "Reset demo"
from the markup left `admin.js` calling
`getElementById("reset-demo").addEventListener(...)` on null, which threw and
took every binding after it. Restored, and guarded — an absent control should
never be able to break a module.

**A button whose whole job was clicking a tab.** `open-invoice-import` existed to
switch to the imports panel. Deleted rather than guarded.

## Two of my own tests were wrong

Worth recording, because both were the test insisting on a spelling rather than a
rule:

- The hero-id check searched the raw source and flagged the **comments explaining
  why those ids were removed** — a test that cannot tell an identifier from a
  sentence about one. Now matches markup and lookups only.
- The Sent-quote check required `=== "Sent"` in both files, but `admin.js`
  expresses the same guard as an early return on `!== "Sent"`.

Both sharpened and mutation-tested.

## Still open

- **The dryer bug Cayden found** while testing invoice import: on
  `mayfield_household` (a customer pickup, product lines only, no install) the
  dryer was excluded as `support line: install`. Likely the invoice's trailing
  terms boilerplate — "REMOVAL OF OLD UNITS", "installation guides" — merging into
  the last product line so the exclusion matcher hits the product itself. Needs a
  synthetic fixture reproducing the merged-footer shape; the real invoice carries
  PII and must not enter the repo.
- ePass reconciliation, waiting on the dump's headers and its join key
- Real filter price list, API contract rewrite to v0.9, the payment link loop
# v0.9.27 - Scheduling preferences, not a calendar

> "ePass is [not an] open API, so I don't see a way for this to communicate back
> to ePass if we do the scheduling inside the tool... As it is now they can leave
> a note for preferred maintenance timelines and I feel like that's functional
> enough."

Cayden is right that the tool should not own the schedule, and for a sharper
reason than friction: a date chosen in the tool is a date Wilson cannot honour
without re-entering it in ePass by hand — while the customer believes it is
booked. **A promise the software cannot keep is worse than no promise.** Building
it would also manufacture exactly the failure this codebase keeps deleting: two
systems holding the same fact, one of them authoritative, silently drifting.

So no calendar. What shipped instead is the free-text box replaced with the
facts the office actually needs to place the ticket.

## What the customer answers

| | |
|---|---|
| **Best months** | 12 chips; contiguous runs collapse to `Mar–Apr, Sep–Oct` |
| **Days that work** | all five weekdays collapse to `Weekdays` |
| **Time of day** | single-select; tapping the choice again clears it |
| **Getting in** | someone home / gate / alarm / dog / key on file / needs notice |
| **Dates away** | date ranges with a reason |

All optional. Blank means blank — an empty preference reads "No timing
preference", never an invented default. `Any time` on its own is *also* nothing,
because a house whose only answer is "any time" has told Wilson nothing.

Every chip clears 44px, the form does not scroll sideways on a phone, and a
backwards date range is refused rather than stored.

## No entry codes, by design

A gate or alarm code typed into a web form is a code sitting in a database, and a
customer-facing page is the wrong place to collect one. The customer records that
a code **exists**; Wilson gets it by phone. The form says so in as many words,
and the build fails if any field on either signup screen starts asking for a
code, or if the promise disappears from the copy.

The office still gets what it needs: access constraints carry **office wording**
rather than the customer's label — "Gate access needed — Wilson to collect the
code by phone" is an instruction, "Gated entry" is a checkbox.

## Where the office sees it

- **Household page** — every constraint on one screen, with access rows in
  amber, because those are the ones that turn a technician away at the kerb.
- **Ops queue row** — one line per household, and only when there is something
  to say. An empty line on every row trains people to stop reading it.
- **Confirmation page** — read back to the customer in their own words.

## Both signup flows, one module

`assets/scheduling-preference.js` mounts on the appliance form and the HVAC form.
HVAC's box was pre-filled with "Spring / Fall", and HVAC is the flow where
seasonal months matter most — leaving it behind would have put the better control
on the form that needed it least. Asserted: neither page carries
`name="preferredMonths"` any more, and both mount the same module rather than a
copy.

`subscription.preferredMonths` survives as a **derived one-line summary** so the
admin queue and confirmation page keep working — a display copy, generated, never
entered. Same pattern as `household.waterTest`.

## The seed data demonstrates the point

Two households had this in free text:

- *"House manager coordinates access. Gate code stored in the service system."*
- *"Preferred appointment window is Tuesday or Thursday morning."*

Both are now structured, so they are filterable rather than readable. The first
became four months, weekdays, three access constraints and a blackout.

## A test that had to get sharper

The no-codes check first matched on the word `code` and flagged the option
**"Wilson holds a key or code already"** — which is the *opposite* of a request;
it tells Wilson it already has entry. Rewording a correct label to satisfy a
blunt regex would be the test dictating the product, so the regex learned to
match request phrasing instead. Mutation-tested: a label that starts asking for
the code is caught.

## Also fixed

The office panel was rendering `2027-01-24 to 2027-02-14`. The resolver was
handing over a pre-joined ISO string as its display value; it now hands over raw
`from`/`to` and the view formats them. `plan-config.js` has no business deciding
how Wilson writes a date, and cannot reach `ui.js` to find out.

## Deliberately still open

**The ePass reconciliation.** The better half of this idea, waiting on the daily
dump's column headers and — the hard part — whatever key ties an ePass ticket
back to a household. `serviceOrderSystem`, `serviceOrderStatus` and
`serviceOrderMatch` already exist on every visit and are fed by nothing; the ops
queue already has "a charged plan with no ticket" and "waiting on a service
order" as stages. That is the shape the dump slots into.

Real rows carry customer PII and must not enter the repo — synthetic fixtures
plus an env var for local real files, same as the invoice parser.

Plus: real filter price list, API contract rewrite to v0.9, command center
redesign, the payment link loop.
# v0.9.26 - The plan year is divided, not front-loaded

Cayden's call after seeing the split: divide the annual across the visits first,
then charging when a visit is scheduled is an ordinary thing to do rather than a
large charge for work not yet done.

**Two-visit plans now bill half the year at each visit.**

| plan | was | now |
|---|---|---|
| Estate Preferred, $1,995 | $1,995 then $0 | **$997.50 then $997.50** |
| Estate Concierge, $2,995 | $2,995 then $0 | **$1,497.50 then $1,497.50** |

The annual total has not changed. Only its distribution has, and "per year" now
describes something that actually happens across the year.

One-visit plans are untouched: they already distributed, with the recommended
second icemaker visit as its own later leg.

## Weights, not amounts

`estatePricing.visitChargeSplit.twoVisit = [0.5, 0.5]` — config, so Wilson can
change the shape without opening a screen file. The weights must sum to 1, and
that is asserted: a future edit to `[0.5, 0.4]` would quietly make plans 10%
cheaper rather than changing when they are paid. Mutation-tested.

Any rounding remainder lands on the first leg by subtraction, so the legs always
add back to the annual figure exactly.

## A float leak into a stored charge amount

3 × $249.95 evaluates to **749.8499999999999**, and that was being stored as a
visit's `amountToCharge` and printed on the customer's schedule. Every leg is now
rounded to cents at the boundary where money is decided.

**The first version of this test did not catch it.** It compared numeric distance
with a `1e-9` tolerance, and 749.8499999999999 sits 1.4e-11 from a whole cent —
comfortably inside. The real failure mode is the *representation*: anything that
stringifies the amount without `ui.money` prints the ugly number at a customer.
The check now tests the string, and catches it.

**The fixture did not catch it either.** Two icemakers multiply cleanly; it takes
three to produce the artifact. A "three icemakers, the float case" portfolio is
now in the suite, kept for that reason rather than for its size.

## Copy that described the old shape

`assumptions.paymentTiming` said the card is "charged when a scheduled
maintenance interval is ready to proceed" — accurate for one charge, wrong for
two. Now: *"The card is placed on file at enrollment. Nothing is charged at
signup — each maintenance visit carries its own amount and is charged against
that visit."* It appears on the proposal and the confirmation page, so both
updated with it.

## What now fails the build

- Split weights that do not sum to exactly 1
- A visit billed nothing on a plan that visits twice
- Either leg carrying the whole year on its own
- A charge leg with more decimal places than money has
- The preview differing from what the visits charge (28 combinations)

## Still open

- **The charge trigger.** Now that no single charge is front-loaded, "charge when
  the visit is scheduled" is safe to implement — but there is no scheduling
  concept in the prototype yet: visits move Upcoming → Due soon → Overdue on
  dates alone, with no scheduled date, no "Scheduled" status, and no action to
  set one. That is the next piece of work, not a one-line change.
- The payment link loop, deferred
- Real filter price list (the $70 is still a placeholder)
- API contract rewrite to v0.9
- HVAC signup still has a single exit
- Command center redesign
# v0.9.25 - "Per year" was not what the card sees

Cayden asked whether the running total should break the price into an amount due
now and an amount at the second visit. The numbers turned that from a nice-to-have
into a real problem.

**A 12-appliance house with two icemakers, Estate Annual:** shown as
`$1,694.90 / year`. Actually charged **$1,195.00** at the first visit and
**$499.90** about five months later.

**The same house on Preferred or Concierge:** the **entire** annual amount lands
on the first visit and the second is $0.

Neither of those is what "per year" sounds like, and until this version neither
was shown anywhere. The second charge arrived unexplained; the first was bigger
than the customer expected.

## The split was unreachable, which is why it was never shown

It lived inside `createEnrollment`, so the signup screen had no way to preview it
without writing the rule a second time — the exact mechanism by which the retired
quote screen came to under-quote by $350.

It is now `WILSON_PRICING.chargeSchedule(assets, planId)`, and `createEnrollment`
**builds its visits from it**. One copy. The preview cannot promise a split that
never happens, and that is asserted across 28 plan/portfolio combinations:
every schedule sums to its annual total, and every predicted leg equals the
amount actually attached to the visit.

## Three surfaces, increasing detail

- **Signup panel** — one quiet line under the annual figure:
  `FIRST VISIT $2,995.00 · SECOND VISIT Included`. The annual total stays the
  headline. Hidden entirely when there is only one charge, because saying "first
  visit" invents a second one.
- **Proposal** — a "When each amount is charged" block under the pricing card,
  with the note explaining each leg.
- **Confirmation page** — the fullest version, built from the household's
  **actual visits** rather than re-derived from the plan, so it states what the
  system will really do. Leads with *"Your card is on file now. Nothing is
  charged today."*

## Internal jargon on a customer's receipt

Putting the schedule on the confirmation page exposed **"Second IMUC visit"** and
**"2 IMUC icemakers"** — Wilson's internal abbreviation, printed on the document
the customer keeps. Now "Second icemaker visit" and "2 icemakers", and asserted:
no `IMUC` reaches a customer's charge schedule.

## What now fails the build

- A charge schedule that does not sum to its annual total
- A preview leg that differs from the amount the visit actually charges
- A negative leg (the one-visit branch subtracts icemaker legs from the annual)
- A single-charge plan inventing a second leg
- `IMUC` appearing in a customer-facing season or scope

All mutation-tested.

## Open decision, raised rather than assumed

Cayden's answer on charge timing was **"when the visit gets scheduled"** — earlier
than today's "when the interval is ready to proceed". Not implemented yet,
because the front-loading above changes what it means: on Concierge, scheduling
the first visit would charge **$2,995 before anyone has been to the house**. That
is close to the at-signup option he rejected, and it is his call, not mine to
infer. The trigger stays as-is until he confirms.

## Still open

- The charge trigger, pending that answer
- The payment link loop, deferred
- Real filter price list (the $70 is still a placeholder)
- API contract rewrite to v0.9
- HVAC signup still has a single exit
- Command center redesign
# v0.9.24 - "Ready to charge" now means it

> "the stripe workflow we use for payments is we'd send a customer a link and
> they'd add a payment intent. Once we had that we can charge card"

That explains why an accepted quote should become an enrollment immediately: the
household has to exist before the SetupIntent has anything to attach to. The
conversion built in v0.9.23 lands exactly right.

But it puts weight on a guarantee that previously carried none. Between
accepting a quote and the customer completing that link, there is now a real
household with a real balance owing and no way to take payment — and the
prototype was **describing that window wrongly**.

## The defect

Every chargeable visit was created saying **"Ready to charge"**, regardless of
whether a payment method existed. That was harmless for as long as every
enrollment came through the signup form, which will not submit without a
connected card. A converted quote has no card by design.

So the office would have opened a just-converted household, read *"Ready to
charge"* against $3,745, pressed it, and been told *"No ready payment method is
on file."* The charge logic was right the whole time; the label was lying.

Visits now report the payment profile instead of assuming it:

| | before the link is completed | after |
|---|---|---|
| label | **Awaiting payment method** | Ready to charge |
| charge attempt | refused | goes through |

AR accounts stay chargeable without a card, mirroring the rule `mockCharge`
actually applies, so the label and the behaviour cannot disagree.

**The charge stays manual**, as Cayden confirmed — a card arriving never moves
money on its own. A person still presses charge.

## The payment column carried no information at all

Fixing the label surfaced something worse. The status badges classify by
substring, and the generic rules were beating the specific ones — **"Charged -
$3,145.00" contains the word "charge"**, so a payment that had gone through wore
the same amber badge as one still owing.

Four good outcomes were mislabelled:

| status | was | now |
|---|---|---|
| Charged - $3,145.00 | warning | **success** |
| Completed | neutral | **success** |
| Matched - SO-10441 | neutral | **success** |
| Included - no additional charge | warning | **success** |

With the new "Awaiting payment method" joining them, the entire payment column
rendered one colour. Settled outcomes are now matched before the loose words, in
both `household.js` and `admin.js`. Every status value the seed data produces
was rendered through both helpers to confirm the tones.

## What now fails the build

- A converted quote's initial visit claiming to be ready to charge
- A charge succeeding before the customer's payment method arrives
- A card arriving and charging something by itself
- An enrollment submitted *with* a card not being ready to charge
- The badge ordering reverting — mutation-tested, and honest in the test file
  about being a source-order check rather than proof of a rendered colour

## Deliberately not built

The payment link itself. Cayden's call for now: no "send link" action, no
customer-facing SetupIntent page. Wilson's existing internal "Connect demo
payment" button still stands in for the customer completing one — which is worth
knowing when demoing, because in the real workflow Wilson never adds the card,
the customer does.

## Still open

- The payment link loop, when it is wanted
- Real filter price list (the $70 is still a placeholder)
- API contract rewrite to v0.9, waiting on the dashboard dev
- HVAC signup still has a single exit
- Command center redesign
# v0.9.23 - A quote is an unaccepted enrollment

Two screens were building appliance lists and pricing them, and they disagreed.
`quote-builder.js` had no concept of filter service, so an 18-appliance house
with three filtered refrigerators and two filtered icemakers came out like this:

| plan | quoted | enrolled | gap |
|---|---|---|---|
| Estate Annual | $1,874.90 | $2,224.90 | **$350 under-quoted** |
| Estate Preferred | $2,295 | $2,645 | **$350 under-quoted** |
| Estate Concierge | $3,445 | $3,445 | same |

It also could not quote the per-appliance plan at all, and its appliance list
was types-with-quantities rather than individual units - which is how a second
icemaker visit went uncounted.

Wilson could send a customer one number and bill them another, with nothing in
the system able to say which was right.

## What replaced it

The registration screen now has **two exits**. Same picker, same areas, same
plan, same arithmetic - the only difference is what the customer has agreed to:

- **Submit enrollment** - needs a payment method and the renewal authorization
- **Send a quote instead** - needs the name, the address, and an email *or* a
  phone number. Nothing else. Demanding a card on file to find out a price is
  absurd.

A quote **stores the enrollment payload** rather than describing one. Accepting
it calls the same `createEnrollment` the registration screen calls - so the
quoted price is the enrolled price by construction, not by agreement between two
pieces of code.

`quote-builder.html` and `assets/quote-builder.js` are deleted. A dormant second
picker is a second picker somebody wires back up.

## Pricing moved out of the screen file

The arithmetic lived inside `appliance-builder.js`, and *that is why* the quote
screen wrote its own: a second screen needing a price had no way to ask for one.

It now lives in `WILSON_PRICING` in plan-config.js, next to the rest of the
business rules, and both exits, the proposal, the seed data and any future
dashboard call it. Pricing is a business rule, so it lives with the business
rules.

## A pre-existing defect this surfaced

On the per-appliance plan, `basePlanAmount` already included the recommended
second icemaker visits **and** `imucSecondVisitAmount` listed them again. The
total was computed separately and was correct, so nothing ever showed it - until
the new proposal started printing line items to a customer, where they would
have summed to $4,248.90 above a total of $3,749.

Fixed by splitting out `perApplianceFirstVisits`, and now asserted: across 4
plans x 8 portfolios, **every line-item set sums to its own total**.

## Accepting a quote is honest about what is missing

Converting creates a real household with **no card on file and no renewal
authorization**, because that is the truth of it. The payment profile lands as
"Pending setup", `acceptedTermsAt` stays null, and the screen says so:

> The household is on file. Still needed before the first charge: a payment
> method and the renewal authorization.

Accepting twice is refused rather than enrolling the house a second time.

## The proposal document

Rebuilt on the enrollment payload. It formats; it does not calculate. Appliances
are listed **individually and grouped by room**, which is how the household is
organised and how the technician will work it - the old type-plus-quantity table
read as an order form. The Location column is gone: the payload sets an
appliance's location *to* its area name, so it printed the same word twice and
cost a phone the width it needed for the frequency.

Filter service is on the price list. Its absence is the whole reason for this
rewrite.

A quote drafted before this version has no enrollment behind it, so it refuses
to convert and says to rebuild it - re-deriving a price would be recreating the
second engine this deletes.

## What now fails the build

- 30 quote/enrollment parity checks, including "THE QUOTED PRICE IS THE ENROLLED
  PRICE" and the line-items-sum invariant across 32 plan/portfolio combinations
- The old builder existing on disk, or anything linking to it
- A quote carrying `acceptedTermsAt` before anyone accepted it
- A second household from a double-tapped Accept
- The seeded demo quote drifting from what the engine says its list costs

## A hardcoded literal, replaced

`verify-offline-browser.py` asserted "11 pages are cached" and broke the moment a
page was retired. A page *count* is not a fact worth asserting; "every page that
ships is offline-available" is. It now globs the directory and compares names,
not just totals.

## Still open

- Real filter price list (the $70 is still a placeholder)
- API contract rewrite to v0.9, waiting on the dashboard dev
- The HVAC signup screen still has only one exit - the same two-exit pattern
  applies and is now cheap to add
- Command center redesign
# v0.9.22 - The strip reading is the input

> "it should be a number we input off of test strips. And then our algorithm
> should determine the multiplier. It shouldn't be something the tech can
> select, and we also don't need clickable options for things like softener
> bypassed or offline. There can be a flag that notifies the customer of the
> hardness in the report"

Right on all three, and v0.9.21 had it backwards. It made the technician **tap a
band**, which is tapping a multiplier - the exact judgement call the rest of
this tool exists to take off them. A strip gives a number. The number is now the
only input, and the algorithm does the rest.

The card went from five band buttons and three softener buttons to **one
control**, and from 787px tall to 253px.

## The softener question is gone, and it was double-counting

The strip is read at a tap, **downstream of any softener**, so a working unit
already shows up as a soft reading. Asking about the equipment on top of that
asked the same question twice and then needed a rule for what to do when the two
answers disagreed. Removing it deletes the question, the conflict rule, the
state vocabulary, and a SQL table.

One field-procedure detail this exposes, now printed on the card rather than
left to training: **read at an inside tap.** An outside hose bib is often
plumbed upstream of the softener, so a reading taken there describes the street
rather than the house. That is the one way this measurement can be quietly
wrong.

## Interpolated, not stepped

A band table was all a tapped band could support. A real number deserves better,
because a step function puts a cliff in the middle of the street: 10.5 and 10.6
gpg are the same water, and the band table handed the second house **1.2 fewer
years** on a 15-year dishwasher. Neighbours on one main, different answers.

The curve is piecewise linear through five anchors, and both ends are where the
honesty is:

| reading | factor |
|---|---|
| 3.5 gpg and below | 1.00 - soft water costs nothing |
| 7 | 0.95 |
| 10.5 | 0.88 |
| 15 | 0.80 |
| **26 and above** | **0.72, flat** |

26 gpg is the hardness Battelle actually measured. Past the evidence the curve
**stops** rather than continuing on confidence - a 60 gpg Hill Country well is
reported as extremely hard and adjusted no further than the study supports.

Across the old cliff: 10.4 -> 0.882, 10.5 -> 0.880, 10.6 -> 0.878.

## The customer's flag

Above the explanation, and only from "hard" upward. Austin city water is around
4.9 gpg, so flagging "moderate" would flag most of Wilson's book - and a flag on
every address is a flag people learn to ignore. It states the reading, says the
hardness is a property of the house rather than a fault with the appliance in
front of them, and ends on the reversibility.

## Two defects found while testing

**A stray keypress stored 12.8999 gpg.** Four decimal places of confidence from
a strip read against a printed colour chart, and the report would have printed
it verbatim. Readings now round to one decimal on save - what the instrument
actually resolves - so the stored record and the printed one are the same
number.

**An alias collision the schema checker caught.** The new interpolation used
`a.` for the anchor table, but `a.` is `MaintenanceAssets` throughout this
migration; it read as three asset columns that do not exist. Renamed to `an`.

## SQL, section 7.10 rebuilt

`MaintenanceWaterSoftenerStates` is deleted. `MaintenanceWaterHardnessBands`
keeps only description - no `LifeFactor` column, because a band that could price
a reading would put the technician back in the business of choosing one. The
algorithm lives in `MaintenanceWaterLifeFactorAnchors`, five rows.

**No multiplier is stored anywhere.** The factor is derived on read from the
reading and the current anchors, so correcting an anchor corrects every house at
once. A factor written onto the test row at save time would freeze today's
inference into history and quietly outlive it - that is now asserted, not just
intended.

## A parity test that compares numbers, not shapes

The structural checks prove the SQL has the right shape. Shape is not answers: a
`<` where a `<=` belongs passes every one of them and still disagrees at exactly
the anchor points.

`_qa/verify-water-parity.py` runs both sides over **411 readings** - a 0.1 gpg
sweep from 0 to 40, plus every anchor and 0.01 either side of it - and compares
the multipliers. Currently 0 disagreements.

Its limitation is stated in the file: there is no SQL Server here, so the view's
algorithm is transliterated into SQLite (real SQL engine, real rounding, anchors
read out of the generated migration rather than retyped). It catches anchor
drift, changed clamps, changed rounding, and boundary differences. It does not
catch a typo in the T-SQL the transliteration doesn't share. Running the
migration against a real SQL Server would close that gap.

Mutation-tested: an anchor drift and a rounding change are both caught
immediately. Two other mutations survived, and I checked rather than assumed why
- both are semantically equivalent edits (the explicit clamps duplicate what the
loop already returns), not test gaps.

## What now fails the build

- 47 water checks, including a 0.1 gpg monotonicity sweep, the flat-past-26
  clamp, "no band carries a life factor", and "no resolver still exposes a
  softener"
- The SQL/JS numeric parity above
- A softener table or column reappearing in the migration
- A stored band or factor on a water test row
- A nullable reading - a water test row without a number is not a water test

## Still open

- Real filter price list (the $70 is still a placeholder)
- API contract rewrite to v0.9, waiting on the dashboard dev
- Quote consolidation - next
# v0.9.21 - Water hardness as a lifecycle modifier

> "we should consider doing a water hardness test and having the techs carry ph
> strips or whatever they need... house water is a MAJOR factor"

It is, and it is the first factor in this tool that touches every water-bearing
appliance in a house at once. That reach is exactly why it is fenced in on all
five sides:

1. **It changes expected LIFE, never measured condition.** Hard water does not
   mean the dishwasher is unhealthy today, and the score it feeds is the age
   term - a quarter of the total.
2. **Only equipment that runs water.** Refrigeration, dishwasher, icemaker,
   washer, laundry centre. A dryer's life is byte-identical either way, because
   quietly shortening it would be inventing a mechanism.
3. **No strip, no adjustment.** Never inferred from an address or a ZIP code.
   An untested house gets a factor of 1.00 and the report says the water has not
   been tested.
4. **Bounded.** The worst band costs 28% of expected life, not half. The
   evidence behind these numbers is a water-heater *efficiency* study, not a
   lifespan study, and the report says so wherever the figure appears.
5. **Reversible, and said out loud.** "Softening the water removes it
   entirely" is the last sentence the customer reads.

What it actually costs, worst band, on the overall score:

| dishwasher age | effect |
|---|---|
| 4 years | -2 points |
| 6 years | -3 points |
| 10 years | -5 points |

Felt, not fatal, and it grows with age because scale accumulates - a young
appliance in hard water has not had time to suffer yet.

## The strip beats the claim

The softener options started out asking the tech to compare the softener
against a reading they had entered two taps earlier - "Softener, and the water
tests soft" versus "Softener present, water still hard" - and then **believed
their answer over the strip**. One mis-tap turned a failed softener into a
working one, erased the adjustment, and dropped the finding, silently.

The tech now records only what a person can establish standing in the utility
room:

- No softener on site
- Softener on site, running
- Softener bypassed or offline

and the reading decides whether it works. A softener marked running while the
tap tests 12.8 gpg is now a **finding** - "A softener is running here and the
water still tests very hard" - instead of a house that reads as soft. Where the
tech already told us the unit is offline, the card and the report say that
rather than offering the customer three guesses about equipment we had our hands
on.

Records written before this change keep their meaning: `suspect` still resolves
as a softener on site, it is simply no longer offered.

## Three defects found on the way

**A garbage reading took down the whole report.** A non-numeric gpg value passed
the empty check, failed to band, and threw - which would have cost a customer
their report over one fat-fingered keypad entry. An unbandable reading is now a
reading we do not have.

**Resolving a reading twice gave a different answer.** `store.waterFor()` returns
a *resolved* reading, so passing one back into `resolve()` read `.softener`
expecting an id, found an object, matched nothing, fell back to "unknown", and
reported a house with a failed softener as a house with no softener - with no
error anywhere. Found because a screenshot disagreed with the arithmetic, which
is not a reliable way to find it twice. `resolve()` is now idempotent and says
so on the object.

**An unrecognised softener state defaulted to soft.** Now asserted: an unknown
state never removes the adjustment.

## SQL, section 7.10

Five tables and two views, all seeded from `plan-config.js`:
`MaintenanceWaterHardnessBands`, `MaintenanceWaterSoftenerStates`,
`MaintenanceWaterBearingProtocols`, `MaintenanceWaterHardnessSettings` (one row,
carrying the honesty flag), and `MaintenanceHouseholdWaterTests` - full history,
one row per test, because a jump from 3 gpg to 14 between visits is a softener
that has failed since the last visit, and that is worth more than either reading
alone.

`vw_MaintenanceHouseholdWaterLatest` carries the same "strip beats the claim"
rule as the field tool, and `vw_MaintenanceAssetExpectedLife` joins it to the
equipment it affects. The asset life view takes its tier from the most recent
inspection rather than re-implementing brand matching in T-SQL - a third copy of
that rule is a third chance to disagree.

`vw_MaintenanceAssetExpectedLife` reports NULL for an asset nobody has inspected
yet, rather than a guess.

## What now fails the build

- 46 water-hardness checks, including monotonicity (harder water is never
  kinder), the 0.70 floor, untested = no adjustment, dry equipment untouched,
  and the arithmetic identity between shortening life and multiplying age
- SQL/JS parity on every band factor, every softener state, and the
  water-bearing protocol list
- The view's softener rule, structurally - the simplification back to "trust the
  softener field" is caught
- `IsSourced = 0` in the seed, so an inference cannot be promoted to a study
  without someone changing the config and reading the basis text

All six of those SQL checks were mutation-tested: each was confirmed to fail on
a deliberately broken migration before being trusted.

## Two checkers that were quietly broken

Found while testing the above, both flagged rather than silently patched:

- The migration is written **CRLF**, so a `$`-anchored regex never matched. My
  first band parser reported all five bands as missing; a checker that fails
  loudly for the wrong reason is only marginally better than one that passes for
  the wrong reason.
- The MERGE-key check recognised `INT`, `SMALLINT` and `BIGINT` inline primary
  keys but not `TINYINT`, and flagged a correct table. The omission was
  arbitrary, not meaningful.

## Still open

- Real filter price list (the $70 is still a placeholder)
- API contract rewrite to v0.9, waiting on the dashboard dev
- Whether the condenser temperature check is redundant with the new evaporator
  check, and how a laundry centre should score as washer + dryer
# v0.9.20 - Your workbook, three bugs, and the evaporator

## From the workbook

Three score changes applied, all of them expertise I did not have:

| answer | was | now | Cayden's reasoning |
|---|---|---|---|
| Patchy frost / ice ball at one spot | 3 | **1** | "partial or iceball condition = sealed system leak usually" |
| Heavy frost or ice build-up | 2 | **3** | a defrost or airflow problem, not a hole |
| No frost while the compressor runs | 2 | **1** | leak indicator |

That inverted my draft: I had heavy ice as the worse finding, and he moved the
leak indicators below it. The whole set is re-labelled around what a leak
actually looks like, and it gained an option it needed:

- **"Oily residue on the coil or lines" -> 1.** From "if there is oily
  refrigerant residue, bad". The clearest leak sign there is, and the sheet had
  nowhere to record it.

**A test was holding my draft numbers hostage.** `verify-answer-kinds.js`
asserted `iced === 2`, so his correction failed the build. Rewritten to assert
the RELATIONSHIP -- a leak indicator always scores worse than a restriction, a
restriction is always a deduction -- which is the thing that must stay true when
the numbers move again.

## Evaporator / cold plate, on the icemaker

"anything with an evaporator should have its evap or cold plate inspected during
maint." Added, scored on the same physics as the refrigeration frost pattern:

- Even freeze across the plate, no residue -- **5**
- Scale or mineral build-up -- **3** (this is the mechanism behind cloudy ice)
- Uneven freezing, or an ice ball at one spot -- **1**
- Oily residue on the plate, coil or lines -- **1**
- Not accessible -- no score

Also from the workbook: **"Airflow & filter status" is now just "Evaporator
airflow"** -- "Filter status doesn't matter. No good way to measure airflow. If
the fans are running they are running. The only restriction would come from a
frozen up damper or evaporator." The check asks exactly that and nothing else;
filters were already on the maintenance chips. And **"Components & operating
sound"** lost its bare 1-5 rating for named answers, because it was the last
unanchored judgement in the refrigeration protocol.

Removed: **"Internal icemaker cleaned"** from the refrigeration chips.

## Three bugs

**The number pad grew letters.** "when i click on refrigeration bin temp to enter
a value it opens a keyboard with numbers and letters now." The JavaScript was
correct -- it set `codes.hidden = true` -- and the stylesheet overruled it:
`hidden` works through a UA rule of `display: none`, and
`.tech-keypad-keys { display: grid }` beats it. The keypad SHEET already carried
the guard (`.tech-keypad-sheet[hidden]`), which is the tell: the trap was known
in one place and not the other. The new test counts what a technician can SEE
rather than reading the attribute, which is the only version that catches it.

**An age a technician established was thrown away.** "ive filled out several
field reports that include age on an appliance and it is still flagging in the
customer area". `saveTechInspection` wrote the age to the INSPECTION and never to
the APPLIANCE, so every visit that pinned down an install year discarded it: the
household page kept advising an invoice import, and the next visit asked again.
Now it writes through, with rules that matter because this touches a customer's
record:

- a document beats a judgement -- an invoice year is never overwritten by an
  estimate, only by a technician who explicitly corrected it, and then the record
  stops claiming a document it no longer matches
- an established age pre-fills the next visit, with its real source named. The
  card used to say "from the Wilson invoice" whatever the source was, so an age a
  technician established last visit came back quoting an invoice that did not
  exist
- **"cannot be established" is recorded too**, which is what kills the invoice
  prompt. There is no document to import for equipment Wilson did not sell, and
  advising one is advice that cannot be taken

**Mobile registration: the plan panel was sitting on the appliance tiles.**
`.enrollment-builder-layout` declares two columns and sits ~1800 lines AFTER the
`@media (max-width: 1120px)` block that collapses the layout, so at equal
specificity source order won. On a phone the appliance column collapsed to
**0px** while the panel held its 344px, and the tiles spilled out from under it
with the submit button floating across them. Same trap as the age picker in
v0.9.18.

Fixed, and the running total -- the best part of that screen -- is now mirrored
into a slim fixed bar rather than the panel being moved on top of the grid. One
calculation, shown twice. The bar only exists once an appliance is picked. Also:
section headings stack on a phone instead of squeezing a four-word question into
three lines beside a count pill.

**Billing:** the AR / account option is gone from the UI, card on file only. The
store still tolerates a legacy record rather than rewriting one.

19 suites green: 93 answer-kind, 26 control-audit, 180 browser, 44 ergonomics.

## Open, and waiting on you

- **Water hardness.** Agreed it is a bigger factor than several of the small
  checks, and it needs a decision about WHERE it lives before it is built -- see
  the reply.
- **The command center.** A proposal rather than a build, for the same reason.
- Two items from the workbook I did not act on alone: whether the condenser
  temperature check is redundant with the evaporator check ("maybe this is
  redundant"), and the laundry centre scoring as a washer plus a dryer with the
  data "smashed together".

# v0.9.19 - Conditions score, and every score is published

Cayden tested an icemaker: *"if i note that the ice pattern is cloudy or
incomplete, that usually means theres an issue. it should probably effect the
health score. i guess im having second thoughts on the observables not affecting
the score. because some are indicators of failure."*

He is right, and the fix is the one he proposed in the same message: *"maybe lets
do predefined scores for observables, where its clear to the tech what to click
so we get mostly consistent results."*

## The objection was real. Refusing to score was the wrong answer to it

Conditions were excluded because one technician's 4 out of 5 is another's 3, and
the customer cannot tell which. True — but cloudy ice is not a matter of taste.
It is scale, water quality, or a refrigeration problem, and a report that records
it and shrugs is the pencil-whipped service report this product exists not to be.

The variance problem is not solved by declining to score. It is solved by taking
the judgement out of the SCALE and putting it in the OPTION:

- **Every answer names observable evidence.** "Cloudy or incomplete cubes" is
  something two people can agree they are looking at. "Ice quality: 3/5" is not.
- **Every answer carries a published score,** written in `plan-config.js`, one
  place, reviewable — not derived from a regex over its own label, and not
  decided in the technician's head.
- **The score is printed on the button.** A tool that scores you in secret is a
  tool nobody trusts, and Cayden's condition was that it be clear what to click.
- **`score: null` is a real answer.** "Could not get to it" scores nothing and is
  never a failure.

56 measurements and 16 conditions now score; the 4 trend readings still do not,
because there is no agreed band to score them against.

## The generic three-way is gone

"Good / Wear noted / Needs attention" was on eight checks and was the same
unanchored judgement the 1-5 scale was, in fewer taps — nothing in the wording
says what "wear noted" IS. Each of those checks now has a vocabulary written for
the thing it is judging:

| what is being judged | full marks | the deduction |
|---|---|---|
| Ice production | Full, clear cubes at normal rate | Cloudy or incomplete **3** · hollow or very slow **2** · not producing **1** |
| Evaporator frost | Even frost across the active coil | Patchy **3** · heavy ice **2** · no frost while running **2** |
| Oven door seal | Pliable and sealing all round | Hardened, still sealing **3** · torn or gapped **2** |
| Washer door boot | Boot intact, no damage | Perforated, torn, or mould in the folds **2** |
| Dryer lint path | Screen, housing and transition clear | Transition crushed, kinked, or off **1** |
| Hood baffles | Clean and undamaged | Deformed, split, or missing **2** |
| Blower sound | Quiet and steady at every speed | Audible but steady **4** · bearing whine or rattle **2** |
| Duct entry | Clean | Heavy build-up beyond reach **3** |
| Icemaker bin | Liner sound, surfaces clean | Liner cracked, or mould in the seams **2** |
| Microwave cavity | Clean, no damage | Arcing marks or burns **1** |
| Grill | Grates, burners and firebox sound | Heavy corrosion **3** · burn-through **1** |
| Furnace flame | Immediate ignition, clean blue flame | Lazy yellow flame **2** · rollout or no light **1** |
| Heat exchanger | No cracks or scaling seen | Scaling, no crack **3** · suspect **1** |

A crushed dryer transition and a suspect heat exchanger score 1 because they are
the two most serious things in the whole product.

## Dirt is still free, and now you can see that it is

Every "cleaned at this visit", "debris only", "residue only" and "cosmetic marks
only" answer scores **5 of 5** — the same as pristine. Wilson does not dock a
customer for the state their appliance was in before the technician arrived, and
that rule now sits on the button instead of in a config comment. It is asserted
too: `verify-check-controls.js` fails the build if any answer describing dirt or
cosmetic wear scores below full marks.

## No score anywhere comes from a regex any more

Pass/fail scores were derived by matching each option's `result` text —
`/^pass$/` was 5, `/^(slow|codes stored|wear)/` was 3. It worked, and it meant
what an answer was worth depended on how its label happened to be worded: rename
"Slow" to "Sluggish" and it silently stops being a 3 and starts being unscored.
All 149 answers now publish their own number. The regex survives only for
inspections recorded before this release, and the audit makes sure nothing new
reaches it.

## The anchors reach SQL Server

`MaintenanceCheckpointOptions` — 149 rows, generated from the same config, with
`ScoreValue` (NULL allowed, 1-5 enforced by a CHECK), `RaisesFinding` kept
separate from the score, and `RequiresDetail` for the stored-code case. Without
this the published scores existed only in the browser and a dashboard computing a
health score in SQL would have had to invent them. `verify-sql-migration.py`
compares all 149 against the config and asserts the dirt rule on the SQL side
too.

## What Cayden asked that this does not answer

**"where did frost pattern go for icemaker?"** — it was never there. Frost
pattern is a refrigeration check; the icemaker's equivalent is the ice pattern
check, which is the one he was looking at. What DID disappear from the icemaker,
in v0.9.18, is the **cleaning / descale cycle** checkpoint — it became a
maintenance chip, so the protocol went from 5 checks to 4. That is almost
certainly what he noticed.

Open question for the crew: an undercounter cuber has a freeze plate, and scale
or uneven freezing on it is the mechanism behind cloudy ice. There is no check
for it. Worth adding?

## Also

- The report prints what each condition was worth ("3 of 5") beside it, so a
  customer can add the column up rather than take the total on trust.
- "Technician observations" is now "Conditions checked by eye", and its note
  explains that the values are fixed in advance and identical on every visit.
- `measuredCount` counts only instrument readings again. Conditions score now, so
  they had silently joined the "N of M measured checks were inside target"
  sentence — which is exactly the claim that sentence exists to keep checkable.

19 suites, 26 of them new-or-rewritten checks in the control audit alone. Every
assertion that encoded the old "conditions never score" rule was rewritten rather
than deleted, and the history of one of them is worth keeping: v0.9.17 asserted
an observation stored rating **0** and passed while that 0 sent customers reports
saying "Action"; v0.9.18 fixed it to **null**; v0.9.19 asserts the **published
number**. Each version's test was right about its own design. Only the first was
protecting a bug.

## Still open

- **Cayden is going through every check to say which are genuine indicators of
  failure.** The anchors above are a draft by someone who has never had to make
  that call in a customer's kitchen. The review page lists all 149 for correcting.
- A freeze-plate / evaporator check for icemakers, if the crew wants one.
- API contract rewrite to v0.9, waiting on the dashboard dev.
- Real filter price list; cancellation/proration; role permissions; retiring the
  pre-v0.7 `MaintenanceHealthReport*` tables; the merge adapter and rollback.

# v0.9.18 - Does the question match what you are measuring?

Cayden used the field tool for the first time and found four things in about ten
minutes. All four were real, three of them came from ONE line of code, and the
general point he made underneath them -- "it seems like all of the health checks
need a pass to verify that the options make sense for the type of check /
measurement being documented" -- turned out to be the whole release.

## 57 of 78 checks opened a number pad for an answer that was not a number

`readingButtons()` read:

    if (answer.control === "keypad" || check.readingLabel)

and every checkpoint in the product carried a `readingLabel` left over from the
typed screens -- "Leak result", "Seal condition", "Codes / result", "Condition
after cleaning". So a rubber door seal asked to be entered as a figure, and the
pass/fail buttons that were the actual answer sat underneath the pad looking
optional. In Cayden's words: "it looks like all of the prompts to enter a manual
note just launch the keypad."

The pad now appears if and only if the check takes a reading, and every reading
is a NAMED field. The 39 vestigial labels are deleted rather than ignored --
config the renderer skips is the next person's trap.

## A door seal called Good scored 0, and reached the customer as "Action"

`applyOption` stored `rating: 0` for an observation, directly beneath a comment
claiming it stored nothing at all. Zero is this product's sentinel for NOT
ANSWERED, so one wrong constant produced four visible failures:

- the check's pill printed a bold **0**
- `checkStateClass` painted the card red and labelled it "Needs follow-up"
- the appliance tile flagged the whole unit, because its filter was
  `Number(c.rating) <= 2` and `Number(null)` is 0
- and `generateReportFromTechInspection` printed the status as **Action** on the
  customer's report, because 0 fell through every branch of
  `rating >= 4 ? "Pass" : rating === 3 ? "Watch" : "Action"`

Observations now carry `rating: null`, `freshCheck` keeps a null null across a
reload, and one function -- `checkOutcome` -- decides state everywhere. It reads
the rating only when there IS one. A condition shows what was recorded ("Good"),
and a condition the technician flagged reads as flagged without ever touching
the number.

**A test was protecting this.** `verify-answer-kinds.js` asserted
`obsCheck.rating === 0` under a comment about leaving no rating behind. It
passed the whole time.

## The oven asked for one number for two numbers

"Actual temp / set point" was a single box, so a technician could enter 327 or
350 but not both -- and the difference is the entire measurement. Three checks
were like this. They now declare their fields, and the tool does the subtraction
on screen while the technician is still at the appliance, which is also the
cheapest possible catch for a transposed digit:

| check | fields | derived |
|---|---|---|
| Oven temperature accuracy | set point, measured after stabilization | difference |
| Dryer exhaust | outlet temperature, room ambient | temperature rise |
| Microwave heating | water before, water after, minutes on high | rise |

The dryer gained the ambient because an outlet temperature alone is not
comparable between a January and a July visit.

**A bug I introduced fixing this, caught by screenshotting the card:** `isDone`
only ever looked at `check.reading`, the single-box value. The moment the readings
became named fields they went to `check.readings`, and the check could never be
completed -- both numbers entered, card still reading "Not started".

## Nine checks asked what the chips already ask

"Filter & sump condition" offered *completed / partly done / not done / not
applicable*, because it was classified as work performed. Cayden: "looks like
that needs attention... both maintenance cycle and filter and sump condition are
health checks and then options after all the health checks to be selected if they
were completed on this visit."

Exactly right, and the duplication was the cause. Every maintenance checkpoint
had a chip saying the same thing eight inches further down the page. So:

- **the work moved to the chips**, where it already was -- there are no
  maintenance checkpoints left
- **the condition became a real check**, with a photograph and a prompt that asks
  what was found BEFORE cleaning: filter and sump, washer door boot, dryer lint
  path and transition, hood baffles, icemaker bin, laundry filter
- **two were pure work** -- the dishwasher's machine clean cycle and the
  icemaker's descale -- and are now only chips

A torn door boot or a crushed transition duct is not cosmetic and not
housekeeping. It does not move the score, and it does raise a finding.

## "Codes present" now demands the code

Announcing a stored fault and discarding the code tells the customer a fault
exists and throws away the only part of it anybody can act on. Choosing it leaves
the check **unfinished** until the code is entered, on a letter pad rather than
the phone keyboard, and the code prints on the report for whoever works on that
appliance next.

## Every pick-one list has a way out

Twenty-two option lists were two-way -- Dry / Leak found, All operate / Fault
found -- so a base panel that would not come off left a guess or a blank check.
"Could not see the area" and "Could not test it" are answers, and they score
nothing. The separate N/A button is a different fact: *this unit does not have
one* versus *it has one and I could not reach it*.

## The pass, made executable

`_qa/verify-check-controls.js` is the pass Cayden asked for, as 19 invariants
against the real config and the real rendering functions:

- no check opens the pad for an answer that is not a number
- no numeric check collects its readings in one unlabelled box, and no field
  label names two quantities
- no protocol carries a maintenance checkpoint, and every protocol has chips
- every scored result maps to a rating deliberately; no scored pass/fail is
  unfailable; every list has an escape
- no observation stores a rating of any kind
- every "codes present" option demands the code, and choosing it enforces that
- counts say what they count; trends never also ask for a rating

It failed on all four of Cayden's reports plus two he had not hit, before any of
this was fixed. Also in the suite now: `ResultKind` / `ScoresHealth` on
`MaintenanceProtocolCheckpoints` with a CHECK constraint that makes "work
performed raises the health score" unrepresentable in SQL Server, and
`vw_MaintenanceScoringCheckpoints` as the only thing a score calculation should
read.

19 suites, all green. 76 checkpoints across 15 protocols: 56 scored, 16
conditions, 4 recorded-only.

## Still open

- The protocol review page is the thing to argue with next -- which conditions,
  if any, the crew thinks should carry weight.
- API contract rewrite to v0.9, waiting on the dashboard dev.
- Real filter price list; cancellation/proration; role permissions; retiring the
  pre-v0.7 `MaintenanceHealthReport*` tables; the merge adapter and rollback.

# v0.9.17 - Nothing to type, and nothing invented

Two changes, and they turn out to be the same change. The field tool no longer
asks a technician to type anything during a protocol, and the health score no
longer contains anything a technician did not measure. Removing the keyboard
forced every question to declare what KIND of answer it wants -- and once the
kinds existed, it was obvious that three of the four were never health data at
all.

## Every question now declares what kind of answer it takes

`WILSON_ANSWERS` in `plan-config.js` is the new single source of truth. Each of
the 78 checkpoints across 15 protocols carries a kind:

| kind | count | what it is | scores? |
|---|---|---|---|
| `scored` | 56 | measured performance against a target | **yes** |
| `maintenance` | 9 | work Wilson performed | no |
| `observed` | 9 | a technician's judgement of a condition | no |
| `trend` | 4 | a reading with no agreed tolerance yet | no |

`WILSON_ANSWERS.scorable(setKey, checks)` is the ONE gate. Before this, every
answered check averaged into the customer's number, which meant:

- **"Maintenance clean cycle -- performed" raised the customer's health score.**
  Work Wilson was paid to do was scoring the appliance it was done to. That is
  the closest this product has come to grading its own homework, and it was on
  every dishwasher report.
- **An evaporator frost pattern carried the same weight as a compartment
  temperature.** One tech's 4/5 frost pattern is another's 3/5, the customer
  cannot tell which, and neither can the score. It is now recorded, printed,
  and photographed -- and it does not move the number.

The report grew a third section to match: **Performance checks** (what scored),
**Maintenance completed** (what Wilson did), **Technician observations** (what
the tech saw). Same visit, three honest columns, instead of one blended number
that quietly mixed all three.

## The protocol can be worked without a keyboard

- **Readings go in on an in-app number pad.** Big keys, no OS keyboard sliding
  up over the card, a **"Not measured"** key that is a real answer rather than an
  empty box, and it works with the server switched off (asserted with the server
  actually killed, not emulated offline).
- **Age is picked, not typed.** When the invoice answered it, the year is shown
  as a fact and costs zero taps. Otherwise: decade, then year, then done -- or
  **"Cannot establish it"**, which is also an answer. Re-opening the picker
  clears rather than pre-selects, because a pre-filled history is an invitation
  to confirm instead of measure.
- **Maintenance is chips, not prose.** 66 actions across the 15 protocols
  ("Condenser coil vacuumed", "Water filter replaced", "Descale cycle run").
  Tapping them writes the customer-facing note. The grill's list includes
  "Condition documented (no cleaning performed)", because that is frequently the
  true answer.
- **What did NOT get built: a one-tap "everything else is normal" button.** It
  would have saved about sixty taps on a whole-house stop. It is also
  pencil-whipping with a button on it, and this product's entire value is that
  its reports are true.
- **Free-text notes stay.** Per appliance, for the tech's own words -- opinions
  are the point of hiring good techs, and a chip list cannot hold them.

## Age counts, on both sides, at 25%

Age was already 25% of the appliance score and 0% of the HVAC score. A
fifteen-year-old system that meets its nameplate scored 100%, which understates
repeat-failure risk -- and repeat failures are how a customer gets nickel-and-
dimed. Both sides are now **75% measured condition / 25% age**, components always
printed separately so the customer can see which half is which. The efficiency
rating stays at **0%**: a 14-SEER system that delivers what a 14-SEER system
should deliver is a healthy system.

## The expected-life table now cites its sources

`lifecycleMatrix` was my invention. It is now re-anchored to published figures
with per-row provenance in `lifecycleSources` -- ASHRAE service-life medians,
the NAHB household-component study, DOE/AHRI consensus figures, and the
manufacturers' own statements (Carrier on maintained vs unmaintained, Sub-Zero
on its own refrigeration). **10 of 15 rows are sourced.**

My drafts skewed SHORT -- by two to five years on dryers, hoods, washers and
refrigeration. That error is not harmless in this direction: a short expected
life inflates "life used", which lowers the age score, which lowers the
customer's number. The invented figures were quietly pessimistic about their own
equipment. Dryer luxury went 15 -> 18, refrigeration premium 14 -> 16, and
furnace luxury came DOWN from 25 to 22, which was above every published figure.

**5 rows are still estimates and say so** (`sourced: false`): undercounter
icemakers, built-in grills, mini-splits, stacked laundry, and the generic
fallback. No published service-life figure exists for them in any of those
sources. Wilson's own service history is what will eventually answer it -- every
visit's readings are already stored per appliance.

## Two invented numbers found by looking at the screen

Both of these read perfectly well in the code, and both were caught by taking a
screenshot of a phone-sized viewport and looking at it.

- **An appliance scored 16 · F before the technician touched it.** The average
  over zero answered checks fell back to 0, vitals became 0, and the age term
  carried the whole number. A grade is a claim about equipment; it now waits for
  evidence. No measurement, no score -- and the caption says which it is and how
  many of the protocol's scoring checks the current number rests on. On the
  report, `Number(inspection.vitalScore || 0)` was the same bug one layer down,
  publishing a refusal as a zero.
- **The age picker was two year-buttons wide.** Every button was present, 48px
  tall and correct; the picker sat in one column of a lifecycle card whose
  column count is set by three different media queries whose order does not
  follow their width. Seven years laid out two per row, and "Cannot establish
  it" was pushed below the fold -- so the one honest answer available to a tech
  who cannot date an appliance was the one thing off the screen.

Also: a trailing decimal point ("38.") no longer reaches a customer's report,
and the undated-appliance copy no longer says "Enter an age" in a tool with
nothing to type into.

## QA

18 suites, all green. New this release: `verify-answer-kinds.js` (the kind
system and the scoring gate), and geometry assertions in
`verify-field-ergonomics.py` that measure rectangles rather than markup --
because the age-picker defect was invisible in the DOM and obvious in a
screenshot. `verify-report-honesty.py` now drives the field tool and asserts
that no number and no letter grade appear before anything is measured.

The static test server answers POST with 501, which makes it a free test of a
refused photo upload: the smoke suite now asserts the photograph is still on the
device, still queued, and that nothing claims to have been sent.

## Still open

- API contract rewrite to v0.9 -- waiting on the dashboard dev.
- `ResultKind` column, so the answer kinds reach SQL Server rather than
  stopping at the browser.
- Real filter price list ($70 is still a placeholder, and is labelled one).
- Worksheet questions for the crew: condenser inlet/outlet AIR delta-T as a
  trend check (replacing the coil-surface reading), dishwasher inlet water
  temperature, icemaker freeze-cycle time.
- Cancellation/proration, role permissions, retiring the pre-v0.7
  `MaintenanceHealthReport*` tables, and the merge adapter plus rollback script.

# v0.9.16 - What a customer is allowed to be told

Four audits of the shipping package: the customer-facing language, the field
tool's ergonomics, staleness and internal inconsistency, and accessibility and
print fidelity. This release is what they found. Nothing here was a crash --
every one of these read perfectly well in the code, which is why they shipped.

## The report was steering toward replacement in five places

None of them intentionally, and all of them on AGE alone against a DRAFT
expected-life figure:

- **"Replacement Planning"** was a lifecycle stage printed on the customer's
  report for any appliance past 90% of a draft life estimate. No reading, no
  fault, no technician judgement, and no hint the figure behind it was a draft.
  The four stages now read Early life / Mid life / Late life / **Past draft
  expected life** -- which is what the arithmetic actually knows.
- **"replacement is worth planning for rather than reacting to"** -- the
  longevity guidance for the same band. Now: "past its draft expected service
  life and its readings have moved. The findings below are serviceable items,
  and addressing them is what keeps it running."
- **"Repair remains the first option and is costed below"** was false as well
  as leading: `economics()` is not rendered by any customer-facing page, so
  nothing was costed anywhere below it.
- **HVAC "Worth budgeting for"** / "the one to have a number in mind for" /
  "the decision happens on your terms rather than in August" -- a
  replacement-budget nudge with an implied cost, firing on age plus any single
  dimension under 80%. Now states the facts and stops.
- **"Nothing on this visit needs follow-up. Every appliance was measured and is
  performing in line with its age."** The banding deliberately excludes age --
  the comment above it says so -- so this described a comparison the code
  refuses to make. Now: "every reading was inside the target the technician
  used."

## Four things the report said that the data did not support

- **An HVAC report claimed its score blended in 25% lifecycle age.** HVAC
  scores contain no age term at all -- that is the whole guardrail -- but the
  report had an age on it, so the generic explanation fired. It now says what
  is true: measured performance against the system's own nameplate, with age
  and efficiency printed as facts and neither in the number.
- **A system nobody could measure was published as 0%.** `scoreHealth` refuses
  a score under 60% coverage; `Number(null || 0)` turned that refusal into
  zero, the cover read "Your appliance score 0%", and the whole-house review
  then banded it the worst equipment in the house. It now prints **Not scored**
  with the reason, and the review bands it "Not scored" rather than "Needs
  attention".
- **A checkpoint marked NOT APPLICABLE became a customer-facing follow-up.**
  N/A carries rating 0, 0 is <= 2, so a heat-pump dryer with no vent produced
  "One or more health checkpoints need follow-up", listed the vent under
  Corrective measures, and printed it as status "Action". The field tool's own
  status logic already excluded N/A -- two copies of one rule, and the
  customer-facing copy was the wrong one.
- **"Report status: Final"** was hard-coded with no status field behind it, on
  a report the store can regenerate (its own activity log says "refreshed").
  Replaced with the issue date and source, which are real.

## Three defects of the kind that only show up when you look at the pixels

- **"Above range" and "Below range" readings were styled as unremarkable.**
  `statusClass` tested for the substring "out", and the stored strings are
  "Above range" / "Below range" / "High side of range" -- the word never
  appears. The one card a customer most needs to notice had no emphasis on it.
- **Filters with no due date were reported as not due.** `daysFromNow` returns
  NaN for a missing date and `NaN <= 90` is false, so "none due within 90 days"
  was printed for filters whose own row in the table beside it showed "-".
- **`Condensate &amp; drainage`** -- sixteen checkpoint names carried HTML
  entities and every render path escapes, so the customer read the entity.

## The field tool: 40 taps and 96 keystrokes per HVAC stop, recovered

- **The nameplate now stays on the appliance.** The plate card told the
  technician "Read once; it carries to the next visit" and wrote to the
  inspection record instead of the asset -- so all eleven fields were re-read
  every visit, for numbers stamped on the side of the equipment. Merged onto
  the asset on save; a blank field never erases what the last technician read.
  Eight taps and twenty-four keystrokes per system per visit.
- **Readings come before the rating.** Reading top-down, a technician rated
  before measuring, which left the check "blocked" so the auto-advance never
  fired and the next card had to be opened by hand. Fixing the order fixes the
  advance -- and a rating entered before the measurement is a judgement formed
  without it.
- **The Complete button says what it is waiting for.** It was disabled with its
  reason two screens below, and the "Required steps missing" toast could never
  fire, because a disabled button raises no click. It now reads "Complete &
  generate report / Still needed: serial photo, 6 checks, age".
- **A photograph's thumbnail no longer vanishes.** `renderChecks` rebuilt the
  thumbnail node empty and only two other paths refilled it, so the first
  rating tap after saving a photo blanked the image while the button still read
  "Photo saved". That is the only check on a blurred serial plate.
- **Completing an appliance returns you to the top**, where the one-tap path to
  the next appliance is.
- **Reading fields sit in a form** so iOS offers Next/Previous, and a check
  with a unit gets a numeric keypad -- the code already knew it was a number
  and served an alphabetic keyboard anyway.
- **The metering device stopped claiming to gate the charge score.** It is
  declared as scoring "charge" and `chargeScore` never reads it, so the card
  told technicians a score was waiting on a field it ignores.

## Accessibility and print, measured rather than assumed

- **Every tap target on the phone surfaces is now at least 44px**, and no two
  adjacent controls are closer than 8px. The rating row had five 56px buttons
  four pixels apart where a mis-tap rates "Concern" instead of "Monitor" and
  the card collapses before you see it; Save now / Complete were six pixels
  apart. The footer nav measured 20px, the menu button 38px, the field tool's
  only way back 28px.
- **Contrast**: the worst failure was the word "Required" on a required field
  at 2.96:1. Every measured pair below 4.5:1 has been re-toned, and no text in
  the field tool is under 10px (the rating labels were 7px at 4.26:1).
- **The toast is announced.** It is the only channel for "Required steps
  missing", "Report not generated" and "Billing blocked", and it had no
  `role` and no `aria-live` -- silent to a screen reader.
- **Labels are associated with their controls** in the field tool; two reading
  fields shared the accessible name "If applicable", and the 16 "Report" links
  on the review now name their appliance.
- **The numbers behind the trend charts print.** `@media print` hid the table,
  so a customer's Service History sheet carried four line squiggles and one
  endpoint number, with 2.8 inches of blank paper underneath where the four
  visits of actual data would have gone.

## The migration would not have worked

`sql/maintenance_migration_v09.sql` -- the file the main dashboard developer
runs -- had been generated from a config predating the HVAC work. It carried
**11 protocol templates where the config has 15, and zero of the four HVAC
protocols, 21 HVAC brand tiers or 12 HVAC expected-life rows.** Its own header
says "do not hand-edit -- regenerate"; nothing verified that anyone had.

Two tests now make that impossible to repeat:

- `verify-sql-migration.py` compares the seeded protocol codes, checkpoint
  count, brand-tier count, expected-life count and lifecycle-stage vocabulary
  against `plan-config.js` **live**, and fails with the regenerate command.
  Verified by deleting a template row and watching it fail for the right reason.
- `verify-protocol-parity.py` now exercises the `hvac` asset group. It did not,
  which is precisely how a migration with no HVAC protocols in it printed
  "PARITY CONFIRMED" -- and the first run with HVAC included immediately found
  that the SQL view had no HVAC arm at all, so it resolved HVAC assets by
  appliance type. The view now mirrors `resolveCheckpointSet`, and 945 cases
  agree.

Two further copies of one rule, both fixed at the source: the whole-visit
review hard-coded its attention bands at 70/85 while the report graded Good
from 80 (so one appliance at 82 read "Good" on its own report and "Monitor" on
the review), and the seeded demo reports used a stage vocabulary -- "Late Life"
-- that exists nowhere else in the product.

## Verification

15 suites, **372 checks**, all green. Two are new:

- `_qa/verify-report-honesty.py` (40 checks) -- what a customer may be told,
  asserted against the rendered page, including a banned-phrase list where
  every entry is a sentence that actually shipped.
- `_qa/verify-field-ergonomics.py` (30 checks) -- tap targets, WCAG contrast
  computed in the page, label association, the nameplate surviving a visit, and
  a photograph surviving a re-render. All measured in a browser at 390x844.

## Also

- The airflow band (350-450 CFM/ton) is marked `draft: true` in config and
  nothing read the flag, so the one scored HVAC dimension resting on an
  unsigned-off number presented it as fact. It now reports "against a draft
  350-450 band" wherever it states its basis.
- Stale documentation corrected: `PHONE_FIELD_TESTING.md` said there was no
  authentication, that photos are never uploaded, and that HVAC has no field
  workflow -- all three false as of v0.9.14/15. `README.md` still said v0.3 and
  gave a folder name that does not exist. The project-context handoff document
  has a "since v0.9.14" section at the top.

# v0.9.15 - Ready to run on a real house

The tool was built for real stops and was not yet safe to run one. Two things
were in the way, and both are now closed.

## Nothing reaches the network without a passcode

Up to v0.9.14 the server bound `0.0.0.0` and served every file in the folder
to anyone who could reach the port, with an unauthenticated 30 MB upload
endpoint attached. That was defensible while the only customer in it was
invented. The moment a real maintenance stop is run, the same folder holds a
real customer's name, address, phone number and photographs of the inside of
their house -- and on a store's Wi-Fi, "anyone who can reach the port" is not
a small set of people.

Two rules, enforced in code rather than written in a document:

1. **Loopback is the default.** Without `--lan` nothing off the machine can
   reach it at all. `OPEN_WILSON_PORTAL.bat` is now a local demo launcher.
2. **The network needs a passcode.** `--lan` refuses to start without one.
   There is no flag combination that serves customer data to a network
   unauthenticated, because the flag that would do it does not exist.

`--set-passcode` stores a salted PBKDF2 hash in `.wilson-passcode` (gitignored,
never packaged); `WILSON_PASSCODE` works for a scripted start. Sessions are 12
hours, HttpOnly and SameSite, and five wrong guesses from an address buy a
minute of silence -- including for the right passcode, which is the point.

New launchers: `SET_PASSCODE.bat` / `set_passcode.sh`, and
`OPEN_FOR_PHONES.bat` / `start_for_phones.sh` for the LAN.

This is a shared-passcode gate on a prototype, not an identity system.
Per-user accounts and roles belong to the main dashboard.

## Photographs now leave the phone

Photo evidence is the strongest thing in the tool, and every image lived in
exactly one place: the IndexedDB of the phone that took it. A dropped phone
and the evidence for a customer's maintenance history was gone with no trace
it had ever existed.

`assets/photo-sync.js` drains `pendingUpload()` to `POST /api/photos`, and the
rules it follows are the interesting part:

- A photograph is marked uploaded **only after the server says it wrote the
  file**. Not when the request was sent. The pending count is what a
  technician uses to decide whether it is safe to clear their browser, so it
  has to stay true.
- **The local copy is never deleted.** Uploading is a second copy, not a move.
- A dead network or an expired session **stops the run and leaves the queue
  alone** -- neither is this photograph's fault, and neither burns a retry.
- A file the server refuses is retried three times, then skipped with its
  reason kept on the record, so one bad photo cannot block the queue behind it
  or hammer the machine forever.
- The status line in the field tool sits **in** the page, not fixed over it:
  the Complete button is sticky at the bottom of the screen and covering it
  would have been a worse bug than the one this fixes.

Photos land in `photo-store/<visit>/`, each with a sidecar recording which
appliance and which check it is evidence of. The folder is gitignored -- these
are the insides of customers' houses.

## Verification

`_qa/verify-server-auth.py` (52 checks) starts the real server as a
subprocess in each configuration and tries to get files out of it: reading the
source would prove nothing, since the interesting failures are the ones where
the code looks right and the socket disagrees. It also proves `--lan` will not
start unprotected, that a path in a photo id or visit id is refused, that a
partial upload leaves no partial file, and that the passcode itself never
appears in the file that stores it.

`_qa/verify-photo-sync.py` (39 checks) runs the real IndexedDB store and the
real sync layer in a real browser against that server, and checks the server's
disk rather than the page's opinion -- including that a network failure leaves
the record saying "not uploaded", that a refused file keeps its reason, and
that a stuck photo does not block a good one behind it.

Suite total: **302 checks**, all green.

## Also in this release

- `docs/FIELD_CARD.pdf` -- one page for the van: the stop in order, the numbers
  the tool judges today, what we never do (clean a grill; recommend a
  replacement on a report; print a price), and what to do when there is no
  signal.
- `docs/PILOT_READINESS.md` -- the before-the-first-real-stop checklist, what
  changed, and the four things still open (one shared passcode not accounts,
  no HTTPS, `photo-store/` is not backed up, the customer's copy is still
  Print / Save PDF).
- `docs/PROTOCOL_WORKSHEET_APPLIANCE.pdf` and `..._HVAC.pdf` -- the protocol
  questions as fillable-and-printable worksheets, for the technicians who have
  no account to sign into anything with.

# v0.9.14 - The HVAC side, built the honest way

## The guardrail, because it was the whole request

> should we use the same 9 points of measurement that measurequick does but do it in a way that doesnt instantly dock the customer 15 points on efficiency just because the system isnt 20 seer?

Yes to the nine readings -- they are what the physics of a refrigerant circuit and an air system require, not a product decision. No to the efficiency deduction, and the fix is structural rather than a matter of wording.

**Every scored target comes off the equipment's own nameplate.** Rated capacity, rated airflow, maximum external static, rated load amps, temperature-rise range: a new `hvacDesignProfile` captures them once and every dimension is judged delivered-versus-plate. A 13-SEER three-ton unit moving three tons at its rated airflow and rated static scores **100**, because that is what a 13-SEER three-ton unit is supposed to do.

`scoreHealth` is not given age and is not given efficiency. That is enforced by the function's argument list rather than by everyone remembering, and the test suite asserts identical scores across 13/14/16/18/20/24 SEER on identical readings, plus identical furnace scores across 70/80/90/98% AFUE.

Efficiency is still reported, because a customer paying the bill is entitled to know what the system costs to run. It is reported against **its own rating** -- "this system is rated at 14 SEER; a system meeting its own rating is performing correctly, whatever that rating is" -- and it says on its face that it is not part of the score.

## The planning horizon, instead of a nudge

The distinction you drew is the one the code now makes: a maintenance tool should **build** a replacement pipeline, not **expedite** one.

So there is no replacement recommendation anywhere in the HVAC path. There is a planning horizon -- five states from "nothing to plan for" through "worth knowing about" to "worth budgeting for" -- and the hard rules are asserted from both directions:

- **Age alone never reaches a replacement posture.** An 18-year-old system past its rated life that measures perfectly lands on "worth knowing about", and its sentence is *"past its expected service life and measuring correctly, which is a credit to how it has been looked after. Nothing needs doing."*
- **A serviceable fault with life remaining is a repair**, however bad the readings. Same guard as the appliance side.
- No horizon and no guidance sentence tells a customer to replace anything, and none invents a cost. Both are tested with a negation-aware check, because the first version flagged the disclaimer *"nothing here says replace it now"* as a recommendation.

## Three ways HVAC was unreachable, not one

I reported last time that HVAC field work was "a three-check stub". It was worse than that. Three independent gates, each of which alone would have been enough:

1. `scopedAssetsForVisit` filtered out `group === "hvac"` for **every visit of every kind**, so an HVAC visit had zero equipment in scope.
2. The field tool kept its **own copy** of that filter, which disagreed with the store's.
3. The field tool then refused outright: *"the appliance field tool only opens appliance-maintenance visits."*

Scope now follows the visit's own `category` -- the field that was always there for it -- and the field tool delegates to the store so there is one implementation and one answer.

## What was built

**Four protocols** replacing the generic fallback: `hvac_cooling` (6 checks, 11 readings), `hvac_heatpump` (8/12, with heating-mode changeover, defrost and backup-heat staging), `hvac_furnace` (7/5, built around the plate's own rise range), `hvac_minisplit` (5/4, reshaped for equipment with no duct static and often no ports). Resolution is by system type; **"Other" still falls through to generic on purpose**, so an unclassified system stays visible as a gap rather than quietly getting three ratings.

**Gas Furnace is a new enrollment type.** Previously a furnace was enrolled as a Split System and inspected on a cooling protocol that asks for a refrigerant circuit it does not have.

**Nine derived readings**, all arithmetic on entered values: superheat, subcooling, condenser approach, temperature split, total external static, temperature rise, amps as a percentage of nameplate, CFM per ton, static as a percentage of rated. They appear live in the field as the numbers go in -- superheat showing up while the gauges are still on the system is how a transposed reading gets caught before the technician leaves.

**Expected-life rows for HVAC**, which did not exist at all, plus **twenty HVAC brand tiers**, which also did not exist -- so every system silently inherited the premium default. Both are marked drafts, and the brand table is the most arguable thing in the config file: several of those names share a parent company and a factory, and whoever knows which ones actually last in Hill Country service should overwrite it wholesale.

## What is deliberately NOT built

**No refrigerant property tables.** Converting pressure to saturation temperature needs published per-refrigerant data using dew point for superheat and bubble point for subcooling. Writing those from memory would put an unverifiable number underneath every derived value on the page, and a wrong saturation temperature makes superheat, subcooling and the charge score all wrong -- silently and confidently. The technician enters saturation temperature, which every digital gauge displays directly and every analog dial has printed on it. When Wilson wants pressure-in, the tables belong on the server, sourced and verified.

**No psychrometrics, so no delivered capacity in BTU/h and no computed EER/SEER.** A test greps the code for `SATURATION_TABLE`, `enthalpyOf`, `wetBulbFrom` and friends and fails if any appears.

**Cooling capacity is not scored, and this is a correction to my own first attempt.** I initially proxied it from CFM per ton -- which is the exact reading the airflow dimension already scores. One measurement drove 50% of the health score under two different names, so a system 10% low on airflow was docked twice for it. Temperature split is not a substitute either: a system with half the airflow shows a *bigger* split, so a split-based capacity score would reward the fault. It now reports as `needs-delivered-heat-measurement`. The furnace path does score capacity, off the plate's rise range.

**A coverage floor.** My first version gave a system with no nameplate data a score of **100** -- full marks earned on two dimensions out of five, presented with the same confidence as a full assessment. Below 60% coverage no single number is published at all; the dimensions are reported individually and the missing plate fields are listed by name. The seeded guest-house system is deliberately that case, because half of Wilson's existing HVAC customers will look like it on the first visit.

## Tests

**211 checks, up from 198.** New `_qa/verify-hvac-performance.js` (67) is mostly not testing arithmetic -- it is testing that the guardrails hold, since a regression there turns a maintenance tool into a replacement funnel and would pass any test that only checked the maths. Plus 13 browser checks driving a real HVAC inspection end to end and asserting through the UI that changing the SEER rating does not move the score.

Two existing tests needed updating and one was quietly wrong: the protocol-resolution test expected HVAC to resolve to `generic`, and its orphan detector only walked the appliance indexes -- so it reported all four HVAC protocols as unreachable three lines after proving each of them reachable. It now fails the build on a genuinely orphaned set, which is dead configuration that looks like coverage.

# v0.9.13 - It works in a basement, and it prints

## The field tool could not open without a connection

Everything it *does* already worked offline -- localStorage, IndexedDB, scoring in the browser. But nothing could start: the HTML, CSS and scripts had to come off the network first. A technician who parked at an estate with no signal and tapped the bookmark got a blank page. Mechanical rooms, attics, utility rooms behind two feet of limestone and houses at the end of a county road are exactly where this tool is used and exactly where LTE is not.

**New `sw.js` and `app.webmanifest`.** The whole app shell (11 pages, 50 files) precaches on first load and serves stale-while-revalidate: from cache immediately, refreshed in the background. That is the right trade over network-first because a flapping job-site connection is worse than no connection for a strategy that has to wait for a timeout, and because network-first HTML with cache-first scripts can hand a new page old code. It installs to the home screen with a maskable icon, and the cache name is versioned per release -- the prototype is re-unzipped onto the same origin every version, so a worker from v0.9.12 would otherwise keep serving v0.9.12 files.

**Three defects, each found only by killing the server for real.** Playwright's `set_offline` does not apply to fetches made from inside a service worker, so testing with it alone reported success on a build where the offline path was broken:

1. The background revalidation was created inside a nested `.then()`, after the event had been responded to, so the browser was free to terminate the worker -- and did. The cache often never refreshed at all, and the message that raises the offline banner was frequently never sent. `waitUntil` has to be called during event dispatch.
2. The worker broadcast reachability only on a *change*. On a cold load with no server the navigation fails within milliseconds, long before the page has parsed `offline.js` and attached a listener, and because nothing changed again nothing was ever said. The page now asks as well as listens.
3. `fetch(request)` inside a service worker can be answered by the browser's own HTTP cache without a packet leaving the device. With the server switched off entirely the revalidation therefore SUCCEEDED, reported the network as reachable, and the banner stayed hidden. `cache: "no-store"` makes it a real probe -- and also means stale-while-revalidate actually revalidates rather than refreshing from another stale copy.

**The banner does not key off `navigator.onLine`**, which reports whether a network interface exists rather than whether anything is at the other end. A phone with one bar in a mechanical room reports online while every request fails, which is precisely the case the banner exists for. The service worker is the authority; `onLine === false` is still trusted as an immediate negative.

**And it does not promise a sync.** There is no upload path in this prototype, so the banner says what is true -- saved on this phone, nothing sent anywhere yet -- and a QA check fails the build if the words "will sync", "will upload" or "syncing" ever appear in it. A technician who believes their photographs are safe on a server when they are on one phone is a worse outcome than no banner.

## The reports were silently dropping content on the way to the printer

`.report-page` is a fixed sheet: `max-height: 11in; overflow: hidden` in print. For the per-appliance report, where every section has bounded content, that is fine and it is what makes these look like documents. The compiled visit review does not have bounded content -- a stop has as many findings as it has, an estate as many appliances.

On screen the section grew and everything showed. **On paper the overflow was discarded: the Portfolio Summary printed 3 of 5 findings, and the Appliance Inventory printed 10 of 16 appliances, ending mid-heading.** Nothing in the UI hinted at it. A maintenance review that drops findings between the screen and the printer is worse than no review, because nobody can tell it happened.

**New `assets/paginate.js`.** A section marks its variable-length region `data-flow`; after render it is measured against the real sheet height and its blocks are distributed across as many continuation sheets as they need, each a proper sheet with the same header and footer. The Reynolds review now prints 7 sheets with all 5 findings and all 16 appliances.

Two wrong ways to measure, both tried, both instructive:

- **Summing each block's height** is right for a stacked list and wrong for anything side by side. The photograph grid puts five cells per row, so five cell heights read as five rows.
- **Reading the body's `scrollHeight`** is useless, because `.report-page-body` is `flex: 1` inside a `min-height: 1110px` sheet -- it is stretched to fill the page and reports ~927px whether it holds one photograph or twenty.

Both produced one block per sheet: fourteen photographs became fourteen sheets, each reporting itself as overflowing. What works is asking the flow container for its own height after each block is appended, which is correct for a grid, a flex row or a list because it asks the browser what actually happened instead of modelling it.

The photograph grid and the subsystem review on the per-appliance report are marked flowable too, so a long protocol or a visit that produced a lot of evidence cannot clip either.

## Tests

**198 checks, up from 154.** New: `_qa/verify-offline-shell.py` (25) checks the precache list against the real files in both directions, plus the strategy invariants and the banner wording; `_qa/verify-offline-browser.py` (19) starts a server, installs the worker, **terminates the server**, and then does real field work against nothing. The smoke test gained a print-fidelity section that generates an actual PDF and asserts one page per sheet, no sheet overflowing, and every finding and appliance surviving pagination -- plus a density check, because both wrong measurements passed an overflow-only test.

Two existing assertions were pinned to "the review compiles four pages" and became failures the moment correct pagination produced seven. They now check that the four *sections* exist.

The offline shell checker also had to learn to read code rather than commentary: it got two false failures off the source's own comments explaining why it avoids `cache.addAll` and why the banner must never say "will sync". A check that reads the comment explaining a rule as a violation of that rule trains you to ignore it.

Also: the legacy `?v=09` cache-busters on the field tool are gone, since the service worker owns versioning now and a `?v=` URL caches as a separate entry from the precached one.

# v0.9.12 - Evidence, not assertion

Two things the prototype recorded without recording whether they were *evidence*. Both were found while seeding v0.9.11, and they are the same defect twice.

## Age was a guess, and it moves a quarter of every score

`asset.installYear` was never populated by anything -- not enrollment, not invoice import. So the technician typed an age from memory or from what the customer half-remembered, and the health score treated that identically to a dated invoice. Wilson **sold** most of this equipment, and the invoice has the date on it.

**The parser now keeps the date it was already extracting and throwing away.** It is read anchored to the invoice number in the header block rather than as "the first `d/d/yyyy` near the top" -- a loose match could be a ship date or a due date, and a wrong install year moves a score silently where a missing one is reported as unknown. Only a high-confidence read is imported as documented.

**`plan-config.js` gained an `ageSources` vocabulary** -- Wilson invoice, customer stated, technician estimate, not established -- with `documented` as the honesty flag, and `WILSON_AGE.resolve()` as the single rule every surface goes through. The field tool pre-fills the age from the invoice-derived install year and says where it came from; if the technician types a different number, the source becomes their estimate, because keeping the invoice label on it would be the tool claiming a document backs a figure no document produced. Typing the documented value back restores it, so a tech who checks and agrees does not downgrade the record.

**No age, no age score.** The age term drops out entirely and the overall score *is* the measured condition -- stated as such on the report, in the field tool's live preview, and in the longevity section. Completion no longer demands a number either: an undated appliance takes one tap to mark "age cannot be established", because a gate that insists on data nobody has is a gate that demands a guess.

**The household record calls out the gap**, separating the three states that are not interchangeable -- a date off an invoice, a date somebody remembered, and no date at all -- because only the last one changes how the score is calculated. Every one that gets filled in turns a quarter of that appliance's score from estimate into evidence.

`null` became zero in five places, and every one read as "brand new": `Number(draft.age||0)` in the field tool's scoring, the same in `lifecycleStage()`, `Number(inspection.age || 0)` on report generation, `Number(report.lifecycle.age||0)` on the report page, and -- the one that survived all the others -- `num()` in `lifecycle-advice.js`, four lines that returned `Number(v)` whenever it was finite, and `Number(null)` is 0.

## Photographs were a count with nothing behind it

The field tool set `photo: true`, kept the filename, and discarded the image. The report then printed *"3 photos associated with this report in the production workflow."* The seeded reports were worse: `photoCount: Math.min(names.length, 3 + flagged.length)` -- an invented count of photographs that had never existed, in the one place the product is meant to prove it has evidence.

**New `assets/photo-store.js`** keeps the images in IndexedDB -- Blobs natively, no 5MB string cap, and it works offline in a mechanical room with no signal. Each image is re-encoded to fit 1600px at JPEG 0.82 before storage (~150-400KB from a 3-6MB phone frame, still sharp enough to read a serial plate), and the re-encode is discarded if it comes out *larger* than the original, which is what a small flat PNG does.

Every photograph is stored against what it is evidence **of** -- visit, appliance, checkpoint, and kind. The report renders the real images, captioned with the checkpoint each belongs to. The compiled review puts them on the findings only, where a customer reading "grease build-up in the firebox is advancing" can look and judge for themselves.

**The technician sees the thumbnail.** It catches the two failures that matter in the field -- a photograph of a thumb, and a serial plate too blurred to read -- at the one moment a retake is still free. The label only says "saved" after IndexedDB confirms the write, and the serial-tag readiness gate only advances then: gating on a boolean set before anything was stored would have let a visit complete with no evidence at all.

Where an image cannot be found, the report says *"captured in the field - not available on this device"*. Photos live in the browser that took them until the production upload path exists, and that is the truthful thing to print. `pendingUpload()` is what that path will drain.

**Seeded reports carry no photographs and claim none.**

## Schema

Migration section 7.9: `MaintenanceAgeSources` seeded from config, install/age-source columns on `MaintenanceAssets` (`InstallYear` stays NULL rather than 0), field-inspection age source plus an explicit `AgeNotEstablished`, and `LocalCaptureId` / `UploadedAt` on the photo table so an upload can be matched to its capture and retried idempotently. New view `vw_MaintenanceAssetAgeProvenance` -- the operational list of appliances scored on condition alone.

**The migration generator was caching the dumped config forever.** A config change produced SQL built from the *previous* config, silently, with a confident summary line -- adding the age vocabulary reported "0 age-provenance sources" while writing an empty seed. It now re-dumps whenever `plan-config.js` or the dumper is newer. A generator that can quietly emit stale SQL is worse than none, because the output looks authoritative.

The SQL verifier also flagged a correct table: it read UNIQUE constraints but not an inline single-column PRIMARY KEY, which is equally a uniqueness guarantee. Fixed, and the table was moved to the surrogate-id-plus-unique-code pattern the other config tables use.

## Tests

142 browser checks (up from 132) and 51 parser checks (up from 42). The new ones assert the image bytes reach the store, that the report carries photographs rather than a count, that a hand-entered age is recorded as an estimate and not as documented, that an unparseable or out-of-range date yields no install year at all, and -- from both directions -- that an unestablished age is never treated as age zero while an explicit age of zero still counts as a real age.

Known, unchanged: expected service life still has no outdoor-refrigeration entry, and grade band D is still labelled "Plan ahead" at a score that is 25% age. Both are for the tech-team protocol review.

# v0.9.11 - Whole-visit maintenance review

Individual appliance reports were the only artifact a stop produced. On a sixteen-appliance estate that is sixteen documents, and the question a homeowner actually has — *how is my house doing, and what needs me* — is not answered in any of them. This adds the compiled review at the visit level. It does not replace the per-appliance reports; it compiles them and links down into each one.

**New `visit-report.html` + `assets/visit-report.js`** — four pages: cover, Portfolio Summary, Appliance Inventory grouped by room, and Consumables & Next Visit.

**The headline is a count, not an average.** Averaging a $12,000 Sub-Zero against a $400 microwave produces a number that means nothing and hides the one appliance that needs attention. The lead is "11 of 16 appliances are performing normally"; the unweighted mean appears below it, labelled as exactly that.

**"Needs attention" is banded on the vital score, not the overall.** The overall folds in 25% age, so banding on it meant a fifteen-year-old appliance measuring perfectly still drifted into "Monitor" for being old — a review that flags healthy equipment on age is the nudge-toward-replacement this product is not allowed to be. Age belongs in the longevity guidance, stated as age, where it can be argued with.

**Findings are ordered by specificity.** An out-of-range reading beats a projection, a projection beats a checkpoint the technician rated down, and all of them beat "the health score fell 15 points" — true, unactionable, and the one line that makes a report read as automated. The score signal is now a last resort. A reading that is out of range **today** is also a finding, with no trend behind it: decline detection needs two visits, and most customers are on their first.

**The limit of the cover is stated on the finding.** Where a grill's condition is marked down, the review says plainly that Wilson never cleans a grill — not at maintenance, not on any other visit — so nobody reads the score as a service quietly skipped.

**Every seeded report now comes from a visit, because that is how a real one arrives.** Until now no seeded report carried a `visitId` at all, so the feature had nothing to compile. The seed models four completed annual stops across the sixteen-appliance Reynolds estate — sixty-four reports — plus the Davenport stop, finished in the field and awaiting send, which exercises the first-visit case where nothing can lean on history. Vitals are stated in the profile; ratings, age score and overall are derived with the field tool's own formulas, and the vital is recomputed from the ratings that came out, so what a report displays is what its own checkpoints add up to.

Four appliances move, each for its own reason: the main refrigerator's condenser loading up, a guest-laundry dryer whose exhaust temperature and vent static pressure climb together across four visits (a restricting duct, which is a fire risk long before it is a dryer complaint), a grill's firebox condition advancing, and an outdoor refrigerator losing its set point in a no-clearance enclosure. Everything else holds steady on purpose — if everything drifted, a flag would mean nothing.

**Entry points**: the household record's maintenance intervals (a completed stop offers the review instead of charge buttons that have nothing left to do), the operations queue's report stage, and a link back up from any appliance report whose visit produced others.

**Two tables were quietly becoming unreadable.** The household's report history listed every report ever filed — sixty-four rows on this estate — and the ops reports panel did the same across every household. Both now show the latest report per appliance, worst first; the prior visits are not lost, they are the curve on each report page.

Also: trend details now say "since Aug 2023" rather than printing an ISO date at a customer, rooms group on the room ("Main Kitchen - Left" is a dishwasher slot, not a ninth kitchen), and the household visits table's row finally matches its header — it had six cells against five columns.

Tests: 21 new browser checks (suite now 132) covering the refusal to guess a visit, the count-not-average headline, bands summing to the appliance count, no appliance reported on score alone, and the grill scope note. Two harnesses were stubbing `WILSON_CONFIG`; they now load the real one, since the seed builds its protocols from it. Two seeded-data assertions were pinned to counts that a richer fixture changes, and one selected "the newest refrigerator" — which became a different, healthy appliance the moment a second household was seeded, and asserted the drift guard against it.

Known: expected service life has no entry for outdoor refrigeration — the Reynolds outdoor unit is seeded at 12 years by hand, because the category table's single refrigeration figure would give a Texas-summer undercounter the same twenty years as a built-in Sub-Zero. Grade band D is still labelled "Plan ahead" at a score that is 25% age; worth raising with the tech team alongside the protocol review.

# v0.9.10 - Longevity guidance

Wilson sold most of these appliances to the customers now on maintenance plans. A tool that leans toward replacement cannibalises those sales and spends the trust the business grew on. So this is not repair-vs-replace guidance presented as two options to compare — the default posture is keeping the appliance alive, and replacement is made hard to reach.

**New `assets/lifecycle-advice.js`** with a structural guard: replacement is **never** suggested for an appliance that still has expected life remaining AND an identified serviceable cause. A dirty condenser is a cleaning, not a sales opportunity. `posture` cannot return "plan" while a serviceable cause exists and life remains, and the tests hold that line from several directions — a 10-year-old unit with a steep score drop and three decline signals still returns "service now, keep the appliance".

Four postures: keep maintaining, service now, maturing and worth planning around, and — only past expected life — past expected life and declining.

**It refuses to invent costs.** Repair and replacement figures are inputs from Wilson, never estimates generated here; with no costs supplied, no economics appear at all. When they are supplied, the comparison is **cost per remaining year** rather than sticker price, and a repair is assumed to return the appliance to its remaining expected life, never to extend it beyond — claiming otherwise would be a thumb on the scale. An even comparison favours what the customer already owns.

**Fixed the seeded history, which was internally impossible.** Scores were specified directly and back-solved to vital scores of 104 and 101 — above the 100 maximum any inspection can produce. Vitals are now specified and the overall score derived with the field tool's own weighting (`ageScore = 100 − 60 × ratio`, then 75% vitals / 25% age), so the demo history is a plausible record rather than numbers chosen to look good. The refrigerator now reads 93 → 90 → 83 → 76, and the dishwasher's gentle 93 → 91 is pure ageing, correctly not flagged.

**New built-in outdoor grill icon** — domed hood, lid handle, knob panel and counter line, replacing the cart-style grill, since most Wilson customers have built-ins.

Also gave the longevity empty state its own class: "no history to trend yet" and "no age on record" are different facts, and a test that could not tell them apart was counting both.

Tests: new `_qa/verify-lifecycle-advice.js` (24 checks, most of them holding the guard) and browser coverage taking the suite to 111.

# v0.9.9 - Trends that find work

v0.9.8 recorded the curve. Nothing went looking at it, so a condenser split that had climbed 8°F was visible only to whoever happened to open that appliance's report — which is nobody. This makes the measurement pay for itself.

**New `assets/trend-analysis.js`** — one implementation of "declining", shared by the dashboard, the household record and the report. Two implementations would drift apart the way protocol resolution did before v0.9.1. Three signals, worst first:

- **Out of range now** — a reading past its target, or a compartment away from its own set point. Highest confidence: it is a fact, not a forecast.
- **Heading out of range** — inside range today, but a least-squares slope across three or more visits projects it leaving within two intervals. This is the year-early catch, and the reason to collect the number at all.
- **Sustained score decline** — 10 points total, or 4 a year across three or more visits.

**The thresholds are deliberately conservative, because false positives are the real risk.** A flag the office stops trusting is worse than no flag. So slope signals need three visits rather than two, a reading must move more than its own rounding to count at all, and the tests spend more effort on what must NOT be flagged than on what must.

Two cases worth calling out specifically:

- **A set point is a setting, not performance.** A customer who raises their fridge from 37°F to 40°F is not a declining appliance — the compartment tracking its set point is the whole point. The set point is never itself a signal, and is used as the band its compartment is judged against.
- **Movement toward the middle of a range is improvement**, not drift, and is never flagged.

**Surfaced where the office already works.** An "Appliances trending down" block sits below the visit queue — deliberately not inside it. The queue is time-bound work; a drifting condenser is this quarter's opportunity, and mixing them blunts both. Every signal states the numbers that produced it, so a technician can disagree with it. Nothing here is a diagnosis: it says "this is moving the wrong way, go look", never "the compressor is failing".

**Household record reworked.** The declining appliance is flagged in its row and sorts to the top — a 17-appliance estate is a long table, and the office almost always came here for one appliance. Tables cut from 6/6/8/6 columns to 5/5/5/4 by folding brand and model into the equipment cell, payment and service-order state into the visit's status cell, and technician into the inspection cell. Report history gained a per-visit trend column showing the move against the prior visit.

Against the seeded data: the drifting Reynolds refrigerator is flagged with all three signal kinds; the flat dishwasher and the single-visit icemaker are not.

Tests: new `_qa/verify-decline-detection.js` (24 checks, most of them about what must not be flagged) plus browser coverage taking the suite to 105.

# v0.9.8 - Service history: the second visit is the product

A single visit produces a score. Several produce a curve, and the curve is what turns a maintenance call into a health record — the thing measureQuick has that no appliance tool does. Nothing demonstrated that until now, because no household in the demo had ever been visited twice.

**Seeded a real history.** The Reynolds refrigerator now carries four springs of inspections whose readings drift the way a real one does: condenser split climbing 18 → 26°F as the coil loads up, fresh-food compartment losing its set point 37 → 40°F as the compressor works harder, health score 96 → 81. A dishwasher alongside it holds flat across three visits, so the drift reads as a signal rather than as something every line does.

**New Service History page on the health report.** Health score as a hero figure with its curve, then one small chart per measured reading. Deliberately:

- **Every measure keeps its own scale.** Two measures never share a pair of axes — the fastest way to make a chart lie.
- **Target bands are drawn where one can be parsed** from the measurement's own target text, so a reading is shown against what it should be rather than floating alone.
- **Colour follows state, not direction.** A rising dishwasher inlet temperature is good and a rising condenser split is not, so the sign alone never sets the colour. The delta text carries direction; the colour carries whether the latest reading sits inside its target.
- **A customer set point is not a measurement.** It was drawing its own flat line beside the compartment it explains; it is now that chart's ±2°F band instead.
- Single series each, so no legend — the title names what is plotted. Only the endpoint is labelled. A table view carries the same numbers.
- A first-visit appliance says so rather than drawing a one-point line.

**Removed a silent fallback that could show the wrong customer's data.** `report-view.js` resolved its report as `WilsonStore.getReport(params.get("id")) || state.reports[0]`, so a wrong or missing id rendered whichever report happened to be first. With one seeded report that was invisible. With a real history it means showing one customer another household's appliance readings. The page now refuses and says which case it hit — the same rule the field tool already applies to visit IDs.

That fallback had also been hiding a bug in our own test suite: a check that navigated with `?report=` instead of `?id=` was passing against a completely different report. It now fails loudly, which is how it should have behaved all along.

Added `docs/MERGE_DISCOVERY_REQUEST.md` — a forwardable request for the main dashboard developer. Tier 1 is fifteen lines of names and yes/no answers with no source code required, because what the merge actually needs is what things are called, not what they do.

Tests: browser suite now 97 checks, including that each measure gets its own chart, that a rising value inside its target is not flagged as a problem, that a reading outside its target is, that the set point is folded rather than plotted, that an unknown report id refuses, and that a single visit draws no chart.

# v0.9.7 - Internal dashboard: one queue instead of four columns

Measured on a 1512x950 laptop:

| | before | after |
|---|---|---|
| first actionable button | 1015px (below the fold) | **516px** |
| chrome above the first work item | 595px | **~260px** |
| widest operating table | 8 columns | **5** |
| counts rendered | 8 (four values, twice) | **4** |

**Fixed a real defect.** `completed-count` was `readyToSend.length || completed.length`, so when nothing was ready to send the badge silently switched to counting *completed visits* instead — the number meant one thing when non-zero and a different thing at zero. On screen the hero read `[2, 2, 0, 0]` while the columns read `[2, 2, 0, 1]` from the same data. The duplicate badges are gone entirely; there is one set of counts now.

**The Command Center is a single priority queue.** Four equal-weight columns made the office read left to right to work out what to do first, and gave an empty stage a quarter of the board to say nothing. One list now, ordered the way the work actually runs: something blocking money, then money to take, then work to dispatch, then finished work to deliver. The pipeline stage is real information so it stays — as a chip and a colour stripe on each row, not a column to scan across.

**The counts are the filters.** Clicking "Blocked" in the operating bar narrows the queue to blocked items. A number you can act on beats a number you read and then go hunting for.

**Reclaimed the chrome.** The hero spent 249px on a title and a paragraph of onboarding prose a daily user reads once. The nav spent 205px on eight tiles with permanent two-line explainers plus a 190px column of four stacked buttons. Both are now single compact rows.

**Every operating table cut to five columns**, folding secondary detail into the cell it belongs to rather than giving it a column of its own — equipment counts into the household cell, quantity into the part cell, technician into the inspection cell. Households 7→5, Filters 8→5, Health 8→5, Quotes 8→5, Invoice review 7→5.

Also fixed two inherited `justify-content: space-between` rules that flung a row's status badges to opposite ends of the card.

Tests: browser suite now 83 checks, including that the first action lands on the first screen, that the duplicate badges are gone, that every row carries a stage chip, that clicking a count filters the queue, that all eight panels render, that no operating table exceeds five columns, and that charging an item moves it along the pipeline rather than dropping it.

# v0.9.6 - Field tool: fewer taps, one check at a time

Measured before and after on a real appliance, at phone size:

| | before | after |
|---|---|---|
| taps per appliance | 14 | **9** |
| typed values (refrigerator) | 14 | **6** |
| page height | 4.5–5.4 screens | **2.2–3.1 screens** |

**Rating a check is now what completes it.** The separate "Mark performed" toggle cost one tap per check — five per appliance, fifty on a ten-appliance visit — and carried no information the rating did not.

**Removed a default rating of 4.** Every check arrived pre-rated 4, so a technician who marked a check performed without touching the rating silently filed a "good" score they never gave. The report flattered the appliance and the 75% condition half of the health score was partly fiction. Checks now start unrated: a rating exists only because someone chose it. This is also what makes rating-as-completion work at all.

**Added an explicit "Not applicable to this unit".** Losing the performed toggle lost the one thing it could express that a rating cannot — a check that genuinely does not apply (a leak check on a charcoal grill, a second compartment on a single-zone column). Without it, "not performed" and "not applicable" would be the same state and readiness gating could not tell a skipped check from an absent one. Not-applicable checks are excluded from scoring and from required-reading enforcement.

**One check open at a time — chosen by the technician, never by the app.** Sequencing the protocol would fight how the work actually happens: what is reachable, what has to warm up or cool down, what the homeowner is standing in front of. So every check stays tappable in any order and only the screen space is managed. Completing one opens the next *unfinished* check and scrolls it into view; tapping any other check overrides that. Collapsed cards keep their number, name, status and rating, so the whole protocol stays visible. Re-opening a part-finished appliance resumes at the first unfinished check rather than at check 1.

A check that still owes a required measurement stays open rather than advancing, so the technician is never bounced away from a field they have to fill.

**Notes and photos moved behind a tap.** Both were rendered inline on every check and were most of the page height, despite being used on a minority of checks.

Tests: browser suite now 64 checks, including that the performed toggle is gone, that a freshly opened check carries no default rating, that exactly one card is open, that any check can be opened in any order, and that an appliance fits in under four phone screens.

# v0.9.5 - Outdoor grills and WashTower enrollment

**Outdoor grills are now enrollable, on a functional-only protocol.** Wilson does not clean grills - not at maintenance, not on an unrelated service call - so the exclusion is stated where the customer decides, not buried in terms:

- New `Outdoor Grill` customer category with a "Function only · no cleaning" tile badge and the full scope note printed on the tile itself, before the customer adds one.
- The same note is repeated as a line in the enrollment summary, so it is on screen at the moment of submission.
- The technician gets an amber limited-scope banner on the appliance. This matters more than it looks: every other protocol's condition check implies cleaning and asks for a before/after photo, so a tech working from habit would clean a grill Wilson has promised never to clean.
- New five-check `outdoor_grill` protocol: ignition and burner operation, gas supply and leak check, temperature performance against the lid gauge, condition (**document only**), and cart/hardware/rotisserie. The condition check reads "DO NOT CLEAN" in the prompt, explains that the rating feeds the health score, and asks for a condition photo rather than a before/after one.
- Condition is therefore rated and reported but never remediated: a dirty grill scores lower and the customer sees it on their report as something for them to arrange.
- Lifecycle: 15 / 10 / 7 years by tier. Luxury covers Hestan, Kalamazoo, Lynx and ceramic kamado units, which outlast mass-market gas carts considerably.
- `invoice_parser.py` now classifies OUTDOOR GRILL, BBQ, kamado and built-in grill lines to the same category. Every product on the three real Wilson invoices now classifies - the review queue is empty where it previously held four items.
- `assumptions.grillScopeRule` states the exclusion applies to every plan, Estate Concierge included.

**A WashTower can now be enrolled as one product.** It remains two maintained assets - confirmed as the intended billing - so the tile is explicit rather than clever:

- New `Laundry Center / WashTower` category with a "Counts as 2 appliances" badge and a scope note explaining the washer and dryer are inspected on their own protocols.
- One click creates the labelled pair - "Laundry Center / WashTower — Washer" and "— Dryer" - identical to what invoice import already produces, so both entry paths converge on the same assets, protocols and pricing.
- The tile stepper counts products; the summary counts appliances. One WashTower shows as 1 on the tile and 2 in the appliance count at $299.90/yr.
- Decrementing removes the pair as a unit. Half a WashTower is not something a customer can own.

**Also fixed:** the field tool drew its appliance icon from a hardcoded protocol-to-icon map that silently fell back to the refrigerator icon for anything not in it - an outdoor grill rendered as a refrigerator. Icons now resolve from the category config, with the old map kept only as a fallback for assets with no recognisable category. Same class of drift as the protocol defect v0.9.1 fixed.

Two new icons in the house style, and the seeded Hestan grill moved onto the grill protocol.

Tests: browser suite is now 58 checks, covering both tiles, the pair expansion and removal, the two-appliance pricing, all three grill disclosure points, and the field protocol. The invoice-parser suite reads valid category ids from `plan-config.js` rather than restating them - that hardcoded list went stale the moment grills were added, which is the same failure it exists to catch.

# v0.9.4 - Invoice parser validated against real invoices

First run of `invoice_parser.py` against real Wilson invoices (`S00063887`, `S00063887-1`, `S00064425`). It held up well - 20 products classified and 62 support lines correctly excluded - but the end-to-end import surfaced one real defect and two robustness gaps.

**Split WashTowers were put on the wrong protocol.** Invoice import correctly splits a WashTower into a washer asset and a dryer asset - correct categories, correct labels, priced and scheduled as two appliances - but both halves inherited the combined `laundry_center` exact type. Because exact type is the most specific input to protocol resolution, the technician got the three-check combined `laundry` protocol on both halves instead of the five-check washer protocol on the washer and the five-check dryer protocol on the dryer. Confirmed against the real invoices: two WashTowers became four assets, all four on the wrong protocol. Each half now carries its own appliance type; the display label still names the WashTower so the office can see the records are one physical product.

This also settles context section 34 item 13 empirically. The shipped system already treats a WashTower as **two** maintained assets - priced as two, labelled as two, scheduled as two, and now inspected as two. The `laundry_center` taxonomy entry survives only as the catalogue label for the product as printed on an invoice, and `laundry` is now an orphan protocol kept for older stored data. The open question is a confirmation rather than a decision, and if Wilson wants a WashTower billed as one appliance the change belongs in `invoice-import.js`.

**One corrupt file discarded an entire upload.** An empty, truncated or non-PDF file raised out of `parse_invoice_files`, which the server turned into a single failed request - losing every good invoice uploaded alongside it. Split invoices mean two or three files per import and partial downloads are common. Unreadable files are now skipped individually with a warning naming the file; if every file is unreadable the result says so plainly instead of returning a successful empty parse. A generator of files is also accepted without silently emptying `sourceFiles`.

**Two accessory classes reached the review queue with nowhere to go.** Gas conversion kits and outdoor cabinetry, both seen on the real invoices, are now excluded alongside the other support lines.

Left deliberately unresolved: outdoor grills. They still reach the review queue, and `customerApplianceCategories` has no outdoor entry to classify them with - though `applianceTypes` does, and the seeded demo data enrols one. Whether outdoor cooking equipment is a maintained asset class is a business decision, and the plan copy excluding BBQ/grill *cleaning* from scope is not the same question. Flagged in `docs/INVOICE_IMPORT.md`.

**PII removed from the package.** `docs/API_CONTRACT.md` carried a real customer's business name, phone number and service address in its invoice-import response example - present since v0.3, in the document most likely to be handed to an outside developer. Replaced with fictional data. Everything else in the package already used the reserved 555-01xx range. Worth checking any copies of that file already circulated.

Added `_qa/verify-invoice-parser.py` - 39 checks covering every row of the documented product-mapping table, every documented exclusion, brand normalisation, serial capture, area assignment, split-invoice combination, and the malformed-input cases. Fixtures are synthetic (`_qa/invoice_fixtures.py`, reproducing the real column layout) because real invoices carry customer names, addresses and phone numbers that must not enter the repository. Point `WILSON_REAL_INVOICES` at a folder of real invoices to add four structural assertions against them; that path prints no customer data.

# v0.9.3 - First end-to-end browser QA

`docs/QA_SUMMARY_V09.md` recorded that headless browser QA could not be run, so nothing had ever driven this prototype end to end. It has now been driven, and it found three real bugs in the v0.9.2 filter pricing work that every unit test passed straight through.

Bugs found and fixed:

- **Estate Concierge left air filter toggles unchecked while labelling them "included".** Concierge's own included-filter list covers refrigerator air / food-preservation filters, but the enrollment UI only force-checked water. A second refrigerator rendered an unticked box captioned "Air / food-preservation filter service included". Both kinds now render checked and locked on Concierge.
- **The Concierge enrollment summary undercounted covered filters.** Coverage was read from the per-asset opt-in flags, which the locked checkboxes never set, so a four-refrigerator Concierge household listed "Water filters x 1" instead of x 4. `filterQuantity()` now treats every eligible kind as selected when the plan covers filters.
- **Duplicate summary line.** "Plan-covered filters - Included" sat directly above the new per-kind lines, which say the same thing with counts. Removed the older generic line.

Added `_qa/smoke_browser.py` - 41 assertions over the real UI:

- all ten pages load with no console errors and with the globals their scripts need
- filter service moves the plan total by exactly the configured unit price, per kind
- the summary never renders a bare "Added" and always flags placeholder pricing
- icemakers are offered water filter service only; refrigeration is offered both
- Concierge locks every filter toggle checked and charges nothing
- the field tool refuses to open without a visit ID
- a seeded washer resolves to the five-check `washer` protocol rather than three-check generic, verified through the field tool against real stored data (the v0.9.1 fix, now covered end to end)
- readiness gating blocks completion until age, serial photo, every checkpoint and every required reading are captured
- completing an inspection generates a health report sourced from field data, which renders with the locked Wilson Estate Care styling
- no horizontal overflow at 390px on the visit list, the appliance detail or the customer report
- every rating button clears the 44px tap-target minimum (they measure 65x56)

Also confirmed, contradicting an earlier suspicion: typing into a reading field does **not** move the viewport and does not drop focus. The v0.8 mobile fix holds. An apparent jump in early runs was Playwright's own scroll-into-view on click, not the application.

The smoke test skips cleanly when Playwright is absent, so `_qa/run_all.sh` stays useful without it.

Added `docs/PHONE_FIELD_TESTING.md`: direct visit links for the seeded demo visits, the LAN/firewall path, the per-device `localStorage` gotcha, and a checklist of what only a real handset can test - camera capture, one-handed reach, iOS Safari focus and zoom behaviour, autosave across app switches, and outdoor legibility.

# v0.9.2 - Filter service is priced

- **Estate Concierge includes filters outright.** Already true in config and the plan seed; the plan feature copy now says so in the customer's terms ("Water and air / food-preservation filters included at no extra charge").
- **Filter service now raises the annual plan price.** Previously the enrollment summary rendered the line as `Added` with no amount and `planCost()` never saw it, so opting in was free. Selecting it now adds Wilson's filter sales price to the annual plan total on Per Appliance, Estate Annual and Estate Preferred; it stays $0 on Estate Concierge.
- **Water and air filters are separate customer choices.** Water is the headline option and is auto-included on Concierge. Air / food-preservation filter service (common on Sub-Zero and similar) is always an explicit opt-in and is never checked by default. Icemakers are offered water only; refrigeration is offered both.
- **Icemakers can now elect filter service.** The checkbox was previously offered on refrigeration alone, and the household count only tallied `customerCategory === "refrigeration"`, so icemaker filter service was unreachable despite the category carrying an icemaker water filter.
- **Priced per filter, not per appliance.** Each kind carries a quantity (default 1), so a Sub-Zero taking two water filters prices at 2x. Quantity falls back to the config default when absent, zero, or non-numeric.
- Pricing lives in one place: `WILSON_FILTERS` in `plan-config.js`. The enrollment builder, summary, household profile, field tool and demo backend all price through it rather than reimplementing the arithmetic.
- The technician's filter banner now names which filters the customer paid for and their counts, so the tech knows what to bring. Filter records created at enrollment are marked `Included - priced into plan` rather than `billed separately`.
- Schema: added `dbo.MaintenanceFilterPrices` (kind-level fallback rows plus part-number rows), per-asset `WaterFilterServiceOptIn` / `AirFilterServiceOptIn` / quantity columns, and `MaintenanceSubscriptions.FilterServiceAnnualAmount` + `FilterServiceDetailJson`.
- Added `_qa/verify-filter-pricing.js` - 33 assertions covering eligibility, per-kind pricing, quantities, the Concierge interaction, household rollups, and that filter cost never distorts the IMUC-aware estate-plan comparison.

**PLACEHOLDER PRICING.** Water and air are both $70/filter pending Wilson's filter sales-price list. The figure is read from config in one place, seeded into `MaintenanceFilterPrices` with `PriceIsPlaceholder = 1`, and surfaced in the enrollment summary as "Placeholder pricing - awaiting Wilson filter sales-price list" so no one mistakes it for an approved number.

# v0.9.1a - SQL migration

- Added `sql/maintenance_migration_v09.sql`, implementing MERGE_GUIDE section 7: property areas, household AR/billing method, the three-table technician field-inspection layer, report delivery tracking, technician user linkage, and versioned lifecycle and protocol configuration. 12 new tables, 11 new columns on existing tables, 3 new views.
- The migration is strictly additive and idempotent: every table is guarded by `OBJECT_ID`, every column by `COL_LENGTH`, every index by a `sys.indexes` check, and every seed is a `MERGE` on a unique key. It redefines no existing object, so re-running `maintenance_schema.sql` afterwards cannot revert it.
- Protocol, brand-tier, expected-life and lifecycle-stage seeds are generated from `assets/plan-config.js` by `sql/generate_migration_v09.py` rather than hand-transcribed, so the database and the JS config cannot drift.
- `dbo.MaintenanceProtocolAssignments` plus `dbo.vw_MaintenanceAssetProtocol` are the SQL form of `WILSON_PROTOCOL.resolveCheckpointSet()`, including the IMUC override and the stored-snapshot fallback. `StoredValueIsStale` finds assets still carrying a pre-v0.9.1 `CheckpointSetCode`.
- Added `dbo.vw_MaintenanceHouseholdPaymentReadiness` so AR households resolve as payment-ready without a card, per MERGE_GUIDE 7.2, and `dbo.vw_MaintenanceFieldProgress` for Command Center field/report progress.
- Status columns carry `CHECK` constraints using the MERGE_GUIDE section 34 vocabularies, so a UI phrase cannot be persisted as state.
- Added `_qa/verify-sql-migration.py` (structure, guards, FK targets, MERGE key backing, N-prefixed literals) and `_qa/verify-protocol-parity.py`, which compares the SQL resolution model against the real JS resolver across all 520 type/category/group combinations. `_qa/run_all.sh` runs everything.

# v0.9.1

- Consolidated inspection-protocol selection into a single source of truth. `plan-config.js` now owns resolution via `WILSON_PROTOCOL.resolveCheckpointSet()`; the duplicate hardcoded if-chain in `tech-maintenance.js` `templateKey()` has been removed.
- Corrected four customer categories that stored the wrong `checkpointSet`: Ventilation (was generic), Microwave (was cooking), Washer and Dryer (both were laundry). The `ventilation`, `microwave`, `washer` and `dryer` protocols were defined but never assigned.
- Corrected the same class of defect in the internal `applianceTypes` taxonomy: Vent Hood and Hood Insert (were generic), Microwave / Speed Oven (was cooking), Washer and Dryer (were laundry).
- Corrected nine seeded demo appliances that persisted the wrong `checkpointSet`.
- Added a `laundry` entry to `lifecycleMatrix`. Laundry-center assets previously fell through to the generic 15/10/8 expected-life curve.
- Added `_qa/verify-protocol-resolution.js`, the first automated test in the package: asserts that every customer category and every exact appliance type resolves to its intended protocol, that no protocol is orphaned, and that legacy assets holding a wrong stored value still resolve correctly without a data migration.
- Marked `docs/API_CONTRACT.md` superseded pending its v0.9 rewrite.

# v0.7

- Fixed mobile technician number-entry fields so age and temperature entry no longer re-render the page or jump back to the top.
- Retired the separate Appliance Health Report Builder and removed all customer-report creation links that bypass field data.
- Health reports now auto-generate from completed technician protocols only.
- Added visit-level report completion: once every in-scope appliance is complete, the visit is marked completed and its report package becomes Ready to email.
- Added Command Center and household prompts to review and queue completed report packages for customer email.
- Added a recovery Generate health report action only when a completed field inspection exists without a generated report.
- Locked the existing seven-page Wilson Estate Care customer health-report styling for all appliance types.
- Added automatic brand-tier defaults in the tech tool: Thermador defaults Luxury; Bosch and KitchenAid default Mass premium; Whirlpool defaults Mass, with additional starter brand mappings.
- Second-visit IMUC scopes now limit the field tool to the icemakers included in that maintenance visit.

# v0.6

- Rebuilt the refrigeration field protocol around five concise health checks.
- Added structured refrigerator and condenser temperature readings plus live condenser TD calculation.
- Required serial-tag photo on every appliance; checkpoint photos remain optional.
- Added Early Life / Mid Life / Mature / Replacement Planning lifecycle labels.
- Corrected the config so field scoring consistently uses the intended 75% condition / 25% lifecycle weighting.
- Added Wilson Filter Service opt-in to every customer-facing refrigeration asset, including per-appliance enrollments.
- Estate Concierge automatically shows refrigeration filter service as included; other plans record the opt-in and bill filter materials at service after verification.
- Backend asset/filter records retain the filter-service selection.

# Changelog

## v0.2 - 2026-08-21

### Customer enrollment

- Added default twice-yearly IMUC frequency with a clear manufacturer-recommended explanation.
- Added one-visit IMUC opt-down and live $249.95 second-visit calculation.
- Changed Estate eligibility from a 10+ unit requirement to automatic price crossover.
- Added automatic plan switching while preserving entered appliances.
- Added draft Estate base-plus pricing and 26+ appliance internal review.
- Replaced the old HVAC membership-plus-visit model with $200 and $400 per-system annual tiers, each including two visits.
- Added filter-capture fields to the HVAC filter-management tier.
- Added annual renewal and scheduled-interval charge authorization.

### Internal operations

- Added exact charge amount by maintenance interval.
- Added future NetSuite service-order integration boundary.
- Added combined household appliance and HVAC records.
- Expanded filter coverage and status tracking.
- Added Custom Quotes and Plan Setup dashboard tabs.

### Custom estate proposals

- Added custom quote builder with grouped appliance quantities.
- Added base, overage, IMUC add-on, and manual-adjustment calculations.
- Added professional printable proposal and Draft / Sent / Accepted statuses.

### Appliance health reports

- Rebuilt the generic template around overall score, vitals, score breakdown, inspection details, corrective measures, report information, and service summary.
- Added appliance-specific vitals and checkpoint sets.
- Added transparent equal-weight starter scoring and category deductions.
- Added maintenance tasks, filters, photos, recommendations, and report history.

### Fixes and QA

- Corrected IMUC default selection when an existing row is changed from a standard appliance to an icemaker.
- Added HVAC filter records to filter-management enrollments.
- Corrected seeded custom-quote count, overage, and IMUC arithmetic.
- Completed JavaScript syntax, full-page render, and 39-step browser interaction testing.
- Added re-rendered sample appliance-health-report and estate-proposal PDFs.
- Added print-specific grid rules after PDF QA identified and corrected clipped subsystem content.
- Added a business-rule decision log and formal QA summary for developer handoff.

## v0.2.1 - launcher and navigation packaging fix

- Added a robust Windows launcher, `OPEN_WILSON_PORTAL.bat`.
- Added `serve_portal.py`, which starts the server before opening the browser and automatically selects an open port from 8080-8090.
- Added an on-page warning when HTML is opened directly with `file://` instead of through the launcher.
- Added `README_FIRST.txt` with extraction and launch instructions.
- Repacked the download so the launcher appears at the top level instead of inside a second nested project folder.
- Revalidated every local HTML, CSS, JavaScript, image, PDF, Markdown, and SQL link target in the package.

## v0.3 - icon-first enrollment and Wilson invoice import

### Customer enrollment

- Replaced model-entry rows with twelve broad, illustrated appliance-category buttons.
- Added custom 2D Wilson appliance icons that reflect high-end built-in and professional product styling.
- Added quantity controls directly on each appliance button.
- Added Main House plus customer-created areas with desktop drag-and-drop and mobile Move To controls.
- Removed customer plan selection below the Estate crossover.
- Kept automatic per-appliance/ Estate Annual selection and reveals Estate Annual, Preferred, and Concierge only after the crossover.
- Preserved exact internal product data when enrollment is created from a Wilson invoice.

### Internal invoice import

- Added an Invoice Import tab to Maintenance Operations.
- Added local multi-PDF parsing for Wilson sales invoices, including split invoices.
- Added Ship To extraction, printed area-heading extraction, brand/model/serial capture, exact-type inference, and broad customer-category mapping.
- Added filtering for installation, accessories, payments, credits, delivery, and support parts.
- Added review flags for unassigned split-invoice items and WashTower/laundry-center expansion.
- Added one-click maintenance-draft creation that opens the customer enrollment with the extracted inventory already arranged.
- Bundled the pure-Python pypdf parser and license for no-install local use.

### QA

- Tested the parser against `S00063887` and `S00063887-1` together.
- Extracted 18 product lines, expanded two laundry centers, and produced 20 maintenance records.
- Verified four areas, exact invoice detail retention, customer-category counts, and Estate plan crossover.

## v0.5 - operations command center, smarter estate selection, and mobile field health workflow

### Internal operations
- Replaced the single dense due queue with a four-module command center: Action Required, Ready to Charge, Schedule / Ticket, and Completed & Health.
- Defined the active charge window as 14 days before through 14 days after the planned interval.
- Added payment-problem prioritization and charged-without-ticket flags.
- Added a future EPASS daily-export verification placeholder so a paid interval can remain flagged until a matching service order is found.
- Moved recent activity into its own navigation section and removed the prototype-workflow block from the landing view.
- Rebuilt the internal section navigation into a cleaner module bar.
- Added household billing mode for Card on File vs Account / AR with terms.

### Customer enrollment
- Estate eligibility now compares Per Appliance against both Estate Annual and Estate Preferred.
- The auto-selected estate tier is the lower-cost starting tier for the actual appliance mix, so IMUC-heavy homes can correctly default to Preferred when two-visit pricing makes it cheaper.
- Added over-the-range microwave to the customer-facing Microwave category description.
- Replaced backend-oriented customer hero statistics with homeowner-facing maintenance benefits.

### Field maintenance and health reports
- Added a mobile-first technician maintenance tool launched by household and visit.
- Organized appliances by household area and tracks completion progress.
- Added simple 1-5 sliders, performed checkboxes, readings, notes, serial-tag photo prompt, and optional condition photos.
- Reduced templates to short actionable field checks for refrigeration, dishwashers, cooking, icemakers, washers, dryers, ventilation, and microwaves.
- Completing all required steps automatically creates a Wilson appliance health report.
- Added draft lifecycle scoring using 75% current-condition vitals and 25% age.
- Added configurable Luxury, Premium, and Mass-market life-expectancy tiers plus category-specific draft life spans and brand defaults.

## v0.8 - Field technician UX

- Fixed the transparent/low-contrast field visit banner caused by an undefined `--green` CSS variable.
- Removed sticky positioning from the residence/visit banner so it no longer follows the tech down the page or blocks controls.
- Added signed-in technician display with production-oriented session handoff and optional prototype URL override.
- Added visit progress stats for complete, remaining, and attention items.
- Added a Suggested Next Step card that resumes in-progress appliances before untouched appliances.
- Added per-area progress and appliance status pills.
- Added persistent Monitor / Needs Follow-up callouts during the visit.
- Added debounced autosave for field data.
- Added larger touch-friendly quick rating buttons while retaining the 1-5 slider.
- Added a clear completion-readiness strip and disabled report generation until required field steps are complete.
- Added a final visit-complete summary once every scoped appliance report exists.
- Added an HVAC guardrail so HVAC maintenance visits do not populate appliance-health workflows.
- Updated report regeneration so corrections to a completed field inspection refresh the existing customer report.


## v0.9
- Field visit links are now strict to the exact visit + household; no first-household fallback.
- Household records split Appliance Maintenance and HVAC Maintenance into separate modules.
- Removed redundant generic field-visit launches; appliance section owns the appliance launch action.
- HVAC launch is separated and intentionally disabled until the HVAC field workflow is built.
- Replaced rating sliders with five large 1-5 tap buttons.
- Local prototype server now prints a same-LAN phone URL for mobile testing.
