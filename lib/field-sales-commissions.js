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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

// Trailing serial (Model-line) revenue per rep code with split allocation.
// `lines` should span the rolling window's source months.
export function serialRevenueByCode(lines) {
  const byCode = {};
  for (const line of lines) {
    if (String(line.lineType).toLowerCase() === "model") {
      for (const { code, share } of allocationsOf(line)) {
        if (!code) continue;
        byCode[code] = round2((byCode[code] || 0) + (Number(line.revenue) || 0) * share);
      }
    }
  }
  return byCode;
}

// Build one month of statements.
//   monthLines    — sales_order_lines rows for the statement month
//   trailingByCode — serialRevenueByCode() over the rolling window
//   directory     — [{ code, name, commissionPlan }] from the employee directory
//   properNames   — { CODE: "Proper Name" } from salesperson_codes
export function computeFieldSalesStatements({ monthLines, trailingByCode = {}, directory = [], properNames = {}, plan = FIELD_SALES_PLAN }) {
  const dirByCode = new Map(directory.map((d) => [String(d.code || "").toUpperCase(), d]));
  const reps = new Map();

  const repOf = (code) => {
    if (!reps.has(code)) {
      const dir = dirByCode.get(code);
      reps.set(code, {
        code,
        name: dir?.name || properNames[code] || code,
        commissionPlan: dir?.commissionPlan || "",
        newLines: [], closeoutLines: [], protectLines: [], excludedLines: []
      });
    }
    return reps.get(code);
  };

  for (const line of monthLines) {
    const kind = classify(line, plan);
    for (const { code, share } of allocationsOf(line)) {
      if (!code) continue;
      const rep = repOf(code);
      const revenueShare = round2((Number(line.revenue) || 0) * share);
      const base = {
        invoice: line.invoice,
        baseInvoice: line.baseInvoice || line.invoice,
        customer: line.customer || "",
        product: line.product || "",
        serialNumber: line.serialNumber || "",
        serialType: String(line.serialType || "").toUpperCase(),
        qty: Number(line.qty) || 0,
        revenue: revenueShare,
        split: !!(line.split && String(line.splitPartners || "").includes("+")),
        splitPartners: line.splitPartners || ""
      };

      if (kind === "protect") {
        rep.protectLines.push({ ...base });
      } else if (kind === "excluded") {
        rep.excludedLines.push({ ...base, reason: `${base.serialType} — not commissioned` });
      } else if (kind === "closeout") {
        rep.closeoutLines.push({
          ...base,
          serialCost: line.serialCost == null ? null : round2(Number(line.serialCost) * share),
          rate: plan.closeoutRate,
          commission: round2(revenueShare * plan.closeoutRate)
        });
      } else {
        const gm = gmPercentOf(line);
        const rate = gm == null ? 0 : marginTierRate(gm, plan);
        rep.newLines.push({
          ...base,
          serialCost: line.serialCost == null ? null : round2(Number(line.serialCost) * share),
          gmPercent: gm == null ? null : Math.round(gm * 100) / 100,
          rate,
          belowFloor: gm != null && gm < plan.newSerialTiers[plan.newSerialTiers.length - 1].minGm,
          noMarginData: gm == null,
          commission: round2(revenueShare * rate)
        });
      }
    }
  }

  const statements = [...reps.values()].map((rep) => {
    const newTotal = round2(rep.newLines.reduce((s, l) => s + l.commission, 0));
    const newRevenue = round2(rep.newLines.reduce((s, l) => s + l.revenue, 0));
    const closeoutTotal = round2(rep.closeoutLines.reduce((s, l) => s + l.commission, 0));
    const closeoutRevenue = round2(rep.closeoutLines.reduce((s, l) => s + l.revenue, 0));
    const protectSell = round2(rep.protectLines.reduce((s, l) => s + l.revenue, 0));
    const deliveredList = round2(newRevenue + closeoutRevenue);
    const attachRate = deliveredList > 0 ? protectSell / deliveredList : 0;
    const protectRate = protectTierRate(attachRate, plan);
    const protectCommission = round2(protectSell * protectRate);
    const protectBonus = protectSell >= plan.protectBonus.monthlyProtectThreshold ? plan.protectBonus.amount : 0;
    const trailing = round2(trailingByCode[rep.code] || 0);

    return {
      ...rep,
      totals: {
        newRevenue, newCommission: newTotal,
        closeoutRevenue, closeoutCommission: closeoutTotal,
        deliveredList,
        protectSell,
        attachRate: Math.round(attachRate * 10000) / 10000,
        protectRate,
        protectCommission,
        protectBonus,
        commission: round2(newTotal + closeoutTotal + protectCommission + protectBonus)
      },
      eligibility: {
        trailingSerialRevenue: trailing,
        required: plan.eligibility.minSerialRevenue,
        months: plan.eligibility.rollingMonths,
        eligible: trailing >= plan.eligibility.minSerialRevenue
      }
    };
  });

  statements.sort((a, b) => b.totals.commission - a.totals.commission || a.name.localeCompare(b.name));
  return statements;
}
