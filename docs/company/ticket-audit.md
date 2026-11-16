# Ticket Audit

*Added 11/16. Everything Agility has on file for one ticket, in the order it happened: the quote, the order, every payment, the delivery, the service work, any return and any refund. It grew out of the "What happened" list on Closed Service Estimates, widened from service tickets to every kind of ticket.*

**Accounting → Ticket Audit** (`ticket-audit.html`). Executives always have it. Anyone else needs it granted on the Users page; it's listed under both Accounting and Client Care. Holding it lets someone look. It does **not** let them refund: the Refund button only appears for people who also hold **Issue Refund**, and the refund itself goes through Issue Refund's own route, so that rule is enforced on the server and not just by hiding a button.

Issue Refund is still there and unchanged. Once this screen has earned its keep, the plan is to retire Issue Refund's page and leave only its refund routes behind this one.

## Looking a ticket up

One box takes either:

- **A number**: a service ticket (`SV00124641`), a sales order (`A0098765`), a quote (`Q0045121`) or a web order (`WEB-1042`). It matches however it's typed: lower case, without the leading zeros, with a sub-invoice on the end (`A0098765-1`).
- **Who it was for**: a name, a phone number or an email. That lists every ticket on file for them, newest first; click one to open it.

Digits on their own (`124641`) work when only one ticket has them. When a service ticket and a quote share the digits, the page asks which one. A web order that was entered in ePASS opens as its ePASS ticket, with the web order's own lines included. `ticket-audit.html?t=SV00124641` links straight to a ticket.

## What the page shows

**The header**: the number, what kind of ticket it is, how it stands (Open, Partly finished, Finished, Cancelled, Open quote, Converted), who it's for, and the facts ePASS and the service board hold today (status, scheduled date, unit, payment type, address). Links to related tickets: a quote's order, an order's quote.

**Money**: two sets of tiles, kept apart on purpose.

- *Through Agility*: collected, refunded and net. These are the card and bank payments Agility itself took, with exact times.
- *In ePASS*: what's posted on the ticket, the ticket's total as it stands today, and the balance while it's open.

They are two records of the same money, so the page says not to add them. If Agility has collected more than ePASS shows posted, a note says by how much. That is usually a payment that hasn't been keyed into ePASS yet.

**What happened**: one line per event, grouped by day in store time. Each line says where it came from (Agility, ePASS, Service board, Delivery). *Money only* trims the list to payments, refunds and returns. *Print* prints the ticket.

**Units on this order**: model, serial, which invoice, what it sold for, and a Returned flag. No cost or margin appears anywhere on this page.

**Where these lines come from**: folded away at the bottom. Lists each record the page checked and how many lines it gave, so "nothing on file" in a section reads as an empty record, not as something skipped.

## Where each line comes from, and how far to trust it

| Line | From | Carries |
|---|---|---|
| Service request submitted, card saved, ticket entered | The service request queue | Exact time, who |
| Payment link sent / cancelled, paid, saved card charged, card reader payment | Agility's payment records | Exact time, who, amount |
| Refunded | Agility's refund record | Exact time, who, reason code, the note |
| Estimate created, sent, opened, answered, closed, reopened | Service Estimate Approvals | Exact time, who |
| Service status changes | The service board's history | Exact time; who, or "automatic" |
| Web order placed, claimed, entered, cancelled | The online shop | Exact time, who |
| Added to a run, texts sent, truck arrived, delivered, exception | Delivery runs | Exact time, signature name, photo count |
| Quote marked sold / lost / follow-up | Quote Follow-Up | Exact time, who, the comment |
| Order or ticket written (while it is open in ePASS) | ePASS open orders | Exact time, who keyed it |
| Order or ticket last changed (while it is open) | ePASS open orders | Exact time, who. Not what changed, and only the last change |
| Finished, not posted yet | ePASS open orders | Exact time, who finished it |
| Quote written; order written, once the order is finished | ePASS | **Date only** |
| Posted in ePASS, paid back in ePASS | ePASS payments (about 13 months back) | **Date only**, payment type, who keyed it |
| Finished in ePASS (posted) | ePASS finished orders | **Date only** |
| Returned | ePASS return lines | The date its invoice finished, or only the month |
| Quote matched to this order | Quote Follow-Up's matching | The time the match was made |

Three things worth knowing:

1. **ePASS shows how an order stands today, not its history.** While an order is open, Agility receives the whole ePASS header every 15 minutes, so the page shows the time it was written and who keyed it, and the time it was *last* changed and by whom. ePASS doesn't keep what was changed, or any change before the last one, so the page can't say when a price moved. Once an order is finished and posted, Agility receives only its dates, and those lines say "date only". "Finished" is the day ePASS closed the invoice, normally the delivery or pickup day. An order ePASS has finished but not yet posted shows as *Finished, not posted*.
2. **A quote is tied to its order by matching** customer and salesperson, not by a record of the sale. The line says so. When a consultant marks a quote sold and names the order in Quote Follow-Up, that line is a person's statement and is the firmer of the two.
3. **A payment filed under the digits alone** (someone typed `98765` instead of `A0098765` in the order box) is still found, and the line says "filed under the number alone, with no letters". Under Repair Service a bare number is always read as the service ticket, the same rule Closed Service Estimates uses.

Refunds issued directly in Stripe's own dashboard, rather than from Agility, are not in Agility's refund record and won't show here.

## Checked against real ePASS rows (11/16)

The tool's own code was run on the laptop over the 200 real open invoices in `odbc/sample-open-invoices.csv` and against the real ePASS column list. All 200 numbers were recognised, no two tickets collapsed into one, every ticket got its customer, its written line and a total that matches ePASS's own columns. Three things were wrong and are fixed:

- ePASS writes "no date" as 1899-12-30. 13 of the 200 would have shown *Pickup date: Dec 30, 1899*. Any date before 1990 is now read as blank.
- 7 of the 200 were *Not Posted* (finished in ePASS, waiting to be posted) and were shown as Open. They now read *Finished, not posted*, with the time and who finished them.
- A balance below zero (paid beyond the total) read "-$x still owed". It now reads as a credit.

It also showed the first version undersold ePASS: the open-order rows carry the time written, who wrote it, and who last changed it and when. The page said "date only" for those. It now shows them.

Not checked this way, because none of it is on the laptop: service tickets, quotes, payments, deliveries and everything in the live database. The real sample is open sales orders only.

Known gaps that would need more data from ePASS, not more code here: ePASS has a returns table (`InvoiceReturns`: date, time, who, reason code, outcome) that the pull doesn't send, so returns here come from the commission lines and carry no reason; and the finished-orders pull already sends who wrote and who finished each order, but Agility doesn't keep those two columns.

## Refunding from this page

For people who hold Issue Refund, each Agility payment line has a **Refund…** button. It opens the same form as Issue Refund, with the same rules:

- It first asks Stripe what is still refundable on that payment and shows it.
- The amount starts at 0.00 and has to be typed. It can't exceed what's refundable.
- The note has to name the product or service ("KDTS434SPS dishwasher returned"). "Refund" or "customer request" is refused.
- A reason code is suggested from the note and can be changed.
- The box acknowledging that a refund **cannot be reversed** has to be ticked before Submit works.

After a refund the ticket reloads and the refund is the newest line. Nothing is sent to the client by this page.

## If something can't be read

If Agility can't read one of its records when a ticket is opened (the payment links, say), the rest of the ticket still loads and a red line names what's missing, so a ticket never just looks complete when it isn't. Look it up again a minute later.

## For developers

- `lib/ticket-audit.js`: `ticketKey` (one spelling per ticket), `dayOf` (any ePASS date to YYYY-MM-DD; before 1990 is blank), `storeInstant` (an ePASS date and clock time, which are store time with no zone, to an instant), `collectTicketRecords` (reads every table for a ticket; names any it couldn't read in `unread`), `buildTicketAudit` (pure: records plus the Agility ledger lines in, header / money / timeline out), `searchTicketRecords` and `mergeTicketHits` (by name, phone or email).
- `server.js`: `buildTicketStoryLookup()` now also returns `.audit(ticket)` (the ledger lines for any ticket, with the Stripe payment behind each paid line), `.search(query)` and `.unread`. Closed Service Estimates still calls it the old way and gets exactly what it got before. Routes: `GET /api/ticket-audit/search?q=` and `GET /api/ticket-audit/ticket/:number`, both behind the Ticket Audit page.
- `lib/service-estimates-postgres.js`: `listServiceEstimatesForTicket`.
- No new tables. Reads only: `sj_jobs`, `sj_status_history`, `service_estimates`, `epass_open_orders`, `epass_open_service`, `epass_service_history`, `sales_order_detail`, `open_sales_orders`, `sales_order_lines`, `epass_payments`, `epass_payment_types`, `epass_sold_serials`, `quote_followup_quotes`, `quote_followup_dispositions`, `shop_orders`, `delivery_stops`, `delivery_runs`, `epass_customers`. Cost and profit columns are never selected.
