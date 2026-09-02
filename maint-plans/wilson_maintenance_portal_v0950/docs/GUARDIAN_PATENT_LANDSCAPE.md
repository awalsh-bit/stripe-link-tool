# Guardian — prior-art & patent landscape brief (Sep 2, 2026)

Prepared as background for Wilson's patent counsel. Search-based landscape
scan, NOT a legal opinion or professional FTO search. Legal-status fields are
as Google Patents displayed them on 2026-09-02; re-verify on USPTO Patent
Center. Pending unpublished applications (~18-month lag) are invisible to
this method.

## The one-page read

**Crowded and dead:** threshold + sustain-time + escalation + remote alert +
technician dispatch for refrigeration temperature is 1976–2005 art, fully
expired. Robertshaw US6453687 (2000, expired) nearly anticipates the whole
Guardian service model including "call a repairperson"; Emerson US7644591
(expired 2022) covers server + thresholds + dispatch + work orders. Nothing
to patent here — and correspondingly little live risk to operate.

**Plausibly open ground (attorney to confirm):**
1. **Multi-compartment differential-signature diagnosis** — using fresh-food
   vs freezer probe DIVERGENCE from an aftermarket probe set to discriminate
   evaporator-fan/airflow/damper faults from sealed-system faults. Nothing
   found; OEM dual-sensor art is for CONTROL, not diagnosis. Strongest
   whitespace candidate.
2. **A narrow integrated claim**: residential, aftermarket, buffered-probe,
   temperature-curve-only failure-MODE classifier (curve features: cycle
   signature, recovery slope, defrost morphology) coupled to mode-specific
   dispatch/parts-staging. Broad "classify faults from temp with ML" is
   anticipated (IBM, LG, KLATU, academic FDD literature) — narrow and
   integrated is the only viable shape.
3. Induced-failure training per se: weak claim; the labeled failure DATASET
   is the moat — keep it a trade secret regardless of filing.

**Timing (important):** the CURRENT Guardian system is already in customer
conversations, so the US one-year on-sale/disclosure clock is likely already
running on everything the current system embodies (foreign rights on it
likely gone). The failure-classification roadmap is NOT yet public — file a
provisional covering the classifier + differential analysis + dispatch
integration BEFORE any marketing, pilot announcement, or customer-facing
rollout of failure-mode features. Keep induced-failure test details out of
marketing copy.

**Five documents for the attorney to actually read:**
- LG US11668521B2 (active to 2040) — cloud LSTM diagnosis of door-open /
  defrost / compressor / leak from ~1-min temperature time series. The most
  important live patent. Key question: do its claims require the REFRIGERATOR
  ITSELF to transmit the data (OEM integration) — which Wilson's independent
  probe does not do?
- KLATU Networks family — US10337964B2, US11402279, US8725455 + rest (active)
  — third-party temperature-cycle health inference for lab cold storage; the
  closest live business-model match. Top FTO-review family.
- IBM US10935309B2 / US10941980B2 (LAPSED, fee-related) — temperature-
  signature ML with labeled root causes for commercial cases. Dead rights,
  but fully enabled prior art that shapes how narrow Wilson's claims must be.
- Whirlpool US8981930B2 (active to 2033) — broad appliance-monitoring-service
  claims; check whether an INDEPENDENT sensor falls outside its
  data-from-the-appliance limitations.
- Whirlpool US10208993B2 (active to 2032) — fan-vs-compressor fault taxonomy
  from COMPRESSOR-frequency signal; verify that limitation keeps a temp-only
  system clear.

## Layer 1 — monitoring + alerting (expired core)

US3976985A (1976, freezer alarm) · US4566285A (1986, door-ajar with time
delay) · US5917416 (1999, retrofit remote alarm) · **US6453687B2 Robertshaw
(2000, EXPIRED)** — retrofit sensor, spoilage prediction, alerts user /
monitoring service / repairperson · **US7644591B2 Emerson→Copeland (prio
2001, EXPIRED 2022)** — remote facility, thresholds, food-safety comparison,
work orders, dispatch · US7490477B2 Emerson (EXPIRED) — multi-sensor
predictive maintenance trend/band analysis · US7005983B2 GE (EXPIRED) —
door-switch openings. Recurring expired claim patterns: threshold+sustain,
tiered escalation, dispatch/work-order generation, retrofit-sensor-plus-
service, offline/heartbeat detection. No blocking patents surfaced from
Sonicu / SensoScientific / Dickson / MarCELL / Temp Stick. Glycol-buffered
probes: decades-old CDC practice; only narrow device patents exist.

## Layer 2 — predictive/diagnostic (the layer that matters)

Compressor-side (electrical/refrigerant sensing, NOT cabinet temp):
US7484376B2 Copeland CoreSense (expires June 2026) · US9669498B2 (EXPIRED May
2025 — the 2004-priority Emerson estate is aging out now) · US8393169B2
(active to 2029, requires current sensing — not Wilson's path).

Whole-fridge classification: **Whirlpool US10208993B2** (active 2032) —
condenser-fan vs evap-fan vs compressor faults, but from compressor-frequency
feedback · **LG US11668521B2** (active 2040) — see above · LG US8983798B2
(acoustic "Smart Diagnosis", not temperature) · **Whirlpool US8981930B2**
(active 2033) — broad monitoring-service claims.

Temperature-signature pattern art closest to the roadmap: **IBM US10935309B2
+ US10941980B2 (LAPSED)** — temp-only ML, baseline signatures incl. defrost
morphology, DTW matching, root-cause from labeled data · **KLATU US10337964B2
family (ACTIVE to ~2033)** — temperature-cycle statistical/frequency analysis
inferring compressor valve wear, leaks, seal degradation in lab/ULT units ·
Polar Controller US10697860B2 (LAPSED) · Esco US20140250925A1 (ABANDONED) —
multi-point temps + duty cycle, tiered alerts · LG US20210108854A1
(ABANDONED) — RNN spoilage risk from multi-compartment data · Google
US12359830B2 (active, refrigerant-side) · Dempsey US11874009B2 (active) —
HVAC degradation from indoor-temp rate-of-change alone; relevant if Guardian
extends to HVAC.

Door-open vs fault: Startrak US20100083689A1 (ABANDONED 2016) — door state
inferred purely from temp persistence/recovery timing. Prior art against any
broad "door inferred from curve" claim.

## Whitespace findings (labeled inferred — absence of evidence)

No patent found claiming: multi-class failure-mode discrimination (door /
warm-air intrusion vs compressor vs evap-fan vs defrost) from internal
temperature time series alone, in RESIDENTIAL units, by an AFTERMARKET
third-party sensor. Nothing found on cross-compartment divergence as a
diagnostic classifier. Nothing found on induced-failure-trained residential
classifiers (and academic FDD literature makes that method hard to claim).
Professional FTO search should run CPC F25D29/00, G01K, F25B49/00, G05B23/02
against this feature set — OEM Korean/Chinese filings are voluminous and
recent applications are unpublished.

Full source list with links lives in the session research record; every
patent number above is searchable on patents.google.com verbatim.
