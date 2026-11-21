import Voucher from "../model/Voucher.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { requireUser } from "../utils/userScope.js";
import { round2, randomCode, cleanCode, isValidCode } from "../utils/retailMath.js";
import { findOrCreateCustomer, HttpError, toId } from "../utils/redemptions.js";
import { nextNumber } from "../utils/nextNumber.js";
import { istDayStart } from "../utils/ist.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...err.extra });
  console.error(`${label} error:`, err);
  return res.status(500).json({ message: "Server error", error: err.message });
};
const by = (who) => who.user.email || who.user.username || "";

/** Store users see store-wide vouchers (no locCode) plus their own store's. */
const visibleTo = (scope) => (scope.all ? {} : { $or: [{ locCode: null }, { locCode: "" }, { locCode: { $in: scope.locCodes } }] });

const toList = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim()).filter(Boolean);
const optInt = (v, label) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${label} must be a whole number of 1 or more (leave empty for no limit).`);
  return n;
};
const dayStart = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00+05:30`) : null);

// GET /api/vouchers?userId=&status=active|inactive|expired&search=&kind=
export const listVouchers = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { status = "", search = "", kind = "" } = req.query;
    const and = [visibleTo(who.scope)];
    // validTo is stored as the start of its IST day and is valid through that whole day
    const todayStart = istDayStart(new Date());
    if (status === "active") and.push({ active: true, $or: [{ validTo: null }, { validTo: { $gte: todayStart } }] });
    if (status === "inactive") and.push({ active: false });
    if (status === "expired") and.push({ validTo: { $ne: null, $lt: todayStart } });
    if (["value", "discount"].includes(kind)) and.push({ kind });
    const term = String(search).trim();
    if (term) and.push({ $or: [{ code: { $regex: escapeRegex(term.toUpperCase()) } }, { name: { $regex: escapeRegex(term), $options: "i" } }, { batchRef: term.toUpperCase() }] });
    const vouchers = await Voucher.find({ $and: and }).select("-usages").sort({ createdAt: -1 }).limit(2000).lean();
    res.json({ vouchers });
  } catch (err) { fail(res, err, "List vouchers"); }
};

/**
 * POST /api/vouchers — admin. Creates one voucher, or `count` vouchers with unique codes.
 * body: { userId, count, code? (single only), codePrefix?, name, kind: value|discount, value,
 *   discountType: flat|percent, maxDiscount?, minBillAmount?, scope: { brands, categories,
 *   subCategories, itemIds, itemLabels }, customerPhone?, customerName?, usageLimitTotal?,
 *   usageLimitPerCustomer?, validFrom?, validTo?, active?, locCode? }
 */
export const createVouchers = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const b = req.body;
    const count = Number(b.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 500) return res.status(400).json({ message: "Number of vouchers must be a whole number from 1 to 500." });
    if (!["value", "discount"].includes(b.kind)) return res.status(400).json({ message: "Choose a voucher type: stored value or discount." });
    const value = round2(Number(b.value));
    if (!(value > 0)) return res.status(400).json({ message: "Voucher value must be more than 0." });
    const discountType = b.kind === "discount" && b.discountType === "percent" ? "percent" : "flat";
    if (discountType === "percent" && value > 100) return res.status(400).json({ message: "A percent discount cannot be more than 100%." });
    const maxDiscount = b.maxDiscount === undefined || b.maxDiscount === null || b.maxDiscount === "" ? null : round2(Number(b.maxDiscount));
    if (maxDiscount !== null && !(maxDiscount > 0)) return res.status(400).json({ message: "Max discount must be more than 0 (or empty)." });
    const minBillAmount = Math.max(0, round2(Number(b.minBillAmount) || 0));
    const usageLimitTotal = optInt(b.usageLimitTotal, "Total usage limit");
    const usageLimitPerCustomer = optInt(b.usageLimitPerCustomer, "Per-customer limit");
    const validFrom = dayStart(b.validFrom);
    const validTo = dayStart(b.validTo);
    if ((b.validFrom && Number.isNaN(validFrom?.getTime())) || (b.validTo && Number.isNaN(validTo?.getTime()))) return res.status(400).json({ message: "Invalid date." });
    if (validFrom && validTo && validTo < validFrom) return res.status(400).json({ message: "Valid-to date is before valid-from date." });

    const scope = {
      brands: toList(b.scope?.brands), categories: toList(b.scope?.categories),
      subCategories: toList(b.scope?.subCategories), itemIds: toList(b.scope?.itemIds).filter((id) => toId(id)),
      itemLabels: toList(b.scope?.itemLabels),
    };

    let customer = null;
    if (b.customerPhone && String(b.customerPhone).trim()) {
      if (count > 1) return res.status(400).json({ message: "A voucher for one customer must be created on its own (count 1)." });
      customer = await findOrCreateCustomer({ name: b.customerName, phone: b.customerPhone, locCode: who.user.locCode, createdBy: by(who) });
    }

    let codes;
    if (b.code && String(b.code).trim()) {
      if (count !== 1) return res.status(400).json({ message: "A code can only be typed in when creating a single voucher." });
      const code = cleanCode(b.code);
      if (!isValidCode(code)) return res.status(400).json({ message: "Code must be 3–40 letters, digits or dashes." });
      if (await Voucher.exists({ code })) return res.status(409).json({ message: `Voucher code ${code} already exists.` });
      codes = [code];
    } else {
      const prefix = cleanCode(b.codePrefix || "VC-").replace(/[^A-Z0-9-]/g, "").slice(0, 10) || "VC-";
      const set = new Set();
      for (let round = 0; round < 10 && set.size < count; round++) {
        const batch = Array.from({ length: (count - set.size) * 2 }, () => randomCode(prefix.endsWith("-") ? prefix : `${prefix}-`));
        const taken = new Set((await Voucher.find({ code: { $in: batch } }).select("code").lean()).map((v) => v.code));
        for (const c of batch) if (!taken.has(c) && set.size < count) set.add(c);
      }
      if (set.size < count) throw new HttpError(500, "Could not generate unique voucher codes, please retry.");
      codes = [...set];
    }

    const batchRef = count > 1 ? await nextNumber("VOUCHER_BATCH", "VB-") : "";
    const docs = codes.map((code) => ({
      code, name: String(b.name || "").trim(), kind: b.kind, value, discountType, maxDiscount: b.kind === "discount" ? maxDiscount : null,
      minBillAmount, scope, customerId: customer?._id || null, customerName: customer?.name || "",
      usageLimitTotal, usageLimitPerCustomer, usedCount: 0, balance: b.kind === "value" ? value : 0,
      validFrom, validTo, active: b.active !== false, locCode: b.locCode ? String(b.locCode) : null, batchRef, createdBy: by(who),
    }));
    try {
      const vouchers = await Voucher.insertMany(docs, { ordered: true });
      res.status(201).json({ batchRef, vouchers });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ message: "A voucher code clashed with an existing one. Please try again." });
      throw e;
    }
  } catch (err) { fail(res, err, "Create vouchers"); }
};

// GET /api/vouchers/batch/:batchRef?userId= — vouchers created together (printable sheet)
export const getVoucherBatch = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const vouchers = await Voucher.find({ batchRef: String(req.params.batchRef || "").toUpperCase(), ...visibleTo(who.scope) }).select("-usages").sort({ code: 1 }).lean();
    if (!vouchers.length) return res.status(404).json({ message: "No vouchers found for this batch." });
    res.json({ batchRef: req.params.batchRef, vouchers });
  } catch (err) { fail(res, err, "Voucher batch"); }
};

// GET /api/vouchers/scope-options?userId=&itemSearch= — values for the scope pickers
export const getScopeOptions = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const term = String(req.query.itemSearch || "").trim();
    if (term) {
      const rx = { $regex: escapeRegex(term), $options: "i" };
      const [items, groups] = await Promise.all([
        ShoeItem.find({ $or: [{ itemName: rx }, { sku: rx }], isActive: { $ne: false } }).select("itemName sku").limit(25).lean(),
        ItemGroup.find({ $or: [{ name: rx }, { "items.name": rx }, { "items.sku": rx }] }).select("name items._id items.name items.sku").limit(10).lean(),
      ]);
      const out = items.map((i) => ({ id: String(i._id), label: `${i.itemName}${i.sku ? ` (${i.sku})` : ""}` }));
      const re = new RegExp(escapeRegex(term), "i");
      for (const g of groups) {
        out.push({ id: String(g._id), label: `${g.name} — all variants` });
        for (const gi of (g.items || []).filter((x) => re.test(`${x.name} ${x.sku || ""}`) || re.test(g.name)).slice(0, 10)) {
          out.push({ id: String(gi._id), label: `${g.name} › ${gi.name}${gi.sku ? ` (${gi.sku})` : ""}` });
        }
      }
      return res.json({ items: out.slice(0, 50) });
    }
    const clean = (arr) => [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const [b1, b2, c1, c2, c3, s1] = await Promise.all([
      ShoeItem.distinct("brand"), ItemGroup.distinct("brand"),
      ShoeItem.distinct("itemCategory"), ShoeItem.distinct("category"), ItemGroup.distinct("category"),
      ShoeItem.distinct("subCategory"),
    ]);
    res.json({ brands: clean([...b1, ...b2]), categories: clean([...c1, ...c2, ...c3]), subCategories: clean(s1) });
  } catch (err) { fail(res, err, "Voucher scope options"); }
};

// GET /api/vouchers/:id?userId=
export const getVoucher = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const v = toId(req.params.id) ? await Voucher.findById(req.params.id).lean() : null;
    if (!v) return res.status(404).json({ message: "Voucher not found" });
    if (v.locCode && !who.scope.all && !who.scope.locCodes.includes(String(v.locCode))) return res.status(403).json({ message: "This voucher belongs to another store." });
    res.json(v);
  } catch (err) { fail(res, err, "Get voucher"); }
};

// PATCH /api/vouchers/:id/active { userId, active } — admin
export const setVoucherActive = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const v = await Voucher.findByIdAndUpdate(toId(req.params.id), { $set: { active: req.body.active !== false } }, { new: true }).lean();
    if (!v) return res.status(404).json({ message: "Voucher not found" });
    res.json(v);
  } catch (err) { fail(res, err, "Voucher active"); }
};
