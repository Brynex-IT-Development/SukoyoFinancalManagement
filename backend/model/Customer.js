import mongoose from "mongoose";

// A retail customer, identified by normalised phone (see utils/retailMath.js normalizePhone).
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true }, // normalised digits, unique
    email: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    pincode: { type: String, trim: true, default: "" },
    gstin: { type: String, trim: true, uppercase: true, default: "" },
    // Cached sum of LoyaltyLedger.points — only ever changed with atomic $inc
    loyaltyPoints: { type: Number, default: 0 },
    // Cached sum of open, unexpired StoreCredit balances (utils/redemptions.js refreshStoreCreditBalance)
    storeCreditBalance: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    locCode: { type: String, default: "" }, // store where the customer was created
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

customerSchema.index({ phone: 1 }, { unique: true });
customerSchema.index({ name: 1 });
customerSchema.index({ locCode: 1, createdAt: -1 });

export default mongoose.model("Customer", customerSchema);
