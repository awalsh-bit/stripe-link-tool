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

Up to 20 lines, 10 of each; `zip`, `source` and `ref` are optional (`ref` is whatever the site wants to find the cart by later). Lines that can only be quoted (`inquireOnly`) are returned in `items` so the site can say so, but aren't put in the token; if nothing is sellable the call answers 400. Tokens last 7 days, can be opened more than once (a shopper may reload), and nothing in them is personal. CORS, rate limit and origins are the same as the stock lookup; 60 handoffs per 10 minutes per address.

shop.html reads the token back, picks real sellable units for each model (new before open box), fills the cart and opens it. The shopper does ZIP, add-ons, delivery day, account and card there, and the order lands in Online Shop Orders like any other. If a model sold between the website and the click, the cart still opens with a notice naming it and the phone number. When the order is filed, the handoff row records the order number, so "did the website cart convert?" is a query, not a guess.

Why a token rather than a long URL: the list and its options never live in an address, the link can't be edited to add items, the website doesn't have to know how the shop names anything, and every cart that came from the website is on record with its source.

**Also fine for texts and ads:** `shop.html?add=MODEL,MODEL*2` builds a cart straight from a plain link (the `addUrl` in the stock lookup). Same behaviour, no record.

Also available from earlier: `?dept=`, `?sub=`, `?brand=`, `?q=` deep links (see landing.md).

## What the website should not do

Hold or display a price for longer than a minute, compute a price itself, or show a buy button for anything with `inquireOnly` or `paused`. The shop re-prices at checkout regardless, so the worst case is a stale number on a card, not a wrong charge.
