# Wilson Maintenance Portal v0.9 decisions

## Exact visit routing
The field tool never falls back to a sample household. A launch must carry the exact visit ID. The visit record is authoritative for household ID and a mismatched household/visit pair is blocked.

## Household program separation
Residence profiles expose separate Appliance Maintenance and HVAC Maintenance modules. The appliance launch points only to the next open appliance interval. The HVAC module is separate and its field launch remains disabled until the HVAC workflow is implemented.

## Field ratings
The slider is removed. Each checkpoint uses five large tap targets: 1 Poor, 2 Concern, 3 Monitor, 4 Good, 5 Excellent. Ratings 1-2 remain follow-up/action, 3 remains monitor, 4-5 pass.

## Phone testing
The local development server binds to the computer's LAN interfaces and prints a phone URL. **(Superseded in v0.9.15: loopback is the default and `--lan` requires a passcode.)** It should only be used on a trusted private LAN for prototype testing; it is not production hosting.

## Four kinds of answer, and only one of them scores (v0.9.17)
Every checkpoint declares a kind: `scored` (measured performance against a
target), `maintenance` (work Wilson performed), `observed` (a technician's
judgement of a condition), `trend` (a reading with no agreed tolerance yet).
`WILSON_ANSWERS.scorable()` is the only gate, and 56 of the 78 checkpoints may
score. Work performed and eyeballed conditions are recorded, printed and
photographed; they do not move the number. The customer's report carries three
sections so the difference is visible rather than blended.

The same rule now exists in SQL Server as `ResultKind` / `ScoresHealth` on
`MaintenanceProtocolCheckpoints`, with a CHECK constraint making
`ScoresHealth = 1` impossible on anything but a scored checkpoint, and
`vw_MaintenanceScoringCheckpoints` as the only thing a score calculation should
read. The seed is generated from `plan-config.js`, and `_qa/verify-sql-migration.py`
fails the build if the two sides disagree.

## No typing during a protocol (v0.9.17)
Readings are entered on an in-app number pad with a "Not measured" key. Age is
a decade button then a year button, with the invoice's answer shown as a fact
when there is one, and "Cannot establish it" as a real answer. Maintenance is a
chip row that writes the customer-facing note. Free-text notes remain, per
appliance.

**Deliberately not built:** sliders (a slider always has a value, so it cannot
represent "not measured"), and a one-tap "everything else is normal" button.
The button would have saved roughly sixty taps on a whole-house stop and is
pencil-whipping with a button on it.

## Nothing measured is not a score of zero (v0.9.17)
An average over zero answered checks used to fall back to 0, so opening an
older appliance showed a failing grade before the technician touched it. No
measurement now means no score, no letter grade, and a caption saying so; a
partial score states how many of the protocol's scoring checks it rests on.

## Age counts at 25%, on both sides (v0.9.17)
Age is 25% of the appliance score and 25% of the HVAC score, with the measured
and age components always printed separately. A fifteen-year-old system that
meets its nameplate is not a 100% system: at that age repeat failures start,
and a score that ignores it sets the customer up to be nickel-and-dimed. The
efficiency rating stays at 0% of the score and is reported as a fact -- a
14-SEER system delivering 14-SEER performance is healthy.

`lifecycleMatrix` is re-anchored to published figures with per-row provenance
in `lifecycleSources`: ASHRAE service-life medians, the NAHB household-component
study, DOE/AHRI consensus figures, and manufacturer statements (Carrier on
maintained vs unmaintained equipment, Sub-Zero on its own refrigeration). Ten of
fifteen rows are sourced. The five that are not -- undercounter icemakers,
built-in grills, mini-splits, stacked laundry, and the generic fallback -- are
marked `sourced: false` because no published service-life figure exists for them
in any of those sources. Wilson's own service history is what will answer them.

## The control has to fit the measurement (v0.9.18)
Every checkpoint's answer shape is audited by `_qa/verify-check-controls.js`
against the real config and the real rendering functions. The invariants:

- A number pad appears if and only if the check takes a reading, and every
  reading is a named field with a unit. `readingLabel` is gone -- a number pad
  was being emitted for any check that carried one, which was 57 of 78.
- A measurement of two quantities declares two fields. The tool derives and
  displays the difference (oven set point vs measured, dryer outlet vs ambient,
  microwave water before vs after) while the technician is still at the
  appliance.
- An observation stores `rating: null`. Not 0 -- 0 means NOT ANSWERED in this
  product, and storing it made a healthy door seal print a bold 0, paint its
  card red, flag its appliance for follow-up, and reach the customer's report as
  status "Action".
- `checkOutcome()` is the only thing that decides a check's state. Three copies
  of `Number(check.rating) <= 2` existed and all three read a missing rating as
  a failing one.
- No checkpoint asks for work performed. That is the maintenance chips' job, and
  a checkpoint asking it too is the same question twice in two different
  controls. Where the underlying item also has a condition worth reporting, the
  checkpoint became that condition, asked before cleaning, with a photograph.
- Every pick-one list carries an escape ("could not see the area", "could not
  test it") that scores nothing. It is a different fact from the N/A button:
  "it has one and I could not reach it" versus "this unit does not have one".
- An option may demand a follow-up. "Codes present" demands the code, the check
  is not complete without it, and the code reaches the report.

The same rule reaches SQL Server as `ResultKind` / `ScoresHealth` on
`MaintenanceProtocolCheckpoints`, with
`CK_MaintenanceProtocolCheckpoints_ScoresOnlyScored` making a scoring flag
impossible on anything but a scored checkpoint.

## Conditions score, through anchored answers (v0.9.19)
A condition judged by eye now moves the health score. The objection it was
excluded for -- one technician's 4 out of 5 is another's 3 -- is answered by
anchoring rather than by abstaining:

- Every answer names observable evidence, never a quality. "Cloudy or incomplete
  cubes", not "ice quality 3/5".
- Every answer carries an explicit `score` in `plan-config.js`. Nothing is
  derived from the wording of a label any more, on any option set.
- The score is rendered on the button, so a technician sees what an answer is
  worth before tapping it.
- `score: null` means the answer scores nothing. "Could not get to it" is honest
  and is never a failure.
- Any answer describing dirt, build-up or cosmetic wear scores full marks. That
  is Cayden's standing rule and `verify-check-controls.js` enforces it.
- A trend reading still cannot score: there is no agreed band to score against.

Supporting fact, from Cayden: Wilson runs geographical zones, so the same
technician usually returns to the same house. The comparison that matters most is
an appliance against its own history read by the same pair of eyes, and the
anchors are what stop the score stepping when a zone changes hands.

The 149 answers and their scores are seeded into
`dbo.MaintenanceCheckpointOptions`, with `ScoreValue` constrained to 1-5 or NULL
and `RaisesFinding` kept independent of the score. Parity with the config is
asserted per answer by `_qa/verify-sql-migration.py`.
