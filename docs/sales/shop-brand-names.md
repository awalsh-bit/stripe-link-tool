# One name per brand

*Added 11/18. Andrew: "the brand list is a bit of a mess. We need to map the ePASS brand codes over to the actual full names of the brands, the proper spelling and format in NetSuite."*

The shop's brand list showed one maker under two spellings (BOSCH and Bosch, ASKO and Asko) and showed ePASS codes as if they were brands (Art, Fabr, Fulgo, GOZ, JA). Every unit now carries one name for its brand, spelled the way NetSuite spells it.

*Later the same day, Andrew: "I'm good with updating other places like Promo builder too, there's no reason other than the five character epass brand field limit that we use those."* So the same table now names brands across Agility, not only in the shop. The list of screens is below.

## How a unit gets its brand

In this order:

1. **The model's own NetSuite record.** If the model is in NetSuite, its brand there is the brand. This is how an LG Signature model stays LG Signature under ePASS code LG, and a Chateau range stays Chateau under code CORFE.
2. **Its ePASS brand code.** JA is JennAir, GOZ is Gozney, FABR is Faber, FULGO is Fulgor Milano, ART is Alfresco, WP is Whirlpool.
3. **Whatever name came with it,** when that is a NetSuite brand under another spelling (BOSCH), an ePASS code (Art), or an ePASS description (SUBZERO, JENN-AIR, BLUE STAR).
4. **The name the shop used before,** for a brand the table has never heard of. Nothing is dropped.

Last, across the finished list, two spellings of one name become one.

## Where the names live

`data/shop-brand-names.json`. Edit it and push to fix a name or add a code.

- `names`: NetSuite's brand list, 82 names.
- `codes`: every ePASS brand code and the brand it belongs to, 165 codes.
- `epass`: each code's description in the ePASS brand master.

It was built from three files on the laptop: the mapping workbook (`data/ePASS Brand Code to NetSuite Brand - Website Mapping.xlsx`), the NetSuite item export (`items/Items10.csv`), and the ePASS brand master (`odbc/lookup-Brand.csv`).

## Choices made in the table

- **Ten codes set by hand** to a NetSuite brand: BENCH to Bosch, MVAC and MIPRO to Miele, CHATE to Chateau, AMG to American Made Grills, GAL to The Galley, TRAMI and RUNTR to Trane, TRUEC to True, AMER to American Standard.
- **AMER differs from the workbook.** The workbook's AMER row says Sub-Zero, and its note says that is about two miscoded parts. The ePASS brand master and NetSuite both say American Standard, so the table does.
- **78 codes have no NetSuite brand** (Weber, Fire Magic, Napoleon, Elica, Danby and others). They show the ePASS description, tidied into ordinary capitals. Four were corrected to the maker's own spelling: Wood-Mode, TopBrewer, TrueFlame, Arctic Air. If one of these brands shows up in the shop looking wrong, fix it in the file.
- **Two parts codes are left out:** BSH and MAXIT have no brand of their own.
- **Cafe has no accent,** because NetSuite's does not.

## What else changes with the names

- **Brand links in ads** (`shop.html?brand=JennAir`) now find units that used to be listed as JA.
- **Brand-level install and accessory rules** are keyed by brand name. A unit whose model is not in NetSuite used to miss its brand's rules, because it was listed under its code. It now gets them.
- **Brands not sold online stay off.** A unit is checked by its new name, its old name and its code, so a rename can never let one through. This was tested against all 167 ePASS codes.

## Where the names are used

| Screen | What changed |
| --- | --- |
| Express shop | Brand list, tiles, product pages (the first round). |
| Promo Builder | The inventory list and its brand filter. Typing the old code (WP, MTAG) in the search box still finds the brand. |
| Promo cards | Online Shop promos and the Secret Menu show the same names. |
| Inventory Lookup | Brand column. Searching by brand still matches the ePASS code as well as the name. |
| Aging Inventory | Brand column. The search box matches the code too. |
| Brand Sales | Brand rows. See the note below. |
| Quote Follow-Up | Brand filter. |
| Clearance list | Brand names. |
| Customer purchase history | Brand on each unit a customer bought (it was the ePASS description in capitals: JENN-AIR, SPEEDQUEEN, GE CAFE). |
| Inventory feed | The Brand column of `/api/feeds/inventory.csv` and `.json`. See the note below. |

Two of these are read outside the building:

- **The inventory feed.** Whatever reads it (the website, a spreadsheet) now gets `Maytag` where it got `Mtag` and `JennAir` where it got `JA`, for units whose model is not in NetSuite. Units whose model is in NetSuite already carried the NetSuite brand. If anything downstream matches on the old short names, it needs the new ones.
- **Brand Sales** goes to suppliers. A code's brand is still decided the way it was: by what most of that code's models say in NetSuite. Only when NetSuite has nothing for a code does the table answer, where the ePASS description or a guess answered before. A handful of codes that never matched a supplier in Agility's default list now can (JA and FSP under Whirlpool, CAFE under GE Appliances, SZ under Sub-Zero Group, BENCH under BSH, LG under LG), because their names are finally spelled the way the list spells them. NetSuite's own supplier for a brand still comes first.

Inventory Lookup's supplier column can also fill in where it was blank: for a model that is not in NetSuite, the supplier is looked up by brand, and "JennAir" finds one where "JENN-AIR" did not.

## What was left alone

- **The Ordering Report (Written Models).** It already shows NetSuite's brand first. For a model not in NetSuite it shows the ePASS code, and its supplier settings are keyed by that code, so renaming would break them.
- **Service screens.** The brand on a service call is what was entered for the customer's appliance. Service Journey stays Cayden and Jack's.
- **Catalog Check.** It exists to show ePASS's value beside NetSuite's, so it shows the code.
- **Shop Catalog.** It shows the name with the code after it (`JennAir · JA`), on purpose.

## After pushing

Open the shop and pull down the brand list. Each brand should appear once. Do the same with the brand filter in Promo Builder. Anything odd in either is a code or a spelling the table lacks: send the entry and it is a one-line fix.

Both screenshots sent on 11/18 were checked entry by entry: the 19 entries in the first become 14 brands, and the 19 in the second become 17 (MTAG joins Maytag, SHARP joins Sharp; Marve, PROF, Scot and WP become Marvel, GE Profile, Scotsman and Whirlpool; LG, LG Signature and LG Studio stay three brands, as they are in NetSuite).

## For developers

- `lib/shop-brand-names.js`: `createShopBrandNamer(table, brandMap)` returns `nameBrand({ model, brandCode, brand })`. `unifyBrandSpellings(...lists)` merges spellings in place. `loadBrandTable()` reads the file once per process. `brandIndex(table)` gives the lookups (`forCode`, `known`, `spelled`). `properBrandName(code, name)` is the short form for a screen with no NetSuite record to ask.
- `lib/brand-names.js` (Brand Sales, Quote Follow-Up, clearance list): `EPASS_BRAND_NAMES` is the file's codes over the older guesses, and `createBrandResolver` asks the table after the NetSuite majority and before the ePASS description.
- `lib/catalog-resolver.js` (Inventory Lookup, Aging Inventory): `brandNameFromEpass` asks the table first; `resolveModel` spells a NetSuite brand NetSuite's way.
- `lib/promo-cards-postgres.js`: `resolvePromoCards` takes `nameBrand` from `promoContext` in `server.js`.
- `lib/epass-customers-postgres.js`: `epassCustomerHistory` names each unit with `properBrandName`.
- `server.js`: `promoContext` and `inventoryFeedRows` build a namer. The feed blocks on the new name, the old name and the code.
- `server.js`: `loadShopDataFromDisk` reads the table as `brandTable`. `computeShopCatalog` builds one namer and uses it for the clearance listings and, through `shopStockItems({ nameBrand })`, the stock listings. `brandBlocked` is called with the new name, the old name and the code.
- With the file missing or malformed the namer returns the old name, so the shop behaves as before.
