# Promo codes shown on the shop

*Added 11/23. Andrew, with BLACKFRIDAY1 / 2 / 3 built ($100 off $1,000+, $200 off $2,000+, $300 off $3,000+): "I built the first promo codes. I'd like them to appear in a classy way on the shop landing pages." Where: the landing page and the shop page, not product pages. In the cart: one tap.*

## A code is private until it is switched on

Every code starts private: a shopper has to know it and type it. **Show on shop** (Online Shop Orders, Promo codes, on each code's row, or the checkbox when adding a code) makes it public. **Hide from shop** makes it private again. Both take effect on the live shop at once.

Keep a code meant for one person or group (an influencer, a model home, a make-good) switched off. Nothing about a private code is ever sent to the shop pages.

A switched-on code shows only **while it is live**: active, inside its start and end dates, and under its redemption limit. Outside that it is tagged "On the shop when live" in the list and the shop leaves it out. So a sale can be switched on ahead of time and it appears and disappears by its own dates.

## What the shopper sees

| Place | What |
| --- | --- |
| **Landing page** (`shop-home.html`) | A band between the hero and the quick links: "Now through December 2", the headline, then each offer as an amount, its condition and its code ("$300 off · on $3,000 or more in appliances · Code BLACKFRIDAY3"), smallest minimum first, and a Shop all models link. |
| **Shop page** (`shop.html`) | One slim line above the ZIP box and Top deals: the headline and each offer in short form ("$300 off $3,000+ BLACKFRIDAY3"). |
| **Cart** | When the cart qualifies for a shown code, a row offers the best one with an **Apply** button: no typing. If a better tier is within reach it says what is missing ("Add $601.00 more in appliances for $200 off with BLACKFRIDAY2."). If a code is already applied and the cart now qualifies for a better one, the button reads **Switch**. "Have a promo code?" stays for private codes, worded "Have a different code?" when an offer is showing. |

With no code showing, none of this is drawn: no band, no line, no gap, and the cart is as it was.

Product pages don't show codes (Andrew's choice, 11/23).

## The wording comes from the numbers

The band and the line are written from the code's type, amount and minimum, not from its description, so three codes read as one set whatever was typed in "Shown to shopper as". Dollar and percent codes on appliances, delivery or installation all word themselves ("Free delivery", "10% off installation"). The end date shows only when every shown code ends the same day.

The **headline** is the one free-text piece: Promo codes, "Headline over the codes shown on the shop" (60 characters). Blank means "Limited-time offers". The card also says which codes the shop is showing right now.

## Rules that did not change

- One code per order. The cart's Apply and Switch buttons go through the same server check as a typed code (`POST /api/shop/promo-check`), and the order is checked again at checkout: minimum, dates, redemption limit, once per customer.
- The ePASS misc code, NetSuite item, limits and notes never leave Agility. `GET /api/shop/offers` sends only the code, what it does, its minimum and its end date.
- The ZIP box says nothing about fees or codes (11/23), so a free-delivery code and the ZIP answer can't contradict each other.

## Where it lives

- `lib/shop-promos-postgres.js`: `featured` on `shop_promo_codes`; `shop_promo_display` (the headline); `promoIsLive`, `listFeaturedShopPromos`, `getShopPromoDisplay`, `saveShopPromoDisplay`.
- `server.js`: `GET /api/shop/offers` (public, held 30 seconds, cleared by any promo change made in Agility); `POST /api/shop/promo-display` (Online Shop Orders permission; audit `shop_promo_display_saved`). Switching a code is the existing update route; the audit row carries `featured`.
- `shop-offers.js`: one script for both pages (`wilsonOffers.mountBand`, `mountStrip`, `load`), with its own styles.
- `shop-home.html`, `shop.html` (strip and cart rows), `shop-orders.html` (switch, tag, headline).

Every switch and headline save is in the audit log with who made it.
