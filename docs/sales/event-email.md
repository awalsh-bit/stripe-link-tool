# Event email: up to 500 people, PDFs attached

*Added 11/18. Andrew: "Can you build me a 100 email address Resend tool for communicating events? We'd like to attach PDFs if possible." Addresses come from the event's roster plus any pasted in; anyone with Event RSVPs can send.*

*Changed 11/20. Andrew moved Resend to the Pro plan ($20 a month) and chose **500 per send** (the Customer Master fills a guest list 500 at a time). A full send of 500 takes about two minutes.*

## Using it

On **Event RSVPs**, open an event and press **Email guests**.

1. **To.** Tick people on the roster, or tick a status (Confirmed, Pending, Planned...) to take everyone in it. **Everyone with an email** takes the whole roster. Paste any other addresses in the box below the list: one per line or separated by commas, as `jane@example.com` or `Jane Doe <jane@example.com>`. Anything that isn't an address is named, and Send waits until it's fixed. Someone on the roster and in the pasted list counts once. The count beside **To** is the number of emails that will go: **500 at most per send**.
2. **Subject and message.** `{first name}` becomes each person's first name (from the roster, or from the name in front of a pasted address). With no name it is left out: "Hi {first name}," reads "Hi,". A blank line starts a new paragraph, and web addresses become links.
3. **The event's card** (on by default) adds the date and time, the place, and an **RSVP** button to the event's page, with the RSVP deadline. The button shows only once the event is published.
4. **PDFs.** Up to 5, 10 MB together. Only real PDFs are accepted.
5. **Preview** shows the email as the first person picked will see it. **Send me a test** sends one copy, marked [Test], to your own address.
6. **Send to N people**, then **Yes, send it** on the line that appears. The emails go out in the background, about four a second, so 100 take under half a minute and 500 about two minutes. The drawer shows the count as they go, and the list of people clears when it's done so a second click can't send it again.

## What a guest gets

Their own email (nobody sees anyone else's address), from `RESEND_FROM_EMAIL` ("Wilson AC & Appliance <no-reply@...>"). Replies go to the event's **contact email** when the event has one, otherwise to the person who sent it. The footer carries Wilson's address and phone and an **Unsubscribe** link. The email also carries the standard one-click unsubscribe headers, so Gmail and Apple Mail can show their own unsubscribe button.

## Unsubscribes

The link opens a page on service.wilsonappliance.com that asks first ("Stop event emails?"), because email scanners open links. The button, or a mail app's one-click unsubscribe, adds the address to `agility_email_optouts`. From then on every event email leaves that address out:

- On the roster it shows greyed, marked **unsubscribed**, and can't be ticked.
- A pasted address that unsubscribed is left out too; the send's record lists it as unsubscribed.

It covers event emails only. Order, payment, service and sign-in emails are not affected.

## Emails sent

Under the roster, **Emails sent** lists every send for the event: when, who sent it, the subject, how many went, and the PDFs (click to open). **Who got it** lists each person with sent, didn't go (with Resend's reason), or unsubscribed.

**Send to the N who didn't get it** sends the same message and the same PDFs to the ones that failed. It also covers the ones never tried, if a send was cut short by a restart. A restart never resumes a send by itself: the send shows **cut short**, and nothing more goes until someone presses the button.

## Limits worth knowing

- **Resend's plan (Pro since 11/20).** Wilson is on Resend Pro: **50,000 emails a month**, no daily limit. That covers everything Agility sends: sign-in emails, payment notices, spec packages, and these.
  - **Over 50,000 in a month:** Resend charges **$0.90 per extra 1,000** only if *Transactional Overages* is turned on in Resend's team settings. Resend's pages don't say clearly what happens with overages off, so check before a month that might pass 50,000.
  - **When Resend says a limit is used up**, the send stops at once and says so. The rest go later with **Send to the N who didn't get it**.
  - A *daily* stop would mean the account is back on the free plan (100 a day).
- **Keep bounces and spam reports low.** Resend asks for bounces under **4%** and spam complaints under **0.08%**, and can pause the whole account above that. A pause would also stop Agility's sign-in and payment emails.
  - Old ePASS addresses are the main bounce risk. Send the first big list to recent customers.
  - Bulk mail through this tool must go to people who expect Wilson's email. Every email carries its own unsubscribe link and the one-click unsubscribe headers, as Resend requires.
- Resend allows 10 requests a second for the whole account, whatever the plan. This tool keeps to about four, so the rest of Agility's email keeps flowing during a send.
  - Fixed 11/20: the two senders could start together and reach about eight a second.
  - A send of 500 with a large PDF moves more data and can take a little longer.
- Resend's batch endpoint can't carry attachments, so each person's email is its own request. Each request has an idempotency key: if the same request is retried, Resend sends it once.
- **Two minutes.** The same subject and message to the same event within two minutes is held back as a likely double click.

## Checked before delivery

The real `server.js` was run on a local test database against a stand-in for Resend (nothing was sent anywhere).

- **100-person send:** all 100 arrived, one person each. Each was personalized, with both PDFs byte for byte, the event contact as reply-to, its own unsubscribe link, and the one-click headers.
- **Rate limits and quota:** rate-limited requests were retried with the same idempotency key. A quota stop was followed by **Send to the rest**, and nobody got an email twice.
- **Restart:** a send cut short by a restart was marked as such and sent nothing until someone pressed the button.
- **Refused before anything was sent:** a missing confirm, 501 people (101 before 11/20), a non-address, a non-PDF, six PDFs, and no subject.
- **500-person send (11/20):** all 500 arrived, one person each, each with the PDF, in 125 seconds at a steady four a second.
- **Unsubscribe:** the link, the button and one-click all worked, and the next send left those people out.
- **Audit:** sends, tests, retries and unsubscribes all landed in `access_audit_log`.
- **Browser, desktop and phone:** picking by status, pasting, PDFs, preview, test, confirm, progress, the sent list and who got it.

## For developers

- `lib/event-email.js`: address parsing, recipient list, `{first name}`, the email (HTML and text), PDF checks, `resendSend` (Resend error names to stop / retry / fail) and `sendAll` (pacing, retries, idempotency keys `wilson-event-email-<recipient>-<attempt>`).
- `lib/event-email-postgres.js`: `agility_event_emails`, `agility_event_email_files` (the PDFs, kept for retries and the history), `agility_event_email_recipients` (status, Resend id, error, unsubscribe token), `agility_email_optouts`.
- `server.js`: `GET/POST /api/events/:id/emails`, `/emails/preview`, `/emails/test`, `/emails/:emailId`, `/emails/:emailId/files/:seq`, `/emails/:emailId/retry` (all behind the Event RSVPs grant). Public on the service host: `GET /email-preferences?t=`, `POST /api/public/email-unsubscribe`. `runEventEmail` sends in the background; on start-up, sends left mid-way are marked `interrupted`. Audit actions: `event_email_sent`, `event_email_test`, `event_email_retry`, `event_email_unsubscribed`.
- `RESEND_API_BASE` points the sender at a stand-in for local tests. Never set it on Render.
