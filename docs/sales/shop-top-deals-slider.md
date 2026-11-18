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

## 11/19: always on the page, and a second dot for "between"

*Andrew: "The slider is perfect, but if it is anywhere on the third notch and higher, a bottom dot should appear on the bottom so a user could do 'between', and I'd like it present always regardless of filter because it is really intuitive for all clients."*

**Always there.** The slider no longer waits for a Top Deals tile. It sits under the tiles from the moment the page loads and works on whatever is showing: everything, a department, a brand, a search, or a tile. Its count is the number of units in the grid.

**A last notch, Any.** Because it now covers every category, the track has one more notch after $3,999: **Any**, meaning no ceiling. That is where the slider rests when no tile is picked, so nothing is hidden on arrival, including units over $3,999 and units with no price. A tile still starts where it did (Washers at $999, Refrigerators at $2,999), and a ceiling the shopper sets still stays with them from tile to tile.

**The lower dot.** Once the upper dot is on the third notch ($1,999) or higher, a second dot appears on the first notch. Resting there it does nothing. Slide it up and it sets a floor:

- lower dot at $1,499, upper at $3,499: **"$1,500 to $3,499"**
- lower dot at $1,999, upper on Any: **"$2,000 and up"**

The lower dot cannot pass the upper one; it stops one notch below. Pull the upper dot below the third notch and the lower dot goes away, and its floor with it. A click on the track or on a price label still moves the upper dot.

**How a unit is placed.** As before, the page is never sent a price for this. Every priced unit carries the lowest stop that covers its price (to the nearest $500), and now that is true for every category, not only the four tiles. A unit over $3,999 is marked as over the last stop. A unit with no price shows only when the slider has no floor and no ceiling.

The floor is "over that notch": a unit priced exactly $1,499 sits on the $1,499 stop, so "from $1,500" leaves it out. That is why the label reads $1,500 and not $1,499.

**One thing this extends.** Placing to the nearest $500 already applied to units whose price isn't advertised, inside the four tiles (11/17). It now applies in every category, since the slider works everywhere. Nothing closer than the $500 step is revealed.

**For developers.** `shopDealSlot` in `server.js` now also returns `priceStop` (every priced unit) and `dealGroup` (the tile's category at any price); the catalog sends `priceStopOver`, whose presence tells the page that every unit is placed. In `shop.html`: `priceSlider()`, `sliderStops()` (adds the Any notch), `dealFloor()`, `priceInRange()`, `setDealFloor()`, and a second range input (`#dsLow`) laid over the first. `state.filter.dealMin` is the floor. A catalog without `priceStopOver` gets the 11/17 slider unchanged.
