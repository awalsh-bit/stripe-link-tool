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
export function serialRevenueByCode(lines, overrides = {}) {
  const byCode = {};
  for (const [line, key] of withKeys(lines)) {
    if (String(line.lineType).toLowerCase() !== "model") continue;
    const ov = overrides[key] || null;
    const revenue = ov?.listPrice != null ? ov.listPrice : (Number(line.revenue) || 0);
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
export function computeFieldSalesStatements({ monthLines, month = null, balanceChecks = {}, trailingByCode = {}, directory = [], properNames = {}, overrides = {}, plan = FIELD_SALES_PLAN }) {
  const dirByCode = new Map(directory.map((d) => [String(d.code || "").toUpperCase(), d]));
  const reps = new Map();

  const statementMonth = month
    || monthLines.reduce((max, l) => (l.sourceMonth && l.sourceMonth > max ? l.sourceMonth : max), "")
    || "";

  const repOf = (code) => {
    if (!reps.has(code)) {
      const dir = dirByCode.get(code);
      reps.set(code, {
        code,
        name: dir?.name || properNames[code] || code,
        commissionPlan: dir?.commissionPlan || "",
        newLines: [], closeoutLines: [], protectLines: [], excludedLines: [],
        releasedLines: [], stillHeldLines: []
      });
    }
    return reps.get(code);
  };

  for (const [line, key] of withKeys(monthLines)) {
    const lineMonth = line.sourceMonth || statementMonth;
    const ov = overrides[key] || null;
    let kind = classify(line, plan);
    // A manual payout-rate override forces an excluded line back into pay
    // (e.g. a GM-approved open box the export mistyped).
    if (kind === "excluded" && ov?.rate != null) kind = "closeout";

    const effRevenue = ov?.listPrice != null ? ov.listPrice : (Number(line.revenue) || 0);
    const effCost = ov?.serialCost != null ? ov.serialCost : (line.serialCost == null ? null : Number(line.serialCost));

    // Prior-month lines only matter for the held/release cycle.
    if (lineMonth !== statementMonth) {
      if (lineMonth > statementMonth || kind === "excluded") continue;
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
            const tierRate = kind === "new" ? (gm == null ? 0 : marginTierRate(gm, plan)) : plan.closeoutRate;
            const rate = ov?.rate != null ? ov.rate : tierRate;
            rep.releasedLines.push({ ...entry, gmPercent: gm == null ? null : Math.round(gm * 100) / 100, rate, commission: round2(revenueShare * rate) });
          }
        } else {
          const wouldRate = kind === "new"
            ? (ov?.rate != null ? ov.rate : (gmPercentOf({ revenue: effRevenue, serialCost: effCost }) == null ? 0 : marginTierRate(gmPercentOf({ revenue: effRevenue, serialCost: effCost }), plan)))
            : (kind === "closeout" ? (ov?.rate != null ? ov.rate : plan.closeoutRate) : 0);
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
        override: ov ? { listPrice: ov.listPrice ?? null, serialCost: ov.serialCost ?? null, rate: ov.rate ?? null, fullCreditTo: ov.fullCreditTo || "", note: ov.note || "" } : null,
        held,
        original: {
          revenue: Number(line.revenue) || 0,
          serialCost: line.serialCost == null ? null : Number(line.serialCost)
        }
      };

      if (kind === "protect") {
        rep.protectLines.push({ ...base });
      } else if (kind === "excluded") {
        rep.excludedLines.push({ ...base, reason: `${base.serialType} — not commissioned` });
      } else if (kind === "closeout") {
        const rate = ov?.rate != null ? ov.rate : plan.closeoutRate;
        rep.closeoutLines.push({
          ...base,
          serialCost: effCost == null ? null : round2(effCost * share),
          rate,
          commission: round2(revenueShare * rate)
        });
      } else {
        const gm = gmPercentOf({ revenue: effRevenue, serialCost: effCost });
        const tierRate = gm == null ? 0 : marginTierRate(gm, plan);
        const rate = ov?.rate != null ? ov.rate : tierRate;
        rep.newLines.push({
          ...base,
          serialCost: effCost == null ? null : round2(effCost * share),
          gmPercent: gm == null ? null : Math.round(gm * 100) / 100,
          rate,
          belowFloor: ov?.rate == null && gm != null && gm < plan.newSerialTiers[plan.newSerialTiers.length - 1].minGm,
          noMarginData: gm == null && ov?.rate == null,
          commission: round2(revenueShare * rate)
        });
      }
    }
  }

  const statements = [...reps.values()].map((rep) => {
    // Held (unpaid) lines stay visible in their sections but pay nothing
    // and count toward nothing until their invoice clears.
    const paid = (lines) => lines.filter((l) => !l.held);
    const newTotal = round2(paid(rep.newLines).reduce((s, l) => s + l.commission, 0));
    const newRevenue = round2(paid(rep.newLines).reduce((s, l) => s + l.revenue, 0));
    const closeoutTotal = round2(paid(rep.closeoutLines).reduce((s, l) => s + l.commission, 0));
    const closeoutRevenue = round2(paid(rep.closeoutLines).reduce((s, l) => s + l.revenue, 0));
    const protectSell = round2(paid(rep.protectLines).reduce((s, l) => s + l.revenue, 0));
    const deliveredList = round2(newRevenue + closeoutRevenue);
    const attachRate = deliveredList > 0 ? protectSell / deliveredList : 0;
    const protectRate = protectTierRate(attachRate, plan);
    const protectCommission = round2(protectSell * protectRate);
    const protectBonus = protectSell >= plan.protectBonus.monthlyProtectThreshold ? plan.protectBonus.amount : 0;
    const releasedTotal = round2(rep.releasedLines.reduce((s, l) => s + l.commission, 0));
    const heldCommission = round2(
      rep.newLines.concat(rep.closeoutLines).filter((l) => l.held).reduce((s, l) => s + l.commission, 0)
    );
    const heldCount = rep.newLines.concat(rep.closeoutLines, rep.protectLines).filter((l) => l.held).length;
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
        releasedCommission: releasedTotal,
        releasedCount: rep.releasedLines.length,
        heldCommission,
        heldCount,
        stillHeldCount: rep.stillHeldLines.length,
        commission: round2(newTotal + closeoutTotal + protectCommission + protectBonus + releasedTotal)
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
