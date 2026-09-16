# HVAC Quote Request Form — Handoff Spec

This replaces the Formsite-hosted HVAC quote form (`fs18.formsite.com/hmnK6N/HVACQuote`, embedded today at `wilsonappliance.com/hvac_quote_request`).

## What's attached

`hvacquote.html` — a self-contained front-end built to match `hvacservice.html`'s look, code style, and shared header/CSS/JS (`public-shell.css`, `public-shell.js`, logo, favicon). Drop it in the same directory as `hvacservice.html` and `applianceservice.html` on `service.wilsonappliance.com`.

It currently points at `https://service.wilsonappliance.com/public-shell.css` and `.../public-shell.js` with absolute URLs so it previews correctly anywhere; once it's living in that same folder, those can be switched to the relative paths the other pages use (`public-shell.css`, `public-shell.js`) — either works since it'll be same-origin.

I also added a "Request HVAC Quote" link into the page's own copy of the nav menu. That menu appears to be shared markup across all the service pages, so add the same link into whatever shared header/template you maintain so it shows up site-wide, not just on this one page.

## Fields (matches the old Formsite form 1:1)

First Name*, Last Name*, Street Address*, Address Line 2, City*, State* (defaults to Texas, like the HVAC service form), Zip Code*, Phone Number*, Email Address*, Gate Code (optional), "best way to communicate" (Text / Email / Phone Call)*, "how many systems" (One / Multiple), a Promo Code field, and a photo/video upload (up to 6 files — images get compressed client-side the same way the service form does; videos upload as-is).

## Backend contract needed (two endpoints, mirroring the existing service-form pattern)

### 1. `POST /api/quote/request-media`
Same shape as the existing `/api/service/request-photo` endpoint — accepts one file per call as multipart form data under the field name `media`, returns `{ id, token }` (or `{ error }` on failure). Called once per photo/video as the customer attaches it.

### 2. `POST /api/quote/submit-request`
JSON body:

```json
{
  "quoteRequest": {
    "requestType": "hvac-quote",
    "customerName": "Jane Smith",
    "firstName": "Jane",
    "lastName": "Smith",
    "customerEmail": "jane@example.com",
    "customerPhone": "512-555-1234",
    "serviceAddress": { "line1": "123 Main St", "line2": "", "city": "Dripping Springs", "state": "Texas", "zip": "78620" },
    "gateCode": "",
    "contactMethod": "Text",
    "unitCount": "One",
    "promoCode": "",
    "mediaRefs": [{ "id": "...", "token": "..." }],
    "notifyEmails": ["cmayfield@wilsonappliance.com", "vjones@wilsonappliance.com"]
  }
}
```

Response on success: `{ "success": true, "requestId": "..." }`. On failure: `{ "success": false, "error": "..." }`.

**What the endpoint should do:**

1. Validate/store the lead (wherever the HVAC service requests currently land — same database/table makes sense, just tagged `requestType: "hvac-quote"`).
2. Send a plain email notification to `cmayfield@wilsonappliance.com` and `vjones@wilsonappliance.com` with the lead details. This does **not** need Podium — Podium's API is built for messaging your customers (SMS/email tied to a Podium contact), not internal staff alerts, and using it would mean registering a Podium developer app and getting it OAuth-approved on the account. A normal transactional email call (whatever your backend already uses — SendGrid, Postmark, SES, nodemailer, etc.) is simpler and gets the same result. Suggested subject/body:

   > **Subject:** New HVAC Quote Request — {firstName} {lastName}
   >
   > New HVAC quote request submitted via wilsonappliance.com:
   >
   > Name: {firstName} {lastName}
   > Phone: {customerPhone}
   > Email: {customerEmail}
   > Address: {serviceAddress.line1} {serviceAddress.line2}, {serviceAddress.city}, {serviceAddress.state} {serviceAddress.zip}
   > Gate code: {gateCode}
   > Preferred contact method: {contactMethod}
   > Systems needed: {unitCount}
   > Promo code: {promoCode}
   > Photos/videos attached: {mediaRefs.length}
   >
   > Reference: {requestId}

3. Return `{ success: true, requestId }` so the form can show its confirmation screen.

## One thing worth a decision later

If down the line you'd rather leads show up *inside* Podium's own Inbox (so your team works them there instead of via email), that's a different, bigger lift — registering a Podium developer app and completing their OAuth flow. Happy to help with that when you're ready; for now the plain-email route gets this live fastest.

## Dashboard integration

Per the note that all new tools should eventually plug into `dashboards.wilsonappliance.com` — since this form already writes to whatever store the HVAC service requests use, it should show up there the same way once that pipeline exists. No extra work needed on the form itself for that.

---

## Folded into Agility — 2026-09-15

- `hvacquote.html` is served on `service.wilsonappliance.com` with the relative `public-shell.css` / `public-shell.js`; the hard-coded menu markup was replaced by the shared `#public-shell-header` mount, and "Request HVAC Quote" was added to the site-wide menu in `public-shell.js`.
- `POST /api/quote/request-media` — live. Images are stored like service-request photos; videos (any `video/*`, up to 25 MB) are stored as kind `video` in the same photo table and served behind the Agility login.
- `POST /api/quote/submit-request` — live. Validates server-side, writes the lead to the Service Request Queue as an **HVAC QUOTE** card (`requestType: "hvac-quote"`, no card step, promo code and system count on the card, photos and videos rendered), records an audit entry, puts a green flag on each recipient's dashboard, and sends the plain email (Resend) with the body from this spec plus a link to the queue.
- Recipients are decided on the server (`HVAC_QUOTE_NOTIFY_EMAILS` env, default `cmayfield@wilsonappliance.com, vjones@wilsonappliance.com`). The `notifyEmails` array was removed from the browser payload — a public page must never choose who gets emailed.
- The confirmation screen's reference number is the queue card id (`svc_…`), the same id the team sees on the queue.
