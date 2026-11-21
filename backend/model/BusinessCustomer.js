import mongoose from "mongoose";

// A business buyer billed with its GSTIN (F8). One record per GSTIN: updated, never duplicated.
const businessCustomerSchema = new mongoose.Schema(
  {
    gstin: { type: String, required: true, trim: true, uppercase: true },
    legalName: { type: String, required: true, trim: true },
    tradeName: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    stateCode: { type: String, trim: true, default: "" },
    stateName: { type: String, trim: true, default: "" },
    pan: { type: String, trim: true, uppercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
    natureOfBusiness: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

businessCustomerSchema.index({ gstin: 1 }, { unique: true });
businessCustomerSchema.index({ legalName: 1 });

export default mongoose.model("BusinessCustomer", businessCustomerSchema);
