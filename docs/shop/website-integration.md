# Website ↔ Express shop integration

*Added 11/9 for the new wilsonappliance.com build. Two pieces on Agility's side; the website owns browsing and its own quote cart for orderable models, and hands in-stock purchases into the Express shop, which owns ZIP check, pricing, add-ons, scheduling, accounts and payment.*

## 1. Stock lookup — `GET https://shop.wilsonappliance.com/api/shop/stock?models=A,B,C`

Up to 50 model numbers per call (comma-separated; spacing, dashes and case don't matter). Plain GET, no key, no cookies. CORS is allowed for `wilsonappliance.com`, `www.wilsonappliance.com` and `wilsonappliancetestsite.netlify.app` (`SHOP_PARTNER_ORIGINS` in Render to change). Rate limit 120 calls per 10 minutes per address; responses are cacheable for 60 seconds. The site can call it from the browser on a product page or from a build step — either is fine.

```json
{
  "asOf": "2026-11-09T14:02:11.000Z",
  "paused": false,
  "shop": "https://shop.wilsonappliance.com",
  "models": [
    { "model": "WM4000HWA", "brand": "LG", "description": "4.5 cu. ft. Front Load Washer",
      "category": "Lau", "image": "https://shop.wilsonappliance.com/api/promo/photo/…",
      "inStock": true, "available": 5, "newUnits": 5, "outletUnits": 1, "outletOnly": false,
      "price": 899, "belowMap": false, "priceInCart": false, "expressEligible": true,
      "inquireOnly": false, "addUrl": "https://shop.wilsonappliance.com/shop.html?add=WM4000HWA" },
    { "model": "KDTM404KPS", "brand": "KitchenAid", "description": "44 dBA Dishwasher",
      "inStock": true, "available": 2, "newUnits": 2, "outletUnits": 0, "outletOnly": false,
      "price": null, "belowMap": false, "priceInCart": true, "inquireOnly": false,
      "addUrl": "https://shop.wilsonappliance.com/shop.html?add=KDTM404KPS" },
    { "model": "SRT486G", "brand": "Sub-Zero", "description": "…",
      "inquireOnly": true, "inStock": false, "available": 0, "price": null, "priceInCart": false,
      "addUrl": null, "note": "Quoted in person — ask for a specialist." },
    { "model": "ZZZ123", "brand": "", "description": "", "inStock": false, "available": 0,
      "price": null, "priceInCart": false, "inquireOnly": false, "addUrl": null }
  ]
}
```

How to read each model — three states, all with stock:

| Field | Meaning |
|---|---|
| `inStock`, `available` | Wilson's own ATS rule: **sealed** units on hand, not written to a ticket, not held or reserved to an order. Open-box and display units never count — they're `outletUnits`, and `outletOnly: true` means that's all there is (the `addUrl` still works; the shop puts the open-box unit in the cart and says so). |
| `price` with `priceInCart: false` | The manufacturer lets us advertise this price. Show it. |
| `price: null`, `priceInCart: true` | We sell it online but may not advertise the number. Show "See price in cart" and the button; the shop reveals it once it's in the cart. |
| `price` with `belowMap: true` | Our price is below the advertised floor; the number given *is* the floor. Show it with "our price is even lower in the cart." |
| `inquireOnly: true` | Sub-Zero, Wolf, Cove, Gaggenau (the Shop Orders "brands not sold online" list). No cart button; route to a specialist. |
| `paused: true` (top level) | Online ordering is briefly paused; prices come back null. Show stock, hide buy buttons, point to the phone. |
| `expressEligible` | Qualifies for the same-day install program. |

Never in this response: unit ids, serials, cost, location, or anything about a customer.

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
    "connectors": [ { "id": "dryer-vent-kit", "name": "Dryer Vent Kit", "price": 27.95, "taxable": true }, … ],
    "installs":   [ { "id": "washer-standard-install", "name": "Washer - Standard Install", "price": 99.95, "taxable": false, "durationMin": 60 }, … ],
    "byKey":      { "WASHF": { "installs": ["washer-standard-install"], "connectors": ["washer-fill-hoses-5ft-stainless", "washer-fill-hoses-10ft-stainless"] }, … },
    "requires":   { "washer-standard-install": [ ["washer-fill-hoses-5ft-stainless", "washer-fill-hoses-10ft-stainless"] ] } },
  "delivery": { "name": "White Glove Delivery + Haul Away", "price": 49.95, "regularPrice": 89.95, "note": "…", "scheduleNote": "…" },
  "pickup":   { "name": "Customer Pickup", "price": 0 },
  "uncrate":  { "name": "Uncrate, set in place", "price": 0, "description": "…" },
  "taxRate": 0.0825, "taxNote": "…", "areaNote": "…" }
```

How to use it: take a model's `servicesKey` from the stock lookup (also on every handoff line) and show `byKey[servicesKey].installs` and `.connectors` as the choices for that line. **Treat `servicesKey` as an opaque string.** (Since 11/10 it is the NetSuite merchandise subclass code, e.g. `2112`, sometimes with a refinement suffix — `1330-std`, `1330-panel`, `1330-pro`, `1330-drawer` — chosen on our side from the model's finish and brand so a stainless dishwasher is offered only the standard install, a panel-ready built-in only the "with panel" install, a Cove or Miele the pro install, a Fisher & Paykel DishDrawer the drawer install. Every key, plain or suffixed, is in `byKey`; the stock lookup also returns the readable `merchClass` / `merchSubclass` names and `panelReady` (`true` / `false` / `null` when NetSuite has no finish on file). Older product-code keys are still answered by `byKey` through the changeover.)

**Brand additions (11/10).** A second map, `addons.byBrand`, holds what a particular brand adds for a subclass — its pedestal, stacking kit, detergent. Each stock-lookup and handoff line carries `brandServicesKey` (e.g. `"LG|2112"`, blank when there is nothing); show `byBrand[brandServicesKey].installs` and `.connectors` alongside the `byKey` set (same ids, same catalog), and `.products` — model numbers — as accessory products. `addons.products[model]` gives `{ brand, description, inStock, available, inquireOnly }` for each; an in-stock one is sold like any model (price and `addUrl` from the stock lookup), an out-of-stock one belongs on the quote path. Treat `brandServicesKey` as opaque too.

A model has a key whenever NetSuite has classified it, which is nearly the whole site catalog. For the rest, fall back to `addons.byCategory`: a map from the website's own category and Type names — `"Ranges|Dual Fuel"`, `"Dryers|Front Load Gas"`, `"Dishwashers"` — to a `servicesKey`. Try `"Category|Type"` first, then `"Category"`. Names are exactly as the site's catalog-conventions.md spells them. Categories with no installation on file (Trash Compactors, Disposals, Steam Closets, Irons…) aren't in the map; show no install choices for those. `requires[installId]` lists groups where exactly one connector must accompany that install (the shop pre-ticks the first and locks it). A line with no install gets the free "Uncrate, set in place." Add delivery or pickup once per cart. Cache it for ten minutes. Send the chosen add-ons on the quote request as `items[].addons: [{ id, name, qty, price }]` so the consultant sees exactly what was picked at what price, and `fulfillment: { "method": "delivery" | "pickup" }` for the cart's choice.

Outside the delivery area the prices still show; the quote is simply flagged "outside delivery area" on your side and a consultant sorts the delivery out with the customer. (A sell-but-schedule-manually zone is a later round.)

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
