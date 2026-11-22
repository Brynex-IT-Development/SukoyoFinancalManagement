import mongoose from "mongoose";

// F17: money moved between two registered bank accounts.
const bankTransferSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true }, // BT-000001
    fromAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true },
    toAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true },
    fromLabel: { type: String, default: "" }, // "Bank · ••••1234" snapshots for lists
    toLabel: { type: String, default: "" },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // IST day
    amount: { type: Number, required: true, min: 0.01 },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

bankTransferSchema.index({ date: -1 });
bankTransferSchema.index({ fromAccountId: 1, date: -1 });
bankTransferSchema.index({ toAccountId: 1, date: -1 });

export default mongoose.model("BankTransfer", bankTransferSchema);
