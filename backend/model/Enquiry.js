import mongoose from "mongoose";

// F16: a customer asking for an item the store may not have. Every status change is kept in history.
const historySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["new", "contacted", "converted", "closed"], required: true },
    note: { type: String, default: "" },
    by: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const enquirySchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },       // ENQ-000001
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },                        // normalized digits
    itemWanted: { type: String, required: true, trim: true },
    itemId: { type: String, default: "" },                          // optional link to an item (standalone or variant)
    itemName: { type: String, default: "" },
    itemSku: { type: String, default: "" },
    notes: { type: String, default: "", trim: true },
    locCode: { type: String, required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesPerson", default: null },
    staffName: { type: String, default: "" },
    status: { type: String, enum: ["new", "contacted", "converted", "closed"], default: "new" },
    followUpDate: { type: String, default: "" },                    // IST day "YYYY-MM-DD" or ""
    convertedInvoiceNumber: { type: String, default: "" },
    history: { type: [historySchema], default: [] },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

enquirySchema.index({ locCode: 1, createdAt: -1 });
enquirySchema.index({ status: 1, followUpDate: 1 });
enquirySchema.index({ phone: 1 });

export default mongoose.model("Enquiry", enquirySchema);
