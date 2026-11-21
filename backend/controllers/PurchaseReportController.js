// F13: Purchase reports — purchase summary, item purchases by vendor, GST purchase register.
import Bill from "../model/Bill.js";
import Vendor from "../model/Vendor.js";
import mongoose from "mongoose";
import { requireUser } from "../utils/userScope.js";
import { storeFilter, dateRange, allOf } from "../utils/reportScope.js";
import { PAYABLE_STATUS_FILTER, vendorKeyOf } from "../utils/billPayments.js";
import { withPaymentInfo } from "../utils/payables.js";
import { documentTax, purchaseRegisterRows, itemPurchasesByVendor } from "../utils/profit.js";
import { round2 } from "../utils/retailMath.js";
import { vendorOptions } from "./VendorReportController.js";
import { reportPeriod } from "./ProfitLossController.js";

const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

const BILL_FIELDS = "billNumber billDate dueDate finalTotal subTotal totalTax totalTaxAmount amountPaid creditsApplied status vendorId vendorName warehouse branch locCode "
  + "items.itemId items.itemGroupId items.itemName items.sku items.itemSku items.quantity items.rate items.amount items.baseAmount items.lineTaxTotal "
  + "items.cgstAmount items.sgstAmount items.igstAmount items.taxPercent items.taxCode items.tax";

/** Payable bills in the period/store/vendor, oldest first, each with vendorKey. Vendor list ignores the vendor filter. */
const loadPeriodBills = async (who, p, vendorKey) => {
  const base = allOf(PAYABLE_STATUS_FILTER, storeFilter(who, p), dateRange("billDate", p.fromDate, p.toDate));
  const all = (await Bill.find(base).select(BILL_FIELDS).sort({ billDate: 1, billNumber: 1 }).lean()).map((b) => ({ ...b, vendorKey: vendorKeyOf(b) }));
  const bills = vendorKey ? all.filter((b) => b.vendorKey === vendorKey) : all;
  return { bills, vendors: vendorOptions(all) };
};

// GET /api/purchase-reports/summary?userId=&fromDate=&toDate=&locCode=&vendorKey=
export const purchaseSummary = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = await reportPeriod(who, req.query, res);
    if (!p) return;
    const { bills, vendors } = await loadPeriodBills(who, p, req.query.vendorKey);
    const rows = bills.map((b) => {
      const info = withPaymentInfo(b);
      return {
        _id: b._id, date: b.billDate, billNumber: b.billNumber, vendorName: b.vendorName, vendorKey: b.vendorKey, store: b.locCode || b.warehouse || "",
        items: (b.items || []).length, qty: round2((b.items || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0)),
        subTotal: round2(Number(b.subTotal) || 0), tax: documentTax(b), total: round2(Number(b.finalTotal) || 0),
        paid: round2(info.amountPaid), credits: round2(info.creditsApplied), balance: info.balanceDue, paymentStatus: info.paymentStatus,
      };
    });
    const sum = (k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    res.json({
      fromDate: p.fromDate, toDate: p.toDate, store: p.storeLabel, vendors, rows,
      totals: { bills: rows.length, items: sum("items"), qty: sum("qty"), subTotal: sum("subTotal"), tax: sum("tax"), total: sum("total"), paid: sum("paid"), credits: sum("credits"), balance: sum("balance") },
    });
  } catch (err) { serverError(res, err, "Purchase summary"); }
};

// GET /api/purchase-reports/items-by-vendor?userId=&fromDate=&toDate=&locCode=&vendorKey=&search=
export const purchasesByItemVendor = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = await reportPeriod(who, req.query, res);
    if (!p) return;
    const { bills, vendors } = await loadPeriodBills(who, p, req.query.vendorKey);
    const search = String(req.query.search || "").trim().toLowerCase();
    let rows = itemPurchasesByVendor(bills);
    if (search) rows = rows.filter((r) => `${r.itemName} ${r.sku}`.toLowerCase().includes(search));
    const sum = (k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    res.json({ fromDate: p.fromDate, toDate: p.toDate, store: p.storeLabel, vendors, rows, totals: { rows: rows.length, qty: sum("qty"), value: sum("value"), taxable: sum("taxable") } });
  } catch (err) { serverError(res, err, "Item purchases by vendor"); }
};

// GET /api/purchase-reports/gst-register?userId=&fromDate=&toDate=&locCode=&vendorKey=&rate=
// Bills from vendors with a GSTIN, one row per bill per tax rate, from the lines' stored CGST/SGST/IGST.
export const gstPurchaseRegister = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = await reportPeriod(who, req.query, res);
    if (!p) return;
    const { bills, vendors } = await loadPeriodBills(who, p, req.query.vendorKey);
    const ids = [...new Set(bills.map((b) => String(b.vendorId || "")).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    const gstinOf = new Map((await Vendor.find({ _id: { $in: ids } }).select("gstin").lean()).map((v) => [String(v._id), String(v.gstin || "").trim().toUpperCase()]));
    const withGstin = bills.map((b) => ({ ...b, vendorGstin: gstinOf.get(String(b.vendorId || "")) || "" }));
    const allRows = purchaseRegisterRows(withGstin);
    const rates = [...new Set(allRows.map((r) => r.rate))].sort((a, b) => (a ?? 999) - (b ?? 999));
    const rate = req.query.rate;
    const rows = rate === undefined || rate === "" ? allRows : allRows.filter((r) => String(r.rate) === String(rate) || (rate === "unknown" && r.rate === null));
    const sum = (k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    res.json({
      fromDate: p.fromDate, toDate: p.toDate, store: p.storeLabel, vendors, rates, rows,
      skippedNoGstin: withGstin.filter((b) => !b.vendorGstin).length,
      totals: { rows: rows.length, taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), cess: 0, total: sum("total") },
    });
  } catch (err) { serverError(res, err, "GST purchase register"); }
};
