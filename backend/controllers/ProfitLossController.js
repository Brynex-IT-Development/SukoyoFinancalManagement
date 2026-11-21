// F11: Profit & loss.
import Transaction from "../model/Transaction.js";
import Bill from "../model/Bill.js";
import VendorCredit from "../model/VendorCredit.js";
import { requireUser, canSeeLoc } from "../utils/userScope.js";
import { storeFilter, dateRange, allOf } from "../utils/reportScope.js";
import { loadValuedSales } from "../utils/salesData.js";
import { buildProfitAndLoss, isRecordedExpense, isOtherIncome } from "../utils/profit.js";
import { PAYABLE_STATUS_FILTER } from "../utils/billPayments.js";
import { warehousesFor, loadStockRows, stockValueOf } from "../utils/stockRows.js";
import { getStockOnHandReport } from "./InventoryReportController.js";
import { istDateString } from "../utils/ist.js";
import { round2 } from "../utils/retailMath.js";

const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

/** Period from the query (default: this month so far, IST) with the store checked against the user's scope. */
export const reportPeriod = async (who, q, res) => {
  const today = istDateString();
  const fromDate = q.fromDate || `${today.slice(0, 8)}01`;
  const toDate = q.toDate || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) { res.status(400).json({ message: "Dates must be YYYY-MM-DD." }); return null; }
  if (fromDate > toDate) { res.status(400).json({ message: "From date is after the to date." }); return null; }
  if (q.locCode && !canSeeLoc(who.scope, q.locCode)) { res.status(403).json({ message: "That store is outside your access." }); return null; }
  const wh = await warehousesFor(who, q);
  // The store's own name (from the Store record) lets older documents without a locCode match by warehouse
  return { fromDate, toDate, locCode: q.locCode || "", warehouse: q.locCode ? wh.names?.[0] || "" : "", storeLabel: wh.label, warehouses: wh.names };
};

const CREDIT_STATUS = { status: { $nin: ["draft", "Draft", "cancelled", "Cancelled", "void"] } };

// GET /api/profit-reports/pnl?userId=&fromDate=&toDate=&locCode=
export const profitAndLoss = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = await reportPeriod(who, req.query, res);
    if (!p) return;
    const [{ sales, returns }, txs, bills, credits] = await Promise.all([
      loadValuedSales(who, p),
      Transaction.find(allOf(storeFilter(who, p, { withWarehouse: false }), dateRange("date", p.fromDate, p.toDate), { type: { $regex: "^(expense|income)$", $options: "i" } }))
        .select("type category subCategory remark amount invoiceNo date locCode").lean(),
      Bill.find(allOf(PAYABLE_STATUS_FILTER, storeFilter(who, p), dateRange("billDate", p.fromDate, p.toDate)))
        .select("finalTotal totalTax totalTaxAmount items.cgstAmount items.sgstAmount items.igstAmount").lean(),
      VendorCredit.find(allOf(CREDIT_STATUS, storeFilter(who, p), dateRange("creditDate", p.fromDate, p.toDate)))
        .select("finalTotal totalTax totalTaxAmount items.cgstAmount items.sgstAmount items.igstAmount").lean(),
    ]);
    const pl = buildProfitAndLoss({
      sales: sales.map((s) => s.v), returns: returns.map((r) => r.v),
      expenses: txs.filter(isRecordedExpense), income: txs.filter(isOtherIncome), bills, credits,
    });
    res.json({ fromDate: p.fromDate, toDate: p.toDate, store: p.storeLabel, ...pl });
  } catch (err) { serverError(res, err, "Profit and loss"); }
};

/** Run an existing report handler in-process and return its JSON body (null on failure). */
const runHandler = (handler, query) => new Promise((resolve) => {
  const res = { status() { return this; }, json(body) { resolve(body); } };
  Promise.resolve(handler({ query, body: {} }, res)).catch(() => resolve(null));
});

// GET /api/profit-reports/pnl/stock?userId=&fromDate=&toDate=&locCode=
// Current stock value (stockOnHand × costPrice). Opening and closing values come from the Stock On Hand
// report (stock rebuilt from movements, valued at current cost) for all stores or one store.
export const profitStock = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = await reportPeriod(who, req.query, res);
    if (!p) return;
    const current = stockValueOf(await loadStockRows(p.warehouses));
    let opening = null, closing = null;
    if (p.locCode || who.scope.all) {
      const query = p.locCode
        ? { locCode: String(p.locCode), warehouse: p.warehouse || undefined, startDate: p.fromDate, endDate: p.toDate }
        : { locCode: "858", startDate: p.fromDate, endDate: p.toDate }; // the report's "all stores" mode
      const body = await runHandler(getStockOnHandReport, query);
      const items = body?.success ? body.data?.itemDetails || [] : null;
      if (items) {
        opening = round2(items.reduce((s, i) => s + (Number(i.openingStock) || 0) * (Number(i.costPrice) || 0), 0));
        closing = round2(items.reduce((s, i) => s + (Number(i.closingStock) || 0) * (Number(i.costPrice) || 0), 0));
      }
    }
    res.json({ store: p.storeLabel, current, opening, closing, fromDate: p.fromDate, toDate: p.toDate });
  } catch (err) { serverError(res, err, "Profit and loss stock"); }
};
