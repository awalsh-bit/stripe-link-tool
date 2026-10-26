// ---------------------------------------------------------------------------
// Catalog Check — NetSuite item master vs ePASS model master (Andrew 10/25).
//
// NetSuite is meant to be the source of truth for brand, supplier and the
// merchandise hierarchy; ePASS is where the models are actually sold and
// stocked. This compares the two, model by model, and reports:
//   missing_in_netsuite   ePASS sells / stocks it, NetSuite has no item
//   no_hierarchy          NetSuite item has no Merch Category/Class/Subclass
//   brand_mismatch        the two systems name a different brand
//   supplier_mismatch     ePASS's supplier (Model.SupplierCode) vs NetSuite's
//   supplier_blank        NetSuite has no supplier where ePASS does
// plus the crosstabs that show whether the mapping between ePASS product
// codes and NetSuite merch classes is clean (one product code → one class).
//
// Inputs (all already in Postgres):
//   model_brand_map (source='netsuite')  brand, vendor, merch_*, discontinued
//   netsuite_items                       item_type, base_price, primary_supplier
//   epass_model_master                   brand, product_code, description
//   epass_open_order_models              supplier_code / supplier_name, raw
//   epass_on_hand_serials                on-hand count per model
//   epass_suppliers                      supplier code → description
// Pure read; nothing is written.
// ---------------------------------------------------------------------------

import { getPostgresPool } from "./data-postgres.js";

export const CATALOG_ISSUES = {
  missing_in_netsuite: "In ePASS, not in NetSuite",
  no_hierarchy: "No merch hierarchy in NetSuite",
  brand_mismatch: "Brand differs",
  supplier_mismatch: "Supplier differs",
  supplier_blank: "No supplier in NetSuite"
};

const normModel = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const brandKey = (v) => String(v || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

// "0012 Whirlpool Corporation" → "whirlpool"; "SUB-ZERO GROUP SOUTH CENTRAL" → "subzerogroupsouthcentral".
const SUPPLIER_NOISE = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|usa|us|the|of|group|distributing|distribution|distributors|sales|home|appliances?|brands?|south|central|north|east|west|texas|tx)\b/g;
export function supplierKey(v) {
  return String(v || "").toLowerCase().replace(/^\s*\d{3,5}\s+/, "").replace(/[^a-z0-9 ]/g, " ").replace(SUPPLIER_NOISE, " ").replace(/\s+/g, "").trim();
}
function suppliersAgree(a, b) {
  const ka = supplierKey(a), kb = supplierKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.startsWith(kb) || kb.startsWith(ka);
}
// Brands that are deliberately different words for the same thing.
const BRAND_ALIASES = { subzero: "subzero", sz: "subzero", wolfgourmet: "wolfgourmet", ge: "ge", geappliances: "ge", geprofile: "ge", gecafe: "cafe", monogram: "monogram", kitchenaid: "kitchenaid", whirlpoolcorp: "whirlpool", fisherandpaykel: "fisherpaykel", fisherpaykel: "fisherpaykel", bsh: "bosch", speedqueen: "speedqueen", sq: "speedqueen" };
function brandsAgree(a, b) {
  let ka = brandKey(a), kb = brandKey(b);
  ka = BRAND_ALIASES[ka] || ka; kb = BRAND_ALIASES[kb] || kb;
  if (!ka || !kb) return true; // can't judge a blank
  return ka === kb || ka.startsWith(kb) || kb.startsWith(ka);
}

async function safeRows(pool, sql, params = []) {
  try { return (await pool.query(sql, params)).rows; } catch { return []; }
}

export async function buildCatalogCheck() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");

  const [nsRows, nsItems, master, openModels, onHand, suppliers, nsMeta] = await Promise.all([
    safeRows(pool, `SELECT model, brand, description, prod, vendor, merch_category, merch_class, merch_subclass, discontinued FROM model_brand_map WHERE source = 'netsuite'`),
    safeRows(pool, `SELECT model_key, model_number, brand, item_type, base_price, primary_supplier FROM netsuite_items`),
    safeRows(pool, `SELECT model, brand_code, brand, product_code, description FROM epass_model_master`),
    safeRows(pool, `SELECT model_code, brand, supplier_code, supplier_name, raw FROM epass_open_order_models`),
    safeRows(pool, `SELECT model_code, COUNT(*)::int AS n, MAX(raw->>'ProductCode') AS product_code, MAX(raw->>'SupplierCode') AS supplier_code FROM epass_on_hand_serials GROUP BY model_code`),
    safeRows(pool, `SELECT code, description, inventory_supplier, obsolete FROM epass_suppliers`),
    safeRows(pool, `SELECT uploaded_at, source_file, item_count FROM netsuite_items_meta WHERE id = 1`)
  ]);

  const supplierName = new Map(suppliers.map((s) => [String(s.code || "").trim().toUpperCase(), String(s.description || "").trim()]));

  // NetSuite side, keyed by normalized model.
  const ns = new Map();
  for (const r of nsRows) {
    const k = normModel(r.model); if (!k) continue;
    ns.set(k, { model: r.model, brand: r.brand || "", description: r.description || "", vendor: r.vendor || "", category: r.merch_category || "", cls: r.merch_class || "", subclass: r.merch_subclass || "", discontinued: r.discontinued === "yes", type: "", basePrice: null, primarySupplier: "" });
  }
  for (const r of nsItems) {
    const k = normModel(r.model_key || r.model_number); if (!k) continue;
    const cur = ns.get(k);
    if (cur) { cur.type = r.item_type || ""; cur.basePrice = r.base_price == null ? null : Number(r.base_price); cur.primarySupplier = r.primary_supplier || ""; if (!cur.vendor) cur.vendor = r.primary_supplier || ""; }
    else ns.set(k, { model: r.model_number || r.model_key, brand: r.brand || "", description: "", vendor: r.primary_supplier || "", category: "", cls: "", subclass: "", discontinued: false, type: r.item_type || "", basePrice: r.base_price == null ? null : Number(r.base_price), primarySupplier: r.primary_supplier || "" });
  }

  // ePASS side: model master ∪ open-order models ∪ on-hand serials.
  const ep = new Map();
  const touch = (model) => { const k = normModel(model); if (!k) return null; if (!ep.has(k)) ep.set(k, { model: String(model).trim(), brand: "", brandCode: "", productCode: "", description: "", supplierCode: "", supplier: "", onHand: 0, openOrder: false, inMaster: false }); return ep.get(k); };
  for (const r of master) { const e = touch(r.model); if (!e) continue; e.inMaster = true; e.brand = r.brand || e.brand; e.brandCode = r.brand_code || e.brandCode; e.productCode = r.product_code || e.productCode; e.description = r.description || e.description; }
  for (const r of openModels) {
    const e = touch(r.model_code); if (!e) continue;
    e.openOrder = true;
    const raw = r.raw && typeof r.raw === "object" ? r.raw : {};
    e.brand = e.brand || r.brand || raw.BrandCode || "";
    e.brandCode = e.brandCode || raw.BrandCode || "";
    e.productCode = e.productCode || raw.ProductCode || "";
    e.description = e.description || raw.Description || "";
    e.supplierCode = r.supplier_code || raw.SupplierCode || e.supplierCode;
    e.supplier = r.supplier_name || raw.Supplier_Description || e.supplier;
  }
  for (const r of onHand) {
    const e = touch(r.model_code); if (!e) continue;
    e.onHand = Number(r.n) || 0;
    e.productCode = e.productCode || r.product_code || "";
    e.supplierCode = e.supplierCode || r.supplier_code || "";
  }
  for (const e of ep.values()) {
    if (!e.supplier && e.supplierCode) e.supplier = supplierName.get(e.supplierCode.toUpperCase()) || e.supplierCode;
  }

  // Compare.
  const rows = [];
  const counts = Object.fromEntries(Object.keys(CATALOG_ISSUES).map((k) => [k, 0]));
  const prodByClass = new Map();   // ePASS product code → { netsuite class → n }
  const noHierByProd = new Map();  // ePASS product code → n (NetSuite items without hierarchy)
  const supplierPairs = new Map(); // ePASS supplier → { NetSuite vendor → n }
  for (const [k, e] of ep) {
    const n = ns.get(k) || null;
    const issues = [];
    if (!n) issues.push("missing_in_netsuite");
    else {
      if (!n.category && !n.cls) issues.push("no_hierarchy");
      if (n.brand && e.brand && !brandsAgree(n.brand, e.brand)) issues.push("brand_mismatch");
      if (e.supplier) {
        if (!n.vendor) issues.push("supplier_blank");
        else if (!suppliersAgree(n.vendor, e.supplier)) issues.push("supplier_mismatch");
      }
      if (e.productCode) {
        if (n.cls) { const m = prodByClass.get(e.productCode) || new Map(); m.set(n.cls, (m.get(n.cls) || 0) + 1); prodByClass.set(e.productCode, m); }
        else noHierByProd.set(e.productCode, (noHierByProd.get(e.productCode) || 0) + 1);
      }
      if (e.supplier && n.vendor) { const m = supplierPairs.get(e.supplier) || new Map(); m.set(n.vendor, (m.get(n.vendor) || 0) + 1); supplierPairs.set(e.supplier, m); }
    }
    for (const i of issues) counts[i] += 1;
    if (issues.length) {
      rows.push({
        model: e.model, issues,
        epass: { brand: e.brand, brandCode: e.brandCode, productCode: e.productCode, description: e.description, supplier: e.supplier, supplierCode: e.supplierCode, onHand: e.onHand, openOrder: e.openOrder, inMaster: e.inMaster },
        netsuite: n ? { brand: n.brand, vendor: n.vendor, category: n.category, cls: n.cls, subclass: n.subclass, type: n.type, basePrice: n.basePrice, discontinued: n.discontinued, description: n.description } : null
      });
    }
  }
  // Rows that matter most first: stocked / on order, then by model.
  rows.sort((a, b) => (b.epass.onHand - a.epass.onHand) || (Number(b.epass.openOrder) - Number(a.epass.openOrder)) || a.model.localeCompare(b.model));

  const crosstab = [...prodByClass.entries()].map(([prod, m]) => {
    const classes = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => ({ cls, n }));
    const total = classes.reduce((s, c) => s + c.n, 0);
    return { productCode: prod, total, classes, dominant: classes[0]?.cls || "", dominantShare: total ? Math.round(classes[0].n / total * 100) : 0 };
  }).sort((a, b) => b.total - a.total);
  const noHierarchyByProductCode = [...noHierByProd.entries()].map(([productCode, n]) => ({ productCode, n })).sort((a, b) => b.n - a.n);
  const supplierMap = [...supplierPairs.entries()].map(([epassSupplier, m]) => {
    const vendors = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([vendor, n]) => ({ vendor, n, agrees: suppliersAgree(vendor, epassSupplier) }));
    return { epassSupplier, total: vendors.reduce((s, v) => s + v.n, 0), vendors };
  }).sort((a, b) => b.total - a.total);

  const nsOnly = [...ns.keys()].filter((k) => !ep.has(k)).length;
  return {
    generatedAt: new Date().toISOString(),
    netsuite: { models: ns.size, withHierarchy: [...ns.values()].filter((n) => n.category || n.cls).length, withVendor: [...ns.values()].filter((n) => n.vendor).length, uploadedAt: nsMeta[0]?.uploaded_at || null, sourceFile: nsMeta[0]?.source_file || "", notSeenInEpass: nsOnly },
    epass: { models: ep.size, inMaster: master.length, onOpenOrders: openModels.length, stockedModels: onHand.length },
    counts, rows, crosstab, noHierarchyByProductCode, supplierMap
  };
}

export function catalogCheckCsv(result, { issue = "" } = {}) {
  const cell = (v) => { let t = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ["Model", "Issues", "ePASS Brand", "ePASS Product Code", "ePASS Supplier", "On Hand", "Open Order", "NetSuite Brand", "NetSuite Supplier", "Merch Category", "Merch Class", "Merch Subclass", "NetSuite Type", "Discontinued", "ePASS Description"];
  const lines = [head.join(",")];
  for (const r of result.rows) {
    if (issue && !r.issues.includes(issue)) continue;
    const n = r.netsuite || {};
    lines.push([r.model, r.issues.map((i) => CATALOG_ISSUES[i] || i).join("; "), r.epass.brand, r.epass.productCode, r.epass.supplier, r.epass.onHand, r.epass.openOrder ? "yes" : "", n.brand || "", n.vendor || "", n.category || "", n.cls || "", n.subclass || "", n.type || "", n.discontinued ? "yes" : "", r.epass.description].map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
