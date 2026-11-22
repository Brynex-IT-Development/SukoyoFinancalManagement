// Checks the class rules (F20): occurrences, booking price, field checks.
// Run: node scripts/test-classes.js   (exits 1 on any failure)
import { isOccurrence, occurrencesBetween, bookingPrice, classError } from "../utils/classes.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};

const once = { date: "2026-12-05", recurring: "none" };                         // Saturday
const weekly = { date: "2026-12-05", recurring: "weekly", endDate: "2026-12-26" };
const daily = { date: "2026-12-01", recurring: "daily", endDate: "2026-12-03" };
eq("one-off class runs on its date only", [isOccurrence(once, "2026-12-05"), isOccurrence(once, "2026-12-12")], [true, false]);
eq("weekly class: same weekday, from start to end date", [isOccurrence(weekly, "2026-12-12"), isOccurrence(weekly, "2026-12-13"), isOccurrence(weekly, "2026-11-28"), isOccurrence(weekly, "2027-01-02")], [true, false, false, false]);
eq("weekly occurrences in December", occurrencesBetween(weekly, "2026-12-01", "2026-12-31"), ["2026-12-05", "2026-12-12", "2026-12-19", "2026-12-26"]);
eq("daily occurrences stop at the end date", occurrencesBetween(daily, "2026-11-28", "2026-12-10"), ["2026-12-01", "2026-12-02", "2026-12-03"]);
eq("one-off occurrence list", occurrencesBetween(once, "2026-12-01", "2026-12-31"), ["2026-12-05"]);
eq("open-ended weekly is capped", occurrencesBetween({ date: "2026-01-03", recurring: "weekly" }, "2026-01-01", "2030-12-31", 5).length, 5);

eq("booking price", [bookingPrice({ pricingType: "free", price: 500 }), bookingPrice({ pricingType: "per_session", price: 499.5 }), bookingPrice({ pricingType: "membership", price: 300 }, "MEM-12"), bookingPrice({ pricingType: "membership", price: 300 }, "")], [0, 499.5, 0, 300]);

const ok = { name: "Beginner kundan", date: "2026-12-05", time: "16:00", maxParticipants: 8, pricingType: "per_session", price: 1500, recurring: "weekly" };
eq("valid class", classError(ok), null);
eq("bad time", classError({ ...ok, time: "4pm" }), "Time must be HH:MM (24-hour).");
eq("capacity must be a whole number ≥ 1", [classError({ ...ok, maxParticipants: 0 }), classError({ ...ok, maxParticipants: 2.5 })], ["Maximum participants must be a whole number of 1 or more.", "Maximum participants must be a whole number of 1 or more."]);
eq("end date before start", classError({ ...ok, endDate: "2026-11-30" }), "End date is before the start date.");
eq("partial edit checks only what is sent", classError({ time: "25:00" }, { partial: true }), "Time must be HH:MM (24-hour).");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll class checks passed");
process.exit(failed ? 1 : 0);
