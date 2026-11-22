// F20: Classes, tutors and bookings.
import mongoose from "mongoose";
import Tutor from "../model/Tutor.js";
import ClassSession from "../model/ClassSession.js";
import Booking, { ClassSeat } from "../model/Booking.js";
import { requireUser, canSeeLoc, isAdminUser, locFilter } from "../utils/userScope.js";
import { findOrCreateCustomer, HttpError } from "../utils/redemptions.js";
import { normalizePhone } from "../utils/retailMath.js";
import { nextNumber } from "../utils/nextNumber.js";
import { istDateString } from "../utils/ist.js";
import { escapeRegex } from "../utils/reportScope.js";
import { classError, isOccurrence, occurrencesBetween, bookingPrice, BOOKING_STATUSES, ACTIVE_BOOKING, isDay } from "../utils/classes.js";

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const byOf = (who) => who.user.email || who.user.username || "";
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

/** Tutors and classes: admins anywhere, a store manager at their own store. */
const canManage = (user, locCode) => isAdminUser(user) || (user.role === "store_manager" && String(user.locCode || "") === String(locCode || ""));
/** The store a new tutor/class/booking is for: chosen (in scope) or the user's only store. */
const storeOf = (who, locCode) => {
  const loc = String(locCode || (!who.scope.all && who.scope.locCodes.length === 1 ? who.scope.locCodes[0] : "") || "");
  if (!loc) throw new HttpError(400, "Choose the store.");
  if (!canSeeLoc(who.scope, loc)) throw new HttpError(403, "That store is outside your access.");
  return loc;
};

// ─── Seats ────────────────────────────────────────────────────────────────
/** Take a seat in one occurrence; false when the class is full. */
const takeSeat = async (cls, date) => {
  try {
    const r = await ClassSeat.findOneAndUpdate({ classId: cls._id, date, booked: { $lt: cls.maxParticipants } }, { $inc: { booked: 1 } }, { upsert: true, new: true });
    return !!r;
  } catch (e) {
    if (e.code === 11000) return false; // the seat row exists and is full (the upsert collided)
    throw e;
  }
};
const releaseSeat = (classId, date) => ClassSeat.updateOne({ classId, date, booked: { $gt: 0 } }, { $inc: { booked: -1 } });
const seatsFor = async (classId, dates) => new Map((await ClassSeat.find({ classId, date: { $in: dates } }).lean()).map((s) => [s.date, s.booked]));

// ─── Tutors ───────────────────────────────────────────────────────────────
const tutorFields = (b, { partial = false } = {}) => {
  const set = {};
  if (!partial || b.name !== undefined) { set.name = clean(b.name, 120); if (!set.name) throw new HttpError(400, "Enter the tutor's name."); }
  if (b.phone !== undefined) {
    if (String(b.phone).trim()) { set.phone = normalizePhone(b.phone); if (!set.phone) throw new HttpError(400, "Enter a valid phone number."); } else set.phone = "";
  }
  if (b.email !== undefined) { set.email = clean(b.email, 120); if (set.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(set.email)) throw new HttpError(400, "Enter a valid email."); }
  if (b.internalOrExternal !== undefined) { if (!["internal", "external"].includes(b.internalOrExternal)) throw new HttpError(400, "Tutor must be internal or external."); set.internalOrExternal = b.internalOrExternal; }
  for (const k of ["expertise", "address"]) if (b[k] !== undefined) set[k] = clean(b[k], 300);
  if (b.active !== undefined) set.active = b.active === true || b.active === "true";
  return set;
};

// GET /api/tutors?userId=&locCode=&active=1&search=
export const listTutors = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const q = req.query;
    if (q.locCode && !canSeeLoc(who.scope, q.locCode)) throw new HttpError(403, "That store is outside your access.");
    const filter = { ...locFilter(who.scope), ...(q.locCode ? { locCode: String(q.locCode) } : {}), ...(q.active === "1" ? { active: true } : {}) };
    if (q.search) filter.$or = [{ name: { $regex: escapeRegex(q.search), $options: "i" } }, { expertise: { $regex: escapeRegex(q.search), $options: "i" } }];
    res.json({ tutors: await Tutor.find(filter).sort({ active: -1, name: 1 }).lean() });
  } catch (err) { fail(res, err, "List tutors"); }
};

// POST /api/tutors  body { userId, locCode, name, expertise?, phone?, email?, internalOrExternal?, address? }
export const createTutor = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const locCode = storeOf(who, req.body.locCode);
    if (!canManage(who.user, locCode)) throw new HttpError(403, "Only an admin or this store's manager can add tutors.");
    const doc = await Tutor.create({ ...tutorFields(req.body), locCode, active: true, createdBy: byOf(who) });
    res.status(201).json(doc.toObject());
  } catch (err) { fail(res, err, "Create tutor"); }
};

// PUT /api/tutors/:id
export const updateTutor = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid tutor id.");
    const t = await Tutor.findById(req.params.id).lean();
    if (!t) throw new HttpError(404, "Tutor not found.");
    if (!canSeeLoc(who.scope, t.locCode) || !canManage(who.user, t.locCode)) throw new HttpError(403, "Only an admin or this store's manager can edit tutors.");
    const set = tutorFields(req.body, { partial: true });
    if (!Object.keys(set).length) throw new HttpError(400, "Nothing to change.");
    const updated = await Tutor.findByIdAndUpdate(t._id, { $set: set }, { new: true }).lean();
    if (set.name) await ClassSession.updateMany({ tutorId: t._id }, { $set: { tutorName: set.name } });
    res.json(updated);
  } catch (err) { fail(res, err, "Update tutor"); }
};

// ─── Classes ──────────────────────────────────────────────────────────────
const classFields = async (b, locCode, { partial = false } = {}) => {
  const err = classError(b, { partial });
  if (err) throw new HttpError(400, err);
  const set = {};
  for (const k of ["name", "type"]) if (b[k] !== undefined) set[k] = clean(b[k], 120);
  for (const k of ["date", "time", "recurring", "pricingType"]) if (b[k] !== undefined) set[k] = b[k];
  if (b.endDate !== undefined) set.endDate = b.endDate || "";
  if (b.maxParticipants !== undefined) set.maxParticipants = Number(b.maxParticipants);
  if (b.price !== undefined) set.price = Math.round((Number(b.price) || 0) * 100) / 100;
  if (b.durationMinutes !== undefined && b.durationMinutes !== "") set.durationMinutes = Number(b.durationMinutes);
  if (b.active !== undefined) set.active = b.active === true || b.active === "true";
  if (b.tutorId !== undefined) {
    if (!b.tutorId) { set.tutorId = null; set.tutorName = ""; }
    else {
      if (!isId(b.tutorId)) throw new HttpError(400, "Invalid tutor.");
      const t = await Tutor.findById(b.tutorId).lean();
      if (!t || t.locCode !== locCode) throw new HttpError(400, "That tutor is not at this store.");
      if (!t.active) throw new HttpError(400, `${t.name} is inactive.`);
      set.tutorId = t._id; set.tutorName = t.name;
    }
  }
  return set;
};

/** Next occurrences (from today) with seats used. */
const withSeats = async (cls, from, days = 30) => {
  const dates = occurrencesBetween(cls, from, addDays(from, days), 60);
  const seats = await seatsFor(cls._id, dates);
  return dates.map((d) => ({ date: d, booked: seats.get(d) || 0, left: Math.max(0, cls.maxParticipants - (seats.get(d) || 0)) }));
};

// GET /api/classes?userId=&locCode=&active=1&search=
export const listClasses = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const q = req.query;
    if (q.locCode && !canSeeLoc(who.scope, q.locCode)) throw new HttpError(403, "That store is outside your access.");
    const filter = { ...locFilter(who.scope), ...(q.locCode ? { locCode: String(q.locCode) } : {}), ...(q.active === "1" ? { active: true } : {}) };
    if (q.search) filter.$or = [{ name: { $regex: escapeRegex(q.search), $options: "i" } }, { type: { $regex: escapeRegex(q.search), $options: "i" } }, { tutorName: { $regex: escapeRegex(q.search), $options: "i" } }];
    const today = istDateString();
    const classes = await ClassSession.find(filter).sort({ active: -1, date: 1, time: 1 }).lean();
    const rows = [];
    for (const c of classes) {
      const next = (await withSeats(c, today, 366)).slice(0, 1)[0] || null;
      rows.push({ ...c, next });
    }
    res.json({ today, classes: rows });
  } catch (err) { fail(res, err, "List classes"); }
};

// GET /api/classes/:id?userId=&from=YYYY-MM-DD — class with its upcoming occurrences and seats
export const getClass = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid class id.");
    const c = await ClassSession.findById(req.params.id).lean();
    if (!c) throw new HttpError(404, "Class not found.");
    if (!canSeeLoc(who.scope, c.locCode)) throw new HttpError(403, "This class belongs to another store.");
    const from = isDay(req.query.from) ? req.query.from : istDateString();
    res.json({ ...c, occurrences: await withSeats(c, from, 60), canManage: canManage(who.user, c.locCode) });
  } catch (err) { fail(res, err, "Get class"); }
};

// POST /api/classes  body { userId, locCode, name, type?, maxParticipants, pricingType, price, date, time, durationMinutes?, recurring?, endDate?, tutorId? }
export const createClass = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const locCode = storeOf(who, req.body.locCode);
    if (!canManage(who.user, locCode)) throw new HttpError(403, "Only an admin or this store's manager can add classes.");
    const set = await classFields({ recurring: "none", pricingType: "per_session", ...req.body }, locCode);
    const doc = await ClassSession.create({ ...set, locCode, active: true, createdBy: byOf(who) });
    res.status(201).json(doc.toObject());
  } catch (err) { fail(res, err, "Create class"); }
};

// PUT /api/classes/:id — refuses changes that would strand bookings (schedule) or overfill a day (capacity)
export const updateClass = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid class id.");
    const c = await ClassSession.findById(req.params.id).lean();
    if (!c) throw new HttpError(404, "Class not found.");
    if (!canSeeLoc(who.scope, c.locCode) || !canManage(who.user, c.locCode)) throw new HttpError(403, "Only an admin or this store's manager can edit classes.");
    const merged = { ...c, ...req.body };
    if (classError(merged)) throw new HttpError(400, classError(merged));
    const set = await classFields(req.body, c.locCode, { partial: true });
    if (!Object.keys(set).length) throw new HttpError(400, "Nothing to change.");
    const today = istDateString();
    const upcoming = await Booking.find({ classId: c._id, status: { $in: ACTIVE_BOOKING }, date: { $gte: today } }).select("date").lean();
    const next = { ...c, ...set };
    const stranded = [...new Set(upcoming.filter((b) => !isOccurrence(next, b.date)).map((b) => b.date))];
    if (stranded.length) throw new HttpError(409, `Bookings exist on ${stranded.slice(0, 3).join(", ")}${stranded.length > 3 ? "…" : ""}, which the new schedule does not include. Cancel or move them first.`);
    if (set.maxParticipants !== undefined) {
      const busiest = await ClassSeat.findOne({ classId: c._id, date: { $gte: today }, booked: { $gt: set.maxParticipants } }).lean();
      if (busiest) throw new HttpError(409, `${busiest.booked} people are booked on ${busiest.date}; the maximum cannot go below that.`);
    }
    res.json(await ClassSession.findByIdAndUpdate(c._id, { $set: set }, { new: true }).lean());
  } catch (err) { fail(res, err, "Update class"); }
};

// ─── Bookings ─────────────────────────────────────────────────────────────
// GET /api/bookings?userId=&classId=&date=&status=&locCode=&fromDate=&toDate=&search=
export const listBookings = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const q = req.query;
    if (q.locCode && !canSeeLoc(who.scope, q.locCode)) throw new HttpError(403, "That store is outside your access.");
    const filter = { ...locFilter(who.scope), ...(q.locCode ? { locCode: String(q.locCode) } : {}) };
    if (q.classId) { if (!isId(q.classId)) throw new HttpError(400, "Invalid class."); filter.classId = q.classId; }
    if (q.date) filter.date = String(q.date);
    else if (q.fromDate || q.toDate) { filter.date = {}; if (q.fromDate) filter.date.$gte = String(q.fromDate); if (q.toDate) filter.date.$lte = String(q.toDate); }
    if (BOOKING_STATUSES.includes(q.status)) filter.status = q.status;
    if (q.search) {
      const s = String(q.search).trim();
      filter.$or = [{ number: { $regex: escapeRegex(s), $options: "i" } }, { customerName: { $regex: escapeRegex(s), $options: "i" } }, { className: { $regex: escapeRegex(s), $options: "i" } },
        ...(s.replace(/\D/g, "").length >= 4 ? [{ customerPhone: { $regex: escapeRegex(s.replace(/\D/g, "")) } }] : [])];
    }
    const bookings = await Booking.find(filter).sort({ date: -1, time: 1, createdAt: -1 }).limit(1000).lean();
    res.json({ bookings });
  } catch (err) { fail(res, err, "List bookings"); }
};

// POST /api/bookings  body { userId, classId, date, phone, name, membership?, notes? }
// The customer is found (or added) by phone. A class never takes more active bookings than its maximum.
export const createBooking = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { classId, date } = req.body;
    if (!isId(classId)) throw new HttpError(400, "Choose the class.");
    const cls = await ClassSession.findById(classId).lean();
    if (!cls) throw new HttpError(404, "Class not found.");
    if (!canSeeLoc(who.scope, cls.locCode)) throw new HttpError(403, "This class belongs to another store.");
    if (!cls.active) throw new HttpError(409, `${cls.name} is no longer running.`);
    if (!isOccurrence(cls, date)) throw new HttpError(400, `${cls.name} does not run on ${date || "that day"}.`);
    if (date < istDateString()) throw new HttpError(400, "That class day has already passed.");
    if (!String(req.body.phone || "").trim()) throw new HttpError(400, "Enter the customer's phone number.");
    const customer = await findOrCreateCustomer({ name: clean(req.body.name, 120), phone: req.body.phone, locCode: cls.locCode, createdBy: byOf(who) });
    const dup = await Booking.findOne({ classId: cls._id, date, customerId: customer._id, status: { $in: ACTIVE_BOOKING } }).lean();
    if (dup) throw new HttpError(409, `${customer.name} is already booked for ${cls.name} on ${date} (${dup.number}).`);
    if (!(await takeSeat(cls, date))) throw new HttpError(409, `${cls.name} is full on ${date} (maximum ${cls.maxParticipants}).`);
    try {
      const membership = clean(req.body.membership, 80);
      const doc = await Booking.create({
        number: await nextNumber("BOOKING", "BK-"), customerId: customer._id, customerName: customer.name, customerPhone: customer.phone,
        classId: cls._id, className: cls.name, date, time: cls.time, membership, price: bookingPrice(cls, membership), status: "booked",
        locCode: cls.locCode, notes: clean(req.body.notes, 300), createdBy: byOf(who),
      });
      res.status(201).json(doc.toObject());
    } catch (e) {
      await releaseSeat(cls._id, date);
      throw e;
    }
  } catch (err) { fail(res, err, "Create booking"); }
};

// POST /api/bookings/:id/status  body { userId, status } — cancelling frees the seat; un-cancelling needs a free seat
export const changeBookingStatus = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    if (!isId(req.params.id)) throw new HttpError(400, "Invalid booking id.");
    const status = req.body.status;
    if (!BOOKING_STATUSES.includes(status)) throw new HttpError(400, "Status must be booked, attended or cancelled.");
    const b = await Booking.findById(req.params.id).lean();
    if (!b) throw new HttpError(404, "Booking not found.");
    if (!canSeeLoc(who.scope, b.locCode)) throw new HttpError(403, "This booking belongs to another store.");
    if (b.status === status) return res.json(b);
    if (status === "attended" && b.date > istDateString()) throw new HttpError(400, "Attendance can be marked on or after the class day.");
    const wasActive = ACTIVE_BOOKING.includes(b.status), nowActive = ACTIVE_BOOKING.includes(status);
    if (!wasActive && nowActive) {
      const cls = await ClassSession.findById(b.classId).lean();
      if (!cls) throw new HttpError(409, "The class no longer exists.");
      if (!(await takeSeat(cls, b.date))) throw new HttpError(409, `${cls.name} is full on ${b.date} (maximum ${cls.maxParticipants}).`);
    }
    // Conditional on the status we read, so a seat is never released twice
    const updated = await Booking.findOneAndUpdate({ _id: b._id, status: b.status }, { $set: { status } }, { new: true }).lean();
    if (!updated) {
      if (!wasActive && nowActive) await releaseSeat(b.classId, b.date);
      throw new HttpError(409, "Someone else changed this booking just now. Reload and try again.");
    }
    if (wasActive && !nowActive) await releaseSeat(b.classId, b.date);
    res.json(updated);
  } catch (err) { fail(res, err, "Change booking status"); }
};
