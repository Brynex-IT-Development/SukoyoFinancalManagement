// Checks the pure retail formulas against the worked examples in the spec.
// Run: node scripts/test-retail-math.js   (exits 1 on any failure)
import {
  normalizePhone, maxRedeemable, pointsToAmount, amountToPoints, earnBaseOf, pointsEarned,
  returnRefundSplit, valuePerPoint,
} from "../utils/retailMath.js";
import { formatNumber } from "../utils/nextNumber.js";
import { istDayEnd, addIstDays } from "../utils/ist.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};

// ── Phone normalisation (F1)
eq("phone +91 98xxxxxxxx", normalizePhone("+91 98765 43210"), "9876543210");
eq("phone 919876543210", normalizePhone("919876543210"), "9876543210");
eq("phone plain 10-digit mobile", normalizePhone("9876543210"), "9876543210");
eq("phone landline 0484-2345678", normalizePhone("0484-2345678"), "04842345678");
eq("phone too short", normalizePhone("12345"), null);
eq("phone too long", normalizePhone("1234567890123456"), null);
eq("phone empty", normalizePhone(""), null);

// ── Loyalty worked example (F2)
const s = { earnAmount: 100, earnPoints: 1, minInvoiceForEarning: 0, redeemAmount: 1, redeemPoints: 1, maxRedeemPercent: 50, minInvoiceForRedeem: 500, active: true };
const lim = maxRedeemable({ finalTotal: 1250, balance: 900, settings: s });
eq("max redeem amount on ₹1250", lim.maxAmount, 625);
eq("max redeem points on ₹1250 with 900 pts", lim.maxPoints, 625);
const redeemAmt = pointsToAmount(625, s);
eq("625 pts = ₹625", redeemAmt, 625);
const base = earnBaseOf({ finalTotal: 1250, loyaltyAmount: redeemAmt });
eq("earn base", base, 625);
const earned = pointsEarned(base, s);
eq("points earned", earned, 6);
eq("new balance 900 − 625 + 6", 900 - 625 + earned, 281);
eq("below min invoice cannot redeem", maxRedeemable({ finalTotal: 400, balance: 900, settings: s }).allowed, false);
eq("max points capped by balance", maxRedeemable({ finalTotal: 1250, balance: 100, settings: s }).maxPoints, 100);

const s2 = { ...s, redeemAmount: 1, redeemPoints: 4 }; // 4 points = ₹1 → ₹0.25 per point
eq("value per point 0.25", valuePerPoint(s2), 0.25);
eq("₹10 → 40 points", amountToPoints(10, s2), 40);
eq("₹10.10 → 40 points (floor)", amountToPoints(10.1, s2), 40);
eq("min invoice for earning", pointsEarned(99, { ...s, minInvoiceForEarning: 100 }), 0);
eq("loyalty switched off: no earning", pointsEarned(1000, { ...s, enabled: false }), 0);
eq("loyalty switched off: no redeeming", maxRedeemable({ finalTotal: 1250, balance: 900, settings: { ...s, enabled: false } }).allowed, false);

// ── Return of an invoice that used redemptions (section 4 rule 6)
// Bill ₹1250: loyalty ₹625 (625 pts used), earned 6. Return ₹500 of goods.
const r1 = returnRefundSplit({ baseTotal: 1250, returnValue: 500, redemptions: [{ type: "loyalty", amount: 625, points: 625 }], pointsUsed: 625, pointsEarned: 6 });
eq("return: refundable = 500 × 0.5", r1.refundable, 250);
eq("return: cash refund", r1.cashRefund, 250);
eq("return: points restored round(625×0.4)", r1.pointsRestore, 250);
eq("return: points reversed floor(6×0.4)", r1.pointsReverse, 2);
eq("return: non-refundable", r1.nonRefundable, 250);

// Bill ₹2000 paid ₹500 store credit + ₹1500 cash; return everything → ₹500 back as store credit, ₹1500 cash
const r2 = returnRefundSplit({ baseTotal: 2000, returnValue: 2000, redemptions: [{ type: "storeCredit", amount: 500 }] });
eq("return: store-credit share comes back as store credit", r2.storeCreditAmount, 500);
eq("return: rest in cash", r2.cashRefund, 1500);
const r3 = returnRefundSplit({ baseTotal: 2000, returnValue: 2000, redemptions: [{ type: "storeCredit", amount: 500 }], refundMode: "storeCredit" });
eq("return as store credit: all refundable is credit", [r3.storeCreditAmount, r3.cashRefund], [2000, 0]);

// Caps across several partial returns
const r4 = returnRefundSplit({ baseTotal: 1250, returnValue: 1250, redemptions: [{ type: "loyalty", amount: 625 }], pointsUsed: 625, pointsEarned: 6, alreadyRestored: 250, alreadyReversed: 2 });
eq("second return restores only what is left", [r4.pointsRestore, r4.pointsReverse], [375, 4]);

// Plain invoice (no redemptions) behaves like today
const r5 = returnRefundSplit({ baseTotal: 1000, returnValue: 300 });
eq("no redemptions: full cash refund", [r5.cashRefund, r5.storeCreditAmount], [300, 0]);

// ── Numbering + IST helpers
eq("number format", formatNumber("SC-", 1), "SC-000001");
eq("number format big", formatNumber("SC-", 1234567), "SC-1234567");
// 20 Nov 2026 22:00 IST = 16:30 UTC → +30 days ends 20 Dec 2026 23:59:59.999 IST
const issue = new Date("2026-11-20T16:30:00Z");
eq("expiry = end of IST day + 30", istDayEnd(addIstDays(issue, 30)).toISOString(), "2026-12-20T18:29:59.999Z");
// 20 Nov 2026 00:30 IST is 19 Nov 19:00 UTC — still 20 Nov in India
eq("IST day boundary", istDayEnd(new Date("2026-11-19T19:00:00Z")).toISOString(), "2026-11-20T18:29:59.999Z");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
