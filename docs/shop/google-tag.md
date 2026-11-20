# Google Tag on the shop

*Added 11/19. Andrew: "Now I'm going to start advertising this shop, so I am looking at a Google Tag" (container GTM-KCPSFXV7). He asked for the tag on the shop pages only, plus the shopping steps for ads.*

## Where it is

Google's current Tag Manager install code is placed as high in `<head>` as possible on:

- `shop-home.html` (the landing page)
- `shop.html` (the shop, the cart and checkout)
- `data/product-pages/template.html` (every product page, `/p/<MODEL>`)
- `lib/shop-about-page.js` (the About Wilson page, `/about`, since 11/20)

It is not on any Agility page, staff page or service-site page.

**Which container (11/20).** GTM-KCPSFXV7 is the shop's own container. wilsonappliance.com has its own, GTM-NWN9JZTQ (Tag Manager account "Wilson Appliance"). A third container, GTM-5HPCK4SV, was created on 11/20 and is not installed anywhere. Andrew chose to keep GTM-KCPSFXV7: two containers on the shop would count every sale twice. GTM-KCPSFXV7 came from Google Ads (the account named "Destination AW-16686388686", since renamed), and Andrew's access to it is *inherited* through being a Google Ads admin. Some tools only list containers a login was added to directly. Meta's connector is one of them, so the Meta Pixel was put straight into the shop's pages instead (`docs/shop/meta-pixel.md`).

The code is Google's (`gtm.js?id=GTM-KCPSFXV7`, then `gtag('js', new Date())`), with one change: it loads only when the page is on **shop.wilsonappliance.com**. Local copies, test servers and Render's own address never report to Google. Tag Assistant's preview therefore works on shop.wilsonappliance.com only.

## What the shop tells the tag

These are Google's standard ecommerce events, pushed to `dataLayer`. Each carries currency USD and the items.

| Event | When | Carries |
|---|---|---|
| `view_item` | A product page opens | Model, brand, department, New in Box / Open Box, and the price **only when the page shows one** (never for "Price in cart") |
| `add_to_cart` | **Add to cart** on a product page, a tile, a best seller on the landing page (11/20), or a website link (`?add=`) | The model and the price it was added at |
| `begin_checkout` | The secure checkout opens | The cart (appliances, then installation and parts) and its value after any promo |
| `purchase` | An order is placed | `transaction_id` (the WEB- order number), `value`, `tax`, `shipping` (the delivery fee), `coupon` (the promo code) and the items |
| `generate_lead` | A cart of special-order items is sent as a quote request | No value (nothing is priced yet) |

- **Each add counts once.** An add on a product page or a landing-page best seller is counted there. When the shop picks the model up, it doesn't count it again.
- **Purchase value** is the merchandise (appliances, installation and parts) after any promo, without tax or delivery. It comes from the server's own totals for the order.
- **Purchase means the order was placed.** The card is saved, not charged, until a consultant confirms. A later cancellation isn't sent back to Google.
- **Nothing personal is sent.** No name, phone, email, address, client code or shopper token goes into the data layer, only model numbers, prices and order totals. The test checks this on a real test order.

## Setting it up in Tag Manager

This part is done in Tag Manager, not in Agility.

- **Analytics.** Point the Google tag (GA4) at the container. Ecommerce events come from the data layer under `ecommerce`.
- **Google Ads conversion.** Fire it on the custom event `purchase`, with conversion value `ecommerce.value`, currency `ecommerce.currency` and transaction ID `ecommerce.transaction_id`. The transaction ID stops a reload from counting twice.
- **Quote requests.** These can count as a second, unvalued conversion on `generate_lead`.

## Worth knowing

- **Who can publish.** Anyone who can publish in this container can run scripts on the shop pages, including checkout. Card numbers are typed into Stripe's own frame, which the page and the tag can't read. Even so, keep publish access to a few people.
- **Remarketing and your privacy policy.** Google's ad policies expect a site that uses remarketing to say so in its privacy policy. Check with whoever looks after yours (this isn't legal advice).
- **Page addresses.** A shop link carrying a website cart (`?cart=`) shows that token in Analytics' page address. It only opens a cart, and holds no personal details.

## Checked before delivery

The real `server.js` was run on a local test database. googletagmanager.com and Stripe were answered by stand-ins inside the browser, so nothing reached Google or Stripe.

- **Local copy:** no request to Google from any of the three pages, and `dataLayer` was ready.
- **On shop.wilsonappliance.com** (pages served from the local server): each page loaded `gtm.js?id=GTM-KCPSFXV7` once, from `<head>`.
- **A test order:**
  - `view_item` carried the shown price.
  - A "Price in cart" model sent no price, and its price wasn't anywhere in the page.
  - One `add_to_cart` was sent on the product page, and none again in the shop.
  - `begin_checkout` was sent, then `purchase` with the order number.
  - The purchase value, tax and delivery matched the filed order.
  - No personal details were in the data layer.
- **A website link (`?add=`):** one `add_to_cart` in the shop.
- **Earlier suites:** add to cart, product pages, ZIP and Miele links all still pass.

## For developers

- **The loader.** The `<!-- Google Tag Manager -->` block in each page's `<head>` defines `dataLayer` and `gtag`, and adds the `gtm.js` script when `location.hostname === "shop.wilsonappliance.com"`.
- **`shop.html`:**
  - `gaPush(event, ecommerce)` clears the previous `ecommerce` object first, as Google recommends.
  - `gaItem(item)` and `gaCartItems()` build the items. `gaDept` uses `MENU_TREE` for the department.
  - Events fire from `addToCart` (unless `quiet`, a staged add), `startCheckout`, the order-placed branch of `placeOrder` and `submitQuoteOnly`.
- **The product page:**
  - `renderProductPage` writes `{{GA_ITEM}}` into `<script type="application/json" id="gaItem">`. The price is included only when `view.price` is a dollar amount, and `<` is escaped.
  - The template's script sends `view_item` on load and `add_to_cart` when a staged add succeeds. When storage is blocked, the link goes to the shop, which counts it there.
