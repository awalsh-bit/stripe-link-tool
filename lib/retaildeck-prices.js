// ---------------------------------------------------------------------------
// Streaming scanner for the RetailDeck pos-link workbook
// (whse_inventory_and_prices.xlsx, ~35MB, ~108k rows x ~40 columns).
//
// Parsing this file with the xlsx library peaks around 1.6GB of RSS — enough
// to OOM a small cloud instance and silently kill the MAP price refresh.
// This scanner inflates the sheet XML in CHUNKS and keeps only what the
// floor table needs: the pn / manufacturer_pn model keys and the first
// populated floor column (rws_minimum, then the UMRP/MAP cascade).
// Peak memory is tens of MB, not GB.
//
// Three streaming passes over the zip entries:
//   A. sharedStrings.xml — find the shared-string INDICES of the header
//      names we care about (tiny map).
//   B. worksheet XML     — locate the header row via those indices, then
//      collect, per data row, the model-cell string indices and the first
//      numeric floor value. (~8k tiny records for the real file.)
//   C. sharedStrings.xml — resolve just the model strings pass B needs.
//
// Throws { code: "NOT_RETAILDECK" } when the workbook doesn't carry the
// RetailDeck headers, so callers can fall back to a generic parser.
// ---------------------------------------------------------------------------

import zlib from "zlib";
import { StringDecoder } from "string_decoder";

const MODEL_HEADERS = ["pn", "manufacturer_pn"];
// Floor priority: rws_minimum is RetailDeck's resolved minimum advertised
// price across every supplier program (UMRP/MAP/LAP/PLAP/MAP-10/PMAP-10...).
const FLOOR_HEADERS = ["rws_minimum", "rws_umrp_promo", "rws_umrp", "rws_map", "rws_map_no_promos"];
const ALL_HEADERS = [...MODEL_HEADERS, ...FLOOR_HEADERS];

function notRetailDeck(message) {
  const err = new Error(message);
  err.code = "NOT_RETAILDECK";
  return err;
}

// ---- zip plumbing ---------------------------------------------------------

function findZipEntries(buffer) {
  let eocd = -1;
  const scanStart = Math.max(0, buffer.length - 22 - 65536);
  for (let i = buffer.length - 22; i >= scanStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw notRetailDeck("Not an xlsx (zip) file.");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries[name] = { method, compSize, localOffset };
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Stream an entry's inflated text through onText(chunk) without ever
// materializing the whole document.
function streamEntryText(buffer, entry, onText) {
  const nameLen = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLen = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const data = buffer.subarray(start, start + entry.compSize);
  if (entry.method === 0) {
    onText(data.toString("utf8"));
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const inflate = zlib.createInflateRaw();
    const decoder = new StringDecoder("utf8");
    inflate.on("data", (chunk) => onText(decoder.write(chunk)));
    inflate.on("end", () => {
      const tail = decoder.end();
      if (tail) onText(tail);
      resolve();
    });
    inflate.on("error", reject);
    inflate.end(data);
  });
}

// Feed streamed text into complete "...<closer>" segments. Text after the
// last closer is carried into the next chunk so tags never split.
function segmenter(closer, onSegment) {
  let carry = "";
  return {
    write(chunk) {
      carry += chunk;
      let at;
      let from = 0;
      while ((at = carry.indexOf(closer, from)) >= 0) {
        onSegment(carry.slice(from, at + closer.length));
        from = at + closer.length;
      }
      carry = carry.slice(from);
    },
    end() { if (carry.trim()) onSegment(carry); }
  };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

function siText(siXml) {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(siXml))) out += m[1];
  return decodeXml(out);
}

function refToColIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

// Iterate the cells of one <row> segment: yields { col, type, value } where
// value is the raw <v> text (or inline string text).
function eachCell(rowXml, fn) {
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cursor = -1;
  let m;
  while ((m = re.exec(rowXml))) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const ref = /r="([A-Z]+)\d*"/.exec(attrs);
    const col = ref ? refToColIndex(ref[1]) : cursor + 1;
    cursor = col;
    const typeMatch = /t="([^"]+)"/.exec(attrs);
    const type = typeMatch ? typeMatch[1] : "n";
    let value = null;
    if (type === "inlineStr") {
      value = siText(inner);
    } else {
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
      if (v) value = decodeXml(v[1]);
    }
    fn(col, type, value);
  }
}

const numOf = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const normModel = (v) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const normHeader = (v) => String(v ?? "").replace(/[\s ]+/g, " ").trim().toLowerCase();

// ---- the scan -------------------------------------------------------------

export async function extractRetailDeckFloors(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) throw notRetailDeck("Empty file.");
  const entries = findZipEntries(buffer);
  const sharedEntry = entries["xl/sharedStrings.xml"];
  const sheetNames = Object.keys(entries)
    .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number((a.match(/(\d+)\.xml$/i) || [])[1] || 0);
      const nb = Number((b.match(/(\d+)\.xml$/i) || [])[1] || 0);
      return na - nb || a.localeCompare(b);
    });
  if (!sheetNames.length) throw notRetailDeck("No worksheet found.");

  // -- Pass A: which shared-string indices are our header names? Also map
  // every numeric-looking shared string to its value — RetailDeck stores
  // EVERY cell as a shared string, prices included, so pass B needs this
  // to resolve floors without keeping the whole string table.
  const headerIdxToName = new Map();
  const seenNames = new Set();
  const numericSs = new Map();
  if (sharedEntry) {
    let siIndex = 0;
    const seg = segmenter("</si>", (xml) => {
      const text = siText(xml);
      const name = normHeader(text);
      if (ALL_HEADERS.includes(name) && !seenNames.has(name)) {
        headerIdxToName.set(String(siIndex), name);
        seenNames.add(name);
      }
      if (text.length <= 16) {
        const n = numOf(text);
        if (n != null) numericSs.set(String(siIndex), n);
      }
      siIndex++;
    });
    await streamEntryText(buffer, sharedEntry, seg.write);
    seg.end();
  }

  // -- Pass B: find the header row, then collect model refs + floors.
  let headerCols = null;    // colIndex -> header name
  let modelCols = [];       // column indexes of pn / manufacturer_pn
  let floorCols = [];       // column indexes in FLOOR_HEADERS priority order
  let rowsSeen = 0;
  let priced = 0;
  const kept = [];          // { models: [text|{s:idx}], floor: number }
  const neededSs = new Set();

  const headerNameOfCell = (type, value) => {
    if (type === "s") return headerIdxToName.get(String(value)) || null;
    if (type === "str" || type === "inlineStr") return ALL_HEADERS.includes(normHeader(value)) ? normHeader(value) : null;
    return null;
  };

  for (const sheetName of sheetNames) {
    if (headerCols) break;
    rowsSeen = 0;
    const seg = segmenter("</row>", (rowXml) => {
      rowsSeen++;
      if (!headerCols) {
        if (rowsSeen > 30) return; // header hunt window
        const found = new Map();
        eachCell(rowXml, (col, type, value) => {
          const name = headerNameOfCell(type, value);
          if (name) found.set(col, name);
        });
        const names = [...found.values()];
        if (MODEL_HEADERS.some((h) => names.includes(h)) && FLOOR_HEADERS.some((h) => names.includes(h))) {
          headerCols = found;
          modelCols = [...found.entries()].filter(([, n]) => MODEL_HEADERS.includes(n)).map(([c]) => c);
          floorCols = FLOOR_HEADERS
            .map((h) => [...found.entries()].find(([, n]) => n === h)?.[0])
            .filter((c) => c != null);
        }
        return;
      }
      // data row
      const cells = new Map();
      eachCell(rowXml, (col, type, value) => {
        if (modelCols.includes(col) || floorCols.includes(col)) cells.set(col, { type, value });
      });
      let floor = null;
      for (const c of floorCols) {
        const cell = cells.get(c);
        if (!cell || cell.value == null) continue;
        // s-type cells resolve through the numeric shared-string map —
        // non-numeric shared strings ("NaN", " ") simply miss it.
        const n = cell.type === "s" ? (numericSs.get(String(cell.value)) ?? null) : numOf(cell.value);
        if (n != null) { floor = n; break; }
      }
      if (floor == null) return;
      priced++;
      const models = [];
      for (const c of modelCols) {
        const cell = cells.get(c);
        if (!cell || cell.value == null) continue;
        if (cell.type === "s") { models.push({ s: cell.value }); neededSs.add(String(cell.value)); }
        else models.push(String(cell.value));
      }
      if (models.length) kept.push({ models, floor });
    });
    await streamEntryText(buffer, entries[sheetName], seg.write);
    seg.end();
  }
  if (!headerCols) throw notRetailDeck("RetailDeck headers not found.");

  // -- Pass C: resolve just the model strings the kept rows reference.
  const ssText = new Map();
  if (sharedEntry && neededSs.size) {
    let siIndex = 0;
    const seg = segmenter("</si>", (xml) => {
      const key = String(siIndex);
      if (neededSs.has(key)) ssText.set(key, siText(xml));
      siIndex++;
    });
    await streamEntryText(buffer, sharedEntry, seg.write);
    seg.end();
  }

  // -- Assemble. On duplicate keys the HIGHER floor wins (stricter — never
  // lets a below-floor price go public).
  const prices = {};
  for (const { models, floor } of kept) {
    for (const model of models) {
      const text = typeof model === "string" ? model : ssText.get(String(model.s));
      const key = normModel(text);
      if (!key || key.length > 60) continue;
      if (!(key in prices) || floor > prices[key]) prices[key] = Math.round(floor * 100) / 100;
    }
  }
  if (!Object.keys(prices).length) throw notRetailDeck("No priced rows found.");

  return {
    prices,
    count: Object.keys(prices).length,
    note: `RetailDeck layout (streamed) · ${priced.toLocaleString()} priced rows · floor = rws_minimum (umrp/map fallback)`
  };
}
