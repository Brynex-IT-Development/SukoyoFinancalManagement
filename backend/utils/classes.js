// Classes, tutors and bookings (F20) rules. Pure: no database access.
// Dates are IST days "YYYY-MM-DD"; times "HH:MM" (24-hour).

export const RECURRING = ["none", "daily", "weekly"];
export const PRICING = ["free", "per_session", "membership"];
export const BOOKING_STATUSES = ["booked", "attended", "cancelled"];
export const ACTIVE_BOOKING = ["booked", "attended"]; // hold a seat

export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Is `date` a day this class runs on? */
export const isOccurrence = (cls, date) => {
  if (!isDay(date) || !cls?.date) return false;
  if (date < cls.date) return false;
  if (cls.endDate && date > cls.endDate) return false;
  const r = cls.recurring || "none";
  if (r === "none") return date === cls.date;
  if (r === "daily") return true;
  if (r === "weekly") return weekday(date) === weekday(cls.date);
  return false;
};

/** The class's occurrence dates between from and to (inclusive), at most `limit`. */
export const occurrencesBetween = (cls, from, to, limit = 60) => {
  const out = [];
  if (!isDay(from) || !isDay(to) || from > to) return out;
  let d = from < cls.date ? cls.date : from;
  // Weekly: jump straight to the first matching weekday
  if ((cls.recurring || "none") === "weekly") while (d <= to && weekday(d) !== weekday(cls.date)) d = addDays(d, 1);
  const step = cls.recurring === "weekly" ? 7 : 1;
  while (d <= to && out.length < limit) {
    if (isOccurrence(cls, d)) out.push(d);
    if ((cls.recurring || "none") === "none") break;
    d = addDays(d, step);
  }
  return out;
};

/** Price of a booking: free → 0; membership with a membership given → 0 (covered), else the class price. */
export const bookingPrice = (cls, membership) => {
  if (cls?.pricingType === "free") return 0;
  if (cls?.pricingType === "membership" && String(membership || "").trim()) return 0;
  return Math.round((Number(cls?.price) || 0) * 100) / 100;
};

/** Problems with class fields, or null. partial = only the fields given are checked. */
export const classError = (c, { partial = false } = {}) => {
  const has = (k) => !partial || c[k] !== undefined;
  if (has("name") && !String(c.name || "").trim()) return "Enter the class name.";
  if (has("date") && !isDay(c.date)) return "Date must be YYYY-MM-DD.";
  if (has("time") && !isTime(c.time)) return "Time must be HH:MM (24-hour).";
  if (has("maxParticipants") && !(Number.isInteger(Number(c.maxParticipants)) && Number(c.maxParticipants) >= 1)) return "Maximum participants must be a whole number of 1 or more.";
  if (has("pricingType") && !PRICING.includes(c.pricingType)) return "Pricing must be free, per session or membership.";
  if (c.price !== undefined && c.price !== "" && !(Number(c.price) >= 0)) return "Price cannot be negative.";
  if (c.pricingType && c.pricingType !== "free" && has("price") && !(Number(c.price) >= 0)) return "Enter the price.";
  if (has("recurring") && c.recurring !== undefined && !RECURRING.includes(c.recurring)) return "Repeat must be none, daily or weekly.";
  if (c.durationMinutes !== undefined && c.durationMinutes !== "" && !(Number(c.durationMinutes) > 0)) return "Duration must be more than 0 minutes.";
  if (c.endDate && !isDay(c.endDate)) return "End date must be YYYY-MM-DD.";
  if (c.endDate && c.date && c.endDate < c.date) return "End date is before the start date.";
  return null;
};
