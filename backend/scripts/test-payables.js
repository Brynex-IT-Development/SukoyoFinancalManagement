// Checks the payables formulas against the spec examples.
// Run: node scripts/test-payables.js   (exits 1 on any failure)
import {
  billBalance, paymentStatus, effectiveDueDate, daysOverdue, agingBucket, agingByVendor,
  outstandingByVendor, buildStatement, allocateOldestFirst, isPayableBill,
} from "../utils/payables.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};
const IST = (d) => new Date(`${d}T12:00:00+05:30`);
const TODAY = IST("2026-11-20");

// ── Balance and status
eq("old bill without fields = fully unpaid", billBalance({ finalTotal: 1000 }), 1000);
eq("balance = total − paid − credits", billBalance({ finalTotal: 1000, amountPaid: 300, creditsApplied: 200 }), 500);
eq("status paid", paymentStatus({ finalTotal: 1000, amountPaid: 1000, dueDate: IST("2026-11-01") }, TODAY), "paid");
eq("status overdue (balance left, due date passed)", paymentStatus({ finalTotal: 1000, amountPaid: 100, dueDate: IST("2026-11-01") }, TODAY), "overdue");
eq("status partially paid (not due yet)", paymentStatus({ finalTotal: 1000, amountPaid: 100, dueDate: IST("2026-11-30") }, TODAY), "partially_paid");
eq("status unpaid", paymentStatus({ finalTotal: 1000, dueDate: IST("2026-11-30") }, TODAY), "unpaid");
eq("due today is not overdue", paymentStatus({ finalTotal: 1000, dueDate: IST("2026-11-20") }, TODAY), "unpaid");
eq("no due date → bill date + 30", effectiveDueDate({ billDate: IST("2026-10-01") }).toISOString().slice(0, 10), "2026-10-31");
eq("draft and cancelled bills are not payable", [isPayableBill({ status: "draft" }), isPayableBill({ status: "cancelled" }), isPayableBill({ status: "open" }), isPayableBill({ status: "completed" })], [false, false, true, true]);

// ── Aging (spec example: today 20 Nov)
eq("due 1 Nov → 19 days overdue", daysOverdue(IST("2026-11-01"), TODAY), 19);
eq("19 days → 1–30 bucket (not 0–30 the old way round)", agingBucket(19), "d1_30");
eq("due 30 Nov → not due", agingBucket(daysOverdue(IST("2026-11-30"), TODAY)), "notDue");
eq("bucket edges", [0, 1, 30, 31, 60, 61, 90, 91, 180, 181].map(agingBucket), ["notDue", "d1_30", "d1_30", "d31_60", "d31_60", "d61_90", "d61_90", "d91_180", "d91_180", "d180p"]);
eq("IST day boundary: due 20 Nov 00:30 IST, today 20 Nov 23:00 IST → 0", daysOverdue(new Date("2026-11-19T19:00:00Z"), new Date("2026-11-20T17:30:00Z")), 0);
const aging = agingByVendor([
  { vendorKey: "A", vendorName: "Alpha", finalTotal: 10000, dueDate: IST("2026-11-01") },
  { vendorKey: "A", vendorName: "Alpha", finalTotal: 5000, amountPaid: 1000, dueDate: IST("2026-11-30") },
  { vendorKey: "B", vendorName: "Beta", finalTotal: 2000, billDate: IST("2026-04-01") }, // due 1 May → 203 days
  { vendorKey: "B", vendorName: "Beta", finalTotal: 700, amountPaid: 700, dueDate: IST("2026-01-01") }, // paid: ignored
], TODAY);
eq("aging rows per vendor", aging.rows.map((r) => [r.vendorName, r.notDue, r.d1_30, r.d180p, r.total]), [["Alpha", 4000, 10000, 0, 14000], ["Beta", 0, 0, 2000, 2000]]);
eq("aging totals row", [aging.totals.notDue, aging.totals.d1_30, aging.totals.d180p, aging.totals.total, aging.totals.bills], [4000, 10000, 2000, 16000, 3]);

// ── Outstanding
const out = outstandingByVendor([
  { vendorKey: "A", vendorName: "Alpha", finalTotal: 10000, amountPaid: 4000, billDate: IST("2026-09-01") },
  { vendorKey: "A", vendorName: "Alpha", finalTotal: 5000, creditsApplied: 1000, billDate: IST("2026-11-10") },
  { vendorKey: "C", vendorName: "Gamma", finalTotal: 3000, amountPaid: 3000, billDate: IST("2026-10-01") },
], TODAY);
const alpha = out.find((r) => r.vendorKey === "A");
eq("outstanding: billed / paid / credits / outstanding", [alpha.billCount, alpha.billed, alpha.paid, alpha.creditsApplied, alpha.outstanding], [2, 15000, 4000, 1000, 10000]);
eq("outstanding: % paid = paid / billed", alpha.percentPaid, 26.67);
eq("outstanding: status + days since last bill", [alpha.status, alpha.daysSinceLastBill, out.find((r) => r.vendorKey === "C").status], ["Partially paid", 10, "Fully paid"]);

// ── Statement with opening balance
const st = buildStatement({
  bills: [{ _id: 1, billNumber: "B1", billDate: IST("2026-09-15"), finalTotal: 10000 }, { _id: 2, billNumber: "B2", billDate: IST("2026-10-05"), finalTotal: 5000 }],
  payments: [{ _id: 3, number: "PAY-000001", date: IST("2026-09-30"), amount: 4000 }, { _id: 4, number: "PAY-000002", date: IST("2026-10-05"), amount: 2000 }],
  credits: [{ _id: 5, creditNoteNumber: "CN-1", creditDate: IST("2026-10-20"), finalTotal: 500 }],
  from: IST("2026-10-01"), to: IST("2026-10-31"),
});
eq("statement opening = bills − payments before start", st.opening, 6000);
eq("statement entries in date order, bill before payment on the same day", st.entries.map((e) => `${e.type}:${e.ref}:${e.balance}`), ["Bill:B2:11000", "Payment:PAY-000002:9000", "Vendor credit:CN-1:8500"]);
eq("statement totals + closing", [st.totalDebit, st.totalCredit, st.closing], [5000, 2500, 8500]);

// ── Oldest-first allocation
const alloc = allocateOldestFirst([
  { _id: "b2", billNumber: "B2", billDate: IST("2026-10-05"), balanceDue: 5000 },
  { _id: "b1", billNumber: "B1", billDate: IST("2026-09-15"), balanceDue: 6000 },
], 8000);
eq("auto-allocate oldest first", alloc.allocations.map((a) => `${a.billNumber}:${a.amount}`), ["B1:6000", "B2:2000"]);
eq("nothing left over", alloc.unallocated, 0);
eq("more than owed → remainder reported", allocateOldestFirst([{ _id: "x", billDate: IST("2026-01-01"), balanceDue: 100 }], 150).unallocated, 50);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll payables checks passed");
process.exit(failed ? 1 : 0);
