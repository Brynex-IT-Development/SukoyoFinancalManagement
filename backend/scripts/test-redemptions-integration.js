// End-to-end checks for Phase 1 (customers, loyalty, store credit) against a THROWAWAY database.
// It calls the real controllers with fake requests and wipes the database it is given.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test node scripts/test-redemptions-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import Customer from "../model/Customer.js";
import SalesInvoice from "../model/SalesInvoice.js";
import StoreCredit from "../model/StoreCredit.js";
import LoyaltyLedger from "../model/LoyaltyLedger.js";
import Transaction from "../model/Transaction.js";
import { createSalesInvoice, updateSalesInvoice, deleteSalesInvoice } from "../controllers/SalesInvoiceController.js";
import { adjustLoyalty } from "../controllers/CustomerController.js";
import { saveSettings } from "../controllers/LoyaltyController.js";
import { checkRedemption } from "../controllers/StoreCreditController.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test");
  process.exit(2);
}

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};
const call = (handler, { body = {}, params = {}, query = {} } = {}) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve({ status: this.statusCode, body: b }); return this; },
  };
  handler({ body, params, query, headers: {} }, res).catch(reject);
});
const settle = () => new Promise((r) => setTimeout(r, 400)); // background daybook writes
const ADMIN = "admin@test.local";
const points = async (phone) => (await Customer.findOne({ phone }).lean())?.loyaltyPoints;

const sale = (overrides = {}) => ({
  customer: "Asha", customerPhone: "9876543210", branch: "Test Store", warehouse: "Test Store",
  salesperson: "S1", category: "income", locCode: "T01", paymentMethod: "Cash", status: "sent",
  invoiceDate: new Date(), userId: ADMIN,
  // A free-text line (no item id / sku) moves no stock, so no items are needed for these checks
  lineItems: [{ item: "Gold ring (test line)", quantity: 1, rate: 1250, amount: 1250 }],
  subTotal: 1250, finalTotal: 1250,
  ...overrides,
});

await mongoose.connect(uri);
await mongoose.connection.db.dropDatabase();
await Customer.syncIndexes();
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin" });

// ── Settings from the worked example: ₹100 → 1 pt, 1 pt = ₹1, max 50 %, min ₹500 to redeem
let r = await call(saveSettings, { body: { userId: ADMIN, locCode: null, earnAmount: 100, earnPoints: 1, redeemAmount: 1, redeemPoints: 1, maxRedeemPercent: 50, minInvoiceForRedeem: 500 } });
eq("save loyalty settings", r.status, 201);

// ── F1: first bill creates the customer, same number in another format reuses it
r = await call(createSalesInvoice, { body: sale({ finalTotal: 100, subTotal: 100, lineItems: [{ item: "Test line", quantity: 1, rate: 100, amount: 100 }] }) });
eq("F1 first bill saved", r.status, 201);
r = await call(createSalesInvoice, { body: sale({ customerPhone: "+91 98765 43210", customer: "Asha K", finalTotal: 100, subTotal: 100, lineItems: [{ item: "Test line", quantity: 1, rate: 100, amount: 100 }] }) });
eq("F1 second bill saved", r.status, 201);
eq("F1 exactly one customer", await Customer.countDocuments({}), 1);
const cust = await Customer.findOne({ phone: "9876543210" }).lean();
eq("F1 name updated to latest", cust.name, "Asha K");
eq("F1 both invoices linked", await SalesInvoice.countDocuments({ customerId: cust._id }), 2);
eq("F1 earned 1 pt per ₹100 bill", cust.loyaltyPoints, 2);
r = await call(createSalesInvoice, { body: sale({ customerPhone: "12345" }) });
eq("F1 invalid phone rejected", r.status, 400);

// ── F2 worked example: balance 900, bill ₹1250, redeem 625 → due 625, earn 6, balance 281
await call(adjustLoyalty, { params: { id: String(cust._id) }, body: { userId: ADMIN, points: 898, note: "test top-up" } });
eq("balance before", await points("9876543210"), 900);
r = await call(checkRedemption, { body: { userId: ADMIN, type: "loyalty", phone: "9876543210", finalTotal: 1250, locCode: "T01" } });
eq("check: max points offered", [r.status, r.body.maxPoints, r.body.maxAmount], [200, 625, 625]);
r = await call(createSalesInvoice, { body: sale({ redemptions: [{ type: "loyalty", points: 626 }] }) });
eq("over-redeem rejected", r.status, 400);
r = await call(createSalesInvoice, { body: sale({ redemptions: [{ type: "loyalty", points: 625 }], amountDue: 600 }) });
eq("screen/server amount due mismatch → 409", r.status, 409);
r = await call(createSalesInvoice, { body: sale({ redemptions: [{ type: "loyalty", points: 625 }], isSplitPayment: true, paymentMethod: "", splitPaymentAmounts: { cash: "500", bank: "0", upi: "0", rbl: "" } }) });
eq("split not adding up to amount due → 400", r.status, 400);
eq("rejected bills changed no balance", await points("9876543210"), 900);
r = await call(createSalesInvoice, { body: sale({ redemptions: [{ type: "loyalty", points: 625 }], amountDue: 625 }) });
eq("redeem bill saved", r.status, 201);
const inv1 = r.body;
eq("amount due", inv1.amountDue, 625);
eq("points earned", inv1.loyaltyPointsEarned, 6);
eq("balance 900 − 625 + 6", await points("9876543210"), 281);
await settle();
const tx1 = await Transaction.findOne({ invoiceNo: inv1.invoiceNumber }).lean();
eq("daybook: amount = bill total, cash = money received", [tx1.amount, tx1.cash, tx1.redeemedAmount], ["1250", "625", 625]);

// ── Edit: use 100 points instead of 625 → balance 281 + 625 − 6 − 100 + earn floor(1150/100)=11 = 811
r = await call(updateSalesInvoice, { params: { id: String(inv1._id) }, body: { ...sale(), redemptions: [{ type: "loyalty", points: 100 }] } });
eq("edit saved", r.status, 200);
eq("edit: balance after re-apply", await points("9876543210"), 811);
await settle();
eq("edit: daybook cash follows new amount due", (await Transaction.findOne({ invoiceNo: inv1.invoiceNumber }).lean()).cash, "1150");

// ── Return ₹500 of the edited bill (base 1250, loyalty ₹100): refundable 500 × 1150/1250 = 460,
//    points restored round(100 × 0.4) = 40, reversed floor(11 × 0.4) = 4 → 811 + 40 − 4 = 847
r = await call(createSalesInvoice, { body: sale({ category: "Return", originalInvoiceId: String(inv1._id), originalInvoiceNumber: inv1.invoiceNumber, finalTotal: -500, subTotal: 500, lineItems: [{ item: "Gold ring (test line)", quantity: 1, rate: 500, amount: 500 }] }) });
eq("return saved", r.status, 201);
eq("return refund split", [r.body.refundBreakdown.cashRefund, r.body.refundBreakdown.pointsRestored, r.body.refundBreakdown.pointsReversed], [460, 40, 4]);
eq("return: balance", await points("9876543210"), 847);
await settle();
eq("return: daybook cash = −refund", (await Transaction.findOne({ invoiceNo: r.body.invoiceNumber }).lean()).cash, "-460");

// ── F3: ₹2,000 store credit used ₹1,200 then ₹800; third use rejected; deleting 2nd bill restores ₹800
r = await call(createSalesInvoice, { body: sale({ customerPhone: "9123456780", customer: "Ravi", finalTotal: 2000, subTotal: 2000, lineItems: [{ item: "Chain (test line)", quantity: 1, rate: 2000, amount: 2000 }] }) });
const invR = r.body;
r = await call(createSalesInvoice, { body: sale({ customerPhone: "9123456780", customer: "Ravi", category: "Return", refundMode: "storeCredit", originalInvoiceId: String(invR._id), originalInvoiceNumber: invR.invoiceNumber, finalTotal: -2000, subTotal: 2000, lineItems: [{ item: "Chain (test line)", quantity: 1, rate: 2000, amount: 2000 }] }) });
eq("return as store credit saved", r.status, 201);
const sc = await StoreCredit.findOne({}).lean();
eq("store credit issued", [sc.number, sc.amount, sc.balance, sc.status], ["SC-000001", 2000, 2000, "open"]);
eq("store credit has expiry", !!sc.expiryDate, true);
await settle();
eq("store-credit refund puts no cash in the daybook", (await Transaction.findOne({ invoiceNo: r.body.invoiceNumber }).lean()).cash, "0");

const ravi = (o) => sale({ customerPhone: "9123456780", customer: "Ravi", ...o });
r = await call(createSalesInvoice, { body: ravi({ finalTotal: 1500, subTotal: 1500, redemptions: [{ type: "storeCredit", refId: String(sc._id), amount: 1200 }], lineItems: [{ item: "X", quantity: 1, rate: 1500, amount: 1500 }] }) });
eq("use ₹1,200", [r.status, r.body.amountDue], [201, 300]);
r = await call(createSalesInvoice, { body: ravi({ finalTotal: 800, subTotal: 800, paymentMethod: "", redemptions: [{ type: "storeCredit", code: "sc-000001", amount: 800 }], lineItems: [{ item: "Y", quantity: 1, rate: 800, amount: 800 }] }) });
eq("use ₹800 (fully paid by credit, no payment method needed)", [r.status, r.body.amountDue], [201, 0]);
const inv800 = r.body;
eq("credit used up", (await StoreCredit.findById(sc._id).lean()).status, "used");
r = await call(createSalesInvoice, { body: ravi({ finalTotal: 100, subTotal: 100, redemptions: [{ type: "storeCredit", refId: String(sc._id), amount: 1 }], lineItems: [{ item: "Z", quantity: 1, rate: 100, amount: 100 }] }) });
eq("third use rejected", r.status, 400);
r = await call(deleteSalesInvoice, { params: { id: String(inv800._id) }, body: { userId: ADMIN } });
eq("delete second bill", r.status, 200);
const scAfter = await StoreCredit.findById(sc._id).lean();
eq("₹800 restored, credit open again", [scAfter.balance, scAfter.status], [800, "open"]);
eq("customer store credit balance cached", (await Customer.findOne({ phone: "9123456780" }).lean()).storeCreditBalance, 800);

// ── Rollback: a save that fails after redemptions were taken leaves balances untouched
const before = await points("9876543210");
const ledgerBefore = await LoyaltyLedger.countDocuments({});
r = await call(createSalesInvoice, { body: sale({ status: "bogus-status", redemptions: [{ type: "loyalty", points: 100 }] }) });
eq("failed save rejected", r.status, 400);
eq("failed save: points untouched", await points("9876543210"), before);
eq("failed save: its ledger rows were removed", await LoyaltyLedger.countDocuments({}), ledgerBefore);

// ── Delete gives back points used and takes back points earned: 847 → use 200 on ₹1250, earn 10 → 657; delete → 847
r = await call(createSalesInvoice, { body: sale({ redemptions: [{ type: "loyalty", points: 200 }] }) });
eq("bill with 200 points", [r.status, await points("9876543210")], [201, 657]);
r = await call(deleteSalesInvoice, { params: { id: String(r.body._id) }, body: { userId: ADMIN } });
eq("delete restores balance", [r.status, await points("9876543210")], [200, 847]);

// ── Ledger is consistent with the cached balance
for (const phone of ["9876543210", "9123456780"]) {
  const c = await Customer.findOne({ phone }).lean();
  const [agg] = await LoyaltyLedger.aggregate([{ $match: { customerId: c._id } }, { $group: { _id: null, s: { $sum: "$points" } } }]);
  eq(`ledger sum = balance (${phone})`, agg?.s || 0, c.loyaltyPoints);
}

await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll integration checks passed");
process.exit(failed ? 1 : 0);
