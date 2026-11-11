# Model pictures — actual photos and supplier assets

*Added 11/11. Pictures chosen by hand for a model replace the automatic catalog thumbnail on the Express shop.*

## Where

Express Assortment Catalog (`shop-catalog.html`) → click any model row (tap its card on a phone) → the edit drawer's **Pictures** half. From the **Outlet units** tab, **Model pictures…** on a unit card opens the same thing for that unit's model, including models that have no sealed stock.

- **Add supplier assets** / **Add actual photos** — pick one file or several at once. Up to 12 pictures per model, of either kind, mixed freely.
- Each saved picture has **Make card picture** (moves it to the front), **Mark as actual photo / supplier asset** (relabels it without a new upload) and **Remove**.
- Removing them all puts the model back on the catalog thumbnail.

The page sizes every picture down to 1600 px JPEG in the browser before it uploads. A see-through background (a supplier cut-out PNG) is laid on white, the same as the shop's cards. A `.psd` or `.tif` cannot be read by a browser — download the asset as JPG or PNG.

## The two kinds

| Kind | What it is | On the shop card |
| --- | --- | --- |
| **Actual photo** | Our own photo of the product | Fills the frame, with the **Actual product photo** chip |
| **Supplier asset** | The maker's own image | Shown like any catalog picture, no chip |

Never label a supplier image as an actual photo: the chip is a promise to the shopper that the picture is ours.

## What the shop does with them

`computeShopCatalogFresh()` loads `listShopModelPhotos()` and, for every unit of a model that has pictures, sets `image` to the first one, `photoActual` from its kind, and `images` to the whole list (`[{ url, actual }]`). The public catalog payload carries `images` only when there is more than one; the storefront card then shows ‹ › arrows and a "2 / 5" counter, and the chip and the fill-the-frame crop follow whichever picture is on screen. Order of precedence on a card: a photo of that one serial (`unit-photos.md`) → the model's hand-picked pictures → the RetailDeck thumbnail → `data/shop-images.json`.

The website's stock lookup (`/api/shop/stock`) returns the model's first picture as a full `https://shop…` address.

## Storage and routes

`shop_model_photos (id, model, kind, content_type, bytes, position, set_by, set_at)` in Postgres; `model` is the normalized key, lowest `position` is the card picture (`lib/shop-postgres.js`: `addShopModelPhoto`, `setShopModelPhotoKind`, `makeShopModelPhotoFirst`, `getShopModelPhoto`, `deleteShopModelPhoto`, `listShopModelPhotos`, `MODEL_PHOTO_MAX`).

- `GET /api/shop/model-photo/:id` — public on the shop host (`SHOP_PUBLIC_API_PREFIXES`), cached a week; a picture id never changes its bytes.
- `POST /api/shop/model-photo/:model` — multipart, field `photos` (one or many, ≤ 8 MB each) and `kind`.
- `POST /api/shop/model-photo/item/:id` — JSON `{ kind }` and/or `{ first: true }`.
- `DELETE /api/shop/model-photo/item/:id`.

Every change is behind the Shop Orders / Catalog page permission, busts the catalog cache, and writes an audit row (`shop_model_photo_saved`, `shop_model_photo_changed`, `shop_model_photo_removed`).

## The catalog page itself

The Models tab is a read-only list: picture, model, description, units, store status, price and a **Setup** column of tags for anything set by hand (override, below MAP, hidden, shows when only one, chip, no stock chip, MAP exempt, picture counts). Nothing is edited in the row, so the list never scrolls sideways. Clicking a row opens the drawer with the pictures on the left and the store switches on the right; **Save** keeps the drawer open, **Save & next** moves down the filtered list, ‹ › step without saving (it asks first if something is unsaved). Below 1040 px wide the rows become cards. Filters: store status includes **Anything set by hand**; the picture filter picks no picture / catalog thumbnail / supplier asset / actual photo.

## Outlet tab: Needs a price, and held units (11/11)

The Clearance Hit List page is retired: `/clearance.html` forwards to Inventory Lookup with Closeouts switched on, the menu entry is gone, and the page no longer appears in the permission editor. Its rules still run (`lib/clearance-live.js`: serial type OPEN, sealed over 365 days old, sealed with a Unique Sell Price) — they decide the shop's outlet units and Inventory Lookup's closeout tag.

What was only on that page now lives on the Outlet tab's filter:

- **Needs a price** — units the rules pick that have no Unique Sell Price in ePASS. An open-box unit is not for sale online until it has one; an aged sealed unit sells as regular stock at the ePASS price until it has one. Brands that are never sold online are listed too (the price is for the floor). The yellow count tile at the top jumps here; `shop-catalog.html#needs-price` links straight to it.
- **Held / marked sold** — marks left from the old page, plus units locked by an online order. The person who made a mark, or an executive, can release it; an online-order lock is released by its order, never here. Nobody can add a new hold or sold mark any more — ePASS (the serial written to an order) is what takes a unit off the shop, and the feed is about 15 minutes behind.

`GET /api/shop/stock-models` returns these as `outletOff`. The old `/api/clearance*` routes remain for the marks on file and now require the Shop Orders / Catalog grant.

## Cost and margin (executives only)

For an executive, `GET /api/shop/stock-models` adds `exec: true`, a `cost` per model (average of the sealed serials on hand, with low and high when they differ) with `margin` / `marginDollars` at the price the shop sells it for, and each outlet serial's own cost and margin. The figures are added in that route only — never to the shared catalog the storefront reads — and `/api/clearance` blanks them for everyone else. On the page they show in purple: under the price in each row, as two tiles in the drawer (the margin tile follows the override as it is typed and turns red under 10%), and on outlet and needs-a-price cards. Nobody else is sent the numbers.

## Export CSV (11/11)

**Export CSV (N)** beside the filters downloads exactly the list on screen — the Models tab with whatever search and filters are in force, or the Outlet tab's current view (on the store, Needs a price, Held / marked sold). The count on the button is the number of rows it will write. The file is built in the browser from what the page already holds (`exportColumns()` in `shop-catalog.html` is the column list), with a byte-order mark so Excel opens it cleanly, named `express-assortment-<list>-<date>.csv`.

Models columns: model, brand, description, the three merch levels, shop department, on the store / status / why off, units for sale / on hand / held, selling price, ePASS price and code, MAP and code, override, below MAP, MAP exempt, the switches, chip, card picture, and counts of actual photos and supplier assets.

Cost and margin are left out unless an executive ticks **with cost & margin** (the box only exists for executives, and nobody else's page holds the numbers). That file's name ends in `-with-cost`; it should not be forwarded outside the company.

