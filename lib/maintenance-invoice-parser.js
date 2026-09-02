// ---------------------------------------------------------------------------
// Wilson sales-invoice parser for the Maintenance module (pilot).
//
// JS port of the maintenance portal prototype's invoice_parser.py (Cayden's
// project, v0.9.3). The Python original relied on pypdf's layout-mode text
// extraction; here we rebuild equivalent column-aligned layout text from
// pdfjs positioned text runs, then apply the same line grammar:
//
//   QTY | MODEL # | DESCRIPTION | PRICE | EXT PRICE   line-item rows,
//   ***AREA NAME***                                   area headings,
//   Serial # : XXXX                                   serial continuation,
//   BRAND, CLASSIFICATION[, ...]                      manufacturer lines,
//   Ship To: header block                             household contact.
//
// Output shape matches the prototype's /api/invoice/import contract exactly
// (invoice-import.js consumes it unchanged). Validated for parity against the
// Python parser's output on the two real Wilson invoice samples in the repo.
//
// WILSON DECISION 2026-09-02 (Andrew Walsh, superseding the 2026-08-24 note):
// a combined WashTower / laundry center is TWO maintained appliances — the
// washer and the dryer are serviced more or less separately, each on its own
// protocol and priced as its own asset. Matches prototype v0.9.5+ and the
// customer enrollment tile ("Counts as 2 appliances").
//
// Brought to parity with invoice_parser.py v0.9.50: footer/terms detection
// (a real dryer was being dropped because "installation guides" in the terms
// block matched "install"), invoice date anchored to the invoice number with a
// confidence label + installYear, word-boundary exclusion matching, outdoor
// grill classification, and unreadable-file handling.
// ---------------------------------------------------------------------------

let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

const INVOICE_RE = /\bS\d{8}(?:-\d+)?\b/gi;
const AREA_RE = /\*{3,}\s*([^*]+?)\s*\*{3,}/;
const SERIAL_RE = /Serial\s*#\s*:\s*([A-Za-z0-9-]+)/i;
const MONEY = "-?(?:\\d{1,3}(?:,\\d{3})*|\\d+)\\.\\d{2}|-";
const ROW_RE = new RegExp(
  `^\\s*(-?\\d+|Payment)\\s+(.*?)\\s{2,}(${MONEY})\\s{2,}(${MONEY})\\s*$`,
  "i"
);
const CITY_STATE_ZIP_RE = /^(.*?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;

const BRAND_MAP = {
  "SUBZERO": "Sub-Zero",
  "SUB-ZERO": "Sub-Zero",
  "WOLF": "Wolf",
  "COVE": "Cove",
  "LG HOME APPLIANCES": "LG",
  "TRUE MANUFACTURING": "True",
  "TRUE COMMERCIAL": "True Commercial",
  "KITCHENAID": "KitchenAid",
  "JENNAIR": "JennAir",
  "THERMADOR": "Thermador",
  "BOSCH": "Bosch",
  "MIELE": "Miele",
  "MONOGRAM": "Monogram",
  "GE PROFILE": "GE Profile",
  "GE APPLIANCES": "GE",
  "FISHER & PAYKEL": "Fisher & Paykel",
  "SCOTSMAN": "Scotsman"
};

const EXCLUDE_PHRASES = [
  "south central remodel program",
  "payment transfer",
  "payment check",
  "dishwasher h2o connect kit",
  "washer hoses",
  "dryer cord",
  "dryer - ss steam kit",
  "dryer vent kit",
  "gas flex line",
  "stainless steel gas flex line",
  "install",
  "installation",
  "in-home delivery",
  "in home delivery",
  "anti-condensation pad",
  "anti condensation pad",
  "mounting kit",
  "door panel",
  "knob kit",
  "bezel kit",
  "bezel",
  "accessories",
  "ventilator blower",
  "blower assembly",
  "toe kick",
  // Seen on real Wilson invoices (S00063887 / S00064425). Both reached the
  // review queue with no valid customer category to assign them to.
  "gas conversion kit",
  "conversion kit",
  "cabinetry"
];

// Once a line belongs to the invoice's terms/totals block the product table
// is over. Layout extraction pads these lines with alignment spaces, so the
// check collapses whitespace first — matching the raw string is how the old
// `startsWith("*Above order")` guard came to never fire.
const FOOTER_MARKERS = [
  "above order confirmed",
  "all products remain the property",
  "please refer to owners manual",
  "authorized returned products",
  "special/custom orders",
  "finance charges of",
  "extended warranty",
  "removal of old units",
  "customer signature",
  "has acknowledged above information",
  "sub total",
  "invoice total",
  "deposits",
  "balance",
  "taclb"
];

function isFooterLine(line) {
  const blob = cleanSpace(line).toLowerCase().replace(/^[* ]+/, "").trim();
  return FOOTER_MARKERS.some((marker) => blob.includes(marker));
}

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

// The invoice date is the only documented evidence of how old an appliance is,
// and age carries a quarter of every health score. On a Wilson invoice it is
// printed directly beneath the invoice number in the top-right header block,
// so anchoring to the invoice number is a far stronger read than "the first
// d/d/yyyy on the page". The loose scan stays as a fallback, labelled low.
function findInvoiceDate(lines, invoiceNumber, joined) {
  if (invoiceNumber) {
    const needle = invoiceNumber.toUpperCase();
    for (let index = 0; index < lines.length; index += 1) {
      if (!String(lines[index]).toUpperCase().includes(needle)) continue;
      for (const candidate of lines.slice(index, index + 3)) {
        const match = DATE_RE.exec(String(candidate));
        if (match) return { date: match[0], confidence: "high" };
      }
    }
  }
  const match = DATE_RE.exec(joined.slice(0, 1200));
  if (match) return { date: match[0], confidence: "low" };
  return { date: "", confidence: "none" };
}

// The sale year — for an appliance Wilson sold and installed, the install
// year within a few weeks. Labelled as the invoice rather than as an
// installation record, because that is the claim the evidence supports.
function installYearFrom(invoiceDate) {
  const match = DATE_RE.exec(String(invoiceDate || "").trim());
  if (!match || match[0] !== String(invoiceDate || "").trim()) return null;
  const year = Number(match[3]);
  return year >= 1950 && year <= 2100 ? year : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const UNASSIGNED = "Unassigned — Review";

// ---------------------------------------------------------------------------
// Layout text reconstruction (pypdf layout-mode equivalent)
// ---------------------------------------------------------------------------

function buildLayoutLines(textItems) {
  const cells = [];
  const widths = [];
  for (const item of textItems) {
    const str = String(item.str || "");
    if (!str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const width = Number(item.width) || 0;
    cells.push({ x, y, width, str });
    if (width > 0 && str.trim().length > 0) {
      widths.push(width / str.length);
    }
  }
  if (!cells.length) return [];

  widths.sort((a, b) => a - b);
  const unit = widths.length ? widths[Math.floor(widths.length / 2)] : 5;

  // Group into visual rows by y (PDF y grows upward — sort rows descending).
  const rows = [];
  for (const cell of cells) {
    let row = rows.find((r) => Math.abs(r.y - cell.y) <= 2.5);
    if (!row) {
      row = { y: cell.y, cells: [] };
      rows.push(row);
    }
    row.cells.push(cell);
  }
  rows.sort((a, b) => b.y - a.y);

  const lines = [];
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEndX = null;
    for (const cell of row.cells) {
      const targetCol = Math.max(0, Math.round(cell.x / unit));
      const gapPx = prevEndX === null ? cell.x : cell.x - prevEndX;
      if (prevEndX === null) {
        line += " ".repeat(targetCol);
      } else if (gapPx < unit * 0.35) {
        // Sub-runs of the same word: butt them together.
      } else if (gapPx < unit * 2.2) {
        line += " ";
      } else {
        // A real column gap: pad to the computed character column so
        // downstream \s{2,} splits and Ship To column slicing line up.
        const pad = Math.max(2, targetCol - line.length);
        line += " ".repeat(pad);
      }
      line += cell.str;
      prevEndX = cell.x + cell.width;
    }
    lines.push(line);
  }
  return lines;
}

async function extractLayoutPages(buffer) {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false
  });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(buildLayoutLines(content.items));
    }
  } finally {
    try { await doc.cleanup(); } catch { /* best effort */ }
    try { await task.destroy(); } catch { /* best effort */ }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Grammar helpers (straight ports of the Python originals)
// ---------------------------------------------------------------------------

function cleanSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Python str.title(): first letter after any non-letter is uppercased.
function pyTitle(value) {
  return String(value || "").replace(/[A-Za-z]+/g, (word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  );
}

function friendlyArea(value) {
  const cleaned = cleanSpace(value).replace(/^[* ]+|[* ]+$/g, "");
  if (!cleaned) return UNASSIGNED;
  return pyTitle(cleaned);
}

function friendlyBrand(value) {
  const cleaned = cleanSpace(value).replace(/^[ ,]+|[ ,]+$/g, "");
  if (!cleaned) return "";
  return BRAND_MAP[cleaned.toUpperCase()] || pyTitle(cleaned);
}

function parseShipTo(layoutLines) {
  const contact = {};
  for (let index = 0; index < layoutLines.length; index += 1) {
    const line = layoutLines[index];
    if (!line.includes("Ship To:")) continue;
    const shipCol = line.indexOf("Ship To:");
    // The block reads: phone (printed right after the label, though text
    // positioning can push it to its own visual line), household label,
    // address line, then city/state/zip. Collect the next four values in
    // order, tolerating either same-line or next-line phone placement.
    const seq = [];
    const after = line.slice(shipCol + "Ship To:".length).trim();
    if (after) seq.push(after);
    for (let k = index + 1; k < layoutLines.length && seq.length < 4; k += 1) {
      seq.push(layoutLines[k].slice(shipCol).trim());
    }
    if (seq[0] !== undefined) contact.phone = seq[0].replace(/\D/g, "");
    if (seq[1] !== undefined) contact.householdLabel = seq[1];
    if (seq[2] !== undefined) contact.address1 = seq[2];
    if (seq[3] !== undefined) {
      const cityLine = cleanSpace(seq[3]);
      const match = CITY_STATE_ZIP_RE.exec(cityLine);
      if (match) {
        contact.city = match[1];
        contact.state = match[2];
        contact.zip = match[3];
      } else {
        contact.cityLine = cityLine;
      }
    }
    break;
  }
  return contact;
}

function findInvoiceNumber(text, fallback) {
  const matches = text.match(INVOICE_RE) || [];
  if (!matches.length) return fallback || "";
  // Wilson exports are named by invoice number (S00063887.pdf, S00063887-1.pdf).
  // When the file name is itself an invoice number that the page mentions, it
  // is the strongest read there is — a split invoice names its sibling in the
  // header, and text-order heuristics can pick the sibling.
  const named = String(fallback || "").toUpperCase();
  if (named && /^S\d{8}(?:-\d+)?$/i.test(named) && matches.some((m) => m.toUpperCase() === named)) return named;
  // The invoice number is normally printed in the top-right header; a page can
  // mention the related split invoice too. Prefer the last match within the
  // first 1,200 characters of layout text (mirrors the Python parser).
  const headerMatches = text.slice(0, 1200).match(INVOICE_RE) || [];
  return (headerMatches.length ? headerMatches[headerMatches.length - 1] : matches[0]).toUpperCase();
}

function parseRow(line) {
  const match = ROW_RE.exec(line);
  if (!match) return null;
  const rawBody = match[2];
  let model = "";
  let description = cleanSpace(rawBody);
  // Model and description are separated by a wide blank column.
  const trimmedBody = rawBody.trim();
  const splitMatch = /\s{2,}/.exec(trimmedBody);
  if (splitMatch) {
    const first = trimmedBody.slice(0, splitMatch.index).trim();
    const rest = trimmedBody.slice(splitMatch.index + splitMatch[0].length);
    if (/\d/.test(first)) {
      model = first;
      description = cleanSpace(rest);
    }
  }
  return {
    qty: match[1],
    model,
    description,
    price: match[3],
    ext: match[4]
  };
}

function extractRawItems(pageLayouts, sourceFile) {
  const allLayout = pageLayouts.flat();
  const joined = allLayout.join("\n");
  const stem = String(sourceFile || "").replace(/\.[^./\\]+$/, "");
  const invoiceNumber = findInvoiceNumber(joined, stem.toUpperCase());
  const contact = parseShipTo(pageLayouts[0] || []);
  const { date: invoiceDate, confidence: invoiceDateConfidence } = findInvoiceDate(allLayout, invoiceNumber, joined);
  const splitReferences = Array.from(new Set(
    (joined.match(INVOICE_RE) || []).map((m) => m.toUpperCase()).filter((m) => m !== invoiceNumber)
  )).sort();

  const metadata = {
    invoiceNumber,
    invoiceDate,
    invoiceDateConfidence,
    installYear: installYearFrom(invoiceDate),
    contact,
    sourceFile,
    splitReferences
  };

  const items = [];
  let currentArea = UNASSIGNED;
  let current = null;

  const finalize = () => {
    if (!current) return;
    const qty = Number.isFinite(Number(current.quantity)) ? Math.trunc(Number(current.quantity)) : 0;
    items.push({
      quantity: qty,
      model: cleanSpace(current.model),
      description: cleanSpace(current.description),
      classification: cleanSpace(current.classification),
      brandRaw: cleanSpace(current.brandRaw),
      serial: cleanSpace(current.serial),
      area: current.area || UNASSIGNED,
      invoiceNumber,
      sourceFile,
      price: current.price || "",
      extendedPrice: current.extendedPrice || ""
    });
    current = null;
  };

  for (const lines of pageLayouts) {
    let inLines = false;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (line.includes("QTY") && line.includes("MODEL #") && line.includes("DESCRIPTION")) {
        inLines = true;
        continue;
      }
      if (!inLines) continue;
      const stripped = line.trim();
      if (!stripped) continue;
      if (isFooterLine(stripped)) {
        finalize();
        inLines = false;
        continue;
      }

      const areaMatch = AREA_RE.exec(stripped);
      if (areaMatch) {
        finalize();
        currentArea = friendlyArea(areaMatch[1]);
        continue;
      }

      if (stripped.toLowerCase().startsWith("this invoice has been split")) continue;

      const serialMatch = SERIAL_RE.exec(stripped);
      if (serialMatch && current) {
        current.serial = serialMatch[1];
        continue;
      }

      const row = parseRow(line);
      if (row) {
        finalize();
        let qty;
        let description;
        if (row.qty.toLowerCase() === "payment") {
          qty = 0;
          description = "Payment " + row.description;
        } else {
          qty = Math.trunc(Number(row.qty));
          description = row.description;
        }
        current = {
          quantity: qty,
          model: row.model,
          description,
          classification: "",
          brandRaw: "",
          serial: "",
          area: currentArea,
          price: row.price,
          extendedPrice: row.ext
        };
        continue;
      }

      if (!current) continue;

      // Manufacturer/category lines are uppercase and comma-delimited.
      if (stripped.includes(",") && /^[A-Z0-9 &./'~-]+,/.test(stripped)) {
        const parts = stripped.split(",").map((part) => part.trim());
        current.brandRaw = parts[0];
        current.classification = parts.slice(1).join(", ");
        continue;
      }

      if (["EXT PRICE", "INVOICE TOTAL", "CUSTOMER SIGNATURE", "TACLB"].some((token) => stripped.includes(token))) {
        continue;
      }
      current.description = cleanSpace((current.description || "") + " " + stripped);
    }
  }

  finalize();
  return { items, metadata };
}

// ---------------------------------------------------------------------------
// Classification (port of _classify, with the WashTower one-asset decision)
// ---------------------------------------------------------------------------

function classificationBlob(item) {
  return cleanSpace([item.description, item.classification, item.model].join(" ")).toLowerCase();
}

function isExcluded(item) {
  const blob = classificationBlob(item);
  if (item.quantity <= 0) return [true, "Non-product, payment, or credit line"];
  if (item.area.toLowerCase().startsWith("installation")) return [true, "Installation section"];
  if (!item.model && !item.classification) return [true, "No product model or product classification"];
  for (const phrase of EXCLUDE_PHRASES) {
    // Word boundaries, not a bare substring: "install" must not match a
    // product described as "pre-installed" or "installation-ready".
    if (new RegExp("\\b" + escapeRegExp(phrase) + "\\b").test(blob)) return [true, `Excluded support line: ${phrase}`];
  }
  const classificationLower = item.classification.toLowerCase();
  if (classificationLower.includes("accessor")) return [true, "Accessory line"];
  if (classificationLower.startsWith("panel") || classificationLower === "panel") return [true, "Decorative panel"];
  return [false, ""];
}

function friendlyExactLabel(value) {
  const cleaned = cleanSpace(value);
  if (!cleaned) return "Appliance";
  return pyTitle(cleaned)
    .replace(/U\/C/g, "Undercounter")
    .replace(/B\/I/g, "Built-In")
    .replace(/X Side/g, "x Side");
}

function hasAny(blob, terms) {
  return terms.some((term) => blob.includes(term));
}

function classify(item) {
  const [excluded, reason] = isExcluded(item);
  if (excluded) return { ignored: true, reason };

  const blob = classificationBlob(item);
  const classification = item.classification.toUpperCase();
  let exactType = "other";
  let exactLabel = friendlyExactLabel(item.classification || item.description.slice(0, 70));
  let category = "";
  let confidence = "medium";
  let needsReview = false;
  let expandTo = [];
  const notes = [];

  if (hasAny(blob, ["washtower", "washer/dryer combo", "washer dryer combo", "laundry center"])) {
    // Two maintained appliances (Wilson decision 2026-09-02): the pair is
    // expanded downstream into a washer record and a dryer record, each on
    // its own protocol, exactly as the enrollment tile does.
    exactType = "laundry_center";
    exactLabel = "Laundry Center / WashTower";
    category = "washer_dryer";
    expandTo = ["washer", "dryer"];
    confidence = "high";
    needsReview = true;
    notes.push("Split into one washer and one dryer maintenance record, each inspected on its own protocol.");
  } else if (hasAny(blob, ["outdoor grill", "bbq grill", "barbecue grill", "kamado", "built-in grill", "gas grill", "charcoal grill"])) {
    // Outdoor grills are maintained on function only — Wilson never cleans a
    // grill. Classifying them here keeps invoice import and customer
    // enrollment on the same category and protocol.
    exactType = "outdoor_grill";
    exactLabel = "Outdoor Grill";
    category = "outdoor_grill";
    confidence = "high";
    notes.push("Outdoor grills are inspected for function and safety only; cleaning is never included on any visit.");
  } else if (blob.includes("dishwasher")) {
    exactType = "dishwasher";
    exactLabel = "Dishwasher";
    category = "dishwasher";
    confidence = "high";
  } else if (hasAny(blob, ["hood insert", "hood liner", "vent hood", "range hood", "downdraft"])) {
    exactType = hasAny(blob, ["insert", "liner"]) ? "hood_insert" : "hood";
    exactLabel = exactType === "hood_insert" ? "Hood Insert / Liner" : "Vent Hood";
    category = "ventilation";
    confidence = "high";
  } else if (hasAny(blob, ["warming drawer", "warming oven", "proofing drawer"])) {
    exactType = "warming_drawer";
    exactLabel = "Warming Drawer";
    category = "warming_drawer";
    confidence = "high";
  } else if (hasAny(blob, ["coffee maker", "coffee system", "coffee machine"])) {
    exactType = "coffee_maker";
    exactLabel = "Built-In Coffee Maker";
    category = "coffee";
    confidence = "high";
  } else if (hasAny(blob, ["rangetop", "range top", "cooktop"])) {
    exactType = "cooktop";
    exactLabel = "Cooktop / Rangetop";
    category = "cooktop";
    confidence = "high";
  } else if (blob.includes("range") && !hasAny(blob, ["range hood", "range install"])) {
    exactType = "range";
    exactLabel = (blob.includes("pro") || blob.includes("dual fuel")) ? "Professional Range" : "Range";
    category = "range";
    confidence = "high";
  } else if (hasAny(blob, ["speedcook", "speed oven", "microwave oven", "microwave drawer", "microwave"])) {
    exactType = hasAny(blob, ["speedcook", "speed oven"]) ? "speed_oven" : "microwave";
    exactLabel = exactType === "speed_oven" ? "Speed Oven" : "Microwave";
    category = "microwave";
    confidence = "high";
  } else if (hasAny(blob, ["wall oven", "steam oven", "convection oven", "double oven", "single oven"])) {
    exactType = "wall_oven";
    exactLabel = "Wall Oven";
    category = "ovens";
    confidence = "high";
  } else if (blob.includes("front-load washer") || blob.includes("top load washer") || /\bwasher\b/.test(blob)) {
    exactType = "washer";
    exactLabel = "Washer";
    category = "washer";
    confidence = "high";
  } else if (/\bdryer\b/.test(blob)) {
    exactType = "dryer";
    exactLabel = "Dryer";
    category = "dryer";
    confidence = "high";
  } else if (
    hasAny(blob, ["ice maker", "icemaker", "clear ice", "nugget ice"]) &&
    !hasAny(blob, ["refrigerator", "freezer"])
  ) {
    exactType = "ice_maker";
    exactLabel = "Icemaker (IMUC)";
    category = "ice_maker";
    confidence = "high";
  } else if (hasAny(blob, ["refrigerator", "freezer", "refrigeration", "wine cabinet", "wine storage", "beverage center", "floral merchandiser"])) {
    category = "refrigeration";
    confidence = "high";
    if (blob.includes("commercial") || blob.includes("floral merchandiser")) {
      exactType = "commercial_refrigeration";
      exactLabel = "Commercial / Specialty Refrigeration";
    } else if (blob.includes("freezer") && !blob.includes("refrigerator/freezer")) {
      exactType = "freezer";
      exactLabel = "Freezer";
    } else if (hasAny(blob, ["wine", "beverage"]) && !classification.toLowerCase().includes("refrigerator")) {
      exactType = "wine_beverage";
      exactLabel = "Wine / Beverage Center";
    } else {
      exactType = "refrigerator";
      exactLabel = "Refrigeration";
    }
  } else {
    category = "review";
    exactType = "other";
    exactLabel = friendlyExactLabel(item.classification || "Unclassified Appliance");
    confidence = "low";
    needsReview = true;
    notes.push("No confident customer-facing category was found. Select a category before creating the draft.");
  }

  return {
    ignored: false,
    quantity: item.quantity,
    model: item.model,
    description: item.description,
    classification: item.classification,
    brandRaw: item.brandRaw,
    brand: friendlyBrand(item.brandRaw),
    serial: item.serial,
    area: item.area,
    invoiceNumber: item.invoiceNumber,
    sourceFile: item.sourceFile,
    // The documented age input. installYear is null when the invoice gave
    // up no readable date; the importer reports that as unknown rather than
    // substituting something plausible.
    invoiceDate: item.invoiceDate || "",
    invoiceDateConfidence: item.invoiceDateConfidence || "none",
    installYear: installYearFrom(item.invoiceDate),
    price: item.price,
    extendedPrice: item.extendedPrice,
    exactType,
    exactTypeLabel: exactLabel,
    customerCategory: category,
    expandTo,
    confidence,
    needsReview,
    notes
  };
}

// ---------------------------------------------------------------------------
// Entry point — same result contract as the Python parse_invoice_files()
// ---------------------------------------------------------------------------

export async function parseMaintenanceInvoices(files) {
  const included = [];
  const ignored = [];
  const metadataRecords = [];
  const warnings = [];
  const unreadable = [];

  for (const { filename, buffer } of files) {
    let rawItems;
    let metadata;
    try {
      const pageLayouts = await extractLayoutPages(buffer);
      ({ items: rawItems, metadata } = extractRawItems(pageLayouts, filename));
    } catch (err) {
      // Any PDF failure is "unreadable" — say which file and move on.
      unreadable.push(filename);
      warnings.push(`${filename} could not be read as a PDF invoice and was skipped (${err?.name || "Error"}). Re-download or re-export it and try again.`);
      continue;
    }
    metadataRecords.push(metadata);
    for (const rawItem of rawItems) {
      rawItem.invoiceDate = metadata.invoiceDate;
      rawItem.invoiceDateConfidence = metadata.invoiceDateConfidence;
      const result = classify(rawItem);
      if (!result) continue;
      if (result.ignored) {
        ignored.push({
          quantity: rawItem.quantity,
          model: rawItem.model,
          description: rawItem.description,
          classification: rawItem.classification,
          area: rawItem.area,
          invoiceNumber: rawItem.invoiceNumber,
          reason: result.reason || "Excluded"
        });
      } else {
        result.id = `line_${included.length + 1}`;
        included.push(result);
        warnings.push(...(result.notes || []));
      }
    }
  }

  const invoiceNumbers = [];
  const splitReferences = [];
  let contact = {};
  for (const metadata of metadataRecords) {
    const number = metadata.invoiceNumber;
    if (number && !invoiceNumbers.includes(number)) invoiceNumbers.push(number);
    for (const reference of metadata.splitReferences || []) {
      if (!splitReferences.includes(reference)) splitReferences.push(reference);
    }
    if (!Object.keys(contact).length && metadata.contact && Object.keys(metadata.contact).length) {
      contact = metadata.contact;
    }
  }

  if (invoiceNumbers.length > 1) {
    warnings.push("Multiple invoice files were combined into one maintenance inventory.");
  }
  if (included.some((item) => String(item.area || "").toLowerCase().startsWith("unassigned"))) {
    warnings.push("Some split-invoice products do not have a printed area heading and are placed in Unassigned — Review.");
  }
  const unresolved = included.filter((item) => item.customerCategory === "review").length;
  if (unresolved) {
    warnings.push(`${unresolved} item(s) require a customer-facing category before creating the enrollment draft.`);
  }

  const areas = [];
  for (const item of included) {
    const area = item.area || UNASSIGNED;
    if (!areas.includes(area)) areas.push(area);
  }

  const uniqueWarnings = Array.from(new Set(warnings));
  // A WashTower line counts twice: one washer record and one dryer record.
  const totalExpanded = included.reduce((sum, item) => sum + (Number(item.quantity) || 0) * ((item.expandTo || []).length || 1), 0);

  // Every file unreadable is a failed import, not an empty one.
  if (unreadable.length && !metadataRecords.length) {
    return {
      ok: false,
      error: "None of the uploaded files could be read as PDF invoices: " + unreadable.join(", "),
      invoiceNumbers: [], splitReferences: [], contact: {},
      items: [], ignored: [], areas: [],
      warnings: uniqueWarnings,
      sourceFiles: files.map(({ filename }) => filename),
      unreadableFiles: unreadable,
      lineItemCount: 0, expandedAssetCount: 0
    };
  }

  return {
    ok: true,
    unreadableFiles: unreadable,
    invoiceNumbers,
    splitReferences,
    contact,
    items: included,
    ignored,
    areas,
    warnings: uniqueWarnings,
    sourceFiles: files.map(({ filename }) => filename),
    lineItemCount: included.length,
    expandedAssetCount: totalExpanded
  };
}
