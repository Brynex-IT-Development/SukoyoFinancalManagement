// F16: Enquiries — customers asking for an item; follow-ups and conversion to a sale.
import mongoose from "mongoose";
import Enquiry from "../model/Enquiry.js";
import SalesPerson from "../model/SalesPerson.js";
import SalesInvoice from "../model/SalesInvoice.js";
import ShoeItem from "../model/ShoeItem.js";
import ItemGroup from "../model/ItemGroup.js";
import { requireUser, canSeeLoc, locFilter } from "../utils/userScope.js";
import { normalizePhone } from "../utils/retailMath.js";
import { nextNumber } from "../utils/nextNumber.js";
import { istDateString } from "../utils/ist.js";
import { dateRange, escapeRegex, allOf } from "../utils/reportScope.js";
import { staffName } from "../utils/attendance.js";

export const ENQUIRY_STATUSES = ["new", "contacted", "converted", "closed"];
const OPEN = ["new", "contacted"];
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const byOf = (who) => who.user.email || who.user.username || "";

const fail = (res, err, label) => {
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

/** Store for a new enquiry: admins and cluster managers choose (within scope); single-store users get their own. */
const storeForNew = (who, locCode) => {
  const loc = String(locCode || (!who.scope.all && who.scope.locCodes.length === 1 ? who.scope.locCodes[0] : "") || "");
  if (!loc) return { error: [400, "Choose the store taking the enquiry."] };
  if (!canSeeLoc(who.scope, loc)) return { error: [403, "That store is outside your access."] };
  return { locCode: loc };
};

/** Check the optional fields shared by create and edit. Returns { set } or { error }. */
const checkFields = async (body, locCode, { partial = false } = {}) => {
  const set = {};
  if (!partial || body.customerName !== undefined) {
    set.customerName = clean(body.customerName, 120);
    if (!set.customerName) return { error: "Enter the customer's name." };
  }
  if (!partial || body.phone !== undefined) {
    set.phone = normalizePhone(body.phone);
    if (!set.phone) return { error: "Enter a valid phone number." };
  }
  if (!partial || body.itemWanted !== undefined) {
    set.itemWanted = clean(body.itemWanted, 300);
    if (!set.itemWanted) return { error: "Say which item the customer wants." };
  }
  if (body.notes !== undefined) set.notes = clean(body.notes, 2000);
  if (body.followUpDate !== undefined) {
    const d = clean(body.followUpDate, 10);
    if (d && !isDay(d)) return { error: "Follow-up date must be YYYY-MM-DD." };
    set.followUpDate = d;
  }
  if (body.itemId !== undefined) {
    set.itemId = clean(body.itemId, 40);
    set.itemName = set.itemId ? clean(body.itemName, 200) : "";
    set.itemSku = set.itemId ? clean(body.itemSku, 100) : "";
  }
  if (body.staffId !== undefined) {
    if (!body.staffId) { set.staffId = null; set.staffName = ""; }
    else {
      if (!mongoose.Types.ObjectId.isValid(String(body.staffId))) return { error: "Invalid staff member." };
      const sp = await SalesPerson.findById(body.staffId).select("firstName lastName locCode").lean();
      if (!sp || String(sp.locCode) !== String(locCode)) return { error: "That staff member does not work at this store." };
      set.staffId = sp._id;
      set.staffName = staffName(sp);
    }
  }
  return { set };
};

// GET /api/enquiries?userId=&status=&locCode=&fromDate=&toDate=&due=today|overdue|due&search=
export const listEnquiries = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const q = req.query;
    if (q.locCode && !canSeeLoc(who.scope, q.locCode)) return res.status(403).json({ message: "That store is outside your access." });
    const today = istDateString();
    const base = allOf(locFilter(who.scope), q.locCode ? { locCode: String(q.locCode) } : {}, dateRange("createdAt", q.fromDate, q.toDate));
    const search = clean(q.search, 100);
    const searchFilter = search ? { $or: [
      { number: { $regex: escapeRegex(search), $options: "i" } }, { customerName: { $regex: escapeRegex(search), $options: "i" } },
      { itemWanted: { $regex: escapeRegex(search), $options: "i" } }, ...(normalizePhone(search) || /^\d{4,}$/.test(search) ? [{ phone: { $regex: escapeRegex(search.replace(/\D/g, "")) } }] : []),
    ] } : {};
    const due = q.due === "today" ? { status: { $in: OPEN }, followUpDate: today }
      : q.due === "overdue" ? { status: { $in: OPEN }, followUpDate: { $ne: "", $lt: today } }
      : q.due === "due" ? { status: { $in: OPEN }, followUpDate: { $ne: "", $lte: today } } : {};
    const status = ENQUIRY_STATUSES.includes(q.status) ? { status: q.status } : {};
    const [rows, counts, dueToday, overdue] = await Promise.all([
      Enquiry.find(allOf(base, searchFilter, due, status)).select("-history").sort({ createdAt: -1 }).limit(1000).lean(),
      Enquiry.aggregate([{ $match: allOf(base, searchFilter) }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      Enquiry.countDocuments(allOf(base, { status: { $in: OPEN }, followUpDate: today })),
      Enquiry.countDocuments(allOf(base, { status: { $in: OPEN }, followUpDate: { $ne: "", $lt: today } })),
    ]);
    res.json({
      today, rows: rows.map((r) => ({ ...r, followUp: r.followUpDate && OPEN.includes(r.status) ? (r.followUpDate < today ? "overdue" : r.followUpDate === today ? "today" : "later") : "" })),
      counts: Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.n || 0])), dueToday, overdue,
    });
  } catch (err) { fail(res, err, "List enquiries"); }
};

// POST /api/enquiries  body { userId, locCode?, customerName, phone, itemWanted, itemId?, itemName?, itemSku?, notes?, staffId?, followUpDate? }
export const createEnquiry = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const s = storeForNew(who, req.body.locCode);
    if (s.error) return res.status(s.error[0]).json({ message: s.error[1] });
    const { set, error } = await checkFields(req.body, s.locCode);
    if (error) return res.status(400).json({ message: error });
    const by = byOf(who);
    const doc = await Enquiry.create({
      ...set, locCode: s.locCode, number: await nextNumber("ENQUIRY", "ENQ-"), status: "new", createdBy: by,
      history: [{ status: "new", note: clean(req.body.historyNote, 300) || "Enquiry taken", by, at: new Date() }],
    });
    res.status(201).json(doc.toObject());
  } catch (err) { fail(res, err, "Create enquiry"); }
};

const loadInScope = async (who, id, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(id))) { res.status(400).json({ message: "Invalid enquiry id." }); return null; }
  const e = await Enquiry.findById(id).lean();
  if (!e) { res.status(404).json({ message: "Enquiry not found." }); return null; }
  if (!canSeeLoc(who.scope, e.locCode)) { res.status(403).json({ message: "This enquiry belongs to another store." }); return null; }
  return e;
};

// GET /api/enquiries/:id?userId=
export const getEnquiry = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const e = await loadInScope(who, req.params.id, res);
    if (e) res.json(e);
  } catch (err) { fail(res, err, "Get enquiry"); }
};

// PUT /api/enquiries/:id  body { userId, ...details } — details only; status changes go through /status
export const updateEnquiry = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const e = await loadInScope(who, req.params.id, res);
    if (!e) return;
    const { set, error } = await checkFields(req.body, e.locCode, { partial: true });
    if (error) return res.status(400).json({ message: error });
    if (!Object.keys(set).length) return res.status(400).json({ message: "Nothing to change." });
    const updated = await Enquiry.findByIdAndUpdate(e._id, { $set: set }, { new: true, runValidators: true }).lean();
    res.json(updated);
  } catch (err) { fail(res, err, "Update enquiry"); }
};

// POST /api/enquiries/:id/status  body { userId, status, note?, invoiceNumber?, followUpDate? }
// Appends to history. "Converted" can record the sale's invoice number (it must exist).
export const changeEnquiryStatus = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const e = await loadInScope(who, req.params.id, res);
    if (!e) return;
    const status = req.body.status;
    if (!ENQUIRY_STATUSES.includes(status)) return res.status(400).json({ message: "Status must be new, contacted, converted or closed." });
    const note = clean(req.body.note, 500);
    if (status === e.status && !note) return res.status(400).json({ message: `The enquiry is already ${status}. Add a note to log a follow-up.` });
    const set = { status };
    if (status === "converted") {
      const inv = clean(req.body.invoiceNumber, 40);
      if (inv) {
        const found = await SalesInvoice.findOne({ invoiceNumber: { $regex: `^${escapeRegex(inv)}$`, $options: "i" } }).select("invoiceNumber locCode category").lean();
        if (!found) return res.status(400).json({ message: `No invoice ${inv} was found.` });
        if (/^(return|refund|cancel)$/i.test(found.category || "")) return res.status(400).json({ message: `${found.invoiceNumber} is a return, not a sale.` });
        if (!canSeeLoc(who.scope, found.locCode)) return res.status(403).json({ message: `${found.invoiceNumber} belongs to another store.` });
        set.convertedInvoiceNumber = found.invoiceNumber;
      }
    } else if (e.status === "converted") {
      set.convertedInvoiceNumber = ""; // moved away from converted; the history keeps the old number
    }
    if (req.body.followUpDate !== undefined) {
      const d = clean(req.body.followUpDate, 10);
      if (d && !isDay(d)) return res.status(400).json({ message: "Follow-up date must be YYYY-MM-DD." });
      set.followUpDate = d;
    }
    if (status === "converted" || status === "closed") set.followUpDate = "";
    const historyNote = [note, set.convertedInvoiceNumber ? `Invoice ${set.convertedInvoiceNumber}` : ""].filter(Boolean).join(" · ");
    // Conditional on the status we read, so two people changing it at once cannot lose an entry
    const updated = await Enquiry.findOneAndUpdate(
      { _id: e._id, status: e.status, updatedAt: e.updatedAt },
      { $set: set, $push: { history: { status, note: historyNote, by: byOf(who), at: new Date() } } },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) return res.status(409).json({ message: "Someone else changed this enquiry just now. Reload and try again." });
    res.json(updated);
  } catch (err) { fail(res, err, "Change enquiry status"); }
};

// GET /api/enquiries/items?userId=&search= — up to 10 items (standalone or variants) to link to an enquiry
export const searchEnquiryItems = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const s = clean(req.query.search, 60);
    if (s.length < 2) return res.json({ items: [] });
    const rx = { $regex: escapeRegex(s), $options: "i" };
    const [items, groups] = await Promise.all([
      ShoeItem.find({ $or: [{ itemName: rx }, { sku: rx }] }).select("itemName sku").limit(10).lean(),
      ItemGroup.find({ $or: [{ "items.name": rx }, { "items.sku": rx }] }).select("name items._id items.name items.sku").limit(10).lean(),
    ]);
    const out = items.map((i) => ({ id: String(i._id), name: i.itemName, sku: i.sku || "" }));
    const re = new RegExp(escapeRegex(s), "i");
    for (const g of groups) for (const gi of g.items || []) if (re.test(gi.name || "") || re.test(gi.sku || "")) out.push({ id: String(gi._id), name: gi.name, sku: gi.sku || "", group: g.name });
    res.json({ items: out.slice(0, 10) });
  } catch (err) { fail(res, err, "Search enquiry items"); }
};
