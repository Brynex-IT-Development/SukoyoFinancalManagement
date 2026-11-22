// End-to-end checks for the Phase 5 reports on a THROWAWAY database.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test5 node scripts/test-reports-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import Store from "../model/Store.js";
import { profitAndLoss, profitStock } from "../controllers/ProfitLossController.js";
import { billWiseProfit, billProfitDetail } from "../controllers/BillProfitController.js";
import { purchaseSummary, purchasesByItemVendor, gstPurchaseRegister } from "../controllers/PurchaseReportController.js";
import { deadStockReport, overstockReport, abcReport, updateStockSettings } from "../controllers/StockHealthController.js";
import { istDateString } from "../utils/ist.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test5");
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
const ADMIN = "admin@test.local", STAFF = "staff@test.local", CLUSTER = "cluster@test.local";
const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const FROM = istDateString(daysAgo(30)), TO = istDateString(new Date());
const pick = (o, keys) => keys.map((k) => o[k]);

await mongoose.connect(uri);
const db = mongoose.connection.db;
await db.dropDatabase();
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin", locCode: "T01" });
await User.create({ username: "staff", email: STAFF, password: "x", power: "normal", role: "store_user", locCode: "T01" });
await User.create({ username: "cluster", email: CLUSTER, password: "x", power: "normal", role: "cluster_manager", locCode: "T01", allowedLocCodes: ["T01", "T02"] });
await Store.create({ name: "Store One", locCode: "T01" });
await Store.create({ name: "Store Two", locCode: "T02" });

// ── Items: Ring ₹600 cost (10 at Store One, 5 at Store Two), Chain ₹500 (3), Bangle variant ₹1,000 (2)
const itemR = new mongoose.Types.ObjectId(), itemC = new mongoose.Types.ObjectId(), groupB = new mongoose.Types.ObjectId(), itemB = new mongoose.Types.ObjectId();
await db.collection("shoeitems").insertMany([
  { _id: itemR, itemName: "Ring", sku: "RING-1", category: "other", costPrice: 600, sellingPrice: 1180, warehouseStocks: [{ warehouse: "Store One", stockOnHand: 10 }, { warehouse: "Store Two", stockOnHand: 5 }] },
  { _id: itemC, itemName: "Chain", sku: "CHAIN-1", category: "other", costPrice: 500, sellingPrice: 1050, warehouseStocks: [{ warehouse: "Store One", stockOnHand: 3 }] },
]);
await db.collection("itemgroups").insertOne({ _id: groupB, name: "Bangles", items: [{ _id: itemB, name: "Bangle 2.4", sku: "BANG-24", costPrice: 1000, warehouseStocks: [{ warehouse: "Store One", stockOnHand: 2 }] }] });

const R18 = { _id: String(itemR), itemName: "Ring", taxRateIntra: "GST18 [18%]" };
const C5 = { _id: String(itemC), itemName: "Chain", taxRateIntra: "GST5 [5%]" };
const B5 = { _id: String(itemB), itemName: "Bangle 2.4", itemGroupId: String(groupB), taxRateIntra: "GST5 [5%]" };
const inv = (o) => ({ invoiceDate: daysAgo(o.daysAgo ?? 5), customer: o.customer || "Walk-in", salesperson: o.salesperson || "Anu", category: o.category || "Sales",
  status: o.status || "sent", returnStatus: o.returnStatus || "none", locCode: o.locCode || "T01", warehouse: o.warehouse || (o.locCode === "T02" ? "Store Two" : "Store One"),
  discountAmount: o.discountAmount || 0, tdsTcsAmount: 0, adjustmentAmount: 0, userId: ADMIN, ...o.extra, invoiceNumber: o.invoiceNumber, finalTotal: o.finalTotal, subTotal: o.subTotal ?? Math.abs(o.finalTotal), lineItems: o.lineItems });
const s6Id = new mongoose.Types.ObjectId(), s2Id = new mongoose.Types.ObjectId();
await db.collection("salesinvoices").insertMany([
  // S1: 2 Rings × ₹1,180 → taxable 2,000, tax 360, cost 1,200
  inv({ invoiceNumber: "INV-1", finalTotal: 2360, lineItems: [{ item: "Ring", quantity: 2, rate: 1180, amount: 2000, costPrice: 600, itemData: R18 }] }),
  // S2: sold 3 Chains × ₹1,050 + 1 Bangle × ₹2,100 (5%), 1 Chain returned → trimmed by the return screen
  { _id: s2Id, ...inv({ invoiceNumber: "INV-2", salesperson: "Binu", returnStatus: "partial", finalTotal: 4100, subTotal: 4100, lineItems: [
    { item: "Chain", quantity: 2, rate: 1050, amount: 2100, costPrice: 500, itemData: C5 },
    { item: "Bangle 2.4", quantity: 1, rate: 2100, amount: 2000, costPrice: 1000, itemData: B5, itemGroupId: String(groupB) },
  ] }) },
  inv({ invoiceNumber: "RTN-1", category: "Return", daysAgo: 3, finalTotal: -1050, extra: { originalInvoiceId: String(s2Id), originalInvoiceNumber: "INV-2" },
    lineItems: [{ item: "Chain", quantity: 1, rate: 1050, amount: 1050, costPrice: 500, itemData: { _id: String(itemC), itemName: "Chain" } }] }),
  // S3: saved before cost snapshots existed → current cost ₹600 is used (and noted)
  inv({ invoiceNumber: "INV-3", finalTotal: 1180, lineItems: [{ item: "Ring", quantity: 1, rate: 1180, amount: 1000, itemData: R18 }] }),
  // S4: draft → left out
  inv({ invoiceNumber: "INV-4", status: "draft", finalTotal: 99999, lineItems: [{ item: "Ring", quantity: 50, rate: 1999.98, amount: 84745, costPrice: 600, itemData: R18 }] }),
  // S5: the other store
  inv({ invoiceNumber: "INV-5", locCode: "T02", salesperson: "Cini", finalTotal: 1180, lineItems: [{ item: "Ring", quantity: 1, rate: 1180, amount: 1000, costPrice: 600, itemData: R18 }] }),
  // S6: sold 40 days ago (before the period), fully returned inside it: lines emptied, finalTotal left stale
  { _id: s6Id, ...inv({ invoiceNumber: "INV-6", daysAgo: 40, returnStatus: "full", finalTotal: 1180, extra: { totalTax: 180 }, lineItems: [] }) },
  inv({ invoiceNumber: "RTN-2", category: "Return", daysAgo: 2, finalTotal: -1180, extra: { originalInvoiceId: String(s6Id), originalInvoiceNumber: "INV-6" },
    lineItems: [{ item: "Ring", quantity: 1, rate: 1180, amount: 1180, costPrice: 600, itemData: { _id: String(itemR), itemName: "Ring" } }] }),
]);

// ── Daybook: expenses and other income
const tx = (o) => ({ cash: "0", bank: "0", upi: "0", paymentMethod: "cash", remark: "", subCategory: "", date: daysAgo(o.daysAgo ?? 4), locCode: o.locCode || "T01", invoiceNo: o.invoiceNo || `X-${Math.random()}`, ...o });
await db.collection("transactions").insertMany([
  tx({ type: "Expense", category: "Rent", amount: "-20000", remark: "[INDIRECT] November rent" }),
  tx({ type: "Expense", category: "Packing", amount: "-1500", remark: "[DIRECT] boxes" }),
  tx({ type: "Expense", category: "Vendor Payment", amount: "-5000", invoiceNo: "PAY-000001" }),
  tx({ type: "money transfer", category: "Cash to Bank", amount: "-3000" }),
  tx({ type: "Expense", category: "Tea", amount: "-700", locCode: "T02" }),
  tx({ type: "Expense", category: "Old", amount: "-999", daysAgo: 60 }),
  tx({ type: "Income", category: "Commission", amount: "2500" }),
  tx({ type: "Income", category: "Gift Card Sale", amount: "5000", invoiceNo: "GCS-000001" }),
  tx({ type: "Sales", category: "Sales", amount: "2360", invoiceNo: "INV-1" }),
]);

// ── Purchases: bill ₹11,800 (CGST 900 + SGST 900), a draft bill, a vendor credit ₹1,180 (IGST 180), a draft credit
await db.collection("bills").insertMany([
  { vendorName: "Acme Gold", billNumber: "B-1", billDate: daysAgo(6), finalTotal: 11800, status: "open", userId: ADMIN, locCode: "T01", warehouse: "Store One",
    items: [{ itemName: "Ring", quantity: 10, rate: 1180, baseAmount: 10000, cgstAmount: 900, sgstAmount: 900, taxPercent: 18 }] },
  { vendorName: "Acme Gold", billNumber: "B-DRAFT", billDate: daysAgo(6), finalTotal: 5000, status: "draft", userId: ADMIN, locCode: "T01", items: [{ cgstAmount: 100, sgstAmount: 100 }] },
]);
await db.collection("vendorcredits").insertMany([
  { vendorName: "Acme Gold", creditNoteNumber: "CN-1", creditDate: daysAgo(3), finalTotal: 1180, status: "open", userId: ADMIN, locCode: "T01", items: [{ igstAmount: 180 }] },
  { vendorName: "Acme Gold", creditNoteNumber: "CN-D", creditDate: daysAgo(3), finalTotal: 999, status: "draft", userId: ADMIN, locCode: "T01", items: [{ igstAmount: 99 }] },
]);

// ═══ F11 Profit & loss ═══
// Admin, all stores. Sales taxable: S1 2,000 + S2 5,000 (rebuilt) + S3 1,000 + S5 1,000 = 9,000.
// Returns in the period: RTN-1 1,000 (Chain, rate from INV-2) + RTN-2 Ring 1,180/1.18 = 1,000 → 2,000. Net sales 7,000.
// COGS: sold 1,200 + 2,500 + 600 (fallback) + 600 = 4,900; returned 500 + 600 = 1,100 → 3,800. Gross profit 3,200.
let r = await call(profitAndLoss, { query: { userId: ADMIN, fromDate: FROM, toDate: TO } });
const pl = r.body;
eq("P&L: sales / returns / net sales", pick(pl, ["salesTaxable", "returnsTaxable", "netSales"]), [9000, 2000, 7000]);
eq("P&L: COGS sold / returned / net", pick(pl, ["costSold", "costReturned", "cogs"]), [4900, 1100, 3800]);
eq("P&L: gross profit and margin", pick(pl, ["grossProfit", "grossMarginPct"]), [3200, 45.71]);
// Expenses: Rent 20,000 + Packing 1,500 + Tea 700 (vendor payment, transfer and last month left out). Other income: commission 2,500
eq("P&L: other income and expenses", pick(pl, ["otherIncome", "expenses"]), [2500, 22200]);
eq("P&L: expense groups", pl.expenseGroups, { direct: 1500, indirect: 20000, other: 700 });
eq("P&L: net profit = gross profit + other income − expenses", pl.netProfit, 3200 + 2500 - 22200);
eq("P&L: purchases = bills − vendor credits (drafts left out)", pl.purchases, { bills: 11800, vendorCredits: 1180, net: 10620 });
// Output tax: 360 + 250 + 180 + 180 = 970, minus returns 50 + 180 = 230 → 740. Input: 1,800 − 180 = 1,620.
eq("P&L: GST output − input = net payable", pl.gst, { outputTax: 740, inputTax: 1620, netPayable: -880 });
eq("P&L: notes (rebuilt sales, fallback cost lines)", [pl.notes.saleInvoices, pl.notes.returnInvoices, pl.notes.rebuiltSales, pl.notes.fallbackCostLines, pl.notes.noCostLines], [4, 2, 1, 1, 0]);

r = await call(profitAndLoss, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, locCode: "T02" } });
eq("P&L: store filter T02 (same locCode on both sides)", pick(r.body, ["netSales", "cogs", "expenses", "store"]), [1000, 600, 700, "Store Two"]);
r = await call(profitAndLoss, { query: { userId: STAFF, fromDate: FROM, toDate: TO } });
eq("P&L: store user sees only their store", pick(r.body, ["netSales", "expenses"]), [6000, 21500]);
r = await call(profitAndLoss, { query: { userId: STAFF, fromDate: FROM, toDate: TO, locCode: "T02" } });
eq("P&L: store user asking for another store → 403", r.status, 403);
r = await call(profitAndLoss, { query: { userId: ADMIN, fromDate: TO, toDate: FROM } });
eq("P&L: from after to → 400", r.status, FROM === TO ? 200 : 400);

// Stock value: all stores = Ring 15 × 600 + Chain 3 × 500 + Bangle 2 × 1,000 = 12,500; Store One = 9,500
r = await call(profitStock, { query: { userId: ADMIN, fromDate: FROM, toDate: TO } });
eq("P&L stock: current value, all stores", r.body.current, 12500);
eq("P&L stock: opening/closing from the Stock On Hand report", [typeof r.body.opening, typeof r.body.closing], ["number", "number"]);
r = await call(profitStock, { query: { userId: STAFF, fromDate: FROM, toDate: TO } });
eq("P&L stock: store user = their store only", r.body.current, 9500);
r = await call(profitStock, { query: { userId: CLUSTER, fromDate: FROM, toDate: TO } });
eq("P&L stock: cluster manager (several stores) gets current value only", [r.body.current, r.body.opening, r.body.closing], [12500, null, null]);

// ═══ F12 Bill-wise profit ═══
// One row per sale in the period: INV-1 2,000/1,200, INV-2 5,000/2,500 (as sold), INV-3 1,000/600 (current cost), INV-5 1,000/600
r = await call(billWiseProfit, { query: { userId: ADMIN, fromDate: FROM, toDate: TO } });
const rowsBy = Object.fromEntries(r.body.rows.map((x) => [x.invoiceNumber, x]));
eq("bill profit: one row per sale (drafts, returns, other periods left out)", r.body.rows.map((x) => x.invoiceNumber).sort(), ["INV-1", "INV-2", "INV-3", "INV-5"]);
eq("bill profit: INV-1 selling / cost / profit / margin / status", pick(rowsBy["INV-1"], ["selling", "cost", "profit", "marginPct", "status", "items", "qty"]), [2000, 1200, 800, 40, "Profit", 1, 2]);
eq("bill profit: INV-2 counted as sold (rebuilt after the partial return)", pick(rowsBy["INV-2"], ["selling", "cost", "profit", "rebuilt", "returnStatus", "qty"]), [5000, 2500, 2500, true, "partial", 4]);
eq("bill profit: INV-3 uses current cost (noted)", pick(rowsBy["INV-3"], ["cost", "fallbackLines"]), [600, 1]);
eq("bill profit: totals match the P&L sales and cost of goods sold", pick(r.body.totals, ["invoices", "selling", "cost", "profit", "marginPct"]), [4, pl.salesTaxable, pl.costSold, 4100, 45.56]);
eq("bill profit: salesperson list", r.body.salespeople, ["Anu", "Binu", "Cini"]);
r = await call(billWiseProfit, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, salesperson: "Binu" } });
eq("bill profit: salesperson filter", r.body.rows.map((x) => x.invoiceNumber), ["INV-2"]);
r = await call(billWiseProfit, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, status: "Loss" } });
eq("bill profit: status filter (no losses)", [r.body.rows.length, r.body.totals.byStatus.Loss], [0, 0]);
r = await call(billWiseProfit, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, search: "inv-3" } });
eq("bill profit: search by invoice number", r.body.rows.map((x) => x.invoiceNumber), ["INV-3"]);
r = await call(billWiseProfit, { query: { userId: STAFF, fromDate: FROM, toDate: TO } });
eq("bill profit: store user sees only their store", r.body.rows.map((x) => x.invoiceNumber).sort(), ["INV-1", "INV-2", "INV-3"]);
r = await call(billProfitDetail, { params: { id: String(s2Id) }, query: { userId: ADMIN } });
eq("bill profit detail: per line selling / cost / profit", r.body.lines.map((l) => [l.name, l.qty, l.taxable, l.cost, l.profit]), [["Chain", 3, 3000, 1500, 1500], ["Bangle 2.4", 1, 2000, 1000, 1000]]);
eq("bill profit detail: rebuilt from its return", [r.body.rebuilt, r.body.returns.map((x) => x.invoiceNumber)], [true, ["RTN-1"]]);
const inv5 = await db.collection("salesinvoices").findOne({ invoiceNumber: "INV-5" });
r = await call(billProfitDetail, { params: { id: String(inv5._id) }, query: { userId: STAFF } });
eq("bill profit detail: another store's invoice → 403", r.status, 403);

// ═══ F13 Purchase reports ═══
const acmeV = new mongoose.Types.ObjectId(), plainV = new mongoose.Types.ObjectId();
await db.collection("vendors").insertMany([
  { _id: acmeV, displayName: "Acme Gold Pvt", gstin: "32ABCDE1234F1Z5", userId: ADMIN },
  { _id: plainV, displayName: "Plain Traders", gstin: "", userId: ADMIN },
]);
const pbill = (o) => ({ status: "open", userId: ADMIN, amountPaid: 0, creditsApplied: 0, ...o });
await db.collection("bills").insertMany([
  // P-1 Acme (GSTIN) at Store One: Ring 2 × ₹1,050 at 5% + Chain 1 × ₹1,180 at 18%; ₹1,000 paid
  pbill({ vendorName: "Acme Gold Pvt", vendorId: String(acmeV), billNumber: "P-1", billDate: daysAgo(8), locCode: "T01", warehouse: "Store One", subTotal: 3280, finalTotal: 3280, amountPaid: 1000,
    items: [{ itemId: itemR, itemName: "Ring", quantity: 2, rate: 1050, baseAmount: 2000, cgstAmount: 50, sgstAmount: 50, taxPercent: 5 },
      { itemId: itemC, itemName: "Chain", quantity: 1, rate: 1180, baseAmount: 1000, cgstAmount: 90, sgstAmount: 90, taxPercent: 18 }] }),
  // P-2 a vendor without GSTIN: Ring 3 × ₹1,100 at 5%
  pbill({ vendorName: "Plain Traders", vendorId: String(plainV), billNumber: "P-2", billDate: daysAgo(7), locCode: "T01", warehouse: "Store One", subTotal: 3300, finalTotal: 3300,
    items: [{ itemId: itemR, itemName: "Ring", quantity: 3, rate: 1100, baseAmount: 3142.86, cgstAmount: 78.57, sgstAmount: 78.57, taxPercent: 5 }] }),
  // P-3 Acme at Store Two, inter-state: Ring 1 × ₹1,030 at 3% IGST
  pbill({ vendorName: "Acme Gold Pvt", vendorId: String(acmeV), billNumber: "P-3", billDate: daysAgo(6), locCode: "T02", warehouse: "Store Two", subTotal: 1030, finalTotal: 1030,
    items: [{ itemId: itemR, itemName: "Ring", quantity: 1, rate: 1030, baseAmount: 1000, igstAmount: 30, taxPercent: 3, isInterState: true }] }),
]);
// Summary (admin): B-1 11,800 + P-1 3,280 + P-2 3,300 + P-3 1,030 = 19,410; tax 1,800 + 280 + 157.14 + 30 = 2,267.14; paid 1,000
r = await call(purchaseSummary, { query: { userId: ADMIN, fromDate: FROM, toDate: TO } });
eq("purchase summary: one row per bill, oldest first (draft left out)", r.body.rows.map((x) => x.billNumber), ["P-1", "P-2", "B-1", "P-3"]);
eq("purchase summary: P-1 items / qty / sub-total / tax / total / paid / balance", pick(r.body.rows.find((x) => x.billNumber === "P-1"), ["items", "qty", "subTotal", "tax", "total", "paid", "balance", "paymentStatus"]), [2, 3, 3280, 280, 3280, 1000, 2280, "partially_paid"]);
eq("purchase summary: totals", pick(r.body.totals, ["bills", "total", "tax", "paid", "balance"]), [4, 19410, 2267.14, 1000, 18410]);
r = await call(purchaseSummary, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, vendorKey: `id:${acmeV}` } });
eq("purchase summary: vendor filter", r.body.rows.map((x) => x.billNumber), ["P-1", "P-3"]);
r = await call(purchaseSummary, { query: { userId: STAFF, fromDate: FROM, toDate: TO } });
eq("purchase summary: store user sees only their store", r.body.rows.map((x) => x.billNumber), ["P-1", "P-2", "B-1"]);
// Item × vendor: Ring from Acme 3 pcs for 2,100 + 1,030 = 3,130 (avg 1,043.33); Ring from Plain 3 for 3,300 (avg 1,100)
r = await call(purchasesByItemVendor, { query: { userId: ADMIN, fromDate: FROM, toDate: TO } });
const ivBy = Object.fromEntries(r.body.rows.map((x) => [`${x.itemName}|${x.vendorName}`, x]));
eq("items by vendor: Ring from Acme", pick(ivBy["Ring|Acme Gold Pvt"], ["qty", "value", "averageRate", "bills"]), [3, 3130, 1043.33, 2]);
eq("items by vendor: Ring from Plain Traders", pick(ivBy["Ring|Plain Traders"], ["qty", "value", "averageRate"]), [3, 3300, 1100]);
r = await call(purchasesByItemVendor, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, search: "chain" } });
eq("items by vendor: search", r.body.rows.map((x) => [x.itemName, x.vendorName, x.qty]), [["Chain", "Acme Gold Pvt", 1]]);
// GST register: only Acme has a GSTIN → P-1 at 5% and 18%, P-3 at 3%; B-1 (no vendor record) and P-2 skipped
r = await call(gstPurchaseRegister, { query: { userId: ADMIN, fromDate: FROM, toDate: TO } });
eq("GST register: rows per bill per rate from stored tax", r.body.rows.map((x) => [x.billNumber, x.vendorGstin, x.rate, x.taxable, x.cgst, x.sgst, x.igst, x.cess, x.total]),
  [["P-1", "32ABCDE1234F1Z5", 5, 2000, 50, 50, 0, 0, 2100], ["P-1", "32ABCDE1234F1Z5", 18, 1000, 90, 90, 0, 0, 1180], ["P-3", "32ABCDE1234F1Z5", 3, 1000, 0, 0, 30, 0, 1030]]);
eq("GST register: distinct rates and skipped bills", [r.body.rates, r.body.skippedNoGstin], [[3, 5, 18], 2]);
eq("GST register: totals", pick(r.body.totals, ["taxable", "cgst", "sgst", "igst", "total"]), [4000, 140, 140, 30, 4310]);
r = await call(gstPurchaseRegister, { query: { userId: ADMIN, fromDate: FROM, toDate: TO, rate: "18" } });
eq("GST register: rate filter", r.body.rows.map((x) => [x.billNumber, x.rate]), [["P-1", 18]]);
r = await call(gstPurchaseRegister, { query: { userId: STAFF, fromDate: FROM, toDate: TO } });
eq("GST register: store user sees only their store", r.body.rows.map((x) => x.billNumber), ["P-1", "P-1"]);

// ═══ F14 Stock health ═══
// A pendant (₹2,000 cost, 1 at Store One) never sold, and an item with no stock
const itemP = new mongoose.Types.ObjectId();
await db.collection("shoeitems").insertMany([
  { _id: itemP, itemName: "Pendant", sku: "PEND-1", category: "other", costPrice: 2000, warehouseStocks: [{ warehouse: "Store One", stockOnHand: 1 }] },
  { itemName: "Empty", sku: "EMPTY-1", category: "other", costPrice: 10, warehouseStocks: [{ warehouse: "Store One", stockOnHand: 0 }] },
]);
// Last sales: Ring, Chain, Bangle 5 days ago; Pendant never
r = await call(deadStockReport, { query: { userId: ADMIN, days: "30" } });
eq("dead stock (30 days): only the never-sold pendant", r.body.rows.map((x) => [x.name, x.stock, x.value, x.lastSaleDate]), [["Pendant", 1, 2000, null]]);
r = await call(deadStockReport, { query: { userId: ADMIN, days: "3" } });
eq("dead stock (3 days): everything with stock, by value", r.body.rows.map((x) => [x.name, x.daysSinceLastSale]), [["Ring", 5], ["Pendant", null], ["Bangle 2.4", 5], ["Chain", 5]]);
eq("dead stock totals", pick(r.body.totals, ["items", "qty", "value"]), [4, 21, 9000 + 2000 + 2000 + 1500]);
r = await call(deadStockReport, { query: { userId: ADMIN, days: "30", locCode: "T02" } });
eq("dead stock at Store Two (30 days): none", r.body.rows.length, 0);
r = await call(deadStockReport, { query: { userId: STAFF, days: "3", locCode: "T02" } });
eq("dead stock: store user asking for another store → 403", r.status, 403);
r = await call(deadStockReport, { query: { userId: ADMIN, days: "0" } });
eq("dead stock: days must be 1–3650", r.status, 400);

// Max stock: Ring 8, Bangle 1 (admin only)
r = await call(updateStockSettings, { params: { id: String(itemR) }, body: { userId: STAFF, kind: "item", maxStock: 8 } });
eq("max stock: store user cannot set it", r.status, 403);
r = await call(updateStockSettings, { params: { id: String(itemR) }, body: { userId: ADMIN, kind: "item", maxStock: -1 } });
eq("max stock: negative refused", r.status, 400);
r = await call(updateStockSettings, { params: { id: String(itemR) }, body: { userId: ADMIN, kind: "item", maxStock: 8 } });
eq("max stock: set on an item", [r.status, r.body.maxStock], [200, 8]);
r = await call(updateStockSettings, { params: { id: String(itemB) }, body: { userId: ADMIN, kind: "group", groupId: String(groupB), maxStock: 1 } });
eq("max stock: set on a group variant", [r.status, r.body.maxStock], [200, 1]);
const ringAfter = await db.collection("shoeitems").findOne({ _id: itemR });
eq("max stock: stock untouched", ringAfter.warehouseStocks.map((w) => w.stockOnHand), [10, 5]);
r = await call(overstockReport, { query: { userId: ADMIN } });
eq("overstock (all stores): Ring 15 > 8, Bangle 2 > 1", r.body.rows.map((x) => [x.name, x.stock, x.maxStock, x.excess, x.excessValue]), [["Ring", 15, 8, 7, 4200], ["Bangle 2.4", 2, 1, 1, 1000]]);
r = await call(overstockReport, { query: { userId: STAFF } });
eq("overstock (Store One): Ring 10 > 8", r.body.rows.map((x) => [x.name, x.excess]), [["Ring", 2], ["Bangle 2.4", 1]]);
r = await call(overstockReport, { query: { userId: ADMIN, all: "1" } });
eq("overstock all=1 lists items with stock or a limit", r.body.rows.map((x) => x.name).sort(), ["Bangle 2.4", "Chain", "Pendant", "Ring"]);

// ABC over the last 12 months (net of returns): Ring 2,000 + 1,000 + 1,000 + 1,000 (INV-6 as sold) − 1,000 (RTN-2) = 4,000;
// Bangle 2,000; Chain 3,000 − 1,000 = 2,000; Pendant 0. Total 8,000 → Ring 50% A, Bangle 75% A, Chain 100% C, Pendant C
r = await call(abcReport, { query: { userId: ADMIN } });
eq("ABC: sales value, cumulative share and class", r.body.rows.map((x) => [x.name, x.salesValue, x.cumulative, x.abcClass]),
  [["Ring", 4000, 50, "A"], ["Bangle 2.4", 2000, 75, "A"], ["Chain", 2000, 100, "C"], ["Pendant", 0, 100, "C"]]);
r = await call(updateStockSettings, { params: { id: String(itemC) }, body: { userId: ADMIN, kind: "item", abcOverride: "D" } });
eq("ABC override: only A/B/C/empty", r.status, 400);
await call(updateStockSettings, { params: { id: String(itemC) }, body: { userId: ADMIN, kind: "item", abcOverride: "B" } });
r = await call(abcReport, { query: { userId: ADMIN } });
const chainAbc = r.body.rows.find((x) => x.name === "Chain");
eq("ABC override wins over the computed class", [chainAbc.computedClass, chainAbc.abcClass], ["C", "B"]);
eq("ABC summary per class", r.body.summary.map((x) => [x.abcClass, x.items, x.value, x.share]), [["A", 2, 6000, 75], ["B", 1, 2000, 25], ["C", 1, 0, 0]]);
r = await call(abcReport, { query: { userId: STAFF } });
eq("ABC: store user = their store's sales", [r.body.total, r.body.rows.find((x) => x.name === "Ring").salesValue], [7000, 3000]);

// ═══ (later features add their checks above this line) ═══

await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Phase 5 report checks passed");
process.exit(failed ? 1 : 0);
