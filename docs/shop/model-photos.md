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
