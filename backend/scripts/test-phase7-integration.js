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
import { createRepack, deleteRepack, listRepacks, getRepack, searchRepackItems } from "../controllers/RepackController.js";
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

// ═══ F19 Repacking ═══
const mkStock = (q) => [{ warehouse: WH, stockOnHand: q, availableForSale: q, physicalStockOnHand: q, physicalAvailableForSale: q }];
const tea = await ShoeItem.create({ itemName: "Loose Tea 1kg", sku: "TEA-L", category: "other", costPrice: 120, manageBatch: true, warehouseStocks: [] });
const box = await ShoeItem.create({ itemName: "Gift Box", sku: "BOX-1", category: "other", costPrice: 5, warehouseStocks: mkStock(50) });
const gift = await ShoeItem.create({ itemName: "Tea Gift Pack", sku: "TEA-G", category: "other", costPrice: 0, manageBatch: true, warehouseStocks: [] });
const ribbonGroupId = new mongoose.Types.ObjectId(), redRibbon = new mongoose.Types.ObjectId();
await db.collection("itemgroups").insertOne({ _id: ribbonGroupId, name: "Ribbons", items: [{ _id: redRibbon, name: "Red", sku: "RIB-RED", costPrice: 2, warehouseStocks: mkStock(30) }] });
await moveStock(await resolveLine({ itemData: { _id: String(tea._id) } }), WH, 10, { batch: { batchNo: "T1", expDate: day(90), costPrice: 100 } });
const groupStock = async () => (await db.collection("itemgroups").findOne({ _id: ribbonGroupId })).items[0].warehouseStocks[0].stockOnHand;
const giftBatches = async () => Object.fromEntries((await Batch.find({ itemId: gift._id }).lean()).map((b) => [b.batchNo, [b.qty, b.expDate, b.costPrice]]));
const repackBody = (extra = {}) => ({
  userId: ADMIN, locCode: "858",
  sources: [{ itemId: String(tea._id), qty: 10 }, { itemId: String(box._id), qty: 20 }, { itemId: String(redRibbon), itemGroupId: String(ribbonGroupId), qty: 5 }],
  target: { itemId: String(gift._id), packs: 23 }, charges: 40, notes: "Diwali packs", ...extra,
});
// 10 tea × ₹100 (batch cost) + 20 boxes × ₹5 + 5 ribbons × ₹2 + ₹40 charges = ₹1,150 → 23 packs → ₹50 a pack
r = await quiet(() => call(createRepack, { body: repackBody() }));
const rp1 = r.body;
eq("repack: cost per produced unit", [r.status, rp1.number, rp1.consumedCost, rp1.totalCost, rp1.unitCost], [201, "RPK-000001", 1110, 1150, 50]);
eq("repack: sources consumed, packs produced", [await stockOf(tea._id), await stockOf(box._id), await groupStock(), await stockOf(gift._id)], [0, 30, 25, 23]);
eq("repack: the pack batch carries the repack number, earliest source expiry and unit cost", await giftBatches(), { "RPK-000001": [23, day(90), 50] });
eq("repack: source batch recorded", rp1.sources[0].batchAllocations.map((a) => [a.batchNo, a.qty]), [["T1", 10]]);
r = await quiet(() => call(createRepack, { body: repackBody({ sources: [{ itemId: String(tea._id), qty: 1 }, { itemId: String(box._id), qty: 2 }] }) }));
eq("repack: not enough stock → 409, nothing moved", [r.status, await stockOf(box._id), await stockOf(gift._id)], [409, 30, 23]);
r = await call(createRepack, { body: repackBody({ target: { itemId: String(box._id), packs: 1 } }) });
eq("repack: packed item cannot be a source", r.status, 400);
r = await call(createRepack, { body: repackBody({ userId: STAFF }) });
eq("repack: store user at another store → 403", r.status, 403);
r = await call(createRepack, { body: repackBody({ userId: STAFF, locCode: "T02" }) });
eq("repack: store user (not manager) at own store → 403", r.status, 403);
// Producing fails (a batch number that already exists with another expiry) → the consumption is undone
await moveStock(await resolveLine({ itemData: { _id: String(gift._id) } }), WH, 1, { batch: { batchNo: "CLASH", expDate: day(10) } });
r = await quiet(() => call(createRepack, { body: repackBody({ sources: [{ itemId: String(box._id), qty: 4 }], target: { itemId: String(gift._id), packs: 2, batchNo: "CLASH", expDate: day(20) }, charges: 0 }) }));
eq("repack: producing fails → boxes given back", [r.status, await stockOf(box._id), (await giftBatches()).CLASH[0]], [409, 30, 1]);
await invariant("repack rollback (gift)", WH, "warehouse");

// Deleting reverses both movements (packs out of their batch, sources back into theirs)
r = await call(listRepacks, { query: { userId: STAFF } });
eq("repack list: other store's repacks hidden", r.body.repacks.length, 0);
r = await call(getRepack, { params: { id: String(rp1._id) }, query: { userId: ADMIN } });
eq("repack detail", [r.body.number, r.body.target.packs, r.body.canDelete], ["RPK-000001", 23, true]);
r = await call(deleteRepack, { params: { id: String(rp1._id) }, query: { userId: STAFF } });
eq("repack delete is admin only", r.status, 403);
r = await quiet(() => call(deleteRepack, { params: { id: String(rp1._id) }, query: { userId: ADMIN } }));
eq("repack delete reverses both movements", [r.status, await stockOf(tea._id), await stockOf(box._id), await groupStock(), await stockOf(gift._id)], [200, 10, 50, 30, 1]);
eq("repack delete: tea back in batch T1, pack batch emptied", [(await Batch.findOne({ itemId: tea._id, batchNo: "T1" }).lean()).qty, (await giftBatches())["RPK-000001"][0]], [10, 0]);
// Packs already sold → cannot reverse
r = await quiet(() => call(createRepack, { body: repackBody({ sources: [{ itemId: String(box._id), qty: 10 }], target: { itemId: String(gift._id), packs: 5 }, charges: 0 }) }));
const rp2 = r.body;
r = await sale([{ item: "Tea Gift Pack", itemSku: "TEA-G", itemData: { _id: String(gift._id) }, quantity: 6, rate: 99, amount: 594 }]);
eq("sell 6 gift packs (5 new + 1 earlier)", r.status, 201);
r = await quiet(() => call(deleteRepack, { params: { id: String(rp2._id) }, query: { userId: ADMIN } }));
eq("repack delete refused once its packs are sold", [r.status, await stockOf(box._id)], [409, 40]);
r = await call(searchRepackItems, { query: { userId: ADMIN, locCode: "858", search: "red" } });
eq("repack item search: variant with group, stock and cost", r.body.items.map((i) => [i.name, i.stock, i.cost]), [["Ribbons · Red", 30, 2]]);

// ═══ (later features add their checks above this line) ═══

await mongoose.disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll Phase 7 checks passed");
process.exit(failed ? 1 : 0);
