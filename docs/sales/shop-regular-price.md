# Express shop: the regular price, struck through

*Added 11/18. Andrew: "show the full MAP with strikethrough and the current PMAP/RETAIL."*

When a model is advertised below its regular price, the shop shows the regular price struck through with the current price beside it. It appears on the shop tile and on the product page.

## When it shows

All of these have to be true.

- The unit is new. An open-box or floor-model price is not a promotion on the new one, so those never show it.
- A price is being shown. "Price in cart" and "Call for price" show nothing struck through.
- The regular price is at least a dollar above the price shown.
- The price shown is at least half the regular price. A wider gap is far more likely a bad row in the feed than a promotion.
- The shop is not paused.

When our price is below the advertised-price floor, the tile and the page show the floor, as before. The regular price is struck through beside that floor.

A shopper signed in to a profile sees their real price, with the regular price beside it.

## Where the regular price comes from

The nightly MAP feed (the RetailDeck price file) carries, for each model, the lowest price it may be advertised at today and the price without promotions. The shop already kept the first as the floor. It now also keeps the second, for any model where it is above the floor. That difference is what a promotion looks like in the feed.

- Regular price: the feed's `rws_map_no_promos` column, or `rws_umrp` for brands on a unilateral price. When both are filled, the lower one.
- Price shown: what the shop already showed. That is the ePASS RETAIL price when it may be advertised, or the floor when our price is below it.

The feed is replaced whole every night, so a regular price goes away the night its promotion ends.

## After this is first pushed

Nothing shows until the feed has been read once with the new code.

1. Open Online Shop Orders.
2. Press Refresh on the MAP feed.
3. Read the feed note. It now ends with a count such as "412 with a no-promotion price above the floor".

If that count is 0, the feed does not carry the no-promotion column under the name the shop looks for. Tell Claude, with the column names from the file.

Then check one model you know is on promotion: the tile and its product page should both show the higher price struck through.

## What has not been checked

The parser was tested on a made-up file in the feed's layout. The real file is 35 MB and is not on the laptop, so what `rws_map_no_promos` holds in practice has not been seen. The first Refresh is the test.

A struck-through price should be the price the model is regularly advertised at. That is a judgement about the feed's numbers, and worth a look across a few brands before leaving it on.

## For developers

- `lib/retaildeck-prices.js`: `extractRetailDeckFloors` also returns `regular` (key to price) and `regularCount`. Floors are unchanged.
- `lib/shop-postgres.js`: `shop_map_prices.regular` (JSONB, added with `ADD COLUMN IF NOT EXISTS`). `saveShopMapPrices({ prices, regular, ... })` drops any regular price that is not above its own floor. `getShopMapPrices()` returns `regular`.
- `lib/shop-product-page.js`: `regularPriceToShow(unit, shown)` holds the rules above. `productOfferView` returns `was`.
- `server.js`: catalog items carry `mapRegular`. `shopWirePrice(item, { withPrices, paused })` decides what a catalog entry may say about price and adds `was` beside it; the three cases used to be inline in the catalog route and send exactly what they sent before. The product page route passes `mapRegular` to the page.
- `shop.html`: `wasTag(group)` draws `was` above the tile's price. It decides nothing.
