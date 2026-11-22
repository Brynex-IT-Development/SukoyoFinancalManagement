import mongoose from "mongoose";

// F17: register of the business's bank accounts. Separate from the daybook's bank columns.
const bankAccountSchema = new mongoose.Schema(
  {
    bankName: { type: String, required: true, trim: true },
    accountHolder: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifsc: { type: String, default: "", trim: true, uppercase: true },
    branch: { type: String, default: "", trim: true },
    upiId: { type: String, default: "", trim: true },
    openingBalance: { type: Number, default: 0, min: 0 },
    balance: { type: Number, default: 0, min: 0 }, // never negative: changed only by conditional updates
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

bankAccountSchema.index({ accountNumber: 1, ifsc: 1 }, { unique: true });

export default mongoose.model("BankAccount", bankAccountSchema);
