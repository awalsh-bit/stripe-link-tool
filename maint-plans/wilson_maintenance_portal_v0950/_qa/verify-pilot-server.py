#!/usr/bin/env python3
"""
THE PILOT SERVER, DRILLED.                                        (v0.9.45)

Cayden: "deploy a few test sensors and force a few failures to see how
everything reacts and if our thresholds catch the fails." Before a single
sensor ships, this suite forces those failures SYNTHETICALLY against the real
ingest server -- the same drills the playbook has a tech perform physically:

  drill 1  a healthy sawtooth        -> stays OK, no incident
  drill 2  a door-open blip          -> stays OK (the sustain windows hold)
  drill 3  Cayden's example: 48°F in a 37°F fridge persisting over an hour
                                     -> DISPATCH
  drill 4  a slow creep that never recovers below the warning line
                                     -> DISPATCH via the recovery rule
  drill 5  a freezer defrost spike   -> stays OK (long freezer windows hold)
  drill 6  silence                   -> OFFLINE incident
  drill 7  Celsius arrives, rules judge Fahrenheit (unit conversion)
  drill 8  LABELING: start a drill, feed readings, end it -> the readings
           carry the drill mode in /export.jsonl, readings outside the
           window export as "healthy", incidents during a drill are stamped
           with the mode, and junk modes are refused (a clean training set
           is the whole point).

The server loads assets/plan-config.js and assets/temp-monitoring.js -- the
one implementation -- so a pass here says the REAL rules catch the fails.

Run: python3 _qa/verify-pilot-server.py
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

checks = 0
failures = []


def check(label, got, want=True):
    global checks
    checks += 1
    ok = got == want
    print(("ok    " if ok else "FAIL  ") + label.ljust(66) + ("" if ok else f" got {got!r}"))
    if not ok:
        failures.append(label)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def feeds(series):
    """series: list of (minutes_ago, value_f). Returns UbiBot-shaped feeds
    carrying CELSIUS, the unit a stock channel reports."""
    now = datetime.now(timezone.utc)
    rows = []
    for minutes_ago, value_f in series:
        c = (value_f - 32) * 5 / 9
        rows.append({
            "created_at": (now - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "field7": {"value": round(c, 2)},
        })
    return rows


def sawtooth(hours, base, swing):
    return [(m, base + (swing if (m // 30) % 2 else 0)) for m in range(hours * 60, -1, -15)]


def main():
    workdir = Path(tempfile.mkdtemp(prefix="guardian-pilot-qa-"))
    sensors_file = workdir / "sensors.json"
    data_file = workdir / "data.json"
    incident_file = workdir / "incidents.jsonl"
    sensors_file.write_text(json.dumps({"sensors": [
        {"channelId": "1001", "field": "field7", "kind": "fresh_food", "unit": "C", "label": "drill fridge healthy"},
        {"channelId": "1002", "field": "field7", "kind": "fresh_food", "unit": "C", "label": "drill fridge door"},
        {"channelId": "1003", "field": "field7", "kind": "fresh_food", "unit": "C", "label": "drill fridge no-cool"},
        {"channelId": "1004", "field": "field7", "kind": "fresh_food", "unit": "C", "label": "drill fridge creep"},
        {"channelId": "1005", "field": "field7", "kind": "freezer", "unit": "C", "label": "drill freezer defrost"},
        {"channelId": "1006", "field": "field7", "kind": "fresh_food", "unit": "C", "label": "drill fridge silent"},
        {"channelId": "1007", "field": "field7", "kind": "fresh_food", "unit": "C", "label": "drill fridge not installed yet"},
    ]}))

    port = free_port()
    env = dict(os.environ,
               PORT=str(port),
               GUARDIAN_SENSORS_FILE=str(sensors_file),
               GUARDIAN_DATA_FILE=str(data_file),
               GUARDIAN_INCIDENT_FILE=str(incident_file),
               GUARDIAN_DRILL_FILE=str(workdir / "drills.json"),
               GUARDIAN_TRAINING_FILE=str(workdir / "training.jsonl"))
    server = subprocess.Popen(["node", str(ROOT / "tools" / "guardian-pilot-server.js")],
                              env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/status.json", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        else:
            print("FAIL  server never came up")
            sys.exit(1)

        def post(channel, series):
            body = json.dumps({"channel_id": channel, "feeds": feeds(series)}).encode()
            req = urllib.request.Request(base + "/ubibot", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.read().decode()

        def status():
            with urllib.request.urlopen(base + "/status.json", timeout=5) as res:
                return json.loads(res.read().decode())

        rules = status()["rules"]

        # drill 1: healthy sawtooth around set point
        reply = post("1001", sawtooth(6, 36.5, 2.0))
        check("the forwarding endpoint answers the way UbiBot expects", reply, "SUCCESS")

        # drill 2: 20-minute door blip to 48°F, otherwise 37
        post("1002", [(m, 48.0 if m <= 20 else 37.0) for m in range(360, -1, -15)])

        # drill 3: Cayden's example — 48°F held for the last 70 minutes
        post("1003", [(m, 48.0 if m <= 70 else 37.0) for m in range(360, -1, -15)])

        # drill 4: the slow creep — 43°F (over warn 41, under dispatch 45) for
        # longer than the recovery window
        creep_min = rules["fresh_food"]["recoverWithinMinutes"] + 30
        post("1004", [(m, 43.0 if m <= creep_min else 37.0) for m in range(600, -1, -15)])

        # drill 5: freezer defrost — a 35-minute spike to +28°F on a 0°F box
        post("1005", [(m, 28.0 if 100 <= m <= 135 else 0.0) for m in range(360, -1, -15)])

        # drill 6: the WiFi-kill drill — the sensor reported normally, then
        # went silent well past the offline hold.
        post("1006", [(m, 37.0) for m in range(420, 239, -15)])
        # drill 7 (1007): never reported at all — a sensor still in the box.

        rows = {r["channelId"]: r for r in status()["sensors"]}
        check("a healthy sawtooth stays OK", rows["1001"]["tier"], "ok")
        check("a 20-minute door blip does not page anyone", rows["1002"]["tier"], "ok")
        check("Cayden's 48°-for-an-hour example DISPATCHES", rows["1003"]["tier"], "dispatch")
        check("...and the reason names a rule",
              bool(rows["1003"]["reason"]), True)
        check("the creep that never recovers DISPATCHES without touching 45°F",
              rows["1004"]["tier"], "dispatch")
        check("...specifically via the recovery rule",
              "recover" in rows["1004"]["reason"].lower(), True)
        check("a freezer defrost spike stays OK", rows["1005"]["tier"], "ok")
        check("a sensor that went silent past the hold reads OFFLINE", rows["1006"]["tier"], "offline")
        check("a sensor still in the box reads WAITING, not an incident",
              rows["1007"]["tier"], "waiting")
        check("Celsius input was judged in Fahrenheit (latest ≈ 48°F)",
              abs(rows["1003"]["latest"] - 48.0) < 0.2, True)
        check("the rules served are the product's own (warn at the FDA line)",
              rules["fresh_food"]["maxF"], 41)

        incidents = status()["incidents"]
        tiers_logged = {(i["channelId"], i["tier"]) for i in incidents}
        check("the dispatch drills were logged as incidents",
              ("1003", "dispatch") in tiers_logged and ("1004", "dispatch") in tiers_logged, True)
        check("the offline sensor was logged as an incident", ("1006", "offline") in tiers_logged, True)
        check("no incident was ever filed for the healthy or door sensors",
              not any(c in ("1001", "1002", "1005", "1007") for (c, t) in tiers_logged), True)

        # recovery: the no-cool fridge comes back into band -> a recovery
        # transition is logged, so a drill sheet can time it. (Offset minute
        # marks + a pause: UbiBot timestamps carry second resolution, and a
        # same-second repost would collide with the earlier series.)
        time.sleep(1.5)
        post("1003", [(m, 37.0) for m in (52, 37, 22, 7)])
        rows = {r["channelId"]: r for r in status()["sensors"]}
        check("a recovered sensor returns to OK", rows["1003"]["tier"], "ok")
        recovered = [i for i in status()["incidents"] if i["channelId"] == "1003" and i["tier"] == "ok"]
        check("...and the recovery itself is on the incident log", len(recovered) >= 1, True)

        # drill 8: LABELING — the lab-notebook side of the showroom drills.
        def post_json(url, payload):
            body = json.dumps(payload).encode()
            req = urllib.request.Request(base + url, data=body,
                                         headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=5) as res:
                    return res.status, json.loads(res.read().decode())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read().decode())

        code, body = post_json("/drill", {"channelId": "1001", "mode": "fan dead"})
        check("a junk drill mode is refused (labels stay canonical)", code, 400)
        code, body = post_json("/drill", {"channelId": "9999", "mode": "no_evap_fan"})
        check("a drill on an unknown channel is refused", code, 400)
        code, body = post_json("/drill", {"channelId": "1001", "mode": "no_evap_fan",
                                          "note": "fan connector pulled, showroom unit 3"})
        check("a drill starts with a canonical mode", code, 200)
        code, body = post_json("/drill", {"channelId": "1001", "mode": "door_open"})
        check("a second drill on the same sensor is refused until the first ends", code, 409)

        time.sleep(1.2)
        post("1001", [(0.0, 50.0), (-0.5, 51.0)])  # readings DURING the drill
        with urllib.request.urlopen(base + "/export.jsonl", timeout=5) as res:
            exported = [json.loads(l) for l in res.read().decode().strip().split("\n")]
        labeled = [r for r in exported if r["channelId"] == "1001" and r["mode"] == "no_evap_fan"]
        healthy = [r for r in exported if r["channelId"] == "1001" and r["mode"] == "healthy"]
        check("readings during the drill export with the drill's label", len(labeled) >= 2, True)
        check("the sensor's pre-drill sawtooth exports as healthy", len(healthy) > 10, True)

        code, body = post_json("/drill/end", {"channelId": "1001", "note": "fan reconnected, recovered"})
        check("ending the drill returns the completed record", code, 200)
        check("...with start and end times for the drill sheet",
              body["drill"]["startedAt"] < body["drill"]["endedAt"], True)
        code, body = post_json("/drill/end", {"channelId": "1001"})
        check("ending twice is refused", code, 404)

        # an incident that fires during a drill is stamped with the mode.
        # 1007 has no prior readings, so the induced curve arrives clean.
        code, body = post_json("/drill", {"channelId": "1007", "mode": "no_compressor"})
        check("a drill starts on the fresh sensor for the incident-stamp check", code, 200)
        time.sleep(1.2)
        post("1007", [(m, 50.0 if m <= 75 else 37.0) for m in range(360, -1, -14)])
        stamped = [i for i in status()["incidents"]
                   if i["channelId"] == "1007" and i["tier"] == "dispatch"]
        check("the dispatch during the drill happened", len(stamped) >= 1, True)
        check("...and the incident is stamped with the drill mode",
              stamped[0].get("drill"), "no_compressor")
        post_json("/drill/end", {"channelId": "1007"})

        with urllib.request.urlopen(base + "/drills", timeout=5) as res:
            drill_state = json.loads(res.read().decode())
        check("the drill log holds both completed drills", len(drill_state["history"]), 2)
        check("the mode list is published for the drill sheet",
              "failed_defrost" in drill_state["modes"], True)

        with urllib.request.urlopen(base + "/export.csv", timeout=5) as res:
            csv_text = res.read().decode()
        check("the CSV export leads with its header",
              csv_text.startswith("t,channel_id,label,kind,temp_f,mode"), True)
        check("the CSV carries the drill label too", ",no_evap_fan" in csv_text, True)

        # the status page renders
        with urllib.request.urlopen(base + "/", timeout=5) as res:
            page = res.read().decode()
        check("the status page names every drill sensor",
              all(label in page for label in ["drill fridge healthy", "drill fridge silent"]), True)
        check("the status page states the rules it judges by", "no recovery in" in page, True)
        check("the status page explains the drill workflow", "/drill/end" in page, True)
    finally:
        server.terminate()
        server.wait(timeout=5)

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S) of {checks} checks")
        sys.exit(1)
    print(f"ALL {checks} PILOT SERVER CHECKS PASSED")


if __name__ == "__main__":
    main()
