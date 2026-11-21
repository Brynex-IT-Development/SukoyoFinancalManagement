import mongoose from "mongoose";

// The business's own details (F7). One document only (key "default").
// Printouts read their header, GSTIN and bank details from here; stateCode decides
// intra- vs inter-state GST on business invoices (F8).
const companyProfileSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    businessType: { type: String, trim: true, default: "" },
    companyName: { type: String, trim: true, default: "" },
    ownerName: { type: String, trim: true, default: "" },
    logo: { type: String, default: "" }, // base64 data URL (same approach as item images)
    phone: { type: String, trim: true, default: "" },
    altPhone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    stateCode: { type: String, trim: true, default: "" }, // 2-digit GST state code
    pincode: { type: String, trim: true, default: "" },
    gstin: { type: String, trim: true, uppercase: true, default: "" },
    pan: { type: String, trim: true, uppercase: true, default: "" },
    cin: { type: String, trim: true, uppercase: true, default: "" },
    tradeLicense: { type: String, trim: true, default: "" },
    bankName: { type: String, trim: true, default: "" },
    accountHolder: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    ifsc: { type: String, trim: true, uppercase: true, default: "" },
    branch: { type: String, trim: true, default: "" },
    upiId: { type: String, trim: true, default: "" },
    invoiceFooterNote: { type: String, trim: true, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("CompanyProfile", companyProfileSchema);
