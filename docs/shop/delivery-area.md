# Delivery area and fees by ZIP

*Added 11/19. Andrew: "Can you give us the ability to edit the delivery fee in the online shop tool in agility by ZIP? There's an artifact with all ZIPs within 150 miles, but we can't deliver for a flat fee that far out."*

## Two lists

| List | Where it is edited | What it means |
| --- | --- | --- |
| **Express area** | Online Shop Orders, "Delivery ZIP codes" (unchanged) | Order online and pick a delivery date. |
| **Total delivery area** | Online Shop Orders, "Delivery area and fees by ZIP" (new) | Everywhere Wilson can deliver at all, each ZIP with its city, county, miles and its own fee. |

**A ZIP on the total list with a fee is in the delivery area. A ZIP with no fee is only waiting for one, and is not offered delivery.** So the whole 150-mile list can be loaded without committing to deliver anywhere: nothing is offered until a fee is set.

## Loading the list

Open the spreadsheet, select the rows with the header row, copy, paste into the box, and press **Add / update from paste**. The columns are found by their header names, in any order: ZIP, City, County, Miles (or Distance), Fee. A column that is missing is left alone.

Pasting again never wipes a fee, a city or a mileage that is already stored. A blank cell means "leave it".

Without a header row only the ZIP is read from each line, plus a fee if it is written with a dollar sign.

## Setting fees

Filter the list (find by ZIP, city or county; a range of miles; no fee yet / has a fee; inside or outside the express area), then **Set fee** applies one fee to every ZIP shown. That is how a distance band gets its fee: filter 25 to 50 miles, set the fee, move to the next band.

- **Take the fee off** leaves the ZIPs on the list and stops offering delivery there.
- **Remove from the list** deletes them.
- Clicking one ZIP's fee changes just that ZIP.
- **Export CSV** saves what is shown.

Every change is recorded in the audit log with who made it.

## What the shop does with it today

Nothing a shopper can see. Checkout, delivery fees and the ZIP gate work exactly as before. The server can already answer, for any ZIP, whether it is express, in the wider area (with its fee) or outside both; the ZIP check adds that answer for the storefront step below.

## Next: the storefront (not built yet)

Andrew, 11/19: drop the ZIP gate at the door and keep the check for the transaction.

| ZIP is | The shopper |
| --- | --- |
| Express | Orders online and picks a date, as today. |
| In the total area only | Checks out with that ZIP's fee; Wilson schedules the delivery by hand. |
| Outside both | Cannot check out. Call or Text Us. No pickup checkout either (people check out and ask for UPS). |

Plus a "do we deliver to you?" ZIP tool on the shop and product pages.

Still to decide before that is built: whether a fee set here for an **express** ZIP replaces the standard express delivery fee, or express keeps its own.

## For developers

- `lib/shop-delivery-zips.js`: `parseDeliveryZipPaste(text)`, `deliveryAreaFor(zip, { expressSet, deliveryMap })`, and the storage (`shop_delivery_zips`: zip, city, county, miles, fee).
- `server.js`: `shopDeliveryArea(zip)`; `GET /api/shop/delivery-zips`, `POST .../import`, `.../fee`, `.../remove` (Shop Orders permission); `POST /api/shop/zip-check` now also returns `area` and, for the wider area, `fee`. `allowed` is still the express answer.
- `shop-orders.html`: the `dzCard` section.
