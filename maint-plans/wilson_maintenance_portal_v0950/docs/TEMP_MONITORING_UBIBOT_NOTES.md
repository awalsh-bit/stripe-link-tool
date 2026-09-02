# Wilson Temp Watch — build notes (v0.9.39)

Cayden's brief: partner with UbiBot, monitor customer refrigeration over WiFi,
sell it alongside refrigerator maintenance (or standalone), Wilson-branded,
integrated with the dashboard, hundreds of sensors, catch failing refrigerators
remotely, dispatch cleanly on flags. Placeholder price $150/yr/sensor for 24/7
response and priority dispatch.

## The recommendation: one platform, its own hub

Build Temp Watch **inside the existing portal as its own domain** — not a
separate project linked later. The reasons are the crossovers Cayden already
named:

- **The sale happens at registration.** The add-on card fires when a
  refrigeration appliance is enrolled, and the price flows through the ONE
  pricing engine alongside filter service. A separate tool would need its own
  checkout, and two checkouts is two pricing engines — the bug family this
  project keeps finding.
- **The flag needs the maintenance record.** "This fridge is drifting warm" is
  worth double when the last visit's condenser reading and the IR baseline
  photo sit one join away. A separate tool would re-import all of it.
- **The report is the customer's window.** If both services are on, the
  monitoring summary belongs on the health report — same document, same trust
  rules.
- **The dispatch queue is the office's window.** The command center already is
  the worklist; a monitoring flag is one more stage, not one more tab in
  another product.

What stays SEPARATE is the data plane: sensor readings are high-volume
time-series and do not belong in the household record. Own tables (readings,
channels, flags), own ingest service, joined to the household by asset id.
Standalone-without-maintenance customers are just households with a monitoring
subscription and no maintenance plan — the same record, fewer services.

## The UbiBot facts that shape the backend (verified 2026-09-01)

- **Open REST API**: `https://webapi.ubibot.com`, account key + per-channel
  keys. Endpoints for channels, feeds, summaries, commands.
  (ubibot.com/platform-api/)
- **Rate limits kill polling**: feed reads are limited to **1/channel/minute
  and 6/account/minute** (12/min for summaries). Polling hundreds of sensors
  through one account is arithmetically impossible.
- **Data forwarding is the answer**: UbiBot pushes a copy of every reading to
  a URL you register (webhook). The Wilson backend ingests pushes, stores
  readings, and evaluates flag rules on ingest. MQTT also exists as an option.
- **Hardware**: WS1 (~$60 street, unverified) / WS1 Pro (~$100, unverified),
  2.4 GHz WiFi only — site surveys matter in big houses with 5 GHz-only mesh.
  Freezer monitoring needs the DS18B20 external probe ($19.99, −55 to 125 °C);
  the device itself only senses to −20 °C and lives outside the box.
- **Cloud plans**: free tier includes alerts, forwarding, and the basic APIs;
  paid tiers $15–$80/mo per account. Raw-data API needs Platinum ($80/mo).
  Per-device storage add-ons $0.20–$4/mo.
- **White-label**: an on-premises platform and "private interface SDK" exist;
  pricing unpublished — a sales conversation. The forwarding + own-dashboard
  route gets Wilson branding without waiting on that conversation.
- **Margin sketch at the draft price**: $150/yr/sensor against ~$60–100
  hardware (one-time, could be sold or absorbed), ~$0.20–4/mo platform
  storage, and the dispatch promise. The recurring COGS is small; the real
  cost is the response commitment.

## What the prototype builds (this release)

- `tempMonitoring` config block: draft price, eligibility (refrigeration
  category), DRAFT flag rules (fresh food >42°F for 45 min, freezer >15°F for
  45 min, wine >62°F for 2 h, sensor silent 4 h) — **Cayden to review; these
  fire a commercial promise**.
- Registration add-on card on every enrolled refrigeration appliance: filter
  service + temp monitoring together, priced live through the engine.
- `monitoring.html` — the hub: fleet worst-first, sustained-flag evaluation,
  one-button priority dispatch (idempotent per appliance per day), dispatch
  log, all simulated data labelled as simulated.
- `assets/temp-monitoring.js` — the flag evaluator is written against plain
  reading arrays so it moves to the server unchanged when the real feed
  arrives.

## Open questions for Cayden

1. The flag thresholds and hold times (above) are drafts. What does the field
   team consider truck-worthy?
2. Hardware pricing: is the sensor sold, rented, or absorbed into year one?
3. Standalone (monitoring-only) sale: same $150, or higher without a
   maintenance plan to ride on?
4. Response promise wording: "same or next business day" is drafted copy —
   what can dispatch actually commit to at hundreds of sensors?
5. Wine/freezer set points vary per household — the production setup step
   should record each compartment's set point at sensor install.

---

## v0.9.43 — the buffered-probe question, answered

Cayden: "Buffered probe sounds like the best route and less false alarms. Can
you help me research if the ubibot offerings could handle this? Do we need to
go another route in terms of sensor partners? I really want to control the
data and back end in house using a high quality sensor built by someone else."

### Can UbiBot do the buffered probe? YES — verified.

- The **WS1 Pro** takes the DS18B20 external probe (the WiFi+SIM variant has
  two probe ports); UbiBot sells it at $11.99–19.99 in 1–15 m cable lengths,
  stainless, marketed for immersion (fridges, pools, hot tubs). Probe tip in a
  glycol jar, radio unit OUTSIDE the fridge, cable through the door seal —
  the exact CDC vaccine-storage setup. One caveat to get in writing: no formal
  IP rating is published for the probe tip.
- **Data forwarding pushes the probe channel** (external sensors ride fields
  7–10 of the same JSON POST), so the in-house backend gets the buffered
  reading, not just onboard air temp.
- Reading interval down to 1 min on USB power; 300k-reading onboard buffer
  backfills history after a WiFi outage (real-time alerting still goes dark —
  the backend's 3-hour offline rule covers that).
- Per-channel offset calibration exists; factory cert is metrology-traceable
  but not NIST-named. Reseller/distributor program exists; no white-label.

### The two questions to put to UbiBot sales before committing

1. Does Data Forwarding require a paid cloud tier? (Raw Data API is
   Platinum-gated; forwarding's tier is undocumented. This answer decides the
   per-device economics.)
2. Is there a bulk/API way to configure forwarding? (Today it is console-
   manual per channel — real friction at hundreds of sensors.)

### Do we need another partner? Not to launch. Worth piloting in parallel:

| Path | Per home | The trade |
|---|---|---|
| **UbiBot WS1 Pro + probe** (launch) | ~$85–105 hardware | Cheapest, ships now, forwarding gives us the data plane. Weakness: lives on the customer's 2.4GHz WiFi — router swaps orphan devices until a truck roll. WiFi+SIM variant is the difficult-home escape hatch. |
| **Private LoRaWAN** — Dragino LHT65N-E3 (DS18B20 variant) + our gateway on the customer's router by ETHERNET | ~$150–190, $0/yr vendor fees | The strongest match to "control the data in house": no vendor cloud exists at all; Ethernet hub is immune to WiFi churn; the same gateway later carries leak/power sensors free. Cost: Wilson becomes a small network operator. Pilot in ~10 homes. |
| **Efento NB-IoT** (or Monnit + cellular gateway) | quote, est. $120–180 + data | Zero dependence on the customer's network entirely — sensors talk carrier-direct to our own server (documented CoAP path). The escalation tier for hostile homes. |

Closed ecosystems (Sonicu, DicksonOne, SensoScientific, ThermoWorks, Copeland
GO) are pricing comparables, not suppliers. SensorPush/Temp Stick APIs are
poll-only and rate-limited — unusable for a fleet.

### Pricing comparables for $150/yr/sensor

- MarCELL (residential cellular, self-serve, NO human response): $99–299/yr.
- Sonicu's implied monitoring-only renewal: ~$73/yr WiFi, ~$133/yr LTE — no
  install, no dispatch.
- Home-watch services (a human checks the fridge weekly): $1,800–2,600/yr.
- DIY hardware floor (Temp Stick / SensorPush, zero service): ~$140–155 once.

$150/yr including buffered-probe install and priority dispatch from a 10-tech
shop sits comfortably between "self-serve gadget" and "human home-watch" —
the dispatch promise is the moat; no comparable includes one.

### Backend design note (unchanged, reinforced)

Every option's real failure mode is SILENCE, not bad readings. The ingest
must run a dead-man timer per sensor (no data in N minutes = incident), which
is exactly the `offline` flag rule already in plan-config.

---

## v0.9.44 addendum — the $5,000 developer fee, verified

Cayden: "I think ubibot has a 5k one time fee to have full developer access.
Is that all we'd pay outside of hardware?"

**Yes — verified, with three contract items to pin down.** UbiBot sells a
"Developer Membership / Private Deployment Solution" at **$5,000 one-time**
(store.ubibot.com/products/ubibot-developer-membership). It buys direct
device-protocol access (HTTP/MQTT) — the sensors push straight to Wilson's
server with UbiBot's cloud out of the loop entirely — plus full APIs, SDK,
firmware-update tools, commercial licensing, and "private label / white-label
branding" listed as a benefit. Their page states "no ongoing platform fees."

UbiBot sells three different things; don't mix them up on the sales call:

| Offering | Price | What it is |
|---|---|---|
| Public cloud | Free–$80/mo per account; **Data Forwarding is $1/device/month** | Their console; forwarding webhooks to our backend |
| On-Premises Platform | $0–$4,999/YEAR by device count | THEIR console software running on our servers, white-label tools |
| **Developer Membership** | **$5,000 one-time** | Protocol access; we build everything; no cloud in the loop |

Cost math: without the membership, forwarding at $1/device/month is $3,600/yr
at 300 sensors — the $5k membership pays for itself in ~17 months and removes
the vendor cloud from the architecture entirely (the same property that made
the LoRaWAN path attractive, at lower per-home hardware cost).

**Get in the contract before wiring money:** (1) "one-time, perpetual" in
writing — one of UbiBot's own comparison tables misprints it as "$5,000/year";
(2) no per-device activation or registration fee under the membership;
(3) white-label scope for reselling monitoring as Wilson Refrigeration
Guardian — the benefit is listed but no license text is published;
(4) firmware-update access remains included long-term. Items (a) forwarding
tier and (b) bulk forwarding config from the earlier list become moot on the
developer path — there is no forwarding, the devices talk to us.

---

## v0.9.45 addendum — "who actually makes the sensors?"

Cayden: "could I just figure out who is manufacturing ubibots sensors and go
straight to them? Couldn't we write our own app for them?"

**There is no factory behind the brand to go to — UbiBot IS the factory.**
The brand belongs to Dalian Cloud Force Technologies Co., Ltd. (Dalian,
China), which designs and builds the hardware itself: the US trademark is
registered to them, the WS1's FCC filings are theirs, and the parent site
(cloudforce.cn) sells custom IoT hardware development directly. The $5,000
Developer Membership is literally their factory-direct, write-your-own-app
product: their firmware, our server, our app, white-label allowed.

Technical footnote: a community teardown identifies the WS1 as an ESP32 with
an SHT30 sensor, and someone has successfully flashed Tasmota onto one — so
custom firmware is possible, and a terrible fleet strategy (void warranty,
lose OTA updates, likely invalidate the FCC authorization, inherit the
security-patch pager for hardware we don't make).

ODM-direct (Tuya-ecosystem, MOKO, Minew) at MOQ 200–500 saves maybe $30–50 a
unit — $9–15k on 300 sensors — and costs a firmware NRE, possible FCC filing
($5–15k), RMA logistics, and supply-continuity risk. Tuya specifically adds
MORE cloud lock-in, not less. The ODM path starts to pencil around 1,000+
units or if Wilson wants to own a hardware roadmap. At our scale: buy the
membership, negotiate bulk hardware under their distributor program, keep
stock firmware.
