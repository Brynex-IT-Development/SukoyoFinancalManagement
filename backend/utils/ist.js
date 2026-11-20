// India Standard Time helpers (UTC+05:30, no daylight saving).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of the IST calendar day containing `date`. */
export const istDateString = (date = new Date()) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Instant at 00:00:00.000 IST of the day containing `date`. */
export const istDayStart = (date = new Date()) => new Date(Date.parse(`${istDateString(date)}T00:00:00.000Z`) - IST_OFFSET_MS);

/** Instant at 23:59:59.999 IST of the day containing `date`. */
export const istDayEnd = (date = new Date()) => new Date(istDayStart(date).getTime() + DAY_MS - 1);

/** Same time of day, `days` IST calendar days later. */
export const addIstDays = (date, days) => new Date(new Date(date).getTime() + days * DAY_MS);
