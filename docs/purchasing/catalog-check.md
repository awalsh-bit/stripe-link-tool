# Catalog Check — NetSuite vs ePASS

Purchasing → **Catalog Check (NetSuite vs ePASS)** (`catalog-check.html`). Added 2026-10-25 for Andrew: NetSuite is to be the source of truth for brand, supplier and the merchandise hierarchy across Agility; this page shows where ePASS and NetSuite disagree so the fix can be made in NetSuite.

## How to use it

1. Export items from NetSuite (the saved search that produces `Items436.csv`: Brand, Display Name, Model Number, Type, Base Price, Supplier, Merch Category / Class / Subclass …).
2. Upload that file **once**, on **Ordering Report → step 2, NetSuite items & suppliers** (or ePASS Uploads → NetSuite Item Catalog — same thing). Since 10/26 either upload fills both tables: `netsuite_items` (item type, base price, short description, supplier — Ordering Report, Brand Sales, Inventory Lookup prices) and `model_brand_map` (brand, supplier, merch hierarchy, discontinued — the shop buckets, Quote Follow-Up, Inventory Lookup filters and this page). Rows with no Brand are skipped for the brand map (rebates, shipping charges — 299 in the 10/25 export). The upload's confirmation line says how many models got a hierarchy.

   Before 10/26 these were two separate imports and the doc pointed at "Shop Orders → NetSuite items", which never existed as a card — the model→brand import has always lived on ePASS Uploads. That detour is gone.
3. Open Catalog Check. Click a tile to filter, type in the box to narrow, **Download CSV** for the full list. **Refresh** re-runs the comparison (otherwise it's cached five minutes).

Nothing on this page writes anywhere. Fix the item in NetSuite → re-export → re-import → Refresh.

## What it compares

Every model ePASS knows — the model master, models on open orders, and on-hand stock — against the NetSuite item with the same model number (punctuation ignored).

| Tile | Meaning |
| --- | --- |
| In ePASS, not in NetSuite | ePASS sells or stocks it; NetSuite has no item at all. The most urgent group when NetSuite is the master. |
| No merch hierarchy | The NetSuite item has no Merch Category / Class / Subclass. |
| Brand differs | The two systems name a different brand (common aliases — SZ/Sub-Zero, GE/GE Appliances, KITCH/KitchenAid — are not flagged). |
| Supplier differs | ePASS's `Model.SupplierCode` vs NetSuite's Supplier, after stripping the vendor number and words like Corp / Inc / Distributing. |
| No supplier in NetSuite | ePASS has a supplier on the model, NetSuite doesn't. |
| NetSuite items ePASS has never sold or stocked | Informational — mostly repair parts and charges. |

The ePASS supplier comes from models on open orders (that feed carries `SupplierCode`) and from on-hand serials; models that are only in the sold-serial history show no ePASS supplier and are not flagged for it.

Two cross-tabs underneath: **ePASS product code → NetSuite merch class** (a clean catalog has one product code landing ≥ 80 % in one class) and **No hierarchy by ePASS product code** (which ePASS product codes the un-classified items carry — that tells you which NetSuite categories are missing, and how big each is). Then **Supplier agreement**: each ePASS supplier and the NetSuite suppliers its models carry, disagreements in red.

## What the 10/25 export showed before it was imported

`items/Items436.csv`, 22,699 items:

- **13,344 have a merch hierarchy; 9,355 don't.** The 9,355 are, almost entirely, repair parts: 9,061 inventory items with no base price and no supplier, led by Whirlpool (2,280), GE (1,705), Bosch (1,034), Sub-Zero (814), Wolf (615), Miele (534), Trane (342), Speed Queen (303). Descriptions are PCB / valve / seal / kit / assembly / board / motor. The rest are 102 Service items, 100 Non-inventory, 64 Other Charge (shipping tiers), 27 Discount, and 299 items with no brand at all (rebates and charges — 261 of them priced).
- **Supplier is filled on 12,487 items.** 880 items *with* a hierarchy have no supplier; 9,332 of the un-classified parts have none either. 14 suppliers: Composition Brands 3,929 · Whirlpool 1,715 · GE Appliances 1,524 · Sub-Zero Group South Central 1,277 · BSH 898 · Maple 663 · Almo 630 · Miele 420 · LG 412 · Fisher & Paykel 378 · Milestone 300 · True 293 · O'Rourke 47 · Paragon 1.
- Hierarchy in use: 5 categories (Kitchen Appliances 11,225 · Outdoor Living 1,472 · Laundry 571 · Appliance Cabinetry 55 · Plumbing 21), 35 classes, 136 subclasses. There is no category for parts, services or charges — which is exactly why the 9,355 are blank.

## Adding a merch category for repair parts in NetSuite

NetSuite's merchandise hierarchy is **versions → levels → nodes**; items attach to a *leaf* node. Your three columns are three levels (Category → Class → Subclass), so a parts category needs nodes at all three levels, and items attach to the subclass.

**1. Create the nodes** — Setup → Merchandise Hierarchy → **Hierarchy Manager**. Pick the current version, **Create Node**, give it a Name (and Description), and on the Hierarchy Versions subtab set the level / parent: e.g. `90 Parts & Service` (Category, no parent) → `902 Repair Parts` (Class, parent 90) → subclasses such as `9020 Appliance Parts`, `9022 HVAC Parts`, plus `904 Service Labor` / `906 Charges & Fees` if you want the service items and shipping tiers classified too. A node's level can't be changed after saving; only leaf nodes can hold items; a node with items can't be deleted. Nodes can also be created by CSV (Import Type **Classification**, Record Type **Merchandise Hierarchy Node**), but with a dozen nodes the screen is faster.

**2. Attach the 9,000 items by CSV** — Setup → Import/Export → **Import CSV Records**: Import Type **Items**, Record Type **Inventory Item**, data handling **Update**, and in the field mapping match on **Item Name/Number** (the Model Number column) and map your node column to the item's **Merchandise Hierarchy → Hierarchy Node**. The CSV needs just two columns: `Model Number`, `Hierarchy Node` (the node name, or its internal ID). Oracle's help confirms the Items import can "update existing items to assign them to a merchandise hierarchy" but doesn't print the exact field label, so expect the mapping screen to word it slightly differently — your implementation team will recognise it. The Service / Other Charge / Discount items are separate record types and would be separate imports — leave them for later; the parts are the bulk. Agility can produce that two-column CSV from the export as soon as the nodes exist: every un-classified inventory item with a brand → `9020 Appliance Parts`, Trane → `9022 HVAC Parts` (or whatever names you pick).

**3. Re-export, re-upload on the Ordering Report, Refresh Catalog Check** — the "No merch hierarchy" tile should drop to near zero and the "No hierarchy by product code" table should empty out.

Supplier is the other half: the 9,332 parts have no Supplier in NetSuite. If parts purchasing will run from NetSuite, that is a second CSV update (`Model Number`, `Supplier`) — the ePASS supplier on each part is visible on this page's CSV once the import is done, so the mapping can be lifted from there rather than keyed by hand.

## Routes

`GET /api/catalog-check` (`?issue=`, `?refresh=1`) · `GET /api/catalog-check.csv` (`?issue=`). Page grant `/catalog-check.html` (Purchasing). Engine in `lib/catalog-check.js`.


## NetSuite-first everywhere (10/26)

Andrew: "Agility needs to be all NetSuite formatted." A shared resolver (`lib/catalog-resolver.js`) now answers "what do we call this?" for every page: NetSuite first, ePASS only when NetSuite has no item for the model.

| Where | What changed |
| --- | --- |
| Storefront, Promo Item Builder, live clearance | The shop bucket (Ref, DW, Range, Oven, Vent, Lau, Outdoor …) comes from the NetSuite **merch class** (102/104/108/114 → Ref, 120 → DW, 130/132/136 → Range, 134 → CT, 138/142/144 → Oven, 140 → MW, 152 → Vent, 160 → Coffee, 204–210 → Lau, 806–812/820 → Outdoor). Accessory classes (107, 149, 154, 220, 816) and plumbing stay off the listings. A model with no NetSuite class falls back to the ePASS product-code map exactly as before. |
| Cash Ops, PO Health | Supplier names are NetSuite's (`0012 Whirlpool Corporation`), with the ePASS code shown beside them in small print. |
| Aging Inventory | Brand and description from NetSuite; each unit also carries `supplier`, `merchClass`, `merchSubclass` and a `catalogSource` of `netsuite` or `epass`. |
| Ordering Report, Brand Sales, Quote Follow-Up, inventory feed | Already NetSuite-named; unchanged. |

**Supplier aliases** (ePASS supplier code → NetSuite supplier) are resolved in this order: the manual map on Ordering Report → Settings (`epass_supplier_map`) · what the models say (the NetSuite supplier most of that code's models carry, when at least three models and 70 % agree) · the seeded defaults (WESTYE/WOLF → Sub-Zero Group, WP001 → Whirlpool, GEC → GE Appliances …) · a first-word match against the NetSuite supplier list · otherwise ePASS's own description, flagged `source: epass`. The **Supplier agreement** table on Catalog Check shows where that lands.

Caches: the resolver and Catalog Check refresh themselves five minutes after any change and immediately after a NetSuite import or an alias save.

Subclass overrides sit on top of the class map: **1104 Built-in Ice Machine → the Ice Makers bucket** (Andrew 10/26 — DEU1550IP/L, KUIX515SPS and the other 45 models in that subclass keep their own tab even though NetSuite files the subclass under 104 Built-in Refrigeration), and the panel / trim-kit / install-accessory subclasses that live inside product classes (1130, 1132, 1328, 1334–1336, 1404, 1406, 1409, 1413) are kept off the listings. Both tables are at the top of `lib/catalog-resolver.js`.
