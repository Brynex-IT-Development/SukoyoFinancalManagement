import mongoose from "mongoose";

// F20: a customer's place in one occurrence of a class.
const bookingSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true }, // BK-000001
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSession", required: true },
    className: { type: String, default: "" },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    time: { type: String, default: "" },
    membership: { type: String, default: "", trim: true },
    price: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["booked", "attended", "cancelled"], default: "booked" },
    locCode: { type: String, required: true },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

bookingSchema.index({ classId: 1, date: 1, status: 1 });
bookingSchema.index({ customerId: 1, date: -1 });

export default mongoose.model("Booking", bookingSchema);

// Seats taken per class occurrence. Incremented conditionally, so a class can never hold more
// active bookings than maxParticipants even when two people book the last seat at once.
const classSeatSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSession", required: true },
    date: { type: String, required: true },
    booked: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);
classSeatSchema.index({ classId: 1, date: 1 }, { unique: true });
export const ClassSeat = mongoose.model("ClassSeat", classSeatSchema);
