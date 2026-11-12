# Express shop landing page (shop-home.html)

*Added 11/5. The front door of shop.wilsonappliance.com is now a fast, static landing page; the catalog itself is unchanged at /shop.html.*

## Why

The catalog page carries the whole assortment, so it is slow to first paint. The landing page is ~25 KB of HTML plus photos, loads instantly, and every tile on it is a single click into the right slice of the catalog — so a shopper who wants a dishwasher never waits for the full list or opens the menu.

## What's on it

| Section | Where it goes |
|---|---|
| Hero ("Shop what's in stock" / "Schedule service") | /shop.html · service.wilsonappliance.com/applianceservice.html |
| Stat strip (live model count · "days, not weeks") | `/api/shop/home-stats` |
| Five one-click journeys: Outlet · Schedule service · Sub-Zero & Wolf · Visit the showroom · Call or text | /shop.html?outlet=1 · service host · service host /subzero · Google Maps · tel: |
| Shop by department (6 photo tiles with live model counts, website order: Cooking, Coffee, Refrigeration, Kitchen Cleanup, Laundry, Outdoor) | /shop.html?dept=Cooking … Outdoor |
| "What our neighbors take home" (top 4 sellers in stock, MAP-advertisable price only) | /shop.html?q=MODEL |
| Showroom (copy, address, photo mosaic) | /subzero and department sub-links |
| Delivery / Service / Builders pillars | /shop.html · service · tel: |

Hours are deliberately **not** stated (unconfirmed). Sub-Zero, Wolf, Cove and Gaggenau are never priced on the page; the footer says they are quoted in person.

## Deep links into shop.html

shop.html now reads the query string once, after the first catalog render:

| Parameter | Example | Effect |
|---|---|---|
| `dept` | `?dept=Cooking` | Department (same labels as the shop menu) |
| `dept` + `sub` | `?dept=Cooking&sub=Ranges` | One of that department's categories (website wording: Ranges, Cooktops, Wall Ovens, Built-in Refrigerators, Wine Storage, Dishwashers, Washers…) |
| `outlet` | `?outlet=1` | Open box & display |
| `brand` | `?brand=Bosch` | Brand filter (case-insensitive, catalog spelling) |
| `q` | `?q=SHX78CM5N` | Search box prefilled |

These can be texted or put in ads: `shop.wilsonappliance.com/shop.html?dept=Laundry`. The URL is left in place so it stays shareable; the page scrolls to the results. The shop logo now links back to the landing page.

## Data

`GET /api/shop/home-stats` (public on the shop host, cached 2 minutes) **never builds anything while a visitor waits**: the numbers are computed after every catalog build (the warmer runs one every minute while the shop is in use, every 5 minutes idle), kept in memory and written to `shop_home_stats` in Postgres so a fresh deploy answers instantly with the last known numbers. The shop catalog itself is also served stale-while-revalidate up to 2 hours old rather than going cold at 10 minutes. It returns `{ models, units, byCategory, featured[4], paused, asOf }` (`asOf` = when ePASS last pushed the on-hand feed, not the clearance workbook's upload date) from the same `computeShopCatalog()` the shop uses. Featured = the four most-sold in-stock models that have a photo and a MAP-advertisable price. If the call fails the page still renders; the stat tiles show "—" and the featured row hides.

## Photos and fonts

- `showroom/*.jpg` — 15 web-sized showroom photos (1400–2200 px wide, 77–308 KB). Served on the shop host via the `/showroom` public prefix.
- `showroom-photos/` — the 60 originals (5–9 MB each). **Denied** by the static server (`STATIC_DENY_DIRS`) so nothing ever links to a 9 MB file. Safe to keep in the repo or move out; the site doesn't read them.
- `logo-white.png` — the Wilson mark in ivory for the dark header/footer (made from logo-black.png, alpha kept).
- `fonts/cormorant-garamond-latin-500-{normal,italic}.woff2` — the serif display face (SIL Open Font License, self-hosted, 21 KB each). Roboto stays for UI text.

## Server changes (server.js)

- `/` on the shop host → `shop-home.html` (was shop.html).
- `SHOP_PUBLIC_PATHS` += `/shop-home.html`, `/logo-white.png`, the two Cormorant fonts.
- `SHOP_PUBLIC_API_PREFIXES` += `/showroom`, `/api/shop/home-stats`.
- `STATIC_DENY_DIRS` += `showroom-photos`.

## Site header (11/10)

Both shop pages carry the wilsonappliance.com header, built by the shared `site-header.js` + `site-header.css` so they can't drift apart: a dark translucent utility bar (Schedule Service · Financing · Rebates · Showroom · **Express Shop** · More ▾ · phone · Directions, plus account and cart on the shop), the white logo linking to **wilsonappliance.com**, the site's nav on its frosted panel (Luxury Appliances · Appliances · HVAC · Cabinetry · Sinks & Faucets) and a search box that feeds the catalog search (on the landing page it opens `/shop.html?q=`). The header is fixed; once the page scrolls the utility bar folds away and the band tightens, the account/cart icons riding into the band. On the landing page it sits transparent over the hero photo (`overlay` mode, going dark on scroll); on the catalog page the band carries the showroom photo (`photo` mode). Under 1024 px the site nav and the hidden utility links move into the **More** menu.

The one thing that is the shop's own: a small **Express Assortment** mark beside the logo (the `tag` option), linking to the shop home, so a visitor can tell they are on the shopping side of the same site.

`shop.html` adds its own third row inside the header — Cooking · Coffee · Refrigeration · Kitchen Cleanup · Laundry · Outdoor · Outlet — hovering opens the mega panel with that department lit, clicking goes straight to it; on a phone the row scrolls sideways and the Shop by Category button sits beside the logo.

**Links.** Every main-site destination lives in one table at the top of `site-header.js` (`WILSON_SITE`: base URL + a path per link). Confirmed 11/10: Appliances, HVAC and Cabinetry go to their site pages; **Luxury Appliances** points at the Appliances page until the luxury page leaves the test site; **Sinks & Faucets** goes to Wilson's Galley dealer page (`dealers.thegalley.com/wilson-ac-appliance/`) for now. Still placeholders for Gavin to confirm: `/financing`, `/rebates`, `/showroom` and the More items. Changing one in the table changes both pages.

## Not changed

shop.html's functionality (ZIP gate, profile unlock, cart, checkout, fulfillment, pricing rules) is untouched by any of this.

## Inventory freshness

The storefront's stock comes from the ePASS ODBC pull on WILSON-EPASS01 (Task Scheduler "Agility ePASS pull": 6:00 AM, repeat every 15 minutes for 14 hours, pushed by the agent as soon as each pull finishes). The shop catalog cache rebuilds within a minute of a push while the shop is being used. The Dispatch Board header shows the age of the last push ("ePASS feed … min ago"), which is the quickest way to confirm the schedule is running.

## shop.html: no headline, and what "Best Sellers" means (11/11)

The "Better choices, already made" headline above the Top Deals cards on `shop.html` is gone — shoppers arriving from an ad land straight on the cards. (The same line still greets people on the ZIP gate.)

**Sort: Best Sellers** now depends on what is on screen:

- **The whole store** (nothing picked): brands by units delivered over the last 12 months, the house brand first, then each brand's models by their own units. Unchanged from 9/28.
- **Inside a Top Deals card, a department or a type**: models by their own units delivered over the last 12 months. A model with no sales yet follows, ordered by how its brand sells *in that same category* (`brandCatSold`), then by the brand overall.

The reason: brand-first ranking inside a card put a brand's only qualifying item on top — a panel-ready KitchenAid undercounter led Refrigerators because KitchenAid sells a lot of dishwashers. `shopSalesRank()` in `server.js` now also rolls sales up per brand and shop category (`byBrandCat`), and `/api/shop/catalog` sends it per item as `brandCatSold`.

## Product details on the tile (11/12)

Tapping a product tile on `shop.html` opens it to double width (taller, in place, on a phone) with the model's three top features as bullets and its full description. One tile is open at a time; buttons and the model link inside a tile keep their own jobs. There are no separate product pages.

- **Data:** `data/shop-product-details.json`, a one-time mapping (11/12) of the *Long Description* column in the NetSuite item export `items/Items413.csv`. Per model: `headline` (the first part of the long description — also shown on the closed tile in place of ePASS's 50-character description), `features` (three picked from the rest), `more` (the remaining parts) and `description` (the whole text, tidied). 161 of the 201 Express models had a long description; the rest simply have no Details control.
- **How the three were picked:** the long description is a comma-separated list. Named technologies, capacity, quietness, cleaning and cooking modes, warranty and the like rank above attributes every model has (control type, handle, counts of temperatures or options, ADA, Energy Star); ties go to whatever the item record lists first. Burner BTU lists and "2-Speed, 300 CFM" pairs are kept together as one feature. To change a model, edit its entry in the JSON.
- **Wire:** `loadShopData()` reads the file (optional — no file, no details); `/api/shop/catalog` sends `details` keyed by normalized model for the models in the response.
- **Not done yet:** benefit wording, an editor on the catalog page, and re-running the mapping when NetSuite changes.

