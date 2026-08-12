import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ---------------------------------------------------------------------------
// Field Sales commission statement PDF (commissions.html → Download / Email).
// Same recipe as the payment receipt: pdf-lib, US Letter, logo header —
// but multi-page, with the statement's sections laid out as compact tables.
// The statement object comes straight from lib/field-sales-commissions.js.
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const INNER_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.12, 0.14, 0.2);
const MUTED = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.9, 0.91, 0.94);
const GREEN = rgb(0.13, 0.41, 0.17);
const RED = rgb(0.6, 0.11, 0.11);

const money = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pct = (n, d = 0) => `${((Number(n) || 0) * 100).toFixed(d)}%`;

export async function buildCommissionStatementPdf({ statement, monthLabel, logoBytes = null, generatedAt = new Date() }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = null;
  let y = 0;
  let pageNum = 0;

  const footer = () => {
    page.drawText(
      `Wilson AC & Appliance — Field Sales commission statement · ${statement.name} · ${monthLabel} · page ${pageNum}`,
      { x: MARGIN, y: 30, size: 8, font, color: MUTED }
    );
  };

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNum += 1;
    y = PAGE_H - 60;
    footer();
  };

  const need = (space) => {
    if (y - space < 60) newPage();
  };

  const text = (str, x, opts = {}) => {
    page.drawText(String(str), {
      x, y,
      size: opts.size || 9.5,
      font: opts.bold ? bold : font,
      color: opts.color || INK
    });
  };
  const rightText = (str, rightEdge, opts = {}) => {
    const f = opts.bold ? bold : font;
    const size = opts.size || 9.5;
    const w = f.widthOfTextAtSize(String(str), size);
    page.drawText(String(str), { x: rightEdge - w, y, size, font: f, color: opts.color || INK });
  };
  const rule = () => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: LINE });
  };
  const clip = (str, max) => {
    const s = String(str || "");
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };

  // ---------------- header ----------------
  newPage();
  let logoDrawn = false;
  if (logoBytes) {
    try {
      const logo = await doc.embedPng(logoBytes);
      const logoWidth = 140;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      page.drawImage(logo, { x: MARGIN, y: y - logoHeight + 14, width: logoWidth, height: logoHeight });
      logoDrawn = true;
    } catch { /* text header below */ }
  }
  if (!logoDrawn) {
    text("Wilson AC & Appliance", MARGIN, { bold: true, size: 15 });
  }
  rightText("COMMISSION STATEMENT", PAGE_W - MARGIN, { bold: true, size: 14 });
  y -= 17;
  rightText(monthLabel, PAGE_W - MARGIN, { size: 10, color: MUTED });
  y -= 30;

  text(statement.name, MARGIN, { bold: true, size: 13 });
  rightText(statement.planLabel || statement.commissionPlan || "No plan assigned", PAGE_W - MARGIN, { size: 10, color: MUTED });
  y -= 15;
  text(`Salesperson code ${statement.code}`, MARGIN, { size: 9.5, color: MUTED });
  y -= 12;
  const e = statement.eligibility;
  if (e.required != null) {
    text(
      `Eligibility: ${money(e.trailingSerialRevenue)} delivered serial revenue over the trailing ${e.months} uploaded months (requires ${money(e.required)}) — ${e.eligible ? "ELIGIBLE" : "BELOW REQUIREMENT"}`,
      MARGIN, { size: 8.5, color: e.eligible ? GREEN : RED }
    );
  } else {
    text(
      `Trailing delivered serial revenue: ${money(e.trailingSerialRevenue)} (no eligibility requirement on this plan)`,
      MARGIN, { size: 8.5, color: MUTED }
    );
  }
  y -= 16;
  rule();
  y -= 24;

  // ---------------- summary ----------------
  const t = statement.totals;
  text("Total commission", MARGIN, { size: 10, color: MUTED });
  y -= 24;
  text(money(t.commission), MARGIN, { bold: true, size: 24 });
  y -= 30;

  const newLabel = statement.sectionNewTitle || "New serial inventory";
  const summaryRows = [
    [newLabel, `${money(t.newRevenue)} delivered list`, money(t.newCommission)],
    ["Closeout serial inventory", `${money(t.closeoutRevenue)} delivered list`, money(t.closeoutCommission)],
    ["EPIC Protect", `${money(t.protectSell)} sell · ${pct(t.attachRate, 2)} attach · ${pct(t.protectRate)} tier`, money(t.protectCommission)],
    ["Protect bonus", t.protectBonus ? "monthly protect at threshold" : "below monthly threshold", money(t.protectBonus)]
  ];
  if (t.releasedCount) summaryRows.push(["Released holds", `${t.releasedCount} line(s) from earlier months, now paid`, money(t.releasedCommission)]);
  if (t.heldCount) summaryRows.push(["Held — unpaid invoices", `${t.heldCount} line(s) excluded until paid`, money(t.heldCommission)]);
  for (const [label, note, value] of summaryRows) {
    need(18);
    text(label, MARGIN, { bold: true, size: 9.5 });
    text(note, MARGIN + 170, { size: 9, color: MUTED });
    rightText(value, PAGE_W - MARGIN, { bold: true, size: 9.5 });
    y -= 17;
  }
  y -= 6;
  rule();
  y -= 24;

  // ---------------- section tables ----------------
  const sectionTitle = (title, note = "") => {
    need(40);
    text(title.toUpperCase(), MARGIN, { bold: true, size: 10 });
    if (note) text(note, MARGIN + bold.widthOfTextAtSize(title.toUpperCase(), 10) + 10, { size: 8.5, color: MUTED });
    y -= 15;
  };

  // Column layout (right-aligned numerics): invoice 90, product flexible,
  // qty, list, gm, rate, commission.
  const COLS = {
    invoice: MARGIN,
    product: MARGIN + 92,
    qty: MARGIN + 268,
    list: MARGIN + 336,
    gm: MARGIN + 382,
    rate: MARGIN + 420,
    comm: PAGE_W - MARGIN
  };

  const tableHead = (kind) => {
    need(16);
    text("INVOICE", COLS.invoice, { size: 7.5, color: MUTED });
    text(kind === "protect" ? "PLAN" : "MODEL / SERIAL", COLS.product, { size: 7.5, color: MUTED });
    rightText("QTY", COLS.qty, { size: 7.5, color: MUTED });
    rightText("LIST", COLS.list + 34, { size: 7.5, color: MUTED });
    if (kind === "new") {
      rightText("GM", COLS.gm + 26, { size: 7.5, color: MUTED });
      rightText("RATE", COLS.rate + 30, { size: 7.5, color: MUTED });
    } else if (kind === "closeout" || kind === "released") {
      rightText("RATE", COLS.rate + 30, { size: 7.5, color: MUTED });
    }
    if (kind !== "protect") rightText("COMMISSION", COLS.comm, { size: 7.5, color: MUTED });
    y -= 4;
    rule();
    y -= 12;
  };

  const lineRow = (l, kind) => {
    need(14);
    const flags = [];
    if (l.held) flags.push("UNPAID");
    if (l.notSelect) flags.push("SPIFF BRAND — NOT COMMISSIONED");
    if (l.split) flags.push(l.overridden?.credit ? "100% CREDIT" : "SPLIT 1/2");
    else if (l.overridden?.credit) flags.push("100% CREDIT");
    if (l.overridden && (l.overridden.list || l.overridden.cost || l.overridden.rate)) flags.push("ADJUSTED");
    if (l.heldFrom && kind !== "released") flags.push(`HELD ${l.heldFrom}`);

    text(clip(l.invoice, 15), COLS.invoice, { size: 8.5 });
    const prod = l.serialNumber ? `${l.product} · ${l.serialNumber}` : l.product;
    text(clip(prod, 34), COLS.product, { size: 8.5 });
    rightText(String(l.qty), COLS.qty, { size: 8.5 });
    rightText(money(l.revenue), COLS.list + 34, { size: 8.5 });
    if (kind === "new") {
      rightText(l.gmPercent == null ? "—" : `${l.gmPercent.toFixed(1)}%`, COLS.gm + 26, { size: 8.5 });
      rightText(pct(l.rate), COLS.rate + 30, { size: 8.5 });
    } else if (kind === "closeout" || kind === "released") {
      rightText(pct(l.rate), COLS.rate + 30, { size: 8.5 });
    }
    if (kind !== "protect") {
      rightText(l.held ? `(${money(l.commission)})` : money(l.commission), COLS.comm, { size: 8.5, bold: !l.held, color: l.held ? MUTED : INK });
    }
    y -= 11;
    if (flags.length) {
      text(flags.join("  ·  "), COLS.product, { size: 6.5, color: l.held ? RED : MUTED });
      y -= 9;
    }
    y -= 2;
  };

  const totalRow = (label, value) => {
    need(16);
    rule();
    y -= 12;
    text(label, COLS.invoice, { bold: true, size: 8.5 });
    rightText(money(value), COLS.comm, { bold: true, size: 8.5 });
    y -= 18;
  };

  if (statement.newLines.length) {
    sectionTitle(newLabel, statement.sectionNewNote || "tiered % of list by line GM");
    tableHead("new");
    for (const l of statement.newLines) lineRow(l, "new");
    totalRow(`Total — ${newLabel.toLowerCase()}`, t.newCommission);
  }

  if (statement.closeoutLines.length) {
    sectionTitle("Closeout Serial Inventory", "open box & display — flat rate");
    tableHead("closeout");
    for (const l of statement.closeoutLines) lineRow(l, "closeout");
    totalRow("Total — closeout", t.closeoutCommission);
  }

  sectionTitle("EPIC Protect");
  need(14);
  text(
    `Delivered list ${money(t.deliveredList)}  ·  Protect sell ${money(t.protectSell)}  ·  Attachment ${pct(t.attachRate, 2)}  ·  Tier ${pct(t.protectRate)} of sell  ·  Commission ${money(t.protectCommission)}  ·  Bonus ${money(t.protectBonus)}`,
    MARGIN, { size: 8.5 }
  );
  y -= 16;
  if (statement.protectLines.length) {
    tableHead("protect");
    for (const l of statement.protectLines) lineRow(l, "protect");
    y -= 6;
  }

  if (statement.releasedLines.length) {
    sectionTitle("Released Holds", "held in earlier months — invoice now paid, pays this month");
    tableHead("released");
    for (const l of statement.releasedLines) lineRow({ ...l, heldFrom: l.heldFrom }, "released");
    totalRow("Total — released holds", t.releasedCommission);
  }

  if (statement.stillHeldLines.length) {
    sectionTitle("Still Unpaid — Held", "pays automatically once a balance check shows the invoice paid");
    tableHead("closeout");
    for (const l of statement.stillHeldLines) lineRow({ ...l, held: true, rate: undefined }, "protect");
    y -= 6;
  }

  need(30);
  y -= 6;
  rule();
  y -= 16;
  text(
    `Generated ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(generatedAt)} from the Sales Order Detail warehouse. Questions? Talk to Andrew.`,
    MARGIN, { size: 8, color: MUTED }
  );

  return doc.save();
}
