# Express shop: the "On display" flag

*Added 11/17.*

A shop tile says **On display in Dripping Springs** when a display unit of that model is on the Dripping Springs showroom floor, so a shopper knows they can come and see one. The product page for the model says it too.

## Which models get the flag

A model is flagged when the ePASS feed has a unit of it that is:

- serial type **DISPLAY**,
- **not written to an order** (a sold display is on its way out), and
- at a **location** listed in `data/shop-on-display.json` (and, if that file lists any **bins**, in one of those bins).

Every tile of a flagged model carries the flag: the sealed one and an open box one alike. The floor model's own outlet tile doesn't repeat it; it already says Floor Model.

With no location and no bin listed, no model is flagged. The shop never claims a display it can't place.

## The settings file

`data/shop-on-display.json`:

- `locations`: the ePASS location codes that are the Dripping Springs showroom floor. Set to `04`.
- `bins`: optional. Bin codes, when the location code alone isn't enough to tell the floor from the back.
- `label`: the wording on the tile.

Codes are matched without regard to capitals, and a code that is all digits matches with or without its leading zeros. The location and bin of any unit are shown on its row in Inventory Lookup.

## For developers

- `server.js`: `shopOnDisplayModelKeys(snapshot, cfg)` reads the feed's on-hand serials; `computeShopCatalogFresh` sets `onDisplay` on every unit of a flagged model; `GET /api/shop/catalog` sends `onDisplay` per unit and `onDisplayLabel`; `GET /p/:model` passes `onDisplay` to the product page.
- `shop.html`: the `.item-display` line under the tile's category line.
- `lib/shop-product-page.js`: one line in the list under the button.
