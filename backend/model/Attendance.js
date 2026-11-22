import mongoose from "mongoose";

// F15: one attendance mark per staff member per IST day.
const attendanceSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesPerson", required: true },
    staffName: { type: String, default: "" },   // snapshot for lists
    employeeId: { type: String, default: "" },  // snapshot for lists
    locCode: { type: String, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // IST day "YYYY-MM-DD"
    inTime: { type: String, default: "" },      // "HH:MM" 24-hour
    outTime: { type: String, default: "" },
    breakOut: { type: String, default: "" },
    breakIn: { type: String, default: "" },
    status: { type: String, enum: ["present", "absent", "half_day", "leave"], required: true },
    note: { type: String, default: "", trim: true },
    markedBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

attendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ locCode: 1, date: 1 });

export default mongoose.model("Attendance", attendanceSchema);
