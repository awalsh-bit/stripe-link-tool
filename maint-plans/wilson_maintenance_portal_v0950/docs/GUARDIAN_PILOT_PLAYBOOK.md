# Guardian pilot playbook — test the waters before the $5k (v0.9.45)

Cayden: "Should we start on a more base version of ubibot to test the waters?
I'd like to deploy a few test sensors and force a few failures to see how
everything reacts and if our thresholds catch the fails."

Yes — the pilot runs on UbiBot's FREE public-cloud tier plus the $1/device/
month data-forwarding add-on. Three sensors ≈ **$3/month**. The $5,000
Developer Membership is a post-pilot purchase, made only after this playbook's
drills pass. Every drill below has already been run SYNTHETICALLY against the
pilot server (`_qa/verify-pilot-server.py`, 19 checks green) — the physical
pilot confirms the same behavior with real hardware, real WiFi, and real
compressors.

## Shopping list (~$260 for a three-sensor pilot)

| Item | Qty | ~Cost | Note |
|---|---|---|---|
| UbiBot WS1 Pro | 3 | $65–80 ea | 2.4GHz WiFi; two probe ports on the +SIM variant |
| DS18B20 external probe, 3 m | 3 | $12–20 ea | UbiBot's own; stainless, immersion-rated |
| Glycol jar (or 16 oz water bottle) | 3 | ~$5 | The buffer IS the false-alarm filter |
| USB power supplies | 3 | ~$10 | Powered install; 1–15 min reading intervals |
| UbiBot cloud | — | $0 tier | We run our own alerting |
| Data Forwarding add-on | 3 ch | $1/device/mo | Points at the pilot server |

Suggested placement: shop fridge (glycol probe), shop freezer (glycol probe),
and a third unit with the BARE onboard air sensor on purpose — the comparison
unit that shows why the buffered probe earns its jar.

## Setup (an afternoon)

1. Onboard the three sensors to the shop's 2.4GHz WiFi via the UbiBot app.
   Set reading interval 5 min, sync interval 5–15 min, on USB power.
2. Probe tips into the glycol jars, jars mid-shelf, cable through the door
   seal. Set each channel's temperature unit or note it (server converts C→F).
3. On the shop machine (NOT exposed to the internet — office LAN only):
   copy `tools/guardian-pilot-sensors.example.json` to
   `guardian-pilot-sensors.json`, fill in the channel ids and fields
   (external probe = field7), then `node tools/guardian-pilot-server.js`.
4. In UbiBot's console, set each channel's Data Forwarding URL to
   `http://<shop-machine>:8091/ubibot`. The server answers "SUCCESS" the way
   their health check expects.
5. Optional: set `ALERT_WEBHOOK_URL` in the environment to a Slack/Teams
   incoming webhook so incidents buzz a phone. The account key, if the
   poller mode is used instead of forwarding, lives ONLY in the
   `UBIBOT_ACCOUNT_KEY` environment variable — never in a file in this repo.
6. Open `http://<shop-machine>:8091/` — the status page shows every sensor,
   its tier, and the incident log, judged by the exact production flag rules.

## The drills — force the failures, grade the thresholds

Let everything run quietly for 48 hours first (baseline: zero incidents
expected through real defrost cycles and door traffic). Then, one drill at a
time, logging start time and what the server did.

**Label every drill (v0.9.49).** Before inducing anything, tell the server
what you are about to do; end the label only after full recovery:

    curl -X POST http://127.0.0.1:8091/drill \
      -d '{"channelId":"12345","mode":"door_open","note":"showroom unit 3"}'
    ...run the drill, wait for full recovery...
    curl -X POST http://127.0.0.1:8091/drill/end -d '{"channelId":"12345"}'

Every reading that arrives during a labeled drill is written to a durable
training file, incidents fire stamped with the drill mode (detection latency
reads straight off the incident log), and `/export.jsonl` / `/export.csv`
are the labeled dataset the failure-signature work
(docs/GUARDIAN_FAILURE_SIGNATURES.md) starts from. Modes are a fixed list —
`GET /drills` shows them. That export is in-house training data: it stays on
the pilot box, out of the repo, out of marketing, out of anything a
customer sees.

| # | Drill (do this) | Expect | Pass = |
|---|---|---|---|
| 1 | **Baseline 48 h** — normal use, no interference | OK throughout, defrost spikes visible on the air-probe unit only | Zero incidents |
| 2 | **Door test** — prop the fridge door open 15–20 min, then close | Air probe spikes; glycol probe barely moves; both recover | Zero incidents; note recovery time on the chart |
| 3 | **Grocery test** — load a case of room-temp drinks | Slow bump, recovery within hours | Zero incidents |
| 4 | **Cayden's no-cool** — pull the probe+jar out to room temp (simulates the compartment warming), leave ~75 min | WARNING near the 45-min mark once past 41°F; **DISPATCH** once >45°F has held an hour | Both fire, in order, ±10 min |
| 5 | **The slow creep** — jar in a picnic cooler with an ice pack going soft, holding ~42–44°F for 2+ h (never reaching 45°F) | **DISPATCH via the recovery rule** at ~2 h over the line | Fires without ever touching the dispatch temperature |
| 6 | **WiFi kill** — pull the router plug (or block the sensor's MAC) for 3+ h | **OFFLINE** incident at the 3-hour hold | Fires; note it says "no reading", never fakes a temperature |
| 7 | **Recovery** — return each drill to normal | Tier returns to OK, recovery logged with the prior tier named | Recovery lines in the incident log |
| 8 | **Freezer defrost watch** — no interference; find the 2–3 daily defrost spikes on the freezer chart | Spikes visible on air probe, damped in glycol | Zero incidents through every defrost |

Grade sheet: each drill either fired the right tier at roughly the right time
or it didn't. If drill 2 or 8 pages anyone, the buffered numbers are too
tight for that cabinet (or a probe is out of its jar). If drill 4 or 5 is
slow by more than ~20 minutes, tighten `holdMinutes` /
`recoverWithinMinutes` in plan-config's flagRules — the server picks the
change up on restart, because it reads the same config file.

## What the pilot must answer before the $5k

1. Do the thresholds catch the forced failures without false alarms through
   normal use? (Drills above.)
2. How does 2.4GHz onboarding actually feel — minutes per sensor, any captive
   portal / mesh weirdness on the shop network?
3. Does data forwarding arrive reliably at 5–15 min sync, and what happens
   across a WiFi outage (the 300k-reading backfill should refill the chart)?
4. Glycol vs bare-air, side by side: how many would-be false alarms did the
   jar eat? (Compare the comparison unit's chart against the glycol units'.)
5. Battery vs USB: if any sensor must run on AAs, what interval keeps months
   of life?

Green answers → buy the Developer Membership (with the four contract items in
TEMP_MONITORING_UBIBOT_NOTES.md), point the devices at the production
backend, and the pilot server's evaluation loop — which is already the
product's own rules — becomes the seed of that backend.

## Cost of the whole experiment

~$260 hardware + ~$9 in forwarding fees for a 90-day pilot. Every sensor is
reusable in the first customer installs.
