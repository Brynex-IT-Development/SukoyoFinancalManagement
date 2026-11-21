import Bill from "../model/Bill.js";
import VendorPayment from "../model/VendorPayment.js";
import VendorCredit from "../model/VendorCredit.js";
import { requireUser } from "../utils/userScope.js";
import { round2 } from "../utils/retailMath.js";
import { withPaymentInfo, outstandingByVendor, agingByVendor, buildStatement, AGING_BUCKETS } from "../utils/payables.js";
import { PAYABLE_STATUS_FILTER, vendorKeyOf, findVendor } from "../utils/billPayments.js";
import { istDateString } from "../utils/ist.js";
import { escapeRegex, dayStart, dayEnd, storeFilter } from "../utils/reportScope.js";

const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};
/** Filter for "this vendor": vendorKey from a report row (id:<vendorId> or name:<lower name>). */
const vendorFilterFromKey = (key) => {
  if (!key) return {};
  if (key.startsWith("id:")) return { vendorId: key.slice(3) };
  if (key.startsWith("name:")) return { vendorId: { $in: [null, ""] }, vendorName: { $regex: `^${escapeRegex(key.slice(5))}$`, $options: "i" } };
  return { vendorId: key };
};

const loadBills = async (who, q, extra = {}) => {
  const filter = { ...PAYABLE_STATUS_FILTER, ...storeFilter(who, q), ...vendorFilterFromKey(q.vendorKey || (q.vendorId ? `id:${q.vendorId}` : "")), ...extra };
  if (q.fromDate || q.toDate) {
    filter.billDate = {};
    if (q.fromDate) filter.billDate.$gte = dayStart(q.fromDate);
    if (q.toDate) filter.billDate.$lte = dayEnd(q.toDate);
  }
  const bills = await Bill.find(filter)
    .select("billNumber billDate dueDate finalTotal amountPaid creditsApplied status vendorId vendorName warehouse branch locCode")
    .sort({ billDate: 1 }).lean();
  return bills.map((b) => ({ ...b, vendorKey: vendorKeyOf(b) }));
};

export const vendorOptions = (bills) => {
  const m = new Map();
  for (const b of bills) if (!m.has(b.vendorKey)) m.set(b.vendorKey, { vendorKey: b.vendorKey, vendorId: b.vendorId || null, vendorName: b.vendorName });
  return [...m.values()].sort((a, b) => String(a.vendorName).localeCompare(String(b.vendorName)));
};

// GET /api/vendor-reports/outstanding?userId=&vendorKey=&locCode=&warehouse=&fromDate=&toDate=&show=all|outstanding|paid
export const vendorOutstanding = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const bills = await loadBills(who, req.query);
    let rows = outstandingByVendor(bills);
    if (req.query.show === "outstanding") rows = rows.filter((r) => r.outstanding > 0.004);
    if (req.query.show === "paid") rows = rows.filter((r) => r.outstanding <= 0.004);
    const sum = (k) => round2(rows.reduce((s, r) => s + (r[k] || 0), 0));
    const totals = { billCount: rows.reduce((s, r) => s + r.billCount, 0), billed: sum("billed"), paid: sum("paid"), creditsApplied: sum("creditsApplied"), outstanding: sum("outstanding") };
    totals.percentPaid = totals.billed > 0 ? round2((totals.paid / totals.billed) * 100) : 0;
    res.json({ rows, totals, vendors: vendorOptions(await loadBills(who, { ...req.query, vendorKey: "", vendorId: "" })) });
  } catch (err) { serverError(res, err, "Vendor outstanding"); }
};

// GET /api/vendor-reports/vendor-bills?userId=&vendorKey=&... — one vendor's bills (drill-down)
export const vendorBills = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    if (!req.query.vendorKey && !req.query.vendorId) return res.status(400).json({ message: "Choose a vendor." });
    const bills = await loadBills(who, req.query);
    res.json({ bills: bills.map((b) => withPaymentInfo(b)).reverse() });
  } catch (err) { serverError(res, err, "Vendor bills"); }
};

// GET /api/vendor-reports/aging?userId=&vendorKey=&locCode=&warehouse=&fromDate=&toDate=  (as of today, IST)
export const vendorAging = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const bills = await loadBills(who, req.query);
    const { rows, totals } = agingByVendor(bills, new Date());
    res.json({ asOf: istDateString(new Date()), buckets: AGING_BUCKETS, rows, totals, vendors: vendorOptions(bills) });
  } catch (err) { serverError(res, err, "Vendor aging"); }
};

/**
 * GET /api/vendor-reports/statement?userId=&vendorKey=&fromDate=&toDate=&locCode=&warehouse=
 * Bills = debit, payments and vendor credits = credit; opening balance from everything before fromDate.
 * Default range: start of this month (IST) to today.
 */
export const vendorStatement = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const vendorKey = req.query.vendorKey || (req.query.vendorId ? `id:${req.query.vendorId}` : "");
    if (!vendorKey) return res.status(400).json({ message: "Choose a vendor." });
    const today = istDateString(new Date());
    const fromDate = req.query.fromDate || `${today.slice(0, 8)}01`;
    const toDate = req.query.toDate || today;
    if (fromDate > toDate) return res.status(400).json({ message: "From date is after the to date." });

    const vf = vendorFilterFromKey(vendorKey);
    const scope = storeFilter(who, req.query);
    const end = dayEnd(toDate);
    const [bills, credits] = await Promise.all([
      Bill.find({ ...PAYABLE_STATUS_FILTER, ...vf, ...scope, billDate: { $lte: end } }).select("billNumber billDate finalTotal vendorId vendorName").lean(),
      VendorCredit.find({ status: { $nin: ["draft", "cancelled", "void"] }, ...vf, ...scope, creditDate: { $lte: end } }).select("creditNoteNumber creditDate finalTotal").lean(),
    ]);
    // Payments carry the vendorId only (name-only vendors have none)
    const payments = vendorKey.startsWith("id:")
      ? await VendorPayment.find({ vendorId: vendorKey.slice(3), ...storeFilter(who, req.query, { withWarehouse: false }), date: { $lte: end } }).select("number date amount mode reference").lean()
      : [];
    const statement = buildStatement({ bills, payments, credits, from: dayStart(fromDate), to: end });

    let vendorName = bills[0]?.vendorName || "";
    let gstin = "";
    if (vendorKey.startsWith("id:")) {
      const v = await findVendor(vendorKey.slice(3));
      if (v) { vendorName = v.displayName || v.companyName || vendorName; gstin = v.gstin || ""; }
    } else if (!vendorName) vendorName = vendorKey.slice(5);
    res.json({ vendorKey, vendorName, gstin, fromDate, toDate, ...statement });
  } catch (err) { serverError(res, err, "Vendor statement"); }
};
