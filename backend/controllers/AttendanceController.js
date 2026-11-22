// F15: Staff attendance — mark, daily view, monthly grid, one person's month, weekly-off setting.
import mongoose from "mongoose";
import Attendance from "../model/Attendance.js";
import SalesPerson from "../model/SalesPerson.js";
import Store from "../model/Store.js";
import Setting from "../model/Setting.js";
import { requireUser, canSeeLoc, isAdminUser } from "../utils/userScope.js";
import { HttpError, UndoStack } from "../utils/redemptions.js";
import { istDateString } from "../utils/ist.js";
import {
  STATUSES, DEFAULT_WEEKLY_OFF, WEEKDAYS, isDay, isMonth, entryError, workedMinutes, daysOfMonth, workingDaysOf,
  monthSummary, weekdayOf, staffName,
} from "../utils/attendance.js";

const WEEKLY_OFF_KEY = "attendanceWeeklyOff";

const fail = (res, err, label) => {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message, ...(err.extra || {}) });
  console.error(`${label} error:`, err);
  res.status(500).json({ message: "Server error", error: err.message });
};

export const getWeeklyOff = async () => {
  const s = await Setting.findById(WEEKLY_OFF_KEY).lean();
  if (!s) return DEFAULT_WEEKLY_OFF;
  return s.value === null ? null : Number(s.value);
};

/** Who may mark: admins for any store; store managers for their own store only. */
const canMarkLoc = (user, locCode) =>
  isAdminUser(user) || (user.role === "store_manager" && String(user.locCode || "") === String(locCode || ""));

/** The store a request is about: required, and within the user's scope. Non-admin single-store users get their own. */
const storeOf = async (who, q) => {
  const locCode = String(q.locCode || (!who.scope.all && who.scope.locCodes.length === 1 ? who.scope.locCodes[0] : "") || "");
  if (!locCode) throw new HttpError(400, "Choose a store.");
  if (!canSeeLoc(who.scope, locCode)) throw new HttpError(403, "That store is outside your access.");
  const store = await Store.findOne({ locCode }).select("name").lean();
  return { locCode, storeName: store?.name || locCode };
};

const staffOfStore = (locCode, { includeInactive = false } = {}) =>
  SalesPerson.find({ locCode, ...(includeInactive ? {} : { isActive: { $ne: false } }) })
    .select("firstName lastName employeeId position locCode isActive").sort({ firstName: 1, lastName: 1 }).lean();

const staffRow = (sp) => ({ _id: sp._id, name: staffName(sp), employeeId: sp.employeeId || "", position: sp.position || "", isActive: sp.isActive !== false });
const recordRow = (r) => r && ({
  _id: r._id, staffId: r.staffId, date: r.date, status: r.status, inTime: r.inTime || "", outTime: r.outTime || "", breakOut: r.breakOut || "", breakIn: r.breakIn || "",
  note: r.note || "", minutes: workedMinutes(r), markedBy: r.markedBy || "", updatedBy: r.updatedBy || "", updatedAt: r.updatedAt,
});

// GET /api/attendance/settings?userId=
export const getAttendanceSettings = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const weeklyOff = await getWeeklyOff();
    res.json({ weeklyOff, weeklyOffLabel: weeklyOff === null ? "No weekly off" : WEEKDAYS[weeklyOff], canEdit: isAdminUser(who.user) });
  } catch (err) { fail(res, err, "Attendance settings"); }
};

// PUT /api/attendance/settings  body { userId, weeklyOff: 0–6 | null } — admin
export const updateAttendanceSettings = async (req, res) => {
  try {
    const who = await requireUser(req, res, { admin: true });
    if (!who) return;
    const v = req.body.weeklyOff;
    const weeklyOff = v === null || v === "" || v === "none" ? null : Number(v);
    if (weeklyOff !== null && !(Number.isInteger(weeklyOff) && weeklyOff >= 0 && weeklyOff <= 6)) {
      return res.status(400).json({ message: "Weekly off must be a weekday (0 = Sunday … 6 = Saturday) or none." });
    }
    await Setting.findByIdAndUpdate(WEEKLY_OFF_KEY, { $set: { value: weeklyOff, updatedBy: who.user.email || "" } }, { upsert: true });
    res.json({ weeklyOff, weeklyOffLabel: weeklyOff === null ? "No weekly off" : WEEKDAYS[weeklyOff] });
  } catch (err) { fail(res, err, "Update attendance settings"); }
};

// GET /api/attendance/day?userId=&locCode=&date=YYYY-MM-DD — the store's staff with their mark for the day
export const getDayAttendance = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const date = req.query.date || istDateString();
    if (!isDay(date)) return res.status(400).json({ message: "Date must be YYYY-MM-DD." });
    const { locCode, storeName } = await storeOf(who, req.query);
    const [staff, records, weeklyOff] = await Promise.all([staffOfStore(locCode, { includeInactive: true }), Attendance.find({ locCode, date }).lean(), getWeeklyOff()]);
    const byStaff = new Map(records.map((r) => [String(r.staffId), r]));
    // Inactive staff only appear when they already have a mark that day
    const rows = staff.filter((sp) => sp.isActive !== false || byStaff.has(String(sp._id)))
      .map((sp) => ({ staff: staffRow(sp), record: recordRow(byStaff.get(String(sp._id))) || null }));
    const count = (s) => rows.filter((r) => r.record?.status === s).length;
    res.json({
      date, locCode, storeName, weeklyOff, isWeeklyOff: weeklyOff !== null && weekdayOf(date) === weeklyOff, isFuture: date > istDateString(),
      canMark: canMarkLoc(who.user, locCode), rows,
      summary: { staff: rows.length, present: count("present"), halfDay: count("half_day"), absent: count("absent"), leave: count("leave"), unmarked: rows.filter((r) => !r.record).length },
    });
  } catch (err) { fail(res, err, "Day attendance"); }
};

// POST /api/attendance/save  body { userId, locCode, date, entries: [{ staffId, recordId?, status, inTime, outTime, breakOut, breakIn, note }] }
// "Save all": new marks are created, marks with recordId are updated (status "" clears a mark).
// Everything is checked first; if any write fails the earlier ones are undone.
export const saveAttendance = async (req, res) => {
  const undo = new UndoStack();
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { date, entries } = req.body;
    if (!isDay(date)) return res.status(400).json({ message: "Date must be YYYY-MM-DD." });
    if (date > istDateString()) return res.status(400).json({ message: "Attendance cannot be marked for a future date." });
    const { locCode } = await storeOf(who, req.body);
    if (!canMarkLoc(who.user, locCode)) return res.status(403).json({ message: "Only an admin or this store's manager can mark attendance here." });
    if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ message: "Nothing to save." });

    const ids = entries.map((e) => String(e.staffId || ""));
    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) return res.status(400).json({ message: "Invalid staff in the list." });
    if (new Set(ids).size !== ids.length) return res.status(400).json({ message: "The same person is in the list twice." });
    const staff = new Map((await SalesPerson.find({ _id: { $in: ids } }).select("firstName lastName employeeId locCode").lean()).map((s) => [String(s._id), s]));
    const existing = new Map((await Attendance.find({ staffId: { $in: ids }, date }).lean()).map((r) => [String(r.staffId), r]));

    // Check every entry before writing anything
    const plan = [];
    for (const e of entries) {
      const sp = staff.get(String(e.staffId));
      if (!sp) throw new HttpError(400, "A staff member in the list no longer exists.");
      const name = staffName(sp);
      if (String(sp.locCode) !== locCode) throw new HttpError(403, `${name} works at another store.`);
      const prev = existing.get(String(e.staffId));
      if (e.recordId) {
        if (!prev || String(prev._id) !== String(e.recordId)
          || (e.updatedAt && new Date(e.updatedAt).getTime() !== new Date(prev.updatedAt).getTime())) {
          throw new HttpError(409, `${name}'s attendance for ${date} was changed by someone else. Reload and try again.`);
        }
        if (e.status === "" || e.status === null) { plan.push({ kind: "clear", prev, name }); continue; }
      } else if (prev) {
        throw new HttpError(409, `${name} is already marked for ${date}.`, { staffId: String(e.staffId), date });
      } else if (!e.status) {
        continue; // left unmarked
      }
      const err = entryError(e);
      if (err) throw new HttpError(400, `${name}: ${err}`);
      const fields = {
        status: e.status, note: String(e.note || "").trim().slice(0, 500),
        ...Object.fromEntries(["inTime", "outTime", "breakOut", "breakIn"].map((k) => [k, e.status === "absent" || e.status === "leave" ? "" : String(e[k] || "").trim()])),
      };
      plan.push(e.recordId ? { kind: "update", prev, fields, name } : { kind: "create", sp, fields, name });
    }
    if (!plan.length) return res.status(400).json({ message: "Nothing to save — choose a status for at least one person." });

    const by = who.user.email || who.user.username || "";
    const saved = [];
    for (const p of plan) {
      if (p.kind === "create") {
        let doc;
        try {
          doc = await Attendance.create({ staffId: p.sp._id, staffName: p.name, employeeId: p.sp.employeeId || "", locCode, date, ...p.fields, markedBy: by, updatedBy: by });
        } catch (e) {
          if (e.code === 11000) throw new HttpError(409, `${p.name} is already marked for ${date}.`, { staffId: String(p.sp._id), date });
          throw e;
        }
        undo.push("remove new mark", () => Attendance.deleteOne({ _id: doc._id }));
        saved.push(doc.toObject());
      } else if (p.kind === "update") {
        const r = await Attendance.findOneAndUpdate({ _id: p.prev._id, updatedAt: p.prev.updatedAt }, { $set: { ...p.fields, updatedBy: by } }, { new: true }).lean();
        if (!r) throw new HttpError(409, `${p.name}'s attendance for ${date} was changed by someone else. Reload and try again.`);
        const { _id, createdAt, ...before } = p.prev;
        undo.push("restore edited mark", () => Attendance.updateOne({ _id }, { $set: before }));
        saved.push(r);
      } else {
        const r = await Attendance.deleteOne({ _id: p.prev._id, updatedAt: p.prev.updatedAt });
        if (!r.deletedCount) throw new HttpError(409, `${p.name}'s attendance for ${date} was changed by someone else. Reload and try again.`);
        undo.push("restore cleared mark", () => Attendance.collection.insertOne(p.prev));
      }
    }
    res.status(200).json({ message: `Saved ${plan.length} mark(s) for ${date}.`, saved: saved.map(recordRow), cleared: plan.filter((p) => p.kind === "clear").length });
  } catch (err) {
    await undo.rollback();
    fail(res, err, "Save attendance");
  }
};

// GET /api/attendance/month?userId=&locCode=&month=YYYY-MM — staff × days grid with the monthly summary
export const getMonthAttendance = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const today = istDateString();
    const month = req.query.month || today.slice(0, 7);
    if (!isMonth(month)) return res.status(400).json({ message: "Month must be YYYY-MM." });
    const { locCode, storeName } = await storeOf(who, req.query);
    const days = daysOfMonth(month);
    const [staff, records, weeklyOff] = await Promise.all([
      staffOfStore(locCode, { includeInactive: true }),
      Attendance.find({ locCode, date: { $gte: days[0], $lte: days[days.length - 1] } }).lean(),
      getWeeklyOff(),
    ]);
    const working = workingDaysOf(month, weeklyOff, month === today.slice(0, 7) ? today : null);
    const futureMonth = month > today.slice(0, 7);
    const byStaff = new Map();
    for (const r of records) {
      const k = String(r.staffId);
      if (!byStaff.has(k)) byStaff.set(k, []);
      byStaff.get(k).push(r);
    }
    const rows = staff.filter((sp) => sp.isActive !== false || byStaff.has(String(sp._id))).map((sp) => {
      const recs = byStaff.get(String(sp._id)) || [];
      return {
        staff: staffRow(sp),
        days: Object.fromEntries(recs.map((r) => [r.date, { status: r.status, minutes: workedMinutes(r) }])),
        summary: monthSummary(recs, futureMonth ? [] : working),
      };
    });
    res.json({
      month, locCode, storeName, weeklyOff, days: days.map((d) => ({ date: d, weekday: weekdayOf(d), off: weeklyOff !== null && weekdayOf(d) === weeklyOff, future: d > today })),
      workingDays: futureMonth ? 0 : working.length, inProgress: month === today.slice(0, 7), rows,
    });
  } catch (err) { fail(res, err, "Month attendance"); }
};

// GET /api/attendance/staff/:staffId?userId=&month=YYYY-MM — one person's month, day by day with hours
export const getStaffMonth = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const today = istDateString();
    const month = req.query.month || today.slice(0, 7);
    if (!isMonth(month)) return res.status(400).json({ message: "Month must be YYYY-MM." });
    if (!mongoose.Types.ObjectId.isValid(req.params.staffId)) return res.status(400).json({ message: "Invalid staff id." });
    const sp = await SalesPerson.findById(req.params.staffId).select("firstName lastName employeeId position locCode isActive").lean();
    if (!sp) return res.status(404).json({ message: "Staff member not found." });
    if (!canSeeLoc(who.scope, sp.locCode)) return res.status(403).json({ message: "This staff member works at another store." });
    const days = daysOfMonth(month);
    const [records, weeklyOff, store] = await Promise.all([
      Attendance.find({ staffId: sp._id, date: { $gte: days[0], $lte: days[days.length - 1] } }).lean(),
      getWeeklyOff(),
      Store.findOne({ locCode: sp.locCode }).select("name").lean(),
    ]);
    const byDate = new Map(records.map((r) => [r.date, r]));
    const working = month > today.slice(0, 7) ? [] : workingDaysOf(month, weeklyOff, month === today.slice(0, 7) ? today : null);
    res.json({
      staff: { ...staffRow(sp), locCode: sp.locCode, storeName: store?.name || sp.locCode }, month, weeklyOff,
      days: days.map((d) => ({ date: d, weekday: weekdayOf(d), off: weeklyOff !== null && weekdayOf(d) === weeklyOff, future: d > today, record: recordRow(byDate.get(d)) || null })),
      summary: monthSummary(records, working),
    });
  } catch (err) { fail(res, err, "Staff month"); }
};

// GET /api/attendance/staff-list?userId=&locCode= — staff of a store (for the individual view picker)
export const getStaffList = async (req, res) => {
  try {
    const who = await requireUser(req, res);
    if (!who) return;
    const { locCode, storeName } = await storeOf(who, req.query);
    res.json({ locCode, storeName, staff: (await staffOfStore(locCode, { includeInactive: req.query.all === "1" })).map(staffRow) });
  } catch (err) { fail(res, err, "Staff list"); }
};

export { STATUSES };
