// Staff attendance formulas (F15). Pure: no database access.
// Dates are IST calendar days as "YYYY-MM-DD"; times are "HH:MM" (24-hour) on that day.

export const STATUSES = ["present", "absent", "half_day", "leave"];
export const STATUS_LABEL = { present: "Present", absent: "Absent", half_day: "Half day", leave: "Leave" };
export const DEFAULT_WEEKLY_OFF = 0; // Sunday (0 = Sunday … 6 = Saturday, null = no weekly off)
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));

/** "09:30" → 570; empty → null; malformed → NaN. */
export const toMinutes = (t) => {
  if (t === undefined || t === null || String(t).trim() === "") return null;
  const m = TIME_RE.exec(String(t).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * Minutes worked = (out − in) − (breakIn − breakOut). A missing pair is ignored:
 * no in/out pair → null (no hours); no break pair → no break taken off.
 */
export const workedMinutes = ({ inTime, outTime, breakOut, breakIn } = {}) => {
  const i = toMinutes(inTime), o = toMinutes(outTime);
  if (i === null || o === null || Number.isNaN(i) || Number.isNaN(o)) return null;
  let mins = o - i;
  const bo = toMinutes(breakOut), bi = toMinutes(breakIn);
  if (bo !== null && bi !== null && !Number.isNaN(bo) && !Number.isNaN(bi)) mins -= bi - bo;
  return mins;
};

export const formatMinutes = (mins) => (mins === null || mins === undefined ? "" : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`);

/** Problem with one entry's status/times, or null when it is fine. */
export const entryError = (e = {}) => {
  if (!STATUSES.includes(e.status)) return "Choose a status (present, absent, half day or leave).";
  const t = { in: toMinutes(e.inTime), out: toMinutes(e.outTime), bo: toMinutes(e.breakOut), bi: toMinutes(e.breakIn) };
  if (Object.values(t).some((v) => Number.isNaN(v))) return "Times must be HH:MM (24-hour), e.g. 09:30.";
  if ((e.status === "absent" || e.status === "leave") && Object.values(t).some((v) => v !== null)) return "Absent or leave days have no in/out times.";
  if (t.in !== null && t.out !== null && t.out <= t.in) return "Out time must be after in time.";
  if (t.bo !== null && t.bi !== null && t.bi <= t.bo) return "Break-in must be after break-out.";
  if (t.bo !== null && t.bi !== null && t.in !== null && t.out !== null && (t.bo < t.in || t.bi > t.out)) return "The break must be between in and out times.";
  return null;
};

/** Every day of a "YYYY-MM" month. */
export const daysOfMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
};

/** 0 = Sunday … 6 = Saturday for a "YYYY-MM-DD" day. */
export const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * Working days of a month = days that are not the weekly off day. For the month in progress only
 * the days up to today count (so "unmarked" is not inflated by days still to come).
 */
export const workingDaysOf = (ym, weeklyOff = DEFAULT_WEEKLY_OFF, today = null) =>
  daysOfMonth(ym).filter((d) => (weeklyOff === null || weekdayOf(d) !== Number(weeklyOff)) && (!today || d <= today));

/**
 * Monthly summary for one person. records: that person's attendance in the month.
 * Present counts half days as 0.5; absent and leave are separate; unmarked = working days with no mark;
 * attendance % = present ÷ working days × 100.
 */
export const monthSummary = (records, workingDays) => {
  const working = new Set(workingDays);
  const count = (s) => records.filter((r) => r.status === s).length;
  const halfDays = count("half_day");
  const present = count("present") + 0.5 * halfDays;
  const markedWorking = new Set(records.filter((r) => working.has(r.date)).map((r) => r.date)).size;
  const minutes = records.reduce((s, r) => s + (workedMinutes(r) || 0), 0);
  return {
    workingDays: working.size, present, halfDays, absent: count("absent"), leave: count("leave"),
    marked: markedWorking, unmarked: Math.max(0, working.size - markedWorking),
    attendancePct: working.size ? Math.round((present / working.size) * 10000) / 100 : 0,
    minutes,
  };
};

/** Display name of a SalesPerson ("-" is the placeholder last name the billing screen saves). */
export const staffName = (sp) => {
  const last = String(sp?.lastName || "").trim();
  return `${sp?.firstName || ""}${last && last !== "-" ? ` ${last}` : ""}`.trim();
};
