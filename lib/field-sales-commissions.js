// ---------------------------------------------------------------------------
// Field Sales commission engine — pure math over Sales Order Detail warehouse
// lines (sales_order_lines: the monthly Crystal Commissions upload). This
// replaced the old run/lock commissions tool; statements are computed live
// from the warehouse, so re-uploading a month's reports refreshes them.
//
// Plan (Andrew, Aug 2026):
//   NEW serial inventory (serial type ALL): tiered % of list by line GM —
//     18-20.99% GM → 2%, 21-24.99% → 3%, 25-30.99% → 4%, 31%+ → 5%,
//     below 18% pays nothing (flagged).
//   CLOSEOUT (GM-approved OPEN + DISPLAY): flat 5% of list, replacing the
//     tiered margin calculation.
//   EPIC Protect (Wty lines): attachment rate = protect sell / delivered
//     serial list. <1% pays 5% of protect sell, 1-4.99% pays 10%, 5%+ pays
//     15%; plus a $500 monthly bonus when protect sell reaches $5,000.
//   Eligibility: delivered serial revenue must stay above $500k in any
//     rolling six-month period.
//   RTV and SVC serial types are excluded from commission (exchange /
//     service units); shown for transparency, paid nothing.
//
// Split sales: the warehouse stores each split line made WHOLE (revenue
// summed across partners, cost counted once) under the combined code
// ("JD+VWJ"). Statements allocate those lines EQUALLY between the partners
// and badge them, so each rep sees their share.
// ---------------------------------------------------------------------------

export const FIELD_SALES_PLAN = {
  key: "field",
  label: "Field Sales Consultant",
  sectionNewTitle: "New Serial Inventory",
  sectionNewNote: "tiered % of list by line GM",
  manualSelect: false,
  newSerialTiers: [
    { minGm: 31, rate: 0.05 },
    { minGm: 25, rate: 0.04 },
    { minGm: 21, rate: 0.03 },
    { minGm: 18, rate: 0.02 }
  ],
  closeoutRate: 0.05,
  protectTiers: [
    { minAttach: 0.05, rate: 0.15 },
    { minAttach: 0.01, rate: 0.10 },
    { minAttach: 0, rate: 0.05 }
  ],
  protectBonus: { monthlyProtectThreshold: 5000, amount: 500 },
  eligibility: { rollingMonths: 6, minSerialRevenue: 500000 },
  newTypes: ["ALL"],
  closeoutTypes: ["OPEN", "DISPLAY"],
  excludedTypes: ["RTV", "SVC"]
};

// Showroom Consultants pay only on SELECT (non-spiff) brands over the margin
// requirement, plus EPIC Protect and closeouts. Brand can't be derived from
// the Crystal model column today (NetSuite will carry it later), so select-
// brand lines are marked MANUALLY: every ALL-type line starts at no
// commission, and the line editor's payout-% override marks a qualifying
// line (e.g. The Galley at 5%). Protect attachment uses ALL delivered serial
// inventory (every brand + closeouts) as the denominator, and there is no
// rolling-revenue eligibility requirement.
export const SHOWROOM_PLAN = {
  key: "showroom",
  label: "Showroom Consultant",
  sectionNewTitle: "Select Brands",
  sectionNewNote: "manual — mark qualifying lines with a payout % override (The Galley: 30% margin → 5%)",
  manualSelect: true,
  selectBrands: [
    { brand: "The Galley", minGm: 30, rate: 0.05 }
  ],
  newSerialTiers: [],
  closeoutRate: 0.05,
  protectTiers: FIELD_SALES_PLAN.protectTiers,
  protectBonus: FIELD_SALES_PLAN.protectBonus,
  eligibility: null,
  newTypes: ["ALL"],
  closeoutTypes: ["OPEN", "DISPLAY"],
  excludedTypes: ["RTV", "SVC"]
};

// HVAC Selling Technicians (Andrew, 2026-09-23) are paid on the JOB, not the
// line: every AC-prefixed invoice finished in the month (the ePASS
// finished-orders feed — no Crystal upload) with its whole-job gross margin
// (list before tax minus every cost ePASS carries: equipment, parts, labor,
// misc, warranty). The payout is a % of the MARGIN DOLLARS, not the list,
// tiered on the job's GM%:
//   below 22%   → base only (no commission)   high-volume / low-margin work
//   22 – 30.99% → 6%   Healthy Growth — standard replacements
//   31 – 37.99% → 8%   Efficiency Gain — IAQ / high-efficiency upgrades
//   38 – 44.99% → 10%  High Value — complex system design, premium pricing
//   45%+        → 12%  Max Profitability — low material cost / high labor value
// Unpaid holds follow the appliance rule (balance check → held → releases the
// month it clears). Who is on the plan is decided by the JOB CODE (E25) or
// the title's pay plan in User Admin — never a named person.
export const HVAC_PLAN = {
  key: "hvac",
  label: "HVAC Selling Tech",
  planName: "HVAC Selling Technician",
  jobCodes: ["E25"],
  sectionNewTitle: "HVAC Jobs",
  sectionNewNote: "% of job margin $ by whole-job GM",
  payoutBasis: "margin",
  marginTiers: [
    { minGm: 45, rate: 0.12, name: "Max Profitability", note: "Strategic sales with low material cost / high labor value." },
    { minGm: 38, rate: 0.10, name: "High Value", note: "The engineering tier — complex system design where the tech's expertise allowed premium pricing." },
    { minGm: 31, rate: 0.08, name: "Efficiency Gain", note: "IAQ or high-efficiency upgrades sold with better margins." },
    { minGm: 22, rate: 0.06, name: "Healthy Growth", note: "Standard replacements — rewarded for the lead, margin not high enough for a premium payout." }
  ],
  belowFloor: { name: "Base only", note: "High-volume / low-margin work that keeps the install crew busy but doesn't trigger sales rewards." },
  jobPrefixes: ["AC"],
  // Line-engine fields, so an HVAC rep who happens to have appliance lines
  // never crashes the line engine (those lines pay nothing under this plan).
  manualSelect: false,
  newSerialTiers: [],
  closeoutRate: 0,
  protectTiers: FIELD_SALES_PLAN.protectTiers,
  protectBonus: FIELD_SALES_PLAN.protectBonus,
  eligibility: null,
  newTypes: [],
  closeoutTypes: [],
  excludedTypes: ["RTV", "SVC"]
};

export const COMMISSION_PAGE_PLANS = ["Field Sales Consultant", "Showroom Consultant", HVAC_PLAN.planName];

export function planForCommissionPlan(commissionPlan) {
  const name = String(commissionPlan || "");
  if (name === "Showroom Consultant") return SHOWROOM_PLAN;
  if (name === HVAC_PLAN.planName) return HVAC_PLAN;
  return FIELD_SALES_PLAN;
}

// Job-code rule: a directory entry is on the HVAC plan when its title pays
// under the plan OR its job code is one of the plan's (E25).
export function isHvacRep(entry) {
  if (!entry) return false;
  const code = String(entry.jobTitleCode || "").toUpperCase();
  return HVAC_PLAN.jobCodes.includes(code) || String(entry.commissionPlan || "") === HVAC_PLAN.planName;
}

export function hvacTierFor(gmPercent, plan = HVAC_PLAN) {
  if (!Number.isFinite(gmPercent)) return { rate: 0, name: "No cost data", minGm: null, floor: false, noMarginData: true };
  for (const tier of plan.marginTiers) {
    if (gmPercent >= tier.minGm) return { rate: tier.rate, name: tier.name, minGm: tier.minGm, floor: false, noMarginData: false };
  }
  return { rate: 0, name: plan.belowFloor.name, minGm: null, floor: true, noMarginData: false };
}

export function hvacJobKey(job) {
  return ["hvac", job.sourceMonth || "", String(job.invoice || "").toUpperCase(), String(job.salespersonCode || "").toUpperCase()].join("");
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Stable fingerprint for a warehouse line, used to attach exec overrides
// across re-uploads. Includes an occurrence counter because v1 months can
// carry legitimately identical duplicate lines (two of the same unit on one
// order); occurrence follows insertion (file) order, which is stable when
// the same report is re-uploaded.
export function lineKeyOf(line, occurrence = 0) {
  return [
    line.sourceMonth || "",
    line.invoice || "",
    String(line.lineType || "").toLowerCase(),
    line.product || "",
    line.serialNumber || "",
    String(line.salespersonCode || "").toUpperCase(),
    occurrence
  ].join("");
}

// Walk lines in stable order, yielding [line, lineKey] with occurrence
// counting applied.
function withKeys(lines) {
  const seen = new Map();
  return lines.map((line) => {
    const base = lineKeyOf(line, ""); // key prefix ending in the separator
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return [line, base + String(n)];
  });
}

export function marginTierRate(gmPercent, plan = FIELD_SALES_PLAN) {
  if (!Number.isFinite(gmPercent)) return 0;
  for (const tier of plan.newSerialTiers) {
    if (gmPercent >= tier.minGm) return tier.rate;
  }
  return 0;
}

export function protectTierRate(attachRate, plan = FIELD_SALES_PLAN) {
  const a = Number.isFinite(attachRate) ? attachRate : 0;
  for (const tier of plan.protectTiers) {
    if (a >= tier.minAttach) return tier.rate;
  }
  return plan.protectTiers[plan.protectTiers.length - 1].rate;
}

// Split lines allocate equally between the partner codes.
function allocationsOf(line) {
  const partners = String(line.splitPartners || "").split("+").map((c) => c.trim()).filter(Boolean);
  if (line.split && partners.length > 1) {
    return partners.map((code) => ({ code, share: 1 / partners.length }));
  }
  return [{ code: String(line.salespersonCode || "").toUpperCase(), share: 1 }];
}

function classify(line, plan) {
  const type = String(line.serialType || "").toUpperCase();
  if (String(line.lineType).toLowerCase() === "wty") return "protect";
  if (plan.excludedTypes.includes(type)) return "excluded";
  if (plan.closeoutTypes.includes(type)) return "closeout";
  if (plan.newTypes.includes(type)) return "new";
  // Unknown serial type on a model line: treat as new but flag it.
  return "new";
}

function gmPercentOf(line) {
  const revenue = Number(line.revenue) || 0;
  const cost = line.serialCost == null ? null : Number(line.serialCost);
  if (!revenue || cost == null || !Number.isFinite(cost)) return null;
  return ((revenue - cost) / revenue) * 100;
}

// Effective allocations for a line: an exec full-credit override reassigns
// 100% to one code (the split checkbox); otherwise splits share equally.
function effectiveAllocations(line, ov) {
  if (ov?.fullCreditTo) {
    return [{ code: String(ov.fullCreditTo).toUpperCase(), share: 1 }];
  }
  return allocationsOf(line);
}

// Trailing serial (Model-line) revenue per rep code with split allocation.
// `lines` should span the rolling window's source months; overrides (list
// price + full-credit) are honored so eligibility reflects corrections.
// Linked ePASS discounts (Andrew 9/26): the Crystal commission report prints
// the model line at its FULL price; the discount is a Misc line stamped
// with that model line in ePASS. `discounts` ({ "INVOICE|MODEL": { perUnit,
// discount, units, miscCodes } }, from listLineDiscountsForInvoices) is
// netted off every Model line before margin and payout - a $8,175 range
// with a 5% program discount pays on $7,766.25. A list-price override still
// wins outright (the exec typed the number they meant).
export function lineDiscountFor(line, discounts = {}) {
  if (!discounts || String(line?.lineType || "").toLowerCase() !== "model") return null;
  const inv = String(line.baseInvoice || line.invoice || "").toUpperCase().replace(/-\d+$/, "");
  const d = discounts[`${inv}|${String(line.product || "").trim().toUpperCase()}`];
  if (!d || !d.perUnit) return null;
  const qty = Math.abs(Number(line.qty)) || 1;
  const sign = (Number(line.revenue) || 0) < 0 ? -1 : 1; // a return line nets the other way
  return { amount: round2(d.perUnit * qty * sign), miscCodes: d.miscCodes || [], perUnit: d.perUnit };
}

export function serialRevenueByCode(lines, overrides = {}, discounts = {}) {
  const byCode = {};
  for (const [line, key] of withKeys(lines)) {
    if (String(line.lineType).toLowerCase() !== "model") continue;
    const ov = overrides[key] || null;
    if (ov?.omit) continue; // omitted lines never count toward eligibility
    const disc = lineDiscountFor(line, discounts);
    const revenue = ov?.listPrice != null ? ov.listPrice : round2((Number(line.revenue) || 0) + (disc ? disc.amount : 0));
    for (const { code, share } of effectiveAllocations(line, ov)) {
      if (!code) continue;
      byCode[code] = round2((byCode[code] || 0) + revenue * share);
    }
  }
  return byCode;
}

// ---------------------------------------------------------------------------
// Paid-balance holds. A balance check (the finished Invoice Maintenance
// export) uploaded for a month lists every invoice still carrying a balance;
// commission lines on those invoices are HELD — shown with an Unpaid pill,
// excluded from that month's payout. Each later month's balance check
// re-tests the held invoices: once one shows the invoice paid (balance <= 0
// or no longer in the export), the held lines RELEASE into that month's
// statement. Lines still unpaid surface as a reminder list until they clear.
// No balance check uploaded for a month = no holds introduced that month.
// ---------------------------------------------------------------------------

function balanceOf(check, invoice, baseInvoice) {
  const map = check?.balances || {};
  const inv = String(invoice || "").toUpperCase();
  if (inv in map) return Number(map[inv]) || 0;
  const base = String(baseInvoice || inv.split("-")[0]).toUpperCase();
  if (base in map) return Number(map[base]) || 0;
  return 0; // upload exists but invoice not listed as unpaid -> treated as paid
}

function heldInMonth(balanceChecks, month, line) {
  const check = balanceChecks[month];
  if (!check) return false;
  return balanceOf(check, line.invoice, line.baseInvoice) > 0.005;
}

// First month AFTER heldMonth (up to and including statementMonth) whose
// balance check shows the invoice paid. null = still unpaid everywhere.
function releaseMonthOf(balanceChecks, heldMonth, statementMonth, line) {
  const months = Object.keys(balanceChecks).filter((m) => m > heldMonth && m <= statementMonth).sort();
  for (const m of months) {
    if (!heldInMonth(balanceChecks, m, line)) return m;
  }
  return null;
}

// Build one month of statements.
//   monthLines    — sales_order_lines rows; may span the whole rolling window
//                   (rows carry sourceMonth). Prior-month rows feed the
//                   held/release cycle; current-month rows feed the statement.
//   month         — the statement month ("YYYY-MM"); defaults to the newest
//                   sourceMonth present (or all lines when none carry one).
//   balanceChecks — { "YYYY-MM": { balances: { INVOICE: balance } } }
//   trailingByCode — serialRevenueByCode() over the rolling window
//   directory     — [{ code, name, commissionPlan }] from the employee directory
//   properNames   — { CODE: "Proper Name" } from salesperson_codes
export function computeFieldSalesStatements({ monthLines, month = null, balanceChecks = {}, trailingByCode = {}, directory = [], properNames = {}, overrides = {}, discounts = {}, plan = FIELD_SALES_PLAN }) {
  const dirByCode = new Map(directory.map((d) => [String(d.code || "").toUpperCase(), d]));
  const reps = new Map();

  const statementMonth = month
    || monthLines.reduce((max, l) => (l.sourceMonth && l.sourceMonth > max ? l.sourceMonth : max), "")
    || "";

  const repOf = (code) => {
    if (!reps.has(code)) {
      const dir = dirByCode.get(code);
      const commissionPlan = dir?.commissionPlan || "";
      // Reps with an assigned plan compute under it; unassigned reps fall
      // back to the caller's default (Field Sales).
      const repPlan = commissionPlan ? planForCommissionPlan(commissionPlan) : plan;
      reps.set(code, {
        code,
        name: dir?.name || properNames[code] || code,
        email: dir?.email || "",
        commissionPlan,
        planKey: repPlan.key,
        planLabel: repPlan.label,
        sectionNewTitle: repPlan.sectionNewTitle,
        sectionNewNote: repPlan.sectionNewNote,
        plan: repPlan,
        newLines: [], closeoutLines: [], protectLines: [], excludedLines: [],
        releasedLines: [], stillHeldLines: []
      });
    }
    return reps.get(code);
  };

  // Rate for a "new"-section model line under a rep's plan.
  const newLineRate = (repPlan, ov, gm) => {
    if (ov?.rate != null) return { rate: ov.rate, notSelect: false, belowFloor: false, noMarginData: false };
    if (repPlan.manualSelect) {
      // Showroom: only manually-marked select-brand lines pay.
      return { rate: 0, notSelect: true, belowFloor: false, noMarginData: false };
    }
    if (gm == null) return { rate: 0, notSelect: false, belowFloor: false, noMarginData: true };
    const tierRate = marginTierRate(gm, repPlan);
    const floorTier = repPlan.newSerialTiers[repPlan.newSerialTiers.length - 1];
    return {
      rate: tierRate,
      notSelect: false,
      belowFloor: floorTier ? gm < floorTier.minGm : false,
      noMarginData: false
    };
  };

  for (const [line, key] of withKeys(monthLines)) {
    const lineMonth = line.sourceMonth || statementMonth;
    const ov = overrides[key] || null;
    let kind = classify(line, plan);
    // A manual payout-rate override forces an excluded line back into pay
    // (e.g. a GM-approved open box the export mistyped).
    if (kind === "excluded" && ov?.rate != null) kind = "closeout";
    // An omit override removes the line from pay AND from every pool —
    // return lines not charged back to the rep, mis-attributed artifacts.
    // The line stays visible in the excluded list with the exec's note.
    if (ov?.omit) kind = "omitted";

    const disc = lineDiscountFor(line, discounts);
    const effRevenue = ov?.listPrice != null ? ov.listPrice : round2((Number(line.revenue) || 0) + (disc ? disc.amount : 0));
    const effCost = ov?.serialCost != null ? ov.serialCost : (line.serialCost == null ? null : Number(line.serialCost));

    // Prior-month lines only matter for the held/release cycle.
    if (lineMonth !== statementMonth) {
      if (lineMonth > statementMonth || kind === "excluded" || kind === "omitted") continue;
      if (!heldInMonth(balanceChecks, lineMonth, line)) continue;
      const releasedAt = releaseMonthOf(balanceChecks, lineMonth, statementMonth, line);
      if (releasedAt !== null && releasedAt !== statementMonth) continue; // paid out in an earlier month
      for (const { code, share } of effectiveAllocations(line, ov)) {
        if (!code) continue;
        const rep = repOf(code);
        const revenueShare = round2(effRevenue * share);
        const entry = {
          lineKey: key,
          invoice: line.invoice,
          customer: line.customer || "",
          product: line.product || "",
          serialNumber: line.serialNumber || "",
          serialType: String(line.serialType || "").toUpperCase(),
          lineType: String(line.lineType || ""),
          qty: Number(line.qty) || 0,
          revenue: revenueShare,
          heldFrom: lineMonth,
          split: !!(line.split && String(line.splitPartners || "").includes("+")),
          splitPartners: line.splitPartners || ""
        };
        if (releasedAt === statementMonth) {
          if (kind === "protect") {
            // Released protection plans join THIS month's protect pool.
            rep.protectLines.push({ ...entry, released: true, original: { revenue: Number(line.revenue) || 0, serialCost: null }, overridden: null, overrideNote: "", override: null });
          } else {
            const gm = kind === "new" ? gmPercentOf({ revenue: effRevenue, serialCost: effCost }) : null;
            const rate = kind === "new"
              ? newLineRate(rep.plan, ov, gm).rate
              : (ov?.rate != null ? ov.rate : rep.plan.closeoutRate);
            rep.releasedLines.push({ ...entry, gmPercent: gm == null ? null : Math.round(gm * 100) / 100, rate, commission: round2(revenueShare * rate) });
          }
        } else {
          const wouldRate = kind === "new"
            ? newLineRate(rep.plan, ov, gmPercentOf({ revenue: effRevenue, serialCost: effCost })).rate
            : (kind === "closeout" ? (ov?.rate != null ? ov.rate : rep.plan.closeoutRate) : 0);
          rep.stillHeldLines.push({ ...entry, commission: kind === "protect" ? null : round2(revenueShare * wouldRate) });
        }
      }
      continue;
    }

    const held = heldInMonth(balanceChecks, statementMonth, line);

    for (const { code, share } of effectiveAllocations(line, ov)) {
      if (!code) continue;
      const rep = repOf(code);
      const revenueShare = round2(effRevenue * share);
      const overridden = {
        list: ov?.listPrice != null,
        cost: ov?.serialCost != null,
        rate: ov?.rate != null,
        credit: !!ov?.fullCreditTo
      };
      const base = {
        lineKey: key,
        invoice: line.invoice,
        baseInvoice: line.baseInvoice || line.invoice,
        customer: line.customer || "",
        product: line.product || "",
        serialNumber: line.serialNumber || "",
        serialType: String(line.serialType || "").toUpperCase(),
        qty: Number(line.qty) || 0,
        revenue: revenueShare,
        split: !!(line.split && String(line.splitPartners || "").includes("+")),
        splitPartners: line.splitPartners || "",
        overridden: overridden.list || overridden.cost || overridden.rate || overridden.credit ? overridden : null,
        override: ov ? { listPrice: ov.listPrice ?? null, serialCost: ov.serialCost ?? null, rate: ov.rate ?? null, fullCreditTo: ov.fullCreditTo || "", omit: !!ov.omit, note: ov.note || "" } : null,
        // ePASS discount netted off the list (null when the line has none, or
        // a list-price override replaced the whole number).
        discount: disc && ov?.listPrice == null ? { amount: round2(disc.amount * share), full: disc.amount, miscCodes: disc.miscCodes, listBefore: round2((Number(line.revenue) || 0) * share) } : null,
        held,
        original: {
          revenue: Number(line.revenue) || 0,
          serialCost: line.serialCost == null ? null : Number(line.serialCost)
        }
      };

      if (kind === "omitted") {
        rep.excludedLines.push({
          ...base,
          omitted: true,
          reason: ov?.note ? `Omitted — ${ov.note}` : "Omitted by override"
        });
      } else if (kind === "protect") {
        rep.protectLines.push({ ...base });
      } else if (kind === "excluded") {
        rep.excludedLines.push({ ...base, reason: `${base.serialType} — not commissioned` });
      } else if (kind === "closeout") {
        const rate = ov?.rate != null ? ov.rate : rep.plan.closeoutRate;
        rep.closeoutLines.push({
          ...base,
          serialCost: effCost == null ? null : round2(effCost * share),
          rate,
          commission: round2(revenueShare * rate)
        });
      } else {
        const gm = gmPercentOf({ revenue: effRevenue, serialCost: effCost });
        const { rate, notSelect, belowFloor, noMarginData } = newLineRate(rep.plan, ov, gm);
        rep.newLines.push({
          ...base,
          serialCost: effCost == null ? null : round2(effCost * share),
          gmPercent: gm == null ? null : Math.round(gm * 100) / 100,
          rate,
          notSelect,
          belowFloor,
          noMarginData,
          commission: round2(revenueShare * rate)
        });
      }
    }
  }

  const statements = [...reps.values()].filter((rep) => rep.plan.key !== "hvac").map((rep) => {
    // Held (unpaid) lines stay visible in their sections but pay nothing
    // and count toward nothing until their invoice clears.
    const paid = (lines) => lines.filter((l) => !l.held);
    const newTotal = round2(paid(rep.newLines).reduce((s, l) => s + l.commission, 0));
    const newRevenue = round2(paid(rep.newLines).reduce((s, l) => s + l.revenue, 0));
    // Discounts netted this statement (all sections; negative dollars) -
    // flagged on the statement so a rep sees why a line pays on less than list.
    const discounted = [...rep.newLines, ...rep.closeoutLines, ...rep.protectLines].filter((l) => l.discount);
    const discountsNetted = round2(discounted.reduce((s, l) => s + l.discount.amount, 0));
    const closeoutTotal = round2(paid(rep.closeoutLines).reduce((s, l) => s + l.commission, 0));
    const closeoutRevenue = round2(paid(rep.closeoutLines).reduce((s, l) => s + l.revenue, 0));
    const protectSell = round2(paid(rep.protectLines).reduce((s, l) => s + l.revenue, 0));
    // Attachment denominator: every delivered serial unit (all brands +
    // closeouts). Showroom "new" lines sit in newLines at 0% when unmarked,
    // so their revenue still counts here.
    const deliveredList = round2(newRevenue + closeoutRevenue);
    const attachRate = deliveredList > 0 ? protectSell / deliveredList : 0;
    const protectRate = protectTierRate(attachRate, rep.plan);
    const protectCommission = round2(protectSell * protectRate);
    const protectBonus = protectSell >= rep.plan.protectBonus.monthlyProtectThreshold ? rep.plan.protectBonus.amount : 0;
    const releasedTotal = round2(rep.releasedLines.reduce((s, l) => s + l.commission, 0));
    const heldCommission = round2(
      rep.newLines.concat(rep.closeoutLines).filter((l) => l.held).reduce((s, l) => s + l.commission, 0)
    );
    const heldCount = rep.newLines.concat(rep.closeoutLines, rep.protectLines).filter((l) => l.held).length;
    const trailing = round2(trailingByCode[rep.code] || 0);
    const elig = rep.plan.eligibility;
    const { plan: _repPlan, ...repPublic } = rep;

    return {
      ...repPublic,
      totals: {
        newRevenue, newCommission: newTotal,
        closeoutRevenue, closeoutCommission: closeoutTotal,
        deliveredList,
        protectSell,
        attachRate: Math.round(attachRate * 10000) / 10000,
        protectRate,
        protectCommission,
        protectBonus,
        releasedCommission: releasedTotal,
        releasedCount: rep.releasedLines.length,
        heldCommission,
        heldCount,
        stillHeldCount: rep.stillHeldLines.length,
        discountsNetted,
        discountedCount: discounted.length,
        commission: round2(newTotal + closeoutTotal + protectCommission + protectBonus + releasedTotal)
      },
      eligibility: elig
        ? {
            trailingSerialRevenue: trailing,
            required: elig.minSerialRevenue,
            months: elig.rollingMonths,
            eligible: trailing >= elig.minSerialRevenue
          }
        : {
            // Showroom has no rolling-revenue requirement.
            trailingSerialRevenue: trailing,
            required: null,
            months: null,
            eligible: true
          }
    };
  });

  statements.sort((a, b) => b.totals.commission - a.totals.commission || a.name.localeCompare(b.name));
  return statements;
}


// ---------------------------------------------------------------------------
// HVAC job statements — one row per finished AC invoice, whole-job margin.
//   jobs          — sales_order_detail rows (listHvacJobsForMonths) spanning
//                   the rolling window; prior-month rows feed held/release.
//   month         — statement month ("YYYY-MM")
//   balanceChecks — same shape as the line engine
//   directory     — [{ code, name, email, commissionPlan (pay plan), jobTitleCode }]
//   overrides     — { lineKey: {...} } from commission_line_overrides; the
//                   line editor's list → job gross, cost → job cost, rate,
//                   omit + note all apply. Keys come from hvacJobKey().
// Only reps the job-code rule puts on the plan get a statement; jobs sold
// under other codes are returned as `unassigned` so the exec can see who
// still needs the E25 title.
// ---------------------------------------------------------------------------
export function computeHvacStatements({ jobs, month, balanceChecks = {}, directory = [], properNames = {}, overrides = {}, plan = HVAC_PLAN }) {
  const dirByCode = new Map(directory.map((d) => [String(d.code || "").toUpperCase(), d]));
  const reps = new Map();
  const unassigned = new Map();
  const statementMonth = String(month || "");

  const repOf = (code) => {
    if (!reps.has(code)) {
      const dir = dirByCode.get(code);
      reps.set(code, {
        code,
        name: dir?.name || properNames[code] || code,
        email: dir?.email || "",
        commissionPlan: plan.planName,
        planKey: plan.key,
        planLabel: plan.label,
        sectionNewTitle: plan.sectionNewTitle,
        sectionNewNote: plan.sectionNewNote,
        jobs: [], releasedJobs: [], stillHeldJobs: [], excludedJobs: [],
        // empty line-engine sections so shared code (posting, exceptions,
        // the PDF) can walk a statement without caring which plan it is
        newLines: [], closeoutLines: [], protectLines: [], excludedLines: [], releasedLines: [], stillHeldLines: []
      });
    }
    return reps.get(code);
  };

  const shape = (job, ov) => {
    const original = { gross: round2(job.revenue), cost: round2(job.cost) };
    const gross = ov?.listPrice != null ? round2(ov.listPrice) : original.gross;
    const cost = ov?.serialCost != null ? round2(ov.serialCost) : original.cost;
    const margin = round2(gross - cost);
    const gm = gross ? (margin / gross) * 100 : null;
    const tier = hvacTierFor(gm, plan);
    const rate = ov?.rate != null ? ov.rate : tier.rate;
    const commission = margin > 0 ? round2(margin * rate) : 0;
    const overridden = { list: ov?.listPrice != null, cost: ov?.serialCost != null, rate: ov?.rate != null, credit: false };
    return {
      lineKey: hvacJobKey(job),
      invoice: job.invoice,
      baseInvoice: job.baseInvoice || String(job.invoice || "").split("-")[0],
      customer: job.customer || "",
      customerNumber: job.customerNumber || "",
      reference: job.reference || "",
      finishDate: job.finishDate || "",
      product: job.reference || job.customer || job.invoice, // what the rep pages call the "model" column
      serialNumber: "",
      qty: 1,
      revenue: gross, gross, cost, margin,
      gmPercent: gm == null ? null : Math.round(gm * 100) / 100,
      tier: tier.name, tierMinGm: tier.minGm, belowFloor: tier.floor, noMarginData: tier.noMarginData, negativeMargin: margin < 0,
      rate, commission,
      list: job.detail?.list || null, costs: job.detail?.cost || null,
      split: false, splitPartners: "",
      overridden: overridden.list || overridden.cost || overridden.rate ? overridden : null,
      override: ov ? { listPrice: ov.listPrice ?? null, serialCost: ov.serialCost ?? null, rate: ov.rate ?? null, fullCreditTo: "", omit: !!ov.omit, note: ov.note || "" } : null,
      overrideNote: ov?.note || "",
      original: { revenue: original.gross, serialCost: original.cost, gross: original.gross, cost: original.cost }
    };
  };

  for (const job of jobs || []) {
    const code = String(job.salespersonCode || "").toUpperCase();
    const jobMonth = job.sourceMonth || statementMonth;
    if (!code || jobMonth > statementMonth) continue;
    const dir = dirByCode.get(code);
    if (!isHvacRep(dir)) {
      if (jobMonth === statementMonth) {
        const u = unassigned.get(code) || { code, name: dir?.name || properNames[code] || code, jobs: 0, gross: 0 };
        u.jobs++; u.gross = round2(u.gross + (Number(job.revenue) || 0)); unassigned.set(code, u);
      }
      continue;
    }
    const ov = overrides[hvacJobKey(job)] || null;
    const rep = repOf(code);

    if (jobMonth !== statementMonth) {
      // earlier month: only matters if it was held then
      if (ov?.omit || !heldInMonth(balanceChecks, jobMonth, job)) continue;
      const releasedAt = releaseMonthOf(balanceChecks, jobMonth, statementMonth, job);
      if (releasedAt !== null && releasedAt !== statementMonth) continue;
      const row = { ...shape(job, ov), heldFrom: jobMonth };
      if (releasedAt === statementMonth) rep.releasedJobs.push({ ...row, released: true });
      else rep.stillHeldJobs.push({ ...row, held: true });
      continue;
    }

    const row = shape(job, ov);
    if (ov?.omit) {
      rep.excludedJobs.push({ ...row, omitted: true, reason: ov.note ? `Omitted — ${ov.note}` : "Omitted by override", commission: 0 });
      continue;
    }
    row.held = heldInMonth(balanceChecks, statementMonth, job);
    rep.jobs.push(row);
  }

  const statements = [...reps.values()].map((rep) => {
    const paid = rep.jobs.filter((j) => !j.held);
    const sum = (rows, k) => round2(rows.reduce((s, j) => s + (Number(j[k]) || 0), 0));
    const byTier = [...plan.marginTiers].reverse().map((t) => ({ minGm: t.minGm, name: t.name, rate: t.rate, jobs: 0, margin: 0, commission: 0 }));
    const floor = { minGm: null, name: plan.belowFloor.name, rate: 0, jobs: 0, margin: 0, commission: 0 };
    for (const j of paid) {
      const bucket = j.belowFloor || j.noMarginData ? floor : byTier.find((t) => t.minGm === j.tierMinGm) || floor;
      bucket.jobs++; bucket.margin = round2(bucket.margin + j.margin); bucket.commission = round2(bucket.commission + j.commission);
    }
    const jobCommission = sum(paid, "commission");
    const releasedCommission = sum(rep.releasedJobs, "commission");
    const heldJobs = rep.jobs.filter((j) => j.held);
    const totals = {
      jobs: rep.jobs.length, paidJobs: paid.length,
      gross: sum(paid, "gross"), cost: sum(paid, "cost"), margin: sum(paid, "margin"),
      gmPercent: sum(paid, "gross") ? Math.round((sum(paid, "margin") / sum(paid, "gross")) * 10000) / 100 : null,
      jobCommission,
      byTier: [floor, ...byTier],
      releasedCommission, releasedCount: rep.releasedJobs.length,
      heldCommission: sum(heldJobs, "commission"), heldCount: heldJobs.length,
      stillHeldCount: rep.stillHeldJobs.length,
      // line-engine keys, zero, so shared totals code never sees undefined
      newRevenue: 0, newCommission: 0, closeoutRevenue: 0, closeoutCommission: 0, deliveredList: 0, protectSell: 0, attachRate: 0, protectRate: 0, protectCommission: 0, protectBonus: 0,
      commission: round2(jobCommission + releasedCommission)
    };
    return {
      ...rep,
      totals,
      eligibility: { trailingSerialRevenue: 0, required: null, months: null, eligible: true }
    };
  });
  statements.sort((a, b) => b.totals.commission - a.totals.commission || a.name.localeCompare(b.name));
  return { statements, unassigned: [...unassigned.values()].sort((a, b) => b.gross - a.gross) };
}
