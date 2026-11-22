import mongoose from "mongoose";

// F19: source items turned into packs of a target item, in one warehouse.
const allocSchema = new mongoose.Schema({ batchNo: String, qty: Number, expDate: String, mfgDate: String, costPrice: Number }, { _id: false });
const lineSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },       // standalone item id, or variant id inside a group
    itemGroupId: { type: String, default: "" },
    name: { type: String, default: "" },
    sku: { type: String, default: "" },
    qty: { type: Number, required: true },
    unitCost: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    batchAllocations: { type: [allocSchema], default: [] },
  },
  { _id: false }
);

const repackSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true }, // RPK-000001
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    locCode: { type: String, required: true },
    warehouse: { type: String, required: true },
    sources: { type: [lineSchema], default: [] },
    target: {
      itemId: { type: String, required: true },
      itemGroupId: { type: String, default: "" },
      name: { type: String, default: "" },
      sku: { type: String, default: "" },
      packs: { type: Number, required: true },
      batchNo: { type: String, default: "" },
      expDate: { type: String, default: "" },
      batchAllocations: { type: [allocSchema], default: [] },
    },
    consumedCost: { type: Number, default: 0 },
    charges: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

repackSchema.index({ locCode: 1, date: -1 });

export default mongoose.model("Repack", repackSchema);
