import mongoose from "mongoose";

// Voucher (F5), two kinds:
//  - "value": a stored amount with a balance, spendable over several bills on eligible items
//  - "discount": a flat or percent discount per use, limited by usage counts
// Scope lists empty = every item. Applied as a redemption on the bill's final total.
const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, default: "", trim: true },
    kind: { type: String, enum: ["value", "discount"], required: true },
    value: { type: Number, required: true },
    discountType: { type: String, enum: ["flat", "percent"], default: "flat" }, // discount kind only
    maxDiscount: { type: Number, default: null },
    minBillAmount: { type: Number, default: 0 },
    scope: {
      brands: { type: [String], default: [] },
      categories: { type: [String], default: [] },
      subCategories: { type: [String], default: [] },
      itemIds: { type: [String], default: [] },
      itemLabels: { type: [String], default: [] }, // display names for itemIds (for the detail/print view)
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null }, // only this customer may use it
    customerName: { type: String, default: "" },
    usageLimitTotal: { type: Number, default: null },
    usageLimitPerCustomer: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 }, // value kind only
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    active: { type: Boolean, default: true },
    locCode: { type: String, default: null }, // set = usable only at that store
    batchRef: { type: String, default: "" }, // bulk-created vouchers share this
    createdBy: { type: String, default: "" },
    usages: [
      {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesInvoice" },
        invoiceNumber: String,
        customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
        amount: Number,
        date: { type: Date, default: Date.now },
        reversed: { type: Boolean, default: false }, // invoice edited or deleted
        reversedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

voucherSchema.index({ code: 1 }, { unique: true });
voucherSchema.index({ active: 1, validTo: 1 });
voucherSchema.index({ batchRef: 1 });
voucherSchema.index({ createdAt: -1 });

export default mongoose.model("Voucher", voucherSchema);
