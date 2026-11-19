# Outlet unit photos ("Actual product photo")

*Added 11/10. A phone picture of the actual open-box unit becomes its card on the Express shop.*

## Where

Express Assortment Catalog (`shop-catalog.html`) → **Outlet units** tab. One card per open-box / floor-model / unique-priced serial that is on the store, with its current picture, serial, unit price and whether the price shows on the card. Filter: needs a photo / has a photo / open box / floor models.

**Take photos (changed 11/20).** Andrew: "The take photo button here is out of date, it should just prompt the model photos button for up to 12." The card's **Take photos** button now opens the model's pictures (the same panel as **Model pictures…**) and, in the same tap, its *Add actual photos* picker. On a phone that offers the camera or the photo library, several pictures at once. They are saved as **actual photos of the model**, up to 12 a model (see `model-photos.md`). They show on every shop card of that model, new units included, so photograph what any of them would show. A model already at 12 opens its pictures with a note to remove one first.

The old button took one photo of the one serial (`<input capture="environment">`, below). It is gone. A unit that still has such a photo keeps it first on its own card, with the model's pictures after it, until **Remove unit photo** on that card. The routes and table below still serve and remove those photos; nothing on the page creates new ones.

## What the shop does with it

`computeShopCatalogFresh()` loads `shop_unit_photos` keys and, for a clearance unit with a photo, sets `image` to `/api/shop/unit-photo/<model>/<serial>?v=<takenAt>` and `photoActual: true`. The storefront card fills the frame with that picture (`object-fit: cover` instead of the render's `contain`) and adds the **Actual product photo** chip; identical units no longer merge into one tile when one of them has its own photo. The website's stock lookup (`/api/shop/stock`) is unaffected — it describes models, not serials.

## Storage and routes

`shop_unit_photos (model, serial, content_type, bytes, taken_by, taken_at)` in Postgres, keyed by normalized model + upper-case serial (`lib/shop-postgres.js`: `saveShopUnitPhoto`, `getShopUnitPhoto`, `deleteShopUnitPhoto`, `listShopUnitPhotos`). Routes: `GET /api/shop/unit-photo/:model/:serial` (public on the shop host, cached a day, in `SHOP_PUBLIC_API_PREFIXES`); `POST` (multipart `photo`, ≤ 8 MB) and `DELETE` behind the Shop Orders / Catalog page permission; both bust the catalog cache and write an audit row (`shop_unit_photo_saved` / `shop_unit_photo_removed`). When the unit sells and leaves the feed the row simply stops being used; nothing needs cleaning up.
