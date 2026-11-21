import mongoose from "mongoose";

// Money paid to a vendor (F9), split over one or more of the vendor's bills.
// The allocations always add up to the amount (no advances in this version).
const vendorPaymentSchema = new mongoose.Schema(
  {
    number: { type: String, required: true }, // PAY-000001
    vendorId: { type: String, required: true }, // same id string Bill.vendorId holds
    vendorName: { type: String, default: "" },
    date: { type: Date, required: true },
    mode: { type: String, enum: ["cash", "bank", "upi", "cheque"], required: true },
    reference: { type: String, default: "" }, // cheque no., UTR, etc.
    amount: { type: Number, required: true },
    allocations: [{
      _id: false,
      billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill", required: true },
      billNumber: String,
      amount: { type: Number, required: true },
    }],
    notes: { type: String, default: "" },
    locCode: { type: String, default: "" },
    daybookInvoiceNo: { type: String, default: "" }, // the Transaction this payment posted
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

vendorPaymentSchema.index({ number: 1 }, { unique: true });
vendorPaymentSchema.index({ vendorId: 1, date: -1 });
vendorPaymentSchema.index({ locCode: 1, date: -1 });
vendorPaymentSchema.index({ "allocations.billId": 1 });

export default mongoose.model("VendorPayment", vendorPaymentSchema);
