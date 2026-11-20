// Redemptions engine: customers, loyalty points and store credit on sales invoices.
//
// Every balance change is a conditional atomic update (never read-modify-write), so a
// balance cannot go negative even when two tills use the same customer at once.
// Callers collect undo functions in an UndoStack and roll back if a later step fails,
// so an invoice is never left half-applied.
import mongoose from "mongoose";
import Customer from "../model/Customer.js";
import LoyaltyLedger from "../model/LoyaltyLedger.js";
import LoyaltySettings from "../model/LoyaltySettings.js";
import StoreCredit from "../model/StoreCredit.js";
import Setting from "../model/Setting.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { resolveLine } from "./stockService.js";
import { nextNumber } from "./nextNumber.js";
import { istDayEnd, addIstDays } from "./ist.js";
import {
  round2, normalizePhone, DEFAULT_LOYALTY_SETTINGS, maxRedeemable, amountToPoints, pointsToAmount,
  earnBaseOf, pointsEarned, redeemedOfType, returnRefundSplit,
} from "./retailMath.js";

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Collects undo functions; rollback() runs them newest first and never throws. */
export class UndoStack {
  constructor() { this.steps = []; }
  push(label, fn) { this.steps.push({ label, fn }); }
  async rollback() {
    for (const { label, fn } of [...this.steps].reverse()) {
      try { await fn(); } catch (e) { console.error(`❌ Rollback step "${label}" failed:`, e.message); }
    }
    this.steps = [];
  }
}

const toId = (v) => (v && mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null);
const EPS = 0.004;

// ─── Settings ───────────────────────────────────────────────────────────────

/** Active loyalty settings for a store (store row → default row → built-in defaults). */
export const getLoyaltySettings = async (locCode) => {
  const loc = locCode ? String(locCode) : null;
  const row =
    (loc && (await LoyaltySettings.findOne({ locCode: loc, active: true }).sort({ createdAt: -1 }).lean())) ||
    (await LoyaltySettings.findOne({ locCode: null, active: true }).sort({ createdAt: -1 }).lean());
  return row ? { ...DEFAULT_LOYALTY_SETTINGS, ...row, source: row.locCode ? "store" : "default" } : { ...DEFAULT_LOYALTY_SETTINGS, source: "built-in" };
};

export const STORE_CREDIT_EXPIRY_KEY = "storeCreditExpiryDays";
export const getStoreCreditExpiryDays = async () => {
  const row = await Setting.findById(STORE_CREDIT_EXPIRY_KEY).lean();
  const n = Number(row?.value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
};

// ─── Customers ──────────────────────────────────────────────────────────────

/**
 * Find or create the customer for a bill by normalised phone; updates the name if the
 * cashier typed a different one. No phone → walk-in (returns null).
 * Throws HttpError(400) when a phone was typed but is not valid.
 */
export const findOrCreateCustomer = async ({ name, phone, locCode, createdBy }) => {
  if (!phone || !String(phone).trim()) return null;
  const normalized = normalizePhone(phone);
  if (!normalized) throw new HttpError(400, `"${phone}" is not a valid phone number. Use a 10-digit mobile number (or 6–15 digits).`);
  const cleanName = (name || "").toString().trim() || "Customer";
  const update = {
    $set: { name: cleanName },
    $setOnInsert: { phone: normalized, locCode: locCode || "", createdBy: createdBy || "", status: "active" },
  };
  try {
    return await Customer.findOneAndUpdate({ phone: normalized }, update, { upsert: true, new: true }).lean();
  } catch (e) {
    // Two bills created the same new customer at the same moment: the unique index let one win
    if (e.code === 11000) return Customer.findOneAndUpdate({ phone: normalized }, { $set: { name: cleanName } }, { new: true }).lean();
    throw e;
  }
};

// ─── Store credit balance cache & expiry ────────────────────────────────────

const unexpired = (now = new Date()) => ({ $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] });

export const refreshStoreCreditBalance = async (customerId) => {
  const id = toId(customerId);
  if (!id) return 0;
  const [agg] = await StoreCredit.aggregate([
    { $match: { customerId: id, status: "open", ...unexpired() } },
    { $group: { _id: null, total: { $sum: "$balance" } } },
  ]);
  const total = round2(agg?.total || 0);
  await Customer.updateOne({ _id: id }, { $set: { storeCreditBalance: total } });
  return total;
};

/** Mark open credits past their expiry as expired (checked on read; no cron needed). */
export const expireStaleCredits = async () => {
  const now = new Date();
  const stale = await StoreCredit.find({ status: "open", expiryDate: { $ne: null, $lt: now } }).select("_id customerId").lean();
  if (!stale.length) return 0;
  await StoreCredit.updateMany({ _id: { $in: stale.map((s) => s._id) }, status: "open" }, { $set: { status: "expired" } });
  for (const cid of new Set(stale.map((s) => String(s.customerId)))) await refreshStoreCreditBalance(cid);
  return stale.length;
};

// ─── Loyalty points ─────────────────────────────────────────────────────────

/**
 * Change a customer's points by `delta` and write the ledger row(s).
 * A negative change fails with 409 when the balance is too low — unless `clamp` is set
 * (used for reversals): then the balance goes to 0 and an "adjust" row explains why.
 * Returns { ledgerIds, applied } (applied = the change actually made).
 */
export const changePoints = async ({ customerId, delta, type, invoiceId = null, invoiceNumber = "", note = "", createdBy = "", clamp = false }) => {
  delta = Math.trunc(Number(delta) || 0);
  if (!delta) return { ledgerIds: [], applied: 0 };
  const id = toId(customerId);
  const base = { customerId: id, invoiceId: toId(invoiceId), invoiceNumber, createdBy };

  if (delta > 0) {
    const c = await Customer.findOneAndUpdate({ _id: id }, { $inc: { loyaltyPoints: delta } }, { new: true }).lean();
    if (!c) throw new HttpError(404, "Customer not found");
    const row = await LoyaltyLedger.create({ ...base, type, points: delta, balanceAfter: c.loyaltyPoints, note });
    return { ledgerIds: [row._id], applied: delta };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const c = await Customer.findOneAndUpdate({ _id: id, loyaltyPoints: { $gte: -delta } }, { $inc: { loyaltyPoints: delta } }, { new: true }).lean();
    if (c) {
      const row = await LoyaltyLedger.create({ ...base, type, points: delta, balanceAfter: c.loyaltyPoints, note });
      return { ledgerIds: [row._id], applied: delta };
    }
    const cur = await Customer.findById(id).select("loyaltyPoints name").lean();
    if (!cur) throw new HttpError(404, "Customer not found");
    if (!clamp) throw new HttpError(409, `Not enough loyalty points: ${cur.name} has ${cur.loyaltyPoints}, needed ${-delta}.`);
    const take = Math.max(0, cur.loyaltyPoints);
    const c2 = await Customer.findOneAndUpdate({ _id: id, loyaltyPoints: cur.loyaltyPoints }, { $inc: { loyaltyPoints: -take } }, { new: true }).lean();
    if (!c2) continue; // balance changed meanwhile — retry
    const shortfall = -delta - take;
    const rows = await LoyaltyLedger.insertMany([
      { ...base, type, points: delta, balanceAfter: c2.loyaltyPoints - shortfall, note },
      { ...base, type: "adjust", points: shortfall, balanceAfter: c2.loyaltyPoints,
        note: `Balance would have gone below zero (${take} available, ${-delta} to take back); set to 0.` },
    ]);
    return { ledgerIds: rows.map((r) => r._id), applied: -take };
  }
  throw new HttpError(409, "Loyalty balance is changing, please retry.");
};

/** Undo a changePoints() made in this same request: put the points back and remove its ledger rows. */
const rollbackPoints = async (customerId, result) => {
  if (!result?.applied) return;
  await Customer.updateOne({ _id: toId(customerId) }, { $inc: { loyaltyPoints: -result.applied } });
  await LoyaltyLedger.deleteMany({ _id: { $in: result.ledgerIds } });
};

// ─── Store credit use / give back ───────────────────────────────────────────

const useStoreCredit = async ({ creditId, customerId, amount, invoiceId, invoiceNumber }) => {
  const now = new Date();
  const updated = await StoreCredit.findOneAndUpdate(
    { _id: toId(creditId), customerId: toId(customerId), status: "open", balance: { $gte: amount - EPS }, ...unexpired(now) },
    { $inc: { balance: -amount }, $push: { redemptions: { invoiceId: toId(invoiceId), invoiceNumber, amount, date: now } } },
    { new: true }
  ).lean();
  if (!updated) {
    const sc = await StoreCredit.findById(toId(creditId)).select("number balance status expiryDate").lean();
    const why = !sc ? "was not found"
      : sc.status !== "open" ? `is ${sc.status}`
      : sc.expiryDate && sc.expiryDate < now ? "has expired"
      : `has only ₹${round2(sc.balance)} left`;
    throw new HttpError(409, `Store credit ${sc?.number || ""} ${why}.`.replace("  ", " "));
  }
  const bal = round2(updated.balance);
  if (bal <= EPS) await StoreCredit.updateOne({ _id: updated._id, status: "open" }, { $set: { balance: 0, status: "used" } });
  else if (bal !== updated.balance) await StoreCredit.updateOne({ _id: updated._id }, { $set: { balance: bal } });
  return updated;
};

/** Put a store credit amount used by an invoice back on the credit. */
const giveBackStoreCredit = async ({ creditId, invoiceId, amount }) => {
  const now = new Date();
  const r = await StoreCredit.findOneAndUpdate(
    { _id: toId(creditId), redemptions: { $elemMatch: { invoiceId: toId(invoiceId), reversed: { $ne: true } } } },
    { $inc: { balance: amount }, $set: { "redemptions.$.reversed": true, "redemptions.$.reversedAt": now } },
    { new: true }
  ).lean();
  if (!r) return null;
  const bal = round2(r.balance);
  const status = r.status === "void" ? "void" : r.expiryDate && r.expiryDate < now ? "expired" : bal > EPS ? "open" : "used";
  await StoreCredit.updateOne({ _id: r._id }, { $set: { balance: bal, status } });
  return r;
};

/** Re-take an amount that giveBackStoreCredit() returned (used only to roll back). */
const retakeStoreCredit = async ({ creditId, invoiceId, amount }) => {
  const r = await StoreCredit.findOneAndUpdate(
    { _id: toId(creditId), balance: { $gte: amount - EPS }, redemptions: { $elemMatch: { invoiceId: toId(invoiceId), reversed: true } } },
    { $inc: { balance: -amount }, $set: { "redemptions.$.reversed": false, "redemptions.$.reversedAt": null } },
    { new: true }
  ).lean();
  if (r && round2(r.balance) <= EPS) await StoreCredit.updateOne({ _id: r._id }, { $set: { balance: 0, status: "used" } });
  else if (r && r.status === "used") await StoreCredit.updateOne({ _id: r._id }, { $set: { status: "open" } });
};

// ─── Planning ───────────────────────────────────────────────────────────────

/**
 * Validate the redemptions the client asked for and compute the server's own figures.
 * The client's numbers are only a preview: points/amounts are recomputed here.
 * Throws HttpError(400) with a clear message for anything invalid.
 */
export const planRedemptions = async ({ requested, finalTotal, customer, settings }) => {
  const list = (Array.isArray(requested) ? requested : []).filter((r) => r && r.type);
  const empty = { redemptions: [], totalRedeemed: 0, loyaltyPointsUsed: 0, loyaltyAmount: 0 };
  if (!list.length) return empty;
  const total = round2(Number(finalTotal) || 0);
  if (!customer) throw new HttpError(400, "Enter the customer's phone number to use loyalty points or store credit.");
  if (total <= 0) throw new HttpError(400, "Redemptions can only be used on a bill with a positive total.");

  const out = [];
  let loyaltyPointsUsed = 0, loyaltyAmount = 0;

  const loyalty = list.filter((r) => r.type === "loyalty");
  if (loyalty.length > 1) throw new HttpError(400, "Loyalty points can only be applied once per bill.");
  if (loyalty.length) {
    const r = loyalty[0];
    const lim = maxRedeemable({ finalTotal: total, balance: customer.loyaltyPoints, settings });
    if (!lim.allowed) throw new HttpError(400, lim.reason);
    let pts;
    if (r.points !== undefined && r.points !== null && r.points !== "") {
      pts = Number(r.points);
      if (!Number.isInteger(pts)) throw new HttpError(400, "Loyalty points must be a whole number.");
    } else {
      pts = amountToPoints(r.amount, settings);
    }
    if (!(pts > 0)) throw new HttpError(400, "Enter the loyalty points (or amount) to use.");
    if (pts > lim.maxPoints) throw new HttpError(400, `At most ${lim.maxPoints} points (₹${pointsToAmount(lim.maxPoints, settings)}) can be used on this bill.`);
    loyaltyPointsUsed = pts;
    loyaltyAmount = pointsToAmount(pts, settings);
    out.push({ type: "loyalty", refId: null, code: "", points: pts, amount: loyaltyAmount });
  }

  const byCredit = new Map();
  for (const r of list.filter((x) => x.type === "storeCredit")) {
    const amount = round2(Number(r.amount) || 0);
    if (!(amount > 0)) throw new HttpError(400, "Enter the store credit amount to use.");
    const sc = r.refId && toId(r.refId)
      ? await StoreCredit.findById(toId(r.refId)).lean()
      : await StoreCredit.findOne({ number: String(r.code || "").trim().toUpperCase() }).lean();
    if (!sc) throw new HttpError(400, `Store credit ${r.code || ""} was not found.`.replace("  ", " "));
    if (String(sc.customerId) !== String(customer._id)) throw new HttpError(400, `Store credit ${sc.number} belongs to another customer.`);
    if (sc.status !== "open") throw new HttpError(400, `Store credit ${sc.number} is ${sc.status}.`);
    if (sc.expiryDate && new Date(sc.expiryDate) < new Date()) throw new HttpError(400, `Store credit ${sc.number} expired on ${new Date(sc.expiryDate).toLocaleDateString("en-IN")}.`);
    const key = String(sc._id);
    const prev = byCredit.get(key);
    const want = round2((prev?.amount || 0) + amount);
    if (want > round2(sc.balance) + EPS) throw new HttpError(400, `Store credit ${sc.number} has only ₹${round2(sc.balance)} left.`);
    byCredit.set(key, { type: "storeCredit", refId: sc._id, code: sc.number, points: 0, amount: want });
  }
  out.push(...byCredit.values());

  if (list.some((r) => r.type === "giftCard" || r.type === "voucher")) {
    throw new HttpError(400, "Gift cards and vouchers are not available yet.");
  }
  const unknown = list.find((r) => !["loyalty", "storeCredit", "giftCard", "voucher"].includes(r.type));
  if (unknown) throw new HttpError(400, `Unknown redemption type "${unknown.type}".`);

  const totalRedeemed = round2(out.reduce((s, r) => s + r.amount, 0));
  if (totalRedeemed > total + EPS) throw new HttpError(400, `Redemptions (₹${totalRedeemed}) cannot be more than the bill total (₹${total}).`);
  return { redemptions: out, totalRedeemed, loyaltyPointsUsed, loyaltyAmount };
};

// ─── Applying / reversing on an invoice ─────────────────────────────────────

/** Take the planned redemptions off the customer's balances. Pushes undo steps onto `undo`. */
export const applyRedemptions = async ({ plan, customer, invoiceId, invoiceNumber, createdBy, undo }) => {
  for (const r of plan.redemptions) {
    if (r.type === "loyalty") {
      const res = await changePoints({ customerId: customer._id, delta: -r.points, type: "redeem", invoiceId, invoiceNumber, createdBy, note: `Redeemed ₹${r.amount}` });
      undo.push("loyalty redeem", () => rollbackPoints(customer._id, res));
    } else if (r.type === "storeCredit") {
      await useStoreCredit({ creditId: r.refId, customerId: customer._id, amount: r.amount, invoiceId, invoiceNumber });
      undo.push(`store credit ${r.code}`, async () => {
        await giveBackStoreCredit({ creditId: r.refId, invoiceId, amount: r.amount });
        // Drop the rolled-back entry entirely: it never really happened
        await StoreCredit.updateOne({ _id: r.refId }, { $pull: { redemptions: { invoiceId: toId(invoiceId), reversed: true } } });
        await refreshStoreCreditBalance(customer._id);
      });
    }
  }
  if (plan.redemptions.some((r) => r.type === "storeCredit")) await refreshStoreCreditBalance(customer._id);
};

/** Points a sale earns (pure, computed before the invoice is saved). */
export const computeEarn = ({ customer, finalTotal, plan, settings }) => {
  const earnBase = earnBaseOf({ finalTotal, loyaltyAmount: plan.loyaltyAmount, voucherAmount: redeemedOfType(plan.redemptions, "voucher") });
  return { earnBase, earned: customer ? pointsEarned(earnBase, settings) : 0 };
};

/** Post earned points to the customer's ledger (after the invoice is saved). */
export const postEarn = async ({ customer, earned, earnBase, invoiceId, invoiceNumber, createdBy, undo }) => {
  if (!customer || !(earned > 0)) return;
  const res = await changePoints({ customerId: customer._id, delta: earned, type: "earn", invoiceId, invoiceNumber, createdBy, note: `Earned on ₹${earnBase}` });
  undo.push("loyalty earn", () => rollbackPoints(customer._id, res));
};

/**
 * Reverse everything a sale invoice applied (used before an edit re-applies, and on delete):
 * gives back loyalty points and store credit used, takes back points earned
 * (net of what returns already took back). Pushes undo steps that re-apply it.
 */
export const reverseInvoiceLoyalty = async ({ invoice, createdBy, reason, undo }) => {
  if (!invoice?.loyaltyApplied || !invoice.customerId) return;
  const customerId = invoice.customerId;
  const invoiceId = invoice._id;
  const invoiceNumber = invoice.invoiceNumber;
  const note = reason || "Invoice changed";

  const earnedLeft = (invoice.loyaltyPointsEarned || 0) - (invoice.loyaltyPointsReversed || 0);
  if (earnedLeft > 0) {
    const res = await changePoints({ customerId, delta: -earnedLeft, type: "reverse_earn", invoiceId, invoiceNumber, createdBy, note, clamp: true });
    undo.push("re-earn", () => rollbackPoints(customerId, res));
  }
  for (const r of invoice.redemptions || []) {
    if (r.type === "loyalty") {
      const back = (r.points || 0) - (invoice.loyaltyPointsRestored || 0);
      if (back > 0) {
        const res = await changePoints({ customerId, delta: back, type: "restore_redeem", invoiceId, invoiceNumber, createdBy, note });
        undo.push("re-redeem", () => rollbackPoints(customerId, res));
      }
    } else if (r.type === "storeCredit") {
      const gave = await giveBackStoreCredit({ creditId: r.refId, invoiceId, amount: r.amount });
      if (gave) undo.push(`re-take ${r.code}`, async () => {
        await retakeStoreCredit({ creditId: r.refId, invoiceId, amount: r.amount });
        await refreshStoreCreditBalance(customerId);
      });
    }
  }
  await refreshStoreCreditBalance(customerId);
};

// ─── Returns ────────────────────────────────────────────────────────────────

/** Preview of how a return of `returnValue` from `original` would be refunded (no writes). */
export const previewReturn = (original, returnValue, refundMode = "cash") => {
  const base = original?.loyaltyApplied ? (original.loyaltyBaseTotal ?? original.finalTotal) : (original?.finalTotal || 0);
  return returnRefundSplit({
    baseTotal: original?.loyaltyApplied ? base : Math.max(Number(base) || 0, Math.abs(Number(returnValue) || 0)),
    returnValue,
    redemptions: original?.loyaltyApplied ? original.redemptions || [] : [],
    pointsUsed: original?.loyaltyApplied ? original.loyaltyPointsUsed || 0 : 0,
    pointsEarned: original?.loyaltyApplied ? original.loyaltyPointsEarned || 0 : 0,
    alreadyRestored: original?.loyaltyPointsRestored || 0,
    alreadyReversed: original?.loyaltyPointsReversed || 0,
    refundMode,
  });
};

/** Issue a new store credit. Pushes an undo step that removes it again. */
export const issueStoreCredit = async ({ customer, amount, sourceInvoice, returnInvoice, locCode, createdBy, undo }) => {
  const days = await getStoreCreditExpiryDays();
  const now = new Date();
  const sc = await StoreCredit.create({
    number: await nextNumber("STORE_CREDIT", "SC-"),
    customerId: customer._id,
    customerName: customer.name,
    customerPhone: customer.phone,
    sourceInvoiceId: toId(sourceInvoice?._id),
    sourceInvoiceNumber: sourceInvoice?.invoiceNumber || "",
    returnInvoiceId: toId(returnInvoice?._id),
    returnInvoiceNumber: returnInvoice?.invoiceNumber || "",
    amount: round2(amount),
    balance: round2(amount),
    issueDate: now,
    expiryDate: days > 0 ? istDayEnd(addIstDays(now, days)) : null,
    status: "open",
    locCode: locCode || "",
    createdBy: createdBy || "",
  });
  undo.push(`remove ${sc.number}`, async () => {
    await StoreCredit.deleteOne({ _id: sc._id, "redemptions.0": { $exists: false } });
    await refreshStoreCreditBalance(customer._id);
  });
  await refreshStoreCreditBalance(customer._id);
  return sc;
};

/**
 * After a return invoice is saved: restore points used, reverse points earned, issue store
 * credit, and record on the original invoice how much has been restored/reversed so far.
 * Returns the refundBreakdown stored on the return invoice.
 */
export const applyReturnRefund = async ({ original, returnInvoice, split, refundMode, createdBy, undo }) => {
  const breakdown = { mode: refundMode, ...split, pointsRestored: 0, pointsReversed: 0 };
  delete breakdown.pointsRestore;
  delete breakdown.pointsReverse;
  const customerId = original?.customerId || returnInvoice.customerId;

  if (original?.loyaltyApplied && customerId) {
    if (split.pointsRestore > 0) {
      const res = await changePoints({ customerId, delta: split.pointsRestore, type: "restore_redeem", invoiceId: original._id,
        invoiceNumber: original.invoiceNumber, createdBy, note: `Return ${returnInvoice.invoiceNumber}` });
      undo.push("return restore", () => rollbackPoints(customerId, res));
      breakdown.pointsRestored = res.applied;
    }
    if (split.pointsReverse > 0) {
      const res = await changePoints({ customerId, delta: -split.pointsReverse, type: "reverse_earn", invoiceId: original._id,
        invoiceNumber: original.invoiceNumber, createdBy, note: `Return ${returnInvoice.invoiceNumber}`, clamp: true });
      undo.push("return reverse earn", () => rollbackPoints(customerId, res));
      breakdown.pointsReversed = split.pointsReverse;
    }
    if (breakdown.pointsRestored || breakdown.pointsReversed) {
      await mongoose.model("SalesInvoice").updateOne({ _id: original._id }, {
        $inc: { loyaltyPointsRestored: breakdown.pointsRestored, loyaltyPointsReversed: breakdown.pointsReversed },
      });
      undo.push("original counters", () => mongoose.model("SalesInvoice").updateOne({ _id: original._id }, {
        $inc: { loyaltyPointsRestored: -breakdown.pointsRestored, loyaltyPointsReversed: -breakdown.pointsReversed },
      }));
    }
  }

  if (split.storeCreditAmount > 0) {
    const customer = customerId ? await Customer.findById(customerId).lean() : null;
    if (!customer) throw new HttpError(400, "A refund as store credit needs a customer. This invoice has no customer phone.");
    const sc = await issueStoreCredit({ customer, amount: split.storeCreditAmount, sourceInvoice: original, returnInvoice,
      locCode: returnInvoice.locCode, createdBy, undo });
    breakdown.storeCreditId = sc._id;
    breakdown.storeCreditNumber = sc.number;
  }
  return breakdown;
};

// ─── Line cost snapshot (for profit reports) ────────────────────────────────

/** Fill line.costPrice with the item's current cost when the line has none. Never throws. */
export const snapshotLineCosts = async (lines, sourceLines = []) => {
  for (const line of lines || []) {
    if (line == null || (line.costPrice !== undefined && line.costPrice !== null && line.costPrice !== "")) continue;
    try {
      // A return line takes the cost recorded on the sale it came from
      const src = sourceLines.find((s) => s?.costPrice != null && (
        (s.itemData?._id && line.itemData?._id && String(s.itemData._id) === String(line.itemData._id)) ||
        (s.itemSku && s.itemSku === line.itemSku)));
      if (src) { line.costPrice = Number(src.costPrice) || 0; continue; }
      const target = await resolveLine(line);
      if (!target) continue;
      if (target.kind === "group") {
        const g = await ItemGroup.findOne({ _id: target.groupId }, { items: { $elemMatch: { _id: target.itemId } } }).lean();
        const gi = g?.items?.[0];
        if (gi && gi.costPrice != null) line.costPrice = Number(gi.costPrice) || 0;
      } else {
        const it = await ShoeItem.findById(target.itemId).select("costPrice").lean();
        if (it && it.costPrice != null) line.costPrice = Number(it.costPrice) || 0;
      }
    } catch (e) { /* cost is informational only */ }
  }
};

export { toId };
