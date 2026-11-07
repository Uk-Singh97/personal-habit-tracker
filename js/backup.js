/* js/backup.js
   Export and import of one profile's data as a JSON file.

   Export: builds a plain JSON file the user can keep.
   Import: a file chosen by the user is UNTRUSTED. It is parsed, checked and
   cleaned field by field before anything is saved. Bad records are skipped
   and counted; nothing is saved if the file as a whole is not a valid backup. */

import {
  SCHEMA_VERSION,
  getHabits,
  getCompletions,
  replaceUserData,
  generateId,
} from './storage.js';
import { isValidISODate, toISODate } from './dates.js';

export const BACKUP_APP_ID = 'personal-habit-tracker';
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_HABITS = 500;
const MAX_COMPLETIONS = 50000;
const PRIORITIES = ['high', 'medium', 'low']; // same values as PRIORITY_LABELS in ui.js
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // JavaScript getDay(): Sunday = 0

/* ---------- Cleaning helpers ---------- */
function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function timestampOrNow(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
}

function cleanSchedule(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'daily') return { type: 'daily', days: [...ALL_WEEKDAYS] };
  if (raw.type !== 'weekdays' || !Array.isArray(raw.days)) return null;
  const days = [...new Set(raw.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
  return days.length > 0 ? { type: 'weekdays', days } : null;
}

/** Returns a clean habit (without userId) or null if the record is not usable. */
function cleanHabit(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = cleanString(raw.id, 100);
  const name = cleanString(raw.name, 60);
  if (!id || !name) return null;
  if (!PRIORITIES.includes(raw.priority)) return null;
  if (!isValidISODate(raw.startDate)) return null;

  const endDate = raw.endDate === null || raw.endDate === undefined ? null : raw.endDate;
  if (endDate !== null && !isValidISODate(endDate)) return null;

  const schedule = cleanSchedule(raw.schedule);
  if (!schedule) return null;

  const reminder = raw.reminder && typeof raw.reminder === 'object' ? raw.reminder : {};

  return {
    id,
    name,
    description: cleanString(raw.description, 200),
    category: cleanString(raw.category, 40) || 'Other',
    priority: raw.priority,
    startDate: raw.startDate,
    endDate,
    schedule,
    reminder: {
      enabled: reminder.enabled === true,
      time: TIME_PATTERN.test(reminder.time) ? reminder.time : '08:00',
    },
    archived: raw.archived === true,
    createdAt: timestampOrNow(raw.createdAt),
    updatedAt: timestampOrNow(raw.updatedAt),
  };
}

function fail(error) {
  return { ok: false, error };
}

/* ---------- Export ---------- */
export async function buildBackup(profile) {
  const [habits, completions] = await Promise.all([getHabits(profile.id), getCompletions(profile.id)]);
  return {
    app: BACKUP_APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    profile: { displayName: profile.displayName },
habits: habits.filter((item) => item && typeof item === 'object').map(({ userId, ...rest }) => rest),
    completions: completions.filter((item) => item && typeof item === 'object').map(({ userId, ...rest }) => rest),    
  };
}

function backupFilename(profile) {
  const slug = profile.displayName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'profile';
  return `habit-tracker-${slug}-${toISODate()}.json`;
}

/** Downloads the backup file. Returns how many habits and completion records it holds. */
export async function downloadBackup(profile) {
  const backup = await buildBackup(profile);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFilename(profile);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { habits: backup.habits.length, completions: backup.completions.length };
}

/* ---------- Import ---------- */
/** Checks and cleans backup text. Returns { ok: false, error } or { ok: true, habits, completions, ... }.
    Nothing is saved here. */
export function parseBackupText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return fail('This file is not valid JSON, so it cannot be imported.');
  }

  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP_ID) {
    return fail('This file was not exported from Personal Habit Tracker.');
  }
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    return fail('This backup has no valid version number.');
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    return fail('This backup was made by a newer version of the app and cannot be imported.');
  }
  if (!Array.isArray(data.habits) || !Array.isArray(data.completions)) {
    return fail('This backup is missing its habits or completions list.');
  }
  if (data.habits.length > MAX_HABITS || data.completions.length > MAX_COMPLETIONS) {
    return fail('This backup is larger than the app allows.');
  }

  const habits = [];
  const habitIds = new Set();
  const habitNames = new Set();
  let skippedHabits = 0;

  data.habits.forEach((raw) => {
    const habit = cleanHabit(raw);
    const nameKey = habit ? habit.name.toLowerCase() : '';
    if (!habit || habitIds.has(habit.id) || habitNames.has(nameKey)) {
      skippedHabits += 1;
      return;
    }
    habitIds.add(habit.id);
    habitNames.add(nameKey);
    habits.push(habit);
  });

  const completions = [];
  const completionKeys = new Set();
  const completionIds = new Set();
  let skippedCompletions = 0;

  data.completions.forEach((raw) => {
    const valid = raw && typeof raw === 'object' && habitIds.has(raw.habitId) && isValidISODate(raw.date);
    const key = valid ? `${raw.habitId}|${raw.date}` : '';
    if (!valid || completionKeys.has(key)) {
      skippedCompletions += 1;
      return;
    }
    completionKeys.add(key);
    let id = cleanString(raw.id, 100);
    if (!id || completionIds.has(id)) id = generateId('comp');
    completionIds.add(id);
    completions.push({
      id,
      habitId: raw.habitId,
      date: raw.date,
      completedAt: timestampOrNow(raw.completedAt),
    });
  });

  return {
    ok: true,
    habits,
    completions,
    skippedHabits,
    skippedCompletions,
    sourceName: cleanString(data.profile && data.profile.displayName, 24),
  };
}

/** Saves a parsed backup into the given profile, REPLACING its current habits and history. */
export async function applyBackup(profile, parsed) {
  const habits = parsed.habits.map((habit) => ({ ...habit, userId: profile.id }));
  const completions = parsed.completions.map((record) => ({ ...record, userId: profile.id }));
  await replaceUserData(profile.id, habits, completions);
  return { habits: habits.length, completions: completions.length };
}