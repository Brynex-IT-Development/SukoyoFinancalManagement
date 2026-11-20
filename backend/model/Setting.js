import mongoose from "mongoose";

// Small key/value store for app-wide settings, e.g. { _id: "storeCreditExpiryDays", value: 30 }.
const settingSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Setting", settingSchema);
