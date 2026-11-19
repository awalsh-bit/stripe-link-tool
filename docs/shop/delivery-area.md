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

## What the shop does with it

*Andrew, 11/19: "The delivery fee we set should override. Let's get rid of the discount that's hard coded and I'll build promo codes for free delivery later." Then: drop the ZIP gate at the door and keep the check for the transaction.*

**There is no gate at the door any more.** Anyone can come in and browse. The ZIP is asked where it decides something:

- **"Do we deliver to you?"** A one-line ZIP box above the Top deals on the shop, and under Add to cart on every product page. It answers in a sentence and remembers the ZIP in that browser tab, so the cart starts from it.
- **The cart.** Before the delivery and pickup options, the cart asks "What's your ZIP code?". Pressing Continue without one lights the box up. Until there is a ZIP, the delivery fee shows "set by ZIP code" and is left out of the total.

What the ZIP decides:

| ZIP is | The shop says | The cart offers |
| --- | --- | --- |
| On the express list | "Yes, we deliver to 78620. White Glove Delivery + Haul Away is $49.95, and you choose your delivery day at checkout." | Delivery with a day to pick, or Customer Pickup, as before. |
| On the total list with a fee, not express | "Yes, we deliver to 78205. White Glove Delivery + Haul Away is $189.00. Order online and we will follow up via your preferred communication method to schedule your delivery day." | Delivery at that ZIP's fee with **no day to pick** ("We will follow up via your preferred communication method to schedule your delivery day."), or Customer Pickup. |
| Neither | "We can't take online orders for 10001. Call 512-894-0907 or Text Us and we'll help you from there." | No delivery, no pickup, no checkout. **Call** and **Text Us** buttons sit where checkout would be. A pricing request for special-order items is refused too. |

- **The fee follows the ZIP.** A fee set here is what the shop charges for delivery to that ZIP, in the express area too. An express ZIP with no fee here pays the standard fee, $49.95 (`SHOP_DELIVERY_OFFER.price` in `server.js`). The struck-through $89.95 and the "special online offer" wording are gone; free-delivery promo codes still work, in either area.
- **A delivery goes to the saved address**, and the server prices and judges it by that address's ZIP. If the cart's ZIP and the saved address's differ, checkout first asks for the delivery address in the cart's ZIP.
- **A pickup is judged by the ZIP the shopper gave in the cart** (else the saved address's). Outside both areas, pickup is refused too.
- **A delivery address can now be saved anywhere in the total area** (it used to be express only). An address outside both areas is refused with the call-or-text message.
- **Wider-area orders on Online Shop Orders** carry a yellow **Schedule by hand** tag, and the delivery line says the ZIP is outside the express area and no day was picked: reach the client by their preferred contact method to set the day. The new-order flag on the floor's dashboards says the same.

*Changed 11/20. Andrew: "Instead of call - 'we will follow up via your preferred communication method'".* The shop no longer promises a phone call for wider-area deliveries. The ZIP answer (shop and product pages), the cart's delivery option, the checkout summary ("we'll follow up to schedule") and the order confirmation all say Wilson will follow up the way the shopper asked to be contacted. The order card and the new-order flag tell staff the same.
- The server applies every one of these rules itself at checkout. The pages only keep in step with it.

To change what express customers pay: filter "In the express area", then Set fee.

## For developers

- `lib/shop-delivery-zips.js`: `parseDeliveryZipPaste(text)`, `deliveryAreaFor(zip, { expressSet, deliveryMap })`, and the storage (`shop_delivery_zips`: zip, city, county, miles, fee).
- `server.js`: `shopDeliveryArea(zip)`; `GET /api/shop/delivery-zips`, `POST .../import`, `.../fee`, `.../remove` (Shop Orders permission); `POST /api/shop/zip-check` returns `{ zip, allowed, area, fee, name }` (`allowed` is still the express answer). `shopCheckoutZip` / `shopZipBlock` / `shopCheckoutBlock` are the checkout rules (setup-intent, submit-order; `shopZipBlock` also on submit-quote). `priceShopCart` prices a wider-area delivery with `date: null, manualSchedule: true, area: "extended", zip` and `totals.deliverySchedule: "call"`. The catalog sends `deliveryArea: { zip, area, fee, fromAddress }` and `fulfillment.callToScheduleNote`.
- `shop.html`: the `zipStrip` form and the cart's `czForm`; `applyZipInfo` / `setZip` / `zipAnswerHtml`. The fulfillment payload carries `zip`.
- `lib/shop-product-page.js` + `data/product-pages/template.html`: the product page's `zipBox` (buy mode only).
- `shop-orders.html`: the `dzCard` section, and the `Schedule by hand` tag on an order whose `delivery.manualSchedule` is set.
