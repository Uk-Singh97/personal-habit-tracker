/* js/dates.js
   Date helpers. Dates are handled as LOCAL calendar days ("YYYY-MM-DD"),
   never converted through UTC, so a habit done at 11pm stays on the right day.
   Because "YYYY-MM-DD" strings sort correctly as text, two dates can be
   compared with < and > directly. */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Short weekday names, indexed like JavaScript's getDay(): 0 = Sunday ... 6 = Saturday. */
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns a local date as "YYYY-MM-DD" (e.g. "2026-10-29"). */
export function toISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Returns a consistent long format such as "Thursday 29 October 2026".
    (The exact punctuation comes from the browser's en-GB rules.) */
export function formatLongDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Turns "2026-10-29" into a Date at local midnight.
    Returns null if the text is not a real calendar date (e.g. "2026-02-30"). */
export function parseISODate(text) {
  if (typeof text !== 'string') return null;
  const match = ISO_DATE_PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const isRealDate = date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
  return isRealDate ? date : null;
}

/** True when the text is a real "YYYY-MM-DD" calendar date. */
export function isValidISODate(text) {
  return parseISODate(text) !== null;
}

/** Weekday number of a "YYYY-MM-DD" date (0 = Sunday ... 6 = Saturday), or null if invalid. */
export function getWeekday(text) {
  const date = parseISODate(text);
  return date ? date.getDay() : null;
}

/** Short, consistent display such as "29 Oct 2026" for a "YYYY-MM-DD" date. */
export function formatShortDate(text) {
  const date = parseISODate(text);
  if (!date) return 'Invalid date';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/* ---------- Added in Phase 5 ---------- */

/** Adds (or subtracts) whole calendar days: addDays("2026-10-31", 1) is "2026-11-01".
    Works on calendar dates, so daylight-saving changes cannot shift the result.
    Returns null when the input is not a valid date. */
export function addDays(text, amount) {
  const date = parseISODate(text);
  if (!date) return null;
  return toISODate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount));
}

/** The Monday of the week that contains the date (weeks start on Monday). */
export function startOfWeek(text) {
  const date = parseISODate(text);
  if (!date) return null;
  const daysSinceMonday = (date.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  return addDays(text, -daysSinceMonday);
}

/** Number of days in a month. monthIndex is 0 = January ... 11 = December. */
export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Moves forward or back by whole months. Returns { year, monthIndex }. */
export function shiftMonth(year, monthIndex, delta) {
  const moved = new Date(year, monthIndex + delta, 1);
  return { year: moved.getFullYear(), monthIndex: moved.getMonth() };
}

/** "October 2026" */
export function formatMonthYear(year, monthIndex) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
    .format(new Date(year, monthIndex, 1));
}

/** "29 Oct" for a "YYYY-MM-DD" date. */
export function formatDayMonth(text) {
  const date = parseISODate(text);
  if (!date) return 'Invalid date';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
}

/** "29 Oct, 14:05" for a saved ISO timestamp, shown in the device's local time. Returns '' if invalid. */
export function formatTimestamp(isoText) {
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}