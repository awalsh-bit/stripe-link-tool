# Express shop: product pages

*Added 11/17 as one test item, the Bosch SHP78CM5N dishwasher. On 11/18 the four Miele dishwashers on the list got pages, and shop tiles began linking to them.*

A product page sells one model: its photos, a short lead, five features with a line each, specifications, the spec sheet, and the price with an Add to cart button.

**Address:** `https://shop.wilsonappliance.com/p/<model>`, for example `/p/SHP78CM5N` or `/p/12496900`.

## The pages so far

| Address | Model |
| --- | --- |
| `/p/SHP78CM5N` | Bosch 800 Series dishwasher |
| `/p/11966820` | Miele G 5058 SCVi SFP Active, stainless front |
| `/p/12496900` | Miele G 7766 SCVi AutoDos, panel ready |
| `/p/12496980` | Miele G 7986 SCVi AutoDos K2O, panel ready, handleless |
| `/p/12496990` | Miele G 7186 SCVi AutoDos, panel ready |

Search engines are told not to list these pages yet.

## The link on a shop tile

The model number on a tile is a link. For a model with a product page it opens that page, in the same tab. For every other model it still opens the model's search on wilsonappliance.com in a new tab.

Nothing has to be switched on per model. A model gets the link as soon as its page exists and has been pushed.

## The cart rides along

A shopper can go from the shop to a product page and back without losing the cart.

- The cart icon on a product page shows how many items the cart holds, and opens the cart.
- When the model is already in the cart, the page's button reads "In your cart · View cart" in place of Add to cart.
- Pressing Add to cart twice, or reloading, does not add a second unit.
- The Back button returns the shopper to the same department, search, sort and place on the page.
- If a unit sold while the shopper was away, it is taken out of the cart and the page says so.

The cart is kept in the browser tab, beside the ZIP code. It is gone when the tab closes, when the cart is emptied and when the order is placed. No price is kept with it.

## Miele's two numbers

Miele gives a model a name (G 7766 SCVi AutoDos) and a number (12496900). ePASS, the shop tile and the cart use the number. A shopper knows the name.

The page's heading is the name. The line under it reads "Miele no. 12496900". The address, the photos and Add to cart all use the number.

## Where each part comes from

- **Words and specs:** the model's record, `data/product-pages/<MODEL>.json`. Facts are from the manufacturer's product page and spec sheet. The wording is Wilson's own. Each record names the pages its facts came from.
- **Photos:** web-sized copies in `product-photos/<MODEL>/`, up to three sizes of each picture. The page sends each screen the size it needs.
- **Price and stock:** the live shop catalog, at the moment the page opens. Neither is kept in the record.
- **Spec sheet:** the shop's spec-sheet list (`data/shop-spec-sheets.json`). The button appears when a sheet is listed for the model and its PDF is in `spec sheets`.

## Price and stock

The page follows the same rules as a shop tile, for the unit Add to cart would pick (new before open box).

- Price may be advertised: the price shows.
- Price is below the advertised-price floor: the floor shows, with the note that the price is too low to advertise. The real price never reaches the page.
- Otherwise: "Price in cart".
- The unit has no price: "Call for price" and a call button.
- Nothing in stock, or the shop is paused: no price, and a call button in place of Add to cart.

The stock line reads In stock, Low stock, New in box, Open box or Floor model, as the tile's badge does.

## Add to cart

The button opens the shop with the model in the cart (`shop.html?add=SHP78CM5N`), on top of whatever the cart already held. A shopper who came straight to the product page is asked for their ZIP first, as on the shop.

The product page itself opens without the ZIP. It only shows prices the shop is already allowed to advertise.

## Adding another model

1. Put the manufacturer's pictures and spec sheet in the model's folder under `supplier-digital-assets`.
2. Ask Claude to make the page. That converts the pictures into `product-photos/<MODEL>/`, writes the record, copies the spec sheet into `spec sheets` and lists it.
3. Push.

## The Miele pages: what is thin, and what was left out

- **One photo each.** The Miele folder holds one front view per model, 600 pixels wide, and that is all Miele supplies for these models. The page shows it without thumbnails or arrows. The plan is to photograph Wilson's own units later; those pictures go in the same way as Bosch's.
- **The panel-ready photos show a plain white panel.** The three panel-ready models are pictured with a stand-in panel, and each page says so.
- **Spec sheets (added 11/18).** Each page has a button for Miele's sheet, from the PDFs dropped in `supplier-digital-assets/miele`. The G 5058 page has a second button for the operating instructions, which cover the G 5051, G 5056 and G 5058 only. Every figure on the four pages was checked against the sheets.
- **Place settings** are not on Miele's pages or sheets for these models, so no number is given.
- **Miele's "99.9% of viruses" and "35% less electricity" claims** each depend on a footnote. They are left out.
- **Warranty** is not stated on Miele's pages or sheets for these models.
- **Wi-Fi** is the last line of "Also on this model", as on the Bosch page. Miele's page for the G 5058 lists none, so that page has no such line.

## Not done yet

- **Photos live in the repo.** About 3 MB for a model with twelve pictures, which is fine for a handful. Two hundred models want the photos in the database or on a disk instead.
- **Search engines.** The pages are marked not to be listed. That is one line to change when they are ready to be found.

## For developers

- `lib/shop-product-page.js`: `loadProductPage`, `loadProductPageTemplate`, `productOfferView` (the price and stock rules), `renderProductPage`, `productPhotoFile`, `listProductPageKeys` (the record file names, read at most once a minute).
- A record's `displayModel` is the name to show when it differs from `model`. `model` stays the key for the address, the photo folder and Add to cart.
- `data/product-pages/template.html`: the page every model shares. The server fills its double-brace names. `data/` is never served as files.
- `server.js`: `GET /p/:model` and `GET /product-photos/:model/:file`, registered before `express.static`; `/p/` and `/product-photos/` are on the shop host's public list. A model with no record redirects to the shop. The page is sent `no-store`; photos are cached for a week. The catalog response carries `pages`, the keys from `listProductPageKeys`.
- `shop.html`: `hasProductPage` and `productPageUrl` choose the tile's link from `catalog.pages`. The cart is saved to `sessionStorage["wilsonShopCart"]` as `{ v, at, itemIds, addonLines, special, models, handoff }` by `saveCart` (called from `renderCartCount`, on `pagehide` and when the tab is hidden) and put back by `adoptSavedCart` after the first catalog load and on a `pageshow` from the page cache. `?show=cart` opens the cart. `addFromLink` counts what the cart already holds of a model for a plain `?add=` link, and a `?cart=` token already taken up is not fetched again.
- Back and Forward: each shop visit gets a key in `history.state.shopView`; `saveView` stores the filters, the tile count and the scroll position under it in `sessionStorage["wilsonShopViews"]` (the last eight visits), and `restoreView` puts them back only when the navigation type is `back_forward`.
- The product page template reads `wilsonShopCart` for the cart count and the "In your cart" state. It never writes it.
