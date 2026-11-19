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

*Changed 11/20. Andrew, passing on Jeff's feedback: "both the description and the model number both need to go to PDP. There needs to be a hint (I'm thinking an arrow of some kind)".*

On a model that has a page, the tile's description and model number are one link to the page, in the same tab (`shop.wilsonappliance.com/p/MODEL`). An arrow (→) follows the model number to show they lead somewhere. On hover the description underlines and the arrow nudges right.

**Details ⌄** now sits under the link. It still opens features and specs right on the tile, and a tap elsewhere on the tile does the same. The category line and the price stay at the foot of every tile, so tiles in a row line up whatever the length of their descriptions.

A model without a page shows its number as plain text. It used to open that model's search on wilsonappliance.com in a new tab; that link is gone (*Andrew 11/18: "removing the link to wilsonappliance.com is important for the model numbers"*), so a shopper looking at a model stays in the shop. Nothing in the grid links to wilsonappliance.com now. The site header's own links are unchanged.

## The footer

*Andrew 11/18: "All of this footer text is redundant as it is the same messaging very close on the screen. Also can you change the link color from blue?"*

The product page's footer is now one line: the name, the address, the phone number and wilsonappliance.com. The paragraph that sat under it ("Express Assortment: in-stock models for quick delivery... Nothing is charged online...") is gone from product pages, because the same promises are beside the Add to cart button and in the Express Assortment panel just above the footer.

The phone number is a real link in the footer's white, underlined. Before, it was plain text that a phone turned into a link by itself, in the browser's blue. The shop page's footer got the same link treatment; its paragraph was left in place, because on that page nothing nearby repeats it.

## Why Wilson cards

*Andrew 11/19, on the "Express Assortment / Better choices, already made." panel: "this text at the bottom isn't a good enough story ... I think it needs to be something about Why Wilson. maybe something about our google reviews, the showroom, first party delivery, in-house install. Oh, maybe we do some cards that rotate for our top reasons to shop local? a random one appears in the same spot as this text?"*

The panel above the footer now holds **Why Wilson** cards. Each visit shows one at random, never the same card twice in a row in a browser tab. **Another reason** steps to the next card and goes back to the first after the last. **Back to the shop** stays beside it.

The eight cards are in `data/why-wilson.json`. The wording came from the *Why Wilson* flyer (WHY-WILSON_2_1.pdf), rewritten for homeowners rather than builders.

| Card | Says | Link |
|---|---|---|
| Rated 4.9 on Google. | More than 1,200 reviews from the homeowners and builders we deliver to, install for and take care of. | Read the reviews (Google Maps) |
| A showroom you can cook in. | Working kitchens, not boxes on shelves, in Dripping Springs. | Get directions (Google Maps) |
| Delivered by our own team. | Wilson's own crew delivers, sets it in place and can haul away the one it replaces. | |
| We install it ourselves. | Wilson installers, not subcontractors. | |
| We service what we sell. | Our own factory-authorized technicians: you reach Wilson, not a call center. | service.wilsonappliance.com |
| Consultants, not clerks. | Decades of appliance experience; they catch venting, power and clearance details early. | |
| The whole kitchen, under one roof. | Appliances, cabinetry, countertops, installation and repair from one team. | |
| Shop local. It shows. | A Dripping Springs company; your purchase keeps neighbors working. | |

- **Editing.** Each card has a `title` and a `body` (plain text) and an optional `link` (`label` and an `https://`, `tel:`, `sms:` or `/page` address). Cards with no title or body are skipped, as are links to any other kind of address. The file is read at most once a minute, and there can be up to 12 cards.
- **Keep the Google numbers current.** 4.9 and 1,200+ are from the flyer.
- **Missing or broken file.** The panel shows one plain card ("One team, start to finish.") instead of going blank.
- **No JavaScript.** The first card shows and **Another reason** stays hidden.
- **Checked:**
  - 15 visits in one tab never repeated a card back to back, and showed all eight.
  - **Another reason** stepped through the cards and wrapped around.
  - The page worked without JavaScript and with storage blocked.
  - The phone layout had no sideways scroll.

## What the shop says about payment, delivery and getting in touch

*Andrew 11/19.*

- **"Nothing is charged online" is gone** from the shop page, the cart, the checkout consent, the special-order messages and the product pages. *"If we say 'nothing is charged online' and then they are taken to a credit card capture, they'll be confused, and my goal is to have sales confirm and charge the saved card... within a business hour, so it seems a bit misleading."* The consent line beside the card form still says the card is kept on file and charged only after the order and final total are confirmed with the customer; only "Nothing is charged today" came off it. The screen after an order now reads "Your order is in, and your card is securely on file."
- **Delivery line under Add to cart** on a product page: "Express Delivery via online order is only available locally. Please call or text us to schedule in the greater Austin and San Antonio area."
- **Call or text.** Wherever the shop gives the phone number for questions, it now also offers a text: "Call 512-894-0907 or Text Us", where "Text Us" opens a text to the same number. It is capitalized and carries a small message icon, so it reads as something to tap (the look is `a.text-us` in `site-header.css`). That covers the product page (questions line, the installation note, the out-of-stock line), and on the shop page the paused notice, the ZIP message, the sizing note, the brand and cart-link notices, and the cart's "price unavailable" line. The landing page's "call or text" line links both.
- **The cart in the header** stays there on a phone once the page scrolls (it used to fold away with the top bar), and **no link is browser blue**: iPhone no longer links numbers and addresses by itself on the shop pages, and phone numbers are written as real links in the text's own color.

## On a phone: no zoom, and Outlet first

*Changed 11/20. Andrew, on an iPhone Pro Max: "it still is a touch too wide for mobile screens ... I'd really like the outlet link on the far left to be the banner they see and the cart icon shouldn't be half visible".*

- **No zoom.** An iPhone zooms the page in when a text box smaller than 16px gets the cursor (the ZIP box, search, the checkout fields) and leaves it zoomed. The page then reads a touch too wide, with the cart half off the right edge. Every text box on the shop, the landing page and the product pages is now 16px on touch screens, so nothing zooms. The rule is in `site-header.css` (`@media (pointer: coarse)`). Computers keep the smaller boxes.
- **Outlet first.** The department ribbon on a product page used to scroll itself to that model's department (Laundry, say), which pushed Outlet off the left edge. It now starts at its left end, Outlet first, as the shop does.
- **Checked** at Pro Max width (430):
  - Every text box was 16px on the product pages, the shop with its checkout fields, and the landing page.
  - Each page was exactly as wide as the screen.
  - The ribbon started at Outlet on a Laundry product page.
  - The cart icon sat inside the right edge.

## Swiping the pictures

*Added 11/20. Andrew, passing on Jeff's feedback: "you need to be able to swipe through photos in both shop and pdp pages".*

- **Shop tiles.** A sideways swipe on a phone, or a click-and-drag with a mouse, flips a tile with several pictures to the next or previous one. The picture follows the finger, and the neighboring pictures start loading as the swipe begins.
  - An up-and-down move still scrolls the page.
  - A move shorter than about 36 pixels doesn't flip.
  - The tap that ends a swipe doesn't also open the tile's details.
  - The ‹ › arrows still work.
- **Product pages.** Phones already swiped the photos. Now a mouse can click-and-drag them too: the row follows the pointer, then settles on the next picture (a drag of an eighth of the width or more) or back on this one. A drag never wraps from the last picture to the first. The arrows, thumbnails and arrow keys work as before.
- **Checked:** mouse drags and touch swipes on a tile (next, back, too short, up-and-down); drags on a product page (2 / 3, 3 / 3, no wrap, snap back, then the arrows); and links from the description and the model number. The earlier suites still pass.

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
- When the model is already in the cart, the page's button reads **Go to Cart**, with "In your cart" under it.
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

*Changed 11/19. Andrew: "if you wanted to click add to cart, you may want to keep browsing that page for a second longer while you double check things."*

**Add to cart keeps the shopper on the page.** The model goes into the cart, the cart icon's count goes up, and the same button becomes **Go to Cart**, with "Added to your cart" under it. On a phone, the bar at the bottom says "In your cart" and its button says Go to Cart too. The shopper can keep reading, check the specs, try their ZIP, or go on to other product pages and add those as well.

**Go to Cart** opens the shop with the cart showing. Before the cart, each model added from a product page gets its own **Complete the setup** prompt (installation, connectors, required parts), one after another. Before this change, only the last model added at once got its prompt; that now holds everywhere, website lists included.

Under the hood: the product page leaves the model in the tab (`wilsonShopStaged`), and the shop puts it in the cart the next time it opens in that tab. That happens the same way the old `shop.html?add=` link did it: new before open box, never a second unit of a model already in the cart, and a special order if the last unit sold in between. Going back to the shop any other way (Back, the cart icon, a department link) adds it quietly, and the setup prompt waits until the cart is opened. In the rare browser that refuses storage, Add to cart works as before and goes straight to the shop with the model.

A shopper who arrives at the shop is asked for their ZIP in the cart, as before.

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

**DR3, DC5 and DF7 photos (filled in 11/18).** The first drop had no single-unit pictures of these ten dryers, so each page had one picture: the dryer cut from the front view of its pair. Speed Queen's own single-unit photos have since arrived (`DR3_*`, `DC5_W_*`, `DC5_B_*`, `DF7_W_*`, `DF7_B_*` and `DF7_Control` in `Large`). Each of the ten pages now has the same set as the rest of the line: front, left, right and the control panel. The DF7's one control-panel picture serves both colors.

The new files are `dr3w-*`, `dc5w-*`, `dc5b-*`, `df7w-*`, `df7b-*` and `df7-control` in `product-photos/SPEEDQUEEN`. They have new names, so no browser keeps showing an old cut-out from its cache. The five cut-outs were moved out of `product-photos` into `supplier-digital-assets/web/SPEEDQUEEN/retired-pair-cutouts/`, since nothing uses them any more.

The pair, lineup and room-with-a-pair photos are not used anywhere yet.

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

- `lib/shop-product-page.js`: `loadProductPage`, `loadProductPageTemplate`, `productOfferView` (the price and stock rules), `renderProductPage`, `productPhotoFile`, `listProductPageKeys` (the record file names, read at most once a minute), `loadWhyWilsonCards(dataDir)` (`data/why-wilson.json`, checked and read at most once a minute; the route passes it as `live.why`, and `renderProductPage` writes every card into `{{WHY}}`, the first one showing).
- Why Wilson in the template: `#whyCards .why-card` (all but one `hidden`), `#whyNext` (hidden until the inline script runs). The script picks a card at random, skipping the index in `sessionStorage["wilsonWhyLast"]`, and stores the one it shows.
- A record's `displayModel` is the name to show when it differs from `model`. `model` stays the key for the address, the photo folder and Add to cart.
- `data/product-pages/template.html`: the page every model shares. The server fills its double-brace names. `data/` is never served as files.
- `server.js`: `GET /p/:model` and `GET /product-photos/:model/:file`, registered before `express.static`; `/p/` and `/product-photos/` are on the shop host's public list. A model with no record redirects to the shop. The page is sent `no-store`; photos are cached for a week. The catalog response carries `pages`, the keys from `listProductPageKeys`.
- Swiping (11/20):
  - `shop.html` handles tiles with document-level `pointerdown` / `pointermove` / `pointerup` / `pointercancel` on `.item-pic[data-pics]` (CSS `touch-action: pan-y`). A capture-phase click handler swallows the click that ends a swipe, and `flipPic` adds the `in-r` / `in-l` slide.
  - The product page template handles mouse pointers only on `#gTrack`. Snapping is off while it has the `grabbing` class, it ends with `go(clamped index)`, and touch is left to native scrolling.
  - Images carry `draggable="false"`.
- `shop.html`: `hasProductPage` and `productPageUrl` choose the tile's link from `catalog.pages`. The tile's `a.item-link` wraps `.item-desc` and `.item-model` with `svg.item-go`. The cart is saved to `sessionStorage["wilsonShopCart"]` as `{ v, at, itemIds, addonLines, special, models, handoff }` by `saveCart` (called from `renderCartCount`, on `pagehide` and when the tab is hidden) and put back by `adoptSavedCart` after the first catalog load and on a `pageshow` from the page cache. `?show=cart` opens the cart. `addFromLink` counts what the cart already holds of a model for a plain `?add=` link, and a `?cart=` token already taken up is not fetched again.
- Back and Forward: each shop visit gets a key in `history.state.shopView`; `saveView` stores the filters, the tile count and the scroll position under it in `sessionStorage["wilsonShopViews"]` (the last eight visits), and `restoreView` puts them back only when the navigation type is `back_forward`.
- The product page template reads `wilsonShopCart` for the cart count and the "In your cart" state. It never writes it. Add to cart writes only `wilsonShopStaged` (`{ v: 1, models: [{ model, at }] }`); the button carries `data-add` (the old link, kept as its `href` for when there is no script or storage) and `data-model`. `shop.html` reads and clears `wilsonShopStaged` in `takeStagedAdds()` at the end of `adoptSavedCart` and passes the models to `addFromLink(..., { quiet: true })`. Setup prompts queue in `state.setupDue`; `showCart()` offers them one at a time (`offerAddons`) and then opens the cart. The cart icon, `?show=cart`, Add to cart on a tile, and the prompt's two buttons all go through `showCart()`.
