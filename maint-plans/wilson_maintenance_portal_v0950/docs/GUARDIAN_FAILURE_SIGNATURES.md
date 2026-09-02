# Guardian failure signatures — the taxonomy the showroom drills will train (v0.9.49)

Cayden: "try to be on the forefront of inventing metrics that can determine
different types of refrigeration failures via temp loggers. door left open /
warm air intrusion, no compressor, no evap fan, things like that. once we
have the temp loggers installed in our showroom as a test, i can force
different kinds of failures and get the data so we can start programming
trends."

Two ground rules from the patent scan (docs/GUARDIAN_PATENT_LANDSCAPE.md):
the labeled drill DATASET is a trade secret — never in marketing copy, never
in a customer-visible page; and nothing about failure-mode classification
goes public before counsel has a provisional on file. This doc and the drill
data stay internal.

## The physics each failure writes into the curve

A healthy fridge writes a SAWTOOTH: compressor-cycle oscillation (period
~20–60 min, amplitude 1–4°F buffered) around set point, punctuated by
defrost bumps that fully recover. Every failure deforms that shape
differently — the taxonomy is about WHICH deformation:

| Mode | Signature in one probe | Fresh vs freezer divergence | Distinguishing metric |
|---|---|---|---|
| **Door left open / warm-air intrusion** | Fast-onset rise (steepest slope of any mode), oscillation continues UNDER the rise (compressor still fighting), plateaus 8–20°F over set point, recovers fully on close at a healthy rate | Opened compartment leads; other compartment mildly disturbed | Onset slope > 4°F/15min AND cycle oscillation still present AND full recovery; recovery-slope after event within healthy band |
| **Leaky gasket / partial intrusion** | Baseline shifts up 2–6°F, oscillation intact, duty cycle rises (shorter off-periods), worse in afternoon ambient | Affected compartment only | Elevated mean + INTACT sawtooth + amplitude compression; diurnal correlation |
| **No compressor (sealed system / start relay / compressor dead)** | Sawtooth DISAPPEARS — the defining tell. Smooth monotonic exponential rise toward ambient, no oscillation at all | BOTH compartments rise together, freezer lagging on thermal mass | Oscillation amplitude → ~0 (spectral power in the 20–60min band collapses) + monotonic rise 1–4°F/h |
| **No evaporator fan** | The classic split: freezer (where the coil lives) stays cold or gets COLDER; fresh food climbs steadily with weak/no oscillation in the warm compartment | **Divergence is the signature**: fresh−freezer spread grows well past baseline | Cross-compartment spread slope > +1.5°F/h while freezer ≤ set point. This is the whitespace metric — two probes make this diagnosis almost trivial |
| **Failed defrost (iced evaporator)** | Days-long SLOW degradation: oscillation persists but mean creeps up; defrost bumps stop appearing in the curve; eventually resembles airflow failure | Fresh food first (iced coil chokes airflow to it) | Multi-day mean drift +0.5–1.5°F/day + disappearance of periodic defrost events from the record |
| **Condenser fouled / condenser fan weak** | Duty cycle stretches (longer on-periods), amplitude compresses, mean rises modestly; strongly ambient-correlated | Both compartments, gently | Rising on-fraction trend across days + correlation with ambient/afternoon |
| **Damper stuck (dual-evap or single-evap w/ damper)** | One compartment drifts while the other over-cools | Spread grows in EITHER direction (stuck closed: fresh warm / stuck open: fresh cold) | Signed cross-compartment spread breaking baseline both directions |
| **Power loss / unplugged** | Identical curve to no-compressor BUT the sensor also stops reporting (UbiBot on USB dies; on battery, WiFi router usually died too) | Both | No-compressor curve + offline/heartbeat evidence → "check power before sealed system" |

## The metric set to compute per sensor (the feature vector)

Each is computable from the 15-min series the pilot server already stores,
and each is deliberately simple enough to explain to a technician:

1. **Cycle amplitude** — peak-to-trough of the sawtooth over a rolling 3h
   window (healthy: 1–4°F buffered; collapse = compressor/power).
2. **Cycle period & on-fraction proxy** — time between local minima; the
   fraction of each period spent warming vs cooling (stretching = condenser
   or charge trouble).
3. **Rise slope** — °F/h over 1h and 6h windows (fast = door; 1–4°F/h steady
   = no-cool; +0.5–1.5°F/DAY = defrost/ice).
4. **Recovery slope after excursion** — °F/h back toward set point once a
   rise reverses (healthy door events recover at the machine's normal pull-
   down rate; a sick machine recovers slowly or not at all — this is the
   recovery rule generalized into a rate).
5. **Defrost-event detector** — periodic 2–8°F bumps with full recovery;
   track their PRESENCE and cadence (disappearance = defrost system suspect).
6. **Cross-compartment spread** — fresh_food minus freezer, level and slope,
   vs that unit's own baseline (the two-probe divergence metric; evap fan and
   damper live here).
7. **Ambient correlation** — daily-cycle correlation of compartment mean with
   time-of-day (gasket/condenser modes are ambient-coupled; sealed-system is
   not).
8. **Oscillation power** — cheap spectral proxy: variance of the 15-min
   first-differences in the 20–90min band (the "is the compressor cycling at
   all" number).

## The showroom drill protocol (produces the training set)

Run each drill on an instrumented unit with BOTH compartment probes + one
bare air probe, logging at 1–5 min on USB power. Label via the pilot
server's drill mode (below) — start the label BEFORE inducing, end it after
full recovery, one mode per drill, 48h of healthy baseline between drills:

1. Door open 5 / 15 / 45 min (three severities).
2. Gasket leak: tape a pencil-gap in the seal for 24h.
3. No compressor: pull the unit's power... no — that kills the sensor story;
   instead pull the COMPRESSOR relay/start components or use the service
   mode where available; alternatively unplug WITH sensor on battery to
   capture the power-loss twin.
4. No evap fan: disconnect the evaporator fan 12–24h (the money drill — the
   divergence signature).
5. Failed defrost: disable the defrost heater for several days (longest
   drill; schedule around showroom traffic).
6. Condenser: block the condenser inlet with cardboard 24h.
7. Warm-air intrusion: cycle the door on a cadence (opens every 20 min for
   2h) to teach the classifier heavy-use vs fault.

Each drill sheet records: unit, mode, induced start/end, probe placement,
ambient, and anything anomalous. The pilot server labels the readings; the
export is the labeled dataset the trend programming starts from.

## What ships when

Phase 1 (now): thresholds + recovery rule (live in plan-config).
Phase 2 (after drills): the eight metrics computed and DISPLAYED to the
office beside each sensor — "oscillation collapsed", "compartments
diverging" — as decision support, no automatic classification claims.
Phase 3 (after counsel files): mode classification driving mode-specific
dispatch ("evap fan likely — truck rolls with a fan motor"). Parts-staging
by predicted mode is the claim shape the patent brief recommends.
