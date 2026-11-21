// End-to-end checks for Phase 4 (vendor payments, outstanding, aging, statement) on a THROWAWAY database.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test4 node scripts/test-payables-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import Vendor from "../model/Vendor.js";
import Bill from "../model/Bill.js";
import VendorCredit from "../model/VendorCredit.js";
import VendorPayment from "../model/VendorPayment.js";
import Transaction from "../model/Transaction.js";
import { listVendorPayments, getOpenBills, createVendorPayment, getVendorPayment, deleteVendorPayment } from "../controllers/VendorPaymentController.js";
import { vendorOutstanding, vendorBills, vendorAging, vendorStatement } from "../controllers/VendorReportController.js";
import { getBills, getBillById, updateBill, deleteBill } from "../controllers/BillController.js";
import { applyCreditToBill, getAvailableVendorCredits } from "../controllers/VendorCreditController.js";
import { istDateString } from "../utils/ist.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test4");
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
const ADMIN = "admin@test.local", STAFF = "staff@test.local";
const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const ymd = (d) => istDateString(d);

await mongoose.connect(uri);
await mongoose.connection.db.dropDatabase();
await VendorPayment.syncIndexes();
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin", locCode: "T01" });
await User.create({ username: "staff", email: STAFF, password: "x", power: "normal", role: "store_user", locCode: "T01" });
const acme = await Vendor.create({ displayName: "Acme Gold", userId: ADMIN, gstin: "27AAPFU0939F1ZV" });
const beta = await Vendor.create({ displayName: "Beta Silver", userId: ADMIN });
const A = String(acme._id), B = String(beta._id);
const mk = (o) => Bill.create({ vendorName: "Acme Gold", vendorId: A, billNumber: o.billNumber, billDate: o.billDate, dueDate: o.dueDate, finalTotal: o.finalTotal,
  status: o.status || "open", sourceType: "from_receive", userId: ADMIN, locCode: o.locCode || "T01", warehouse: o.warehouse || "Store One", ...o.extra });
// Acme: B1 ₹10,000 (due 40 days ago), B2 ₹5,000 (due 10 days ago), B3 ₹2,000 (due in 15 days), a draft, and a bill at another store
const b1 = await mk({ billNumber: "B1", billDate: daysAgo(70), dueDate: daysAgo(40), finalTotal: 10000 });
const b2 = await mk({ billNumber: "B2", billDate: daysAgo(40), dueDate: daysAgo(10), finalTotal: 5000 });
const b3 = await mk({ billNumber: "B3", billDate: daysAgo(5), dueDate: new Date(Date.now() + 15 * DAY), finalTotal: 2000 });
await mk({ billNumber: "DRAFT1", billDate: daysAgo(3), finalTotal: 999, status: "draft" });
const bOther = await mk({ billNumber: "B9", billDate: daysAgo(200), finalTotal: 3000, locCode: "T02", warehouse: "Store Two" }); // no due date → billDate + 30 = 170 days overdue
const bBeta = await Bill.create({ vendorName: "Beta Silver", vendorId: B, billNumber: "X1", billDate: daysAgo(20), finalTotal: 1500, status: "completed", sourceType: "from_receive", userId: ADMIN, locCode: "T01" });
const oldNameOnly = await Bill.create({ vendorName: "Old Traders", vendorId: null, billNumber: "OLD1", billDate: daysAgo(400), finalTotal: 800, status: "open", sourceType: "from_receive", userId: ADMIN, locCode: "T01" });
await Bill.collection.updateOne({ _id: oldNameOnly._id }, { $unset: { amountPaid: "", creditsApplied: "" } }); // like a bill saved before F9

// ── Open bills
let r = await call(getOpenBills, { query: { userId: ADMIN, vendorId: A } });
eq("open bills oldest first, draft excluded", r.body.bills.map((b) => `${b.billNumber}:${b.balanceDue}`), ["B9:3000", "B1:10000", "B2:5000", "B3:2000"]);
eq("total due", r.body.totalDue, 20000);
r = await call(getOpenBills, { query: { userId: STAFF, vendorId: A } });
eq("store user sees only their store's bills", r.body.bills.map((b) => b.billNumber), ["B1", "B2", "B3"]);

// ── Validation
const pay = (o) => ({ userId: ADMIN, vendorId: A, mode: "cash", date: ymd(new Date()), ...o });
r = await call(createVendorPayment, { body: pay({ amount: 12000, allocations: [{ billId: b1._id, amount: 10000 }, { billId: b2._id, amount: 1000 }] }) });
eq("allocations must add up to the amount", [r.status, /must match/.test(r.body.message)], [400, true]);
r = await call(createVendorPayment, { body: pay({ amount: 6000, allocations: [{ billId: b2._id, amount: 6000 }] }) });
eq("allocation above the bill balance refused", [r.status, /more than/.test(r.body.message)], [400, true]);
r = await call(createVendorPayment, { body: pay({ amount: 100, allocations: [{ billId: bBeta._id, amount: 100 }] }) });
eq("another vendor's bill refused", r.status, 400);
const draft = await Bill.findOne({ billNumber: "DRAFT1" }).lean();
r = await call(createVendorPayment, { body: pay({ amount: 100, allocations: [{ billId: draft._id, amount: 100 }] }) });
eq("draft bill refused", r.status, 400);
r = await call(createVendorPayment, { body: pay({ mode: "cheque", amount: 100, allocations: [{ billId: b1._id, amount: 100 }] }) });
eq("cheque needs a reference", r.status, 400);
r = await call(createVendorPayment, { body: pay({ userId: STAFF, amount: 100, allocations: [{ billId: bOther._id, amount: 100 }] }) });
eq("store user cannot pay another store's bill", r.status, 403);

// ── Pay ₹12,000: B1 in full, ₹2,000 on B2
r = await call(createVendorPayment, { body: pay({ amount: 12000, reference: "cash 1", allocations: [{ billId: b1._id, amount: 10000 }, { billId: b2._id, amount: 2000 }] }) });
eq("payment saved", [r.status, r.body.number, r.body.vendorName, r.body.allocations?.length], [201, "PAY-000001", "Acme Gold", 2]);
const p1 = r.body;
const fb1 = await Bill.findById(b1._id).lean(), fb2 = await Bill.findById(b2._id).lean();
eq("bills updated: B1 paid, B2 part paid", [fb1.amountPaid, fb2.amountPaid, fb1.payments?.[0]?.paymentNumber], [10000, 2000, "PAY-000001"]);
const tx = await Transaction.findOne({ invoiceNo: "PAY-000001" }).lean();
eq("daybook money out (expense, negative cash)", [tx?.type, tx?.category, tx?.amount, tx?.cash, tx?.locCode], ["Expense", "Vendor Payment", "-12000", "-12000", "T01"]);

r = await call(getBills, { query: { userId: ADMIN, userPower: "admin" } });
const listed = Object.fromEntries(r.body.map((b) => [b.billNumber, `${b.amountPaid}/${b.balanceDue}/${b.paymentStatus}`]));
eq("bill list shows paid / balance / status", [listed.B1, listed.B2, listed.B3, listed.OLD1], ["10000/0/paid", "2000/3000/overdue", "0/2000/unpaid", "0/800/overdue"]);
r = await call(getBillById, { params: { id: String(b2._id) } });
eq("bill detail shows paid / balance / status", [r.body.amountPaid, r.body.balanceDue, r.body.paymentStatus], [2000, 3000, "overdue"]);

// ── Two payments at once on B2 (₹3,000 left), ₹2,000 each → only one fits
const [c1, c2] = await Promise.all([
  call(createVendorPayment, { body: pay({ amount: 2000, allocations: [{ billId: b2._id, amount: 2000 }] }) }),
  call(createVendorPayment, { body: pay({ amount: 2000, allocations: [{ billId: b2._id, amount: 2000 }] }) }),
]);
eq("race: exactly one payment fits the balance", [c1.status, c2.status].sort(), [201, 409]);
eq("race: B2 never overpaid", (await Bill.findById(b2._id).lean()).amountPaid, 4000);
eq("race: loser left no payment or daybook entry", [await VendorPayment.countDocuments({}), await Transaction.countDocuments({ category: "Vendor Payment" })], [2, 2]);

// ── Bill guards
r = await call(updateBill, { params: { id: String(b1._id) }, body: { finalTotal: 5000, userId: ADMIN } });
eq("bill total cannot go below what is paid", r.status, 409);
r = await call(deleteBill, { params: { id: String(b1._id) }, body: { userId: ADMIN } });
eq("bill with payments cannot be deleted", r.status, 409);

// ── Vendor credit (old credit without unusedCredit) applied to B2 (₹1,000 left)
const cn = await VendorCredit.create({ vendorName: "Acme Gold", vendorId: A, creditNoteNumber: "CN-1", creditDate: daysAgo(2), finalTotal: 1500, status: "open", userId: ADMIN, locCode: "T01" });
await VendorCredit.collection.updateOne({ _id: cn._id }, { $unset: { unusedCredit: "", appliedCredit: "" } });
r = await call(getAvailableVendorCredits, { query: { vendorId: A } });
eq("old credit shows as available (unused = total − applied)", r.body.map((c) => `${c.creditNoteNumber}:${c.unusedCredit}`), ["CN-1:1500"]);
r = await call(applyCreditToBill, { body: { creditId: String(cn._id), billId: String(b2._id), appliedAmount: 1200 } });
eq("credit larger than bill balance refused", [r.status, /only ₹1000\.00 due/.test(r.body.message)], [400, true]);
const cnAfterFail = await VendorCredit.findById(cn._id).lean();
eq("refused apply gave the credit back", [cnAfterFail.unusedCredit, cnAfterFail.appliedCredit, cnAfterFail.appliedToBills?.length], [1500, 0, 0]);
r = await call(applyCreditToBill, { body: { creditId: String(cn._id), billId: String(b2._id), appliedAmount: 1000 } });
const fb2c = await Bill.findById(b2._id).lean();
eq("credit applied: bill total unchanged, creditsApplied up, balance 0", [r.status, fb2c.finalTotal, fb2c.creditsApplied, r.body.bill?.balanceDue, r.body.bill?.paymentStatus], [200, 5000, 1000, 0, "paid"]);
eq("credit unused 500 left", (await VendorCredit.findById(cn._id).lean()).unusedCredit, 500);
r = await call(applyCreditToBill, { body: { creditId: String(cn._id), billId: String(b3._id), appliedAmount: 600 } });
eq("cannot apply more than the unused credit", [r.status, /exceeds unused credit \(500\)/.test(r.body.message)], [400, true]);

// ── Delete payment (admin only) puts the money back on the bills
r = await call(deleteVendorPayment, { params: { id: String(p1._id) }, query: { userId: STAFF } });
eq("staff cannot delete a payment", r.status, 403);
r = await call(deleteVendorPayment, { params: { id: String(p1._id) }, query: { userId: ADMIN } });
eq("payment deleted", r.status, 200);
eq("delete reverses allocations", [(await Bill.findById(b1._id).lean()).amountPaid, (await Bill.findById(b2._id).lean()).amountPaid, (await Bill.findById(b1._id).lean()).payments.length], [0, 2000, 0]);
eq("delete removes its daybook entry", await Transaction.countDocuments({ invoiceNo: "PAY-000001" }), 0);
r = await call(createVendorPayment, { body: pay({ amount: 10000, mode: "bank", reference: "UTR123", allocations: [{ billId: b1._id, amount: 10000 }] }) });
eq("pay B1 again by bank", [r.status, (await Transaction.findOne({ invoiceNo: r.body.number }).lean())?.bank], [201, "-10000"]);
r = await call(listVendorPayments, { query: { userId: ADMIN, search: "utr123" } });
eq("payment list search by reference", r.body.payments.map((p) => p.amount), [10000]);
r = await call(getVendorPayment, { params: { id: String(r.body.payments[0]._id) }, query: { userId: ADMIN } });
eq("payment detail includes bill balances", [r.body.bills?.[0]?.billNumber, r.body.bills?.[0]?.balanceDue], ["B1", 0]);

// ── Outstanding: Acme billed 20,000 (B1 10k + B2 5k + B3 2k + B9 3k), paid 12,000 (B1 10k + B2 2k), credits 1,000
r = await call(vendorOutstanding, { query: { userId: ADMIN } });
const acmeRow = r.body.rows.find((x) => x.vendorName === "Acme Gold");
eq("outstanding row", [acmeRow.billCount, acmeRow.billed, acmeRow.paid, acmeRow.creditsApplied, acmeRow.outstanding, acmeRow.percentPaid, acmeRow.status],
  [4, 20000, 12000, 1000, 7000, 60, "Partially paid"]);
eq("name-only older bill grouped by name", r.body.rows.some((x) => x.vendorName === "Old Traders" && x.outstanding === 800), true);
r = await call(vendorOutstanding, { query: { userId: ADMIN, show: "paid" } });
eq("filter: paid only", r.body.rows.length, 0);
r = await call(vendorOutstanding, { query: { userId: STAFF } });
eq("store user: outstanding excludes other stores", r.body.rows.find((x) => x.vendorName === "Acme Gold").billed, 17000);
// Store filter: locCode, and an older bill with no locCode matches by its warehouse name
const legacy = await Bill.create({ vendorName: "Gamma Gems", vendorId: null, billNumber: "LEG1", billDate: daysAgo(5), finalTotal: 400, status: "open", sourceType: "from_receive", userId: ADMIN, warehouse: "Store Two" });
await Bill.updateOne({ _id: legacy._id }, { $unset: { locCode: 1 } });
r = await call(vendorOutstanding, { query: { userId: ADMIN, locCode: "T02", warehouse: "Store Two" } });
eq("store filter: T02 by locCode + older bill by warehouse name", r.body.rows.map((x) => [x.vendorName, x.billed]).sort(), [["Acme Gold", 3000], ["Gamma Gems", 400]]);
r = await call(vendorOutstanding, { query: { userId: ADMIN, locCode: "T01", warehouse: "Store One" } });
eq("store filter: T01 leaves out T02 and the Store Two older bill", r.body.rows.some((x) => x.vendorName === "Gamma Gems") || r.body.rows.find((x) => x.vendorName === "Acme Gold").billed !== 17000, false);
await Bill.deleteOne({ _id: legacy._id });
r = await call(vendorBills, { query: { userId: ADMIN, vendorKey: `id:${A}` } });
eq("drill-down lists the vendor's bills", r.body.bills.length, 4);

// ── Aging (as of today): B2 ₹2,000 left (PAY-1 deleted) 10 days overdue, B3 not due (₹2,000), B9 170 days (₹3,000),
//    Beta X1 has no due date → bill date + 30 → not due, OLD1 370 days
r = await call(vendorAging, { query: { userId: ADMIN } });
const ag = Object.fromEntries(r.body.rows.map((x) => [x.vendorName, x]));
eq("aging: Acme buckets", [ag["Acme Gold"].notDue, ag["Acme Gold"].d91_180, ag["Acme Gold"].d1_30, ag["Acme Gold"].total], [2000, 3000, 2000, 7000]);
eq("aging: no due date → bill date + 30 (Beta not due yet)", ag["Beta Silver"].notDue, 1500);
eq("aging: 180+ bucket", ag["Old Traders"].d180p, 800);
eq("aging totals row", [r.body.totals.total, r.body.totals.bills], [9300, 5]);

// ── Statement for Acme (all stores, admin): from 50 days ago → opening = B1 10,000 (70 days ago) + B9 3,000 (200 days ago)
r = await call(vendorStatement, { query: { userId: ADMIN, vendorKey: `id:${A}`, fromDate: ymd(daysAgo(50)), toDate: ymd(new Date()) } });
eq("statement opening balance", r.body.opening, 13000);
eq("statement entries", r.body.entries.map((e) => `${e.type}:${e.ref}`), ["Bill:B2", "Bill:B3", "Vendor credit:CN-1", "Payment:PAY-000002", "Payment:PAY-000004"]);
eq("statement closing = opening + debits − credits", [r.body.totalDebit, r.body.totalCredit, r.body.closing], [7000, 13500, 6500]); // = outstanding 7,000 − unused credit 500
r = await call(vendorStatement, { query: { userId: STAFF, vendorKey: `id:${A}`, fromDate: ymd(daysAgo(50)), toDate: ymd(new Date()) } });
eq("store user statement leaves out other stores (opening 10,000)", r.body.opening, 10000);
r = await call(vendorStatement, { query: { userId: ADMIN, vendorKey: `id:${A}`, fromDate: ymd(daysAgo(50)), toDate: ymd(new Date()) } });
eq("statement vendor + GSTIN", [r.body.vendorName, r.body.gstin], ["Acme Gold", "27AAPFU0939F1ZV"]);

await new Promise((res) => setTimeout(res, 300));
await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll payables integration checks passed");
process.exit(failed ? 1 : 0);
