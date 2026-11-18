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
export function productOfferView({ paused = false, unit = null } = {}) {
  const out = { mode: "buy", price: "", priceIsText: false, note: "", stock: "", stockOk: true, stockNote: "" };
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
  if (unit.mapPublic) return { ...out, price: money(price) };
  if (unit.mapFloor != null && Number.isFinite(floor) && price < floor) {
    return { ...out, price: money(Math.round(floor * 100) / 100), note: "Our price on this model is too low to advertise. Add it to your cart to see it." };
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
  const photo = (g, size) => `/product-photos/${key}/${g.file}-${size}.webp`;

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
  const cta = view.mode === "buy" ? `<a class="btn primary" data-add="${esc(addUrl)}" href="${esc(addUrl)}">Add to cart</a>`
    : view.mode === "paused" ? callBtn("Call for availability") : callBtn(`Call ${SHOP_PHONE}`);
  const stockLine = view.stock ? `<span class="b-stock${view.stockOk ? "" : " none"}">${esc(view.stock)}${view.stockNote ? ` <span>· ${esc(view.stockNote)}</span>` : ""}</span>` : "";
  const priceRow = view.price || stockLine
    ? `          <div class="b-price-row">\n            ${view.price ? `<span class="b-price${view.priceIsText ? " text" : ""}">${esc(view.price)}</span>` : ""}${stockLine}\n          </div>`
    : "";
  const assure = (view.mode === "buy" ? ["Nothing is charged online. A Wilson team member confirms every order before payment."] : [])
    .concat(view.mode === "out" ? [`This model isn't in the Express Assortment today. Call and we'll help you with it, or <a href="/shop.html">see what's in stock</a>.`] : [])
    .concat(live.onDisplay ? ["On display in our Dripping Springs showroom. Come and see it."] : [])
    .concat(["Delivered in the Wilson AC &amp; Appliance local area.", `Questions about this model? Call <a href="tel:${SHOP_PHONE}">${SHOP_PHONE}</a>.`]);
  const offer = [
    priceRow,
    view.note ? `          <p class="b-price-note">${esc(view.note)}</p>` : "",
    `          <div class="b-cta" id="ctaMain">${cta}</div>`,
    `          <ul class="b-assure">\n${assure.map((t) => `            <li>${CHECK}<span>${t}</span></li>`).join("\n")}\n          </ul>`
  ].filter(Boolean).join("\n");
  const buyBar = `<div class="bb-info"><div class="bb-name">${esc(rec.brand)} ${esc(shown)}</div>${view.price ? `<div class="bb-price${view.priceIsText ? " text" : ""}">${esc(view.price)}</div>` : ""}</div>${cta}`;

  const fill = {
    PAGE_TITLE: esc(rec.displayModel ? `${rec.brand} ${rec.title} (${rec.model})` : `${rec.brand} ${rec.model} ${rec.title}`),
    BRAND: esc(rec.brand), MODEL: esc(shown), SERIES: esc(rec.series || ""), PAGE_KEY: key,
    MODEL_LINE: rec.displayModel ? `${esc(rec.brand)} no. ${esc(rec.model)}` : `Model ${esc(rec.model)}`,
    EYEBROW: esc([rec.brand, rec.series].filter(Boolean).join(" · ")),
    TITLE: esc(rec.title), SUB: esc(rec.sub || ""), LEAD: esc(rec.lead || ""),
    NOUN: esc(rec.noun || "model"), FEATURE_KICKER: COUNT_WORD[Math.min(rec.features.length, 5)] || "Why it's here",
    DEPT_LINKS: deptLinks, CRUMBS: crumbs, SLIDES: slides, STAGE_CONTROLS: stageControls, THUMBS: thumbs, TRACK_ATTRS: trackAttrs,
    FACTS: facts, OFFER: offer, FEATURES: features, ALSO: also, SPECS: specs, DOCS: docs, BUYBAR: buyBar
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(fill, name) ? fill[name] : ""));
}
