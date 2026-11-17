# Secret Menu: inventory on each card

*Added 11/17.*

Each item on the Secret Menu's hand-kept list now shows an **Inventory** line under *Required*:

> **3 available to sell** · 5 on hand (2 spoken for)

- **Available to sell** is the number a salesperson can promise today. It is the same number as **ATS** in Inventory Lookup: units of serial type ALL that are not reserved to an order and not on hold.
- **On hand** is every unit of that model in the building.
- **The bracket** says what the other units are: spoken for, likely available (written to an order more than 60 days out), open box, display, or exclusive reserve. It only appears when there is something to say.
- **None on hand** when ePASS has no unit of the model.

The line is green when there is something to sell and red when there isn't. A note under the filters gives the time of the ePASS inventory snapshot the counts came from.

Everyone who can open the Secret Menu sees the line. It is counts only: no cost, no serial numbers, no customer names. For which order a unit is spoken for, open the model in Inventory Lookup.

If the inventory snapshot can't be read, the cards show no Inventory line at all, so a blank is never mistaken for "none on hand".

## Not covered

Promo Item Builder cards don't get this line. They already check their units against ePASS and flag a card when one is spoken for or gone.

## For developers

- `server.js`: `secretMenuStock(models)` reads `getInventoryIndex()` (the Inventory Lookup index, memoized five minutes) and returns `{ onHand, ats, openBox, spoken, likely, display, exclusive }` per model key. `GET /api/secret-menu`, old-list mode, puts it on each item as `stock` and sends `_meta.stockAsOf`.
- `secret-menu.html`: `stockLineHtml(item)` and `renderStockAsOf(asOf)`.
