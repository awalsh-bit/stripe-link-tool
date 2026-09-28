import { getPostgresPool } from "./data-postgres.js";

// ---------------------------------------------------------------------------
// ePASS CUSTOMER MASTER + shopper matching (Andrew, 2026-09-28: "click to
// confirm ePASS customer and Shopper profile match ... eventually show
// customers a true profile of what they have purchased from us and give
// builders visibility to their open / finished invoices").
//
//   epass_customers          the Customer master from the finance bundle's
//                            daily `customers` dataset — contact + address
//                            columns only (the pull never selects employer,
//                            credit or ID fields). Phones are kept as 10-digit
//                            strings and emails lower-cased so a shopper's
//                            phone / email finds its customer with an index.
//   shop_shoppers.epass_customer_code   the confirmed link (set from the
//                            Shopper Profiles page; nothing links itself).
//                            Columns live in lib/shop-postgres.js's schema.
//
// Matching only SUGGESTS: candidates ranked by phone + email + name/ZIP; a
// person clicks the one that is right. The link is what the purchase-history
// and (later) the shop-side "my purchases" / builder invoice views read.
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS epass_customers (
  code TEXT PRIMARY KEY,
  last_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT '',
  inv_type TEXT NOT NULL DEFAULT '',
  salesperson TEXT NOT NULL DEFAULT '',
  phones TEXT[] NOT NULL DEFAULT '{}',
  emails TEXT[] NOT NULL DEFAULT '{}',
  address1 TEXT NOT NULL DEFAULT '',
  address2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  parent_code TEXT NOT NULL DEFAULT '',
  do_not_email BOOLEAN NOT NULL DEFAULT FALSE,
  date_created TEXT NOT NULL DEFAULT '',
  date_modified TEXT NOT NULL DEFAULT '',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_epc_phones ON epass_customers USING GIN (phones);
CREATE INDEX IF NOT EXISTS idx_epc_emails ON epass_customers USING GIN (emails);
CREATE INDEX IF NOT EXISTS idx_epc_last ON epass_customers (upper(last_name));
CREATE INDEX IF NOT EXISTS idx_epc_zip ON epass_customers (zip);
CREATE TABLE IF NOT EXISTS epass_customers_meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pulled_at TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let ensurePromise = null;
async function getReadyPool() {
  const pool = await getPostgresPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  if (!ensurePromise) ensurePromise = pool.query(SCHEMA_SQL).catch((err) => { ensurePromise = null; throw err; });
  await ensurePromise;
  return pool;
}

const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row || {}).find((k) => k.toLowerCase() === String(n).toLowerCase());
    if (key != null && row[key] != null && String(row[key]).trim() !== "") return String(row[key]).trim();
  }
  return "";
};
const day = (v) => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0]; const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return u ? `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}` : ""; };
const bool = (v) => /^(1|true|y|yes)$/i.test(String(v ?? "").trim());
export const phone10 = (raw) => { const d = String(raw || "").replace(/\D/g, ""); const t = d.length > 10 ? d.slice(-10) : d; return t.length === 10 ? t : ""; };
const emailKey = (raw) => { const e = String(raw || "").trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : ""; };
const zip5 = (v) => (String(v || "").match(/\d{5}/) || [""])[0];
const canonName = (v) => String(v || "").trim().toUpperCase().replace(/[^A-Z0-9 ]+/g, "").replace(/\s+/g, " ");

export function customersFromFeed(rows) {
  const out = [];
  for (const r of rows || []) {
    const code = pick(r, "Code").toUpperCase().slice(0, 40);
    if (!code) continue;
    const last = pick(r, "LastName").slice(0, 120), first = pick(r, "FirstName").slice(0, 80);
    const phones = [...new Set(["Phone1", "Phone2", "OtherPhone", "BusinessPhone", "MailingPhone"].map((k) => phone10(pick(r, k))).filter(Boolean))];
    const emails = [...new Set(["Email", "BillingEmail", "MailingEmail"].map((k) => emailKey(pick(r, k))).filter(Boolean))];
    const rec = {
      code, lastName: last, firstName: first, name: [last, first].filter(Boolean).join(", "),
      accountType: pick(r, "AccountType").slice(0, 40), invType: pick(r, "InvTypeCode").slice(0, 10), salesperson: pick(r, "SalespersonCode").toUpperCase().slice(0, 20),
      phones, emails,
      address1: pick(r, "Address1").slice(0, 160), address2: pick(r, "Address2").slice(0, 160), city: pick(r, "City").slice(0, 80), state: pick(r, "State").toUpperCase().slice(0, 20), zip: zip5(pick(r, "ZipCode")),
      parentCode: pick(r, "ParentCompanyCode").toUpperCase().slice(0, 40), doNotEmail: bool(pick(r, "DoNotEmail")) || bool(pick(r, "DeclineEmail")),
      dateCreated: day(pick(r, "DateCreated")), dateModified: day(pick(r, "DateModified")),
      raw: { Address1: pick(r, "Address1"), Address2: pick(r, "Address2"), City: pick(r, "City"), State: pick(r, "State"), ZipCode: pick(r, "ZipCode"),
        MailingAddress1: pick(r, "MailingAddress1"), MailingCity: pick(r, "MailingCity"), MailingState: pick(r, "MailingState"), MailingZipCode: pick(r, "MailingZipCode"),
        ProjectCode: pick(r, "ProjectCode"), BranchCode: pick(r, "BranchCode"), MiddleName: pick(r, "MiddleName") }
    };
    out.push(rec);
  }
  return out;
}

// Upsert (a failed daily pull leaves yesterday's master in place).
export async function upsertEpassCustomers(bundle, { filename = "" } = {}) {
  const pool = await getReadyPool();
  const rows = customersFromFeed(bundle?.datasets?.customers);
  if (!rows.length) return { customers: 0, skipped: "no customers dataset in this bundle" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300);
      const params = [];
      const tuples = chunk.map((c) => {
        const row = [c.code, c.lastName, c.firstName, c.name, c.accountType, c.invType, c.salesperson, c.phones, c.emails, c.address1, c.address2, c.city, c.state, c.zip, c.parentCode, c.doNotEmail, c.dateCreated, c.dateModified, JSON.stringify(c.raw)];
        return "(" + row.map((v, j) => `$${params.push(v)}${j === 7 || j === 8 ? "::text[]" : j === 18 ? "::jsonb" : ""}`).join(", ") + ", NOW())";
      });
      await client.query(
        `INSERT INTO epass_customers (code, last_name, first_name, name, account_type, inv_type, salesperson, phones, emails, address1, address2, city, state, zip, parent_code, do_not_email, date_created, date_modified, raw, updated_at)
         VALUES ${tuples.join(", ")}
         ON CONFLICT (code) DO UPDATE SET last_name = EXCLUDED.last_name, first_name = EXCLUDED.first_name, name = EXCLUDED.name, account_type = EXCLUDED.account_type, inv_type = EXCLUDED.inv_type,
           salesperson = EXCLUDED.salesperson, phones = EXCLUDED.phones, emails = EXCLUDED.emails, address1 = EXCLUDED.address1, address2 = EXCLUDED.address2, city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip,
           parent_code = EXCLUDED.parent_code, do_not_email = EXCLUDED.do_not_email, date_created = EXCLUDED.date_created, date_modified = EXCLUDED.date_modified, raw = EXCLUDED.raw, updated_at = NOW()`,
        params
      );
    }
    await client.query(
      `INSERT INTO epass_customers_meta (id, pulled_at, filename, count, updated_at) VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET pulled_at = EXCLUDED.pulled_at, filename = EXCLUDED.filename, count = EXCLUDED.count, updated_at = NOW()`,
      [String(bundle?.pulledAt || ""), String(filename || "").slice(0, 200), rows.length]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { customers: rows.length };
}

export async function getEpassCustomersMeta() {
  const pool = await getReadyPool();
  const [m, c] = await Promise.all([
    pool.query(`SELECT pulled_at, filename, count, updated_at FROM epass_customers_meta WHERE id = 1`),
    pool.query(`SELECT COUNT(*)::int AS n FROM epass_customers`)
  ]);
  return { pulledAt: m.rows[0]?.pulled_at || "", updatedAt: m.rows[0]?.updated_at?.toISOString?.() || null, count: c.rows[0]?.n || 0 };
}

const mapCustomer = (r) => ({
  code: r.code, name: r.name, lastName: r.last_name, firstName: r.first_name, accountType: r.account_type, invType: r.inv_type, salesperson: r.salesperson,
  phones: r.phones || [], emails: r.emails || [], address1: r.address1, address2: r.address2, city: r.city, state: r.state, zip: r.zip, parentCode: r.parent_code,
  doNotEmail: r.do_not_email, dateCreated: r.date_created, dateModified: r.date_modified
});

export async function getEpassCustomers(codes) {
  const list = [...new Set((codes || []).map((c) => String(c || "").trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return {};
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT * FROM epass_customers WHERE code = ANY($1::text[])`, [list]);
  return Object.fromEntries(r.rows.map((x) => [x.code, mapCustomer(x)]));
}

// Free-text search for the manual pick: code, name, phone digits or email.
export async function searchEpassCustomers(q, { limit = 25 } = {}) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const pool = await getReadyPool();
  const digits = raw.replace(/\D/g, "");
  const like = "%" + raw.replace(/[%_]/g, "") + "%";
  const r = await pool.query(
    `SELECT * FROM epass_customers
      WHERE code ILIKE $1 OR name ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1
         OR ($2 <> '' AND EXISTS (SELECT 1 FROM unnest(phones) p WHERE p LIKE '%' || $2 || '%'))
         OR ($3 <> '' AND EXISTS (SELECT 1 FROM unnest(emails) e WHERE e LIKE $3))
      ORDER BY (code ILIKE $1) DESC, date_modified DESC NULLS LAST, name
      LIMIT $4`,
    [like, digits.length >= 4 ? digits : "", raw.includes("@") ? like.toLowerCase() : "", Math.min(100, Math.max(1, limit))]
  );
  return r.rows.map(mapCustomer);
}

// Suggestions for a batch of shoppers → { [shopperId]: [candidate...] } where
// a candidate is a customer plus `score` / `why` (phone, email, name+zip).
// Phone and email are exact (10-digit / lower-cased); name + ZIP is the
// weak fallback for customers ePASS has no contact info for.
export async function matchEpassCustomersForShoppers(shoppers) {
  const pool = await getReadyPool();
  const out = {};
  const list = (shoppers || []).filter((s) => s && s.id != null);
  if (!list.length) return out;
  const phones = [...new Set(list.map((s) => phone10(s.phone)).filter(Boolean))];
  const emails = [...new Set(list.map((s) => emailKey(s.email)).filter(Boolean))];
  const lastZip = list.map((s) => ({ last: canonName(s.lastName), zip: zip5(s.address?.zip) })).filter((x) => x.last && x.zip);
  const [byPhone, byEmail, byNameZip] = await Promise.all([
    phones.length ? pool.query(`SELECT * FROM epass_customers WHERE phones && $1::text[]`, [phones]) : { rows: [] },
    emails.length ? pool.query(`SELECT * FROM epass_customers WHERE emails && $1::text[]`, [emails]) : { rows: [] },
    lastZip.length ? pool.query(`SELECT * FROM epass_customers WHERE zip = ANY($1::text[]) AND upper(last_name) = ANY($2::text[])`, [[...new Set(lastZip.map((x) => x.zip))], [...new Set(lastZip.map((x) => x.last))]]) : { rows: [] }
  ]);
  for (const s of list) {
    const p = phone10(s.phone), e = emailKey(s.email), ln = canonName(s.lastName), fn = canonName(s.firstName), z = zip5(s.address?.zip);
    const cands = new Map();
    const add = (row, why, pts) => {
      const c = cands.get(row.code) || { ...mapCustomer(row), score: 0, why: [] };
      if (!c.why.includes(why)) { c.why.push(why); c.score += pts; }
      cands.set(row.code, c);
    };
    if (p) for (const row of byPhone.rows) if ((row.phones || []).includes(p)) add(row, "phone", 3);
    if (e) for (const row of byEmail.rows) if ((row.emails || []).includes(e)) add(row, "email", 3);
    if (ln && z) for (const row of byNameZip.rows) if (row.zip === z && canonName(row.last_name) === ln) add(row, "name + ZIP", 1);
    // A matching last name on a phone/email hit is a small extra vote; a
    // different last name a small penalty (shared household phones).
    for (const c of cands.values()) {
      if (ln && canonName(c.lastName) === ln) c.score += 1;
      else if (ln && c.lastName) c.score -= 0.5;
      if (fn && canonName(c.firstName).startsWith(fn.split(" ")[0])) c.score += 0.5;
    }
    out[s.id] = [...cands.values()].sort((a, b) => b.score - a.score || (b.dateModified || "").localeCompare(a.dateModified || "")).slice(0, 5);
  }
  return out;
}

// ---- the confirmed link ---------------------------------------------------
export async function setShopperEpassLink({ shopperId, code, by = "" }) {
  const pool = await getReadyPool();
  const c = String(code || "").trim().toUpperCase();
  if (c) {
    const exists = await pool.query(`SELECT code FROM epass_customers WHERE code = $1`, [c]);
    if (!exists.rows[0]) throw new Error(`${c} isn't in the ePASS customer master on file.`);
  }
  const r = await pool.query(
    `UPDATE shop_shoppers SET epass_customer_code = $2, epass_linked_by = CASE WHEN $2 = '' THEN '' ELSE $3 END, epass_linked_at = CASE WHEN $2 = '' THEN NULL ELSE NOW() END WHERE id::text = $1 RETURNING id`,
    [String(shopperId), c, String(by || "").slice(0, 120)]
  );
  if (!r.rows[0]) throw new Error("Shopper not found.");
  return { shopperId, code: c };
}

export async function getShopperEpassLinks(shopperIds) {
  const ids = (shopperIds || []).filter((x) => x != null);
  if (!ids.length) return {};
  const pool = await getReadyPool();
  const r = await pool.query(`SELECT id, epass_customer_code, epass_linked_by, epass_linked_at FROM shop_shoppers WHERE id::text = ANY($1::text[]) AND epass_customer_code <> ''`, [ids.map(String)]);
  return Object.fromEntries(r.rows.map((x) => [x.id, { code: x.epass_customer_code, by: x.epass_linked_by, at: x.epass_linked_at?.toISOString?.() || null }]));
}

// Everything Agility knows about one ePASS customer code: finished
// invoices (sales_order_detail), the units on them (epass_sold_serials),
// and what's still open (open_sales_orders). Sub-invoices (-1, -2) and the
// customer's child accounts (ParentCompanyCode, for builders) are included.
export async function epassCustomerHistory(code, { limit = 200 } = {}) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const pool = await getReadyPool();
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows).catch(() => []);
  const family = await q(`SELECT code FROM epass_customers WHERE code = $1 OR parent_code = $1`, [c]);
  const codes = [...new Set([c, ...family.map((r) => r.code)])];
  const [customer, finished, units, open] = await Promise.all([
    getEpassCustomers([c]).then((m) => m[c] || null),
    q(`SELECT invoice, department, salesperson, finish_date, customer_number, customer_name, reference, invoice_total::float AS invoice_total, revenue::float AS revenue
         FROM sales_order_detail WHERE customer_number = ANY($1::text[]) AND finish_date <> '' ORDER BY finish_date DESC, invoice LIMIT $2`, [codes, limit]),
    q(`SELECT s.invoice, s.serial, s.model, s.finish_date, s.start_date, s.selling_price::float AS selling_price, s.discount::float AS discount, s.returned, s.new_used,
              COALESCE(m.brand, m.brand_code, '') AS brand, COALESCE(m.description, '') AS description, COALESCE(m.product_code, '') AS product_code
         FROM epass_sold_serials s LEFT JOIN epass_model_master m ON m.model = s.model
        WHERE s.customer_number = ANY($1::text[]) ORDER BY s.finish_date DESC, s.invoice, s.serial LIMIT $2`, [codes, limit * 3]),
    q(`SELECT invoice, base_invoice, salesperson, customer_name, customer_number, start_date, invoice_total::float AS invoice_total, department
         FROM open_sales_orders WHERE customer_number = ANY($1::text[]) ORDER BY start_date DESC LIMIT $2`, [codes, limit])
  ]);
  return {
    code: c, customer, familyCodes: codes,
    finished: finished.map((r) => ({ invoice: r.invoice, department: r.department, salesperson: r.salesperson, finishDate: r.finish_date, customerNumber: r.customer_number, customerName: r.customer_name, reference: r.reference, total: r.invoice_total, revenue: r.revenue })),
    units: units.map((r) => ({ invoice: r.invoice, serial: r.serial, model: r.model, brand: r.brand, description: r.description, productCode: r.product_code, finishDate: r.finish_date, startDate: r.start_date, price: r.selling_price, discount: r.discount, net: Math.round((r.selling_price + r.discount) * 100) / 100, returned: r.returned, newUsed: r.new_used })),
    open: open.map((r) => ({ invoice: r.invoice, baseInvoice: r.base_invoice, salesperson: r.salesperson, customerName: r.customer_name, customerNumber: r.customer_number, startDate: r.start_date, total: r.invoice_total, department: r.department }))
  };
}
