# About Wilson and the review rating on the shop

*Added 11/20. Andrew: "Kill the Luxury Appliances banner for now and change it to an About Wilson to the far right … I need an about us page on the shop. Can you use the about us section of the wilsonappliance.com now and the why wilson rotating cards to build something?" And, with Google ads now landing on the shop: "we need to show our reviews somewhere in the banner." He chose the **rating in the header** and **live reviews on the About page**, and supplied the company history himself.*

## What changed

**The header, on every shop page** (landing, catalog, product pages, About):

- **Luxury Appliances is gone.** To put it back when the page launches, re-add it at the top of the `nav` list in `site-header.js`.
- **About Wilson is the last item in the main nav, at the far right.** It opens the shop's own About page, and is underlined while you're on it. The "More" menu no longer lists it separately. The old entry pointed at wilsonappliance.com/about, which doesn't exist (the main site uses /about-us).
- **The rating sits first in the utility bar's right side:** ★★★★★ 4.9 · 1,200+ Google reviews. It links to the reviews on the About page. On narrower screens it says less:
  - a tablet shows ★ 4.9 · 1,200+ Google reviews
  - a phone shows ★ 4.9 (1,200+), or just ★ 4.9 when the bar is full
  - if the bar still can't fit it, the rating steps aside, so the cart and account buttons are never pushed off the edge

**The About page,** at `shop.wilsonappliance.com/about`:

1. **The hero**, over the Sub-Zero / Wolf live kitchen: *Family owned since 1949*, a short summary, and *Shop what's in stock* / *Visit the showroom*.
2. **The rating strip:** stars, 4.9 on Google, 1,200+ reviews, and *Read the reviews*.
3. **Our history:** Andrew's text, beside a short timeline (1949, today).
4. **Why Wilson:** every card from `data/why-wilson.json`, all at once instead of one at a time as on the product pages.
5. **From our customers:** the same Podium review widget wilsonappliance.com uses (the latest five reviews), with a button to all the Google reviews.
6. **Visit:** a showroom photo, the address, phone and email, hours, the towns Wilson serves, the Nationwide Marketing Group membership, and buttons to shop, get directions or schedule service.

The landing page's footer links to it too, and it's in the shop's sitemap.

## Editing it

Everything on the page except the Why Wilson cards is in **`data/about-wilson.json`**: the rating, the headline and summary, the history paragraphs and timeline, the Podium location, and the visit details. The cards stay in `data/why-wilson.json`, the same file the product pages read. Changes show within a minute of the file being deployed. No code change is needed.

- **Keep the rating current.** `rating.value` (like `4.9`) and `rating.count` (like `1,200+`) feed both the header and the page. The Why Wilson "reviews" card says the same numbers in its own words, so change both together.
- **Only real numbers show.** A rating that isn't a number from 1 to 5, or a count that isn't a number, leaves the rating off entirely.
- **What changed in Andrew's history text:**
  - "Almost seventy years later" became "More than seventy-five years later" (1949 to 2026).
  - "three employees to almost forty" became "nearly seventy", per Andrew.
  - Two commas were added.
  - The sentence about Gavin joining full-time in 2008, and the 2008 step on the timeline, came out the same day (Andrew: Gavin isn't at the business full time anymore).

## Reviews and Google: what we found (11/20)

- **"Store rating 4.6/5" under other stores in Google's ads.** These are Google's *store ratings*:
  - They need about 100 reviews from verified online buyers in the last 24 months, averaging 3.5 or better.
  - The reviews come from Google Customer Reviews (a survey offered after an online purchase) or a supported review partner.
  - Google Maps (Business Profile) reviews aren't among the sources.
  - The survey could go on the shop's order confirmation later, but it would take a long time to reach 100 at today's online volume.
- **Product stars, like Best Buy's "(3k+)".** Google pools these across retailers for the same product, matched mainly by UPC. Showing them on Shopping ads takes 50+ product reviews that the merchant submits. Free listings show the pooled ratings without that.
- **Store reviews on each product: not done.** Google removes product reviews that are about the retailer or delivery. On our own product pages, store stars would read as product ratings.
- **What we did instead:** the rating and real reviews on the shop itself, where someone arriving from an ad sees them.
- **No star rating in the page's structured data.** Google doesn't allow a business to mark up its own reviews of itself.

## After deploying, check

- **The reviews widget.** Open `/about` and scroll to *From our customers*. It should show recent reviews the way wilsonappliance.com does. If it's blank, Podium may need to allow the shop's address for its widget. The page still has the rating and the button to Google either way.
- **The header.** On a phone, the header shows ★ 4.9 next to the phone icon, and the cart is still at the right.

## Checked before delivery

The real `server.js` ran on a local test database, viewed in a browser at 12 widths from 320 to 1440 px. Nothing outside the shop was loaded; the Podium widget was blocked in the test.

- **The header:**
  - On the landing, catalog, product page and About, the nav reads Appliances, HVAC, Cabinetry, Sinks & Faucets, About Wilson (underlined on its own page).
  - About Wilson appears exactly once in the phone menu.
  - The rating appeared everywhere, shortening as the screen narrowed.
  - With the rating, nothing ran off the right edge at any width while signed out.
  - On a 390 px phone it first pushed the cart off the edge. That's why the rating now gives way by itself.
- **The About page:** every section rendered on desktop, tablet and phone, with no sideways scroll, no broken images and no page errors. The canonical address and structured data are correct, and the sitemap lists it.
- **Not from this change:** a signed-in shopper with a long first name already overflowed the phone's utility bar before this change. The rating steps aside in that case, so it doesn't make it worse.

## For developers

- **`site-header.js`:**
  - `SITE.about = "/about"`; the nav entry is `{ href: "about", key: "about" }`.
  - `current: "about"` marks it.
  - The rating comes from `GET /api/shop/reviews-summary`; `opts.rating === false` leaves it off.
  - `fit()` adds `r-tight` (no count), then `r-gone` (hidden), when `.util-inner` overflows. It re-checks on resize, when the account cluster changes, and once fonts load.
- **`site-header.css`:** `.util-rating` and its breakpoints; `.site-nav a.current`.
- **`lib/shop-about-page.js`:**
  - `loadAboutWilson(dataDir)` validates the file and falls back to plain facts.
  - `cleanRating` checks the rating's two numbers.
  - `renderAboutPage({ about, why, origin })` builds the page server-side for search engines, with `AboutPage` structured data.
- **`server.js`:**
  - `GET /about` and `GET /api/shop/reviews-summary` are both public on the shop host and cached five minutes. `/about` is `noindex` on any other host.
  - `/about` is in the sitemap.
- **`shop-home.html`:** an About Wilson link in the footer's Visit column.
