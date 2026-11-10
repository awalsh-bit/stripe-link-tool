// ---------------------------------------------------------------------------
// NetSuite merchandise classes & subclasses (Andrew 11/10): the ONE place
// Agility knows what kind of thing a model is. ePASS product codes (RAGAS,
// WASHF, ...) are legacy — they survive only as a fallback for a model NetSuite
// hasn't classified, and as the key the install/connector map was first
// written in. Everything else keys on the NetSuite subclass code.
//
// Vocabulary generated from the NetSuite item catalog export (Items436.csv,
// 22,699 items, 34 classes, 135 subclasses). Re-run the generator in
// scratch when NetSuite adds a subclass; the shop simply ignores codes it
// doesn't know.
// ---------------------------------------------------------------------------

export const MERCH_CLASSES = {
  "102": "Freestanding Refrigeration",
  "104": "Built-in Refrigeration",
  "107": "Refrigerator Accessories",
  "108": "Undercounter Refrigeration",
  "114": "Specialty Undercounter",
  "120": "Dishwasher",
  "130": "Professional Range",
  "132": "Standard Range",
  "134": "Cooktop",
  "136": "Rangetop",
  "138": "Built-in Wall Oven",
  "140": "Built-in Microwaves",
  "142": "Warming Drawer",
  "144": "Vacuum Drawer",
  "149": "Cooking Accessories",
  "152": "Ventilation",
  "154": "Ventilation Components",
  "160": "Built-in Coffee",
  "182": "Countertop Small Appliance",
  "185": "Indoor Appliance Cabinets",
  "204": "Clothes Dryer",
  "206": "Specialty Laundry Appliance",
  "208": "Clothes Washer",
  "210": "Washer Dryer Combination",
  "220": "Laundry Accessories",
  "222": "Laundry Cleaning Solutions",
  "310": "Disposal",
  "806": "Grills",
  "808": "Outdoor Ovens",
  "810": "Outdoor Griddles",
  "812": "Outdoor Doors and Drawers",
  "814": "Outdoor Plumbing",
  "816": "Grill Accessories",
  "820": "Outdoor Appliances"
};

export const MERCH_SUBCLASSES = {
  "1022": { name: "Freestanding French Door", cls: "102" },
  "1024": { name: "Freestanding Quad Door", cls: "102" },
  "1026": { name: "Freestanding Side-by-side", cls: "102" },
  "1028": { name: "Single Door Bottom Mount", cls: "102" },
  "1030": { name: "Compact", cls: "102" },
  "1032": { name: "Top Freezer", cls: "102" },
  "1036": { name: "Upright Freezer", cls: "102" },
  "1038": { name: "Chest Freezer", cls: "102" },
  "1104": { name: "Built-in Ice Machine", cls: "104" },
  "1110": { name: "All Refrigerator Column", cls: "104" },
  "1114": { name: "All Wine Column", cls: "104" },
  "1116": { name: "Freezer Column", cls: "104" },
  "1118": { name: "Refrigerator with Combination Drawers", cls: "104" },
  "1119": { name: "Refrigerator with Refrigerator Drawers", cls: "104" },
  "1120": { name: "Refrigerator with Freezer Drawers", cls: "104" },
  "1122": { name: "Wine with Refrigerator Drawers", cls: "104" },
  "1124": { name: "Built-in French Door", cls: "104" },
  "1126": { name: "Built-in Side-by-Side", cls: "104" },
  "1128": { name: "Built-in Single Door Bottom Mount", cls: "104" },
  "1130": { name: "Built-in Refrigeration Panels", cls: "104" },
  "1132": { name: "Built-in Refrigeration Accessories", cls: "104" },
  "1212": { name: "Refrigerator Install Accessories", cls: "107" },
  "1214": { name: "Refrigerator Water Filters", cls: "107" },
  "1216": { name: "Refrigerator Air Filters", cls: "107" },
  "1218": { name: "Refrigerator Door Bins and Shelves", cls: "107" },
  "1312": { name: "Undercounter Refrigerator", cls: "108" },
  "1316": { name: "Undercounter Beverage Center", cls: "108" },
  "1318": { name: "Undercounter Drawer Refrigerator", cls: "108" },
  "1320": { name: "Undercounter Combination Drawers", cls: "108" },
  "1322": { name: "Undercounter Freezer Drawers", cls: "108" },
  "1324": { name: "Undercounter Wine Reserve", cls: "108" },
  "1328": { name: "Undercounter Door Panels", cls: "108" },
  "1329": { name: "Trash Compactors", cls: "114" },
  "1330": { name: "Built-in Dishwasher", cls: "120" },
  "1332": { name: "Portable Dishwasher", cls: "120" },
  "1334": { name: "Dishwasher Installation Accessories", cls: "120" },
  "1335": { name: "Dishwasher Door Panels and Handles", cls: "120" },
  "1336": { name: "Dishwasher Cleaning Solutions", cls: "120" },
  "1340": { name: "Dual Fuel Pro Range", cls: "130" },
  "1342": { name: "Induction Pro Range", cls: "130" },
  "1344": { name: "All Gas Pro Range", cls: "130" },
  "1346": { name: "Specialty Pro Range", cls: "130" },
  "1348": { name: "Dual Fuel Range", cls: "132" },
  "1350": { name: "Induction Range", cls: "132" },
  "1352": { name: "All Gas Range", cls: "132" },
  "1354": { name: "Electric Range", cls: "132" },
  "1356": { name: "Gas Cooktop", cls: "134" },
  "1358": { name: "Gas Downdraft Cooktop", cls: "134" },
  "1360": { name: "Induction Cooktop", cls: "134" },
  "1362": { name: "Induction Downdraft Cooktop", cls: "134" },
  "1364": { name: "Specialty Cooktop", cls: "134" },
  "1366": { name: "Electric Cooktop", cls: "134" },
  "1368": { name: "Electric Downdraft Cooktop", cls: "134" },
  "1370": { name: "Induction Rangetop", cls: "136" },
  "1371": { name: "Gas Rangetop", cls: "136" },
  "1372": { name: "Specialty Rangetop", cls: "136" },
  "1376": { name: "Single Electric Wall Oven", cls: "138" },
  "1380": { name: "Double Electric Wall Oven", cls: "138" },
  "1382": { name: "Microwave Combo Oven", cls: "138" },
  "1384": { name: "Steam Combo Oven", cls: "138" },
  "1386": { name: "Steam Oven", cls: "138" },
  "1388": { name: "Speed Oven", cls: "138" },
  "1394": { name: "Drop Down Door Microwave", cls: "140" },
  "1396": { name: "Drawer Microwave", cls: "140" },
  "1398": { name: "Over-the-Range Microwave", cls: "140" },
  "1404": { name: "Trim Kit Countertop Microwave", cls: "140" },
  "1406": { name: "Microwave Trim Kits", cls: "140" },
  "1408": { name: "Warming Drawer", cls: "142" },
  "1409": { name: "Warming Drawer Panel Front", cls: "142" },
  "1412": { name: "Vacuum Drawer", cls: "144" },
  "1413": { name: "Vacuum Drawer Panel Front", cls: "144" },
  "1440": { name: "Vacuum Seal Drawer", cls: "144" },
  "1418": { name: "Cooking Cleaning Solution", cls: "149" },
  "1420": { name: "Cooking Racks and Baskets", cls: "149" },
  "1424": { name: "Cooking Install Accessory", cls: "149" },
  "1426": { name: "Undercabinet Hood", cls: "152" },
  "1428": { name: "Wall Mount Hood", cls: "152" },
  "1430": { name: "Island Mount Hood", cls: "152" },
  "1432": { name: "In-Ceiling Hood", cls: "152" },
  "1434": { name: "Telescopic Downdraft System", cls: "152" },
  "1436": { name: "Downdraft Modules", cls: "152" },
  "1450": { name: "Liner / Insert Hood", cls: "152" },
  "1452": { name: "Integrated Blower Motors", cls: "154" },
  "1454": { name: "Inline Blower Motors", cls: "154" },
  "1456": { name: "Remote Blower Motors", cls: "154" },
  "1458": { name: "Ventilation Filters", cls: "154" },
  "1460": { name: "Ventilation Lighting", cls: "154" },
  "1462": { name: "Duct Extension Covers", cls: "154" },
  "1464": { name: "Ventilation Install Accessories", cls: "154" },
  "1510": { name: "Built-in Coffee Non-plumbed", cls: "160" },
  "1512": { name: "Built-in Coffee Plumbed", cls: "160" },
  "1600": { name: "Built-in Coffee System", cls: "160" },
  "1624": { name: "Countertop Appliance Accessories", cls: "182" },
  "1850": { name: "Chateau Cabinets", cls: "185" },
  "2040": { name: "Electric Dryer", cls: "204" },
  "2042": { name: "Gas Dryer", cls: "204" },
  "2044": { name: "Ventless Dryer", cls: "204" },
  "2046": { name: "Drying Cabinet", cls: "204" },
  "2080": { name: "Rotary Iron", cls: "206" },
  "2082": { name: "Clothing Steam Closet", cls: "206" },
  "2110": { name: "Top Load Washing Machine", cls: "208" },
  "2112": { name: "Front Load Washing Machine", cls: "208" },
  "2114": { name: "Commercial Top Load Washer", cls: "208" },
  "2116": { name: "Commercial Front Load Washer", cls: "208" },
  "2140": { name: "Unitized Washer and Dryer", cls: "210" },
  "2142": { name: "Ventless All-in-one Washer and Dryer", cls: "210" },
  "2212": { name: "Dryer Installation Accessories", cls: "220" },
  "2213": { name: "Dryer LP Conversion Kits", cls: "220" },
  "2214": { name: "Front Load Pedestals and Risers", cls: "220" },
  "2216": { name: "Laundry Stacking Kits", cls: "220" },
  "2220": { name: "Laundry Detergent", cls: "222" },
  "3136": { name: "Kitchen Disposal", cls: "310" },
  "8010": { name: "Built-in Gas Grill", cls: "806" },
  "8011": { name: "Built-in Hybrid Grill", cls: "806" },
  "8013": { name: "Built-in Electric Grill", cls: "806" },
  "8014": { name: "Built-in Pellet Grill", cls: "806" },
  "8019": { name: "Built-in Specialty Grill", cls: "806" },
  "8040": { name: "Pizza Ovens", cls: "808" },
  "8042": { name: "Built-in Smoker Cabinet", cls: "808" },
  "8056": { name: "Flattop Griddles", cls: "810" },
  "8110": { name: "Access Doors", cls: "812" },
  "8112": { name: "Outdoor Storage Drawers", cls: "812" },
  "8114": { name: "Outdoor Trash Bins", cls: "812" },
  "8116": { name: "Outdoor Specialty Drawers", cls: "812" },
  "8128": { name: "Outdoor Bar and Prep Sinks", cls: "814" },
  "8430": { name: "Outdoor Faucets", cls: "814" },
  "8090": { name: "Carts for Built-in Grills", cls: "816" },
  "8092": { name: "Jackets for Built-in Grills", cls: "816" },
  "8094": { name: "Outdoor Cooking Accessories", cls: "816" },
  "8096": { name: "Outdoor Install Accessories", cls: "816" },
  "8098": { name: "Outdoor Fuel Conversion Kits", cls: "816" },
  "8210": { name: "Outdoor Refrigerators", cls: "820" },
  "8214": { name: "Outdoor Warming Drawers", cls: "820" },
  "8218": { name: "Outdoor Ventilation", cls: "820" },
  "8224": { name: "Outdoor Dishwashers", cls: "820" }
};

// Legacy ePASS product code -> NetSuite subclass, for models with no NetSuite
// classification (rare: the catalog covers nearly everything stocked).
export const SUBCLASS_BY_EPASS_PROD = {
  REFRE: "1022",
  RESXS: "1026",
  RETOP: "1032",
  REALL: "1110",
  REBIF: "1124",
  REBFD: "1128",
  REBIB: "1128",
  REBIW: "1114",
  REDRA: "1318",
  REUC: "1312",
  REFWI: "1324",
  IMUC: "1104",
  COFFE: "1600",
  DW: "1330",
  DWDRA: "1330",
  RAGAS: "1352",
  RADF: "1348",
  RAELE: "1354",
  RAIND: "1350",
  RAPRO: "1344",
  CTGAS: "1356",
  CTIND: "1360",
  CTELE: "1366",
  CTPRO: "1371",
  OVELE: "1376",
  OVMW: "1382",
  OVSPE: "1388",
  OVSTE: "1386",
  MW: "1404",
  MWBI: "1404",
  MWCON: "1404",
  MWDR: "1396",
  MWOTR: "1398",
  TRIMK: "1406",
  VHOOD: "1428",
  VHINS: "1450",
  VHISL: "1430",
  VHDD: "1434",
  WASHF: "2112",
  WASHT: "2110",
  DRELE: "2040",
  DRGAS: "2042",
  PED: "2214",
  WD: "1408",
  VACSE: "1440",
  GROUT: "8010",
  PIZZA: "8040",
  GRIND: "8019",
  CABSS: "8110",
  CAB: "1850"
};

// Subclass -> the ePASS product code whose install/connector set applies.
// This is how data/shop-addons.json (written per product code) is re-keyed
// by subclass without re-entering 62 installs by hand. A subclass with no
// entry here (trash compactors, disposals, steam closets, accessories...)
// has no installation on file and gets no add-on prompt.
export const ADDON_PRODUCT_BY_SUBCLASS = {
  "1022": "REFRE",
  "1024": "REFRE",
  "1026": "RESXS",
  "1028": "REFRE",
  "1030": "REFRE",
  "1032": "RETOP",
  "1036": "REFRE",
  "1038": "REFRE",
  "1104": "IMUC",
  "1110": "REALL",
  "1114": "REBIW",
  "1116": "REALL",
  "1118": "REBIF",
  "1119": "REBIF",
  "1120": "REBIF",
  "1122": "REBIW",
  "1124": "REBIF",
  "1126": "REBIB",
  "1128": "REBFD",
  "1312": "REUC",
  "1316": "REUC",
  "1318": "REDRA",
  "1320": "REDRA",
  "1322": "REDRA",
  "1324": "REUC",
  "1330": "DW",
  "1332": "DW",
  "1340": "RAPRO",
  "1342": "RAPRO",
  "1344": "RAPRO",
  "1346": "RAPRO",
  "1348": "RADF",
  "1350": "RAIND",
  "1352": "RAGAS",
  "1354": "RAELE",
  "1356": "CTGAS",
  "1358": "CTGAS",
  "1360": "CTIND",
  "1362": "CTIND",
  "1364": "CTELE",
  "1366": "CTELE",
  "1368": "CTELE",
  "1370": "CTIND",
  "1371": "CTPRO",
  "1372": "CTPRO",
  "1376": "OVELE",
  "1380": "OVELE",
  "1382": "OVMW",
  "1384": "OVSTE",
  "1386": "OVSTE",
  "1388": "OVSPE",
  "1394": "MWBI",
  "1396": "MWDR",
  "1398": "MWOTR",
  "1404": "MW",
  "1406": "TRIMK",
  "1408": "WD",
  "1412": "VACSE",
  "1440": "VACSE",
  "1426": "VHOOD",
  "1428": "VHOOD",
  "1430": "VHISL",
  "1432": "VHISL",
  "1434": "VHDD",
  "1436": "VHDD",
  "1450": "VHINS",
  "1510": "COFFE",
  "1512": "COFFE",
  "1600": "COFFE",
  "1850": "CAB",
  "2040": "DRELE",
  "2042": "DRGAS",
  "2044": "DRELE",
  "2046": "DRELE",
  "2110": "WASHT",
  "2112": "WASHF",
  "2114": "WASHT",
  "2116": "WASHF",
  "2140": "WASHF",
  "2142": "WASHF",
  "2214": "PED",
  "8010": "GROUT",
  "8011": "GROUT",
  "8013": "GROUT",
  "8014": "GROUT",
  "8019": "GRIND",
  "8040": "PIZZA",
  "8042": "GROUT",
  "8056": "GROUT",
  "8110": "CABSS",
  "8112": "CABSS",
  "8114": "CABSS",
  "8116": "CABSS",
  "8210": "REUC",
  "8214": "WD",
  "8218": "VHOOD",
  "8224": "DW"
};

// NetSuite Merch Category for each class (Items436.csv) — the top of the
// hierarchy, used as the filter on the Shop Orders services map.
export const MERCH_CATEGORIES = { "15": "Kitchen Appliances", "18": "Appliance Cabinetry", "25": "Laundry Appliances", "35": "Plumbing", "85": "Outdoor Living" };
export const MERCH_CATEGORY_BY_CLASS = {
  "102": "15", "104": "15", "107": "15", "108": "15", "114": "15", "120": "15", "130": "15", "132": "15", "134": "15", "136": "15", "138": "15", "140": "15",
  "142": "15", "144": "15", "149": "15", "152": "15", "154": "15", "160": "15", "182": "15", "185": "18",
  "204": "25", "206": "25", "208": "25", "210": "25", "220": "25", "222": "25", "310": "35",
  "806": "85", "808": "85", "810": "85", "812": "85", "814": "85", "816": "85", "820": "85"
};

const code = (v) => String(v || "").trim().split(/\s+/)[0];

// Subclass code for a model: NetSuite first, ePASS product code as fallback.
export function merchSubclassFor(ns, prod) {
  const sub = code(ns?.merchSubclass);
  if (sub && MERCH_SUBCLASSES[sub]) return sub;
  return SUBCLASS_BY_EPASS_PROD[String(prod || "").toUpperCase()] || "";
}
export function merchClassFor(ns, prod) {
  const cls = code(ns?.merchClass);
  if (cls && MERCH_CLASSES[cls]) return cls;
  const sub = merchSubclassFor(ns, prod);
  return sub ? MERCH_SUBCLASSES[sub].cls : "";
}
export const merchSubclassName = (sub) => MERCH_SUBCLASSES[code(sub)]?.name || "";
export const merchClassName = (cls) => MERCH_CLASSES[code(cls)] || "";
// "1352 All Gas Range" — the way NetSuite itself writes it.
export const merchSubclassLabel = (sub) => { const s = code(sub); return MERCH_SUBCLASSES[s] ? `${s} ${MERCH_SUBCLASSES[s].name}` : s; };

// The install/connector map keyed by subclass, built from the per-product map.
export function addonsBySubclass(byProduct) {
  const out = {};
  for (const [sub, prod] of Object.entries(ADDON_PRODUCT_BY_SUBCLASS)) {
    const entry = byProduct?.[prod];
    if (entry) out[sub] = { installs: [...(entry.installs || [])], connectors: [...(entry.connectors || [])], via: prod };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Services by subclass, refined (Andrew 11/10). Three layers, in order:
//   1. data/shop-addons.json `bySubclass` — the install/connector set for each
//      NetSuite subclass, written out so a single wall oven offers the single
//      install, a wine column skips the water line, a ventless dryer skips the
//      vent kit. (The per-product inheritance above is the fallback for a
//      subclass the file doesn't list.)
//   2. `variants` — brand/model rules inside a subclass that the taxonomy
//      can't see: Fisher & Paykel DishDrawers, the pro-dishwasher brands.
//   3. Panel-ready finish (NetSuite's Primary Finish) — a built-in that takes
//      a cabinet panel gets only the "with panel" install, a stainless one only
//      the "no panel" install; a model NetSuite hasn't given a finish keeps both.
// The result is one `servicesKey` per model ("1330", "1330-panel", "1330-std",
// "1330-pro", "1330-drawer") that indexes `byKey` — the shop and the website
// look the key up and never need to know the rules.
// ---------------------------------------------------------------------------
export const DEFAULT_PANEL_PAIRS = [
  ["dishwasher-standard-install", "dishwasher-with-panel-install"],
  ["refrigerator-built-in-no-panels-install", "refrigerator-built-in-with-panel-install"],
  ["refrigerator-built-in-column-stainless-install", "refrigerator-built-in-column-with-panel-install"],
  ["refrigerator-undercounter-built-in-no-panel-install", "refrigerator-undercounter-built-in-with-panel-install"],
  ["built-in-ice-machine-install", "built-in-ice-machine-install-with-panel"],
  ["warming-drawer-no-panel-install", "warming-drawer-with-panel-install"]
];
export const isPanelReadyFinish = (finish) => /panel\s*(ready|required)|^panel$|integrated/i.test(String(finish || "").trim());
// Finish values that say nothing (Bosch's whole import reads "Appl"): treated as no finish on file.
export const isUnknownFinish = (finish) => { const f = String(finish || "").trim(); return !f || /^(appl|n\/?a|tbd|unknown|none|-+|see description)$/i.test(f); };

const norm = (v) => String(v || "").trim().toLowerCase();
const setOf = (arr) => new Set((arr || []).map((x) => String(x)));

// byKey: every subclass, plus its -std / -panel variants where the install set
// has a panel pair, plus every rule variant from the file.
export function buildAddonIndex(addonsFile) {
  const file = addonsFile || {};
  const pairs = Array.isArray(file.panelPairs) && file.panelPairs.length ? file.panelPairs : DEFAULT_PANEL_PAIRS;
  const noPanel = new Set(pairs.map((p) => p[0]));
  const withPanel = new Set(pairs.map((p) => p[1]));
  const base = { ...addonsBySubclass(file.byProduct) };
  for (const [sub, entry] of Object.entries(file.bySubclass || {})) {
    if (!entry) continue;
    base[sub] = { installs: [...(entry.installs || [])], connectors: [...(entry.connectors || [])], via: "subclass" };
  }
  const out = {};
  for (const [sub, entry] of Object.entries(base)) {
    out[sub] = entry;
    const hasNo = entry.installs.some((id) => noPanel.has(id));
    const hasWith = entry.installs.some((id) => withPanel.has(id));
    if (hasNo && hasWith) {
      out[`${sub}-std`] = { ...entry, installs: entry.installs.filter((id) => !withPanel.has(id)), via: `${sub} std` };
      out[`${sub}-panel`] = { ...entry, installs: entry.installs.filter((id) => !noPanel.has(id)), via: `${sub} panel` };
    }
  }
  // Brand/model variants swap the subclass's main install for their own (pro,
  // DishDrawer). Once the map is managed on Shop Orders (file.serviceMap) they
  // also keep whatever was assigned to the subclass beyond the file's original
  // set — an added haul-away reaches a Miele too — and follow the subclass's
  // accessories. A variant that only routes to a generated key (Bosch SHV ->
  // 1330-panel) leaves that key as generated.
  for (const v of file.variants || []) {
    if (!v?.key) continue;
    if (out[v.key] && /-(std|panel)$/.test(v.key)) continue;
    const sub = String(v.subclass || "");
    const parent = base[sub] || { installs: [], connectors: [] };
    const own = [...(v.installs || [])];
    const baseline = new Set((file.baseBySubclass || file.bySubclass || {})[sub]?.installs || []);
    const extras = file.serviceMap ? parent.installs.filter((id) => !baseline.has(id) && !own.includes(id)) : [];
    out[v.key] = { installs: [...own, ...extras], connectors: file.serviceMap ? [...parent.connectors] : [...(v.connectors || parent.connectors || [])], via: `${sub} ${v.label || v.key}`.trim() };
  }
  return out;
}

// The services key for one unit. `index` is buildAddonIndex(addonsFile).
export function servicesKeyFor({ subclass, finish = "", brand = "", model = "", description = "" } = {}, addonsFile, index) {
  const sub = code(subclass);
  if (!sub) return "";
  const idx = index || buildAddonIndex(addonsFile);
  const b = norm(brand);
  for (const v of (addonsFile?.variants || [])) {
    if (String(v.subclass || "") !== sub || !idx[v.key]) continue;
    if (Array.isArray(v.brands) && v.brands.length && !v.brands.some((x) => norm(x) === b)) continue;
    if (v.modelPattern && !new RegExp(v.modelPattern, "i").test(String(model || "").trim())) continue;
    if (v.descriptionPattern && !new RegExp(v.descriptionPattern, "i").test(String(description || ""))) continue;
    return v.key;
  }
  if (!isUnknownFinish(finish) && idx[`${sub}-panel`]) return isPanelReadyFinish(finish) ? `${sub}-panel` : `${sub}-std`;
  return sub;
}
// Panel-ready as a fact for the UI / website: true, false, or null when NetSuite hasn't said.
export const panelReadyFor = (finish) => (isUnknownFinish(finish) ? null : isPanelReadyFinish(finish));
