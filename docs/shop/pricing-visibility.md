# When the shop shows a price on the card

*Added 11/10. Where the "Price in cart" reveal comes from and what lifts it.*

The storefront shows a number on a product card only when the manufacturer's advertising rules allow it; otherwise the card says **Price in cart** and the price appears once the unit is in the cart (`/api/shop/cart-prices`). Nothing about what we charge changes — only whether the number is advertised.

## A price shows on the card when any of these is true

1. **At or above the floor** — the model has a MAP / UMRP floor (ePASS RETAIL or brand UMRP price level; else **L1, for a brand set to "Use L1 as MAP"** (below); else the published MAP feed plus the brand/category rules in `data/shop-map-policy.json`) and our price is at or above it. Below the floor the card shows the floor with the ⓘ "our price is even lower in the cart" note.
2. **End of line** — the model is no longer subject to MAP because it is discontinued. Three sources, any one is enough:
   - ePASS **Model Obsolete / Being Discontinued** — carried by the feed's on-hand view (`Model_Obsolete`, `Model_BeingDiscontinued`, joined by the pull script).
   - NetSuite **Is Inactive / Discontinued** — from the item catalog export uploaded on the Upload Center. The export has to include that column; the 11/8 export did not, so this source is dark until the saved search carries it.
   - **MAP exempt** ticked by hand on the Store Catalog page.
3. **Open box** — the unit's ePASS serial type is **OPEN** (Andrew 11/10): open-box units are sold outside MAP and show their price. **DISPLAY** units do not — floor models keep the in-cart reveal so the showroom isn't sold off a chip at a time. On the card a DISPLAY unit is labelled **Floor Model**, an OPEN unit **Open Box**, so a shopper can see why one is priced and the other isn't.

## Use L1 as MAP, by brand (11/18)

Some brands carry only an **L1** price level in ePASS (Sharp, 11/18): no RETAIL, no brand MAP code, so the shop knew no floor and every card read **Price in cart**. The **Use L1 as MAP** box on the Express Assortment Catalog lists brands whose L1 counts as MAP:

- A model of a listed brand with **no RETAIL / brand MAP level** in ePASS takes its **L1** as the floor. Sold at L1 (the usual case: the shop sells at L1 when there is no RETAIL), the price shows on the card. An override or an outlet (Unique Sell Price) price below L1 shows L1 on the card with the ⓘ note, and the real price in the cart.
- A model with its own RETAIL / MAP level keeps that one. A model with no L1 either stays **Price in cart**.
- Clearance-list units of a listed brand follow the same rule (ePASS MAP level, else L1) instead of the MAP feed + `shop-map-policy.json` rule. Open-box units stay outside MAP as before.
- Matching is by the brand's shop name, its older name or its ePASS brand code, whole names only.
- Anyone who can edit the catalog can add or remove a brand; each change is audited (`shop_l1_map_brand_added` / `_removed`) and the shop follows on its next page load. Stored in `shop_l1_map_brands`.

To find candidates: the catalog's **price in cart** count (and the *Price in cart on the shop* filter) lists on-store models whose card hides the price, and the brand picker shows how many of each brand's models are in the cart for want of a MAP. Each row now says **price in cart** or **card shows MAP** under the price, and a model using L1 carries a **MAP = L1** tag.

## Checking the sources

The Store Catalog page header now counts, next to the feed snapshot time: **ePASS discontinued** (how many in-feed models carry the flag, or "feed lacks flags" when the last pull didn't deliver the Model columns), **NetSuite discontinued** (or "no column" when the last export had none) and **exempt by hand**. Per model, the MAP column shows a *discontinued* / *exempt* pill with the source in its tooltip.

## Code

`computeShopCatalogFresh()` in server.js: `mapExemptFor(model)` returns `"manual" | "netsuite" | "epass" | ""`; clearance units add `"open"` for an OPEN serial. `mapPublic` is what the catalog route uses to decide whether `price` goes out. `mapExemptStats` rides on the catalog for the Store Catalog header (`/api/shop/stock-models` → `mapExempt`). L1 as MAP: `shopL1MapBrandMatcher()` over `listShopL1MapBrands()`, read on every catalog build; the in-stock floor is in `shopStockItems()` (`l1Floor`, `mapFrom`, `card` on each model row), the clearance floor in the clearance loop (`epassLevelsByKey`). Routes: `GET/POST /api/shop/l1-map-brands`, `DELETE /api/shop/l1-map-brands/:brand`.
