import mongoose from "mongoose";

// Customer store credit issued on a return ("SC-" so it is not confused with the
// purchase module's vendor credit notes). Can be used partly, over several bills.
const storeCreditSchema = new mongoose.Schema(
  {
    number: { type: String, required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    sourceInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesInvoice", default: null },
    sourceInvoiceNumber: { type: String, default: "" },
    returnInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesInvoice", default: null },
    returnInvoiceNumber: { type: String, default: "" },
    amount: { type: Number, required: true },
    balance: { type: Number, required: true },
    issueDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, default: null }, // null = never expires
    status: { type: String, enum: ["open", "used", "expired", "void"], default: "open" },
    redemptions: [
      {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesInvoice" },
        invoiceNumber: String,
        amount: Number,
        date: { type: Date, default: Date.now },
        reversed: { type: Boolean, default: false }, // the invoice was edited or deleted and the amount put back
        reversedAt: Date,
      },
    ],
    locCode: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

storeCreditSchema.index({ number: 1 }, { unique: true });
storeCreditSchema.index({ customerId: 1, status: 1 });
storeCreditSchema.index({ status: 1, expiryDate: 1 });
storeCreditSchema.index({ locCode: 1, createdAt: -1 });

export default mongoose.model("StoreCredit", storeCreditSchema);
