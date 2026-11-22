import mongoose from "mongoose";

// F20: a tutor who takes classes at a store.
const tutorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    expertise: { type: String, default: "", trim: true },
    phone: { type: String, default: "" },           // normalized digits
    email: { type: String, default: "", trim: true },
    internalOrExternal: { type: String, enum: ["internal", "external"], default: "internal" },
    address: { type: String, default: "", trim: true },
    locCode: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

tutorSchema.index({ locCode: 1, name: 1 });

export default mongoose.model("Tutor", tutorSchema);
