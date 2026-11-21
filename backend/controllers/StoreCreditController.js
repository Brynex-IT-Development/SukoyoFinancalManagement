import StoreCredit from "../model/StoreCredit.js";
import Customer from "../model/Customer.js";
import SalesInvoice from "../model/SalesInvoice.js";
import Setting from "../model/Setting.js";
import { requireUser, locFilter, canSeeLoc } from "../utils/userScope.js";
import { round2, normalizePhone, maxRedeemable, amountToPoints, pointsToAmount, valuePerPoint } from "../utils/retailMath.js";
import {
  expireStaleCredits, refreshStoreCreditBalance, getLoyaltySettings, getStoreCreditExpiryDays,
  STORE_CREDIT_EXPIRY_KEY, toId, expireStaleGiftCards, findGiftCard, giftCardProblem, findVoucher,
  evaluateVoucher, voucherLinesFrom,
} from "../utils/redemptions.js";
import { istDayStart, istDayEnd } from "../utils/ist.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const serverError = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

// GET /api/store-credits?userId=&status=&search=&fromDate=&toDate=
export const listStoreCredits = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    await expireStaleCredits();
    const { status = "", search = "", fromDate, toDate } = req.query;
    const q = { ...locFilter(who.scope) };
    if (["open", "used", "expired", "void"].includes(status)) q.status = status;
    if (fromDate || toDate) {
      q.issueDate = {};
      if (fromDate) q.issueDate.$gte = istDayStart(new Date(`${fromDate}T12:00:00+05:30`));
      if (toDate) q.issueDate.$lte = istDayEnd(new Date(`${toDate}T12:00:00+05:30`));
    }
    const term = String(search).trim();
    if (term) {
      const digits = term.replace(/\D/g, "");
      q.$or = [
        { number: { $regex: escapeRegex(term), $options: "i" } },
        { customerName: { $regex: escapeRegex(term), $options: "i" } },
        { returnInvoiceNumber: { $regex: escapeRegex(term), $options: "i" } },
        ...(digits.length >= 3 ? [{ customerPhone: { $regex: escapeRegex(digits) } }] : []),
      ];
    }
    const credits = await StoreCredit.find(q).sort({ createdAt: -1 }).limit(2000).lean();
    res.json({ credits });
  } catch (err) { serverError(res, err, "List store credits"); }
};

// GET /api/store-credits/settings
export const getStoreCreditSettings = async (req, res) => {
  try {
    res.json({ expiryDays: await getStoreCreditExpiryDays() });
  } catch (err) { serverError(res, err, "Store credit settings"); }
};

// PUT /api/store-credits/settings { userId, expiryDays } — admin. 0 = never expires. Applies to credits issued from now on.
export const saveStoreCreditSettings = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const days = Number(req.body.expiryDays);
    if (!Number.isInteger(days) || days < 0 || days > 3650) return res.status(400).json({ message: "Expiry days must be a whole number from 0 to 3650 (0 = never expires)." });
    await Setting.findByIdAndUpdate(STORE_CREDIT_EXPIRY_KEY, { $set: { value: days, updatedBy: who.user.email || "" } }, { upsert: true });
    res.json({ expiryDays: days });
  } catch (err) { serverError(res, err, "Save store credit settings"); }
};

// GET /api/store-credits/:id?userId=
export const getStoreCredit = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    await expireStaleCredits();
    const sc = toId(req.params.id) ? await StoreCredit.findById(req.params.id).lean() : null;
    if (!sc) return res.status(404).json({ message: "Store credit not found" });
    if (!canSeeLoc(who.scope, sc.locCode)) return res.status(403).json({ message: "This store credit belongs to another store." });
    res.json(sc);
  } catch (err) { serverError(res, err, "Get store credit"); }
};

// POST /api/store-credits/:id/void { userId, note } — admin. Cancels the remaining balance.
export const voidStoreCredit = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const sc = await StoreCredit.findOneAndUpdate(
      { _id: toId(req.params.id), status: { $in: ["open", "expired"] } },
      { $set: { status: "void" } },
      { new: true }
    ).lean();
    if (!sc) return res.status(409).json({ message: "Only an open or expired store credit can be voided." });
    await refreshStoreCreditBalance(sc.customerId);
    res.json(sc);
  } catch (err) { serverError(res, err, "Void store credit"); }
};

/**
 * POST /api/redemptions/check — what the billing screen may apply (preview only; the
 * invoice save re-checks everything). body:
 *   { userId, type: "loyalty"|"storeCredit"|"giftCard"|"voucher", phone | customerId, finalTotal, otherRedeemed,
 *     points?, amount?, code?, refId?, locCode, lines? (voucher scope), invoiceId? (when editing: its own usage counts as available) }
 * Loyalty and store credit need a customer; gift cards and most vouchers do not.
 */
export const checkRedemption = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { type, finalTotal, otherRedeemed = 0, points, amount, code, refId, locCode, invoiceId } = req.body;
    const total = round2(Number(finalTotal) || 0);
    const room = round2(Math.max(0, total - (Number(otherRedeemed) || 0)));

    const customer = toId(req.body.customerId)
      ? await Customer.findById(req.body.customerId).lean()
      : normalizePhone(req.body.phone) ? await Customer.findOne({ phone: normalizePhone(req.body.phone) }).lean() : null;
    if (total <= 0) return res.status(400).json({ message: "Add items to the bill first." });
    const needsCustomer = type === "loyalty" || type === "storeCredit";
    if (needsCustomer && !customer) return res.status(400).json({ message: "Enter the customer's phone number first. New customers have no points or store credit yet." });

    // When editing, what this invoice already used is given back before the new version is applied
    let editInvoice = null;
    if (toId(invoiceId)) {
      editInvoice = await SalesInvoice.findById(invoiceId).select("customerId redemptions loyaltyApplied loyaltyPointsRestored returnStatus").lean();
      if (!editInvoice?.loyaltyApplied) editInvoice = null;
      // Customer-owned balances only count back for the same customer
      else if (needsCustomer && String(editInvoice.customerId) !== String(customer._id)) editInvoice = null;
    }

    if (type === "loyalty") {
      const settings = await getLoyaltySettings(locCode);
      const usedHere = editInvoice ? (editInvoice.redemptions || []).filter((r) => r.type === "loyalty").reduce((s, r) => s + (r.points || 0), 0) - (editInvoice.loyaltyPointsRestored || 0) : 0;
      const balance = (customer.loyaltyPoints || 0) + Math.max(0, usedHere);
      const lim = maxRedeemable({ finalTotal: total, balance, settings });
      if (!lim.allowed) return res.status(400).json({ message: lim.reason, balance });
      const vpp = valuePerPoint(settings);
      const roomPoints = Math.min(lim.maxPoints, amountToPoints(room, settings));
      let pts = points !== undefined && points !== null && points !== "" ? Number(points)
        : amount !== undefined && amount !== null && amount !== "" ? amountToPoints(amount, settings)
        : roomPoints;
      if (!Number.isInteger(pts) || pts <= 0) return res.status(400).json({ message: "Enter a whole number of points.", maxPoints: roomPoints });
      if (pts > roomPoints) {
        return res.status(400).json({ message: `At most ${roomPoints} points (₹${pointsToAmount(roomPoints, settings)}) can be used on this bill.`, maxPoints: roomPoints });
      }
      return res.json({ type, points: pts, amount: pointsToAmount(pts, settings), maxPoints: roomPoints, maxAmount: pointsToAmount(roomPoints, settings), balance, valuePerPoint: vpp });
    }

    if (type === "storeCredit") {
      await expireStaleCredits();
      const sc = toId(refId) ? await StoreCredit.findById(refId).lean()
        : await StoreCredit.findOne({ number: String(code || "").trim().toUpperCase() }).lean();
      if (!sc) return res.status(400).json({ message: `Store credit ${code || ""} was not found.`.replace("  ", " ") });
      if (String(sc.customerId) !== String(customer._id)) return res.status(400).json({ message: `Store credit ${sc.number} belongs to another customer.` });
      const usedHere = editInvoice ? (editInvoice.redemptions || []).filter((r) => r.type === "storeCredit" && String(r.refId) === String(sc._id)).reduce((s, r) => s + (r.amount || 0), 0) : 0;
      const usableStatus = sc.status === "open" || (sc.status === "used" && usedHere > 0);
      if (!usableStatus) return res.status(400).json({ message: `Store credit ${sc.number} is ${sc.status}.` });
      if (sc.expiryDate && new Date(sc.expiryDate) < new Date()) return res.status(400).json({ message: `Store credit ${sc.number} has expired.` });
      const balance = round2((sc.balance || 0) + usedHere);
      const maxAmount = round2(Math.min(balance, room));
      const want = amount !== undefined && amount !== null && amount !== "" ? round2(Number(amount)) : maxAmount;
      if (!(want > 0)) return res.status(400).json({ message: "Nothing left to pay with store credit.", maxAmount });
      if (want > maxAmount + 0.004) return res.status(400).json({ message: `At most ₹${maxAmount} of ${sc.number} can be used on this bill.`, maxAmount });
      return res.json({ type, refId: sc._id, code: sc.number, amount: want, maxAmount, balance, expiryDate: sc.expiryDate });
    }

    if (type === "giftCard") {
      await expireStaleGiftCards();
      const card = await findGiftCard({ refId, code });
      const usedHere = editInvoice && card ? (editInvoice.redemptions || []).filter((r) => r.type === "giftCard" && String(r.refId) === String(card._id)).reduce((s, r) => s + (r.amount || 0), 0) : 0;
      const problem = giftCardProblem(card, usedHere);
      if (problem) return res.status(400).json({ message: problem });
      const balance = round2((card.balance || 0) + usedHere);
      const maxAmount = round2(Math.min(balance, room));
      const want = amount !== undefined && amount !== null && amount !== "" ? round2(Number(amount)) : maxAmount;
      if (!(want > 0)) return res.status(400).json({ message: "Nothing left to pay with a gift card.", maxAmount });
      if (want > maxAmount + 0.004) return res.status(400).json({ message: `At most ₹${maxAmount} of ${card.code} can be used on this bill.`, maxAmount });
      return res.json({ type, refId: card._id, code: card.code, amount: want, maxAmount, balance, expiryDate: card.expiryDate });
    }

    if (type === "voucher") {
      const v = await findVoucher({ refId, code });
      if (!v) return res.status(400).json({ message: `Voucher ${code || ""} was not found.`.replace("  ", " ") });
      const usedHere = editInvoice ? (editInvoice.redemptions || []).find((r) => r.type === "voucher" && String(r.refId) === String(v._id)) || null : null;
      try {
        const { amount: worth, eligibleTotal } = evaluateVoucher({
          voucher: v, customer, finalTotal: total, voucherLines: await voucherLinesFrom(req.body.lines || []), locCode, usedHere,
        });
        const maxAmount = round2(Math.min(worth, room));
        if (!(maxAmount > 0)) return res.status(400).json({ message: "Nothing left to pay with a voucher." });
        return res.json({
          type, refId: v._id, code: v.code, amount: maxAmount, maxAmount, eligibleTotal, kind: v.kind,
          label: v.kind === "value" ? `${v.code} (value)` : `${v.code} (${v.discountType === "percent" ? `${v.value}%` : `₹${v.value}`} off)`,
        });
      } catch (e) {
        return res.status(e.status || 400).json({ message: e.message });
      }
    }

    return res.status(400).json({ message: "Unknown redemption type." });
  } catch (err) { serverError(res, err, "Redemption check"); }
};
