# How the wilsonappliance.com catalog is built and sorted

*From Gavin's site build (`sitegen/build_site.py`, `sitegen/categories.csv`, `sitegen/src/listing.js`), kept here so the Express Shop (shop.wilsonappliance.com) matches the main site's look, wording and order. Andrew 11/10: "customers shouldn't find coffee in different places on either side." Test site: https://wilsonappliancetestsite.netlify.app*

## What the Express Shop takes from this

- **Departments, in this order:** Cooking, Coffee, Refrigeration, Kitchen Cleanup, Laundry, Outdoor. (Garage, Sinks, HVAC, Cabinetry aren't stocked in the Express Assortment.)
- **Categories under each, in the site's order and wording** — Ranges, Rangetops, Cooktops, Wall Ovens, Microwaves, Ventilation, Warming Drawers · Coffee · Freestanding Refrigerators, Built-in Refrigerators, Freezers, Refrigerator & Freezer Drawers, Undercounter Refrigerators, Beer Tappers, Wine Storage, Ice Makers · Dishwashers, Drawer Dishwashers, Trash Compactors, Disposals · Washers, Dryers, Stacked, All-in-One · Outdoor Cooking, Outdoor Refrigeration. Ventilation lives under Cooking; Coffee is its own department.
- **Type** chips over the grid for the categories that have them (Gas / Dual Fuel / Electric / Induction; French Door / Side-by-Side / …; Top Load / Front Load; Grills / Pizza Ovens …), in the site's order, any-of when several are checked, shown only when two or more have stock.
- **No counts anywhere** — no "(12)" on menu rows, no "48 items" in the breadcrumb. Stock chips on tiles (In Stock / Low Stock) stay; those are availability, not counts.
- **Brands always A–Z.** Wording: Built-in Refrigerators, Disposals (never Disposers), Beer Tappers, Wine Storage, Refrigerator & Freezer Drawers, Undercounter Refrigerators, Stacked, All-in-One, Side Burners & Modules, Over-the-Range, Under-Cabinet, Dual Fuel (no hyphen), Non-plumbed.
- Model numbers match with spacing, dashes and case stripped.

Where the shop differs, deliberately: its default sort is Best Sellers (the site's is width then name — the shop has no width data yet), and a category or Type only appears when something is in stock, since the shop sells only what's on the floor.

The menu is `MENU_TREE` in shop.html; categories map to ePASS product codes / storefront buckets. Codes for categories not yet seen in stock (Rangetops, Warming Drawers, Freezers, Beer Tappers, Trash Compactors, Disposals, Stacked, All-in-One, Outdoor Refrigeration, side burners, griddles, smokers) are placeholders — when one of those first lands in the ePASS feed, set its product code in `MENU_TREE` and it appears.

## The site's full conventions (Gavin, 11/10)

### Departments and categories
| Department | Categories (tile order) | Types |
|---|---|---|
| Cooking | Ranges | Gas, Dual Fuel, Electric, Induction |
| | Rangetops | Gas, Induction, Electric |
| | Cooktops | Gas, Induction, Electric, Downdraft Cooktop, Module |
| | Wall Ovens | Single, Double, Steam, Speed, Combination, Rotisserie |
| | Microwaves | Over-the-Range, Countertop, Built-In, Drawer, Drop-Down Door, Convection, Standard |
| | Ventilation | Wall Hood, Hood Liner / Insert, Under-Cabinet, Island Hood, Downdraft, Ceiling Hood, Remote Blower |
| | Warming Drawers | Warming Drawer, Vacuum Seal Drawer |
| Coffee | Coffee | Plumbed, Non-plumbed |
| Refrigeration | Freestanding Refrigerators | French Door, Side-by-Side, Bottom Freezer, Top Freezer, All Refrigerator (+ Counter Depth) |
| | Built-in Refrigerators | Refrigerator, Beverage Column |
| | Freezers | All Freezer (Built-in), Upright, Chest, Undercounter |
| | Refrigerator & Freezer Drawers | Refrigerator, Freezer, Combo Ref/Freezer |
| | Undercounter Refrigerators | Refrigerator, Beverage Center, Combo Ref/Freezer |
| | Beer Tappers | Indoor |
| | Wine Storage | Undercounter, Tall (built-in), Tall (freestanding), Wine & Refrigerator Combo |
| | Ice Makers | Residential |
| Kitchen Cleanup | Dishwashers · Drawer Dishwashers · Professional Dishwashers · Trash Compactors · Disposals | (brand / width / color) |
| Laundry | Washers | Top Load, Front Load, All-in-One Combo |
| | Dryers | Front Load Electric, Front Load Gas, Top Load Electric, Top Load Gas, Drying Cabinet, All-in-One Combo, Heat Pump |
| | Stacked | Electric, Gas, Heat Pump |
| | All-in-One | Heat Pump |
| | Steam Closets · Irons · Professional | |
| Outdoor | Outdoor Cooking | Grills, Side Burners & Modules, Griddles, Pizza Ovens, Kamado, Smokers, Warming Drawers |
| | Outdoor Refrigeration · Outdoor Ventilation · Outdoor Storage · Outdoor Heating | |

Also on the site, not in the Express Shop: Garage (Gladiator), Sinks & Faucets, HVAC (Trane; Series = Premier / Priority / Choice), Cabinetry.

### Filters (left rail), in order
Availability (In Stock, from the Express Shop's in-stock list) · Brand (A–Z) · Type (fixed order for refrigeration / laundry, else A–Z; any-of) · Collection · Width (numeric) · Gas type · Series · Color (Stainless Steel, Black, White, Matte White, Matte Black, Platinum Glass, Panel Ready, Other Colors) · Door (reserved). A filter appears only when the category has more than one value for it. Never show counts.

### Sort and paging
Default: Width, then name. Options: Width then name · Price low–high · Price high–low; search defaults to Best match. 25 / 50 / 100 per page (50 default); page number in the URL; back-to-top button.

### Product card
Photo (manufacturer's, on white) with brand badge and a green In Stock chip (top-left) when the Express Shop has it; brand (and Trane series) as an uppercase eyebrow; title; model/family number in monospace; tag chips (Type, fuel, "No longer available"); price line: `MSRP from $X,XXX`, or **Request A Quote** for never-priced-online brands (La Cornue, The Galley, Blanco, Zephyr, Fulgor Milano, Trane, Wolf Cabinetry, Bellmont, Innovation Cabinetry, Wood-Mode, Brookhaven, Ruvati). The only other number ever shown is the Express Shop's MAP-compliant **Current Price** on the product page when a model is in stock.

### Product page
Pickers: Size (numeric), then finish, hardware, trim, burners. Add to cart → slide-out cart: in stock → Current Price + Buy now (hands off to the Express Shop); not in stock → quote with the same install / connector / delivery choices as the shop.

### Wording
True Caliber (not True Residential / Caliber). Built-in Refrigerators on tiles; Disposals; Beer Tappers; Wine Storage; Refrigerator & Freezer Drawers; Undercounter Refrigerators; Stacked; All-in-One; Side Burners & Modules; Thermostats & Controls; Indoor Air Quality. Hyphenation: Built-in, Side-by-Side, Over-the-Range, Under-Cabinet, Dual Fuel (no hyphen), Non-plumbed. Model numbers in monospace, as the manufacturer writes them; matched with spacing, dashes and case stripped.
