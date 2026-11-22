import mongoose from "mongoose";

// F20: a class (one-off or repeating) with a capacity per occurrence.
const classSessionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, default: "", trim: true },                 // e.g. workshop, course, demo
    maxParticipants: { type: Number, required: true, min: 1 },
    pricingType: { type: String, enum: ["free", "per_session", "membership"], default: "per_session" },
    price: { type: Number, default: 0, min: 0 },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // first (or only) day
    time: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    durationMinutes: { type: Number, default: 60, min: 1 },
    recurring: { type: String, enum: ["none", "daily", "weekly"], default: "none" },
    endDate: { type: String, default: "" },                          // last day of a repeating class ("" = open)
    tutorId: { type: mongoose.Schema.Types.ObjectId, ref: "Tutor", default: null },
    tutorName: { type: String, default: "" },
    locCode: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

classSessionSchema.index({ locCode: 1, date: 1 });

export default mongoose.model("ClassSession", classSessionSchema);
