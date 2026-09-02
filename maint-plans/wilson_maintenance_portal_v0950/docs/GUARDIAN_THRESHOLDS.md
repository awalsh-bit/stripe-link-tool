# Guardian flag thresholds — the research behind the numbers (v0.9.42)

Cayden's working model: "temp falling outside of a set range and failing to
recover to set point within a threshold. Like if we are seeing 48 degrees in a
fridge that should be 37 and that condition persists for over an hour its
probably the start of a no cool situation."

**Verdict on that instinct: it is Sub-Zero's own service line.** Their
troubleshooting doc says a box reading 48°F when set at 38 is past the point a
condenser cleaning will save it [12]. 48°/1 h is a sound DISPATCH trigger; the
research adds an earlier WARNING tier (because by the time 48° has held for an
hour, the food has usually been over 40° for 2–3 hours and the USDA discard
clock has run out [4]) and formalizes the failure-to-recover rule, which is
the cleanest single discriminator between an event and a failure.

## The three-rule shape (per band, in plan-config `tempMonitoring.flagRules`)

| Rule | Meaning | Fires |
|---|---|---|
| WARNING (`maxF` / `holdMinutes`) | Sustained past the food-safety line, longer than any healthy defrost or door event | Office attention (hub "warning" tier) |
| DISPATCH (`dispatchF` / `dispatchHoldMinutes`) | Sustained where nothing normal ever lives — the no-cool signature | Priority dispatch |
| RECOVERY (`recoverWithinMinutes`) | Breached the warning line and never re-crossed it within the window | Priority dispatch |

## The numbers, and where each comes from

### Fresh food (setpoint ~37°F)
- **Warning: >41°F sustained 45 min.** 41°F is the FDA Food Code cold-holding
  limit [6]; CDC's vaccine band tops at 46°F [7]; Sub-Zero calls ±5°F swing
  normal [13]; a healthy cabinet recovers a door event in 10–83 min
  (University of Bristol measured study [9]) — so 45 sustained minutes past
  41° is not a door.
- **Dispatch: >45°F sustained 60 min, or no recovery below 41°F within 2 h.**
  Sub-Zero: storing food above 45°F is not safe, and 48° set at 38 is a
  service call [12]. The 2-hour recovery window matches the USDA rule that
  perishables above 40°F for more than 2 hours are discarded [4].

### Freezer (setpoint ~0°F)
- **Warning: >10°F sustained 60 min.** CDC freezer band tops at +5°F [7]; lab
  practice offsets the alert ~10° over setpoint with a 30–60 min delay [17].
  The window is longer than the fridge's because auto-defrost air spikes of
  15–40°F two or three times a day are NORMAL [10][11] and freezer recovery
  after a door event runs 29–81 min [9].
- **Dispatch: >20°F sustained 90 min, or no recovery below 10°F within 2 h.**
  A healthy defrost recovers inside 1–2 h; food risk is still low (a full
  freezer holds safe ~48 h unpowered [4]) so the freezer tier is about
  catching the failure early, not imminent loss.

### Wine (setpoint ~55°F)
- **Warning: >62°F sustained 3 h. Dispatch: >68°F sustained 4 h, or no
  recovery within 8 h.** Consensus storage band 45–65°F, ideal ~55°F [26];
  heat damage onset ~70°F, "cooked" wine at sustained ~80°F+ [27]; the
  chemistry roughly doubles per +18°F [28]. Wine's damage clock runs in
  hours-to-days, so long windows page nobody at 2 AM for a unit that will
  be fine at 8 AM. (Take rate expected minimal — Cayden.) v2 note: for wine,
  RATE of change matters more than the line (swings push corks); a
  ">5°F move within 4 h" warning is worth adding when the real feed exists.

### Offline (all bands)
- **3 hours of silence = act.** A closed unpowered fridge only holds safe
  temperature for about 4 hours total [4], and a dead sensor is
  indistinguishable from a dead circuit — the decision must come before hour
  four. (Was 4 h in the v0.9.39 draft; tightened.) Whole-house simultaneous
  offline reads as a power/internet outage: call the customer first.

## The probe decision (changes the numbers)

These figures assume a **buffered probe** — the sensor's probe sitting in a
glycol jar or water bottle, the CDC vaccine-storage method [7][8], so it reads
like the FOOD rather than the air. UbiBot's DS18B20 external probe (~$20)
makes this a $25 install detail. Buffered installs report 50–70% fewer false
alerts [22], because air inside a no-frost unit routinely spikes 15–40°F
during defrost [10] while the food barely moves. On a BARE AIR probe, loosen
roughly: fresh food warn 43°/60 min, dispatch 47°/90 min; freezer warn
15°/90 min, dispatch 25°/2 h. The prototype simulator behaves like a buffered
probe (no defrost spikes are simulated), so the config carries the buffered
numbers.

## Escalation pattern (industry standard, for the production build)

Warning → notify office, repeat every 30 min until acknowledged. Dispatch →
SMS + call to on-call tech and the customer, re-alert every 30 min. Any
warning unacknowledged for twice its window escalates to dispatch handling.
Alarm fatigue is the failure mode that kills monitoring programs — tiering
exists so that >50-alert days never happen [22].

## Sources

Numbered references match the full research report's source list; the load-bearing ones:

- [4] FoodSafety.gov — power-outage rules (4 h fridge hold, 2 h >40°F discard, 48 h full freezer) — https://www.foodsafety.gov/food-safety-charts/food-safety-during-power-outage
- [6] FDA Model Food Code — 41°F cold holding — https://onfocussolutions.com/fda-food-code-danger-zone-41-to-135-degrees/
- [7] CDC Pink Book ch. 5 — vaccine storage: fridge 36–46°F, freezer −58 to +5°F, buffered probes, 30-min logging — https://www.cdc.gov/pinkbook/hcp/table-of-contents/chapter-5-vaccine-storage-and-handling.html
- [8] Immunize.org — why probes are buffered — http://www.immunize.org/ask-experts/topic/storage-handling/temperature-monitoring-controls/
- [9] University of Bristol — measured door-open spikes (+12–21°F air) and recovery times (10–83 min fridge, 29–81 min freezer) — https://www.scientificlabs.co.uk/file/1612/Door%20Opening%20Performance%20Study,%20Fridges%20and%20Freezers%20-%20University%20of%20Bristol
- [10] LabRepCo — defrost cycles 2–3×/day, air spikes to +27°F — https://www.labrepco.com/2021/05/04/understanding-refrigeration-defrost-cycles/
- [11] MOCREO — 40° freezer defrost spikes as normal — https://mocreo.com/2023/06/29/how-can-you-verify-if-the-freezers-automatic-defrost-feature-is-working-properly/
- [12] Sub-Zero — warm-unit troubleshooting: 48°F set at 38 won't recover from a cleaning; >45°F unsafe for food — https://www.subzero-wolf.com/assistance/answers/sub-zero/common/warm-refrigerator-or-freezer-troubleshooting
- [13] Sub-Zero — ±5°F fluctuation normal; groceries need hours, new setting needs 24 h — https://www.subzero-wolf.com/assistance/answers/sub-zero/common/sub-zero-temperature-fluctuations
- [17] Lab Manager — 30–60 min alert delays, offsets over setpoint — https://www.labmanager.com/choose-the-right-alert-set-points-for-your-freezers-refrigerators-and-incubators-23385
- [18] DicksonOne — alarm-delay = interval × readings; "not reporting" as its own alarm class — https://dicksondata.com/support/alarms-and-notifications/alarm-delay-behavior
- [22] Envigilance — alarm fatigue; buffered probes cut false alerts 50–70% — https://envigilance.com/temperature-monitoring/alarm-fatigue/
- [26] Wine Spectator — 45–65°F band, 55°F ideal, swings worse than absolutes — https://www.winespectator.com/articles/how-to-store-wine-temperature-humidity-coolers-and-more
- [27] VinePair — heat damage threshold ~70°F — https://vinepair.com/articles/how-much-heat-does-it-take-to-ruin-wine-not-much/
- [28] Jamie Goode / EuroCave — reaction rates double per +10°C — https://www.eurocave.com.au/wp-content/uploads/2013/05/Goode-wine-storage-temperatures.pdf
