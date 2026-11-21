// F12: Bill-wise profit — one row per sale invoice, valued like the P&L (as sold, after discounts).
import SalesInvoice from "../model/SalesInvoice.js";
import { requireUser, canSeeLoc } from "../utils/userScope.js";
import { storeFilter, dateRange, allOf } from "../utils/reportScope.js";
import { loadValuedSales, loadValuedInvoice, RETURN_MATCH } from "../utils/salesData.js";
import { profitStatus } from "../utils/profit.js";
import { round2 } from "../utils/retailMath.js";
import { reportPeriod } from "./ProfitLossController.js";

const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

const STATUSES = ["Profit", "Loss", "Break even"];

// GET /api/profit-reports/bills?userId=&fromDate=&toDate=&locCode=&salesperson=&status=&search=
export const billWiseProfit = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = await reportPeriod(who, req.query, res);
    if (!p) return;
    const status = STATUSES.includes(req.query.status) ? req.query.status : "";
    const search = String(req.query.search || "").trim().toLowerCase();

    const [{ sales }, salespeople] = await Promise.all([
      loadValuedSales(who, { ...p, salesperson: req.query.salesperson || "" }),
      SalesInvoice.distinct("salesperson", allOf(storeFilter(who, p), dateRange("invoiceDate", p.fromDate, p.toDate), { $nor: [RETURN_MATCH] })),
    ]);
    let rows = sales.map(({ inv, v }) => ({
      _id: inv._id, date: inv.invoiceDate, invoiceNumber: inv.invoiceNumber, customer: inv.customer || "", customerPhone: inv.customerPhone || "",
      salesperson: inv.salesperson || "", store: inv.locCode || inv.warehouse || inv.branch || "", items: v.lines.length, qty: v.qty,
      selling: v.taxable, cost: v.cost, profit: v.profit, marginPct: v.marginPct, status: profitStatus(v.profit),
      returnStatus: String(inv.returnStatus || "none").toLowerCase(), rebuilt: v.rebuilt, fallbackLines: v.fallbackLines, noCostLines: v.noCostLines,
    }));
    if (status) rows = rows.filter((r) => r.status === status);
    if (search) rows = rows.filter((r) => [r.invoiceNumber, r.customer, r.customerPhone].some((x) => String(x).toLowerCase().includes(search)));
    rows.sort((a, b) => new Date(b.date) - new Date(a.date) || String(b.invoiceNumber).localeCompare(String(a.invoiceNumber)));

    const sum = (k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    const totals = { invoices: rows.length, items: sum("items"), qty: sum("qty"), selling: sum("selling"), cost: sum("cost"), profit: sum("profit") };
    totals.marginPct = totals.selling > 0 ? round2((totals.profit / totals.selling) * 100) : 0;
    totals.byStatus = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
    res.json({
      fromDate: p.fromDate, toDate: p.toDate, store: p.storeLabel, rows, totals,
      salespeople: salespeople.filter((s) => s && String(s).trim()).map(String).sort((a, b) => a.localeCompare(b)),
    });
  } catch (err) { serverError(res, err, "Bill-wise profit"); }
};

// GET /api/profit-reports/bills/:id?userId= — per-line selling, cost and profit of one invoice
export const billProfitDetail = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const found = await loadValuedInvoice(req.params.id);
    if (!found) return res.status(404).json({ message: "Invoice not found" });
    if (!canSeeLoc(who.scope, found.inv.locCode)) return res.status(403).json({ message: "This invoice belongs to another store." });
    const { inv, v } = found;
    res.json({
      _id: inv._id, invoiceNumber: inv.invoiceNumber, date: inv.invoiceDate, customer: inv.customer, isReturn: found.isReturn,
      rebuilt: !!v.rebuilt, returns: (found.returns || []).map((r) => ({ _id: r._id, invoiceNumber: r.invoiceNumber, date: r.invoiceDate })),
      lines: v.lines.map((l) => ({ ...l, marginPct: l.taxable > 0 ? round2((l.profit / l.taxable) * 100) : 0, status: profitStatus(l.profit) })),
      totals: { gross: v.gross, discount: v.discount, selling: v.taxable, tax: v.tax, cost: v.cost, profit: v.profit, marginPct: v.marginPct, status: profitStatus(v.profit) },
    });
  } catch (err) { serverError(res, err, "Bill profit detail"); }
};
