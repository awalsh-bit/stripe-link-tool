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

## Catalog page header (11/10)

shop.html's top now mirrors wilsonappliance.com: a dark utility bar (Schedule Service · Financing · Rebates · Showroom · **Express Shop** · More ▾ · phone · Directions · account · cart) over a showroom-photo band with the white logo, the uppercase department nav (Cooking · Coffee · Refrigeration · Kitchen Cleanup · Laundry · Outdoor · Outlet) and a search box. Hovering a department opens the mega panel with that department lit; clicking it goes straight to that department. The header search feeds the catalog's search box. Once the page scrolls, the utility bar folds away and the band tightens to ~70 px with the account and cart icons riding along, so the catalog keeps the screen. Under 1024 px the department nav gives way to the Shop by Category drawer button.

The Financing, Rebates and "More" links point at `https://www.wilsonappliance.com/<page>` paths that Gavin needs to confirm (they carry a `data-site` attribute so they are easy to find).

## Not changed

shop.html's functionality (ZIP gate, profile unlock, cart, checkout, fulfillment, pricing rules) is untouched by any of this.

## Inventory freshness

The storefront's stock comes from the ePASS ODBC pull on WILSON-EPASS01 (Task Scheduler "Agility ePASS pull": 6:00 AM, repeat every 15 minutes for 14 hours, pushed by the agent as soon as each pull finishes). The shop catalog cache rebuilds within a minute of a push while the shop is being used. The Dispatch Board header shows the age of the last push ("ePASS feed … min ago"), which is the quickest way to confirm the schedule is running.
