# Promo codes and their ePASS misc codes

*Added 11/19. Andrew: "for promo codes, I need to apply a specific ePASS misc code, can you grab anything that looks like a discount or promo from the list - they are all netsuite service items for sale too"*

Promo codes are managed on **Online Shop Orders → Promo codes**. A shopper types the code in the cart, and the discount shows on the order summary, the checkout and the filed order. Percent and dollar codes come off the appliances only. **Free delivery** waives the delivery fee.

## The ePASS misc code

Every promo code names the **ePASS misc code** the office keys on the ticket for its discount, for example `DISCOUNT 4`, `JENINFLUENCER20` or `SZ-WOLF-REMODEL`.

- **Required for new codes.** **Add code** waits until one is picked.
- **Codes made before 11/19** show **No ePASS misc code** and a **Set ePASS code** button. They keep working (they can still be paused or re-limited) until one is set.
- **Checked against ePASS.** The code has to be in ePASS's misc list as it came through the feed. Typos and codes marked obsolete are refused. The description comes from ePASS, not from what was typed. If a code was just added in ePASS, it can be picked after the next feed (every 15 minutes). If the misc list hasn't come through the feed at all, the code is taken as typed.
- **NetSuite item (optional).** The NetSuite item the discount will be once NetSuite takes over, such as *Builder Discount* or *Scratch and Save $50*. The box suggests NetSuite's 26 discount items from `data/netsuite-promo-items.json`, built from the 11/17 NetSuite items export (`items/Items10.csv`). If a newer export is uploaded on Written Models, its discount items are added. Any name can be typed.
- **Never shown to shoppers.** Neither the misc code nor the NetSuite item is in anything the shop page receives.

## What the picker suggests

The ePASS misc list holds deliveries, installs, parts and payment lines as well as discounts. The picker suggests only the ones that look like a discount or a promo:

- **Discounts & credits:** ePASS's own *Line Discount* or *Rebate* flag is set, the list price is negative, or the code, description or misc type reads like a discount ("discount", "% off", "$1500 off", "save", "credit", "rebate", "coupon", "influencer", "remodel", "mailer", "courtesy", "override", "model home", "price match", "employee").
- **Promo packages:** "promo", "program", "bundle", "Black Friday/November", "holiday", for example `DW-BSH-PROMO` (deliver, install, recycle).

Typing searches **every** current misc code. Codes that weren't suggested appear under **Other ePASS misc codes**. Obsolete codes are left out.

NetSuite suggestions are every item of type *Discount*, plus service, other-charge and non-inventory items whose name reads like a discount. Vendor and volume rebates and test items are left out. In NetSuite these are *Discount* items, not *Service* items for sale.

To rebuild `data/netsuite-promo-items.json` from a newer export, filter the export the same way: type *Discount*, plus the other three types when the name reads like a discount, skipping rebates and test items. Keep `name` (Display Name), `item` (the item name), `type`, `rate` (Base Price) and `description`. Or upload the export on Written Models, and the picker adds its discount items without a new file.

## On the order

Each order that uses a code keeps the code's ePASS misc code and NetSuite item as they were when it was filed. If the code changes later, the order doesn't. The order card on Online Shop Orders shows the discount the way ePASS's Invoice Discount keys it:

> ePASS misc **DISCOUNT 4** (Discount): 10% off the appliances = −$179.80 · by line: SHP78CM5N −$139.90, JVM3160RFSS −$39.90 · NetSuite: Builder Discount

- **Percent codes** show the percent and the total.
- **Dollar codes** are split over the appliances by price. The last line takes the rounding cent, so the lines always add up to the discount.
- **Free delivery** is one line against delivery.
- **Orders filed with a code that had no misc code yet** show the code's misc code as it is now, marked *set on the code after this order*. Until the code has one, the card says to set it under Promo codes.

## Checked before delivery

The real `server.js` was run on a local test database with made-up ePASS misc codes and NetSuite items, and a stand-in for Stripe (nothing was sent anywhere).

- **Suggestions:** discount codes and the promo package were suggested. Deliveries, installs, payment lines and obsolete codes weren't (*Drop Off Delivery* doesn't count as "$ off").
- **Refused:** a new code with no misc code, an unknown code, an obsolete code, and blanking a code once it was set.
- **Older codes:** a code from before this change could still be paused.
- **Checkout:** two orders went through checkout. The misc code, NetSuite item and per-appliance split were stored on the order and never sent to the shopper. A later change to the code didn't touch the filed order.
- **Audit:** creates, misc code changes and orders all name the misc code.
- **Browser, desktop and phone:** the picker (suggestions, search, arrow keys and Enter), **Set ePASS code** on an older code, and the order card.

## For developers

- `lib/shop-promos-postgres.js`: columns `epass_misc_code`, `epass_misc_desc` and `netsuite_item` on `shop_promo_codes`. `normalizeMiscCode` upper-cases and keeps single spaces. `promoDiscountLines` splits the discount by line, and `promoOrderRecord` is what an order keeps.
- `server.js`:
  - `promoMiscGroup` (discount / promo / other) and `listPromoNetsuiteItems` (the data file merged with the `netsuite_items` table by name) feed `GET /api/shop/promo-codes/choices`.
  - `checkPromoMiscFields` checks a create or edit against `listEpassMiscCharges()` and sets the description.
  - `/api/shop/submit-order` stores `totals.promo` with `epassMiscCode`, `epassMiscDesc`, `netsuiteItem` and `lines`. The response to the shopper is still `priced.totals`, without them.
  - `GET /api/shop-orders` fills older orders from the code, with `fromCode: true`.
- `shop-orders.html`: `miscPicker()` is used by the add form and by the row editor (**ePASS code** button). `promoEpassLine()` writes the order card line.
