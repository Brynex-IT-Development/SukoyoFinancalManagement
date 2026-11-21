import mongoose from "mongoose";

// Prepaid gift card (F4). Bearer instrument: anyone with the code can spend it, in parts,
// over several bills. Money comes in when the card is sold or reloaded (daybook "Gift Card Sale").
const historySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["issue", "redeem", "reload", "reverse"], required: true },
    amount: { type: Number, required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesInvoice", default: null },
    invoiceNumber: { type: String, default: "" },
    reference: { type: String, default: "" }, // GCS-/GCR- daybook number for sales and reloads
    note: { type: String, default: "" },
    date: { type: Date, default: Date.now },
    by: { type: String, default: "" },
    // redeem entries only: the invoice was edited or deleted and the amount put back
    reversed: { type: Boolean, default: false },
  },
  { _id: true }
);

const giftCardSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    initialValue: { type: Number, required: true },
    balance: { type: Number, required: true },
    issueDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, default: null }, // null = never expires
    reloadable: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "blocked", "expired"], default: "active" },
    // How the card was issued: sold for money, or complimentary (no money, admin only)
    issueType: { type: String, enum: ["sold", "complimentary"], default: "sold" },
    soldToCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
    soldToName: { type: String, default: "" },
    saleInvoiceRef: { type: String, default: "" }, // GCS- number of the sale (one per issue action)
    locCode: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    history: [historySchema],
  },
  { timestamps: true }
);

giftCardSchema.index({ code: 1 }, { unique: true });
giftCardSchema.index({ status: 1, expiryDate: 1 });
giftCardSchema.index({ soldToCustomerId: 1 });
giftCardSchema.index({ saleInvoiceRef: 1 });
giftCardSchema.index({ locCode: 1, createdAt: -1 });

export default mongoose.model("GiftCard", giftCardSchema);
