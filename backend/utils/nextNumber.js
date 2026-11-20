// Atomic document numbering (e.g. SC-000001) backed by the Counter collection.
// One counter document per key; $inc is atomic, so two requests can never get the same number.
import Counter from "../model/Counter.js";

export const formatNumber = (prefix, seq, pad = 6) => `${prefix}${String(seq).padStart(pad, "0")}`;

export const nextNumber = async (key, prefix, pad = 6) => {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  return formatNumber(prefix, doc.seq, pad);
};
