# Install Damage Report — handoff for Andrew

Jack asked for this: a mobile form installers use in the field the moment they notice damage on a unit they're installing. It's built and tested — Jack's confirmed the camera and photo capture work on both Android and iPhone. What's left is backend wiring and hosting it somewhere permanent. This doc has everything needed to do that, written so it can be handed straight to a coding agent (Claude Code or otherwise) as a task brief.

## The file

`Install_Damage_Report.html` (attached alongside this doc) — one self-contained file, no build step, no framework, no dependencies besides a Google Fonts link. Everything that needs backend wiring lives in one `CONFIG` object near the top of the `<script>` tag — search the file for `const CONFIG`. Nothing else in the file should need to change.

## Definition of done

- [ ] The file is hosted at a permanent URL on Wilson's own infrastructure — not a temporary preview link — that installers can bookmark or that's linked from wherever they already access work tools on their phones.
- [ ] Typing a sales invoice number on the form pulls that job's customer name, address, and unit(s) from the daily EPass import, without the installer retyping anything.
- [ ] Submitting a report creates an entry in the Service Request Queue (the same dashboard customer-generated requests land in).
- [ ] Submitting a report also sends an email — with the tag photo and damage photo(s) attached — to **service@wilsonappliance.com**.
- [ ] Tested end to end on an Android phone and an iPhone: camera opens automatically on the photo steps, a report submitted with no signal saves and sends once back online.

## Architecture: one backend service, three responsibilities

The form itself has zero backend of its own — it's static HTML/CSS/JS. It expects a small service (a serverless function, a lightweight API, whatever's easiest in Wilson's existing stack) that does three things. All three are independently optional via blank/set CONFIG values, so this can ship in stages rather than all at once.

### 1. Invoice lookup — reads from the daily EPass import

```
GET {LOOKUP_URL}?invoice=SV00123145
```

Expected response:

```json
{ "found": true,
  "customerName": "Jay Bajaj",
  "address": "226 Artesian Springs Circle, Driftwood, TX 78619",
  "units": [
    { "applianceType": "Dishwasher", "model": "DW2450", "serial": "20107319" }
  ] }
```

or `{ "found": false }`.

This just needs a thin "look up by invoice number" wrapper in front of wherever the daily EPass import lands (DB table, JSON blob, whatever the import process already produces). If the request errors, times out (8s client-side), or the invoice isn't found, the form automatically falls back to manual entry — installers are never blocked by a bad number or the lookup being down.

### 2. Submit — writes the Service Request Queue entry

```
POST {SUBMIT_URL}   (multipart/form-data)
```

Fields sent (see `buildFormData()` in the script for the literal code):

| Field | Notes |
|---|---|
| `invoiceNumber` | as typed |
| `jobSource` | `"lookup"` or `"manual"` |
| `installer` | installer's name |
| `customerName`, `address` | from lookup or typed manually |
| `applianceType` | one of the 12 categories in the form (see `APPLIANCE_TYPES` in the script) |
| `issueType` | Dent / Scratch / Crack / Missing part / Electrical-wiring / Water damage / Won't power on / Functions incorrectly / Other |
| `damageLocation` | a side (Top/Left/Front/Right/Back/Bottom/Control panel/Interior), optionally refined to a 3×3 spot, e.g. `"Front — Top Right"` — handy for large fronts like 48" refrigerators |
| `problem` | free-text description |
| `tagPhoto` | file — photo of the model/serial tag |
| `damagePhotos` | file, repeated — 1 required, up to 3 |

This is what should create (or update) the entry in the Queue. Open questions for whoever owns that dashboard: what status a new install-damage entry should default to (there's no card/payment step here, unlike customer-submitted requests), and whether `damageLocation`/`issueType` map to existing columns or need new ones.

Optional: set `SUBMIT_AUTH_HEADER` in CONFIG if this endpoint needs an `Authorization` header.

### 3. Email a copy to service@wilsonappliance.com

**Simplest approach — recommended:** have the same `SUBMIT_URL` backend send this email itself as part of handling the submission (one request from the form, one write to the Queue, one email out). In that case, leave `EMAIL_ENDPOINT_URL` blank in CONFIG — it's not needed.

Send an email to `service@wilsonappliance.com` with:
- Subject like `Install damage — {customerName} — {invoiceNumber}`
- Body: the problem description, issue type, damage location, appliance, address, installer name
- The tag photo and damage photo(s) attached as files

Any transactional email API works for this (SendGrid, Postmark, AWS SES, Mailgun — whichever's already in use or easiest to set up takes an API key and sends attachments in a few lines). If Wilson's email runs through Google Workspace or Microsoft 365, an SMTP relay from either works too. Wilson also already has Podium for customer messaging, which has an attachment-send API — usable here instead if preferred, but it needs an OAuth relay since its credentials can't sit in a public HTML file, which is more setup than a plain transactional email call for what's ultimately just "email this inbox."

**Only if the email needs to go out independently of the Queue write** (e.g., a different service owns it, or the email should keep flowing even if the Queue integration breaks) — build it as its own endpoint and set `EMAIL_ENDPOINT_URL` to it. Same POST, same fields as `SUBMIT_URL`. If both `SUBMIT_URL` and `EMAIL_ENDPOINT_URL` are set, the form calls both, independently, on every submit.

## Behavior already built into the form (no backend needed for these)

- **Test mode**: with all three CONFIG values blank, the form is fully usable — lookups fall back to manual entry, submissions are simulated and logged to the browser console. Useful for confirming a deploy works before any backend exists.
- **Offline handling**: if a delivery fails (no signal, endpoint down, wrong URL), that specific delivery is saved on the installer's phone and retried automatically once possible. A target that already succeeded isn't re-sent to.
- **Photos**: compressed client-side (resized, ~70% JPEG quality) before upload, and corrected for orientation (phones store rotation as metadata rather than rotating pixels — this reads that and fixes it) so photos come out right-side-up and fast to send on weak signal.
- **Auto-camera**: the camera opens automatically when an installer lands on a photo step that's still empty.

## Hosting

The form needs a real, permanent URL — not a preview link — since installers will use this daily. A few options, roughly in order of "least new infrastructure":
- A static page on whatever already serves Wilson's internal tools/dashboard (same server, a new route).
- A page embedded in or linked from the internal dashboard app itself.
- A static host (Cloudflare Pages, Netlify, Vercel, S3+CloudFront) if there's no existing static-hosting setup — this file needs nothing more than "serve this HTML file," no server-side rendering.

Whichever it ends up at, that's the link that goes to installers (a QR code taped near where trucks get loaded, a bookmark, a link in whatever messaging app the crew already uses).

## Acceptance test

Once wired up:
1. Open the live URL on a phone.
2. Type a real (or test) invoice number from the daily EPass import — confirm the right customer/unit(s) show up.
3. Take the tag photo and a damage photo — confirm the camera opens on its own, both photos preview correctly, right-side-up.
4. Pick an issue type, tap a side then a grid spot, write a problem description, submit.
5. Confirm: the entry appears in the Service Request Queue, and the email with both photos attached lands in service@wilsonappliance.com.
6. Repeat once in airplane mode — confirm the app shows "saved, will send once you're back online," and it actually sends after reconnecting.
