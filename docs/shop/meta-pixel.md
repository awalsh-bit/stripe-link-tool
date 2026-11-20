# Meta Pixel on the shop

*Added 11/20. Andrew connected Meta to Google Tag Manager, but Meta's connector only listed the Tag Manager containers he was added to directly: wilsonappliance.com's (GTM-NWN9JZTQ) and an empty new one. The shop's container, GTM-KCPSFXV7, comes to him through Google Ads ("inherited access"; see `google-tag.md`), so Meta can't see it. Instead the pixel went straight into the shop's pages, on the dataset wilsonappliance.com already uses: **Wilson AC & Appliance data, 1962893141241918**.*

## Where it is

`meta-pixel.js` holds Meta's own base code, unchanged. It's loaded near the top of `<head>`, just after the Google tag, on the same four pages:

- `shop-home.html` (the landing page)
- `shop.html` (the shop, the cart and checkout)
- `data/product-pages/template.html` (every product page)
- `lib/shop-about-page.js` (About Wilson)

The pixel loads **only on shop.wilsonappliance.com**, like the Google tag. Local copies, test servers and Render's own address never report to Meta. Meta's `<noscript>` image is left out, because it can't check the address.

To change the dataset, edit `PIXEL_ID` at the top of `meta-pixel.js`.

## What it sends

Each page sends **PageView**. The shop's Google shopping steps are also sent to Meta as Meta's standard events, from the same places, at the same moments:

| Google step | Meta event | Carries |
|---|---|---|
| `view_item` (a product page opens) | **ViewContent** | The model; the price only when the page shows one |
| `add_to_cart` (product page, shop, landing best seller) | **AddToCart** | The model and the price it was added at |
| `begin_checkout` | **InitiateCheckout** | The appliances in the cart, how many, and the value |
| `purchase` (order placed) | **Purchase** | The appliances, how many, the value and currency; the order number as Meta's event ID |
| `generate_lead` (special-order quote request) | **Lead** | Nothing but the currency |

- **Value:** the same merchandise value Google gets: appliances, installation and parts, after any promo, without tax or delivery.
- **What counts as a product:** `content_ids` are model numbers. Installation and parts lines count toward the value but aren't listed as products.
- **The order number as event ID:** it means a reloaded page, or a server-side connection added later, counts each order once.
- **Nothing personal goes to Meta:** no name, phone, email, address or client code; only model numbers, prices and totals. Automatic advanced matching is not part of this setup. If it's ever turned on in Events Manager, Meta would start reading form fields, including at checkout. Leave it off unless that's a decision made on purpose and the privacy policy covers it.

## Checking it after deploying

In Meta's **Events Manager**, open the dataset and go to **Test events**. Enter `https://shop.wilsonappliance.com` and browse:

- **PageView** appears on every page.
- Opening a product gives **ViewContent**.
- **Add to cart** gives **AddToCart**.

**Overview** then shows shop.wilsonappliance.com next to wilsonappliance.com.

## Worth knowing

- **Remarketing and your privacy policy.** As with Google, ad platforms expect a site that uses their pixel for remarketing to say so in its privacy policy. Check with whoever looks after it (this isn't legal advice).
- **The second dataset.** The other dataset with the same name (2004352943566252) isn't used by the shop. Renaming it in Events Manager (for example "Wilson – unused") avoids picking it by mistake.

## Checked before delivery

The real `server.js` ran on local test databases, with Meta and Google answered by stand-ins inside the browser, so nothing reached either. 30 of 30 checks passed:

- **On shop.wilsonappliance.com** (landing, shop, a product page, About):
  - Meta's script loaded once.
  - The pixel started on 1962893141241918 and sent PageView.
  - The Google tag still loaded once.
  - No page errors.
- **The product page:** ViewContent carried the model, and no price when the page showed none. Google's `view_item` still went once.
- **A real Add to cart in the shop:** Meta got AddToCart with the same model Google got, and Google's step still went once.
- **Checkout, purchase and a quote request, shaped as the shop sends them:**
  - InitiateCheckout and Purchase listed the two appliances, not the installation line, with the full value.
  - Purchase carried the order number as its event ID.
  - Lead carried no value.
  - Only product and money fields were sent.
- **On a local copy:** nothing was sent to Meta from any page.

## For developers

- **`meta-pixel.js`** (repo root):
  - It's served without a login on the shop host (`SHOP_PUBLIC_PATHS` in `server.js`), and loaded as `/meta-pixel.js`. The path is absolute because the product pages set `<base href="/">` after it.
  - It's loaded synchronously, so `window.wilsonMeta` exists before the product page's inline `view_item` runs.
  - `window.wilsonMeta = { live, track(event, ecommerce) }`; `track` is a no-op off the shop host.
- **The call sites,** next to each `dataLayer` push:
  - `gaPush` in `shop.html`
  - `gaPush` in the product page template
  - `gaAdd` in `shop-home.html`
