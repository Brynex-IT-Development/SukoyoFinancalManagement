// End-to-end checks for Phase 7 (batches & expiry, repacking, classes) on a THROWAWAY database.
//
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/sukoyo_test7 node scripts/test-phase7-integration.js
//
// Refuses to run against anything that is not localhost, so it can never touch real data.
import mongoose from "mongoose";
import User from "../model/UserModel.js";
import Store from "../model/Store.js";
import ShoeItem from "../model/ShoeItem.js";
import Batch from "../model/Batch.js";
import PurchaseReceive from "../model/PurchaseReceive.js";
import { createSalesInvoice, updateSalesInvoice, deleteSalesInvoice } from "../controllers/SalesInvoiceController.js";
import { createPurchaseReceive, deletePurchaseReceive } from "../controllers/PurchaseReceiveController.js";
import { listItemBatches, expiringBatches, reconcileBatchesNow } from "../controllers/BatchController.js";
import { resolveLine, moveStock, applyLines } from "../utils/stockService.js";
import { istDateString, addIstDays } from "../utils/ist.js";

const uri = process.env.TEST_MONGODB_URI || "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI to a local throwaway database, e.g. mongodb://127.0.0.1:27999/sukoyo_test7");
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
const quiet = async (fn) => { const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = log; console.warn = warn; } };
const ADMIN = "admin@test.local", STAFF = "staff@test.local";
const day = (n) => istDateString(addIstDays(new Date(), n));
const WH = "Warehouse";

await mongoose.connect(uri);
const db = mongoose.connection.db;
await db.dropDatabase();
await Batch.syncIndexes();
await User.create({ username: "admin", email: ADMIN, password: "x", power: "admin", role: "admin", locCode: "858" });
await User.create({ username: "staff", email: STAFF, password: "x", power: "normal", role: "store_user", locCode: "T02" });
await Store.create({ name: "Warehouse", locCode: "858" });
await Store.create({ name: "Store Two", locCode: "T02" });

// Saffron is batch-managed; Ribbon is not
const saffron = await ShoeItem.create({ itemName: "Saffron 1g", sku: "SAF-1", category: "other", costPrice: 100, sellingPrice: 150, manageBatch: true, warehouseStocks: [] });
const ribbon = await ShoeItem.create({ itemName: "Ribbon", sku: "RIB-1", category: "other", costPrice: 5, sellingPrice: 10, warehouseStocks: [{ warehouse: WH, stockOnHand: 50, availableForSale: 50, physicalStockOnHand: 50, physicalAvailableForSale: 50 }] });
const S = String(saffron._id);
const stockOf = async (id, wh = WH) => ((await ShoeItem.findById(id).lean()).warehouseStocks || []).filter((w) => w.warehouse === wh).reduce((s, w) => s + w.stockOnHand, 0);
const batchesOf = async (whKey = "warehouse") => Object.fromEntries((await Batch.find({ itemId: saffron._id, warehouseKey: whKey }).sort({ batchNo: 1 }).lean()).map((b) => [b.batchNo, b.qty]));
const sumBatches = async (whKey = "warehouse") => (await Batch.find({ itemId: saffron._id, warehouseKey: whKey }).lean()).reduce((s, b) => s + b.qty, 0);
const invariant = async (label, wh = WH, key = "warehouse") => eq(`invariant after ${label}: batches = stock`, await sumBatches(key), await stockOf(saffron._id, wh));

// ═══ F18 Batches & expiry ═══
// Receive 10 (B-JAN, expires in 60 days) + 5 (B-OLD, expired yesterday) + 8 (B-MAR, expires in 120 days)
const receive = (receiveNumber, items) => quiet(() => call(createPurchaseReceive, { body: {
  receiveNumber, purchaseOrderId: String(new mongoose.Types.ObjectId()), purchaseOrderNumber: "PO-T1", vendorName: "Spice Co", receivedDate: new Date(),
  userId: ADMIN, locCode: "T99", items: items.map((i) => ({ itemId: S, itemName: "Saffron 1g", itemSku: "SAF-1", ordered: i.received, ...i })),
} }));
let r = await receive("PR-T1", [{ received: 10, batchNo: "b-jan", expDate: day(60), mfgDate: day(-30) }, { received: 5, batchNo: "B-OLD", expDate: day(-1) }, { received: 8, batchNo: "B-MAR", expDate: day(120) }]);
eq("receive creates batches", [r.status, await batchesOf(), await stockOf(saffron._id)], [201, { "B-JAN": 10, "B-MAR": 8, "B-OLD": 5 }, 23]);
r = await receive("PR-T0", [{ received: 1, expDate: "31-12-2026" }]);
eq("receive with a badly written expiry date refused", [r.status, await stockOf(saffron._id)], [400, 23]);
await invariant("receive");

const line = (quantity, extra = {}) => ({ item: "Saffron 1g", itemSku: "SAF-1", itemData: { _id: S, itemName: "Saffron 1g", sku: "SAF-1" }, quantity, rate: 150, amount: 150 * quantity, costPrice: 100, ...extra });
const sale = (lines, extra = {}) => quiet(() => call(createSalesInvoice, { body: {
  customer: "Walk-in", branch: WH, warehouse: WH, salesperson: "S1", category: "Sales", locCode: "858", paymentMethod: "Cash", status: "sent",
  invoiceDate: new Date(), userId: ADMIN, lineItems: lines, subTotal: lines.reduce((s, l) => s + l.amount, 0), finalTotal: lines.reduce((s, l) => s + l.amount, 0), ...extra,
} }));
// Sale of 12: the expired batch is skipped → B-JAN 10 + B-MAR 2
r = await sale([line(12)]);
const sale1 = r.body;
eq("sale takes earliest expiring unexpired batches", [r.status, sale1.lineItems?.[0]?.batchAllocations?.map((a) => [a.batchNo, a.qty])], [201, [["B-JAN", 10], ["B-MAR", 2]]]);
eq("batches after the sale", await batchesOf(), { "B-JAN": 0, "B-MAR": 6, "B-OLD": 5 });
await invariant("sale");
r = await sale([line(1, { batchNo: "B-OLD" })]);
eq("choosing an expired batch is refused", [r.status, /expired/.test(r.body.message || "")], [409, true]);
r = await sale([line(7)]);
eq("more than the unexpired stock is refused, nothing moves", [r.status, /6 in unexpired batches \(5 expired\)/.test(r.body.message || ""), await stockOf(saffron._id)], [409, true, 11]);
r = await sale([line(2, { batchNo: "b-mar" })]);
const sale2 = r.body;
eq("cashier's chosen batch", [r.status, sale2.lineItems?.[0]?.batchAllocations?.map((a) => [a.batchNo, a.qty]), (await batchesOf())["B-MAR"]], [201, [["B-MAR", 2]], 4]);
r = await sale([line(1), { item: "Ribbon", itemSku: "RIB-1", itemData: { _id: String(ribbon._id) }, quantity: 5, rate: 10, amount: 50 }]);
eq("items without batches sell as before", [r.status, await stockOf(ribbon._id), r.body.lineItems?.[1]?.batchAllocations?.length || 0, await Batch.countDocuments({ itemId: ribbon._id })], [201, 45, 0, 0]);
await invariant("mixed sale");

// Return 3 of sale 1: back into the last batches taken (B-MAR 2, B-JAN 1); batch data sent by the client is ignored
r = await sale([line(3, { batchAllocations: [{ batchNo: "FAKE", qty: 3, expDate: "2099-01-01" }] })], { category: "Return", originalInvoiceId: String(sale1._id), originalInvoiceNumber: sale1.invoiceNumber, finalTotal: -450, subTotal: 450 });
eq("return goes back to the batches it was sold from", [r.status, r.body.lineItems?.[0]?.batchAllocations?.map((a) => [a.batchNo, a.qty])], [201, [["B-JAN", 1], ["B-MAR", 2]]]);
// before the return: B-JAN 0, B-MAR 3 (the mixed sale took 1 more from B-MAR)
eq("no batch was made up by the client", [await batchesOf()].map((b) => [b["B-JAN"], b["B-MAR"], b.FAKE]), [[1, 5, undefined]]);
await invariant("return");
// Deleting sale 2 puts its 2 back into B-MAR
r = await quiet(() => call(deleteSalesInvoice, { params: { id: String(sale2._id) }, body: { userId: ADMIN }, query: { userId: ADMIN } }));
eq("deleting a sale restores its batches", [r.status, (await batchesOf())["B-MAR"]], [200, 7]);
await invariant("delete");
// Editing sale 1 down to 9 keeps it on the batches it used
r = await quiet(() => call(updateSalesInvoice, { params: { id: String(sale1._id) }, body: { userId: ADMIN, lineItems: [line(9, { batchAllocations: sale1.lineItems[0].batchAllocations })], subTotal: 1350, finalTotal: 1350 } }));
eq("edited sale keeps its batches", [r.status, r.body.lineItems?.[0]?.batchAllocations?.map((a) => [a.batchNo, a.qty])], [200, [["B-JAN", 9]]]);
await invariant("edit");

// Moving stock without a batch (e.g. an adjustment) → UNASSIGNED; a transfer in one request carries its batches
const target = await resolveLine({ itemData: { _id: S } });
await moveStock(target, WH, 4);
eq("stock added without a batch goes to UNASSIGNED", (await batchesOf()).UNASSIGNED, 4);
const tlines = [{ itemData: { _id: S }, quantity: 3 }];
await applyLines(tlines, WH, -1);
await applyLines(tlines, "Store Two", 1);
const dest = await Batch.find({ itemId: saffron._id, warehouseKey: "store two" }).lean();
const srcExp = Object.fromEntries((await Batch.find({ itemId: saffron._id, warehouseKey: "warehouse" }).lean()).map((b) => [b.batchNo, b.expDate]));
eq("transfer keeps batch numbers and expiry, never the expired batch while fresh ones remain",
  [dest.reduce((t, b) => t + b.qty, 0), dest.some((b) => b.batchNo === "B-OLD"), dest.every((b) => b.expDate === srcExp[b.batchNo]), tlines[0].batchAllocations.length > 0], [3, false, true, true]);
await invariant("transfer (source)");
await invariant("transfer (destination)", "Store Two", "store two");

// A screen that writes stock directly: the next movement brings the batches back in line
await ShoeItem.updateOne({ _id: saffron._id, "warehouseStocks.warehouse": WH }, { $inc: { "warehouseStocks.$.stockOnHand": 2 } });
await quiet(() => moveStock(target, WH, -1));
await invariant("direct stock write + next movement");
await ShoeItem.updateOne({ _id: saffron._id, "warehouseStocks.warehouse": WH }, { $inc: { "warehouseStocks.$.stockOnHand": -3 } });
r = await quiet(() => call(reconcileBatchesNow, { body: { userId: ADMIN } }));
eq("reconcile (admin) heals the drift", [r.status, r.body.fixed.length], [200, 1]);
await invariant("reconcile");
r = await call(reconcileBatchesNow, { body: { userId: STAFF } });
eq("reconcile is admin only", r.status, 403);

// Deleting a receive takes its own batch back; refused when that batch is already sold
r = await receive("PR-T2", [{ received: 4, expDate: day(200) }]);
eq("receive without a batch number uses the receive number", [r.status, (await batchesOf())["PR-T2"]], [201, 4]);
const pr2 = await PurchaseReceive.findOne({ receiveNumber: "PR-T2" }).lean();
r = await quiet(() => call(deletePurchaseReceive, { params: { id: String(pr2._id) }, body: { userId: ADMIN }, query: { userId: ADMIN } }));
eq("deleting the receive removes its batch", [r.status, (await batchesOf())["PR-T2"]], [200, 0]);
await invariant("receive delete");

// Picker and expiring report, on a fresh item: H-EXP expired, H-30 expires in 30 days, H-200 in 200 days
const honey = await ShoeItem.create({ itemName: "Honey 250g", sku: "HON-1", category: "other", costPrice: 80, manageBatch: true, warehouseStocks: [] });
const H = String(honey._id);
const hTarget = await resolveLine({ itemData: { _id: H } });
await moveStock(hTarget, WH, 2, { batch: { batchNo: "H-EXP", expDate: day(-3) } });
await moveStock(hTarget, WH, 6, { batch: { batchNo: "H-30", expDate: day(30), costPrice: 75 } });
await moveStock(hTarget, WH, 4, { batch: { batchNo: "H-200", expDate: day(200) } });
const hl = [{ itemData: { _id: H }, quantity: 2 }];
await applyLines(hl, WH, -1);
await applyLines(hl, "Store Two", 1);
r = await call(listItemBatches, { query: { userId: ADMIN, itemId: H, warehouse: WH } });
eq("picker: batches with stock, earliest expiry first, expired flagged", r.body.batches.map((x) => [x.batchNo, x.qty, x.expired]), [["H-EXP", 2, true], ["H-30", 4, false], ["H-200", 4, false]]);
r = await call(listItemBatches, { query: { userId: STAFF, itemId: H, warehouse: WH } });
eq("picker: another store's warehouse → 403", r.status, 403);
r = await call(expiringBatches, { query: { userId: ADMIN, days: "90", search: "honey" } });
eq("expiring within 90 days (expired left out), valued at batch cost", r.body.rows.map((x) => [x.batchNo, x.warehouse, x.qty, x.daysLeft, x.value]).sort(), [["H-30", "Store Two", 2, 30, 150], ["H-30", "Warehouse", 4, 30, 300]]);
r = await call(expiringBatches, { query: { userId: ADMIN, days: "90", includeExpired: "1", search: "HON" } });
eq("…and with expired batches (expired first)", [r.body.rows[0].batchNo, r.body.rows[0].expired, r.body.totals.expired], ["H-EXP", true, 1]);
r = await call(expiringBatches, { query: { userId: STAFF, days: "365" } });
eq("store user sees only their store's batches", [...new Set(r.body.rows.map((x) => x.warehouse))], ["Store Two"]);
r = await sale([{ item: "Honey 250g", itemSku: "HON-1", itemData: { _id: H }, quantity: 9, rate: 120, amount: 1080 }]);
eq("only 8 unexpired honey at Warehouse → selling 9 is refused", [r.status, String(r.body.message || "").includes("8 in unexpired batches (2 expired)")], [409, true]);

// ═══ (later features add their checks above this line) ═══

await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Phase 7 checks passed");
process.exit(failed ? 1 : 0);
