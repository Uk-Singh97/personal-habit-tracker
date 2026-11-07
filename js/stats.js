/* js/stats.js
   All statistics, calculated from the real habit and completion records.
   This file never touches the page (no DOM) and never saves anything.

   RULES (these are the definitions to quote in the README and viva):

   Scheduled day   A day on or after the habit's start date, not after its end
                   date, whose weekday is one of the habit's chosen days.
   Active habit    Not archived, started on or before today, not ended.
   Completed       A completion record on a scheduled day, dated today or earlier.
                   Records on unscheduled or future days are ignored.
   Missed          A scheduled day BEFORE today with no completion.
                   Today's unfinished habits are "remaining", never "missed".
   Percentage      completed / scheduled, rounded. When nothing is scheduled the
                   value is null (shown as a dash), so there is never a division by zero.
   Current streak  Consecutive scheduled days completed, counting back from today.
                   Unscheduled days are skipped and never break a streak.
                   If today is scheduled but not done yet, the streak is not
                   broken until the day ends (it counts back from the last
                   scheduled day before today).
   Best streak     The longest such run anywhere in the habit's history.
   Limitation      There is no schedule history. If a habit's schedule changes,
                   the past is recalculated with the NEW schedule.

   All dates are local "YYYY-MM-DD" text; day arithmetic uses calendar dates, so
   daylight-saving changes cannot shift a day. */

import { isScheduledOn } from './habits.js';
import {
  addDays,
  daysInMonth,
  formatShortDate,
  getWeekday,
  isValidISODate,
  parseISODate,
  toISODate,
} from './dates.js';

/* ---------- Small helpers ---------- */
/** completed / scheduled as a whole percent, or null when nothing was scheduled. */
export function percentOf(completed, scheduled) {
  return scheduled > 0 ? Math.round((completed / scheduled) * 100) : null;
}

/** Whole calendar days from one "YYYY-MM-DD" date to another (negative if `to` is earlier). */
export function daysBetween(from, to) {
  const toDayNumber = (text) => {
    const date = parseISODate(text);
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  };
  return toDayNumber(to) - toDayNumber(from);
}

/** Restricts a date range to the days the habit exists. Returns { start, end } or null. */
function clipRange(habit, from, to) {
  const start = from > habit.startDate ? from : habit.startDate;
  const end = habit.endDate && habit.endDate < to ? habit.endDate : to;
  return start > end ? null : { start, end };
}

/** Is the habit active on this date? (started, and not ended) */
export function isActiveHabit(habit, date) {
  return habit.startDate <= date && !(habit.endDate && habit.endDate < date);
}

/* ---------- Completion index ---------- */
/** Groups completion records into Map(habitId -> Set of "YYYY-MM-DD"). Damaged records are skipped. */
export function buildIndex(completions) {
  const index = new Map();
  completions.forEach((record) => {
    if (!record || typeof record.habitId !== 'string' || !isValidISODate(record.date)) return;
    if (!index.has(record.habitId)) index.set(record.habitId, new Set());
    index.get(record.habitId).add(record.date);
  });
  return index;
}

/* ---------- Counting scheduled and completed days ---------- */
/** How many scheduled days the habit has between two dates (inclusive). */
export function countScheduled(habit, from, to) {
  const range = clipRange(habit, from, to);
  if (!range) return 0;
  const days = new Set(habit.schedule.days);
  const length = daysBetween(range.start, range.end) + 1;
  const firstWeekday = getWeekday(range.start);
  let count = Math.floor(length / 7) * days.size;
  for (let i = 0; i < length % 7; i += 1) {
    if (days.has((firstWeekday + i) % 7)) count += 1;
  }
  return count;
}

/** How many completions fall on scheduled days between two dates (inclusive). */
export function countCompleted(habit, dates, from, to) {
  const range = clipRange(habit, from, to);
  if (!range || !dates) return 0;
  let count = 0;
  dates.forEach((date) => {
    if (date >= range.start && date <= range.end && isScheduledOn(habit, date)) count += 1;
  });
  return count;
}

/* ---------- Streaks ---------- */
/** The scheduled day before `date`, or null if there is none (before the habit started). */
function previousScheduledDate(habit, date) {
  for (let step = 1; step <= 7; step += 1) {
    const candidate = addDays(date, -step);
    if (candidate < habit.startDate) return null;
    if (isScheduledOn(habit, candidate)) return candidate;
  }
  return null;
}

/** Completed scheduled dates up to today, sorted oldest first. */
function validCompletedDates(habit, dates, today) {
  const valid = [];
  if (dates) {
    dates.forEach((date) => {
      if (date <= today && isScheduledOn(habit, date)) valid.push(date);
    });
  }
  return valid.sort();
}

function currentStreak(habit, completedSet, today) {
  if (habit.startDate > today) return 0;
  if (habit.endDate && habit.endDate < today) return 0;

  // Where to start counting back from.
  let cursor;
  if (isScheduledOn(habit, today) && completedSet.has(today)) {
    cursor = today;
  } else {
    // Today is not scheduled, or is scheduled but not done YET: the streak is not broken.
    cursor = previousScheduledDate(habit, today);
  }

  let count = 0;
  while (cursor && completedSet.has(cursor)) {
    count += 1;
    cursor = previousScheduledDate(habit, cursor);
  }
  return count;
}

function bestStreak(habit, sortedDates) {
  let best = 0;
  let run = 0;
  let previous = null;
  sortedDates.forEach((date) => {
    // Two completions are in the same run when no scheduled day lies between them.
    const joined = previous !== null
      && countScheduled(habit, addDays(previous, 1), addDays(date, -1)) === 0;
    run = joined ? run + 1 : 1;
    if (run > best) best = run;
    previous = date;
  });
  return best;
}

/** { current, best, totalCompleted } for one habit. `dates` is the habit's Set of completion dates. */
export function habitStreak(habit, dates, today) {
  const valid = validCompletedDates(habit, dates, today);
  const current = currentStreak(habit, new Set(valid), today);
  return { current, best: Math.max(bestStreak(habit, valid), current), totalCompleted: valid.length };
}

/** Map(habitId -> { current, best, totalCompleted }) for every habit. */
export function computeStreaks(habits, index, today) {
  const streaks = new Map();
  habits.forEach((habit) => streaks.set(habit.id, habitStreak(habit, index.get(habit.id), today)));
  return streaks;
}

/** The overall best CURRENT streak (active habits only) and the best streak ever.
    Each is { days, habit } where habit is null when the best is 0. */
export function summariseStreaks(habits, streaks, today) {
  let bestCurrent = { days: 0, habit: null };
  let bestEver = { days: 0, habit: null };
  habits.forEach((habit) => {
    const streak = streaks.get(habit.id);
    if (!streak) return;
    if (isActiveHabit(habit, today) && streak.current > bestCurrent.days) {
      bestCurrent = { days: streak.current, habit };
    }
    if (streak.best > bestEver.days) bestEver = { days: streak.best, habit };
  });
  return { bestCurrent, bestEver };
}

/* ---------- One day ---------- */
/** Figures for one date: how many habits were scheduled and how many were completed.
    percent is null for future days and for days with nothing scheduled. */
export function summariseDay(habits, index, date, today) {
  const scheduledHabits = habits.filter((habit) => isScheduledOn(habit, date));
  const doneHabits = scheduledHabits.filter((habit) => {
    const dates = index.get(habit.id);
    return Boolean(dates && dates.has(date));
  });
  const isFuture = date > today;
  return {
    date,
    isToday: date === today,
    isFuture,
    scheduled: scheduledHabits.length,
    completed: doneHabits.length,
    remaining: scheduledHabits.length - doneHabits.length,
    percent: isFuture ? null : percentOf(doneHabits.length, scheduledHabits.length),
    scheduledHabits,
    doneHabits,
  };
}

/** What happened to every habit on one date, for the History view.
    status: 'done' | 'missed' | 'pending' (today, not done yet) | 'future' (scheduled, not yet due)
            | 'rest' (not scheduled) | 'notstarted' | 'ended'
    relevant is true for the first four (the ones worth showing). */
export function dayDetail(habits, index, date, today) {
  return habits.map((habit) => {
    const dates = index.get(habit.id);
    const done = Boolean(dates && dates.has(date));
    const scheduled = isScheduledOn(habit, date);
    let status;
    if (done) status = 'done';
    else if (date < habit.startDate) status = 'notstarted';
    else if (habit.endDate && date > habit.endDate) status = 'ended';
    else if (!scheduled) status = 'rest';
    else if (date > today) status = 'future';
    else if (date === today) status = 'pending';
    else status = 'missed';
    return {
      habit,
      status,
      scheduled,
      done,
      relevant: status === 'done' || status === 'missed' || status === 'pending' || status === 'future',
    };
  });
}

/* ---------- One week ---------- */
/** Seven days starting on `weekStart` (a Monday). The weekly rate counts the days up to and
    including today, so today's unfinished habits are part of the denominator. */
export function summariseWeek(habits, index, weekStart, today) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    days.push(summariseDay(habits, index, addDays(weekStart, i), today));
  }
  const counted = days.filter((day) => !day.isFuture);
  const scheduled = counted.reduce((total, day) => total + day.scheduled, 0);
  const completed = counted.reduce((total, day) => total + day.completed, 0);
  const missed = days
    .filter((day) => day.date < today)
    .reduce((total, day) => total + day.remaining, 0);
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    days,
    scheduled,
    completed,
    missed,
    percent: percentOf(completed, scheduled),
  };
}

/* ---------- One month ---------- */
/** A calendar month: one entry per day, plus totals and a per-habit breakdown.
    leadingBlanks = empty cells before day 1 in a Monday-first calendar grid. */
export function summariseMonth(habits, index, year, monthIndex, today) {
  const total = daysInMonth(year, monthIndex);
  const first = new Date(year, monthIndex, 1);
  const monthStart = toISODate(first);
  const monthEnd = toISODate(new Date(year, monthIndex, total));

  const days = [];
  for (let day = 1; day <= total; day += 1) {
    const date = toISODate(new Date(year, monthIndex, day));
    days.push({ ...summariseDay(habits, index, date, today), day });
  }

  const counted = days.filter((day) => !day.isFuture);
  const scheduled = counted.reduce((sum, day) => sum + day.scheduled, 0);
  const completed = counted.reduce((sum, day) => sum + day.completed, 0);
  const missed = days
    .filter((day) => day.date < today)
    .reduce((sum, day) => sum + day.remaining, 0);

  // Per-habit rows only cover days up to today.
  const through = monthEnd < today ? monthEnd : today;
  const habitRows = monthStart > through
    ? []
    : habits
      .map((habit) => {
        const habitScheduled = countScheduled(habit, monthStart, through);
        const habitCompleted = countCompleted(habit, index.get(habit.id), monthStart, through);
        return {
          habit,
          scheduled: habitScheduled,
          completed: habitCompleted,
          percent: percentOf(habitCompleted, habitScheduled),
        };
      })
      .filter((row) => row.scheduled > 0);

  return {
    year,
    monthIndex,
    monthStart,
    monthEnd,
    leadingBlanks: (first.getDay() + 6) % 7,
    days,
    scheduled,
    completed,
    missed,
    percent: percentOf(completed, scheduled),
    habitRows,
  };
}

/* ---------- Whole history ---------- */
/** Scheduled / completed / missed for one habit from its start date to today (or its end date). */
export function summariseHabit(habit, dates, today) {
  if (habit.startDate > today) return { scheduled: 0, completed: 0, missed: 0, percent: null };
  const end = habit.endDate && habit.endDate < today ? habit.endDate : today;
  const yesterday = addDays(today, -1);
  const pastEnd = end < yesterday ? end : yesterday;
  const scheduled = countScheduled(habit, habit.startDate, end);
  const completed = countCompleted(habit, dates, habit.startDate, end);
  const missed = countScheduled(habit, habit.startDate, pastEnd)
    - countCompleted(habit, dates, habit.startDate, pastEnd);
  return { scheduled, completed, missed, percent: percentOf(completed, scheduled) };
}

/** Totals across all habits, from each habit's start date to today. */
export function summariseOverall(habits, index, today) {
  let scheduled = 0;
  let completed = 0;
  let missed = 0;
  habits.forEach((habit) => {
    const summary = summariseHabit(habit, index.get(habit.id), today);
    scheduled += summary.scheduled;
    completed += summary.completed;
    missed += summary.missed;
  });
  return { scheduled, completed, missed, percent: percentOf(completed, scheduled) };
}

/** Everything the Dashboard needs in one call. `habits` = usable, non-archived habits. */
export function computeDashboardStats(habits, completions, today) {
  const index = buildIndex(completions);
  const streaks = computeStreaks(habits, index, today);
  return {
    index,
    streaks,
    activeCount: habits.filter((habit) => isActiveHabit(habit, today)).length,
    today: summariseDay(habits, index, today, today),
    overall: summariseOverall(habits, index, today),
    ...summariseStreaks(habits, streaks, today),
  };
}

/* ---------- Recent activity ---------- */
/** The newest valid log entries, newest first. Damaged entries are skipped. */
export function recentActivity(log, limit = 10) {
  return log
    .filter((entry) => entry
      && typeof entry === 'object'
      && typeof entry.type === 'string'
      && typeof entry.habitName === 'string'
      && typeof entry.at === 'string'
      && !Number.isNaN(Date.parse(entry.at)))
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/** Plain-text sentence for a log entry (pages must escape it before using innerHTML). */
export function describeActivity(entry, today) {
  const name = `"${entry.habitName}"`;
  const detail = typeof entry.detail === 'string' && entry.detail ? ` (${entry.detail})` : '';
  const forDate = isValidISODate(entry.date) && entry.date !== today
    ? ` for ${formatShortDate(entry.date)}`
    : '';
  switch (entry.type) {
    case 'created': return `Created habit ${name}`;
    case 'updated': return `Updated habit ${name}${detail}`;
    case 'completed': return `Completed ${name}${forDate}`;
    case 'uncompleted': return `Undid completion of ${name}${forDate}`;
    case 'deleted': return `Deleted habit ${name}${detail}`;
    default: return `${entry.type} ${name}`;
  }
}