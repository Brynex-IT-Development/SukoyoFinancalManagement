// Checks the attendance formulas (F15) on worked examples.
// Run: node scripts/test-attendance.js   (exits 1 on any failure)
import {
  toMinutes, workedMinutes, formatMinutes, entryError, daysOfMonth, weekdayOf, workingDaysOf, monthSummary, staffName,
} from "../utils/attendance.js";

let failed = 0;
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`}`);
};

// ── Hours worked = (out − in) − (breakIn − breakOut); missing pairs ignored
eq("times to minutes", [toMinutes("09:30"), toMinutes(""), Number.isNaN(toMinutes("9.30")), Number.isNaN(toMinutes("24:00"))], [570, null, true, true]);
// 09:30 → 18:30 is 9h; a 13:00–13:45 break leaves 8h 15m
eq("hours with a break", workedMinutes({ inTime: "09:30", outTime: "18:30", breakOut: "13:00", breakIn: "13:45" }), 495);
eq("hours without a break pair (break ignored)", workedMinutes({ inTime: "09:30", outTime: "18:30", breakOut: "13:00" }), 540);
eq("no out time → no hours", workedMinutes({ inTime: "09:30" }), null);
eq("format", [formatMinutes(495), formatMinutes(60), formatMinutes(null)], ["8h 15m", "1h 00m", ""]);

// ── Entry checks
eq("valid present entry", entryError({ status: "present", inTime: "09:30", outTime: "18:30" }), null);
eq("status required", entryError({ status: "maybe" }), "Choose a status (present, absent, half day or leave).");
eq("out before in", entryError({ status: "present", inTime: "18:00", outTime: "09:00" }), "Out time must be after in time.");
eq("break back before it started", entryError({ status: "present", breakOut: "14:00", breakIn: "13:00" }), "Break-in must be after break-out.");
eq("break outside the working hours", entryError({ status: "present", inTime: "10:00", outTime: "18:00", breakOut: "09:00", breakIn: "09:30" }), "The break must be between in and out times.");
eq("absent with times refused", entryError({ status: "absent", inTime: "09:00" }), "Absent or leave days have no in/out times.");
eq("bad time format", entryError({ status: "present", inTime: "9am" }), "Times must be HH:MM (24-hour), e.g. 09:30.");

// ── Working days: November 2026 has 30 days, Sundays 1, 8, 15, 22, 29 → 25 working days
eq("days of November 2026", daysOfMonth("2026-11").length, 30);
eq("1 Nov 2026 is a Sunday", weekdayOf("2026-11-01"), 0);
eq("working days, Sunday off", workingDaysOf("2026-11", 0).length, 25);
eq("working days, Tuesday off", workingDaysOf("2026-11", 2).length, 26);
eq("working days, no weekly off", workingDaysOf("2026-11", null).length, 30);
eq("month in progress: only up to today (20 Nov → 17 working days)", workingDaysOf("2026-11", 0, "2026-11-20").length, 17);
eq("February 2028 (leap year)", daysOfMonth("2028-02").length, 29);

// ── Monthly summary: 25 working days; 20 present, 2 half days, 1 absent, 1 leave, 1 day unmarked;
// plus one present mark on a Sunday (counts as present, not as a working day)
const wd = workingDaysOf("2026-11", 0);
const recs = [
  ...wd.slice(0, 20).map((date) => ({ date, status: "present", inTime: "10:00", outTime: "19:00", breakOut: "14:00", breakIn: "14:30" })),
  { date: wd[20], status: "half_day", inTime: "10:00", outTime: "14:00" }, { date: wd[21], status: "half_day" },
  { date: wd[22], status: "absent" }, { date: wd[23], status: "leave" },
  { date: "2026-11-08", status: "present" },
];
const sum = monthSummary(recs, wd);
eq("present = 20 + 1 (Sunday) + 2 × 0.5", sum.present, 22);
eq("absent / leave / half days separately", [sum.absent, sum.leave, sum.halfDays], [1, 1, 2]);
eq("unmarked = working days − marked working days", [sum.workingDays, sum.marked, sum.unmarked], [25, 24, 1]);
eq("attendance % = present ÷ working days", sum.attendancePct, 88);
eq("hours over the month: 20 × 8h 30m + 4h", sum.minutes, 20 * 510 + 240);

eq("staff name ignores the '-' placeholder", [staffName({ firstName: "Anu", lastName: "-" }), staffName({ firstName: "Binu", lastName: "Raj" })], ["Anu", "Binu Raj"]);

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll attendance checks passed");
process.exit(failed ? 1 : 0);
