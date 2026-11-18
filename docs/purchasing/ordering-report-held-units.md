# Ordering Report: units held for a service ticket

*Fixed 11/17.*

## What was wrong

The gear on a line read **1 on hand** in green when the only unit in the building was held for a service ticket. Reported on PBN-1000A: sales order S00065084 showed green while serial 0001 was ordered for SV00121761.

The report learns which tickets are open from the sales feed, which carries sales tickets only. A unit "ordered for" a service ticket matched nothing there, so it was counted as free to rotate and covered the sales line.

## What the report does now

A hold stands unless a feed can show its ticket has closed.

- **Ordered for an open sales ticket:** held for it, as before.
- **Ordered for a sales ticket that has closed:** free, as before.
- **Ordered for an open service ticket:** held. The position shows the ticket number, its customer, date and status.
- **Ordered for a service ticket that has closed:** free.
- **Ordered for any other kind of ticket, or the open service tickets can't be read:** held, shown as *Ticket not in the feed*.

So the PBN-1000A line now reads *1 on hand · 1 spoken for · short 1*, and is no longer green.

The report is rebuilt each time the ePASS sales feed arrives, so the change shows on the first pull after the push.

Inventory Lookup, the Express shop and the Secret Menu were not affected. They already check a unit's ticket against both the sales and the service feed.

## For developers

- `lib/written-models.js`: `parseWrittenModelsFromEpass(bundle, { serviceTickets })`; `heldOutside(code)` decides a hold by a ticket the sales bundle doesn't carry.
- `lib/epass-open-orders-postgres.js`: `openServiceTicketHolds()` reads code, customer, date and job status from `epass_open_service`.
- `server.js`: the `epass-open-orders` upload passes the open service tickets to the parser.
