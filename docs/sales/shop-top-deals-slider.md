# Express shop: Top deals tiles and the price slider

*Changed 11/17 (Andrew and Cayden).*

The four Top deal tiles (Washers, Dryers, Dishwashers, Refrigerators) now pick the category only. The price ceiling moved off the tile and onto a slider that appears under the tiles once one is picked.

## How it works for a shopper

- Pick a tile. The grid shows that category up to the slider's price, and the slider's heading says so: *Dishwashers up to $999 · 67 in stock*.
- The slider has seven stops: $999, $1,499, $1,999, $2,499, $2,999, $3,499 and $3,999. Drag it, use the arrow keys, or click a price under it.
- Washers, dryers and dishwashers start at $999. Refrigerators start at $2,999.
- Once the shopper moves the slider it stays where they put it, for every tile, until they leave the page.
- The count on each tile is what that category holds at the slider's setting.
- Picking the same tile again, a department or Outlet lets go of the tile and hides the slider.
- Models over $3,999 are not under any tile. They are in the departments as before.

On a phone the prices under the slider show every other stop; the $500 steps keep their mark.

## Which stop a model lands on

A model lands on the lowest stop that covers its selling price, the same price the old tiles sorted by. That includes models whose price only shows in the cart: the page is told the stop, never the price, so such a model is placed to the nearest $500 and no closer.

## Changing the stops or the starting points

Both are in `server.js`: `SHOP_DEAL_STOPS` is the list of stops, and each entry in `SHOP_DEAL_GROUPS` has `max`, the stop its tile starts at. A starting point should be one of the stops.

## For developers

- `server.js`: `shopDealSlot()` gives each catalog unit `dealCat` and `dealStop`; `GET /api/shop/catalog` sends them with `dealStops`. The older `deal` field (the tile's own ceiling) is still sent, so a shop page left open from before the change keeps working.
- `shop.html`: `inDeal(item, key)` is the filter; `dealCeiling(key)` is the shopper's stop or the tile's start; `syncDealSlide()` draws the slider; `setDealStop(k)` moves it. `state.filter.dealMax` holds the shopper's stop.
