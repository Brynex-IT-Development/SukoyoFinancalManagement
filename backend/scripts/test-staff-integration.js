// End-to-end checks for Phase 6 (attendance, enquiries, bank accounts) on a THROWAWAY database.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test6 node scripts/test-staff-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import Store from "../model/Store.js";
import Attendance from "../model/Attendance.js";
import SalesPerson from "../model/SalesPerson.js";
import {
  getAttendanceSettings, updateAttendanceSettings, getDayAttendance, saveAttendance, getMonthAttendance, getStaffMonth, getStaffList,
} from "../controllers/AttendanceController.js";
import { istDateString } from "../utils/ist.js";
import { workingDaysOf } from "../utils/attendance.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test6");
  process.exit(2);
}

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};
const call = (handler, { body = {}, params = {}, query = {} } = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  handler({ body, params, query, headers: {} }, res).catch(reject);
});
const ADMIN = "admin@test.local", MGR1 = "mgr1@test.local", USER1 = "user1@test.local", MGR2 = "mgr2@test.local", CLUSTER = "cluster@test.local";
const pick = (o, keys) => keys.map((k) => o?.[k]);

await mongoose.connect(uri);
const db = mongoose.connection.db;
await db.dropDatabase();
await Attendance.syncIndexes();
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin", locCode: "T01" });
await User.create({ username: "mgr1", email: MGR1, password: "x", power: "normal", role: "store_manager", locCode: "T01" });
await User.create({ username: "user1", email: USER1, password: "x", power: "normal", role: "store_user", locCode: "T01" });
await User.create({ username: "mgr2", email: MGR2, password: "x", power: "normal", role: "store_manager", locCode: "T02" });
await User.create({ username: "cluster", email: CLUSTER, password: "x", power: "normal", role: "cluster_manager", locCode: "T01", allowedLocCodes: ["T01", "T02"] });
const s1 = await Store.create({ name: "Store One", locCode: "T01" });
const s2 = await Store.create({ name: "Store Two", locCode: "T02" });
const sp = (firstName, lastName, employeeId, store, extra = {}) => ({ _id: new mongoose.Types.ObjectId(), firstName, lastName, employeeId, storeId: store._id, locCode: store.locCode, isActive: true, position: "Sales Person", ...extra });
const anu = sp("Anu", "-", "E1", s1), binu = sp("Binu", "Raj", "E2", s1), cini = sp("Cini", "-", "E3", s1, { isActive: false }), devi = sp("Devi", "-", "E4", s2);
await SalesPerson.collection.insertMany([anu, binu, cini, devi]);
const A = String(anu._id), B = String(binu._id), C = String(cini._id), D = String(devi._id);

// ═══ F15 Staff attendance ═══
const DAY = "2026-11-02"; // a Monday
let r = await call(saveAttendance, { body: { userId: USER1, locCode: "T01", date: DAY, entries: [{ staffId: A, status: "present" }] } });
eq("store user cannot mark", r.status, 403);
r = await call(saveAttendance, { body: { userId: MGR2, locCode: "T01", date: DAY, entries: [{ staffId: A, status: "present" }] } });
eq("another store's manager cannot mark", r.status, 403);
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: "2099-01-01", entries: [{ staffId: A, status: "present" }] } });
eq("future date refused", r.status, 400);
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [{ staffId: A, status: "present", inTime: "18:00", outTime: "09:00" }] } });
eq("out before in refused, naming the person", [r.status, r.body.message], [400, "Anu: Out time must be after in time."]);
r = await call(saveAttendance, { body: { userId: ADMIN, locCode: "T01", date: DAY, entries: [{ staffId: D, status: "present" }] } });
eq("staff of another store refused", [r.status, r.body.message], [403, "Devi works at another store."]);

// Manager marks Anu present 09:30–18:30 with a 13:00–13:45 break (8h 15m) and Binu absent
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [
  { staffId: A, status: "present", inTime: "09:30", outTime: "18:30", breakOut: "13:00", breakIn: "13:45" },
  { staffId: B, status: "absent" },
] } });
eq("manager marks own store", [r.status, r.body.saved.length], [200, 2]);
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [{ staffId: A, status: "present" }] } });
eq("marking twice is refused, naming the person and date", [r.status, r.body.message], [409, "Anu is already marked for 2026-11-02."]);

r = await call(getDayAttendance, { query: { userId: USER1, date: DAY } });
eq("daily view: store user sees own store; inactive staff without a mark hidden", r.body.rows.map((x) => [x.staff.name, x.record?.status || null, x.record?.minutes ?? null]),
  [["Anu", "present", 495], ["Binu Raj", "absent", null]]);
eq("daily view: summary and who may mark", [r.body.summary, r.body.canMark], [{ staff: 2, present: 1, halfDay: 0, absent: 1, leave: 0, unmarked: 0 }, false]);
r = await call(getDayAttendance, { query: { userId: MGR1, date: "2026-11-03" } });
eq("daily view: unmarked staff flagged", [r.body.summary.unmarked, r.body.rows.every((x) => x.record === null), r.body.canMark], [2, true, true]);

// Edit Anu to half day; a stale edit is refused; clearing Binu removes the mark
r = await call(getDayAttendance, { query: { userId: MGR1, date: DAY } });
const anuRec = r.body.rows.find((x) => x.staff.name === "Anu").record, binuRec = r.body.rows.find((x) => x.staff.name === "Binu Raj").record;
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [{ staffId: A, recordId: anuRec._id, updatedAt: anuRec.updatedAt, status: "half_day", inTime: "09:30", outTime: "13:30" }] } });
eq("edit an existing mark", [r.status, r.body.saved[0].status, r.body.saved[0].minutes], [200, "half_day", 240]);
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [{ staffId: A, recordId: anuRec._id, updatedAt: anuRec.updatedAt, status: "leave" }] } });
eq("edit based on an old copy is refused", r.status, 409);
// Save all where the second entry fails: the first (clearing Binu) must be undone
const anuNow = (await call(getDayAttendance, { query: { userId: MGR1, date: DAY } })).body.rows.find((x) => x.staff.name === "Anu").record;
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [
  { staffId: B, recordId: binuRec._id, updatedAt: binuRec.updatedAt, status: "" },
  { staffId: A, recordId: anuNow._id, updatedAt: anuNow.updatedAt, status: "present", inTime: "10:00", outTime: "09:00" },
] } });
eq("invalid entry stops the whole save", r.status, 400);
eq("nothing was written", (await Attendance.countDocuments({ date: DAY })), 2);
r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [{ staffId: B, recordId: binuRec._id, updatedAt: binuRec.updatedAt, status: "" }] } });
eq("clear a mark", [r.status, r.body.cleared, await Attendance.countDocuments({ date: DAY })], [200, 1, 1]);

// Rollback: a create succeeds, then the update loses a race at write time → the create is undone.
// (The race is simulated by making the conditional update find nothing, as when someone saved in between.)
const anuLatest = await Attendance.findOne({ staffId: anu._id, date: DAY }).lean();
const realUpdate = Attendance.findOneAndUpdate;
Attendance.findOneAndUpdate = () => ({ lean: async () => null });
try {
  r = await call(saveAttendance, { body: { userId: MGR1, locCode: "T01", date: DAY, entries: [
    { staffId: B, status: "leave" },
    { staffId: A, recordId: String(anuLatest._id), updatedAt: anuLatest.updatedAt, status: "present" },
  ] } });
} finally { Attendance.findOneAndUpdate = realUpdate; }
eq("lost race → 409 and the new mark for Binu is rolled back", [r.status, await Attendance.countDocuments({ staffId: binu._id, date: DAY })], [409, 0]);

// ── Monthly report for October 2026: 31 days, Sundays 4, 11, 18, 25 → 27 working days
const oct = workingDaysOf("2026-10", 0);
const mk = (s, date, status, extra = {}) => ({ staffId: s._id, staffName: s.firstName, locCode: s.locCode, date, status, inTime: "", outTime: "", breakOut: "", breakIn: "", note: "", ...extra });
await Attendance.collection.insertMany([
  ...oct.slice(0, 20).map((d) => mk(anu, d, "present", { inTime: "10:00", outTime: "19:00", breakOut: "14:00", breakIn: "14:30" })),
  mk(anu, oct[20], "half_day", { inTime: "10:00", outTime: "14:00" }), mk(anu, oct[21], "half_day"), mk(anu, oct[22], "leave"), mk(anu, oct[23], "absent"),
  ...oct.slice(0, 10).map((d) => mk(binu, d, "present")),
  mk(devi, oct[0], "present"),
]);
// Anu: present 20 + 2 × 0.5 = 21; leave 1; absent 1; unmarked 27 − 24 = 3; 21 ÷ 27 = 77.78%
r = await call(getMonthAttendance, { query: { userId: MGR1, month: "2026-10" } });
const anuRow = r.body.rows.find((x) => x.staff.name === "Anu");
eq("month: working days (Sunday off)", [r.body.workingDays, r.body.days.length, r.body.days.filter((d) => d.off).length], [27, 31, 4]);
eq("month: Anu's summary", pick(anuRow.summary, ["present", "halfDays", "leave", "absent", "marked", "unmarked", "attendancePct"]), [21, 2, 1, 1, 24, 3, 77.78]);
eq("month: Anu's hours (20 × 8h 30m + 4h)", anuRow.summary.minutes, 20 * 510 + 240);
eq("month: grid cell", anuRow.days[oct[0]], { status: "present", minutes: 510 });
eq("month: Binu 10 of 27", pick(r.body.rows.find((x) => x.staff.name === "Binu Raj").summary, ["present", "unmarked", "attendancePct"]), [10, 17, 37.04]);
eq("month: other store's staff not listed", r.body.rows.some((x) => x.staff.name === "Devi"), false);
r = await call(getMonthAttendance, { query: { userId: USER1, month: "2026-10", locCode: "T02" } });
eq("month: store user asking for another store → 403", r.status, 403);
r = await call(getMonthAttendance, { query: { userId: CLUSTER, month: "2026-10", locCode: "T02" } });
eq("month: cluster manager can view an allowed store", r.body.rows.map((x) => x.staff.name), ["Devi"]);
r = await call(getMonthAttendance, { query: { userId: ADMIN, month: "2026-10" } });
eq("month: admin must choose a store", r.status, 400);
const today = istDateString();
r = await call(getMonthAttendance, { query: { userId: MGR1, month: today.slice(0, 7) } });
eq("month in progress counts working days up to today", [r.body.inProgress, r.body.workingDays], [true, workingDaysOf(today.slice(0, 7), 0, today).length]);

// Weekly off is a setting (admin): Saturday → October 2026 has 5 Saturdays → 26 working days
r = await call(updateAttendanceSettings, { body: { userId: MGR1, weeklyOff: 6 } });
eq("only an admin can change the weekly off", r.status, 403);
r = await call(updateAttendanceSettings, { body: { userId: ADMIN, weeklyOff: 9 } });
eq("weekly off must be a weekday", r.status, 400);
r = await call(updateAttendanceSettings, { body: { userId: ADMIN, weeklyOff: 6 } });
eq("weekly off set to Saturday", [r.status, r.body.weeklyOffLabel], [200, "Saturday"]);
r = await call(getMonthAttendance, { query: { userId: MGR1, month: "2026-10" } });
eq("working days follow the setting", r.body.workingDays, 26);
await call(updateAttendanceSettings, { body: { userId: ADMIN, weeklyOff: 0 } });
r = await call(getAttendanceSettings, { query: { userId: USER1 } });
eq("settings readable, editable only by admin", [r.body.weeklyOff, r.body.canEdit], [0, false]);

// ── One person's month
r = await call(getStaffMonth, { params: { staffId: A }, query: { userId: MGR1, month: "2026-10" } });
eq("individual: day by day with hours", [r.body.days.length, r.body.days.find((d) => d.date === oct[0]).record.minutes, r.body.summary.present, r.body.staff.storeName], [31, 510, 21, "Store One"]);
r = await call(getStaffMonth, { params: { staffId: D }, query: { userId: MGR1, month: "2026-10" } });
eq("individual: another store's staff → 403", r.status, 403);
r = await call(getStaffList, { query: { userId: MGR1 } });
eq("staff list: active staff of the store", r.body.staff.map((s) => s.name), ["Anu", "Binu Raj"]);
r = await call(getStaffList, { query: { userId: MGR1, all: "1" } });
eq("staff list with inactive", r.body.staff.map((s) => s.name), ["Anu", "Binu Raj", "Cini"]);

// ═══ (later features add their checks above this line) ═══

await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Phase 6 checks passed");
process.exit(failed ? 1 : 0);
