import mongoose from "mongoose";

// Every change to a customer's points. Customer.loyaltyPoints is the cached sum of `points`.
const loyaltyLedgerSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesInvoice", default: null },
    invoiceNumber: { type: String, default: "" },
    type: { type: String, enum: ["earn", "redeem", "reverse_earn", "restore_redeem", "adjust"], required: true },
    points: { type: Number, required: true }, // signed whole number
    balanceAfter: { type: Number, default: 0 },
    note: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

loyaltyLedgerSchema.index({ customerId: 1, createdAt: -1 });
loyaltyLedgerSchema.index({ invoiceId: 1 });

export default mongoose.model("LoyaltyLedger", loyaltyLedgerSchema);
