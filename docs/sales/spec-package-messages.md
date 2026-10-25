# Spec Packages — Email / Text, Quick Send or Custom

Added 2026-10-23 for the sales team (Andrew): after a spec package is created, **Review & send** now starts with two buttons, **Email** and **Text**. Each opens its own panel with two modes:

- **Quick Send (template)** — sends the standard message. The box is folded away by default (Andrew 10/25: keep Quick Send uncluttered); **See template** unfolds it read-only.
- **Custom message** — unlocks the box, pre-filled with that same template, so you can rewrite it before sending. **Reset to template** puts the standard wording back. Switching back to Quick Send drops the edits.

## Email

Recipient (myself / client / both / other) and the attachment checkboxes work as before. The subject stays `Specification Documents from Wilson AC & Appliance` and the attachments are whatever is ticked — only the body is editable (up to 5,000 characters, sent as plain text).

## The templates (Andrew 10/25)

Short and personal, same opening for both channels:

> Hi *client first name*, this is *user first name* with Wilson AC & Appliance. Here are the spec sheets for your project at *street number street name*.

The text adds the Steel Cod link after it; the email signs off with the user's full name and `Wilson AC & Appliance · 512-894-0907`. The project address is the first line of the form's address field (up to the first comma) — the quote / sales-order number is never used. The user's first name comes from the salesperson email on the form (matched to Users); the client's from the client / project name.

## Text

New. A text can't carry a PDF, so it sends the **public Steel Cod link** from the showroom number through Podium (replies land in Podium like every other Agility text). Choose which link: **View package (full)**, **Slim package**, or the **Customer Q&A page**. The client's mobile is pre-filled from the form. The merged quote + specs PDF lives behind an Agility login and is email-only.

The link always stays in the text: if a custom message is edited so the link is gone, the server adds it back at the end. Limit 1,000 characters; the counter shows how many SMS segments the message will take.

Nothing is sent without a click; both channels audit who sent what (`spec_package_emailed` / `spec_package_texted`, with `mode: template|custom`).

## Routes

- `POST /api/spec-packages/:navId/message-templates` — preview both templates for the page (body: salesOrder, contents, variant, link, customerName, salespersonEmail).
- `POST /api/spec-packages/:navId/email` — as before, plus optional `customBody`.
- `POST /api/spec-packages/:navId/text` — `phone`, `link` (open|slim|ask), `salesOrder`, `customerName`, `salespersonEmail`, optional `customBody`. Needs Podium connected (Text Automations).

Templates live in `server.js` next to the routes (`specPackageEmailTemplate`, `specPackageTextTemplate`) — one source for the preview and the send.
