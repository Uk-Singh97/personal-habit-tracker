/* js/habits.js
   Habit rules and operations. It sits between the pages and storage.js:

       page-habits.js  ->  habits.js (validation, rules)  ->  storage.js (saving)

   This file never touches the page (no DOM). It returns plain results:
       { ok: true, ... }                      the change was saved
       { ok: false, errors: { field: msg } }  the form has mistakes (nothing saved)
       { ok: false, message }                 a problem that is not about one field
   Storage failures are thrown as StorageError and handled by the calling page.

   Nothing is saved unless every check passes, and saving replaces only the one
   habit being changed. Each successful change is also written to the activity
   log (best effort: if the log cannot be written, the change itself still stands). */

import {
  getHabits,
  getCompletions,
  saveHabit,
  deleteHabit,
  setCompletion,
  addActivity,
  generateId,
} from './storage.js';
import {
  isValidISODate,
  getWeekday,
  formatShortDate,
  toISODate,
  WEEKDAY_NAMES,
} from './dates.js';

/* ---------- Constants (the form and the checks share these) ---------- */
export const CATEGORIES = ['Health', 'Study', 'Learning', 'Productivity', 'Fitness', 'Mindfulness', 'Other'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const SCHEDULE_MODES = ['daily', 'workdays', 'custom'];
export const NAME_MAX_LENGTH = 60;
export const DESCRIPTION_MAX_LENGTH = 200;
const CATEGORY_MAX_LENGTH = 40;
export const MIN_DATE = '2000-01-01';
export const MAX_DATE = '2100-12-31';
export const DEFAULT_REMINDER_TIME = '08:00';

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // JavaScript getDay(): Sunday = 0
const WORKDAYS = [1, 2, 3, 4, 5];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // show weeks starting on Monday
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------- Small helpers ---------- */
/** Trims a name and squashes repeated spaces, so "Morning   walk " becomes "Morning walk". */
export function normaliseHabitName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

function sameDays(a, b) {
  return a.length === b.length && b.every((day) => a.includes(day));
}

/** Checks that a saved record has the shape the app needs. Damaged records are hidden, not deleted. */
export function isUsableHabit(habit) {
  if (!habit || typeof habit !== 'object') return false;
  if (typeof habit.id !== 'string' || typeof habit.name !== 'string' || typeof habit.category !== 'string') return false;
  if (!PRIORITIES.includes(habit.priority)) return false;
  if (!isValidISODate(habit.startDate)) return false;
  if (habit.endDate !== null && habit.endDate !== undefined && !isValidISODate(habit.endDate)) return false;
  const schedule = habit.schedule;
  return Boolean(schedule)
    && Array.isArray(schedule.days)
    && schedule.days.length > 0
    && schedule.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

/** Writes one line to the activity log. Never throws: the change being logged has already been saved. */
async function logActivity(userId, entry) {
  try {
    await addActivity(userId, entry);
  } catch (error) {
    console.warn('The activity log could not be updated:', error);
  }
}

/** True when two habits have the same editable details (used to skip saving a no-op edit). */
function sameHabitDetails(a, b) {
  const reminderA = a.reminder || {};
  const reminderB = b.reminder || {};
  const sameReminder = Boolean(reminderA.enabled) === Boolean(reminderB.enabled)
    && (!reminderA.enabled || reminderA.time === reminderB.time);
  const daysA = [...a.schedule.days].sort((x, y) => x - y).join(',');
  const daysB = [...b.schedule.days].sort((x, y) => x - y).join(',');
  return a.name === b.name
    && (a.description || '') === (b.description || '')
    && a.category === b.category
    && a.priority === b.priority
    && a.startDate === b.startDate
    && daysA === daysB
    && sameReminder;
}

/* ---------- Schedules ---------- */
/** Builds the stored schedule from the form choice. `days` is only used for 'custom'. */
export function buildSchedule(mode, days = []) {
  if (mode === 'daily') return { type: 'daily', days: [...ALL_WEEKDAYS] };
  if (mode === 'workdays') return { type: 'weekdays', days: [...WORKDAYS] };
  const cleaned = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
  return { type: 'weekdays', days: cleaned };
}

/** Which form choice a stored schedule corresponds to: 'daily', 'workdays' or 'custom'. */
export function scheduleMode(schedule) {
  if (schedule.type === 'daily' || schedule.days.length === 7) return 'daily';
  if (sameDays(schedule.days, WORKDAYS)) return 'workdays';
  return 'custom';
}

/** Readable text such as "Every day", "Mon to Fri", "Weekends" or "Mon, Wed, Sat". */
export function describeSchedule(schedule) {
  const days = schedule.days;
  if (schedule.type === 'daily' || days.length === 7) return 'Every day';
  if (sameDays(days, WORKDAYS)) return 'Mon to Fri';
  if (sameDays(days, [6, 0])) return 'Weekends';
  return DISPLAY_ORDER.filter((day) => days.includes(day)).map((day) => WEEKDAY_NAMES[day]).join(', ');
}

/** True when the habit is due on this date: on/after its start, not past its end, and a chosen weekday. */
export function isScheduledOn(habit, date) {
  if (date < habit.startDate) return false;
  if (habit.endDate && date > habit.endDate) return false;
  return habit.schedule.days.includes(getWeekday(date));
}

/** Status of a habit on one date: 'done' | 'pending' | 'rest' | 'upcoming' | 'ended'.
    A completed habit always counts as 'done', so it can always be undone. */
export function getHabitStatus(habit, date, isDone) {
  if (isDone) return 'done';
  if (date < habit.startDate) return 'upcoming';
  if (habit.endDate && date > habit.endDate) return 'ended';
  return habit.schedule.days.includes(getWeekday(date)) ? 'pending' : 'rest';
}

/* ---------- Validation ---------- */
/** Checks form input. Returns { errors, values }. `errors` is empty when everything is valid.
    existingHabits: all saved habits of this profile (for the duplicate-name check).
    editing: the habit being edited, or null when creating.
    earliestCompletion: the first completed date of the habit being edited, or null. */
export function validateHabitInput(input, existingHabits, { editing = null, earliestCompletion = null } = {}) {
  const errors = {};

  // Name
  const name = normaliseHabitName(input.name);
  if (!name) {
    errors.name = 'Enter a habit name.';
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.name = `Use ${NAME_MAX_LENGTH} characters or fewer.`;
  } else {
    const duplicate = existingHabits.some((habit) => habit
      && typeof habit.name === 'string'
      && (!editing || habit.id !== editing.id)
      && normaliseHabitName(habit.name).toLowerCase() === name.toLowerCase());
    if (duplicate) errors.name = 'You already have a habit with this name. Choose a different name, or edit the existing one.';
  }

  // Description
  const description = String(input.description ?? '').trim();
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Use ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  // Category (a category already saved on the habit being edited is still allowed)
  const category = String(input.category ?? '').trim();
  const categoryAllowed = CATEGORIES.includes(category) || (editing && editing.category === category);
  if (!category) {
    errors.category = 'Choose a category.';
  } else if (!categoryAllowed || category.length > CATEGORY_MAX_LENGTH) {
    errors.category = 'Choose a category from the list.';
  }

  // Priority
  const priority = String(input.priority ?? '');
  if (!PRIORITIES.includes(priority)) errors.priority = 'Choose a priority: Low, Medium or High.';

  // Start date
  const startDate = String(input.startDate ?? '');
  if (!isValidISODate(startDate)) {
    errors.startDate = 'Enter a valid start date.';
  } else if (startDate < MIN_DATE || startDate > MAX_DATE) {
    errors.startDate = `Choose a date between ${formatShortDate(MIN_DATE)} and ${formatShortDate(MAX_DATE)}.`;
  } else if (editing && editing.endDate && startDate > editing.endDate) {
    errors.startDate = `The start date cannot be after this habit's end date (${formatShortDate(editing.endDate)}).`;
  } else if (earliestCompletion && startDate > earliestCompletion) {
    errors.startDate = `This habit already has a completion on ${formatShortDate(earliestCompletion)}. Choose that date or earlier, so your history does not fall before the start.`;
  }

  // Schedule
  const mode = String(input.scheduleMode ?? '');
  let schedule = null;
  if (!SCHEDULE_MODES.includes(mode)) {
    errors.schedule = 'Choose a schedule.';
  } else {
    const days = Array.isArray(input.days) ? input.days : [];
    schedule = buildSchedule(mode, days);
    if (schedule.days.length === 0) {
      errors.days = 'Choose at least one day of the week.';
    }
  }

  // Reminder
  const reminderEnabled = input.reminderEnabled === true;
  let reminderTime = String(input.reminderTime ?? '');
  if (reminderEnabled && !TIME_PATTERN.test(reminderTime)) {
    errors.reminderTime = 'Enter a valid reminder time.';
  } else if (!TIME_PATTERN.test(reminderTime)) {
    reminderTime = DEFAULT_REMINDER_TIME;
  }

  return {
    errors,
    values: {
      name,
      description,
      category,
      priority,
      startDate,
      schedule,
      reminder: { enabled: reminderEnabled, time: reminderTime },
    },
  };
}

/* ---------- Reading ---------- */
/** Habits to show: usable and not archived, sorted by name.
    hiddenCount = saved records too damaged to read (they are not deleted). */
export async function listHabits(userId) {
  const all = await getHabits(userId);
  const usable = all.filter(isUsableHabit);
  const habits = usable
    .filter((habit) => !habit.archived)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { habits, hiddenCount: all.length - usable.length };
}

/** Everything the Habits page needs: the list, plus which habits are done on `today`. */
export async function loadHabitsForToday(userId, today = toISODate()) {
  const [{ habits, hiddenCount }, completions] = await Promise.all([
    listHabits(userId),
    getCompletions(userId),
  ]);
  const completedToday = new Set(
    completions.filter((record) => record && record.date === today).map((record) => record.habitId),
  );
  return { today, habits, hiddenCount, completedToday };
}

/** How many completion records a habit has (shown in the delete confirmation). */
export async function countCompletions(userId, habitId) {
  const completions = await getCompletions(userId);
  return completions.filter((record) => record && record.habitId === habitId).length;
}

/* ---------- Changing data ---------- */
/** Creates a habit. Returns { ok: true, habit } or { ok: false, errors }. */
export async function createHabit(userId, input) {
  const existing = await getHabits(userId);
  const { errors, values } = validateHabitInput(input, existing);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const now = new Date().toISOString();
  const habit = {
    id: generateId('habit'),
    userId,
    ...values,
    endDate: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await saveHabit(habit);
  await logActivity(userId, { type: 'created', habitId: habit.id, habitName: habit.name });
  return { ok: true, habit };
}

/** Edits a habit. Its id, creation time, end date and ALL completion records are kept.
    Returns { ok: true, habit, unchanged? } or { ok: false, errors } or { ok: false, message }.
    When nothing was changed, nothing is saved and `unchanged` is true. */
export async function updateHabit(userId, habitId, input) {
  const existing = await getHabits(userId);
  const current = existing.find((habit) => habit && habit.id === habitId);
  if (!current) {
    return { ok: false, message: 'This habit no longer exists. It may have been deleted in another tab.' };
  }

  const completions = await getCompletions(userId);
  const dates = completions
    .filter((record) => record && record.habitId === habitId && isValidISODate(record.date))
    .map((record) => record.date)
    .sort();
  const earliestCompletion = dates.length > 0 ? dates[0] : null;

  const { errors, values } = validateHabitInput(input, existing, { editing: current, earliestCompletion });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const updated = {
    ...current,
    ...values,
    id: current.id,
    userId: current.userId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  if (isUsableHabit(current) && sameHabitDetails(current, updated)) {
    return { ok: true, habit: current, unchanged: true };
  }

  await saveHabit(updated);
  await logActivity(userId, {
    type: 'updated',
    habitId: updated.id,
    habitName: updated.name,
    detail: current.name !== updated.name ? `renamed from "${current.name}"` : '',
  });
  return { ok: true, habit: updated };
}

/** Deletes a habit AND all of its completion records together. */
export async function removeHabit(userId, habitId) {
  const existing = await getHabits(userId);
  const habit = existing.find((item) => item && item.id === habitId);
  if (!habit) {
    return { ok: false, message: 'This habit no longer exists. It may have been deleted in another tab.' };
  }

  const completions = await getCompletions(userId);
  const removed = completions.filter((record) => record && record.habitId === habitId).length;

  await deleteHabit(userId, habitId);
  await logActivity(userId, {
    type: 'deleted',
    habitId,
    habitName: typeof habit.name === 'string' ? habit.name : 'Unnamed habit',
    detail: removed > 0 ? `${removed} completion ${removed === 1 ? 'record' : 'records'} removed` : '',
  });
  return { ok: true };
}

/** Marks a habit done (done = true) or not done (done = false) on one "YYYY-MM-DD" date.
    Marking done is only allowed on a scheduled day that is not in the future.
    Undoing is always allowed.
    There can never be two records for the same habit and date (storage.js enforces it).
    Returns { ok: true, changed } or { ok: false, message }. */
export async function setHabitDone(userId, habitId, date, done) {
  if (!isValidISODate(date)) return { ok: false, message: 'That date is not valid.' };

  const habits = await getHabits(userId);
  const habit = habits.find((item) => item && item.id === habitId);
  if (!habit || !isUsableHabit(habit)) {
    return { ok: false, message: 'This habit no longer exists. It may have been deleted in another tab.' };
  }
  if (done && date > toISODate()) {
    return { ok: false, message: 'You cannot mark a habit done for a future date.' };
  }
  if (done && !isScheduledOn(habit, date)) {
    return { ok: false, message: 'This habit is not scheduled on that date, so it cannot be marked done.' };
  }

  const changed = await setCompletion(userId, habitId, date, done);
  if (changed) {
    await logActivity(userId, {
      type: done ? 'completed' : 'uncompleted',
      habitId,
      habitName: habit.name,
      date,
    });
  }
  return { ok: true, changed };
}