import GiftCard from "../model/GiftCard.js";
import { requireUser, locFilter, canSeeLoc, isAdminUser } from "../utils/userScope.js";
import { round2, randomCode, cleanCode, isValidCode } from "../utils/retailMath.js";
import { expireStaleGiftCards, findOrCreateCustomer, HttpError, toId } from "../utils/redemptions.js";
import { nextNumber } from "../utils/nextNumber.js";
import { postMoneyIn, removeMoneyIn, MONEY_MODES } from "../utils/daybook.js";
import { istDayStart, istDayEnd, addIstDays } from "../utils/ist.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  console.error(`${label} error:`, err);
  return res.status(500).json({ message: "Server error", error: err.message });
};
const by = (who) => who.user.email || who.user.username || "";
const MAX_VALUE = 1000000;

/** `count` new unique codes (checked against the database; retried on clash). */
const uniqueCodes = async (count) => {
  const codes = new Set();
  for (let round = 0; round < 10 && codes.size < count; round++) {
    const batch = [];
    while (batch.length < (count - codes.size) * 2) batch.push(randomCode("GC-"));
    const taken = new Set((await GiftCard.find({ code: { $in: batch } }).select("code").lean()).map((c) => c.code));
    for (const c of batch) if (!taken.has(c) && codes.size < count) codes.add(c);
  }
  if (codes.size < count) throw new HttpError(500, "Could not generate unique gift card codes, please retry.");
  return [...codes];
};

// GET /api/gift-cards?userId=&status=&search=&fromDate=&toDate=&customerId=
export const listGiftCards = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    await expireStaleGiftCards();
    const { status = "", search = "", fromDate, toDate, customerId } = req.query;
    const q = { ...locFilter(who.scope) };
    if (["active", "blocked", "expired"].includes(status)) q.status = status;
    if (toId(customerId)) q.soldToCustomerId = toId(customerId);
    if (fromDate || toDate) {
      q.issueDate = {};
      if (fromDate) q.issueDate.$gte = istDayStart(new Date(`${fromDate}T12:00:00+05:30`));
      if (toDate) q.issueDate.$lte = istDayEnd(new Date(`${toDate}T12:00:00+05:30`));
    }
    const term = String(search).trim();
    if (term) q.$or = [
      { code: { $regex: escapeRegex(term.toUpperCase()) } },
      { soldToName: { $regex: escapeRegex(term), $options: "i" } },
      { saleInvoiceRef: { $regex: escapeRegex(term.toUpperCase()) } },
    ];
    const cards = await GiftCard.find(q).select("-history").sort({ createdAt: -1 }).limit(2000).lean();
    res.json({ cards });
  } catch (err) { fail(res, err, "List gift cards"); }
};

/**
 * POST /api/gift-cards/issue — issue (sell) one or many cards of the same value.
 * body: { userId, count, value, code? (single card only), expiryDays? | expiryDate?, reloadable,
 *         paymentMode: cash|bank|upi|complimentary, customerPhone?, customerName?, locCode? }
 * A sale posts one daybook "Gift Card Sale" entry for count × value (complimentary = admin only, no money).
 */
export const issueGiftCards = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const b = req.body;
    const count = Number(b.count ?? 1);
    const value = round2(Number(b.value));
    const mode = String(b.paymentMode || "");
    if (!Number.isInteger(count) || count < 1 || count > 500) return res.status(400).json({ message: "Number of cards must be a whole number from 1 to 500." });
    if (!(value > 0) || value > MAX_VALUE) return res.status(400).json({ message: `Card value must be more than ₹0 and at most ₹${MAX_VALUE}.` });
    if (![...MONEY_MODES, "complimentary"].includes(mode)) return res.status(400).json({ message: "Choose how the card was paid for (cash, bank, UPI) or complimentary." });
    if (mode === "complimentary" && !isAdminUser(who.user)) return res.status(403).json({ message: "Only an admin can issue complimentary gift cards." });

    let codes;
    if (b.code && String(b.code).trim()) {
      if (count !== 1) return res.status(400).json({ message: "A code can only be typed in when issuing a single card." });
      const code = cleanCode(b.code);
      if (!isValidCode(code)) return res.status(400).json({ message: "Code must be 3–40 letters, digits or dashes." });
      if (await GiftCard.exists({ code })) return res.status(409).json({ message: `Gift card code ${code} already exists.` });
      codes = [code];
    } else {
      codes = await uniqueCodes(count);
    }

    let expiryDate = null;
    const now = new Date();
    if (b.expiryDate) {
      const d = new Date(`${String(b.expiryDate).slice(0, 10)}T12:00:00+05:30`);
      if (Number.isNaN(d.getTime()) || d < now) return res.status(400).json({ message: "Expiry date must be in the future." });
      expiryDate = istDayEnd(d);
    } else if (Number(b.expiryDays) > 0) {
      expiryDate = istDayEnd(addIstDays(now, Math.floor(Number(b.expiryDays))));
    }

    const customer = b.customerPhone ? await findOrCreateCustomer({ name: b.customerName, phone: b.customerPhone, locCode: b.locCode || who.user.locCode, createdBy: by(who) }) : null;
    const locCode = String(b.locCode || who.user.locCode || "");
    const saleRef = await nextNumber("GIFT_CARD_SALE", "GCS-");
    const docs = codes.map((code) => ({
      code, initialValue: value, balance: value, issueDate: now, expiryDate, reloadable: !!b.reloadable, status: "active",
      issueType: mode === "complimentary" ? "complimentary" : "sold",
      soldToCustomerId: customer?._id || null, soldToName: customer?.name || String(b.customerName || "").trim(),
      saleInvoiceRef: saleRef, locCode, createdBy: by(who),
      history: [{ type: "issue", amount: value, reference: saleRef, by: by(who), note: mode === "complimentary" ? "Complimentary" : `Sold (${mode})` }],
    }));

    let cards;
    try {
      cards = await GiftCard.insertMany(docs, { ordered: true });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ message: "A gift card code clashed with an existing one. Please try again." });
      throw e;
    }
    if (mode !== "complimentary") {
      try {
        await postMoneyIn({
          invoiceNo: saleRef, category: "Gift Card Sale", subCategory: "Gift Card", amount: count * value, mode, locCode,
          remark: `${count} gift card${count > 1 ? "s" : ""} × ₹${value}`, customerName: customer?.name || b.customerName || "", quantity: count,
        });
      } catch (e) {
        await GiftCard.deleteMany({ _id: { $in: cards.map((c) => c._id) } }); // no money recorded → no cards
        throw e;
      }
    }
    res.status(201).json({ saleRef, cards: cards.map((c) => { const o = c.toObject(); delete o.history; return o; }) });
  } catch (err) { fail(res, err, "Issue gift cards"); }
};

// GET /api/gift-cards/:id?userId=
export const getGiftCard = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    await expireStaleGiftCards();
    const card = toId(req.params.id) ? await GiftCard.findById(req.params.id).lean() : null;
    if (!card) return res.status(404).json({ message: "Gift card not found" });
    if (!canSeeLoc(who.scope, card.locCode)) return res.status(403).json({ message: "This gift card was issued at another store." });
    res.json(card);
  } catch (err) { fail(res, err, "Get gift card"); }
};

// GET /api/gift-cards/batch/:saleRef?userId= — every card of one issue (for the printable sheet)
export const getGiftCardBatch = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const cards = await GiftCard.find({ saleInvoiceRef: String(req.params.saleRef || "").toUpperCase(), ...locFilter(who.scope) })
      .select("-history").sort({ code: 1 }).lean();
    if (!cards.length) return res.status(404).json({ message: "No gift cards found for this issue." });
    res.json({ saleRef: req.params.saleRef, cards });
  } catch (err) { fail(res, err, "Gift card batch"); }
};

// POST /api/gift-cards/:id/reload { userId, amount, paymentMode } — reloadable, active cards only; money in.
export const reloadGiftCard = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const amount = round2(Number(req.body.amount));
    const mode = String(req.body.paymentMode || "");
    if (!(amount > 0) || amount > MAX_VALUE) return res.status(400).json({ message: "Enter a reload amount more than ₹0." });
    if (!MONEY_MODES.includes(mode)) return res.status(400).json({ message: "Choose how the reload was paid (cash, bank or UPI)." });
    const card = toId(req.params.id) ? await GiftCard.findById(req.params.id).lean() : null;
    if (!card) return res.status(404).json({ message: "Gift card not found" });
    if (!card.reloadable) return res.status(409).json({ message: `Gift card ${card.code} is not reloadable.` });

    const ref = await nextNumber("GIFT_CARD_RELOAD", "GCR-");
    const now = new Date();
    const updated = await GiftCard.findOneAndUpdate(
      { _id: card._id, status: "active", reloadable: true, $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] },
      { $inc: { balance: amount }, $push: { history: { type: "reload", amount, reference: ref, by: by(who), note: `Paid by ${mode}` } } },
      { new: true }
    ).lean();
    if (!updated) return res.status(409).json({ message: `Gift card ${card.code} is ${card.status === "active" ? "expired" : card.status} and cannot be reloaded.` });
    try {
      await postMoneyIn({
        invoiceNo: ref, category: "Gift Card Reload", subCategory: "Gift Card", amount, mode,
        locCode: String(req.body.locCode || who.user.locCode || card.locCode || ""), remark: `Reload ${card.code}`, customerName: card.soldToName || "",
      });
    } catch (e) {
      await GiftCard.updateOne({ _id: card._id }, { $inc: { balance: -amount }, $pull: { history: { reference: ref } } });
      throw e;
    }
    res.json(updated);
  } catch (err) { fail(res, err, "Reload gift card"); }
};

// POST /api/gift-cards/:id/block { userId, blocked: true|false } — admin
export const setGiftCardBlocked = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const blocked = req.body.blocked !== false;
    const card = toId(req.params.id) ? await GiftCard.findById(req.params.id).lean() : null;
    if (!card) return res.status(404).json({ message: "Gift card not found" });
    let status;
    if (blocked) {
      if (card.status === "blocked") return res.json(card);
      status = "blocked";
    } else {
      if (card.status !== "blocked") return res.json(card);
      status = card.expiryDate && new Date(card.expiryDate) < new Date() ? "expired" : "active";
    }
    const saved = await GiftCard.findByIdAndUpdate(card._id, { $set: { status } }, { new: true }).lean();
    res.json(saved);
  } catch (err) { fail(res, err, "Block gift card"); }
};
