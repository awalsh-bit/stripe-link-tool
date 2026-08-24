# Testing the field technician tool on a phone

Companion to `README_FIRST.txt`, focused on the technician workflow. Everything
below is verified against v0.9.2 by `_qa/smoke_browser.py`, which drives the
field tool at 390x844 (iPhone 14/15 logical size).

---

## 1. Start the server on the Windows machine

Double-click `OPEN_WILSON_PORTAL.bat`. Leave the black window open — it prints
two addresses:

```text
Computer: http://127.0.0.1:8080/index.html
Phone (same Wi-Fi/LAN): http://192.168.x.x:8080/index.html
```

The port is whichever is free between 8080 and 8090, so read it from that window
rather than assuming 8080.

If Windows Firewall prompts about Python, allow **Private networks only**. Never
port-forward this prototype.

If the phone cannot reach it:

- Confirm both devices are on the same Wi-Fi, not one on cellular.
- Guest and corporate Wi-Fi often isolate clients from each other. A phone
  hotspot that the PC joins is the most reliable test network.
- Windows Firewall may have silently blocked Python. Search "Allow an app
  through Windows Firewall", find Python, tick Private.

---

## 2. Go straight to a field visit

The field tool will not open without a visit ID — it refuses rather than
guessing a residence, so a technician can never be dropped into the wrong home.
Opening `tech-maintenance.html` bare shows "No maintenance visit was selected."

Two ways in:

**Through the UI (the real path):** open a household from Maintenance
Operations, then use **Launch appliance visit** in that household's Appliance
Maintenance section.

**Direct links (easier to type on a phone).** The demo visit IDs are seeded and
stable, so these work as-is — replace the host and port with what the black
window printed:

| What it exercises | URL path |
|---|---|
| 10 appliances, mixed protocols, Estate Preferred | `/tech-maintenance.html?visit=visit_davenport&household=hh_davenport` |
| 17 appliances, Estate **Concierge** — filters shown as included | `/tech-maintenance.html?visit=visit_reynolds_spring&household=hh_reynolds` |
| Single icemaker, IMUC-only scope | `/tech-maintenance.html?visit=visit_torres&household=hh_torres` |

Fastest way to get one onto the phone: text or email yourself the full URL and
tap it. Typing `192.168.x.x:8080/tech-maintenance.html?visit=visit_davenport&household=hh_davenport`
by hand on a phone keyboard is miserable.

---

## 3. The one thing that will confuse you

**The phone has its own separate demo data.** State lives in `localStorage`
under `wilson-maintenance-demo-v07`, which is per-browser and per-device. So:

- Work you complete on the phone does **not** appear on the desktop, and vice
  versa.
- Each device seeds its own fresh copy of the demo households on first load.
- This is a prototype artifact, not a design decision. In production the field
  tool writes to SQL Server (`MaintenanceFieldInspections`), so the office would
  see technician progress live. `MERGE_GUIDE.md` §7.3 and the v0.9 migration
  cover that layer.

To reset a device back to seeded data, clear site data for that host in the
phone's browser settings, or open the browser console and run
`localStorage.clear()` then reload.

---

## 4. What to actually check on the phone

The browser smoke test already covers layout, tap targets, protocol resolution,
readiness gating and report generation. What it **cannot** test is real hardware.
Focus your time here:

**Camera capture.** The serial-tag photo and checkpoint photo inputs carry
`capture="environment"`, so tapping them should open the rear camera directly
rather than a file picker. This only works on a real device.

- [ ] Serial-tag photo opens the camera, not the photo library
- [ ] Photo is accepted and the label changes to "✓ Serial tag captured"
- [ ] A checkpoint photo works the same way and stays optional

**One-handed use in a real posture.** You will be standing in front of an
appliance, likely holding a temp gun.

- [ ] Rating buttons 1–5 are hittable with a thumb (they render 65x56 px)
- [ ] "Mark performed" toggle is easy to hit without zooming
- [ ] The header does not stick and cover content while scrolling
- [ ] Reading fields bring up the numeric keypad, not the full keyboard

**Typing behaviour.** v0.8 fixed a bug where typing jumped the viewport to the
top. Verified in headless Chromium; confirm on real iOS Safari, which handles
focus and zoom differently.

- [ ] Typing an age or temperature does not scroll the page
- [ ] The field does not lose focus mid-number
- [ ] The page does not zoom in when a field is focused

**Interruption and resume.** Autosave fires ~450 ms after a change.

- [ ] Start an inspection, lock the phone, come back — work is still there
- [ ] Switch apps and return — same
- [ ] Kill the browser tab and reopen the visit link — draft is restored

**Sunlight and glare.** Not something a screenshot can tell you.

- [ ] Green-on-white status text is readable outdoors
- [ ] Pass / Monitor / Action colours are distinguishable at a glance

**Filter service banner** (Reynolds link, since they are Concierge).

- [ ] Refrigeration shows "Filter service included — Estate Concierge ·
      applicable water and air filters covered"
- [ ] A non-refrigeration appliance shows no filter banner at all

**End to end.**

- [ ] Complete every check on one appliance and generate the report
- [ ] Report opens and is readable on the phone
- [ ] Progress counters on the visit screen update

---

## 5. Known prototype limits while testing

- No authentication. "Signed in as Wilson technician" is a placeholder; real
  identity comes from the authenticated Wilson user (`MERGE_GUIDE.md` §12).
- Photos are held in browser memory only. Nothing is uploaded, and they will not
  survive a reset. Production photo storage is §20.
- Report PDFs use the browser's print dialog rather than server-side generation.
- HVAC has no field workflow yet, so HVAC visits do not enter this tool.
- Filter pricing shows **$70 per filter as a placeholder** pending Wilson's
  filter sales-price list.

---

## 6. Reproducing what the automated test does

```bash
python3 _qa/smoke_browser.py
```

It starts its own static server, drives enrollment and the field tool, and
asserts 41 behaviours including phone-viewport layout. It skips cleanly if
Playwright is not installed:

```bash
pip install playwright && playwright install chromium
```

`bash _qa/run_all.sh` runs it alongside the config, pricing and SQL checks.
