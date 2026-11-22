import mongoose from "mongoose";

// F18: stock of a batch-managed item (ShoeItem.manageBatch) in one warehouse, per batch.
// Quantities change only inside utils/stockService.js moveStock, together with the item's stock,
// so for each item and warehouse Σ batch qty = stockOnHand. "UNASSIGNED" holds stock whose batch
// is not known (stock added by screens that do not ask for a batch).
const batchSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "ShoeItem", required: true },
    itemName: { type: String, default: "" },
    sku: { type: String, default: "" },
    batchNo: { type: String, required: true, trim: true, uppercase: true },
    warehouse: { type: String, required: true },     // as written by the stock movement
    warehouseKey: { type: String, required: true },  // canonical key (stockService.warehouseKey)
    qty: { type: Number, default: 0, min: 0 },
    costPrice: { type: Number, default: null },
    sellingPrice: { type: Number, default: null },
    mfgDate: { type: String, default: "" },          // "YYYY-MM-DD" or ""
    expDate: { type: String, default: "" },          // "YYYY-MM-DD" or "" (no expiry)
    source: { type: String, default: "" },           // e.g. "receive PR-0001", "repack RPK-000001"
  },
  { timestamps: true }
);

batchSchema.index({ itemId: 1, warehouseKey: 1, batchNo: 1 }, { unique: true });
batchSchema.index({ expDate: 1, qty: 1 });

export default mongoose.model("Batch", batchSchema);
