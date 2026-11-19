# The shop and search engines

*Changed 11/20. Andrew passed on an LLM's check of the shop: "The page's extracted text includes an announcement that online ordering is temporarily paused and an empty-inventory message ... Google ... recommends making product information, pricing, and availability accessible in the initial HTML." Asked what the shop should tell Google, he chose **Open the shop**.*

## What was wrong

- **Google was told to stay out.** The whole server, the shop included, sent `robots.txt` with `Disallow: /`, an `X-Robots-Tag: noindex` header on every answer, and a `noindex` tag in each shop page. Text ads still worked, because Google's ad checker (AdsBot) ignores a rule aimed at every crawler. Google Shopping, Merchant Center and regular search could not use the shop.
- **Hidden notes were in the page.** The "online ordering is briefly paused" note and the "Nothing in stock matches those filters" note were in the page as it arrives, hidden until needed. A crawler reading the raw text sees them.

## What changed

**On shop.wilsonappliance.com only:**

- `robots.txt` lets crawlers in.
  - **Kept out:** the API, apart from what the pages read to draw themselves (the catalog, the landing's numbers, photos and spec sheets).
  - **Kept out:** cart links (`?add=`, `?cart=`, `?show=`).
  - **Listed:** the sitemap.
- No `noindex` on the landing page, the shop or the product pages. API answers keep it.
- `/sitemap.xml` lists the landing page, the shop and every product page, 45 today. New product pages join it on their own.

**Everywhere else is unchanged.** Agility, the staff pages, the service site, and the shop pages on any other address (Render's own address, a test server) keep `noindex`. Their `robots.txt` still says `Disallow: /`.

**Product pages carry the product in the page as it arrives:**

- **The page's address.** A canonical link to `https://shop.wilsonappliance.com/p/<MODEL>`.
- **A description.** The page's own lead line, for search results.
- **schema.org `Product` data:**
  - name, model number, brand, the description and up to three photos
  - an **Offer**: price, In stock, New condition for a new unit, and Wilson as the seller.
  - The Offer is there only when the page shows a dollar price an order can be placed at. A "Price in cart" model has no price in its data or anywhere in the page, so the advertised-price rules hold.

**The shop and landing pages:**

- **The shop** gets a description.
- **The landing page** gets its canonical address (`https://shop.wilsonappliance.com/`).
- **The two notes** are now written by the script only when they apply. A paused shop still shows the paused note, with Call and Text Us, and a filter with no matches still shows "Nothing in stock matches those filters". Neither is in the page as it arrives.

The shop's grid of tiles is still drawn by the script from the catalog. Google renders scripts, and the catalog it reads is now open to it. The product pages are the ones that need their facts in the page as it arrives, and they now have them.

## Google's ownership check

*Added 11/20.* The Merchant Center and Search Console verification tag (`google-site-verification`, from Merchant Center's "verify your online store") is in the `<head>` of `shop-home.html`, which the shop address's home page serves, and of `shop.html`. Leave it in place, because Google checks it again from time to time. It gives Google no access to anything.

## What to do next (outside Agility)

- **Google Search Console.** Add `shop.wilsonappliance.com` and submit `https://shop.wilsonappliance.com/sitemap.xml`. Indexing takes days to weeks.
- **Merchant Center (Shopping ads, free listings).**
  - Product links should be the `/p/<MODEL>` pages.
  - The feed's price must match the page. Models whose page says "Price in cart" have no price on the page, so leave them out of a Shopping feed rather than list a price the page doesn't show.
- **Earlier visits.** Pages Google saw while they said `noindex` are re-read on its next visit. Search Console's URL inspection can ask for that sooner.

## Checked before delivery

On the real `server.js` with a local test database, asked both as shop.wilsonappliance.com and as a local address:

- **robots.txt:** the shop host gets the shop's version, and other addresses get `Disallow: /`.
- **Sitemap:** 47 addresses on the shop host. Other addresses get "not found".
- **Headers:** no `noindex` on the shop host's pages, `noindex` on its API answers, and `noindex` on the same pages at any other address.
- **Product pages:**
  - Canonical address and description present.
  - Valid Product data, with the Offer at $1,499.00 In stock New where the page shows that price.
  - No Offer and no price on a "Price in cart" model.
  - Miele's name read as the page title has it.
- **The shop as it arrives:** no paused or "nothing in stock" text.
- **In a browser:** the paused note still appears for a paused shop (with Call and Text Us), the no-match note for an empty filter, and neither on an open shop.
- **Earlier suites:** Google Tag, add to cart, product pages, ZIP, Miele links and Why Wilson all still pass.

## For developers

- **`server.js`:**
  - **Global header middleware:** `X-Robots-Tag` is skipped only when `getRequestHost(req) === SHOP_PUBLIC_HOST` and the path isn't under `/api/`.
  - **`GET /robots.txt`:** sends `SHOP_ROBOTS_TXT` on the shop host. Other hosts fall through to the file on disk.
  - **`GET /sitemap.xml`:** shop host only, built from `listProductPageKeys`. It's on `SHOP_PUBLIC_PATHS`.
  - **`/p/:model`:** passes `live.origin` and sends `noindex` only off the shop host.
- **`lib/shop-product-page.js`:** `renderProductPage` fills `{{CANONICAL}}`, `{{META_DESC}}` and `{{JSON_LD}}` (with `<` escaped). The Offer follows the same "shown dollar price" rule as `{{GA_ITEM}}`.
- **`shop.html`:** `PAUSED_NOTE_HTML` is written into `#pausedNote` while `state.paused`, and `#emptyNote` gets its text only when no tiles match.
