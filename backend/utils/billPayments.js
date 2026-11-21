// Database helpers for bill payments and credits (F9/F10).
// Every change to a bill's amountPaid / creditsApplied is a conditional atomic update that
// only succeeds while the bill still has enough balance, so a bill can never be overpaid
// even when two payments are saved at the same moment.
import mongoose from "mongoose";
import Bill from "../model/Bill.js";
import Vendor from "../model/Vendor.js";
import { round2 } from "./retailMath.js";

const EPS = 0.004;
const toId = (v) => (v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);

// balance = finalTotal − amountPaid − creditsApplied (missing fields = 0)
const BALANCE_EXPR = { $subtract: ["$finalTotal", { $add: [{ $ifNull: ["$amountPaid", 0] }, { $ifNull: ["$creditsApplied", 0] }] }] };

export const PAYABLE_STATUS_FILTER = { status: { $nin: ["draft", "cancelled", "void"] } };

/**
 * Add `amount` to a bill's amountPaid or creditsApplied — only if its balance covers it.
 * Returns the updated bill, or null when the balance is too small (or the bill is not payable).
 */
export const addToBill = async ({ billId, field, amount, push }) => {
  if (!["amountPaid", "creditsApplied"].includes(field)) throw new Error(`Bad field ${field}`);
  const amt = round2(amount);
  const update = { $inc: { [field]: amt } };
  if (push) update.$push = push;
  return Bill.findOneAndUpdate(
    { _id: toId(billId), ...PAYABLE_STATUS_FILTER, $expr: { $gte: [BALANCE_EXPR, amt - EPS] } },
    update,
    { new: true }
  ).lean();
};

/** Take `amount` back off a bill's amountPaid or creditsApplied (payment deleted / rollback). */
export const removeFromBill = ({ billId, field, amount, pull }) => {
  const update = { $inc: { [field]: -round2(amount) } };
  if (pull) update.$pull = pull;
  return Bill.updateOne({ _id: toId(billId) }, update);
};

/** The vendor as VendorController stores it (MongoDB Vendor), or null for ids from older data. */
export const findVendor = async (vendorId) => {
  const id = toId(vendorId);
  return id ? Vendor.findById(id).select("displayName companyName gstin").lean() : null;
};

/**
 * Filter for a vendor's bills/credits: by vendorId, plus older documents saved with only the
 * vendor's name (vendorId empty).
 */
export const vendorDocFilter = (vendorId, vendorName) => {
  const or = [{ vendorId: String(vendorId) }];
  if (vendorName) or.push({ vendorId: { $in: [null, ""] }, vendorName });
  return { $or: or };
};

/** Group key for reports: vendorId, else the vendor name (older bills). */
export const vendorKeyOf = (doc) => (doc.vendorId ? `id:${doc.vendorId}` : `name:${String(doc.vendorName || "").trim().toLowerCase()}`);

export { toId, BALANCE_EXPR };
