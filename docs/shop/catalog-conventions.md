# How the wilsonappliance.com catalog is built and sorted

*Gavin's document, v2 (11/10, with §9 The look). From his site build (`sitegen/build_site.py`, `sitegen/categories.csv`, `sitegen/src/listing.js`), kept here so the Express Shop (shop.wilsonappliance.com) matches the main site's look, wording and order. Andrew 11/10: "customers shouldn't find coffee in different places on either side." Test site: https://wilsonappliancetestsite.netlify.app*

## What the Express Shop takes from this

- **Departments, in this order:** Cooking, Coffee, Refrigeration, Kitchen Cleanup, Laundry, Outdoor. (Garage, Sinks, HVAC, Cabinetry aren't stocked in the Express Assortment.)
- **Categories under each, in the site's order and wording** — Ranges, Rangetops, Cooktops, Wall Ovens, Microwaves, Ventilation, Warming Drawers · Coffee · Freestanding Refrigerators, Built-in Refrigerators, Freezers, Refrigerator & Freezer Drawers, Undercounter Refrigerators, Beer Tappers, Wine Storage, Ice Makers · Dishwashers, Drawer Dishwashers, Trash Compactors, Disposals · Washers, Dryers, Stacked, All-in-One · Outdoor Cooking, Outdoor Refrigeration. Ventilation lives under Cooking; Coffee is its own department.
- **Type** chips over the grid for the categories that have them (Gas / Dual Fuel / Electric / Induction; French Door / Side-by-Side / …; Top Load / Front Load; Grills / Pizza Ovens …), in the site's order, any-of when several are checked, shown only when two or more have stock.
- **No counts anywhere** — no "(12)" on menu rows, no "48 items" in the breadcrumb. Stock chips on tiles (In Stock / Low Stock) stay; those are availability, not counts.
- **Brands always A–Z.** Wording: Built-in Refrigerators, Disposals (never Disposers), Beer Tappers, Wine Storage, Refrigerator & Freezer Drawers, Undercounter Refrigerators, Stacked, All-in-One, Side Burners & Modules, Over-the-Range, Under-Cabinet, Dual Fuel (no hyphen), Non-plumbed.
- Model numbers match with spacing, dashes and case stripped; displayed in IBM Plex Mono.
- **The look (§9):** Familjen Grotesk for headings and product titles, Public Sans for body/UI, IBM Plex Mono for model numbers; warm stone `#F2F1EE` page, white cards with a 1px `#DDD8D0` border and 6px radius, brown `#67533E` primary buttons, copper `#BE7D3C` highlights, in-stock green `#21692C` chip and Buy-now. The shop and the landing page use these same tokens (the three fonts are self-hosted copies in `/fonts`; the shop's theme block is `<style id="site-theme">` in shop.html).

Where the shop differs, deliberately: its default sort is Best Sellers (the site's is width then name — the shop has no width data yet), and a category or Type only appears when something is in stock, since the shop sells only what's on the floor.

The menu is `MENU_TREE` in shop.html; categories and Types are keyed by NetSuite merchandise subclass codes (see merch-classes.md), so every category the website has — Rangetops, Freezers, Trash Compactors, Disposals, Stacked, All-in-One, Outdoor Refrigeration — is already wired and appears the first time a unit of that subclass is in stock. Beer Tappers has no NetSuite subclass yet; add one there and in `MENU_TREE` when it exists.

## Gavin's document (v2, verbatim)

# How the wilsonappliance.com catalog is built and sorted

*For the Express Shop (shop.wilsonappliance.com) to match the main site's look, wording and sort order. Everything
here comes straight from the site build (`sitegen/build_site.py`, `sitegen/categories.csv`, `sitegen/src/listing.js`).
Test site: https://wilsonappliancetestsite.netlify.app*

## 1. The shape of the catalog

Four catalogs, each a hub page of tiles → category pages → product pages:

| Catalog | Departments (in this order) |
|---|---|
| **Appliances** | Cooking, Coffee, Refrigeration, Kitchen Cleanup, Laundry, Outdoor, Garage* |
| **Sinks & Faucets** | Sinks |
| **HVAC** (Trane) | HVAC |
| **Cabinetry** | Cabinetry |

\* Garage (Gladiator) has pages but is left out of the Appliances menu.

A **product** on the site is a *model family*: one page per family (e.g. Wolf SRT486G and SRT486G-LP are one page with a
Size/Fuel picker), not one page per model number. Every model number in the family is searchable and has its own
anchor on that page.

## 2. Departments, categories and Types

Category tiles appear in exactly this order on each hub page (left to right, top to bottom). The **Type** column is
the "Type" filter on that category page (a product may carry more than one Type).

### Cooking
| Category | Types |
|---|---|
| Ranges | Gas, Dual Fuel, Electric, Induction |
| Rangetops | Gas, Induction, Electric |
| Cooktops | Gas, Induction, Electric, Downdraft Cooktop, Module |
| Wall Ovens | Single, Double, Steam, Speed, Combination, Rotisserie |
| Microwaves | Over-the-Range, Countertop, Built-In, Drawer, Drop-Down Door, Convection, Standard |
| Ventilation | Wall Hood, Hood Liner / Insert, Under-Cabinet, Island Hood, Downdraft, Ceiling Hood, Remote Blower |
| Warming Drawers | Warming Drawer, Vacuum Seal Drawer |

### Coffee
| Category | Types |
|---|---|
| Coffee | Plumbed, Non-plumbed (Miele calls plumbed "DirectWater") |

### Refrigeration
| Category | Types |
|---|---|
| Freestanding Refrigerators | French Door, Side-by-Side, Bottom Freezer, Top Freezer, All Refrigerator (+ "Counter Depth" on counter-depth models) |
| Built-in Refrigerators *(tile name; the category is "Built-in Refrigeration")* | Refrigerator, Beverage Column |
| Freezers | All Freezer (Built-in), Upright, Chest, Undercounter |
| Refrigerator & Freezer Drawers | Refrigerator, Freezer, Combo Ref/Freezer |
| Undercounter Refrigerators | Refrigerator, Beverage Center, Combo Ref/Freezer |
| Beer Tappers | Indoor (outdoor kegerators also show on Outdoor Refrigeration) |
| Wine Storage | Undercounter, Tall (built-in), Tall (freestanding), Wine & Refrigerator Combo |
| Ice Makers | Residential |

Rules: freestanding → Freestanding Refrigerators; built-in → Built-in Refrigerators. A model that installs either way,
or a freestanding model the maker calls built-in look / flush / zero clearance / panel-ready, shows on **both**.
Beverage centers live on Undercounter Refrigerators; beverage columns on Built-in. Kegerators / beer dispensers →
Beer Tappers (outdoor ones also on Outdoor Refrigeration).

### Kitchen Cleanup
| Category | Types |
|---|---|
| Dishwashers | *(none; brand/width/color filters only)* |
| Drawer Dishwashers | — |
| Professional Dishwashers | — (true commercial machines only, e.g. Miele Professional PFD) |
| Trash Compactors | — (has a Color filter incl. Panel Ready) |
| Disposals | — (**never "Disposers"**) |

Fisher & Paykel, Thermador and Viking "Professional" is a style name; those stay on Dishwashers.

### Laundry
| Category | Types |
|---|---|
| Washers | Top Load, Front Load, All-in-One Combo |
| Dryers | Front Load Electric, Front Load Gas, Top Load Electric, Top Load Gas, Drying Cabinet, All-in-One Combo, Heat Pump |
| Stacked | Electric, Gas, Heat Pump |
| All-in-One | Heat Pump |
| Steam Closets | — |
| Irons | — |
| Professional | Washer, Dryer |

All-in-One washer/dryer combos also show on Washers and Dryers as Type "All-in-One Combo". Heat-pump models get an extra
"Heat Pump" Type (they keep Electric too). Laundry pedestals are not a category.

### Outdoor
| Category | Types |
|---|---|
| Outdoor Cooking | Grills, Side Burners & Modules, Griddles, Pizza Ovens, Kamado, Smokers, Warming Drawers |
| Outdoor Refrigeration | — |
| Outdoor Ventilation | — |
| Outdoor Storage | — |
| Outdoor Heating | — |

Griddles / flat tops always go on Griddles, never Side Burners & Modules. Grill brands: True Caliber (formerly
True Residential + Caliber), Big Green Egg, Gozney, Urban Bonfire are in.

### Garage (Gladiator)
Garage Cabinets · Workbenches & Tool Storage · Wall Organization · Shelving & Overhead Storage · Kits & Accessories

### Sinks
| Category | Types |
|---|---|
| Workstations | Single Bowl, Double Bowl, Farmhouse, With DryDock, Workstations, WashStations, Work&WashStations |
| Kitchen Sinks | Single Bowl, Double Bowl, Farmhouse |
| Bar & Prep Sinks | BarStations, HydroStation |
| Laundry Sinks | — |
| Faucets & Taps | Kitchen Faucets, Taps, Tap Accessories |
| Dressers | — |
| Sink Accessories | Bottom Grates, Workstation Accessories, Strainers, Culinary Tools, Upper Deck, Soap Dispensers, Care Products, Cabinet Knobs & Pulls, Disposals |

### HVAC (Trane residential)
| Category | Types |
|---|---|
| Air Conditioners | Single-Stage, Multi-Speed, Variable Speed |
| Heat Pumps | Single-Stage, Multi-Speed, Variable Speed |
| Furnaces | Gas |
| Air Handlers | Variable Speed |
| Coils | — |
| Packaged Systems | Gas/Electric, Heat Pump, Air Conditioner, Dual Fuel |
| Thermostats & Controls | Smart Thermostats, Traditional Thermostats, Zoning |
| Indoor Air Quality | Air Cleaners, Air Quality Monitors, Dehumidifiers, Ventilators |

HVAC has a **Series** filter = Trane's tiers **Premier / Priority / Choice** (best first). Untiered products stay blank.

### Cabinetry
| Category | Types |
|---|---|
| Indoor Cabinetry | Shaker, Slim Shaker, Recessed Panel, Raised Panel, Slab, Beaded, Louvered |
| Outdoor Cabinetry | — |
| Garage Cabinetry | — |
| Cabinet Hardware | Knobs, Pulls, Cup Pulls, Edge Pulls, Appliance Pulls, Backplates, Door Hardware, Hooks, Other |

## 3. How a model is filed

`sitegen/categories.csv` is the rulebook: `brand, match_field, pattern, department, category, style`. Rules are tried
top to bottom per brand; **first match wins**; a row with no department leaves the model off the site. The pattern is a
regex against the manufacturer's own category, title or model number. Per-category code then refines the Type
(fridge type, dryer type, undercounter type, coffee type, wine type, drawer type, freezer type, heat pump).

Models a manufacturer drops stay on the site as **"No Longer Available"**: off category pages and filters, still found
by model-number search so specs and PDFs stay viewable.

## 4. Filters (left rail; full-screen with Apply/Clear on phones)

In this order. A filter only appears when the category has more than one value for it.

1. **Availability** — "In Stock" (from the Express Shop's in-stock list; hidden if the shop can't answer)
2. **Brand** — always A–Z
3. **Type** — fixed order for refrigeration/laundry types (French Door, Side-by-Side, Bottom Freezer, Top Freezer…;
   Front Load Electric, Front Load Gas, Top Load Electric, Top Load Gas…), otherwise A–Z. Checking several Types
   shows models matching **any** of them.
4. **Collection** — the brand's own line names (shows once a brand is checked)
5. **Width** — numeric order (24", 30", 36", 48"…)
6. **Gas type** — Natural Gas / Liquid Propane (multi)
7. **Series** — Trane tiers (Premier, Priority, Choice)
8. **Color** — Stainless Steel, Black, White, Matte White, Matte Black, Platinum Glass, Panel Ready, Other Colors (multi)
9. **Door** — reserved; not in use yet

**Never show counts** anywhere: no "(12)" after a filter value, no "48 results", no model counts on tiles.

## 5. Sort order and paging

- Default sort: **Width, then name** (narrowest first; A–Z within a width).
- Options: Width, then name · Price: low to high · Price: high to low. Search results default to **Best match**.
- 25 / 50 / 100 per page (**50** default); the page number rides in the URL so Back returns to the same page.
- Back-to-top button on catalog pages.

## 6. The product card

Top to bottom: photo (manufacturer's, product on white) with the brand badge in the corner and a green **In Stock**
chip (top-left) when the Express Shop has it; brand (and series for Trane) as a small uppercase eyebrow; title;
model/family number in monospace; tag chips (Type, fuel, "No longer available"); then price.

Price line:
- `MSRP from $X,XXX` — the manufacturer's public MSRP (lowest in the family).
- **Request A Quote** for brands we never price online: La Cornue, The Galley, Blanco, Zephyr, Fulgor Milano, Trane,
  Wolf Cabinetry, Bellmont, Innovation Cabinetry, Wood-Mode, Brookhaven, Ruvati.
- Never dealer or wholesale pricing. The only other number ever shown is the Express Shop's advertised
  **Current Price** (MAP-compliant) on the product page when a model is in stock.

## 7. Product page

- Pickers: Size (sorted numerically — tons as 1.5, 2.0 … 5.0 Ton), then finish, hardware, trim, burners, etc.
- Trane families that mix phases show model numbers in two boxes: Single-phase and 3-phase.
- Fisher & Paykel "Integrated" refrigeration shows as Panel Ready **and** Stainless Steel, with a
  "Stainless steel panels sold separately" note. Bosch fridges ending SP/NP = Panel Ready, SS/NS = Stainless.
- **Add to cart** → slide-out cart. In stock → "In Stock" box with Current Price + Buy now (hands off to the Express
  Shop). Not in stock → quote with the same install / connector / delivery choices as the shop.

## 8. Brand names and wording to keep consistent

- Brand lists and logos are **always A–Z**.
- **True Caliber** (not True Residential or Caliber) everywhere.
- **Built-in Refrigerators** on tiles; **Disposals** (not Disposers); **Beer Tappers**; **Wine Storage**;
  **Refrigerator & Freezer Drawers**; **Undercounter Refrigerators**; **Stacked**; **All-in-One**;
  **Side Burners & Modules**; **Thermostats & Controls**; **Indoor Air Quality**.
- Hyphenation as above: Built-in, Side-by-Side, Over-the-Range, Under-Cabinet, Dual Fuel (no hyphen), Non-plumbed.
- Model numbers match with spacing, dashes and case stripped (SRT486G = SRT-486G = srt486g).
- Model numbers display in monospace, as the manufacturer writes them.

## 9. The look (for the Express Shop to match)

Everything below is copied from `sitegen/src/site.css`. The complete stylesheet is in the repo if the shop wants
to borrow it wholesale; the header markup is in `sitegen/pages.py` (`head()` / top bar / main nav).

**Fonts** (Google Fonts, loaded in the page head):
- Headings and product titles: **Familjen Grotesk** (`--f-display`)
- Body and UI: **Public Sans** (`--f-body`), 15px / 1.55
- Model numbers: **IBM Plex Mono** (`--f-mono`), tabular numerals

**Colors** (CSS variables on `:root`):

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#F2F1EE` | page background (warm stone) |
| `--surface` | `#FFFFFF` | cards, header, panels |
| `--sunk` | `#EDEAE4` | sunken panels (model-number box) |
| `--ink` | `#24211E` | text, dark bars |
| `--muted` | `#655E56` | secondary text, eyebrows |
| `--line` | `#DDD8D0` | borders, dividers |
| `--accent` | `#67533E` | primary buttons, links (brown) |
| `--accent-soft` | `#F1ECE5` | tinted panels |
| `--copper` | `#BE7D3C` | highlights, focus ring, "added to cart" |
| `--copper-soft` | `#F6EBDD` | showroom / notice panels |
| in-stock green | `#21692C` (text `#1D5E27`, tint `#E3F1E5`, border `#BFD9C3`) | In Stock chip, stock box, Buy now |
| radius `--r` | `6px` | every button, card and input |

**Components**
- Button: 12px 18px padding, 600 weight, 15px, 6px radius, 1px border. Primary = `--accent` background, white text.
  Buy now = in-stock green. Secondary = white with `--line` border.
- Card: white, 1px `--line` border, 6px radius; photo on white with the brand badge top-right (26px tall, white
  pill); eyebrow in 11px uppercase `--muted`, letter-spacing .09em; title in Familjen Grotesk 600; model number in
  IBM Plex Mono; price line "MSRP from $X,XXX" or "Request A Quote".
- In Stock chip on cards: green `#21692C` background, white 11px bold text, 3px radius, top-left of the photo.
- Top bar (above the header): Schedule Service, Financing, Rebates, Showroom, Express Shop, More ▾ · phone ·
  Directions · account icon · cart icon with a count badge. Header: logo left, LUXURY APPLIANCES · APPLIANCES ·
  HVAC · CABINETRY · SINKS & FAUCETS in uppercase letter-spaced Familjen Grotesk, search on the right.
- Page width 1180px with 20px side padding; catalog grid 3 cards across on desktop.
