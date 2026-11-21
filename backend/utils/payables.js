// Pure payables formulas (no database) — F9/F10: bill balance and status, oldest-first
// allocation, aging buckets, vendor outstanding rows and the vendor statement ledger.
// Checked by scripts/test-payables.js.
import { round2 } from "./retailMath.js";
import { istDateString } from "./ist.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_CREDIT_DAYS = 30;

/** Bills that count as owed: confirmed bills only (BillController counts payables for open/completed). */
export const isPayableBill = (bill) => !["draft", "cancelled", "void"].includes(String(bill?.status || "").toLowerCase());

/** finalTotal − amountPaid − creditsApplied. Older bills without the fields count as fully unpaid. */
export const billBalance = (bill) =>
  round2((Number(bill?.finalTotal) || 0) - (Number(bill?.amountPaid) || 0) - (Number(bill?.creditsApplied) || 0));

/** Due date, or bill date + 30 days when the bill has none. */
export const effectiveDueDate = (bill) => {
  if (bill?.dueDate) return new Date(bill.dueDate);
  if (!bill?.billDate) return null;
  return new Date(new Date(bill.billDate).getTime() + DEFAULT_CREDIT_DAYS * DAY_MS);
};

/** Whole IST calendar days from `due` to `today` (positive = overdue). */
export const daysOverdue = (due, today = new Date()) => {
  if (!due) return 0;
  const a = Date.parse(`${istDateString(due)}T00:00:00Z`);
  const b = Date.parse(`${istDateString(today)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
};

/** paid | partially_paid | overdue | unpaid. "overdue" wins over "partially_paid" while money is still owed past the due date. */
export const paymentStatus = (bill, today = new Date()) => {
  const balance = billBalance(bill);
  if (balance <= 0.004) return "paid";
  if (daysOverdue(effectiveDueDate(bill), today) > 0) return "overdue";
  const settled = (Number(bill?.amountPaid) || 0) + (Number(bill?.creditsApplied) || 0);
  return settled > 0.004 ? "partially_paid" : "unpaid";
};

/** Adds balanceDue, paymentStatus, effective due date and days overdue to a bill object. */
export const withPaymentInfo = (bill, today = new Date()) => {
  const due = effectiveDueDate(bill);
  return {
    ...bill,
    amountPaid: round2(Number(bill?.amountPaid) || 0),
    creditsApplied: round2(Number(bill?.creditsApplied) || 0),
    balanceDue: billBalance(bill),
    paymentStatus: paymentStatus(bill, today),
    effectiveDueDate: due,
    daysOverdue: daysOverdue(due, today),
  };
};

/** Spread `amount` over bills oldest first. bills: [{ _id, balanceDue, billDate }] (any order). */
export const allocateOldestFirst = (bills, amount) => {
  let left = round2(amount);
  const out = [];
  const sorted = [...bills].sort((a, b) => new Date(a.billDate) - new Date(b.billDate) || String(a.billNumber || "").localeCompare(String(b.billNumber || "")));
  for (const b of sorted) {
    if (left <= 0) break;
    const take = round2(Math.min(left, Number(b.balanceDue) || 0));
    if (take > 0) { out.push({ billId: b._id, billNumber: b.billNumber, amount: take }); left = round2(left - take); }
  }
  return { allocations: out, unallocated: round2(left) };
};

// ─── Aging ──────────────────────────────────────────────────────────────────
export const AGING_BUCKETS = [
  { key: "notDue", label: "Not due" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d91_180", label: "91–180" },
  { key: "d180p", label: "180+" },
];

/** Bucket for days past due (≤ 0 = not due yet). */
export const agingBucket = (days) => {
  if (days <= 0) return "notDue";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  if (days <= 180) return "d91_180";
  return "d180p";
};

const emptyBuckets = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));

/**
 * One row per vendor with the unpaid balance in each bucket, plus a totals row.
 * bills: payable bills with vendorKey/vendorName; only bills with a balance are counted.
 */
export const agingByVendor = (bills, today = new Date()) => {
  const rows = new Map();
  const totals = { ...emptyBuckets(), total: 0, bills: 0 };
  for (const bill of bills) {
    const balance = billBalance(bill);
    if (balance <= 0.004) continue;
    const key = agingBucket(daysOverdue(effectiveDueDate(bill), today));
    const row = rows.get(bill.vendorKey) || { vendorKey: bill.vendorKey, vendorId: bill.vendorId || null, vendorName: bill.vendorName, ...emptyBuckets(), total: 0, bills: 0 };
    row[key] = round2(row[key] + balance);
    row.total = round2(row.total + balance);
    row.bills += 1;
    rows.set(bill.vendorKey, row);
    totals[key] = round2(totals[key] + balance);
    totals.total = round2(totals.total + balance);
    totals.bills += 1;
  }
  return { rows: [...rows.values()].sort((a, b) => b.total - a.total), totals };
};

// ─── Outstanding ────────────────────────────────────────────────────────────

/** Per-vendor outstanding summary. bills: payable bills with vendorKey/vendorName. */
export const outstandingByVendor = (bills, today = new Date()) => {
  const rows = new Map();
  for (const bill of bills) {
    const r = rows.get(bill.vendorKey) || {
      vendorKey: bill.vendorKey, vendorId: bill.vendorId || null, vendorName: bill.vendorName,
      billCount: 0, billed: 0, paid: 0, creditsApplied: 0, outstanding: 0, firstBillDate: null, lastBillDate: null,
    };
    r.billCount += 1;
    r.billed = round2(r.billed + (Number(bill.finalTotal) || 0));
    r.paid = round2(r.paid + (Number(bill.amountPaid) || 0));
    r.creditsApplied = round2(r.creditsApplied + (Number(bill.creditsApplied) || 0));
    const d = bill.billDate ? new Date(bill.billDate) : null;
    if (d && (!r.firstBillDate || d < r.firstBillDate)) r.firstBillDate = d;
    if (d && (!r.lastBillDate || d > r.lastBillDate)) r.lastBillDate = d;
    rows.set(bill.vendorKey, r);
  }
  return [...rows.values()].map((r) => {
    const outstanding = round2(r.billed - r.paid - r.creditsApplied);
    const percentPaid = r.billed > 0 ? round2((r.paid / r.billed) * 100) : 0;
    const status = outstanding <= 0.004 ? "Fully paid" : (r.paid + r.creditsApplied) > 0.004 ? "Partially paid" : "Unpaid";
    return { ...r, outstanding, percentPaid, status, daysSinceLastBill: r.lastBillDate ? daysOverdue(r.lastBillDate, today) : null };
  }).sort((a, b) => b.outstanding - a.outstanding);
};

// ─── Statement ──────────────────────────────────────────────────────────────

/**
 * Vendor ledger for [from, to] (IST days, inclusive).
 * bills = debits (finalTotal), payments and vendor credits = credits.
 * Opening balance = everything dated before `from`. Entries sorted by date, then bills before
 * payments/credits on the same day, with a running balance.
 */
export const buildStatement = ({ bills = [], payments = [], credits = [], from, to }) => {
  const fromDay = from ? istDateString(from) : null;
  const toDay = to ? istDateString(to) : null;
  const all = [
    ...bills.map((b) => ({ date: b.billDate, type: "Bill", ref: b.billNumber, id: b._id, debit: round2(b.finalTotal), credit: 0, order: 0 })),
    ...payments.map((p) => ({ date: p.date, type: "Payment", ref: p.number, id: p._id, debit: 0, credit: round2(p.amount), order: 1, note: p.mode })),
    ...credits.map((c) => ({ date: c.creditDate, type: "Vendor credit", ref: c.creditNoteNumber, id: c._id, debit: 0, credit: round2(c.finalTotal), order: 2 })),
  ].filter((e) => e.date);

  let opening = 0;
  const inRange = [];
  for (const e of all) {
    const day = istDateString(e.date);
    if (fromDay && day < fromDay) opening = round2(opening + e.debit - e.credit);
    else if (!toDay || day <= toDay) inRange.push({ ...e, day });
  }
  inRange.sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order || String(a.ref).localeCompare(String(b.ref)));
  let balance = opening, totalDebit = 0, totalCredit = 0;
  const entries = inRange.map(({ order, day, ...e }) => {
    balance = round2(balance + e.debit - e.credit);
    totalDebit = round2(totalDebit + e.debit);
    totalCredit = round2(totalCredit + e.credit);
    return { ...e, balance };
  });
  return { opening, entries, totalDebit, totalCredit, closing: round2(opening + totalDebit - totalCredit) };
};
