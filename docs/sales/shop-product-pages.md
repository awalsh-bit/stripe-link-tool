# Express shop: product pages

*Added 11/17 as one test item, the Bosch SHP78CM5N dishwasher.*

A product page sells one model: its photos, a short lead, five features with a line each, specifications, the spec sheet, and the price with an Add to cart button.

**Address:** `https://shop.wilsonappliance.com/p/SHP78CM5N`

Nothing in the shop links to it yet, and search engines are told not to list it. It is there to look at.

## Where each part comes from

- **Words and specs:** the model's record, `data/product-pages/SHP78CM5N.json`. Facts are from the manufacturer's product page and spec sheet. The wording is Wilson's own.
- **Photos:** web-sized copies in `product-photos/SHP78CM5N/`, three sizes of each picture. The page sends each screen the size it needs.
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

The button opens the shop with the model already in the cart (`shop.html?add=SHP78CM5N`). A shopper who came straight to the product page is asked for their ZIP first, as on the shop.

The product page itself opens without the ZIP. It only shows prices the shop is already allowed to advertise.

## Adding another model

1. Put the manufacturer's pictures and spec sheet in the model's folder under `supplier-digital-assets`.
2. Ask Claude to make the page. That converts the pictures into `product-photos/<MODEL>/`, writes the record, copies the spec sheet into `spec sheets` and lists it.
3. Push.

## Not done yet

- **The model link on a shop tile** still goes to wilsonappliance.com. Pointing it at these pages waits on the next item.
- **The cart is not saved between pages.** A shopper with items in the cart who opened a product page and came back would find it empty. The cart needs to be kept in the browser before tiles link here.
- **Photos live in the repo.** About 3 MB a model, which is fine for a handful. Two hundred models want the photos in the database or on a disk instead.

## For developers

- `lib/shop-product-page.js`: `loadProductPage`, `loadProductPageTemplate`, `productOfferView` (the price and stock rules), `renderProductPage`, `productPhotoFile`.
- `data/product-pages/template.html`: the page every model shares. The server fills its double-brace names. `data/` is never served as files.
- `server.js`: `GET /p/:model` and `GET /product-photos/:model/:file`, registered before `express.static`; `/p/` and `/product-photos/` are on the shop host's public list. A model with no record redirects to the shop. The page is sent `no-store`; photos are cached for a week.
