# Website ↔ Express shop integration

*Added 11/9 for the new wilsonappliance.com build. Two pieces on Agility's side; the website owns browsing and its own quote cart for orderable models, and hands in-stock purchases into the Express shop, which owns ZIP check, pricing, add-ons, scheduling, accounts and payment.*

## 1. Stock lookup — `GET https://shop.wilsonappliance.com/api/shop/stock?models=A,B,C`

Up to 50 model numbers per call (comma-separated; spacing, dashes and case don't matter). Plain GET, no key, no cookies. CORS is allowed for `wilsonappliance.com`, `www.wilsonappliance.com` and `wilsonappliancetestsite.netlify.app` (`SHOP_PARTNER_ORIGINS` in Render to change). Rate limit 120 calls per 10 minutes per address; responses are cacheable for 60 seconds. The site can call it from the browser on a product page or from a build step — either is fine.

```json
{
  "asOf": "2026-11-09T14:02:11.000Z",
  "mapAsOf": "2026-11-12T08:14:03.000Z",
  "paused": false,
  "shop": "https://shop.wilsonappliance.com",
  "models": [
    { "model": "WM4000HWA", "brand": "LG", "description": "4.5 cu. ft. Front Load Washer",
      "category": "Lau", "image": "https://shop.wilsonappliance.com/api/promo/photo/…",
      "inStock": true, "available": 5, "newUnits": 5, "outletUnits": 1, "outletOnly": false,
      "price": 899, "priceSource": "shop", "mapPrice": 899, "belowMap": false, "priceInCart": false, "expressEligible": true,
      "inquireOnly": false, "addUrl": "https://shop.wilsonappliance.com/shop.html?add=WM4000HWA" },
    { "model": "KDTM404KPS", "brand": "KitchenAid", "description": "44 dBA Dishwasher",
      "inStock": true, "available": 2, "newUnits": 2, "outletUnits": 0, "outletOnly": false,
      "price": null, "priceSource": null, "mapPrice": 1199, "belowMap": false, "priceInCart": true, "inquireOnly": false,
      "addUrl": "https://shop.wilsonappliance.com/shop.html?add=KDTM404KPS" },
    { "model": "KFDD948SSS", "brand": "KitchenAid", "description": "48\" Dual Fuel Range",
      "inStock": false, "available": 0, "newUnits": 0, "outletUnits": 0,
      "price": 9999, "priceSource": "map", "mapPrice": 9999, "belowMap": false, "priceInCart": false,
      "inquireOnly": false, "addUrl": null },
    { "model": "SRT486G", "brand": "Sub-Zero", "description": "…",
      "inquireOnly": true, "inStock": false, "available": 0, "price": null, "mapPrice": null, "priceSource": null, "priceInCart": false,
      "addUrl": null, "note": "Quoted in person — ask for a specialist." },
    { "model": "ZZZ123", "brand": "", "description": "", "inStock": false, "available": 0,
      "price": null, "mapPrice": null, "priceSource": null, "priceInCart": false, "inquireOnly": false, "addUrl": null }
  ]
}
```

How to read each model:

| Field | Meaning |
|---|---|
| `inStock`, `available` | Wilson's own ATS rule: **sealed** units on hand, not written to a ticket, not held or reserved to an order. Open-box and display units never count — they're `outletUnits`, and `outletOnly: true` means that's all there is (the `addUrl` still works; the shop puts the open-box unit in the cart and says so). |
| `price` with `priceInCart: false` | The manufacturer lets us advertise this price. Show it. |
| `price: null`, `priceInCart: true` | We sell it online but may not advertise the number. Show "See price in cart" and the button; the shop reveals it once it's in the cart. |
| `price` with `belowMap: true` | Our price is below the advertised floor; the number given *is* the floor. Show it with "our price is even lower in the cart." |
| `inStock: false` with a `price` and `priceSource: "map"` (**added 11/12**) | Not in stock — a special-order model. The number is the manufacturer's minimum advertised price (UMRP / MAP) from the RetailDeck floor table, which a dealer may always advertise. Show it as the price; there is no `addUrl`, so it goes through the site's own quote cart. Before 11/12 this came back `price: null`. |
| `inStock: false`, `price: null` | RetailDeck has no floor for that model number (or Agility has never heard of it). Show "Call for price" / request a quote. |
| `priceSource` | Where `price` came from: `"shop"` = Wilson's own selling price; `"map"` = the manufacturer's advertised floor; `null` = no advertised price. |
| `mapPrice` | The RetailDeck floor for the model whenever there is one, in stock or not — for a "list price" line or a strike-through. It never replaces the rules above: an in-stock model that is "see price in cart" still has `price: null`. Always `null` for inquire-only brands. |
| `mapAsOf` (top level) | When the floor table was last refreshed from RetailDeck (nightly). |
| `itemModel`, `displayModel` (**added 11/12**) | The model number swap — see below. `model` is always exactly what the site sent. |
| `inquireOnly: true` | Sub-Zero, Wolf, Cove, Gaggenau (the Shop Orders "brands not sold online" list). No cart button; route to a specialist. |
| `paused: true` (top level) | Online ordering is briefly paused; prices come back null. Show stock, hide buy buttons, point to the phone. |
| `expressEligible` | Qualifies for the same-day install program. |
| `servicesKey`, `brandServicesKey`, `panelReady`, `merchClass`, `merchSubclass` | Which installation services and install accessories go with this model — see 2b and 2c. Treat the two keys as opaque strings. |

### The model number swap (Miele)

A Miele is a material number in ePASS and NetSuite (`12496980`) and a model name everywhere a person sees it (`G 5892 SCVi SL`). Agility uses the same rule as Inventory Lookup: when NetSuite's *Display Name* for an item is different from its item number, that name is the model people know.

- **Ask by either one.** `?models=G 5892 SCVi SL` and `?models=12496980` return the same stock, price and services. Spacing, dashes and case don't matter (`g5892scvisl` works).
- **`model`** comes back exactly as sent, so the site can match the answer to its own row. **`itemModel`** is the number ePASS knows (`12496980`); **`displayModel`** is the name to show (`G 5892 SCVi SL`), blank for a model that has no swap.
- **`addUrl` and the cart handoff use the item number**, so an in-stock Miele goes into the shop cart as in stock whichever way the site named it.
- **MAP price** is looked up under the name the site sent, the item number and the display name — RetailDeck lists some under one, some under the other.
- If two items share one display name (colour variants), the one with stock answers.
- A name is only swapped when it is not a real item number of its own, so an ordinary model is never redirected.

**Separating models:** use commas. A piece with spaces in it is read as one model when it is a name Agility knows; otherwise it is split on the spaces, as before.

Never in this response: unit ids, serials, cost, location, or anything about a customer.

**Why there is no "all prices" download.** The floor table is RetailDeck's data (about 108,000 models) and reaches Agility through a private link; this lookup answers for the models a page actually shows, 50 at a time, and is rate-limited. Republishing the whole table from a public address would hand RetailDeck's file to anyone who found it.

### 1b. Everything in stock, in one call — `GET /api/shop/stock/in-stock`

For an "Availability → In Stock" filter the site needs the whole list, not 50 at a time. This returns every model number with sealed stock sellable online right now — no prices, no counts — as `{ asOf, count, models: ["WM4000HWA", …] }`. Same origins as the stock lookup, no rate limit (it's served from a precomputed snapshot), cacheable for two minutes; the list changes at most every 15 minutes with the ePASS feed. Match on the model number with spacing, dashes and case removed. `warming: true` with an empty list means the server just restarted and hasn't built its first snapshot yet (under a minute); treat it as "unknown," not "nothing in stock."

## 2. Hand a cart to the shop — `POST https://shop.wilsonappliance.com/api/shop/handoff`

This is the way to do it from the website's own cart. POST the shopping list, get a token and a URL, send the shopper there:

```
POST /api/shop/handoff          Content-Type: application/json
{ "items": [ { "model": "WM4000HWA", "qty": 1 }, { "model": "DLEX4000W", "qty": 1 } ],
  "zip": "78737", "source": "website", "ref": "cart-8f2a" }

200 → { "token": "k3Jx…", "url": "https://shop.wilsonappliance.com/shop.html?cart=k3Jx…",
        "expiresAt": "2026-11-16T14:02:11.000Z",
        "items": [ { "model": "WM4000HWA", "qty": 1, "inStock": true, "available": 5, "inquireOnly": false }, … ] }
```

Up to 20 lines, 10 of each; `zip`, `source` and `ref` are optional (`ref` is whatever the site wants to find the cart by later). Tokens last 7 days, can be opened more than once (a shopper may reload), and nothing in them is personal. CORS, rate limit and origins are the same as the stock lookup; 60 handoffs per 10 minutes per address. Send `msrp` if you like; the shop ignores it — special-order lines never show a price.

**Send every cart line, in stock or not (11/9).** Each line in the response carries `inStock`, `available`, `inquireOnly` and `special: true` when it isn't on the floor. In the shop:

- In-stock lines are picked as real units and sold exactly as before.
- Lines that aren't in stock — and inquire-only brands (Sub-Zero, Wolf, Cove, Gaggenau) — go in the cart as **Special order** with "Request pricing" where the price would be. They get the same installation and connector prompts (when the product has them) and the same delivery-or-pickup choice as in-stock lines. Nothing about them is charged.
- If the cart holds both kinds, checkout runs as today for the in-stock lines (card on file, team confirms) and the special-order lines leave as **one quote request that names the order number**. If the cart is special-order only, the button reads **Request pricing**: the shopper still signs in or registers (that profile is the customer on the quote), no card step, and the request is filed on its own.
- Either way the quote goes to DIBS: a claimable flag on every consultant's dashboard and an unclaimed row on the Quote Follow-Up board, with the add-ons, delivery choice and the shopper's profile attached. The customer gets nothing automated; the consultant who claims it calls.

One boundary stays: the shop's ZIP gate. A shopper outside the delivery area can't enter the shop at all, so **out-of-area quotes should still go through the quote request below**, not the handoff. Inside the area, send everything to the handoff.

If a model sold between the website and the click, it simply arrives as a special-order line and the cart says so. When the order (or the quote) is filed, the handoff row records what it became, so "did the website cart convert?" is a query, not a guess.

Why a token rather than a long URL: the list and its options never live in an address, the link can't be edited to add items, the website doesn't have to know how the shop names anything, and every cart that came from the website is on record with its source.

**Also fine for texts and ads:** `shop.html?add=MODEL,MODEL*2` builds a cart straight from a plain link (the `addUrl` in the stock lookup). Same behaviour, no record.

Also available from earlier: `?dept=`, `?sub=`, `?brand=`, `?q=` deep links (see landing.md).

## 2b. Services & delivery prices for the website's own cart — `GET /api/shop/services`

The website's cart (the quote path, and any address the Express shop won't sell to) should show the same installation, connector and delivery prices the shop does, regardless of ZIP. This returns them — Wilson's own prices, so they're public — from the same file the shop checkout uses:

```json
{ "addons": {
    "connectors": [ { "id": "dryer-vent-kit", "name": "Dryer Vent Kit", "price": 27.95, "taxable": true, "description": "", "durationMin": null }, … ],
    "installs":   [ { "id": "washer-standard-install", "name": "Washer - Standard Install", "price": 79.95, "taxable": true, "description": "", "durationMin": 30 }, … ],
    "byKey":      { "2112": { "installs": ["washer-standard-install", "washer-condo-install", "stacking-kit-add-on-install"],
                              "connectors": ["washer-fill-hoses-5ft-rubber", "washer-fill-hoses-5ft-stainless", "washer-fill-hoses-10ft-stainless"] },
                    "1330-panel": { "installs": ["dishwasher-with-panel-install"], "connectors": ["dishwasher-install-kit", "universal-nema-5-15-cord"] }, … },
    "byCategory": { "Washers|Front Load": "2112", "Washers": "2112", "Dishwashers": "1330", … },
    "requires":   { "washer-standard-install": [ ["washer-fill-hoses-5ft-stainless", "washer-fill-hoses-10ft-stainless"] ], … },
    "byBrand":    { "LG|2112": { "installs": [], "connectors": [], "products": ["WDP6W"] } },
    "products":   { "WDP6W": { "model": "WDP6W", "brand": "LG", "description": "…", "merchSubclass": "Front Load Pedestals and Risers",
                               "inStock": true, "available": 3, "inquireOnly": false } } },
  "delivery": { "id": "white-glove-delivery", "name": "White Glove Delivery + Haul Away", "price": 49.95, "regularPrice": 89.95, "note": "…", "scheduleNote": "…" },
  "pickup":   { "id": "customer-pickup", "name": "Customer Pickup", "price": 0 },
  "uncrate":  { "id": "uncrate-set-in-place", "name": "Uncrate, set in place", "price": 0, "description": "…" },
  "taxRate": 0.0825, "taxNote": "…", "areaNote": "…" }
```

(`byBrand` and `products` are empty until a brand addition is made on Online Shop Orders; the LG pedestal above is an illustration of the shape.)

How to use it: take a model's `servicesKey` from the stock lookup (also on every handoff line) and show `byKey[servicesKey].installs` and `.connectors` as the choices for that line. **Treat `servicesKey` as an opaque string.** (Since 11/10 it is the NetSuite merchandise subclass code, e.g. `2112`, sometimes with a refinement suffix — `1330-std`, `1330-panel`, `1330-pro`, `1330-drawer` — chosen on our side from the model's finish and brand so a stainless dishwasher is offered only the standard install, a panel-ready built-in only the "with panel" install, a Cove or Miele the pro install, a Fisher & Paykel DishDrawer the drawer install. Every key, plain or suffixed, is in `byKey`; the stock lookup also returns the readable `merchClass` / `merchSubclass` names and `panelReady` (`true` / `false` / `null` when NetSuite has no finish on file). Older product-code keys are still answered by `byKey` through the changeover.)

**Brand additions (11/10).** A second map, `addons.byBrand`, holds what a particular brand adds for a subclass — its pedestal, stacking kit, detergent. Each stock-lookup and handoff line carries `brandServicesKey` (e.g. `"LG|2112"`, blank when there is nothing); show `byBrand[brandServicesKey].installs` and `.connectors` alongside the `byKey` set (same ids, same catalog), and `.products` — model numbers — as accessory products. `addons.products[model]` gives `{ brand, description, inStock, available, inquireOnly }` for each; an in-stock one is sold like any model (price and `addUrl` from the stock lookup), an out-of-stock one belongs on the quote path. Treat `brandServicesKey` as opaque too.

A model has a key whenever NetSuite has classified it, which is nearly the whole site catalog. For the rest, fall back to `addons.byCategory`: a map from the website's own category and Type names — `"Ranges|Dual Fuel"`, `"Dryers|Front Load Gas"`, `"Dishwashers"` — to a `servicesKey`. Try `"Category|Type"` first, then `"Category"`. Names are exactly as the site's catalog-conventions.md spells them. Categories with no installation on file (Trash Compactors, Disposals, Steam Closets, Irons…) aren't in the map; show no install choices for those. `requires[installId]` lists groups where one connector must accompany that install (the shop pre-ticks the first and locks it — the whole rule is in 2c). A line with no install gets the free "Uncrate, set in place." Add delivery or pickup once per cart. Cache it for ten minutes. Send the chosen add-ons on the quote request as `items[].addons: [{ id, name, qty, price }]` so the consultant sees exactly what was picked at what price, and `fulfillment: { "method": "delivery" | "pickup" }` for the cart's choice.

Outside the delivery area the prices still show; the quote is simply flagged "outside delivery area" on your side and a consultant sorts the delivery out with the customer. (A sell-but-schedule-manually zone is a later round.)

## 2c. Add-on services & connectors — the full logic

*Added 11/12. Everything the Express shop does between "this appliance is in the cart" and "here is the total", written out so the website's own cart can behave the same way from the same data. Nothing in this section needs to be hard-coded on the site: every list, price, pairing and key comes from `GET /api/shop/services` and changes there the moment Wilson changes it on Online Shop Orders. The tables in the appendix are a picture of the defaults, for reading — not something to copy into code.*

### The pieces

| Kind | Where it is in the response | What it is | Price and tax |
|---|---|---|---|
| **Installation service** | `addons.installs[]` | Labor by Wilson's install team ("Dishwasher - Standard Install"). Carries `durationMin`. | Wilson's price. `taxable` is per item: labor on freestanding product is taxed, built-in labor is not. |
| **Install accessory** ("connector") | `addons.connectors[]` | The part an install uses: cord, fill hoses, gas kit, vent kit, water line. | Wilson's price, taxable. |
| **Accessory product** | `addons.byBrand[…].products`, described in `addons.products` | A real model with its own stock: a pedestal, a stacking kit, the maker's detergent. | Priced and stocked like any model — through the stock lookup, never from this list. |
| **Uncrate, set in place** | `uncrate` | A $0 line that says what happens at the door when no installation was chosen. | $0, not taxed. |
| **Delivery / pickup** | `delivery`, `pickup` | Once per cart. | Delivery is taxed; pickup is free. |

Every install and accessory has an `id`. Most are readable slugs (`washer-standard-install`); an ePASS misc charge that Wilson has assigned on Shop Orders arrives as `misc:<ePASS code>`. Treat ids as opaque strings and never build one.

### Where a model's set comes from (Agility's side — the site never has to repeat this)

Agility works out one `servicesKey` per model and the site only looks the key up. For the record, the key is chosen like this, first match wins:

1. **Merch subclass.** NetSuite's merchandise subclass for the model (`2112 Front Load Washing Machine`). A model NetSuite has not classified falls back to the subclass its ePASS product code translates to. No subclass → no key.
2. **Brand or model exception** inside the subclass. Today there are three, all dishwashers: Bosch `SHV…` / `SGV…` models are panel-ready (`1330-panel`), Fisher & Paykel `DD…` models take the DishDrawer install (`1330-drawer`), and Cove, Miele, Gaggenau and Thermador take the pro install (`1330-pro`).
3. **Finish.** Where a subclass has both a no-panel and a with-panel install (dishwashers, built-in refrigeration, columns, undercounter, ice machines, warming drawers), NetSuite's Primary Finish decides: "Panel Ready", "Panel Required" or "Integrated" → the with-panel install only (`…-panel`); any real finish → the no-panel install only (`…-std`); no finish on file, or a placeholder → the plain key, which offers both and lets the shopper say.
4. Otherwise the plain subclass code.

What each subclass offers is edited on **Online Shop Orders → Installs & accessories by merch class** (a whole class, one subclass, or a drop for one subclass), and **Installs & accessories by brand** adds a second layer for one brand (see `services-map.md`). Until someone edits there, the shop runs on `data/shop-addons.json`. Either way the result is what `byKey` and `byBrand` return.

### Step 1 — what to offer on one cart line

For each appliance line:

1. **Find the key.** Use the line's `servicesKey` (stock lookup, handoff response). If it is blank, look up `addons.byCategory["Category|Type"]`, then `addons.byCategory["Category"]`, using the site's own category and Type names. Still nothing → this line has no add-ons; go straight to the uncrate rule below.
2. **Base set.** `base = addons.byKey[key]` → `{ installs: [ids], connectors: [ids] }`.
3. **Brand additions.** `brand = addons.byBrand[line.brandServicesKey]` → `{ installs, connectors, products }`. Usually there is none. It only ever adds; it never removes anything from the base set.
4. **Show three groups, in this order** (these are the shop's headings):
   - **Installation services** — `base.installs`, then any `brand.installs` not already listed.
   - **Required Install Accessories** — `base.connectors`.
   - **Made for your {brand}** — `brand.connectors` that are not already in `base.connectors`, then `brand.products` (accessory products, below).
5. **Resolve each id** against `addons.installs` and `addons.connectors` for its name and price. An id that is in neither list is skipped silently — that is how a misc charge ePASS has retired drops out. If every group comes up empty, there is nothing to ask.

Keep the order the arrays come in; it is the order Wilson assigned them, the usual choice first. Each row is a checkbox with the name and the price. Nothing is ticked to begin with. The shop's lead-in reads "Installation and required accessories for your {brand} {model}", with "(panel-ready)" after the model when the line's `panelReady` is `true`, and the two buttons are **No thanks** and **Add selected**.

A shopper may tick more than one install on the same appliance. Many sets are a main install plus optional extras — a gas range offers the range install *and* a gas conversion; a front-load washer the standard install, the condo install, and the stacking-kit install — so the installs are checkboxes, not a single choice.

### Step 2 — the accessories an install cannot happen without

`addons.requires[installId]` is a list of **groups**. Each group is a list of accessory ids meaning "one of these":

```json
"dryer-standard-install": [ ["dryer-cord", "universal-gas-install-kit"], ["dryer-vent-kit"] ]
```

reads: a dryer install needs a cord **or** a gas kit, **and** a vent kit. The rule, applied every time a box changes:

1. Take every install that is currently ticked on this line and collect its groups.
2. **Narrow each group to the accessories actually on screen for this line.** A group with nothing on screen does not apply. This step is what makes one rule work for every product: the same dryer install on an electric dryer (offers the cord, not the gas kit) requires the cord; on a gas dryer it requires the gas kit; on a ventless dryer (no vent kit offered) the vent-kit group simply falls away. An induction range is offered the pro install without a gas kit for the same reason.
3. For each group that is left, **one accessory must be ticked.** If none is, tick the first one in the group's order.
4. **Lock the one that satisfies the group** — it cannot be unticked while the install is ticked — and label it "Required with your install".
5. Where a group has alternatives (5 ft or 10 ft stainless hoses), the shopper may choose the other one; the site should **move** the tick and the lock to it, so the line ends up with exactly one from the group. *(The Express shop's own prompt today leaves the first one ticked as well when the alternative is chosen, and the shopper takes the extra off in the cart. The site should swap.)*
6. Untick the install and its locks come off; whatever is ticked stays ticked and can now be removed.

Accessories that no ticked install requires are ordinary optional checkboxes (the rubber hoses, the dryer steam kit, the range cord on a dual-fuel range). An accessory can also be bought with no install at all — a shopper who hooks up their own dryer still needs the cord.

`requires` is enforced by the page, not by the server: Agility prices whatever add-ons arrive. The site should not let a cart leave with an install and none of its required accessories.

### Step 3 — in the cart

- **Every add-on belongs to the appliance it was chosen for.** In the shop each add-on line carries the appliance's line id, and is listed under that appliance. Two washers in one cart can have different choices.
- **Quantity.** Each add-on goes in at 1, with − and + on its line. Agility accepts 1 to 20 of an add-on per appliance.
- **Removing the appliance removes its add-ons with it**, and the shop says which ones went ("Removed Washer - Standard Install, Washer Fill Hoses - 5ft Stainless along with it").
- **Removing a required accessory.** If taking away the last unit of an accessory would leave an install on the same appliance with nothing from that group, the shop asks first: "{accessory} is required for {install}. Removing it will also remove that installation from your order. Remove both?" Yes removes both; no leaves the cart alone. If another accessory from the same group is still on the line (the 10 ft hoses), the removal goes through without a question.
- **Removing an install** leaves its accessories in the cart; each can then be taken off on its own. If that was the appliance's last install, the shop says "Installation removed — the appliance will be uncrated and set in place instead."
- **How each line is described under its name:** "Professional installation" for an install; "Required install accessory" for an accessory that appears in any `requires` group; "Accessory" for the rest.

### Uncrate, set in place

On a **delivery** order, every appliance that has **no install** chosen for it gets the free `uncrate` line under it, so the order tells the customer and the warehouse what will happen at the door. Per appliance, not per cart: a washer with an install and a dryer without one shows the uncrate line under the dryer only. Not shown on a pickup order, and not shown under an accessory product (a pedestal or a box of detergent is not uncrated and set in place). The shopper never picks it or removes it — it appears and disappears as installs are added and taken away, and Agility adds it to the order itself.

### Accessory products ("Made for your LG")

`byBrand[key].products` is a list of model numbers; `addons.products[model]` describes each: `{ brand, description, merchSubclass, inStock, available, inquireOnly }`.

- **In stock** → it is sold like any model. Get its price and `addUrl` from the stock lookup (prices are never in the services list), and add it to the cart as **a line of its own**, not as an add-on under the appliance. The shop offers it only while a sealed unit is on hand, shows "in stock" beside it, and reveals the price once the appliance is in the cart.
- **Not in stock** → the shop does not offer it at all. On the website's quote cart it can be shown and added as a quote line.
- Do not offer a product that is already in the cart, or the appliance to itself.
- Products are never required, never locked, and never get an uncrate line.

### Delivery, pickup, tax and the total

One delivery choice per cart: `delivery` (White Glove Delivery + Haul Away, `price`, with `regularPrice` to strike through) or `pickup` (free, no delivery fee, no uncrate lines). The total the shop shows, and Agility recomputes at checkout:

```
items      = sum of appliance prices (accessory products included — they are appliances here)
addons     = sum of add-on price × qty
taxable    = items
           + add-ons whose `taxable` is true (price × qty)
           + delivery fee
           − promo discount (the shop only; a quote has none)
tax        = round(taxable × taxRate, 2)          taxRate is 0.0825
total      = items + addons + delivery − discount + tax
```

Two worked examples at today's prices:

| | Front-load washer, delivered | Built-in dishwasher, delivered |
|---|---|---|
| Appliance | $899.00 | $1,199.00 |
| Install | Washer - Standard Install $79.95 (taxable) | Dishwasher - Standard Install $179.95 (**not** taxable) |
| Required accessory | Fill hoses, 5 ft stainless $29.95 | Dishwasher Install Kit $29.95 |
| Delivery | $49.95 | $49.95 |
| Taxable amount | $1,058.85 | $1,278.90 |
| Tax at 8.25% | $87.36 | $105.51 |
| **Total** | **$1,146.21** | **$1,564.36** |

Outside the delivery area the same prices are shown; a consultant settles delivery with the customer.

### What travels where

| Path | What happens to the add-ons |
|---|---|
| **Quote request** (`POST /api/shop/quote-request`) | Send them on each line: `items[].addons: [{ "id", "name", "qty", "price" }]`, plus `fulfillment: { "method": "delivery" \| "pickup" }` for the cart. Up to 12 add-ons per line, quantity 1–20. Agility stores them **as sent** — name and price included — so the consultant sees what the shopper picked at the price the site showed, and adds them into the estimate on the lead. Nothing is charged. |
| **Handoff to the shop** (`POST /api/shop/handoff`) | The handoff carries **models and quantities only**. Add-ons chosen on the website do not travel; the shop asks its own "Complete the setup" question when the cart arrives, and prices everything itself. So for in-stock lines headed to the shop, the site does not need to ask at all — and if it does, the shopper is asked twice. *As built today the shop opens that question for one appliance when several arrive together (the last one added); special-order lines keep an "Add installation" button in the cart, in-stock lines do not.* |
| **Special-order lines inside the shop** | Same prompt, same pairing rules. Their add-ons are shown with prices but are **quoted, not charged**: they are left out of the card total and leave with the quote request for that line. |
| **In-stock order in the shop** | Add-ons are sent as `{ id, qty, itemId }`. Agility ignores any id it does not know, takes every price from its own list (never from the page), adds the uncrate lines, and computes tax and total as above. |

A quote-request line with add-ons:

```json
{ "model": "DLEX4000W", "qty": 1,
  "addons": [ { "id": "dryer-standard-install", "name": "Dryer - Standard Install", "qty": 1, "price": 79.95 },
              { "id": "dryer-cord",             "name": "Dryer Cord",               "qty": 1, "price": 29.95 },
              { "id": "dryer-vent-kit",         "name": "Dryer Vent Kit",           "qty": 1, "price": 27.95 } ] }
```

### What can change without notice

Prices, names, which installs a subclass offers, brand additions, the required pairings, the delivery offer and the tax rate are all Wilson's to change, and a change on Online Shop Orders is live in the response within about ten minutes. So: fetch the list (cache it ten minutes, not longer), look everything up by id and key at the moment it is shown, and do not store a price, a name or a map on the site.

## 3. Quote request → DIBS — `POST https://shop.wilsonappliance.com/api/shop/quote-request`

For the website's own quote cart: models that aren't in stock (ordered), special orders, or a shopper whose ZIP is outside the delivery area. Same CORS/origins as above; 20 requests per hour per address.

```
POST /api/shop/quote-request        Content-Type: application/json
{ "customer": { "firstName": "Pat", "lastName": "Lee", "email": "pat@example.com", "phone": "512-555-1212",
                "zip": "78666", "city": "San Marcos", "address": "", "contactMethod": "Text" },
  "items": [ { "model": "PRD364WDHU", "qty": 1, "color": "Stainless", "notes": "" } ],
  "notes": "Kitchen remodel, need it by January",
  "reason": "out_of_area",            // out_of_stock · out_of_area · special_order · other
  "source": "website", "ref": "quote-91c" }

200 → { "ok": true, "reference": "5bzDrClUXXYQvgIU", "inArea": false,
        "items": [ { "model": "PRD364WDHU", "qty": 1, "brand": "Thermador", "description": "…",
                     "inStock": false, "available": 0, "inquireOnly": false } ] }
```

Required: first and last name, a 10-digit phone, a valid email, a 5-digit ZIP, at least one model (up to 25 lines, 20 each). `contactMethod` is `Text`, `Email` or `Phone Call`. Field errors come back as `400 { error }` in plain words the site can show.

What happens in Agility: the request is recorded; every sales consultant gets a claimable **Website Quote Request** flag on their dashboard (first DIBS wins, the rest disappear — the same lead mechanics as a service client lead); an unclaimed **WEBSITE QUOTE** row appears on the Quote Follow-Up board with the items, reason and ZIP, and it becomes the claimer's when they take DIBS; the floor gets one email with reply-to set to the customer. It shows on the DIBS Lead Report like any other lead. **Nothing automated goes to the customer** — the consultant who claims it makes the contact — so the website should show its own thank-you ("a Wilson consultant will reach out within one business day") and may show the `reference`.

The response tells the site what Agility knows about each line (brand, description, whether it's in stock after all, `inquireOnly` for Sub-Zero/Wolf/Cove/Gaggenau) in case it wants to say "good news — this one's in stock" before the consultant calls.

## What the website should not do

Hold or display a price for longer than a minute, compute a price itself, or show a buy button for anything with `inquireOnly` or `paused`. The shop re-prices at checkout regardless, so the worst case is a stale number on a card, not a wrong charge.

## Appendix — the add-on defaults, written out

*A picture of `data/shop-addons.json` as of 11/12, generated from the file with the same code the shop uses to build `byKey`. This is what the shop offers until someone edits the map on Online Shop Orders; after that the live `GET /api/shop/services` response is the truth and this page may be behind. For reading and review — the site should not copy any of it.*

### A. Installation services (62)

| id | Name | Price | Taxable | Minutes |
|---|---|---|---|---|
| `kalamazoo-cabinet-installation` | Kalamazoo Cabinet Installation | $199.95 | no | 120 |
| `coffee-system-non-plumbed-install` | Coffee System - Non-Plumbed Install | $99.95 | no | 60 |
| `coffee-system-plumbed-install` | Coffee System - Plumbed Install | $149.95 | no | 105 |
| `cooktop-standard-install` | Cooktop - Standard Install | $139.95 | no | 60 |
| `pro-rangetop-install` | Pro Rangetop Install | $189.95 | no | 90 |
| `cooktop-modular-standard-install` | Cooktop - Modular Standard Install | $124.95 | no | 75 |
| `door-reversal-freestanding-refrigerator` | Door Reversal - Freestanding Refrigerator | $29.95 | yes | 45 |
| `dishwasher-standard-install` | Dishwasher - Standard Install | $179.95 | no | 60 |
| `dishwasher-with-panel-install` | Dishwasher - With Panel Install | $219.95 | no | 75 |
| `pro-dishwasher-install` | Pro Dishwasher Install | $299.95 | no | 75 |
| `dish-drawer-install` | Dish Drawer Install | $249.95 | no | 90 |
| `outdoor-grill-standard-install` | Outdoor Grill - Standard Install | $249.95 | no | 90 |
| `outdoor-grill-kalamazoo-install` | Outdoor Grill - Kalamazoo Install | $389.95 | no | 120 |
| `outdoor-sideburner-install` | Outdoor Sideburner Install | $69.95 | no | 60 |
| `grill-access-door-drawer-install` | Grill Access Door/Drawer Install | $79.95 | no | 45 |
| `built-in-ice-machine-install` | Built-In Ice Machine Install | $449.95 | no | 90 |
| `built-in-ice-machine-install-with-panel` | Built-In Ice Machine Install - With Panel | $599.95 | no | 105 |
| `washer-standard-install` | Washer - Standard Install | $79.95 | yes | 30 |
| `washer-condo-install` | Washer - Condo Install | $179.95 | yes | 45 |
| `dryer-standard-install` | Dryer - Standard Install | $79.95 | yes | 30 |
| `dryer-condo-install` | Dryer - Condo Install | $179.95 | yes | 45 |
| `side-vent-dryer-add-on-install` | Side Vent Dryer - Add-On Install | $99.95 | yes | 30 |
| `dryer-door-reversal` | Dryer - Door Reversal | $29.95 | yes | 30 |
| `stacking-kit-add-on-install` | Stacking Kit - Add-On Install | $49.95 | yes | 30 |
| `pedestal-basic-add-on-install` | Pedestal - Basic - Add-On Install | $24.95 | yes | 30 |
| `pedestal-washer-add-on-install` | Pedestal - Washer - Add-On Install | $79.95 | yes | 30 |
| `gas-conversion-cooktop` | Gas Conversion - Cooktop | $129.95 | no | 45 |
| `gas-conversion-rangetop` | Gas Conversion - Rangetop | $179.95 | no | 45 |
| `gas-conversion-all-gas-range` | Gas Conversion - All-Gas Range | $249.95 | yes | 45 |
| `gas-conversion-dual-fuel-range` | Gas Conversion - Dual-Fuel Range | $199.95 | yes | 45 |
| `gas-conversion-dryer` | Gas Conversion - Dryer | $149.95 | yes | 30 |
| `microwave-with-trim-kit-install` | Microwave - With Trim Kit Install | $159.95 | no | 60 |
| `microwave-countertop-no-trim-kit` | Microwave - Countertop, No Trim Kit | $19.95 | yes | 15 |
| `microwave-drawer-install` | Microwave Drawer Install | $159.95 | no | 60 |
| `over-the-range-microwave-install` | Over-the-Range Microwave Install | $169.95 | no | 60 |
| `microwave-built-in-install` | Microwave - Built-In Install | $149.95 | no | 60 |
| `oven-single-install` | Oven - Single Install | $159.95 | no | 60 |
| `oven-double-install` | Oven - Double Install | $199.95 | no | 90 |
| `oven-steam-non-plumbed-install` | Oven - Steam, Non-Plumbed Install | $129.95 | no | 75 |
| `oven-steam-plumbed-install` | Oven - Steam, Plumbed Install | $179.95 | no | 105 |
| `oven-speed-install` | Oven - Speed Install | $139.95 | no | 60 |
| `oven-pizza-countertop-install` | Oven - Pizza, Countertop Install | $129.95 | yes | 30 |
| `oven-pizza-built-in-install` | Oven - Pizza, Built-In Install | $329.95 | no | 90 |
| `range-standard-electric-install` | Range - Standard Electric Install | $89.95 | yes | 45 |
| `range-standard-gas-install` | Range - Standard Gas Install | $89.95 | yes | 60 |
| `range-pro-install` | Range - Pro Install | $299.95 | yes | 90 |
| `refrigerator-freestanding-install` | Refrigerator - Freestanding Install | $89.95 | yes | 45 |
| `refrigerator-built-in-no-panels-install` | Refrigerator - Built-In, No Panels Install | $299.95 | no | 120 |
| `refrigerator-built-in-with-panel-install` | Refrigerator - Built-In, With Panel Install | $379.95 | no | 150 |
| `refrigerator-built-in-column-stainless-install` | Refrigerator - Built-In Column, Stainless Install | $379.95 | no | 120 |
| `refrigerator-built-in-column-with-panel-install` | Refrigerator - Built-In Column, With Panel Install | $399.95 | no | 150 |
| `refrigerator-undercounter-built-in-no-panel-install` | Refrigerator - Undercounter Built-In, No Panel Install | $79.95 | no | 75 |
| `refrigerator-undercounter-built-in-with-panel-install` | Refrigerator - Undercounter Built-In, With Panel Install | $129.95 | no | 90 |
| `refrigerator-undercounter-drawers-install` | Refrigerator - Undercounter Drawers Install | $139.95 | no | 90 |
| `built-in-vacuum-seal-drawer-install` | Built-In Vacuum Seal Drawer Install | $79.95 | no | 60 |
| `hood-under-cabinet-install` | Hood - Under Cabinet Install | $99.95 | no | 60 |
| `hood-wall-install` | Hood - Wall Install | $289.95 | no | 90 |
| `hood-island-install` | Hood - Island Install | $399.95 | no | 120 |
| `hood-liner-insert-install` | Hood Liner/Insert Install | $329.95 | no | 75 |
| `cattura-downdraft-install` | Cattura Downdraft Install | $399.95 | no | 120 |
| `warming-drawer-no-panel-install` | Warming Drawer - No Panel Install | $74.95 | no | 60 |
| `warming-drawer-with-panel-install` | Warming Drawer - With Panel Install | $99.95 | no | 75 |

### B. Install accessories (11)

| id | Name | Price | Taxable |
|---|---|---|---|
| `universal-nema-5-15-cord` | Universal NEMA 5-15 Cord | $12.95 | yes |
| `dryer-vent-kit` | Dryer Vent Kit | $27.95 | yes |
| `dryer-cord` | Dryer Cord | $29.95 | yes |
| `washer-fill-hoses-5ft-rubber` | Washer Fill Hoses - 5ft Rubber | $21.95 | yes |
| `washer-fill-hoses-5ft-stainless` | Washer Fill Hoses - 5ft Stainless | $29.95 | yes |
| `washer-fill-hoses-10ft-stainless` | Washer Fill Hoses - 10ft Stainless | $39.95 | yes |
| `dryer-steam-kit` | Dryer Steam Kit | $24.95 | yes |
| `range-cord` | Range Cord | $34.95 | yes |
| `dishwasher-install-kit` | Dishwasher Install Kit | $29.95 | yes |
| `universal-gas-install-kit` | Universal Gas Install Kit | $34.95 | yes |
| `refrigerator-water-supply-stainless` | Refrigerator Water Supply - Stainless | $21.95 | yes |

### C. What each `servicesKey` offers

An indented row (↳) is a refinement of the subclass above it: `-std` and `-panel` are chosen by the model's finish, the others by brand or model. A plain key that has `-std` / `-panel` rows under it is what a model gets when NetSuite has no finish on file — both installs, and the shopper says which.

| `servicesKey` | Subclass | Installs | Connectors |
|---|---|---|---|
| `1022` | Freestanding French Door | `refrigerator-freestanding-install` | `refrigerator-water-supply-stainless` |
| `1024` | Freestanding Quad Door | `refrigerator-freestanding-install` | `refrigerator-water-supply-stainless` |
| `1026` | Freestanding Side-by-side | `refrigerator-freestanding-install` | `refrigerator-water-supply-stainless` |
| `1028` | Single Door Bottom Mount | `refrigerator-freestanding-install`, `door-reversal-freestanding-refrigerator` | `refrigerator-water-supply-stainless` |
| `1030` | Compact | `refrigerator-freestanding-install`, `door-reversal-freestanding-refrigerator` | — |
| `1032` | Top Freezer | `refrigerator-freestanding-install`, `door-reversal-freestanding-refrigerator` | `refrigerator-water-supply-stainless` |
| `1036` | Upright Freezer | `refrigerator-freestanding-install`, `door-reversal-freestanding-refrigerator` | — |
| `1038` | Chest Freezer | `refrigerator-freestanding-install` | — |
| `1104` | Built-in Ice Machine | `built-in-ice-machine-install`, `built-in-ice-machine-install-with-panel` | `refrigerator-water-supply-stainless` |
| `1104-panel` | ↳ panel-ready finish | `built-in-ice-machine-install-with-panel` | `refrigerator-water-supply-stainless` |
| `1104-std` | ↳ real finish on file (not panel-ready) | `built-in-ice-machine-install` | `refrigerator-water-supply-stainless` |
| `1110` | All Refrigerator Column | `refrigerator-built-in-column-stainless-install`, `refrigerator-built-in-column-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1110-panel` | ↳ panel-ready finish | `refrigerator-built-in-column-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1110-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-column-stainless-install` | `refrigerator-water-supply-stainless` |
| `1114` | All Wine Column | `refrigerator-built-in-column-stainless-install`, `refrigerator-built-in-column-with-panel-install` | — |
| `1114-panel` | ↳ panel-ready finish | `refrigerator-built-in-column-with-panel-install` | — |
| `1114-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-column-stainless-install` | — |
| `1116` | Freezer Column | `refrigerator-built-in-column-stainless-install`, `refrigerator-built-in-column-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1116-panel` | ↳ panel-ready finish | `refrigerator-built-in-column-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1116-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-column-stainless-install` | `refrigerator-water-supply-stainless` |
| `1118` | Refrigerator with Combination Drawers | `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1118-panel` | ↳ panel-ready finish | `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1118-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-no-panels-install` | `refrigerator-water-supply-stainless` |
| `1119` | Refrigerator with Refrigerator Drawers | `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1119-panel` | ↳ panel-ready finish | `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1119-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-no-panels-install` | `refrigerator-water-supply-stainless` |
| `1120` | Refrigerator with Freezer Drawers | `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1120-panel` | ↳ panel-ready finish | `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1120-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-no-panels-install` | `refrigerator-water-supply-stainless` |
| `1122` | Wine with Refrigerator Drawers | `refrigerator-built-in-column-stainless-install`, `refrigerator-built-in-column-with-panel-install` | — |
| `1122-panel` | ↳ panel-ready finish | `refrigerator-built-in-column-with-panel-install` | — |
| `1122-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-column-stainless-install` | — |
| `1124` | Built-in French Door | `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1124-panel` | ↳ panel-ready finish | `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1124-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-no-panels-install` | `refrigerator-water-supply-stainless` |
| `1126` | Built-in Side-by-Side | `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1126-panel` | ↳ panel-ready finish | `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1126-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-no-panels-install` | `refrigerator-water-supply-stainless` |
| `1128` | Built-in Single Door Bottom Mount | `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1128-panel` | ↳ panel-ready finish | `refrigerator-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1128-std` | ↳ real finish on file (not panel-ready) | `refrigerator-built-in-no-panels-install` | `refrigerator-water-supply-stainless` |
| `1312` | Undercounter Refrigerator | `refrigerator-undercounter-built-in-no-panel-install`, `refrigerator-undercounter-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1312-panel` | ↳ panel-ready finish | `refrigerator-undercounter-built-in-with-panel-install` | `refrigerator-water-supply-stainless` |
| `1312-std` | ↳ real finish on file (not panel-ready) | `refrigerator-undercounter-built-in-no-panel-install` | `refrigerator-water-supply-stainless` |
| `1316` | Undercounter Beverage Center | `refrigerator-undercounter-built-in-no-panel-install`, `refrigerator-undercounter-built-in-with-panel-install` | — |
| `1316-panel` | ↳ panel-ready finish | `refrigerator-undercounter-built-in-with-panel-install` | — |
| `1316-std` | ↳ real finish on file (not panel-ready) | `refrigerator-undercounter-built-in-no-panel-install` | — |
| `1318` | Undercounter Drawer Refrigerator | `refrigerator-undercounter-drawers-install` | — |
| `1320` | Undercounter Combination Drawers | `refrigerator-undercounter-drawers-install` | — |
| `1322` | Undercounter Freezer Drawers | `refrigerator-undercounter-drawers-install` | — |
| `1324` | Undercounter Wine Reserve | `refrigerator-undercounter-built-in-no-panel-install`, `refrigerator-undercounter-built-in-with-panel-install` | — |
| `1324-panel` | ↳ panel-ready finish | `refrigerator-undercounter-built-in-with-panel-install` | — |
| `1324-std` | ↳ real finish on file (not panel-ready) | `refrigerator-undercounter-built-in-no-panel-install` | — |
| `1330` | Built-in Dishwasher | `dishwasher-standard-install`, `dishwasher-with-panel-install` | `dishwasher-install-kit`, `universal-nema-5-15-cord` |
| `1330-drawer` | ↳ DishDrawer | `dish-drawer-install` | `dishwasher-install-kit`, `universal-nema-5-15-cord` |
| `1330-panel` | ↳ panel-ready finish | `dishwasher-with-panel-install` | `dishwasher-install-kit`, `universal-nema-5-15-cord` |
| `1330-pro` | ↳ Pro dishwasher | `pro-dishwasher-install` | `dishwasher-install-kit`, `universal-nema-5-15-cord` |
| `1330-std` | ↳ real finish on file (not panel-ready) | `dishwasher-standard-install` | `dishwasher-install-kit`, `universal-nema-5-15-cord` |
| `1340` | Dual Fuel Pro Range | `range-pro-install`, `gas-conversion-dual-fuel-range` | `universal-gas-install-kit`, `range-cord` |
| `1342` | Induction Pro Range | `range-pro-install` | `range-cord` |
| `1344` | All Gas Pro Range | `range-pro-install`, `gas-conversion-all-gas-range` | `universal-gas-install-kit` |
| `1346` | Specialty Pro Range | `range-pro-install` | — |
| `1348` | Dual Fuel Range | `range-standard-gas-install`, `gas-conversion-dual-fuel-range` | `universal-gas-install-kit`, `range-cord` |
| `1350` | Induction Range | `range-standard-electric-install` | `range-cord` |
| `1352` | All Gas Range | `range-standard-gas-install`, `gas-conversion-all-gas-range` | `universal-gas-install-kit` |
| `1354` | Electric Range | `range-standard-electric-install` | `range-cord` |
| `1356` | Gas Cooktop | `cooktop-standard-install`, `gas-conversion-cooktop` | `universal-gas-install-kit` |
| `1358` | Gas Downdraft Cooktop | `cooktop-standard-install`, `gas-conversion-cooktop` | `universal-gas-install-kit` |
| `1360` | Induction Cooktop | `cooktop-standard-install` | — |
| `1362` | Induction Downdraft Cooktop | `cooktop-standard-install` | — |
| `1364` | Specialty Cooktop | `cooktop-modular-standard-install` | — |
| `1366` | Electric Cooktop | `cooktop-standard-install` | — |
| `1368` | Electric Downdraft Cooktop | `cooktop-standard-install` | — |
| `1370` | Induction Rangetop | `pro-rangetop-install` | — |
| `1371` | Gas Rangetop | `pro-rangetop-install`, `gas-conversion-rangetop` | `universal-gas-install-kit` |
| `1372` | Specialty Rangetop | `pro-rangetop-install` | — |
| `1376` | Single Electric Wall Oven | `oven-single-install` | — |
| `1380` | Double Electric Wall Oven | `oven-double-install` | — |
| `1382` | Microwave Combo Oven | `oven-double-install` | — |
| `1384` | Steam Combo Oven | `oven-steam-non-plumbed-install`, `oven-steam-plumbed-install` | — |
| `1386` | Steam Oven | `oven-steam-non-plumbed-install`, `oven-steam-plumbed-install` | — |
| `1388` | Speed Oven | `oven-speed-install` | — |
| `1394` | Drop Down Door Microwave | `microwave-built-in-install` | — |
| `1396` | Drawer Microwave | `microwave-drawer-install` | — |
| `1398` | Over-the-Range Microwave | `over-the-range-microwave-install` | — |
| `1404` | Trim Kit Countertop Microwave | `microwave-countertop-no-trim-kit`, `microwave-with-trim-kit-install` | — |
| `1406` | Microwave Trim Kits | `microwave-with-trim-kit-install` | — |
| `1408` | Warming Drawer | `warming-drawer-no-panel-install`, `warming-drawer-with-panel-install` | — |
| `1408-panel` | ↳ panel-ready finish | `warming-drawer-with-panel-install` | — |
| `1408-std` | ↳ real finish on file (not panel-ready) | `warming-drawer-no-panel-install` | — |
| `1412` | Vacuum Drawer | `built-in-vacuum-seal-drawer-install` | — |
| `1426` | Undercabinet Hood | `hood-under-cabinet-install` | `universal-nema-5-15-cord` |
| `1428` | Wall Mount Hood | `hood-wall-install` | `universal-nema-5-15-cord` |
| `1430` | Island Mount Hood | `hood-island-install` | `universal-nema-5-15-cord` |
| `1432` | In-Ceiling Hood | `hood-island-install` | `universal-nema-5-15-cord` |
| `1434` | Telescopic Downdraft System | `cattura-downdraft-install` | `universal-nema-5-15-cord` |
| `1436` | Downdraft Modules | `cattura-downdraft-install` | `universal-nema-5-15-cord` |
| `1440` | Vacuum Seal Drawer | `built-in-vacuum-seal-drawer-install` | — |
| `1450` | Liner / Insert Hood | `hood-liner-insert-install` | `universal-nema-5-15-cord` |
| `1510` | Built-in Coffee Non-plumbed | `coffee-system-non-plumbed-install` | — |
| `1512` | Built-in Coffee Plumbed | `coffee-system-plumbed-install` | — |
| `1600` | Built-in Coffee System | `coffee-system-non-plumbed-install`, `coffee-system-plumbed-install` | — |
| `1850` | Chateau Cabinets | `grill-access-door-drawer-install`, `kalamazoo-cabinet-installation` | — |
| `2040` | Electric Dryer | `dryer-standard-install`, `dryer-condo-install`, `side-vent-dryer-add-on-install`, `dryer-door-reversal`, `stacking-kit-add-on-install` | `dryer-cord`, `dryer-vent-kit`, `dryer-steam-kit` |
| `2042` | Gas Dryer | `dryer-standard-install`, `dryer-condo-install`, `gas-conversion-dryer`, `side-vent-dryer-add-on-install`, `stacking-kit-add-on-install` | `universal-gas-install-kit`, `dryer-vent-kit`, `dryer-steam-kit` |
| `2044` | Ventless Dryer | `dryer-standard-install`, `dryer-condo-install`, `stacking-kit-add-on-install` | `dryer-cord` |
| `2046` | Drying Cabinet | `dryer-standard-install` | `dryer-cord` |
| `2110` | Top Load Washing Machine | `washer-standard-install`, `washer-condo-install` | `washer-fill-hoses-5ft-rubber`, `washer-fill-hoses-5ft-stainless`, `washer-fill-hoses-10ft-stainless` |
| `2112` | Front Load Washing Machine | `washer-standard-install`, `washer-condo-install`, `stacking-kit-add-on-install` | `washer-fill-hoses-5ft-rubber`, `washer-fill-hoses-5ft-stainless`, `washer-fill-hoses-10ft-stainless` |
| `2114` | Commercial Top Load Washer | `washer-standard-install`, `washer-condo-install` | `washer-fill-hoses-5ft-rubber`, `washer-fill-hoses-5ft-stainless`, `washer-fill-hoses-10ft-stainless` |
| `2116` | Commercial Front Load Washer | `washer-standard-install`, `washer-condo-install`, `stacking-kit-add-on-install` | `washer-fill-hoses-5ft-rubber`, `washer-fill-hoses-5ft-stainless`, `washer-fill-hoses-10ft-stainless` |
| `2140` | Unitized Washer and Dryer | `washer-standard-install` | `washer-fill-hoses-5ft-stainless`, `washer-fill-hoses-10ft-stainless`, `dryer-cord`, `dryer-vent-kit` |
| `2142` | Ventless All-in-one Washer and Dryer | `washer-standard-install` | `washer-fill-hoses-5ft-stainless`, `washer-fill-hoses-10ft-stainless` |
| `2214` | Front Load Pedestals and Risers | `pedestal-basic-add-on-install`, `pedestal-washer-add-on-install` | — |
| `2216` | Laundry Stacking Kits | `stacking-kit-add-on-install` | — |
| `8010` | Built-in Gas Grill | `outdoor-grill-standard-install`, `outdoor-grill-kalamazoo-install`, `outdoor-sideburner-install` | — |
| `8011` | Built-in Hybrid Grill | `outdoor-grill-standard-install`, `outdoor-grill-kalamazoo-install`, `outdoor-sideburner-install` | — |
| `8013` | Built-in Electric Grill | `outdoor-grill-standard-install`, `outdoor-grill-kalamazoo-install`, `outdoor-sideburner-install` | — |
| `8014` | Built-in Pellet Grill | `outdoor-grill-standard-install`, `outdoor-grill-kalamazoo-install`, `outdoor-sideburner-install` | — |
| `8019` | Built-in Specialty Grill | `outdoor-grill-standard-install`, `outdoor-grill-kalamazoo-install` | — |
| `8040` | Pizza Ovens | `oven-pizza-countertop-install`, `oven-pizza-built-in-install` | — |
| `8042` | Built-in Smoker Cabinet | `outdoor-grill-standard-install`, `outdoor-grill-kalamazoo-install` | — |
| `8056` | Flattop Griddles | `outdoor-grill-standard-install` | — |
| `8110` | Access Doors | `grill-access-door-drawer-install` | — |
| `8112` | Outdoor Storage Drawers | `grill-access-door-drawer-install` | — |
| `8114` | Outdoor Trash Bins | `grill-access-door-drawer-install` | — |
| `8116` | Outdoor Specialty Drawers | `grill-access-door-drawer-install` | — |
| `8210` | Outdoor Refrigerators | `refrigerator-undercounter-built-in-no-panel-install` | — |
| `8214` | Outdoor Warming Drawers | `warming-drawer-no-panel-install` | — |
| `8218` | Outdoor Ventilation | `hood-wall-install` | `universal-nema-5-15-cord` |
| `8224` | Outdoor Dishwashers | `dishwasher-standard-install` | `dishwasher-install-kit`, `universal-nema-5-15-cord` |

**Subclasses with nothing to offer** (no prompt; a delivered unit gets "Uncrate, set in place"): 1130 Built-in Refrigeration Panels; 1132 Built-in Refrigeration Accessories; 1212 Refrigerator Install Accessories; 1214 Refrigerator Water Filters; 1216 Refrigerator Air Filters; 1218 Refrigerator Door Bins and Shelves; 1328 Undercounter Door Panels; 1329 Trash Compactors; 1332 Portable Dishwasher; 1334 Dishwasher Installation Accessories; 1335 Dishwasher Door Panels and Handles; 1336 Dishwasher Cleaning Solutions; 1409 Warming Drawer Panel Front; 1413 Vacuum Drawer Panel Front; 1418 Cooking Cleaning Solution; 1420 Cooking Racks and Baskets; 1424 Cooking Install Accessory; 1452 Integrated Blower Motors; 1454 Inline Blower Motors; 1456 Remote Blower Motors; 1458 Ventilation Filters; 1460 Ventilation Lighting; 1462 Duct Extension Covers; 1464 Ventilation Install Accessories; 1624 Countertop Appliance Accessories; 2080 Rotary Iron; 2082 Clothing Steam Closet; 2212 Dryer Installation Accessories; 2213 Dryer LP Conversion Kits; 2220 Laundry Detergent; 3136 Kitchen Disposal; 8090 Carts for Built-in Grills; 8092 Jackets for Built-in Grills; 8094 Outdoor Cooking Accessories; 8096 Outdoor Install Accessories; 8098 Outdoor Fuel Conversion Kits; 8128 Outdoor Bar and Prep Sinks; 8430 Outdoor Faucets.

### D. Required pairings (`requires`)

| Installs | Must be accompanied by |
|---|---|
| `washer-standard-install`, `washer-condo-install` | one of `washer-fill-hoses-5ft-stainless` / `washer-fill-hoses-10ft-stainless` |
| `dryer-standard-install`, `dryer-condo-install` | one of `dryer-cord` / `universal-gas-install-kit` **and** `dryer-vent-kit` |
| `dishwasher-standard-install`, `dishwasher-with-panel-install`, `pro-dishwasher-install`, `dish-drawer-install` | `dishwasher-install-kit` |
| `refrigerator-freestanding-install`, `refrigerator-built-in-no-panels-install`, `refrigerator-built-in-with-panel-install`, `refrigerator-built-in-column-stainless-install`, `refrigerator-built-in-column-with-panel-install`, `refrigerator-undercounter-built-in-no-panel-install`, `refrigerator-undercounter-built-in-with-panel-install`, `built-in-ice-machine-install`, `built-in-ice-machine-install-with-panel` | `refrigerator-water-supply-stainless` |
| `hood-under-cabinet-install`, `hood-wall-install`, `hood-island-install`, `hood-liner-insert-install`, `cattura-downdraft-install` | `universal-nema-5-15-cord` |
| `range-standard-gas-install`, `range-pro-install`, `cooktop-standard-install`, `pro-rangetop-install` | `universal-gas-install-kit` |
| `range-standard-electric-install` | `range-cord` |

Read with the narrowing rule in 2c: a group applies to a model only when at least one of its accessories is offered for that model.
