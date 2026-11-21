// Profit, P&L, purchase-register and stock-health formulas (Phase 5). Pure: no database access.
//
// How Sukoyo stores a sale (SalesInvoiceCreate.jsx):
//  - line.rate is the TAX-INCLUSIVE unit price; qty × rate is the line's inclusive price
//  - line.amount is the line's base (ex-tax) amount before the invoice discount
//  - subTotal = Σ qty × rate; discountAmount comes off that inclusive subtotal
//  - finalTotal = subTotal − discountAmount − TDS + adjustment
//  - redemptions (points, store credit, gift card, voucher) are applied AFTER finalTotal and do not
//    change it (spec section 4), so they are payments here, not discounts
// Taxable value after discount = each line's share of the sale value, with the tax taken out at
// the line's GST rate (the same proportional split as the business GST invoice, utils/gst.js).
//
// Returns: a return is its own invoice (category Return / RTN-), AND the return screen trims the
// original invoice (lower quantities, or no lines for a full return). Counting the trimmed original
// and subtracting the return would subtract it twice, so a trimmed sale is first rebuilt as it was
// sold (returned quantities added back), and returns are subtracted in the period they happened.
import { round2 } from "./retailMath.js";
import { parseTaxRate } from "./gst.js";

const num = (v) => Number(v) || 0;
const lower = (v) => String(v ?? "").toLowerCase().trim();

// ─── Invoice kinds ──────────────────────────────────────────────────────────

const RETURN_CATEGORIES = ["return", "refund", "cancel"];

/** Return / refund / cancel invoices (they put stock back), by category or RTN-/RET- number. */
export const isReturnInvoice = (inv) =>
  RETURN_CATEGORIES.includes(lower(inv?.category)) || /^(RTN|RET)[-_]?/i.test(String(inv?.invoiceNumber || ""));

/** Drafts and cancelled/void invoices are left out of every report. */
export const isCountableInvoice = (inv) => {
  const s = lower(inv?.status);
  return s !== "draft" && !s.includes("cancel") && !s.includes("void");
};

/** True when the return screen has trimmed this sale (partial or full return recorded on it). */
export const isTrimmedSale = (inv) => ["partial", "full"].includes(lower(inv?.returnStatus));

/** Key the return screen uses to match a returned line to the sale line. */
export const lineKey = (line) => String(line?.itemData?._id || line?.itemData?.id || line?.item || "");

// ─── Line tax rate ──────────────────────────────────────────────────────────

/**
 * GST rate (%) of a sale line, in the billing screen's order: the item's own rate from the line's
 * itemData snapshot, then the line's tax choice ("gst5", "GST 5%"). null when neither is known.
 */
export const lineTaxRate = (line) => {
  const d = line?.itemData || {};
  const own = parseTaxRate(d.taxRateIntra) ?? parseTaxRate(d.taxRateInter);
  if (own !== null && own !== undefined) return own;
  const t = String(line?.tax ?? "").trim();
  if (/gst/i.test(t)) {
    const r = parseTaxRate(t);
    if (r !== null) return r;
  }
  return null;
};

/**
 * Share of the line's inclusive price that is taxable value: 1 / (1 + rate). When the rate is not
 * known, the billing screen's own base amount is used (line.amount < qty × rate), then the invoice's
 * average (1 − totalTax / subTotal), else no tax.
 * rateHint: rate taken from the sale line (used for return lines, which carry no tax choice).
 */
export const taxableShare = (line, rateHint = null, invoiceShare = null) => {
  const r = lineTaxRate(line) ?? rateHint;
  if (r !== null && r !== undefined) return 1 / (1 + num(r) / 100);
  const qty = num(line?._amountQty ?? line?.quantity);
  const gross = Math.abs(qty * num(line?.rate));
  const amount = Math.abs(num(line?.amount));
  if (gross > 0 && amount > 0 && amount < gross - 0.005) return amount / gross;
  if (invoiceShare !== null && invoiceShare > 0 && invoiceShare <= 1) return invoiceShare;
  return 1;
};

/**
 * Taxable share of an invoice on average: 1 − totalTax / subTotal (both before the invoice discount).
 * The return screen rescales both by the same ratio when it trims a sale, so the share survives.
 */
export const invoiceTaxableShare = (inv) => {
  const sub = Math.abs(num(inv?.subTotal)), tax = Math.abs(num(inv?.totalTax));
  return sub > 0 && tax > 0 && tax < sub ? 1 - tax / sub : null;
};

/** GST rate (%) a sale line was billed at: its own rate, else from its base amount, else the invoice average. */
export const billedRate = (line, inv = null) => {
  const r = lineTaxRate(line);
  if (r !== null && r !== undefined) return r;
  const share = taxableShare(line, null, inv ? invoiceTaxableShare(inv) : null);
  return share < 1 ? (1 / share - 1) * 100 : null;
};

/**
 * rateHint(line) for a return: the rate of the matching line on its original sale, else the
 * original's invoice average (a full return empties the sale's lines).
 */
export const returnRateHint = (orig) => (line) => {
  if (!orig) return null;
  const src = (orig.lineItems || []).find((l) => lineKey(l) === lineKey(line));
  if (src) return billedRate(src, orig);
  const share = invoiceTaxableShare(orig);
  return share ? (1 / share - 1) * 100 : null;
};

// ─── Rebuild a trimmed sale ─────────────────────────────────────────────────

/**
 * Lines of a sale as it was sold. For a sale the return screen trimmed, the quantities of its
 * returns are added back (a fully returned line is re-added from the return line).
 * returns: return invoices of this sale (any date).
 */
export const saleLinesAsSold = (inv, returns = []) => {
  const lines = (inv?.lineItems || []).map((l) => ({ ...l, _amountQty: num(l.quantity) }));
  if (!isTrimmedSale(inv) || !returns.length) return { lines, rebuilt: false };
  let rebuilt = false;
  for (const ret of returns) {
    for (const rl of ret?.lineItems || []) {
      const q = Math.abs(num(rl.quantity));
      if (!q) continue;
      const target = lines.find((l) => lineKey(l) === lineKey(rl));
      if (target) target.quantity = num(target.quantity) + q;
      else lines.push({ ...rl, quantity: q, amount: undefined, _amountQty: 0 });
      rebuilt = true;
    }
  }
  return { lines, rebuilt };
};

// ─── Value an invoice ───────────────────────────────────────────────────────

/** What the goods were sold for, tax included (bill total + TDS − round-off adjustment). */
export const saleValueOf = (inv) => Math.abs(num(inv?.finalTotal)) + num(inv?.tdsTcsAmount) - num(inv?.adjustmentAmount);

/**
 * Taxable value, tax, cost and profit of an invoice and each of its lines.
 * opts.lines       lines to value (default inv.lineItems) — pass saleLinesAsSold(...).lines for a sale
 * opts.saleValue   inclusive value the lines were sold for (default saleValueOf(inv))
 * opts.fallbackCost(line) → current item cost or null, for lines without a costPrice snapshot
 * opts.rateHint(line) → GST rate from the matching sale line (for return lines), or null
 * opts.storedBreakup  { taxable, tax } of a business invoice, used for the totals when given
 */
export const valueInvoice = (inv, opts = {}) => {
  const src = opts.lines || inv?.lineItems || [];
  const rows = src.map((l) => {
    const qty = Math.abs(num(l.quantity));
    const unit = num(l.rate);
    let gross = qty * unit;
    if (!(gross > 0)) gross = Math.abs(num(l.amount)); // free-text line without a rate
    return { line: l, qty, gross };
  }).filter((r) => r.gross > 0 || r.qty > 0);

  const grossTotal = rows.reduce((s, r) => s + r.gross, 0);
  const wanted = opts.saleValue ?? saleValueOf(inv);
  const saleValue = Math.max(0, Math.min(num(wanted), grossTotal));
  const discount = grossTotal - saleValue;

  let fallbackLines = 0, noCostLines = 0;
  const invShare = invoiceTaxableShare(inv);
  const lines = rows.map(({ line, qty, gross }) => {
    const share = grossTotal > 0 ? discount * gross / grossTotal : 0;
    const net = gross - share;
    const taxable = net * taxableShare(line, opts.rateHint ? opts.rateHint(line) : null, invShare);
    let unitCost = line.costPrice;
    let costSource = "snapshot";
    if (unitCost === undefined || unitCost === null || unitCost === "") {
      const fb = opts.fallbackCost ? opts.fallbackCost(line) : null;
      if (fb !== null && fb !== undefined) { unitCost = fb; costSource = "fallback"; fallbackLines++; }
      else { unitCost = 0; costSource = "none"; noCostLines++; }
    }
    const cost = qty * num(unitCost);
    return {
      name: line.item || line.itemData?.itemName || line.itemData?.name || "",
      sku: line.itemSku || line.itemData?.sku || "",
      key: lineKey(line), itemId: String(line.itemData?._id || line.itemData?.id || ""), itemGroupId: String(line.itemGroupId || line.itemData?.itemGroupId || ""),
      qty, unitRate: num(line.rate), gross, discount: share, taxable, tax: net - taxable, unitCost: num(unitCost), cost, costSource,
    };
  });

  // A business invoice keeps its own GST breakup: scale the lines to its taxable total
  if (opts.storedBreakup && num(opts.storedBreakup.taxable) > 0) {
    const sumTaxable = lines.reduce((s, l) => s + l.taxable, 0);
    if (sumTaxable > 0) {
      const f = num(opts.storedBreakup.taxable) / sumTaxable;
      for (const l of lines) { const net = l.gross - l.discount; l.taxable *= f; l.tax = net - l.taxable; }
    }
  }

  const sum = (k) => lines.reduce((s, l) => s + l[k], 0);
  const out = {
    lines: lines.map((l) => ({ ...l, gross: round2(l.gross), discount: round2(l.discount), taxable: round2(l.taxable), tax: round2(l.tax), cost: round2(l.cost), profit: round2(l.taxable - l.cost) })),
    qty: sum("qty"), gross: round2(grossTotal), discount: round2(discount), taxable: round2(sum("taxable")), tax: round2(sum("tax")), cost: round2(sum("cost")),
    fallbackLines, noCostLines,
  };
  out.profit = round2(sum("taxable") - sum("cost"));
  out.marginPct = out.taxable > 0 ? round2((out.profit / out.taxable) * 100) : 0;
  return out;
};

/**
 * A sale as it was sold: a trimmed sale is rebuilt from its returns first. Its sale value is then
 * the rebuilt inclusive subtotal less the invoice discount (finalTotal was rescaled by the trim).
 * A business invoice that was not trimmed keeps its stored GST breakup.
 */
export const valueSale = (inv, returns = [], opts = {}) => {
  const { lines, rebuilt } = saleLinesAsSold(inv, returns);
  const gross = lines.reduce((s, l) => { const g = Math.abs(num(l.quantity) * num(l.rate)); return s + (g > 0 ? g : Math.abs(num(l.amount))); }, 0);
  const saleValue = rebuilt ? Math.max(0, gross - num(inv?.discountAmount)) : saleValueOf(inv);
  const storedBreakup = !isTrimmedSale(inv) && inv?.isB2B && num(inv?.taxBreakup?.taxable) > 0 ? inv.taxBreakup : null;
  return { ...valueInvoice(inv, { ...opts, lines, saleValue, storedBreakup }), rebuilt };
};

/** A return / credit note, valued from its own lines (a business credit note keeps its breakup). */
export const valueReturn = (ret, opts = {}) =>
  valueInvoice(ret, { ...opts, storedBreakup: ret?.isB2B && num(ret?.taxBreakup?.taxable) > 0 ? ret.taxBreakup : null });

/** Profit / Loss / Break even (within half a paisa). */
export const profitStatus = (profit) => (Math.abs(num(profit)) < 0.005 ? "Break even" : num(profit) > 0 ? "Profit" : "Loss");

// ─── Daybook: expenses and other income ─────────────────────────────────────

const TRANSFER = /bank to cash|cash to bank|bulk amount transfer/i;
const NOT_OTHER_INCOME = /^(gift card sale|gift card reload)$/i;   // money held for gift cards, not income
const NOT_EXPENSE = /^(vendor payment)$/i;                          // pays bills already counted as purchases

/** "direct" / "indirect" / "other" — Direct/Indirect Expenses tag the remark ("[DIRECT] …"). */
export const expenseGroup = (tx) => {
  const r = String(tx?.remark || "").trim().toUpperCase();
  if (r.startsWith("[DIRECT")) return "direct";
  if (r.startsWith("[INDIRECT")) return "indirect";
  return "other";
};

const isSystemDoc = (tx) => /^(INV|RTN|RET|SECURITY|TRANSFER)-/i.test(String(tx?.invoiceNo || ""));

/** Recorded expenses (type Expense), leaving out vendor payments, refunds and transfers. */
export const isRecordedExpense = (tx) =>
  lower(tx?.type) === "expense" && !NOT_EXPENSE.test(String(tx?.category || "").trim())
  && !TRANSFER.test(`${tx?.category || ""} ${tx?.subCategory || ""}`) && !isSystemDoc(tx);

/** Other income (type Income), leaving out gift card money, invoices and transfers. */
export const isOtherIncome = (tx) =>
  lower(tx?.type) === "income" && !NOT_OTHER_INCOME.test(String(tx?.category || "").trim())
  && !TRANSFER.test(`${tx?.category || ""} ${tx?.subCategory || ""}`) && !isSystemDoc(tx);

/** Amount of a daybook row as a positive number (expenses are stored as "-500"). */
export const txAmount = (tx) => Math.abs(num(tx?.amount));

// ─── Profit & loss ──────────────────────────────────────────────────────────

/**
 * Profit & loss for a period.
 * sales / returns: valueSale / valueReturn results; expenses / income: daybook rows already
 * filtered with isRecordedExpense / isOtherIncome; bills / credits: payable bills and open vendor credits.
 */
export const buildProfitAndLoss = ({ sales = [], returns = [], expenses = [], income = [], bills = [], credits = [] }) => {
  const sum = (arr, f) => arr.reduce((t, x) => t + num(typeof f === "function" ? f(x) : x[f]), 0);
  const salesTaxable = sum(sales, "taxable");
  const returnsTaxable = sum(returns, "taxable");
  const netSales = salesTaxable - returnsTaxable;
  const costSold = sum(sales, "cost");
  const costReturned = sum(returns, "cost");
  const cogs = costSold - costReturned;
  const grossProfit = netSales - cogs;

  const byCategory = (rows, withGroup) => {
    const m = new Map();
    for (const t of rows) {
      const group = withGroup ? expenseGroup(t) : null;
      const category = String(t.category || "Uncategorised").trim() || "Uncategorised";
      const key = `${group || ""}|${category.toLowerCase()}`;
      const r = m.get(key) || { ...(withGroup ? { group } : {}), category, amount: 0, count: 0 };
      r.amount += txAmount(t);
      r.count += 1;
      m.set(key, r);
    }
    return [...m.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.amount - a.amount);
  };
  const otherIncome = sum(income, txAmount);
  const expenseTotal = sum(expenses, txAmount);
  const expenseGroups = { direct: 0, indirect: 0, other: 0 };
  for (const t of expenses) expenseGroups[expenseGroup(t)] += txAmount(t);

  const billsTotal = sum(bills, "finalTotal");
  const creditsTotal = sum(credits, "finalTotal");
  const outputTax = sum(sales, "tax") - sum(returns, "tax");
  const inputTax = sum(bills, documentTax) - sum(credits, documentTax);

  return {
    salesTaxable: round2(salesTaxable), returnsTaxable: round2(returnsTaxable), netSales: round2(netSales),
    costSold: round2(costSold), costReturned: round2(costReturned), cogs: round2(cogs),
    grossProfit: round2(grossProfit), grossMarginPct: netSales > 0 ? round2((grossProfit / netSales) * 100) : 0,
    otherIncome: round2(otherIncome), incomeByCategory: byCategory(income, false),
    expenses: round2(expenseTotal), expenseGroups: { direct: round2(expenseGroups.direct), indirect: round2(expenseGroups.indirect), other: round2(expenseGroups.other) },
    expensesByCategory: byCategory(expenses, true),
    netProfit: round2(grossProfit + otherIncome - expenseTotal),
    purchases: { bills: round2(billsTotal), vendorCredits: round2(creditsTotal), net: round2(billsTotal - creditsTotal) },
    // Net GST payable = output tax − input tax (tax on purchases, never the purchase total)
    gst: { outputTax: round2(outputTax), inputTax: round2(inputTax), netPayable: round2(outputTax - inputTax) },
    notes: {
      saleInvoices: sales.length, returnInvoices: returns.length, rebuiltSales: sales.filter((s) => s.rebuilt).length,
      fallbackCostLines: sum(sales, "fallbackLines") + sum(returns, "fallbackLines"), noCostLines: sum(sales, "noCostLines") + sum(returns, "noCostLines"),
    },
  };
};

// ─── Bills ──────────────────────────────────────────────────────────────────

/** Taxable value of a bill line: the stored base amount (tax-inclusive cost price with the tax taken out). */
export const billLineTaxable = (l) => {
  const base = num(l?.baseAmount);
  if (base > 0) return base;
  const amt = num(l?.amount);
  if (amt > 0) return amt;
  return Math.max(0, num(l?.quantity) * num(l?.rate) - num(l?.lineTaxTotal));
};
export const billLineTax = (l) => num(l?.cgstAmount) + num(l?.sgstAmount) + num(l?.igstAmount);

/** Tax on a bill or vendor credit: the lines' stored CGST+SGST+IGST, else the stored total. */
export const documentTax = (doc) => {
  const lines = (doc?.items || []).reduce((s, l) => s + billLineTax(l), 0);
  return round2(lines > 0 ? lines : num(doc?.totalTax) || num(doc?.totalTaxAmount));
};

/** GST rate of a bill line: the stored taxPercent, else read from its tax code. */
export const billLineRate = (l) => {
  const p = num(l?.taxPercent);
  if (p > 0) return p;
  const fromCode = parseTaxRate(l?.taxCode) ?? parseTaxRate(l?.tax);
  if (fromCode !== null && /gst/i.test(`${l?.taxCode || ""} ${l?.tax || ""}`)) return fromCode;
  return billLineTax(l) > 0 ? null : 0;
};

/**
 * GST purchase register rows: one per bill per tax rate, from the lines' stored tax amounts.
 * bills: payable bills with vendorGstin set (others are left out).
 */
export const purchaseRegisterRows = (bills) => {
  const rows = [];
  for (const b of bills) {
    if (!b.vendorGstin) continue;
    const byRate = new Map();
    for (const l of b.items || []) {
      const rate = billLineRate(l);
      const key = rate === null ? "?" : String(rate);
      const g = byRate.get(key) || { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      g.taxable += billLineTaxable(l);
      g.cgst += num(l.cgstAmount); g.sgst += num(l.sgstAmount); g.igst += num(l.igstAmount);
      byRate.set(key, g);
    }
    for (const g of byRate.values()) {
      if (g.taxable <= 0 && g.cgst + g.sgst + g.igst <= 0) continue;
      rows.push({
        billId: b._id, date: b.billDate, vendorName: b.vendorName, vendorGstin: b.vendorGstin, billNumber: b.billNumber, rate: g.rate,
        taxable: round2(g.taxable), cgst: round2(g.cgst), sgst: round2(g.sgst), igst: round2(g.igst), cess: 0,
        total: round2(g.taxable + g.cgst + g.sgst + g.igst),
      });
    }
  }
  return rows.sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.billNumber).localeCompare(String(b.billNumber)) || (a.rate ?? 999) - (b.rate ?? 999));
};

/** Item × vendor purchase totals: qty, value as billed (tax incl.), taxable value, average rate. */
export const itemPurchasesByVendor = (bills) => {
  const m = new Map();
  for (const b of bills) {
    const vendorKey = b.vendorId ? `id:${b.vendorId}` : `name:${lower(b.vendorName)}`;
    for (const l of b.items || []) {
      const itemKey = l.itemId ? `i:${l.itemId}` : l.itemGroupId && (l.itemSku || l.sku) ? `g:${l.itemGroupId}:${l.itemSku || l.sku}` : `n:${lower(l.itemName)}`;
      const key = `${itemKey}|${vendorKey}`;
      const r = m.get(key) || { itemKey, vendorKey, itemName: l.itemName || "", sku: l.itemSku || l.sku || "", vendorName: b.vendorName, qty: 0, value: 0, taxable: 0, bills: new Set() };
      const qty = num(l.quantity);
      r.qty += qty;
      r.value += qty * num(l.rate); // as billed: the bill's rate is the tax-inclusive cost price
      r.taxable += billLineTaxable(l);
      r.bills.add(String(b._id));
      m.set(key, r);
    }
  }
  return [...m.values()].map((r) => ({
    itemKey: r.itemKey, vendorKey: r.vendorKey, itemName: r.itemName, sku: r.sku, vendorName: r.vendorName, bills: r.bills.size,
    qty: r.qty, value: round2(r.value), taxable: round2(r.taxable), averageRate: r.qty > 0 ? round2(r.value / r.qty) : 0,
  })).sort((a, b) => b.value - a.value);
};

// ─── Stock health ───────────────────────────────────────────────────────────

/** Whole IST days from `from` to `today` (0 when the same day). */
const IST_MS = 5.5 * 3600 * 1000;
export const istDaysBetween = (from, today = new Date()) => {
  const d = (x) => Math.floor((new Date(x).getTime() + IST_MS) / 86400000);
  return d(today) - d(from);
};

/**
 * Dead stock: rows with stock > 0 and no sale in the last `days` days (never sold counts as dead).
 * rows: [{ key, stock, ... }], lastSale: Map(key → Date)
 */
export const deadStock = (rows, lastSale, days, today = new Date()) => rows
  .filter((r) => r.stock > 0)
  .map((r) => {
    const last = lastSale.get(r.key) || null;
    return { ...r, lastSaleDate: last, daysSinceLastSale: last ? istDaysBetween(last, today) : null };
  })
  .filter((r) => r.lastSaleDate === null || r.daysSinceLastSale > days)
  .sort((a, b) => b.value - a.value);

/** Overstock: rows whose stock is above their maxStock (only rows with maxStock > 0). */
export const overstock = (rows) => rows
  .filter((r) => num(r.maxStock) > 0 && r.stock > num(r.maxStock))
  .map((r) => ({ ...r, excess: r.stock - num(r.maxStock), excessValue: round2((r.stock - num(r.maxStock)) * num(r.cost)) }))
  .sort((a, b) => b.excessValue - a.excessValue);

export const ABC_LIMITS = { A: 80, B: 95 };

/**
 * ABC classes by sales value, highest first: running cumulative share ≤ 80% → A, ≤ 95% → B,
 * rest → C (items with no sales are C). A manual abcOverride (A/B/C) replaces the computed class.
 * rows: [{ key, salesValue, abcOverride? }]
 */
export const abcClassify = (rows) => {
  const total = rows.reduce((s, r) => s + Math.max(0, num(r.salesValue)), 0);
  let running = 0;
  const ranked = [...rows].sort((a, b) => num(b.salesValue) - num(a.salesValue) || String(a.name || "").localeCompare(String(b.name || "")));
  const out = ranked.map((r, i) => {
    const v = Math.max(0, num(r.salesValue));
    running += v;
    const share = total > 0 ? (v / total) * 100 : 0;
    const cumulative = total > 0 ? (running / total) * 100 : 100;
    // 1e-9: 80.0000000001% from float sums still counts as 80%
    const computed = v <= 0 ? "C" : cumulative <= ABC_LIMITS.A + 1e-9 ? "A" : cumulative <= ABC_LIMITS.B + 1e-9 ? "B" : "C";
    const override = ["A", "B", "C"].includes(String(r.abcOverride || "").toUpperCase()) ? String(r.abcOverride).toUpperCase() : "";
    return { ...r, rank: i + 1, salesValue: round2(v), share: round2(share), cumulative: round2(cumulative), computedClass: computed, abcClass: override || computed };
  });
  const summary = ["A", "B", "C"].map((c) => {
    const items = out.filter((r) => r.abcClass === c);
    const value = items.reduce((s, r) => s + r.salesValue, 0);
    return { abcClass: c, items: items.length, value: round2(value), share: total > 0 ? round2((value / total) * 100) : 0 };
  });
  return { rows: out, summary, total: round2(total) };
};
