// ---------------------------------------------------------------------------
// Express shop product pages (Andrew 11/17, first as one test item).
//
// One page per model at /p/<MODEL> on the shop host. The page is drawn by the
// server from two things in data/product-pages/:
//   template.html     the page, shared by every model
//   <MODEL>.json      the model's record: title, lead, five features with a
//                     line each, "also" list, specs, and its photos in order
// The photos themselves are web-sized WebP files in product-photos/<MODEL>/.
//
// Nothing about price or stock is in the record. Both come from the live shop
// catalog at the moment the page is asked for, under the same advertised-price
// rules as the shop tiles (see productOfferView). Add to cart hands the model
// to the shop page (shop.html?add=MODEL), which fills and opens the cart.
//
// This module only reads files and builds HTML; server.js owns the routes and
// the catalog lookup.
// ---------------------------------------------------------------------------
import fs from "fs/promises";
import path from "path";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const SHOP_PHONE = "512-894-0907";
export const SHOP_SMS = "+15128940907"; // the same number, for a "Text Us" link
// "Text Us", with a message icon, so it reads as an action (Andrew 11/19). Styled by a.text-us in site-header.css.
const TEXT_US = `<a class="text-us" href="sms:${SHOP_SMS}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Text Us</a>`;
// The shop's departments, as on its ribbon (shop.html).
const DEPARTMENTS = ["Cooking", "Coffee", "Refrigeration", "Kitchen Cleanup", "Laundry", "Outdoor"];
const COUNT_WORD = { 1: "One reason", 2: "Two reasons", 3: "Three reasons", 4: "Four reasons", 5: "Five reasons" };

// A model number as a file / folder / URL name: capitals and digits only.
export const productPageKey = (model) => String(model || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 40);

// The model's record, or null when there is no page for it (or the file is
// not a usable record). The file name is built from the cleaned key, never
// from the request as typed.
export async function loadProductPage(dir, model) {
  const key = productPageKey(model);
  if (key.length < 3) return null;
  let rec;
  try { rec = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), "utf8")); } catch { return null; }
  if (!rec || typeof rec !== "object" || productPageKey(rec.model) !== key) return null;
  if (!rec.title || !Array.isArray(rec.gallery) || !rec.gallery.length || !Array.isArray(rec.features) || !rec.features.length) return null;
  return rec;
}

export const loadProductPageTemplate = (dir) => fs.readFile(path.join(dir, "template.html"), "utf8");

// "Why Wilson" cards for the band near the bottom of every product page
// (Andrew 11/19: "maybe we do some cards that rotate for our top reasons to
// shop local? a random one appears in the same spot"). data/why-wilson.json
// holds them; the page shows one at random and "Another reason" steps
// through the rest. Read at most once a minute. A missing or broken file
// leaves one plain card rather than an empty band.
const WHY_FALLBACK = [{ id: "one-team", title: "One team, start to finish.", body: "Wilson delivers, installs and services what we sell, from our showroom in Dripping Springs." }];
const whyHref = (h) => { const v = String(h || "").trim(); return /^(https:\/\/|tel:|sms:|\/(?!\/))/i.test(v) ? v.slice(0, 400) : ""; };
let whyMemo = { at: 0, dir: "", value: null };
export async function loadWhyWilsonCards(dataDir) {
  if (whyMemo.value && whyMemo.dir === dataDir && Date.now() - whyMemo.at < 60 * 1000) return whyMemo.value;
  let value = { kicker: "Why Wilson", cards: WHY_FALLBACK };
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, "why-wilson.json"), "utf8"));
    const cards = (Array.isArray(raw.cards) ? raw.cards : [])
      .filter((c) => c && String(c.title || "").trim() && String(c.body || "").trim())
      .slice(0, 12)
      .map((c, i) => {
        const href = whyHref(c.link?.href);
        return { id: String(c.id || i).slice(0, 40), title: String(c.title).trim().slice(0, 80), body: String(c.body).trim().slice(0, 300),
          ...(href && String(c.link?.label || "").trim() ? { link: { label: String(c.link.label).trim().slice(0, 60), href } } : {}) };
      });
    if (cards.length) value = { kicker: String(raw.kicker || "Why Wilson").trim().slice(0, 40), cards };
  } catch (err) { if (err.code !== "ENOENT") console.error("why-wilson.json unreadable:", err.message); }
  whyMemo = { at: Date.now(), dir: dataDir, value };
  return value;
}

// The models that have a page: one record file each. The shop asks with every
// catalog load, so the folder is read at most once a minute.
let pageKeys = { at: 0, dir: "", keys: [] };
export async function listProductPageKeys(dir) {
  if (pageKeys.dir === dir && Date.now() - pageKeys.at < 60 * 1000) return pageKeys.keys;
  let names = [];
  try { names = await fs.readdir(dir); } catch { names = []; }
  const keys = names.map((n) => (/^([0-9A-Z]{3,40})\.json$/.exec(n) || [])[1]).filter(Boolean).sort();
  pageKeys = { at: Date.now(), dir, keys };
  return keys;
}

// The folder under product-photos/ that holds a record's pictures: its own,
// or the one a whole line shares (`photoKey`, capitals and digits only).
const photoFolder = (rec, key) => (/^[0-9A-Z]{3,40}$/.test(String(rec?.photoKey || "")) ? rec.photoKey : key);

// Every page's gallery, for the shop's cards (Andrew 11/18: "For the products
// that have these pages, can you use the image galleries in the shop page?").
// { KEY: ["/product-photos/KEY/file-400.webp", ...] } in gallery order, at the
// small size - a card's picture is 150px tall. Read at most once a minute,
// like the page list.
let pageGalleries = { at: 0, dir: "", size: "", value: {} };
export async function loadProductPageGalleries(dir, size = "400") {
  if (pageGalleries.dir === dir && pageGalleries.size === size && Date.now() - pageGalleries.at < 60 * 1000) return pageGalleries.value;
  const value = {};
  for (const key of await listProductPageKeys(dir)) {
    const rec = await loadProductPage(dir, key);
    if (!rec) continue;
    const folder = photoFolder(rec, key);
    const urls = rec.gallery.filter((g) => g && /^[a-z0-9][a-z0-9-]{0,70}$/.test(String(g.file || "")) && g.sizes && g.sizes["800"] && g.sizes[size]).map((g) => `/product-photos/${folder}/${g.file}-${size}.webp`);
    if (urls.length) value[key] = urls;
  }
  pageGalleries = { at: Date.now(), dir, size, value };
  return value;
}

// Where a product photo lives on disk, or null for anything that isn't a
// plainly named WebP inside a model's own folder.
export function productPhotoFile(dir, model, file) {
  if (!/^[0-9A-Z]{3,40}$/.test(String(model || ""))) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,79}\.webp$/.test(String(file || ""))) return null;
  return path.join(dir, model, file);
}

// What the page may say about price and stock, from the catalog's own unit
// for the model (the one "?add=" would put in the cart: new before open box).
// The rules are the shop tile's:
//   shop paused            -> no price, call
//   nothing in stock       -> no price, call
//   unit has no price      -> "Call for price"
//   price may be advertised (mapPublic)        -> the price
//   price is below the advertised-price floor  -> the floor, with the note
//   otherwise                                  -> "Price in cart"
// The real price of a below-floor unit never reaches the page.
// The regular price to strike through beside a lower current one (Andrew
// 11/18: "show the full MAP with strikethrough and the current PMAP/RETAIL").
// `mapRegular` is the MAP feed's price WITHOUT promotions for the model.
// It shows only:
//   - for a NEW unit (an open-box price is not a promotion on the new one),
//   - beside a number the shopper is being shown (`shown`),
//   - when it is at least a dollar above that number, and
//   - when that number is no less than half of it (a wider gap is far more
//     likely a bad row in the feed than a promotion).
// The shop tile, the product page and the catalog all ask this one function.
export function regularPriceToShow(unit, shown) {
  const regular = Number(unit?.mapRegular), now = Number(shown);
  if (!unit || unit.condition !== "new" || !Number.isFinite(regular) || !Number.isFinite(now) || now <= 0) return null;
  if (regular - now < 1 || now < regular * 0.5) return null;
  return Math.round(regular * 100) / 100;
}

export function productOfferView({ paused = false, unit = null } = {}) {
  const out = { mode: "buy", price: "", priceIsText: false, was: "", note: "", stock: "", stockOk: true, stockNote: "" };
  if (paused) return { ...out, mode: "paused" };
  if (!unit) return { ...out, mode: "out", stock: "Not in stock today", stockOk: false };
  const fresh = unit.source === "stock" || unit.condition === "new";
  if (!unit.hideStockBadge) {
    if (unit.source === "stock") out.stock = unit.stockLevel === "in" ? "In stock" : "Low stock";
    else if (unit.condition === "new") out.stock = "New in box";
    else if (unit.condition === "open") out.stock = String(unit.serialType || "").toUpperCase() === "DISPLAY" ? "Floor model" : "Open box";
    if (out.stock && fresh) out.stockNote = "Ready for delivery in a few days";
  }
  const price = Number(unit.price), floor = Number(unit.mapFloor);
  if (unit.noPrice || !(price > 0)) return { ...out, mode: "call", price: "Call for price", priceIsText: true };
  const was = (shown) => { const w = regularPriceToShow(unit, shown); return w ? money(w) : ""; };
  if (unit.mapPublic) return { ...out, price: money(price), was: was(price) };
  if (unit.mapFloor != null && Number.isFinite(floor) && price < floor) {
    return { ...out, price: money(Math.round(floor * 100) / 100), was: was(Math.round(floor * 100) / 100), note: "Our price on this model is too low to advertise. Add it to your cart to see it." };
  }
  return { ...out, price: "Price in cart", priceIsText: true };
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const chev = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const shopUrl = (params) => "/shop.html" + (params ? "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "");

// The whole page. `live` = { paused, unit, onDisplay, sheets: [{ label, url }] }.
export function renderProductPage(template, rec, live = {}) {
  const key = productPageKey(rec.model);
  // Some makers have two numbers for a model. Miele's item number (12496900)
  // is what ePASS, the catalog and the cart know; its name (G 7766 SCVi
  // AutoDos) is what a shopper knows. `displayModel` is the name to show; the
  // address, the photos and Add to cart stay on the item number.
  const shown = rec.displayModel || rec.model;
  const view = productOfferView(live);
  const gallery = rec.gallery.filter((g) => g && g.file && g.sizes && g.sizes["800"]);
  const n = gallery.length;
  // A line of models that shares its pictures (Speed Queen: a gas and an
  // electric dryer are one cabinet) keeps them in one folder, named by the
  // record's `photoKey`; otherwise the folder is the model's own.
  const photoDir = photoFolder(rec, key);
  const photo = (g, size) => `/product-photos/${photoDir}/${g.file}-${size}.webp`;

  const slides = gallery.map((g, i) => {
    const [w, h] = g.sizes["800"];
    const set = ["800", "1600"].filter((s) => g.sizes[s]).map((s) => `${photo(g, s)} ${g.sizes[s][0]}w`).join(", ");
    const load = i === 0 ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
    return `            <div class="g-slide${g.fill ? " fill" : ""}"><img src="${photo(g, "800")}" srcset="${set}" sizes="(max-width: 900px) 92vw, 560px" alt="${esc(g.alt)}" width="${w}" height="${h}"${load}></div>`;
  }).join("\n");
  const thumbs = n < 2 ? "" : `        <div class="g-thumbs" id="gThumbs">\n` + gallery.map((g, i) => {
    const small = g.sizes["400"] ? "400" : "800";
    return `          <button type="button" class="g-thumb${g.fill ? " fill" : ""}" aria-label="Photo ${i + 1} of ${n}: ${esc(g.alt)}" aria-current="${i === 0 ? "true" : "false"}"><img src="${photo(g, small)}" alt="" width="${g.sizes[small][0]}" height="${g.sizes[small][1]}" loading="lazy" decoding="async"></button>`;
  }).join("\n") + "\n        </div>";
  const stageControls = n < 2 ? "" : [
    `          <button type="button" class="g-nav prev" aria-label="Previous photo">${chev("m15 18-6-6 6-6")}</button>`,
    `          <button type="button" class="g-nav next" aria-label="Next photo">${chev("m9 18 6-6-6-6")}</button>`,
    `          <span class="g-count" id="gCount" aria-hidden="true">1 / ${n}</span>`
  ].join("\n");
  const trackAttrs = n < 2 ? "" : ' tabindex="0" role="group" aria-label="Photos. Swipe, or use the left and right arrow keys."';

  const facts = (rec.facts || []).map(([v, k]) => `          <div><dt${String(v).length > 8 ? ' class="long"' : ""}>${esc(v)}</dt><dd>${esc(k)}</dd></div>`).join("\n");
  const features = rec.features.slice(0, 5).map((f, i) => `          <li><span class="f-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(f.name)}</h3><p>${esc(f.line)}</p></div></li>`).join("\n");
  const also = (rec.also || []).length
    ? `        <div class="also">\n          <h3>Also on this model</h3>\n          <ul>\n${rec.also.map((a) => `            <li>${esc(a)}</li>`).join("\n")}\n          </ul>\n        </div>`
    : "";
  const specs = (rec.specs || []).map(([k, v]) => `          <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("\n");
  const docs = (live.sheets || []).map((d) => `        <a class="doc" href="${esc(d.url)}" target="_blank" rel="noopener"><span class="doc-ic" aria-hidden="true">PDF</span><span class="doc-tx">${esc(d.label)}<small>${esc(d.note || "Exact dimensions, features and installation by model")}</small></span></a>`).join("\n");

  const dept = String(rec.department || "");
  const deptLinks = [`        <a class="dept-link outlet" href="${shopUrl({ outlet: 1 })}">Outlet</a>`]
    .concat(DEPARTMENTS.map((d) => `        <a class="dept-link${d === dept ? " here" : ""}" href="${shopUrl({ dept: d })}"${d === dept ? ' aria-current="true"' : ""}>${esc(d)}</a>`)).join("\n");
  const crumbs = [`        <li><a href="/shop.html">Express Assortment</a></li>`]
    .concat(DEPARTMENTS.includes(dept) ? [`        <li><a href="${shopUrl({ dept })}">${esc(dept)}</a></li>`] : [])
    .concat(DEPARTMENTS.includes(dept) && rec.category ? [`        <li><a href="${shopUrl({ dept, sub: rec.category })}">${esc(rec.category)}</a></li>`] : [])
    .concat([`        <li><span class="here" aria-current="page">${esc(shown)}</span></li>`]).join("\n");

  // price, stock and the button
  const addUrl = shopUrl({ add: rec.model });
  const callBtn = (label) => `<a class="btn ghost" href="tel:${SHOP_PHONE}">${esc(label)}</a>`;
  const cta = view.mode === "buy" ? `<a class="btn primary" data-add="${esc(addUrl)}" data-model="${esc(rec.model)}" href="${esc(addUrl)}">Add to cart</a>`
    : view.mode === "paused" ? callBtn("Call for availability") : callBtn(`Call ${SHOP_PHONE}`);
  const stockLine = view.stock ? `<span class="b-stock${view.stockOk ? "" : " none"}">${esc(view.stock)}${view.stockNote ? ` <span>· ${esc(view.stockNote)}</span>` : ""}</span>` : "";
  // the regular price, struck through, ahead of the current one (see regularPriceToShow)
  const wasTag = (cls, now) => (view.was ? `<span class="${cls}"><span class="sr-only">Regular price </span><s>${esc(view.was)}</s></span><span class="sr-only">${now}</span>` : "");
  const priceRow = view.price || stockLine
    ? `          <div class="b-price-row">\n            ${view.price ? `<span class="b-price${view.priceIsText ? " text" : ""}">${wasTag("b-was", "Current price ")}${esc(view.price)}</span>` : ""}${stockLine}\n          </div>`
    : "";
  // "Nothing is charged online" came out 11/19 (Andrew: the next step is a card form, and sales charge the saved
  // card after confirming, so the line read as misleading). Where the number is offered, so is a text.
  const assure = []
    .concat(view.mode === "out" ? [`This model isn't in the Express Assortment today. Call or ${TEXT_US} and we'll help you with it, or <a href="/shop.html">see what's in stock</a>.`] : [])
    .concat(live.onDisplay ? ["On display in our Dripping Springs showroom. Come and see it."] : [])
    .concat([`Express Delivery via online order is only available locally. Please <a href="tel:${SHOP_PHONE}">call</a> or ${TEXT_US} to schedule in the greater Austin and San Antonio area.`, `Questions about this model? Call <a href="tel:${SHOP_PHONE}">${SHOP_PHONE}</a> or ${TEXT_US}.`]);
  // "Do we deliver to you?" (11/19): the question the shop's door used to ask, answered here without leaving the
  // page. The template's script asks /api/shop/zip-check and keeps the ZIP in this tab for the cart. Only where the
  // model can be ordered online.
  const zipBox = view.mode === "buy" ? [
    `          <form class="b-zip" id="zipBox" autocomplete="on" novalidate>`,
    `            <label class="b-zip-q" id="zipQ" for="zipIn">Do we deliver to you?</label>`,
    `            <span class="b-zip-row" id="zipAsk"><input id="zipIn" name="postal-code" type="text" inputmode="numeric" maxlength="10" placeholder="ZIP code" autocomplete="postal-code" enterkeyhint="go" autocapitalize="off" autocorrect="off" spellcheck="false"><button class="btn ghost" type="submit" id="zipBtn">Check</button></span>`,
    `            <p class="b-zip-a" id="zipAns" role="status" aria-live="polite"></p>`,
    `            <button type="button" class="b-zip-change" id="zipChange" hidden>Change</button>`,
    `          </form>`
  ].join("\n") : "";
  const offer = [
    priceRow,
    view.note ? `          <p class="b-price-note">${esc(view.note)}</p>` : "",
    // "Added to your cart" under the button once it says Go to Cart (11/19; the template's script fills it)
    `          <div class="b-cta" id="ctaMain">${cta}${view.mode === "buy" ? `<p class="b-added" id="cartNote" role="status" aria-live="polite" hidden></p>` : ""}</div>`,
    zipBox,
    `          <ul class="b-assure">\n${assure.map((t) => `            <li>${CHECK}<span>${t}</span></li>`).join("\n")}\n          </ul>`
  ].filter(Boolean).join("\n");
  // Why Wilson: every card in the page, the first one showing; the template's
  // script picks one at random (not the last one this tab saw).
  const whySet = live.why?.cards?.length ? live.why : { kicker: "Why Wilson", cards: WHY_FALLBACK };
  const why = whySet.cards.map((c, i) => [
    `        <div class="why-card" data-why="${esc(c.id)}"${i ? " hidden" : ""}>`,
    `          <p class="kicker">${esc(whySet.kicker)}</p>`,
    `          <h2>${esc(c.title)}</h2>`,
    `          <p>${esc(c.body)}</p>`,
    ...(c.link ? [`          <a class="why-link" href="${esc(c.link.href)}"${/^https:/i.test(c.link.href) ? ' target="_blank" rel="noopener"' : ""}>${esc(c.link.label)}</a>`] : []),
    `        </div>`
  ].join("\n")).join("\n");
  // Google Tag (11/19): what view_item / add_to_cart report for this page. The price only when the page shows
  // one as a number (never a "Price in cart" unit's price). `<` escaped so the JSON can't close its script tag.
  const shownPrice = !view.priceIsText && /^\$[\d,]+(\.\d{1,2})?$/.test(String(view.price || "")) ? Number(String(view.price).replace(/[$,]/g, "")) : 0;
  const gaItem = JSON.stringify({
    item_id: rec.model, item_name: `${rec.brand} ${shown}`, item_brand: rec.brand,
    ...(rec.department ? { item_category: rec.department } : {}), ...(rec.category ? { item_category2: rec.category } : {}),
    ...(live.unit?.condition === "open" ? { item_variant: "Open Box" } : live.unit?.condition === "new" ? { item_variant: "New in Box" } : {}),
    ...(shownPrice > 0 ? { price: shownPrice } : {}), quantity: 1
  }).replace(/</g, "\\u003c");
  const buyBar = `<div class="bb-info"><div class="bb-name">${esc(rec.brand)} ${esc(shown)}</div>${view.price ? `<div class="bb-price${view.priceIsText ? " text" : ""}">${wasTag("bb-was", "Current price ")}${esc(view.price)}</div>` : ""}</div>${cta}`;

  const fill = {
    PAGE_TITLE: esc(rec.displayModel ? `${rec.brand} ${rec.title} (${rec.model})` : `${rec.brand} ${rec.model} ${rec.title}`),
    BRAND: esc(rec.brand), MODEL: esc(shown), SERIES: esc(rec.series || ""), PAGE_KEY: key,
    MODEL_LINE: rec.displayModel ? `${esc(rec.brand)} no. ${esc(rec.model)}` : `Model ${esc(rec.model)}`,
    EYEBROW: esc([rec.brand, rec.series].filter(Boolean).join(" · ")),
    TITLE: esc(rec.title), SUB: esc(rec.sub || ""), LEAD: esc(rec.lead || ""),
    NOUN: esc(rec.noun || "model"), FEATURE_KICKER: COUNT_WORD[Math.min(rec.features.length, 5)] || "Why it's here",
    DEPT_LINKS: deptLinks, CRUMBS: crumbs, SLIDES: slides, STAGE_CONTROLS: stageControls, THUMBS: thumbs, TRACK_ATTRS: trackAttrs,
    FACTS: facts, OFFER: offer, FEATURES: features, ALSO: also, SPECS: specs, DOCS: docs, BUYBAR: buyBar, WHY: why, GA_ITEM: gaItem
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(fill, name) ? fill[name] : ""));
}
