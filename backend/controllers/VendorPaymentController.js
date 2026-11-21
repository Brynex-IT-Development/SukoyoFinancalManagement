import mongoose from "mongoose";
import VendorPayment from "../model/VendorPayment.js";
import Bill from "../model/Bill.js";
import { requireUser, locFilter, canSeeLoc } from "../utils/userScope.js";
import { round2 } from "../utils/retailMath.js";
import { withPaymentInfo, billBalance, isPayableBill } from "../utils/payables.js";
import { addToBill, removeFromBill, findVendor, vendorDocFilter, toId, PAYABLE_STATUS_FILTER } from "../utils/billPayments.js";
import { nextNumber } from "../utils/nextNumber.js";
import { postMoneyOut, removeMoneyIn } from "../utils/daybook.js";
import { HttpError, UndoStack } from "../utils/redemptions.js";
import { istDayStart, istDayEnd } from "../utils/ist.js";
import Transaction from "../model/Transaction.js";

const MODES = ["cash", "bank", "upi", "cheque"];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  console.error(`${label} error:`, err);
  return res.status(500).json({ message: "Server error", error: err.message });
};
const by = (who) => who.user.email || who.user.username || "";
const dayRange = (fromDate, toDate) => {
  const r = {};
  if (fromDate) r.$gte = istDayStart(new Date(`${fromDate}T12:00:00+05:30`));
  if (toDate) r.$lte = istDayEnd(new Date(`${toDate}T12:00:00+05:30`));
  return Object.keys(r).length ? r : null;
};

/** Vendor name for a vendorId: the Vendor record, else the name on the vendor's bills. */
const vendorNameFor = async (vendorId, fallback = "") => {
  const v = await findVendor(vendorId);
  if (v) return v.displayName || v.companyName || fallback;
  const b = await Bill.findOne({ vendorId: String(vendorId) }).select("vendorName").lean();
  return b?.vendorName || fallback;
};

// GET /api/vendor-payments?userId=&vendorId=&mode=&search=&fromDate=&toDate=
export const listVendorPayments = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { vendorId, mode, search = "", fromDate, toDate } = req.query;
    const q = { ...locFilter(who.scope) };
    if (vendorId) q.vendorId = String(vendorId);
    if (MODES.includes(mode)) q.mode = mode;
    const d = dayRange(fromDate, toDate);
    if (d) q.date = d;
    const term = String(search).trim();
    if (term) q.$or = [{ number: { $regex: escapeRegex(term), $options: "i" } }, { vendorName: { $regex: escapeRegex(term), $options: "i" } },
      { reference: { $regex: escapeRegex(term), $options: "i" } }, { "allocations.billNumber": { $regex: escapeRegex(term), $options: "i" } }];
    const payments = await VendorPayment.find(q).sort({ date: -1, createdAt: -1 }).limit(2000).lean();
    res.json({ payments });
  } catch (err) { fail(res, err, "List vendor payments"); }
};

// GET /api/vendor-payments/open-bills?userId=&vendorId= — the vendor's unpaid bills, oldest first
export const getOpenBills = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const vendorId = String(req.query.vendorId || "");
    if (!vendorId) return res.status(400).json({ message: "Choose a vendor." });
    const vendorName = await vendorNameFor(vendorId);
    const bills = await Bill.find({ ...vendorDocFilter(vendorId, vendorName), ...PAYABLE_STATUS_FILTER, ...locFilter(who.scope) })
      .select("billNumber billDate dueDate finalTotal amountPaid creditsApplied status warehouse locCode vendorId vendorName").sort({ billDate: 1, createdAt: 1 }).lean();
    const open = bills.map((b) => withPaymentInfo(b)).filter((b) => b.balanceDue > 0.004);
    res.json({ vendorId, vendorName, bills: open, totalDue: round2(open.reduce((s, b) => s + b.balanceDue, 0)) });
  } catch (err) { fail(res, err, "Open bills"); }
};

/**
 * POST /api/vendor-payments
 * body: { userId, vendorId, date, mode, reference, amount, allocations: [{ billId, amount }], notes, locCode }
 * Each allocation ≤ the bill's balance (computed here from the database), allocations add up to
 * the amount. Bills are updated atomically; any failure undoes the earlier steps.
 */
export const createVendorPayment = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const b = req.body || {};
    const vendorId = String(b.vendorId || "").trim();
    const mode = String(b.mode || "");
    const amount = round2(Number(b.amount));
    if (!vendorId) return res.status(400).json({ message: "Choose a vendor." });
    if (!MODES.includes(mode)) return res.status(400).json({ message: "Choose how the vendor was paid: cash, bank, UPI or cheque." });
    if (!(amount > 0)) return res.status(400).json({ message: "Enter the amount paid." });
    if (mode === "cheque" && !String(b.reference || "").trim()) return res.status(400).json({ message: "Enter the cheque number in the reference." });
    const date = b.date ? new Date(`${String(b.date).slice(0, 10)}T12:00:00+05:30`) : new Date();
    if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Invalid payment date." });
    if (date > istDayEnd(new Date())) return res.status(400).json({ message: "Payment date cannot be in the future." });

    // Merge allocations per bill and validate against the database
    const merged = new Map();
    for (const a of Array.isArray(b.allocations) ? b.allocations : []) {
      const amt = round2(Number(a?.amount));
      if (!(amt > 0)) continue;
      const id = toId(a.billId);
      if (!id) return res.status(400).json({ message: "Invalid bill in the allocations." });
      merged.set(String(id), round2((merged.get(String(id)) || 0) + amt));
    }
    if (!merged.size) return res.status(400).json({ message: "Allocate the payment to at least one bill." });
    const allocated = round2([...merged.values()].reduce((s, x) => s + x, 0));
    if (Math.abs(allocated - amount) > 0.01) {
      return res.status(400).json({ message: `Allocations add up to ₹${allocated.toFixed(2)} but the payment is ₹${amount.toFixed(2)}. They must match (advances are not supported).` });
    }

    const vendorName = await vendorNameFor(vendorId, String(b.vendorName || ""));
    const bills = await Bill.find({ _id: { $in: [...merged.keys()].map(toId) } }).lean();
    if (bills.length !== merged.size) return res.status(400).json({ message: "One of the bills was not found." });
    for (const bill of bills) {
      const sameVendor = String(bill.vendorId || "") === vendorId || (!bill.vendorId && bill.vendorName === vendorName);
      if (!sameVendor) return res.status(400).json({ message: `Bill ${bill.billNumber} belongs to another vendor.` });
      if (!isPayableBill(bill)) return res.status(400).json({ message: `Bill ${bill.billNumber} is ${bill.status} and cannot be paid.` });
      if (!who.scope.all && !canSeeLoc(who.scope, bill.locCode)) return res.status(403).json({ message: `Bill ${bill.billNumber} belongs to another store.` });
      const want = merged.get(String(bill._id));
      const balance = billBalance(bill);
      if (want > balance + 0.004) return res.status(400).json({ message: `₹${want.toFixed(2)} is more than the ₹${balance.toFixed(2)} still due on bill ${bill.billNumber}.` });
    }

    const paymentId = new mongoose.Types.ObjectId();
    const number = await nextNumber("VENDOR_PAYMENT", "PAY-");
    const billNumberOf = new Map(bills.map((x) => [String(x._id), x.billNumber]));
    const allocations = [...merged.entries()].map(([billId, amt]) => ({ billId: toId(billId), billNumber: billNumberOf.get(billId), amount: amt }));
    const locCode = String(b.locCode || who.user.locCode || bills[0]?.locCode || "");

    const undo = new UndoStack();
    try {
      for (const a of allocations) {
        const updated = await addToBill({ billId: a.billId, field: "amountPaid", amount: a.amount,
          push: { payments: { paymentId, paymentNumber: number, amount: a.amount, date } } });
        if (!updated) throw new HttpError(409, `Bill ${a.billNumber} no longer has ₹${a.amount.toFixed(2)} due (it may have just been paid). Please reload.`);
        undo.push(`bill ${a.billNumber}`, () => removeFromBill({ billId: a.billId, field: "amountPaid", amount: a.amount, pull: { payments: { paymentId } } }));
      }
      const payment = await VendorPayment.create({
        _id: paymentId, number, vendorId, vendorName, date, mode, reference: String(b.reference || "").trim(), amount,
        allocations, notes: String(b.notes || "").trim(), locCode, daybookInvoiceNo: number, createdBy: by(who),
      });
      undo.push("payment", () => VendorPayment.deleteOne({ _id: paymentId }));
      await postMoneyOut({
        invoiceNo: number, category: "Vendor Payment", subCategory: "Purchase", amount, mode, locCode, date,
        remark: `Paid ${vendorName}: ${allocations.map((a) => a.billNumber).join(", ")}${b.reference ? ` (ref ${b.reference})` : ""}`,
        customerName: vendorName,
      });
      res.status(201).json(payment.toObject());
    } catch (err) {
      await undo.rollback();
      throw err;
    }
  } catch (err) { fail(res, err, "Create vendor payment"); }
};

// GET /api/vendor-payments/:id?userId=
export const getVendorPayment = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const p = toId(req.params.id) ? await VendorPayment.findById(req.params.id).lean() : null;
    if (!p) return res.status(404).json({ message: "Payment not found" });
    if (!canSeeLoc(who.scope, p.locCode)) return res.status(403).json({ message: "This payment belongs to another store." });
    const bills = await Bill.find({ _id: { $in: p.allocations.map((a) => a.billId) } })
      .select("billNumber billDate dueDate finalTotal amountPaid creditsApplied status").lean();
    res.json({ ...p, bills: bills.map((x) => withPaymentInfo(x)) });
  } catch (err) { fail(res, err, "Get vendor payment"); }
};

// DELETE /api/vendor-payments/:id?userId= — admin. Gives the amounts back to the bills and removes the daybook entry.
export const deleteVendorPayment = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const p = toId(req.params.id) ? await VendorPayment.findById(req.params.id).lean() : null;
    if (!p) return res.status(404).json({ message: "Payment not found" });
    for (const a of p.allocations) {
      await removeFromBill({ billId: a.billId, field: "amountPaid", amount: a.amount, pull: { payments: { paymentId: p._id } } });
    }
    const tx = await Transaction.findOne({ invoiceNo: p.daybookInvoiceNo || p.number, category: "Vendor Payment" }).lean();
    if (tx) await removeMoneyIn(tx);
    await VendorPayment.deleteOne({ _id: p._id });
    res.json({ message: `Payment ${p.number} deleted; ₹${p.amount.toFixed(2)} is due again on ${p.allocations.map((a) => a.billNumber).join(", ")}.` });
  } catch (err) { fail(res, err, "Delete vendor payment"); }
};
