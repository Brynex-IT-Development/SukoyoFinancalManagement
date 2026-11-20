import mongoose from "mongoose";

// Versioned loyalty rules. Never edited in place: a change creates a new active
// version and marks the previous one inactive, so the history stays.
// locCode null = default for every store; a store's own active row overrides it.
const loyaltySettingsSchema = new mongoose.Schema(
  {
    locCode: { type: String, default: null },
    earnAmount: { type: Number, default: 100 },   // ₹ spent …
    earnPoints: { type: Number, default: 1 },     // … earns this many points
    minInvoiceForEarning: { type: Number, default: 0 },
    redeemAmount: { type: Number, default: 1 },   // ₹ value of …
    redeemPoints: { type: Number, default: 1 },   // … this many points
    maxRedeemPercent: { type: Number, default: 50 },
    minInvoiceForRedeem: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true }, // loyalty switched on for this scope
    active: { type: Boolean, default: true },  // this row is the current version (older versions are false)
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

loyaltySettingsSchema.index({ locCode: 1, active: 1, createdAt: -1 });

export default mongoose.model("LoyaltySettings", loyaltySettingsSchema);
