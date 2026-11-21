// End-to-end checks for Phase 2 (gift cards, vouchers) against a THROWAWAY database.
// It calls the real controllers with fake requests and wipes the database it is given.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test2 node scripts/test-offers-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import Customer from "../model/Customer.js";
import SalesInvoice from "../model/SalesInvoice.js";
import ShoeItem from "../model/ShoeItem.js";
import GiftCard from "../model/GiftCard.js";
import Voucher from "../model/Voucher.js";
import StoreCredit from "../model/StoreCredit.js";
import Transaction from "../model/Transaction.js";
import { createSalesInvoice, updateSalesInvoice, deleteSalesInvoice } from "../controllers/SalesInvoiceController.js";
import { issueGiftCards, reloadGiftCard, setGiftCardBlocked } from "../controllers/GiftCardController.js";
import { createVouchers, getScopeOptions } from "../controllers/VoucherController.js";
import { saveSettings } from "../controllers/LoyaltyController.js";
import { checkRedemption } from "../controllers/StoreCreditController.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test2");
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
const settle = () => new Promise((r) => setTimeout(r, 500)); // background daybook writes
const ADMIN = "admin@test.local";
const STAFF = "staff@test.local";
const WH = "Test Store";

await mongoose.connect(uri);
await mongoose.connection.db.dropDatabase();
await Promise.all([Customer.syncIndexes(), GiftCard.syncIndexes(), Voucher.syncIndexes()]);
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin", locCode: "T01" });
await User.create({ username: "staff", email: STAFF, password: "x", power: "normal", role: "store_user", locCode: "T01", storeName: WH });
await call(saveSettings, { body: { userId: ADMIN, locCode: null, earnAmount: 100, earnPoints: 1, redeemAmount: 1, redeemPoints: 1, maxRedeemPercent: 50, minInvoiceForRedeem: 0 } });

const stock = (q) => [{ warehouse: WH, stockOnHand: q, availableForSale: q, physicalStockOnHand: q, physicalAvailableForSale: q }];
const ring = await ShoeItem.create({ itemName: "Gold Ring", sku: "RING-1", brand: "Tanishq", itemCategory: "Rings", sellingPrice: 2000, costPrice: 1500, trackInventory: true, warehouseStocks: stock(100) });
const chain = await ShoeItem.create({ itemName: "Silver Chain", sku: "CHAIN-1", brand: "Malabar", itemCategory: "Chains", sellingPrice: 1000, costPrice: 700, trackInventory: true, warehouseStocks: stock(100) });
const line = (item, qty = 1) => ({ item: item.itemName, itemData: { _id: String(item._id), itemName: item.itemName, sku: item.sku }, itemSku: item.sku, quantity: qty, rate: item.sellingPrice, amount: item.sellingPrice * qty });
const bill = (lines, o = {}) => {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { customer: "Walk-in", customerPhone: "", branch: WH, warehouse: WH, salesperson: "S1", category: "income", locCode: "T01",
    paymentMethod: "Cash", status: "sent", invoiceDate: new Date(), userId: ADMIN, lineItems: lines, subTotal: total, finalTotal: total, ...o };
};
const card = (code) => GiftCard.findOne({ code }).lean();

// ── F4 Gift cards ───────────────────────────────────────────────────────────
let r = await call(issueGiftCards, { body: { userId: ADMIN, count: 3, value: 1000, paymentMode: "cash", locCode: "T01" } });
eq("issue 3 cards", [r.status, r.body.cards?.length, r.body.saleRef], [201, 3, "GCS-000001"]);
const [A, B, C] = r.body.cards.map((c) => c.code);
eq("codes unique & formatted", new Set([A, B, C]).size === 3 && /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(A), true);
const sale = await Transaction.findOne({ invoiceNo: "GCS-000001" }).lean();
eq("sale posted to daybook as money in", [sale?.type, sale?.category, sale?.amount, sale?.cash, sale?.locCode], ["Income", "Gift Card Sale", "3000", "3000", "T01"]);
r = await call(issueGiftCards, { body: { userId: STAFF, count: 1, value: 500, paymentMode: "complimentary" } });
eq("complimentary needs admin", r.status, 403);
r = await call(issueGiftCards, { body: { userId: ADMIN, count: 1, value: 500, paymentMode: "complimentary", code: A } });
eq("typed code must be unique", r.status, 409);

// Walk-in bill ₹2,000 paid with card A ₹1,000 + card B ₹300 → ₹700 due
r = await call(checkRedemption, { body: { userId: STAFF, type: "giftCard", code: A.toLowerCase(), finalTotal: 2000, locCode: "T01" } });
eq("check: walk-in can use a gift card, max = balance", [r.status, r.body.amount], [200, 1000]);
r = await call(createSalesInvoice, { body: bill([line(ring)], { redemptions: [{ type: "giftCard", code: A, amount: 1000 }, { type: "giftCard", code: B, amount: 300 }], amountDue: 700 }) });
eq("bill with two gift cards", [r.status, r.body.amountDue, r.body.totalRedeemed], [201, 700, 1300]);
const gBill = r.body;
eq("card balances after use", [(await card(A)).balance, (await card(B)).balance], [0, 700]);
await settle();
const gTx = await Transaction.findOne({ invoiceNo: gBill.invoiceNumber }).lean();
eq("daybook: only ₹700 cash, gift cards not cash", [gTx.cash, gTx.redeemedAmount], ["700", 1300]);
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "giftCard", code: A, amount: 100 }] }) });
eq("empty card refused", r.status, 400);

r = await call(setGiftCardBlocked, { params: { id: String((await card(C))._id) }, body: { userId: STAFF, blocked: true } });
eq("block needs admin", r.status, 403);
r = await call(setGiftCardBlocked, { params: { id: String((await card(C))._id) }, body: { userId: ADMIN, blocked: true } });
eq("admin blocks card", r.body.status, "blocked");
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "giftCard", code: C, amount: 100 }] }) });
eq("blocked card refused", [r.status, /blocked/.test(r.body.message)], [400, true]);
await call(setGiftCardBlocked, { params: { id: String((await card(C))._id) }, body: { userId: ADMIN, blocked: false } });

r = await call(deleteSalesInvoice, { params: { id: String(gBill._id) }, body: { userId: ADMIN } });
eq("delete gift card bill", r.status, 200);
const cardA = await card(A);
eq("delete puts balances back", [cardA.balance, (await card(B)).balance], [1000, 1000]);
eq("history shows redeem (reversed) + reverse", cardA.history.map((h) => `${h.type}${h.reversed ? "*" : ""}`), ["issue", "redeem*", "reverse"]);

r = await call(reloadGiftCard, { params: { id: String(cardA._id) }, body: { userId: ADMIN, amount: 500, paymentMode: "upi" } });
eq("non-reloadable card refused", r.status, 409);
r = await call(issueGiftCards, { body: { userId: ADMIN, count: 1, value: 200, paymentMode: "bank", reloadable: true, customerPhone: "9000011111", customerName: "Riya" } });
const R = r.body.cards[0];
r = await call(reloadGiftCard, { params: { id: String(R._id) }, body: { userId: ADMIN, amount: 500, paymentMode: "upi" } });
eq("reload", [r.status, r.body.balance], [200, 700]);
const rel = await Transaction.findOne({ invoiceNo: "GCR-000001" }).lean();
eq("reload posted as money in (UPI)", [rel?.category, rel?.upi, rel?.cash], ["Gift Card Reload", "500", "0"]);
eq("card linked to customer", String((await card(R.code)).soldToCustomerId) === String((await Customer.findOne({ phone: "9000011111" }))._id), true);

// Two bills at once on one ₹1,000 card, ₹800 each → only one may succeed
const [p1, p2] = await Promise.all([
  call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "giftCard", code: C, amount: 800 }], amountDue: 200 }) }),
  call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "giftCard", code: C, amount: 800 }], amountDue: 200 }) }),
]);
eq("race on one card: exactly one bill wins", [p1.status, p2.status].sort(), [201, 409]);
eq("race: card never negative", (await card(C)).balance, 200);

// Return of a bill paid partly by gift card: that share comes back as store credit only
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "giftCard", code: B, amount: 600 }], amountDue: 400 }) });
const gB2 = r.body;
r = await call(createSalesInvoice, { body: bill([line(chain)], { category: "Return", originalInvoiceId: String(gB2._id), originalInvoiceNumber: gB2.invoiceNumber, finalTotal: -1000, subTotal: 1000 }) });
eq("walk-in gift-card return needs a phone", [r.status, /store credit/.test(r.body.message)], [400, true]);
r = await call(createSalesInvoice, { body: bill([line(chain)], { customerPhone: "9000022222", customer: "Walk-in Ravi", category: "Return", originalInvoiceId: String(gB2._id), originalInvoiceNumber: gB2.invoiceNumber, finalTotal: -1000, subTotal: 1000 }) });
eq("gift-card share refunded as store credit, rest cash", [r.status, r.body.refundBreakdown?.cashRefund, r.body.refundBreakdown?.storeCreditAmount], [201, 400, 600]);

// ── F5 Vouchers ─────────────────────────────────────────────────────────────
r = await call(getScopeOptions, { query: { userId: ADMIN } });
eq("scope options list brands and categories", [r.body.brands?.includes("Tanishq"), r.body.categories?.includes("Rings")], [true, true]);
r = await call(createVouchers, { body: { userId: STAFF, kind: "discount", value: 10 } });
eq("vouchers need admin", r.status, 403);
r = await call(createVouchers, { body: { userId: ADMIN, kind: "discount", discountType: "percent", value: 10, maxDiscount: 150, minBillAmount: 500, scope: { brands: ["tanishq"] }, code: "RING10" } });
eq("create percent voucher", [r.status, r.body.vouchers?.[0]?.code], [201, "RING10"]);

// Ring ₹2,000 (Tanishq) + chain ₹1,000: eligible 2,000 → 10% = 200, capped at 150
r = await call(checkRedemption, { body: { userId: ADMIN, type: "voucher", code: "ring10", finalTotal: 3000, locCode: "T01", lines: [line(ring), line(chain)] } });
eq("check: voucher only counts eligible items", [r.status, r.body.eligibleTotal, r.body.amount], [200, 2000, 150]);
r = await call(createSalesInvoice, { body: bill([line(ring), line(chain)], { customerPhone: "9876500001", customer: "Asha", redemptions: [{ type: "voucher", code: "RING10" }], amountDue: 2850 }) });
eq("voucher bill", [r.status, r.body.amountDue, r.body.redemptions?.[0]?.amount], [201, 2850, 150]);
const vBill = r.body;
eq("voucher amount is not earned on (3000 − 150 → 28 pts)", vBill.loyaltyPointsEarned, 28);
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "RING10" }] }) });
eq("voucher with no eligible item refused", [r.status, /qualifies/.test(r.body.message)], [400, true]);
r = await call(createSalesInvoice, { body: bill([line(ring)], { finalTotal: 400, subTotal: 400, lineItems: [{ ...line(ring), amount: 400, rate: 400 }], redemptions: [{ type: "voucher", code: "RING10" }] }) });
eq("voucher below min bill refused", r.status, 400);

// Edit the voucher bill without changes → voucher used once, not twice
r = await call(updateSalesInvoice, { params: { id: String(vBill._id) }, body: { ...bill([line(ring), line(chain)], { customerPhone: "9876500001", customer: "Asha" }), redemptions: [{ type: "voucher", code: "RING10" }] } });
const v10 = await Voucher.findOne({ code: "RING10" }).lean();
eq("edit re-applies voucher once", [r.status, v10.usedCount, v10.usages.filter((u) => !u.reversed).length], [200, 1, 1]);

// Return the chain (₹1,000) from the ₹3,000 bill: refundable 1000 × 2850/3000 = 950, voucher not restored
r = await call(createSalesInvoice, { body: bill([line(chain)], { category: "Return", originalInvoiceId: String(vBill._id), originalInvoiceNumber: vBill.invoiceNumber, finalTotal: -1000, subTotal: 1000 }) });
eq("return refunds money share only", [r.status, r.body.refundBreakdown?.cashRefund, r.body.refundBreakdown?.nonRefundable], [201, 950, 50]);
eq("voucher not restored by return", (await Voucher.findOne({ code: "RING10" }).lean()).usedCount, 1);

// Usage limits
await call(createVouchers, { body: { userId: ADMIN, kind: "discount", discountType: "flat", value: 100, usageLimitTotal: 1, code: "ONCE100" } });
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "ONCE100" }] }) });
eq("limit-1 voucher: first use", r.status, 201);
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "ONCE100" }] }) });
eq("limit-1 voucher: second use refused", [r.status, /maximum/.test(r.body.message)], [400, true]);
await call(createVouchers, { body: { userId: ADMIN, kind: "discount", discountType: "flat", value: 100, usageLimitTotal: 1, code: "RACE100" } });
const [q1, q2] = await Promise.all([
  call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "RACE100" }] }) }),
  call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "RACE100" }] }) }),
]);
eq("race on a limit-1 voucher: exactly one bill wins", [q1.status, q2.status].sort(), [201, 409]);
eq("race: usedCount stays 1", (await Voucher.findOne({ code: "RACE100" }).lean()).usedCount, 1);

await call(createVouchers, { body: { userId: ADMIN, kind: "discount", discountType: "flat", value: 50, usageLimitPerCustomer: 1, code: "PERCUST" } });
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "PERCUST" }] }) });
eq("per-customer voucher needs a phone", r.status, 400);
r = await call(createSalesInvoice, { body: bill([line(chain)], { customerPhone: "9876500002", customer: "Ben", redemptions: [{ type: "voucher", code: "PERCUST" }] }) });
eq("per-customer: first use", r.status, 201);
r = await call(createSalesInvoice, { body: bill([line(chain)], { customerPhone: "+91 98765 00002", customer: "Ben", redemptions: [{ type: "voucher", code: "PERCUST" }] }) });
eq("per-customer: second use by same person refused", r.status, 400);

await call(createVouchers, { body: { userId: ADMIN, kind: "discount", discountType: "flat", value: 50, customerPhone: "9876500001", customerName: "Asha", code: "ASHAONLY" } });
r = await call(createSalesInvoice, { body: bill([line(chain)], { customerPhone: "9876500002", customer: "Ben", redemptions: [{ type: "voucher", code: "ASHAONLY" }] }) });
eq("customer-owned voucher refused for someone else", [r.status, /another customer/.test(r.body.message)], [400, true]);
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "ASHAONLY" }, { type: "voucher", code: "ONCE100" }] }) });
eq("one voucher per bill", r.status, 400);

// Stored-value voucher: ₹500 on Malabar items, spent over several bills
await call(createVouchers, { body: { userId: ADMIN, kind: "value", value: 500, scope: { brands: ["Malabar"] }, code: "VAL500" } });
r = await call(createSalesInvoice, { body: bill([line(ring), line(chain)], { finalTotal: 3000, redemptions: [{ type: "voucher", code: "VAL500", amount: 300 }] }) });
eq("value voucher part use", [r.status, r.body.redemptions?.[0]?.amount], [201, 300]);
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "VAL500" }] }) });
eq("value voucher uses the rest (₹200)", [r.status, r.body.redemptions?.[0]?.amount], [201, 200]);
const valBill2 = r.body;
r = await call(createSalesInvoice, { body: bill([line(chain)], { redemptions: [{ type: "voucher", code: "VAL500" }] }) });
eq("value voucher empty → refused", r.status, 400);
await call(deleteSalesInvoice, { params: { id: String(valBill2._id) }, body: { userId: ADMIN } });
const val = await Voucher.findOne({ code: "VAL500" }).lean();
eq("delete gives back value voucher balance", [val.balance, val.usedCount], [200, 1]);

// Bulk create
r = await call(createVouchers, { body: { userId: ADMIN, count: 25, kind: "discount", discountType: "flat", value: 100, codePrefix: "DIWALI" } });
eq("bulk vouchers", [r.status, r.body.vouchers?.length, new Set(r.body.vouchers?.map((v) => v.code)).size, r.body.batchRef], [201, 25, 25, "VB-000001"]);
eq("bulk codes use prefix", r.body.vouchers.every((v) => /^DIWALI-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v.code)), true);

// Mixed: loyalty + store credit + gift card + voucher on one bill (customer Riya)
const riya = await Customer.findOne({ phone: "9000011111" });
await Customer.updateOne({ _id: riya._id }, { $set: { loyaltyPoints: 100 } });
r = await call(createSalesInvoice, { body: bill([line(ring), line(chain)], { customerPhone: "9000011111", customer: "Riya", redemptions: [
  { type: "loyalty", points: 100 }, { type: "giftCard", code: R.code, amount: 700 }, { type: "voucher", code: (await Voucher.findOne({ batchRef: "VB-000001" }).lean()).code },
], amountDue: 3000 - 100 - 700 - 100 }) });
eq("mixed redemptions on one bill", [r.status, r.body.amountDue, r.body.redemptions?.length], [201, 2100, 3]);
eq("mixed: earn base excludes loyalty & voucher, keeps gift card (3000−100−100 = 2800 → 28)", r.body.loyaltyPointsEarned, 28);

// Voucher scope uses the tax-inclusive price (qty × rate): the screen sends line.amount without tax
await Voucher.create({ code: "TAXED10", kind: "discount", discountType: "percent", value: 10, active: true });
r = await call(checkRedemption, { body: { userId: ADMIN, type: "voucher", code: "TAXED10", finalTotal: 2000, locCode: "T01", lines: [{ ...line(ring), amount: 1904.76 }] } });
eq("voucher eligible total = qty × rate, not the pre-tax line amount", [r.status, r.body.eligibleTotal, r.body.amount], [200, 2000, 200]);

console.log(`\nStore credits issued: ${await StoreCredit.countDocuments({})}`);
await settle(); // let background daybook writes finish before disconnecting
await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll offers integration checks passed");
process.exit(failed ? 1 : 0);
