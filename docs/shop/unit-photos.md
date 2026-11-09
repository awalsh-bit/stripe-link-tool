# Outlet unit photos ("Actual product photo")

*Added 11/10. A phone picture of the actual open-box unit becomes its card on the Express shop.*

## Where

Express Assortment Catalog (`shop-catalog.html`) → **Outlet units** tab. One card per open-box / floor-model / unique-priced serial that is on the store, with its current picture, serial, unit price and whether the price shows on the card. **Take photo** opens the phone camera (`<input type="file" accept="image/*" capture="environment">`); the page shrinks the picture to 1600 px JPEG in the browser (a 6 MB phone shot becomes ~100–300 KB) and posts it. **Retake** replaces it, **Remove photo** goes back to the catalog render. Filter: needs a photo / has a photo / open box / floor models. The page is also card-based on a phone for the Models tab (same switches as the desktop table: override price, show if 1, hidden, chip, no stock chip, MAP exempt).

## What the shop does with it

`computeShopCatalogFresh()` loads `shop_unit_photos` keys and, for a clearance unit with a photo, sets `image` to `/api/shop/unit-photo/<model>/<serial>?v=<takenAt>` and `photoActual: true`. The storefront card fills the frame with that picture (`object-fit: cover` instead of the render's `contain`) and adds the **Actual product photo** chip; identical units no longer merge into one tile when one of them has its own photo. The website's stock lookup (`/api/shop/stock`) is unaffected — it describes models, not serials.

## Storage and routes

`shop_unit_photos (model, serial, content_type, bytes, taken_by, taken_at)` in Postgres, keyed by normalized model + upper-case serial (`lib/shop-postgres.js`: `saveShopUnitPhoto`, `getShopUnitPhoto`, `deleteShopUnitPhoto`, `listShopUnitPhotos`). Routes: `GET /api/shop/unit-photo/:model/:serial` (public on the shop host, cached a day, in `SHOP_PUBLIC_API_PREFIXES`); `POST` (multipart `photo`, ≤ 8 MB) and `DELETE` behind the Shop Orders / Catalog page permission; both bust the catalog cache and write an audit row (`shop_unit_photo_saved` / `shop_unit_photo_removed`). When the unit sells and leaves the feed the row simply stops being used; nothing needs cleaning up.
