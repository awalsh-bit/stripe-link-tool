# Express shop: product pages

*Added 11/17 as one test item, the Bosch SHP78CM5N dishwasher. On 11/18 the four Miele dishwashers on the list got pages, shop tiles began linking to them, five Bosch refrigerators followed, and then the Bosch SHP65DP5N dishwasher. Later on 11/18: the Speed Queen line and two Sharp microwave drawers.*

A product page sells one model: its photos, a short lead, five features with a line each, specifications, the spec sheet, and the price with an Add to cart button.

**Address:** `https://shop.wilsonappliance.com/p/<model>`, for example `/p/SHP78CM5N` or `/p/12496900`.

## The pages so far

| Address | Model |
| --- | --- |
| `/p/SHP78CM5N` | Bosch 800 Series dishwasher |
| `/p/SHP65DP5N` | Bosch 500 Series dishwasher |
| `/p/11966820` | Miele G 5058 SCVi SFP Active, stainless front |
| `/p/12496900` | Miele G 7766 SCVi AutoDos, panel ready |
| `/p/12496980` | Miele G 7986 SCVi AutoDos K2O, panel ready, handleless |
| `/p/12496990` | Miele G 7186 SCVi AutoDos, panel ready |
| `/p/B36FD10ENS` | Bosch 100 Series French door refrigerator, standard depth, ice and water at the door |
| `/p/B36CL80ENS` | Bosch 800 Series counter-depth 4-door refrigerator, water dispenser inside |
| `/p/B36CD80SNS` | Bosch 800 Series counter-depth 3-door refrigerator, ice and water at the door |
| `/p/B36CT80SNS` | Bosch 800 Series counter-depth 3-door refrigerator, bar handles, water dispenser inside |
| `/p/B36CT81ENS` | Bosch 800 Series counter-depth 3-door refrigerator, recessed handles, water dispenser inside |
| `/p/SMD2470ASY` | Sharp 24" Microwave Drawer, stainless steel |
| `/p/SMD2479JS` | Sharp 24" Smart Microwave Drawer, Easy Wave Open, stainless steel with a viewing window |

Search engines are told not to list these pages yet.

## The link on a shop tile

A model that has a page links to it from its tile's model number, in the same tab (`shop.wilsonappliance.com/p/MODEL`).

A model without a page shows its number as plain text. It used to open that model's search on wilsonappliance.com in a new tab; that link is gone (*Andrew 11/18: "removing the link to wilsonappliance.com is important for the model numbers"*), so a shopper looking at a model stays in the shop. Nothing in the grid links to wilsonappliance.com now. The site header's own links are unchanged.

## The footer

*Andrew 11/18: "All of this footer text is redundant as it is the same messaging very close on the screen. Also can you change the link color from blue?"*

The product page's footer is now one line: the name, the address, the phone number and wilsonappliance.com. The paragraph that sat under it ("Express Assortment: in-stock models for quick delivery... Nothing is charged online...") is gone from product pages, because the same promises are beside the Add to cart button and in the Express Assortment panel just above the footer.

The phone number is a real link in the footer's white, underlined. Before, it was plain text that a phone turned into a link by itself, in the browser's blue. The shop page's footer got the same link treatment; its paragraph was left in place, because on that page nothing nearby repeats it.

## What the shop says about payment, delivery and getting in touch

*Andrew 11/19.*

- **"Nothing is charged online" is gone** from the shop page, the cart, the checkout consent, the special-order messages and the product pages. *"If we say 'nothing is charged online' and then they are taken to a credit card capture, they'll be confused, and my goal is to have sales confirm and charge the saved card... within a business hour, so it seems a bit misleading."* The consent line beside the card form still says the card is kept on file and charged only after the order and final total are confirmed with the customer; only "Nothing is charged today" came off it. The screen after an order now reads "Your order is in, and your card is securely on file."
- **Delivery line under Add to cart** on a product page: "Express Delivery via online order is only available locally. Please call or text us to schedule in the greater Austin and San Antonio area."
- **Call or text.** Wherever the shop gives the phone number for questions, it now also offers a text: "Call 512-894-0907 or Text Us", where "Text Us" opens a text to the same number. It is capitalized and carries a small message icon, so it reads as something to tap (the look is `a.text-us` in `site-header.css`). That covers the product page (questions line, the installation note, the out-of-stock line), and on the shop page the paused notice, the ZIP message, the sizing note, the brand and cart-link notices, and the cart's "price unavailable" line. The landing page's "call or text" line links both.
- **The cart in the header** stays there on a phone once the page scrolls (it used to fold away with the top bar), and **no link is browser blue**: iPhone no longer links numbers and addresses by itself on the shop pages, and phone numbers are written as real links in the text's own color.

## The page's pictures on the shop tile

*Added 11/18. Andrew: "For the products that have these pages, can you use the image galleries in the shop page?"*

A model with a page shows the page's gallery on its tile: the first picture is the card picture, and the ‹ › arrows flip through the rest, in the page's order, with the "1 / 4" count. A page with one picture shows that picture and no arrows. The tile uses the small (400-pixel) copies, so the grid stays quick.

What decides a tile's picture, first match wins:

1. **A phone photo of that one unit** (Shop Catalog, by serial). It leads, flagged "Actual product photo", and the pictures below follow it.
2. **Pictures chosen by hand for the model** (Shop Catalog). They replace the page's pictures on the tile, exactly as they replaced the thumbnail before.
3. **The page's gallery.** New.
4. **The RetailDeck thumbnail**, for a model with no page.

So a model with a page no longer depends on RetailDeck having a thumbnail for it: several Speed Queen models and the pedestal had none. The Shop Catalog's model rows show the same card picture.

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
- The model's regular price is higher than the price shown: the regular price sits struck through ahead of it. See [The regular price, struck through](shop-regular-price.md).
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
2. Ask Claude to make the page. That converts the pictures (working copies go in `supplier-digital-assets/web/<MODEL>/`, the published ones in `product-photos/<MODEL>/`), writes the record, copies the spec sheet into `spec sheets` and lists it.
3. Push.

## The Miele pages: what is thin, and what was left out

- **One photo each.** The Miele folder holds one front view per model, 600 pixels wide, and that is all Miele supplies for these models. The page shows it without thumbnails or arrows. The plan is to photograph Wilson's own units later; those pictures go in the same way as Bosch's.
- **The panel-ready photos show a plain white panel.** The three panel-ready models are pictured with a stand-in panel, and each page says so.
- **Spec sheets (added 11/18).** Each page has a button for Miele's sheet, from the PDFs dropped in `supplier-digital-assets/miele`. The G 5058 page has a second button for the operating instructions, which cover the G 5051, G 5056 and G 5058 only. Every figure on the four pages was checked against the sheets.
- **Place settings** are not on Miele's pages or sheets for these models, so no number is given.
- **Miele's "99.9% of viruses" and "35% less electricity" claims** each depend on a footnote. They are left out.
- **Warranty** is not stated on Miele's pages or sheets for these models.
- **Wi-Fi** is the last line of "Also on this model", as on the Bosch page. Miele's page for the G 5058 lists none, so that page has no such line.

## SHP65DP5N: whose pictures these are

The BSH portal lists no pictures for the SHP65DP5N. Its page uses Bosch's pictures for the SHP65DC5N, from `supplier-digital-assets/bsh-portfolio/SHP65DC5N`, because the two are the same unit to look at.

By Bosch's own pages the two differ in the light on the floor (InfoLight on the DP, TimeLight on the DC) and in one cycle on the panel. So the two pictures that show the DC5N's control panel are left out. The picture with the door ajar is the SHP65DP5N's own.

Bosch's page gives the weight as 95 lb and the spec sheet as 85 lb. The page says 95. "The quietest dishwasher brand in the U.S." and Zone Wash's "3x more water power" are left out: no footnote was shown for either.

## The Bosch refrigerator pages: sources, and where they disagree

Each page was written from Bosch's product page and, for four of the five, the spec sheet from the model's folder in `supplier-digital-assets/bsh-portfolio` (all dated 9/26). The photos are the gallery pictures from the same folders.

- **B36FD10ENS has no spec sheet on file.** Its page has no spec sheet button, and it gives only the size Bosch's product page gives. The storage layout (crisper and chiller drawers, gallon bins, the two-tier freezer drawer) comes from Bosch's sheet dated 6/24, found on a retailer's site. Drop the current sheet in the model's folder and ask Claude to add the button, the labelled depths, the weight, the sound level and the energy use.
- **Depth.** Bosch's product page gives one depth, 27 13/16 in, for all four 800 Series models. The sheets label theirs: with doors and handles, without handles, without doors. They run larger. The pages use the sheets' labelled figures.
- **Ice, B36CD80SNS.** Bosch's page says 13 lb a day and its sheet says 16. The page says 13, the lower figure.
- **Freezer capacity, B36CL80ENS, B36CT80SNS and B36CT81ENS.** Bosch's page says 6.1 cu ft and the sheets say 6. The pages use 6, which adds up to the total.
- **Ice storage** is left off where the two sources differ (B36FD10ENS, B36CD80SNS).

Left out on purpose:

- **"Fastest ice maker"** in its class or in the industry. Bosch makes the claim, and the footnote behind it was not shown.
- **"99.9% of sediment"** for the water filter, and the gallery graphic that carries it.
- **Warranty.** Only the B36CD80SNS sheet states one (1 year limited, parts and labor). No page shows warranty terms.

Kept, with its condition: VitaFreshPro's "up to three times longer" is given as Bosch's figure, against a Bosch refrigerator without VitaFreshPro, with results varying by food.

One to three of the gallery pictures on each page are Bosch's own graphics, with Bosch's words on them. The alt text says so.

## The Sharp microwave drawer pages

*Added 11/18. Andrew: "SMD2470ASY, SMD2479JS have photos and should be ready to build."*

Facts come from the spec sheets already in `spec sheets` (SMD2470ASY dated 10/22/2025, SMD2479JS 10/15/2025) and from Sharp's product pages. Both sheets are now listed in `data/shop-spec-sheets.json`, so each page has a spec sheet button. The pictures are Sharp's web images from `supplier-digital-assets/sharp`: two for the SMD2470ASY and three for the SMD2479JS, all on white. The SMD2470ASY's are 1,500 pixels wide, so its largest size is the original rather than 1,600.

Where the sources disagree:

- **Closing, SMD2470ASY.** The sheet says a soft nudge closes it; Sharp's page says hands-free close. The page follows the sheet.
- **Flush mounting, SMD2470ASY.** The sheet's first page mentions built-in airflow control for flush installation, but its table says the flush-mount kit is sold separately and names it (SKMD24F0AS). The page says flush mounting takes Sharp's kit. The SMD2479JS needs no kit, by both its sheet and Sharp's page.
- **The app, SMD2479JS.** The sheet calls it SHARP HOME, Sharp's page the Sharp Kitchen app. The page uses SHARP HOME, the newer source.

Left out on purpose:

- **"One of the most trusted brands in microwaves"** and **"the original inventor"** of the microwave drawer: no basis is given.
- **A viewing window on the SMD2470ASY.** Its pictures show a dark glass front, but neither Sharp source calls it a window. The SMD2479JS's window is in both.
- **Power levels on the SMD2470ASY.** The sheet prints "00".
- **ADA.** The sheets only say the drawer must be installed to ADA guidelines.

Kept, with their conditions: Alexa needs the Amazon Alexa app, and an Echo device is not included (the SMD2479JS sheet's footnotes).

Not linked: the installation manual on file, `SMD2470AS_SMD3070AS_IM.pdf` (2020), is for the earlier SMD2470AS. Sharp publishes one for the SMD2479JS that is not on file. Drop either in `spec sheets` and ask Claude to add the button.

## The Speed Queen pages

*Added 11/18. Andrew: "time to do all of the speed queen models... let's use all of the individual ones and skip over the pairs for the moment... for now we just need individual model product pages."*

Thirty pages, one for every model on Speed Queen's four sell sheets:

| Series | Models |
| --- | --- |
| TR7, TR5, TR3 top load washers | TR7006WN, TR7006BN, TR5006WN, TR3006WN |
| TC5 top load washer | TC5003WN, TC5003BN |
| DR7, DR5, DR3 dryers | DR7004WG, DR7004WE, DR7004BG, DR7004BE, DR5004WG, DR5004WE, DR3004WG, DR3004WE |
| DC5 dryer | DC5004WG, DC5004WE, DC5004BG, DC5004BE |
| FF7 front load washer | FF7011WN, FF7011BN (left hinge), FF7012WN, FF7012BN (right hinge) |
| DF7 dryer | DF7004WG, DF7004WE, DF7004BG, DF7004BE |
| SF7 stacked washer and dryer | SF7008WG, SF7008WE, SF7008BG, SF7008BE |

**One folder of photos for the whole line.** A gas dryer and an electric one are the same cabinet, so the photos live once in `product-photos/SPEEDQUEEN/` and each record points there with `"photoKey": "SPEEDQUEEN"`. Sixty-seven pictures, 3.9 MB. They came from `supplier-digital-assets/speed-queen/Large` (the 2,048-pixel JPGs; the PSD originals were not needed).

**Ten dryers have no photo of their own in the drop:** DR3004WG/WE, DC5004WG/WE/BG/BE and DF7004WG/WE/BG/BE. Each of those pages has one picture: the dryer cut out of the front view of its pair (`TR3-DR3_Pair_Front`, `TC5-DC5_W_Pair_Front`, `TC5-DC5_B_Pair_Front`, `FF7-DF7_W_Pair_Front`, `FF7-DF7_B_Pair_Front`). The record says so under `sources.photos`. When single-unit photos turn up, send them and the pages get the full set. The pair, lineup and room-with-a-pair photos are not used anywhere yet.

**Where the facts come from.** Speed Queen's product pages (read 11/18) and the four sell sheets in `spec sheets/`. Three pages would not load (DR7004WE, DC5004WE, FF7011WN); those models use the page for the same machine in its other color or fuel. Cycle names on the dial models are read from Speed Queen's own photo of the control panel.

**Where the sources disagree or are silent:**

- **TR7 cycles.** The headline on Speed Queen's page says "8 Special Cycles"; its specification table and the sell sheet say 16 preset cycles. The page says 16.
- **ENERGY STAR.** Stated for the dryers (DR7, DR5, DR3, DC5, DF7). Speed Queen's pages for the FF7 washer and the SF7 stack show only an EnergyGuide label, so those pages make no ENERGY STAR claim.
- **Weight** is the shipping weight Speed Queen publishes. It gives no net weight.
- **Left out:** Speed Queen's list prices, the Ripon, Wisconsin passage that is the same on every one of its pages, and connection requirements (volts, amps, gas line, venting), which are in the installation guide and not on the page or the sheet.
- **"Built for 25 years"** is on the TR7 page only, where Speed Queen's own page was read saying it, and it is attributed to Speed Queen.

The records are generated, not hand-written: the line's facts and wording sit once per series, and each model's record is that plus its color, fuel and hinge. To change a sentence on every DR7 page, it is one edit and a rebuild. Ask and it is done.

## The pedestal, and how an accessory gets onto the shop

*Added 11/18. Andrew: "It deserves its own page and needs to clarify its nonstorage nature."*

**The rule.** Accessories stay off the shop's listings, as before, with one way on: **an accessory that has a product page is listed.** Writing the page is the switch. It shows as its own tile in its department's accessory section (the pedestal is under Laundry, then Laundry Accessories), at its ePASS price, while it is in stock. Everything else about a listing still applies to it: it needs more than one unit on hand unless "show when only one" is set for it in the Shop Catalog, it can be hidden there, and a brand that is never sold online stays off.

The section an accessory lands in comes from its NetSuite merch class: 220 is Laundry Accessories, 107 Refrigeration, 149 Cooking, 154 Ventilation, 816 Outdoor. An accessory with no NetSuite class is not listed even with a page.

**The pages.** `PDR108MB` (matte black, the one in stock) and `PDR108W` (white, ready for when it is stocked).

*Andrew, later on 11/18, on the first draft: "three places is enough. We still want to sell them and focus on what they do, not what they don't do."* So the page sells the lift and the match. The opening, the fact strip and the first three reasons are about what the pedestal does: 8 inches of added height, less bending, made for the FF7 and DF7, finished to match. It says there is no drawer in three places and no more:

1. the line under the title ("Matte black riser for FF7 washers and DF7 dryers, no drawer"),
2. the last reason ("A riser, plain and simple... It is a riser, not a storage drawer."),
3. the specifications ("Type: Riser pedestal, no drawer").

The title itself says "Riser". The FF7 and DF7 pages call it "a matching 8-inch riser pedestal" and leave it there.

**Where its facts come from.**

- **No drawer:** Wilson's NetSuite item ("8in. Pedestal for Matching Front Load Washers and Dryers - No Drawer") and Andrew. Speed Queen's sheet gives only dimensions.
- **Dimensions** (26 7/8 x 8 x 27 in.): the front load sell sheet, which is now linked from both pedestal pages.
- **Part number:** Speed Queen's sheet calls the matte black one PDR108B. Wilson's item is PDR108MB. The page shows Wilson's.
- **Photos:** Speed Queen's drop has no picture of the pedestal alone, so all three are cut from its front view of the pair on pedestals: the pedestal by itself, the washer standing on it, and the pair.
- **Left out:** Speed Queen's stacked sheet also lists the pedestal for the SF7. The page does not mention the stack. Say so if you sell it that way.

The cart prompt ("Installs & accessories by brand" in Online Shop Orders) still works the way it did and is separate from this: name PDR108MB there for Speed Queen's front load washers and it is also offered when someone adds an FF7.

## Not done yet

- **Photos live in the repo.** About 3 MB for a model with twelve pictures, which is fine for a handful. Two hundred models want the photos in the database or on a disk instead.
- **Search engines.** The pages are marked not to be listed. That is one line to change when they are ready to be found.

## For developers

- Tile galleries: `loadProductPageGalleries(dir)` in `lib/shop-product-page.js` returns every page's pictures at the 400 size (read at most once a minute). `computeShopCatalogFresh` in `server.js` puts them on `image` / `images` before the hand-picked and unit-photo steps. If the records cannot be read, cards keep their thumbnails.

- Accessory listing: `shopAccessoryBucketFor(ns)` in `lib/catalog-resolver.js` maps an accessory merch class to its section. `shopStockItems` takes `pageKeys` (from `listProductPageKeys`) and gives a model with no ordinary bucket, a page and an accessory class that section instead of leaving it out.

- `photoKey` (optional, in a record): the folder under `product-photos/` that holds its pictures, when several models share one. Capital letters and digits only, 3 to 40 of them; anything else is ignored and the model's own folder is used.

- `lib/shop-product-page.js`: `loadProductPage`, `loadProductPageTemplate`, `productOfferView` (the price and stock rules), `renderProductPage`, `productPhotoFile`, `listProductPageKeys` (the record file names, read at most once a minute).
- A record's `displayModel` is the name to show when it differs from `model`. `model` stays the key for the address, the photo folder and Add to cart.
- `data/product-pages/template.html`: the page every model shares. The server fills its double-brace names. `data/` is never served as files.
- `server.js`: `GET /p/:model` and `GET /product-photos/:model/:file`, registered before `express.static`; `/p/` and `/product-photos/` are on the shop host's public list. A model with no record redirects to the shop. The page is sent `no-store`; photos are cached for a week. The catalog response carries `pages`, the keys from `listProductPageKeys`.
- `shop.html`: `hasProductPage` and `productPageUrl` choose the tile's link from `catalog.pages`. The cart is saved to `sessionStorage["wilsonShopCart"]` as `{ v, at, itemIds, addonLines, special, models, handoff }` by `saveCart` (called from `renderCartCount`, on `pagehide` and when the tab is hidden) and put back by `adoptSavedCart` after the first catalog load and on a `pageshow` from the page cache. `?show=cart` opens the cart. `addFromLink` counts what the cart already holds of a model for a plain `?add=` link, and a `?cart=` token already taken up is not fetched again.
- Back and Forward: each shop visit gets a key in `history.state.shopView`; `saveView` stores the filters, the tile count and the scroll position under it in `sessionStorage["wilsonShopViews"]` (the last eight visits), and `restoreView` puts them back only when the navigation type is `back_forward`.
- The product page template reads `wilsonShopCart` for the cart count and the "In your cart" state. It never writes it.
