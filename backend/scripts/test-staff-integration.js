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
import Enquiry from "../model/Enquiry.js";
import { listEnquiries, createEnquiry, getEnquiry, updateEnquiry, changeEnquiryStatus, searchEnquiryItems } from "../controllers/EnquiryController.js";
import BankAccount from "../model/BankAccount.js";
import { listBankAccounts, createBankAccount, getBankAccount, updateBankAccount, listBankTransfers, createBankTransfer } from "../controllers/BankController.js";
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
await BankAccount.syncIndexes();
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

// ═══ F16 Enquiries ═══
await db.collection("salesinvoices").insertMany([
  { invoiceNumber: "INV-77", invoiceDate: new Date(), customer: "Meera", category: "Sales", status: "sent", finalTotal: 5000, locCode: "T01", userId: ADMIN, lineItems: [] },
  { invoiceNumber: "RTN-5", invoiceDate: new Date(), customer: "Meera", category: "Return", status: "sent", finalTotal: -500, locCode: "T01", userId: ADMIN, lineItems: [] },
  { invoiceNumber: "INV-99", invoiceDate: new Date(), customer: "Other", category: "Sales", status: "sent", finalTotal: 900, locCode: "T02", userId: ADMIN, lineItems: [] },
]);
await db.collection("shoeitems").insertOne({ itemName: "Gold Ring 22K", sku: "GR-22", category: "other" });
await db.collection("itemgroups").insertOne({ name: "Bangles", items: [{ _id: new mongoose.Types.ObjectId(), name: "Ruby Bangle", sku: "RB-1" }] });

r = await call(createEnquiry, { body: { userId: USER1, customerName: "Meera", phone: "+91 98470 12345", itemWanted: "22K ring, size 14", staffId: A, followUpDate: "" } });
const enq1 = r.body;
eq("enquiry: store user creates for own store, phone normalised, numbered", [r.status, enq1.locCode, enq1.phone, enq1.number, enq1.staffName], [201, "T01", "9847012345", "ENQ-000001", "Anu"]);
eq("enquiry: creation is the first history entry", enq1.history.map((h) => [h.status, h.note, h.by]), [["new", "Enquiry taken", USER1]]);
r = await call(createEnquiry, { body: { userId: USER1, customerName: "X", phone: "123", itemWanted: "ring" } });
eq("enquiry: invalid phone refused", [r.status, r.body.message], [400, "Enter a valid phone number."]);
r = await call(createEnquiry, { body: { userId: USER1, customerName: "X", phone: "9847012345", itemWanted: " " } });
eq("enquiry: item wanted required", r.status, 400);
r = await call(createEnquiry, { body: { userId: USER1, customerName: "X", phone: "9847012345", itemWanted: "ring", staffId: D } });
eq("enquiry: staff from another store refused", [r.status, r.body.message], [400, "That staff member does not work at this store."]);
r = await call(createEnquiry, { body: { userId: ADMIN, customerName: "Ravi", phone: "9847099999", itemWanted: "chain" } });
eq("enquiry: admin must choose the store", r.status, 400);
const yesterday = istDateString(new Date(Date.now() - 86400000)), todayDay = istDateString();
r = await call(createEnquiry, { body: { userId: ADMIN, locCode: "T02", customerName: "Ravi", phone: "9847099999", itemWanted: "silver chain", followUpDate: yesterday } });
const enq2 = r.body;
eq("enquiry: admin creates for Store Two", [r.status, enq2.number, enq2.locCode], [201, "ENQ-000002", "T02"]);
r = await call(createEnquiry, { body: { userId: USER1, locCode: "T02", customerName: "Y", phone: "9847011111", itemWanted: "ring" } });
eq("enquiry: store user cannot create for another store", r.status, 403);
r = await call(getEnquiry, { params: { id: String(enq1._id) }, query: { userId: MGR2 } });
eq("enquiry: other store cannot open it", r.status, 403);
r = await call(listEnquiries, { query: { userId: USER1 } });
eq("enquiry list: store user sees own store only", r.body.rows.map((x) => x.number), ["ENQ-000001"]);
r = await call(listEnquiries, { query: { userId: ADMIN } });
eq("enquiry list: admin sees all; overdue follow-up flagged", [r.body.rows.length, r.body.rows.find((x) => x.number === "ENQ-000002").followUp, r.body.overdue], [2, "overdue", 1]);

// Status changes append history; follow-up due today
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "contacted", note: "Called, will visit", followUpDate: todayDay } });
eq("status change appends history", [r.status, r.body.status, r.body.history.length, r.body.history[1].note], [200, "contacted", 2, "Called, will visit"]);
r = await call(listEnquiries, { query: { userId: ADMIN, due: "today" } });
eq("filter: follow-up due today", r.body.rows.map((x) => x.number), ["ENQ-000001"]);
r = await call(listEnquiries, { query: { userId: ADMIN, due: "overdue" } });
eq("filter: overdue", r.body.rows.map((x) => x.number), ["ENQ-000002"]);
r = await call(listEnquiries, { query: { userId: ADMIN, due: "due" } });
eq("filter: due today or overdue", r.body.rows.map((x) => x.number).sort(), ["ENQ-000001", "ENQ-000002"]);
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "contacted" } });
eq("same status without a note is refused", r.status, 400);
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "contacted", note: "Sent photos on WhatsApp" } });
eq("a follow-up note on the same status is logged", [r.status, r.body.history.length], [200, 3]);
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "maybe" } });
eq("unknown status refused", r.status, 400);

// Conversion records the sale's invoice number
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "converted", invoiceNumber: "INV-404" } });
eq("convert: unknown invoice refused", [r.status, r.body.message], [400, "No invoice INV-404 was found."]);
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "converted", invoiceNumber: "RTN-5" } });
eq("convert: a return is not a sale", r.status, 400);
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "converted", invoiceNumber: "INV-99" } });
eq("convert: another store's invoice refused", r.status, 403);
r = await call(changeEnquiryStatus, { params: { id: String(enq1._id) }, body: { userId: USER1, status: "converted", invoiceNumber: "inv-77", note: "Bought the ring" } });
eq("convert: invoice recorded, follow-up cleared, logged", [r.status, r.body.convertedInvoiceNumber, r.body.followUpDate, r.body.history[3].note], [200, "INV-77", "", "Bought the ring · Invoice INV-77"]);
r = await call(listEnquiries, { query: { userId: ADMIN, due: "today" } });
eq("converted enquiries leave the follow-up list", r.body.rows.length, 0);
r = await call(listEnquiries, { query: { userId: ADMIN, status: "converted" } });
eq("filter by status; counts per status", [r.body.rows.map((x) => x.number), r.body.counts], [["ENQ-000001"], { new: 1, contacted: 0, converted: 1, closed: 0 }]);
r = await call(listEnquiries, { query: { userId: ADMIN, search: "98470 99999" } });
eq("search by phone", r.body.rows.map((x) => x.number), ["ENQ-000002"]);
r = await call(listEnquiries, { query: { userId: ADMIN, fromDate: "2020-01-01", toDate: "2020-12-31" } });
eq("date filter", r.body.rows.length, 0);

// Details edit (status cannot be changed this way); lost race on a status change
r = await call(updateEnquiry, { params: { id: String(enq2._id) }, body: { userId: MGR2, itemWanted: "silver chain 20 inch", status: "closed" } });
eq("edit details; status untouched", [r.status, r.body.itemWanted, r.body.status], [200, "silver chain 20 inch", "new"]);
const realFindOneAndUpdate = Enquiry.findOneAndUpdate;
Enquiry.findOneAndUpdate = () => ({ lean: async () => null });
try { r = await call(changeEnquiryStatus, { params: { id: String(enq2._id) }, body: { userId: MGR2, status: "closed" } }); } finally { Enquiry.findOneAndUpdate = realFindOneAndUpdate; }
eq("status change that lost a race → 409", r.status, 409);
r = await call(searchEnquiryItems, { query: { userId: USER1, search: "ring" } });
eq("item search: standalone items and variants", r.body.items.map((i) => i.name).sort(), ["Gold Ring 22K"]);
r = await call(searchEnquiryItems, { query: { userId: USER1, search: "ruby" } });
eq("item search: group variant with its group", r.body.items.map((i) => [i.name, i.group]), [["Ruby Bangle", "Bangles"]]);

// ═══ F17 Bank accounts and transfers ═══
r = await call(listBankAccounts, { query: { userId: MGR1 } });
eq("bank: store manager cannot see accounts", r.status, 403);
r = await call(createBankAccount, { body: { userId: MGR1, bankName: "SBI", accountHolder: "Shop", accountNumber: "123456789012" } });
eq("bank: store manager cannot add accounts", r.status, 403);
r = await call(createBankAccount, { body: { userId: ADMIN, bankName: "SBI", accountHolder: "Shop", accountNumber: "1234 5678 9012", ifsc: "SBIN1070123" } });
eq("bank: bad IFSC refused", r.status, 400);
r = await call(createBankAccount, { body: { userId: ADMIN, bankName: "SBI", accountHolder: "Shop Pvt Ltd", accountNumber: "1234 5678 9012", ifsc: "sbin0070123", branch: "MG Road", upiId: "shop@sbi", openingBalance: "50000" } });
const sbi = r.body;
eq("bank: account added, balance = opening, number masked", [r.status, sbi.balance, sbi.accountNumberMasked, sbi.ifsc, sbi.accountNumber], [201, 50000, "••••••••9012", "SBIN0070123", undefined]);
r = await call(createBankAccount, { body: { userId: ADMIN, bankName: "SBI", accountHolder: "Again", accountNumber: "123456789012", ifsc: "SBIN0070123" } });
eq("bank: same account twice refused", r.status, 409);
r = await call(createBankAccount, { body: { userId: ADMIN, bankName: "HDFC", accountHolder: "Shop Pvt Ltd", accountNumber: "50100200300", ifsc: "HDFC0001234" } });
const hdfc = r.body;
eq("bank: second account with no opening balance", [r.status, hdfc.balance], [201, 0]);
r = await call(getBankAccount, { params: { id: String(sbi._id) }, query: { userId: ADMIN } });
eq("bank: full number on the account page (for editing)", r.body.accountNumber, "123456789012");

const bal = async (a) => (await BankAccount.findById(a._id).lean()).balance;
const transfer = (amount, extra = {}) => call(createBankTransfer, { body: { userId: ADMIN, fromAccountId: String(sbi._id), toAccountId: String(hdfc._id), amount, date: todayDay, ...extra } });
r = await transfer("20000.50", { notes: "Move for supplier payments" });
eq("transfer: SBI → HDFC ₹20,000.50", [r.status, r.body.transfer.number, await bal(sbi), await bal(hdfc)], [201, "BT-000001", 29999.5, 20000.5]);
r = await transfer("100", { toAccountId: String(sbi._id) });
eq("transfer: same account refused", r.status, 400);
r = await transfer("0");
eq("transfer: zero refused", r.status, 400);
r = await transfer("1.234");
eq("transfer: more than 2 decimals refused", r.status, 400);
r = await transfer("10", { date: "2099-01-01" });
eq("transfer: future date refused", r.status, 400);
r = await transfer("40000");
eq("transfer: not enough balance → 409, nothing moved", [r.status, r.body.message, await bal(sbi), await bal(hdfc)],
  [409, "Not enough balance in SBI · ••••••••9012: ₹29,999.50 available, ₹40,000.00 asked.", 29999.5, 20000.5]);
// Two transfers of ₹20,000 at once: only one fits in ₹29,999.50
const both = await Promise.all([transfer("20000"), transfer("20000")]);
eq("transfer race: one succeeds, one refused, never negative", [both.map((x) => x.status).sort(), await bal(sbi), await bal(hdfc)], [[201, 409], 9999.5, 40000.5]);
// The increment fails (e.g. the account was just made inactive) → the decrement is rolled back
const realUpdateOne = BankAccount.updateOne.bind(BankAccount);
let n = 0;
BankAccount.updateOne = (...args) => (++n === 2 ? Promise.resolve({ matchedCount: 0, modifiedCount: 0 }) : realUpdateOne(...args));
try { r = await transfer("500"); } finally { BankAccount.updateOne = realUpdateOne; }
eq("transfer: receiving side fails → 409 and SBI gets its ₹500 back", [r.status, await bal(sbi), await bal(hdfc)], [409, 9999.5, 40000.5]);
await call(updateBankAccount, { params: { id: String(hdfc._id) }, body: { userId: ADMIN, active: false } });
r = await transfer("100");
eq("transfer: to an inactive account refused", r.status, 409);
await call(updateBankAccount, { params: { id: String(hdfc._id) }, body: { userId: ADMIN, active: true } });

// Opening balance edits move the balance by the same amount, never below zero
r = await call(updateBankAccount, { params: { id: String(sbi._id) }, body: { userId: ADMIN, openingBalance: "30000" } });
eq("opening balance cut that would make the balance negative → 409", [r.status, await bal(sbi)], [409, 9999.5]);
r = await call(updateBankAccount, { params: { id: String(sbi._id) }, body: { userId: ADMIN, openingBalance: "45000" } });
eq("opening balance 50,000 → 45,000 moves the balance by −5,000", [r.status, r.body.openingBalance, r.body.balance], [200, 45000, 4999.5]);
r = await call(updateBankAccount, { params: { id: String(sbi._id) }, body: { userId: ADMIN, branch: "$balance" } });
eq("text that looks like a field path is saved as text", [r.status, r.body.branch, r.body.balance], [200, "$balance", 4999.5]);

r = await call(listBankAccounts, { query: { userId: ADMIN } });
eq("account list: masked numbers and the total balance", [r.body.accounts.map((a) => a.accountNumberMasked), r.body.accounts.some((a) => a.accountNumber), r.body.totalBalance], [["•••••••0300", "••••••••9012"], false, 45000]);
r = await call(listBankTransfers, { query: { userId: ADMIN, accountId: String(hdfc._id) } });
eq("transfer list by account", [r.body.transfers.length, r.body.total], [2, 40000.5]);
r = await call(listBankTransfers, { query: { userId: ADMIN, fromDate: "2020-01-01", toDate: "2020-12-31" } });
eq("transfer list by date", r.body.transfers.length, 0);

// ═══ (later features add their checks above this line) ═══

await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Phase 6 checks passed");
process.exit(failed ? 1 : 0);
