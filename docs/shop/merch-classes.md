# NetSuite merchandise classes in Agility

*Andrew 11/10: "make sure all instances of product codes in Agility are updated to NetSuite Merch Class and Merch Subclass."*

## The rule

What kind of thing a model is comes from **NetSuite's merchandise subclass** (`1352 All Gas Range`, `2112 Front Load Washing Machine`…). The ePASS product code (`RAGAS`, `WASHF`) is legacy: it is used only when NetSuite hasn't classified a model, and it is translated to a subclass the moment it's read (`SUBCLASS_BY_EPASS_PROD`). Nothing new is written against product codes.

`lib/merch-classes.js` is the one place that knows the vocabulary (34 classes, 135 subclasses, generated from the NetSuite item catalog export) and the two cross-references:

- `SUBCLASS_BY_EPASS_PROD` — legacy product code → subclass, for unclassified models.
- `ADDON_PRODUCT_BY_SUBCLASS` — subclass → the product code whose install/connector set applies; the seed the first `bySubclass` table was generated from, and still the fallback for a subclass the file doesn't list. A subclass with no entry (trash compactors, disposals, steam closets, accessories) has no installation on file and gets no prompt.

## What now keys on subclass

| Place | Before | Now |
|---|---|---|
| Every shop unit (`/api/shop/catalog`) | `product` | `subclass` (code) + `product` kept |
| Express shop menu, categories, Type chips (`MENU_TREE` in shop.html) | ePASS product codes | subclass codes, per the website's category tables |
| Install / connector prompt in the shop cart | `addons.byProduct[product]` | `addons.byKey[subclass]`, product code only as fallback |
| Website services list (`/api/shop/services`) | `byKey` by product code, `byCategory` → product code | `byKey` by subclass (legacy product keys still answered), `byCategory` → subclass |
| `servicesKey` on the stock lookup, handoff lines, quote lines | product code (blank for most of the website's catalog) | subclass code — present for every model NetSuite has classified; `merchClass` / `merchSubclass` names alongside |
| Top-deals groups (washers / dryers under $999) | product codes | subclasses 2110–2116 / 2040–2044 |
| Express install program settings (Shop Orders) | `bucket\|PRODUCT` keys, product codes listed | `bucket\|subclass` keys, labelled "2112 Front Load Washing Machine"; previously saved product-code keys are read as their subclass so nothing ticked falls out |
| Storefront bucket (Laundry, Refrigeration…) | already NetSuite class first | unchanged (`shopBucketFor`) |

## Where product codes still appear, on purpose

- `BUCKET_BY_EPASS_PROD` / `SHOP_STOCK_CATEGORY_BY_PRODUCT` — bucket fallback for an unclassified model.
- `data/shop-addons.json` `bySubclass` — since 11/10 the authoritative install/connector set per subclass (98 subclasses), written out so the taxonomy can say more than the product codes could: a single wall oven offers only the single install, a double only the double, a wine column or beverage center skips the water line, a chest freezer is set in place, a ventless dryer gets no vent kit or gas kit, a pro range gets the pro install, an induction rangetop the pro rangetop install without gas, a unitized laundry center hoses plus dryer cord and vent. `bySubclassNotes` says why each refined row differs; `byProduct` is kept only as the fallback for a unit NetSuite hasn't classified.
- `variants` — brand/model rules inside a subclass, checked first: Bosch SHV/SGV dishwashers are panel-ready (their NetSuite finish is the placeholder "Appl"), Fisher & Paykel `DD…` models take the DishDrawer install, and Cove / Miele / Gaggenau / Thermador dishwashers take the pro install (that brand list is a first cut for Cayden's team).
- `panelPairs` + NetSuite's Primary Finish — for a subclass whose set has both a no-panel and a with-panel install, the model's finish decides: "Panel Ready" (or Integrated / Panel Required) → only the with-panel install (`…-panel`), any real finish → only the no-panel install (`…-std`), no finish or a placeholder like "Appl" → both, as before. The finish comes from `netsuite_items` (the item catalog upload on the Upload Center), so a fresh item export is what tightens the prompts.

The result is one `servicesKey` per unit (`1330`, `1330-std`, `1330-panel`, `1330-pro`, `1330-drawer`) computed once per catalog build (`servicesKeyFor()` in `lib/merch-classes.js`); the shop cart, the stock lookup, the handoff lines and `/api/shop/services` `byKey` all read the same key, so the website never needs the rules.
- The ePASS feed and Inventory Lookup still carry `prod` as a fact about the ePASS record (display only).
- Service / warranty records have a `product` field that is the appliance *type as typed by the customer* ("dishwasher") — a different thing, untouched.

## Keeping it current

NetSuite adds a subclass → add it to `MERCH_SUBCLASSES` (re-run the generator against the latest item export), give it an install set in `ADDON_PRODUCT_BY_SUBCLASS` if one applies, and place it in the shop's `MENU_TREE` / the website `byCategory` table. The brand-side mapping (ePASS brand code → NetSuite brand, `data/ePASS Brand Code to NetSuite Brand - Website Mapping.xlsx`) is a separate workbook; brand names on the shop already come from the NetSuite catalog, so it isn't wired into code yet.
