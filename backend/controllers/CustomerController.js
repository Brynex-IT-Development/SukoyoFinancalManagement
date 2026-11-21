import Customer from "../model/Customer.js";
import SalesInvoice from "../model/SalesInvoice.js";
import LoyaltyLedger from "../model/LoyaltyLedger.js";
import StoreCredit from "../model/StoreCredit.js";
import GiftCard from "../model/GiftCard.js";
import { requireUser, locFilter, canSeeLoc } from "../utils/userScope.js";
import { normalizePhone, round2, valuePerPoint } from "../utils/retailMath.js";
import {
  HttpError, changePoints, expireStaleCredits, getLoyaltySettings, toId,
} from "../utils/redemptions.js";

const RETURN_CATEGORIES = ["return", "refund", "cancel"];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  console.error(`${label} error:`, err);
  return res.status(500).json({ message: "Server error", error: err.message });
};

const EDITABLE = ["name", "email", "address", "city", "state", "pincode", "gstin"];
const pickEditable = (body) => {
  const out = {};
  for (const k of EDITABLE) if (body[k] !== undefined) out[k] = String(body[k] ?? "").trim();
  if (out.gstin) out.gstin = out.gstin.toUpperCase();
  return out;
};

/** A store user may open a customer created at their store or who bought there. */
const canSeeCustomer = async (scope, customer) => {
  if (canSeeLoc(scope, customer.locCode)) return true;
  if (scope.all) return true;
  return !!(await SalesInvoice.exists({ customerId: customer._id, locCode: { $in: scope.locCodes } }));
};

// GET /api/customers?userId=&search=&status=&page=&limit=
export const listCustomers = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { search = "", status = "", page = 1, limit = 50 } = req.query;
    const q = { ...locFilter(who.scope) };
    if (status === "active" || status === "inactive") q.status = status;
    const term = String(search).trim();
    if (term) {
      const digits = term.replace(/\D/g, "");
      const or = [{ name: { $regex: escapeRegex(term), $options: "i" } }];
      if (digits.length >= 3) or.push({ phone: { $regex: escapeRegex(digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits) } });
      q.$or = or;
    }
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 5000);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
    const [customers, total] = await Promise.all([
      Customer.find(q).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      Customer.countDocuments(q),
    ]);
    res.json({ customers, total });
  } catch (err) { fail(res, err, "List customers"); }
};

// GET /api/customers/lookup?phone=&locCode=&userId=   (billing screen; any store may look up any customer)
export const lookupCustomer = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const phone = normalizePhone(req.query.phone);
    if (!phone) return res.status(400).json({ message: "Enter a valid phone number." });
    const customer = await Customer.findOne({ phone }).lean();
    const settings = await getLoyaltySettings(req.query.locCode);
    const loyalty = {
      enabled: settings.enabled !== false,
      valuePerPoint: valuePerPoint(settings),
      maxRedeemPercent: settings.maxRedeemPercent,
      minInvoiceForRedeem: settings.minInvoiceForRedeem,
    };
    if (!customer) return res.json({ customer: null, phone, loyalty, storeCredits: [] });
    await expireStaleCredits();
    const storeCredits = await StoreCredit.find({ customerId: customer._id, status: "open" })
      .select("number balance amount expiryDate issueDate").sort({ expiryDate: 1 }).lean();
    const fresh = await Customer.findById(customer._id).lean();
    res.json({ customer: fresh, phone, loyalty, storeCredits });
  } catch (err) { fail(res, err, "Customer lookup"); }
};

// GET /api/customers/:id?userId=
export const getCustomer = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const id = toId(req.params.id);
    const customer = id ? await Customer.findById(id).lean() : null;
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    if (!(await canSeeCustomer(who.scope, customer))) return res.status(403).json({ message: "This customer belongs to another store." });

    await expireStaleCredits();
    const invoiceFilter = { customerId: customer._id, ...(who.scope.all ? {} : { locCode: { $in: who.scope.locCodes } }) };
    const [invoices, ledger, storeCredits, fresh, giftCards] = await Promise.all([
      SalesInvoice.find(invoiceFilter)
        .select("invoiceNumber invoiceDate finalTotal amountDue totalRedeemed category branch locCode status returnStatus loyaltyPointsEarned loyaltyPointsUsed refundBreakdown")
        .sort({ invoiceDate: -1, createdAt: -1 }).limit(500).lean(),
      LoyaltyLedger.find({ customerId: customer._id }).sort({ createdAt: -1 }).limit(500).lean(),
      StoreCredit.find({ customerId: customer._id }).sort({ createdAt: -1 }).lean(),
      Customer.findById(customer._id).lean(),
      GiftCard.find({ soldToCustomerId: customer._id }).select("-history").sort({ createdAt: -1 }).lean(),
    ]);
    const sales = invoices.filter((i) => !RETURN_CATEGORIES.includes(String(i.category || "").toLowerCase()));
    const stats = {
      // The return flow reduces a sale's finalTotal in place after a PARTIAL return, but leaves it
      // unchanged after a FULL return. So: partly returned → its (already reduced) total; fully returned → 0.
      // Return invoices are not subtracted again.
      totalSpend: round2(sales.reduce((s, i) => s + (String(i.returnStatus).toLowerCase() === "full" ? 0 : Number(i.finalTotal) || 0), 0)),
      invoiceCount: sales.length,
      returnCount: invoices.length - sales.length,
      lastVisit: invoices[0]?.invoiceDate || null,
    };
    res.json({ customer: fresh, stats, invoices, ledger, storeCredits, giftCards });
  } catch (err) { fail(res, err, "Get customer"); }
};

// POST /api/customers
export const createCustomer = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const phone = normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ message: "Enter a valid phone number (10-digit mobile, or 6–15 digits)." });
    const data = pickEditable(req.body);
    if (!data.name) return res.status(400).json({ message: "Customer name is required." });
    const existing = await Customer.findOne({ phone }).select("_id name").lean();
    if (existing) return res.status(409).json({ message: `A customer with this phone already exists (${existing.name}).`, customerId: existing._id });
    const customer = await Customer.create({
      ...data, phone, status: "active",
      locCode: String(req.body.locCode || who.user.locCode || ""),
      createdBy: who.user.email || who.user.username || "",
    });
    res.status(201).json(customer);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "A customer with this phone already exists." });
    fail(res, err, "Create customer");
  }
};

// PUT /api/customers/:id
export const updateCustomer = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const customer = toId(req.params.id) ? await Customer.findById(req.params.id).lean() : null;
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    if (!(await canSeeCustomer(who.scope, customer))) return res.status(403).json({ message: "This customer belongs to another store." });
    const update = pickEditable(req.body);
    if (update.name === "") return res.status(400).json({ message: "Customer name is required." });
    if (req.body.phone !== undefined) {
      const phone = normalizePhone(req.body.phone);
      if (!phone) return res.status(400).json({ message: "Enter a valid phone number (10-digit mobile, or 6–15 digits)." });
      const clash = await Customer.findOne({ phone, _id: { $ne: customer._id } }).select("name").lean();
      if (clash) return res.status(409).json({ message: `Another customer (${clash.name}) already has this phone.` });
      update.phone = phone;
    }
    const saved = await Customer.findByIdAndUpdate(customer._id, { $set: update }, { new: true, runValidators: true }).lean();
    res.json(saved);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Another customer already has this phone." });
    fail(res, err, "Update customer");
  }
};

// PATCH /api/customers/:id/status { status: "active" | "inactive" }
export const setCustomerStatus = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const status = req.body.status;
    if (!["active", "inactive"].includes(status)) return res.status(400).json({ message: "Status must be active or inactive." });
    const customer = toId(req.params.id) ? await Customer.findById(req.params.id).lean() : null;
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    if (!(await canSeeCustomer(who.scope, customer))) return res.status(403).json({ message: "This customer belongs to another store." });
    const saved = await Customer.findByIdAndUpdate(customer._id, { $set: { status } }, { new: true }).lean();
    res.json(saved);
  } catch (err) { fail(res, err, "Customer status"); }
};

// POST /api/customers/:id/loyalty-adjust { points: signed whole number, note } — admin only
export const adjustLoyalty = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const points = Number(req.body.points);
    const note = String(req.body.note || "").trim();
    if (!Number.isInteger(points) || points === 0) return res.status(400).json({ message: "Points must be a whole number other than 0." });
    if (!note) return res.status(400).json({ message: "A note explaining the adjustment is required." });
    const customer = toId(req.params.id) ? await Customer.findById(req.params.id).lean() : null;
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    await changePoints({ customerId: customer._id, delta: points, type: "adjust", note, createdBy: who.user.email || who.user.username });
    res.json(await Customer.findById(customer._id).lean());
  } catch (err) { fail(res, err, "Loyalty adjust"); }
};
