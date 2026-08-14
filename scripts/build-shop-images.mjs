// Rebuild data/shop-images.json — model → Webfronts thumbnail URL for every
// model on the current clearance list.
//
//   node scripts/build-shop-images.mjs [path-to-whse_inventory_and_prices.xlsx]
//
// Run it after regenerating data/clearance.json (new clearance workbook) or
// after downloading a fresh whse_inventory_and_prices.xlsx, then commit the
// updated data/shop-images.json. The storefront falls back to a text-only
// card for any model without a match.
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const whsePath = process.argv[2] || path.join(repoRoot, "whse_inventory_and_prices.xlsx");
const clearancePath = path.join(repoRoot, "data", "clearance.json");
const outPath = path.join(repoRoot, "data", "shop-images.json");

const norm = (s) => String(s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

console.log("Reading", whsePath, "(large file — this takes a minute)...");
const wb = XLSX.readFile(whsePath, { dense: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
const thumbCol = header.indexOf("thumbnail");
const pnCols = ["pn", "manufacturer_pn", "wf_pn"].map((n) => header.indexOf(n)).filter((i) => i >= 0);
if (thumbCol < 0 || !pnCols.length) {
  console.error("Couldn't find the thumbnail / pn columns — is this the WHSE Inventory and Prices export?");
  process.exit(1);
}

const map = new Map();
for (let i = 1; i < rows.length; i++) {
  const r = rows[i] || [];
  const raw = String(r[thumbCol] ?? "");
  if (!raw.includes("url")) continue;
  let url = "";
  try {
    const parsed = JSON.parse(raw);
    url = parsed.url300 || parsed.url || "";
  } catch { continue; }
  if (!url) continue;
  for (const c of pnCols) {
    const key = norm(r[c]);
    if (key && key.length >= 4 && !map.has(key)) map.set(key, url);
  }
}
console.log("Thumbnail keys indexed:", map.size);

const clearance = JSON.parse(fs.readFileSync(clearancePath, "utf8"));
const models = [...new Set((clearance.items || []).map((i) => norm(i.model)))];
const byModel = {};
for (const m of models) if (map.has(m)) byModel[m] = map.get(m);

fs.writeFileSync(outPath, JSON.stringify({
  _meta: {
    note: "model → Webfronts url300 thumbnail, generated from whse_inventory_and_prices.xlsx for models on the clearance list. Rebuild with scripts/build-shop-images.mjs after refreshing the clearance list.",
    source: path.basename(whsePath)
  },
  byModel
}, null, 1));
console.log(`Wrote ${outPath}: ${Object.keys(byModel).length} of ${models.length} clearance models have a thumbnail.`);
