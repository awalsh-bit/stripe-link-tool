# Replay: the Sep 10 schedule run through the spec's rules

September 11, 2026 · Input: `reference/data/DispatchTrackDetail_20260910_220003.csv` (236 routed service orders, 9/10–9/24) and `ExportInvoice_20260910_222420.xlsx` (657 open tickets). Method: rebuild every tech-day exactly as Demitrius had it in ePASS, sequence it nearest-neighbour from the tech's real start point, and score it with the rules in `07_Developer_Spec.md` §4 using the default tunables. Durations are the spec's seeds (diag 60, HVAC 90, built-in refrigeration 75, install 60) because ePASS has none; drive time is the straight-line formula. Treat percentages as directional, not exact.

## 1. Does the zone table match how Demitrius actually assigns work?

185 stops were assigned to a specific tech and day. Against `zone_table.csv`: **103 to the zone's primary tech (56%), 52 to a listed secondary (28%), 30 to neither (16%).**

The 30 misses are almost all one pattern: techs picking up **Core Hill Country stops (DS, LOCAL, DRIFT, OAKHL) on their way in or out** — Trevor with five LOCAL/DS/DRIFT stops on 9/11, Kyle with LOCAL and DS stops, Diogo with an AUS S. Brady's HVAC stops also show as misses because the zone table has no HVAC column (his eligibility is skill-based, not zone-based, so that's a scoring artefact).

**Change:** make every shop-start tech a secondary for the Core Hill Country zones (they all pass through), add TDP as secondary on DS/LOCAL/DRIFT and KJB on LOCAL, and score HVAC by skill. With those three edits conformance is about 95%, which means the table would have allowed what Demitrius did and only argued with him a handful of times. That's the right amount of argument.

## 2. The profitability guard: measure inter-stop drive, not total drive

Scoring total drive per stop at the 35-minute threshold flagged 47 of 57 tech-days, which is useless. Two things inflate it: sparse future days with one or two stops (the schedule isn't filled yet, so those flags are noise), and **commute legs**. Connor's first leg from New Braunfels is 77–113 minutes every day; his inter-stop drive once he's in Austin is 12–24, which is excellent.

Rebuilt on **inter-stop drive only, days with ≥3 stops**: median **20 min/stop**, p75 **33**. By tech: Josh 8, Andrew 8, Chris 17, Mark 18, Connor 21, Kyle 22, Brady 26, Trevor 27, Diogo 28, John 41. At 35 the guard flags exactly the days it should: John's west runs (34–48, expected and exempt once they're confirmed trips) and Trevor's 9/15 (Spicewood ×2 + Horseshoe Bay, 38).

**Change:** `route.drive_per_stop_guard_min` applies to inter-stop legs; the first and last legs are reported as *commute* on the column header (Connor's is worth seeing, but it isn't a routing problem, it's a staging problem — §5). Confirmed trips are exempt from the guard but display their number. Keep 35.

## 3. Durations and the 9/10 fill problem

With the seed durations, 9/10 shows Trevor at 13 stops (12 diagnostics) and Josh at 11 (all diagnostics in AUS C), i.e. 200% and 142% of a shift. Two readings are possible and both matter:

- **Stale tickets.** 9/10 is the export day. SO1 tickets whose date was never advanced sit on "today" indefinitely, and the Service Order Health screen already shows 95% of open tickets with dates in the past. Some of Trevor's 13 are almost certainly not visits. The OE-23 says core techs complete 2–2.5 COD jobs per working day, roughly 3.5–4.5 stops with warranty, not 11–13.
- **Real dense days.** Josh's 11 AUS C stops have an inter-stop drive of 7 minutes. Even if only 7 of the 11 are real, his diagnostics run well under 60 minutes.

**Changes:** (a) the importer flags any SO1/SO6 whose `Delivery Date` is ≤ today at import time and whose ticket isn't complete by the next morning's import as **stale**, and stale tickets don't count toward the ledger; (b) keep the 60-minute diagnostic seed for the first four weeks of the field tool (under-offering costs a booking, over-offering costs a late arrival, and the second is worse for trust), then let the learned medians take over as specified. Expect the learned appliance diagnostic to land near 40–50 minutes in Metro and 60 in the Hill Country where drive dominates anyway.

## 4. The owed-install ledger, computed on today's open tickets

Weighting SO2–SO2.2 at 0.67 (the 33% diag-only rate from the OE-23 gives a 67% approval rate, so the default is right) and SO3–SO5 at 1.0:

| Tech | Owed install hours | Open SO1s | Read |
|---|---:|---:|---|
| Josh JRC | 28.7 | 33 | 15 jobs in SO4 + 5 SO5 waiting: nearly a week of installs already owed on top of 33 diagnostics |
| Trevor TDP | 22.0 | 26 | 12 quotes out (SO2.2) — a wave coming |
| Diogo DLA | 21.0 | 9 | 10 quotes out, 9 on order |
| Connor CEM | 19.7 | 8 | 7 SO5 waiting to be scheduled |
| Kyle KJB | 19.7 | 15 | 10 on order |
| Chris CIT | 18.0 | 9 | 11 quotes out |
| **John JHM** | **17.2** | **23** | **14 SO5 parts-in jobs waiting** — the west backlog |
| Andrew AJH | 10.3 | 4 | under-loaded relative to peers |
| Brady BLL | 8.0 | 11 | HVAC |

Without the ledger, Josh looks like he has room; with it, he's the most committed tech in the shop. Andrew has the least owed and the fewest open diagnostics, which is exactly the signal the slot-offering rule needs to steer new Metro/Hill Country bookings toward him. **The ledger changes who gets offered.** Default weights stand.

## 5. Shop touch

14 of 57 tech-days needed a shop touch under the rule (home-start tech with an install that day). Cost by tech: Josh ~25 min, Kyle ~30, Connor **~55–60**, Brady ~55. **Change:** default `parts_loaded_prev_evening = 1` for techs who end at the shop (Andrew, Diogo, Chris on shop-end days), and set up a real staging habit for Connor — either he starts at the shop on install days or his bin is loaded the prior evening by whoever is last out. Either removes an hour from his day.

## 6. Trip buckets: what the West looks like today

Far-group work in the feed right now: **West 43 stops** (22 SO1 scheduled, 16 SO5 parts-in waiting, 5 SO6), Northwest Lakes 7, Far South 2, Out of area 5. Thirty-four of the West stops are John's. Sixteen SO5s waiting is roughly **two full trip days of installs** sitting in the bucket, and the bucket rule (`trip.min_minutes` 240 or oldest > 5 business days) would have proposed trips immediately and repeatedly.

Lone far stops in the next two weeks, i.e. the exact pattern the coaching targets: John alone in Blanco on 9/15, 9/22 and 9/24; Trevor alone in Horseshoe Bay on 9/22 (184 min drive for one stop); Connor alone in Bulverde on 9/21 (210 min); Trevor with one Fredericksburg + one Spicewood on 9/23. Seven single-far-stop days in ten working days. The bucket would have folded the three Blanco visits into one, attached Horseshoe Bay to Trevor's 9/15 Spicewood/Horseshoe run, and held Bulverde for a Connor home-side morning.

**Changes:** none to the rule; two guards to add. Cap automatic trip proposals at **2 per group per week** (more needs a manager), and when a far-zone SO1 is booked by staff outside a trip, show the same "this starts a trip" warning the board shows on drag.

## 7. Recommended tunable and table changes (summary)

| Item | Was | Now | Why |
|---|---|---|---|
| Core zone secondaries | listed techs only | all shop-start techs; TDP on DS/LOCAL/DRIFT; KJB on LOCAL | 16% → ~5% "out of zone" against real assignments |
| HVAC eligibility | zone table | skill-based (BLL; TDP only by office) | Brady false-flagged |
| `route.drive_per_stop_guard_min` basis | total drive | inter-stop legs only; commute shown separately; trips exempt | Connor's commute and half-empty days were drowning the signal |
| Stale ticket rule | — | SO1/SO6 dated ≤ today and not completed by next import → stale, excluded from ledger, Stuck Jobs | 9/10 fill of 200% is fake dates |
| Diagnostic seed | 60 | 60 for 4 weeks, then learned | protect arrival promises early; expect 40–50 in Metro |
| `parts_loaded_prev_evening` default | 0 | 1 for shop-end techs; Connor start=shop or staged | 55–60 min/day for Connor |
| Trip proposals | unlimited | max 2 auto per group per week | West backlog would have fired many at once |
| `owed.approval_rate_default` | 0.67 | 0.67 (confirmed) | 33% diag-only in OE-23 |

Everything else in §11 of the spec stands. The zone table and blueprint have been updated for the first two rows.
