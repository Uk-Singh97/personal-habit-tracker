/* js/storage.js
   The ONLY file that reads or writes the app's data in the browser (localStorage).
   Every other file calls the functions below instead of touching localStorage.
   (The theme code in theme-init.js and ui.js is the one older exception.)

   PROTOTYPE LIMITS: localStorage is not secure. Anyone using this browser can
   read or edit it in DevTools. It is per-browser (no sync between devices) and
   it is erased if the user clears site data. Two tabs writing at once is
   "last write wins".

   All functions are async (they return Promises) even though localStorage is
   synchronous. A hosted database would also be async, so a future swap would
   only need this file to change. */

const PREFIX = 'habitTracker:';

/** Increase this if the shape of saved data ever changes (a migration would be needed). */
export const SCHEMA_VERSION = 1;

/** The activity log keeps only the newest entries so it cannot grow without limit. */
export const ACTIVITY_LIMIT = 200;

const KEYS = {
  schema: `${PREFIX}schemaVersion`,
  profiles: `${PREFIX}profiles`,
  activeProfile: `${PREFIX}activeProfile`,
  theme: `${PREFIX}theme`, // written by ui.js and theme-init.js; listed here so "erase all" keeps it
};

function userKey(userId, name) {
  return `${PREFIX}${userId}:${name}`;
}

/* ---------- Errors ---------- */
export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorageError';
    this.code = code; // 'blocked' | 'quota' | 'corrupt' | 'newer'
  }
}

const BLOCKED_MESSAGE = 'This browser is blocking storage (private mode or strict privacy settings?), so profiles and habits cannot be saved.';

/* ---------- Low-level helpers (private) ---------- */
function rawGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    throw new StorageError('blocked', BLOCKED_MESSAGE);
  }
}

function rawSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    const isQuota = error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    throw isQuota
      ? new StorageError('quota', 'Browser storage is full, so the change was not saved.')
      : new StorageError('blocked', BLOCKED_MESSAGE);
  }
}

function rawRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    throw new StorageError('blocked', BLOCKED_MESSAGE);
  }
}

async function readJSON(key, fallback) {
  const text = rawGet(key);
  if (text === null) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StorageError('corrupt', 'Some saved data in this browser is damaged and cannot be read.');
  }
}

async function writeJSON(key, value) {
  rawSet(key, JSON.stringify(value));
}

async function readArray(key, label) {
  const data = await readJSON(key, []);
  if (!Array.isArray(data)) {
    throw new StorageError('corrupt', `The saved ${label} are damaged and cannot be read.`);
  }
  return data;
}

/* ---------- IDs ---------- */
/** Creates a unique id such as "user_3f2a..." or "habit_9c1b...". */
export function generateId(prefix) {
  const unique = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${unique}`;
}

/* ---------- Start-up check ---------- */
/** Call once per page. Records the data version, or refuses data from a newer app. */
export async function initStorage() {
  const stored = rawGet(KEYS.schema);
  if (stored === null) {
    rawSet(KEYS.schema, String(SCHEMA_VERSION));
    return;
  }
  const version = Number(stored);
  if (!Number.isInteger(version)) {
    throw new StorageError('corrupt', 'The saved data version is damaged.');
  }
  if (version > SCHEMA_VERSION) {
    throw new StorageError('newer', 'Saved data in this browser was made by a newer version of the app, so it was not opened.');
  }
}

/* ---------- Profiles ---------- */
export async function getProfiles() {
  const data = await readJSON(KEYS.profiles, []);
  if (!Array.isArray(data)) {
    throw new StorageError('corrupt', 'The saved profile list is damaged and cannot be read.');
  }
  return data.filter((profile) => profile && typeof profile.id === 'string' && typeof profile.displayName === 'string');
}

export async function saveProfiles(profiles) {
  await writeJSON(KEYS.profiles, profiles);
}

export async function getActiveProfileId() {
  return rawGet(KEYS.activeProfile) || null;
}

export async function setActiveProfileId(userId) {
  if (userId) {
    rawSet(KEYS.activeProfile, userId);
  } else {
    rawRemove(KEYS.activeProfile);
  }
}

/* ---------- Habits and completions (one profile = one userId) ---------- */
export async function getHabits(userId) {
  return readArray(userKey(userId, 'habits'), 'habits');
}

export async function getCompletions(userId) {
  return readArray(userKey(userId, 'completions'), 'completion records');
}

/** Adds a habit, or replaces the habit with the same id. The habit must contain userId. */
export async function saveHabit(habit) {
  const habits = await getHabits(habit.userId);
  const index = habits.findIndex((item) => item && item.id === habit.id);
  if (index === -1) {
    habits.push(habit);
  } else {
    habits[index] = habit;
  }
  await writeJSON(userKey(habit.userId, 'habits'), habits);
  return habit;
}

/** Deletes a habit AND all of its completion records. */
export async function deleteHabit(userId, habitId) {
  const habits = await getHabits(userId);
  const completions = await getCompletions(userId);
  await writeUserData(
    userId,
    habits.filter((habit) => !habit || habit.id !== habitId),
    completions.filter((record) => !record || record.habitId !== habitId),
  );
}

/** Marks a habit done (done = true) or not done (done = false) on one date ("YYYY-MM-DD").
    Returns true if something changed. */
export async function setCompletion(userId, habitId, date, done) {
  const completions = await getCompletions(userId);
  const index = completions.findIndex((record) => record && record.habitId === habitId && record.date === date);
  if (done && index === -1) {
    completions.push({
      id: generateId('comp'),
      habitId,
      userId,
      date,
      completedAt: new Date().toISOString(),
    });
  } else if (!done && index !== -1) {
    completions.splice(index, 1);
  } else {
    return false;
  }
  await writeJSON(userKey(userId, 'completions'), completions);
  return true;
}

/* Writes habits and completions together. If the second write fails, the first is undone. */
async function writeUserData(userId, habits, completions) {
  const habitsKey = userKey(userId, 'habits');
  const completionsKey = userKey(userId, 'completions');
  const oldHabits = rawGet(habitsKey);
  const oldCompletions = rawGet(completionsKey);
  try {
    rawSet(habitsKey, JSON.stringify(habits));
    rawSet(completionsKey, JSON.stringify(completions));
  } catch (error) {
    restoreRaw(habitsKey, oldHabits);
    restoreRaw(completionsKey, oldCompletions);
    throw error;
  }
}

function restoreRaw(key, oldValue) {
  try {
    if (oldValue === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, oldValue);
    }
  } catch (error) {
    /* Nothing more can be done if storage is failing. */
  }
}

/** Replaces ALL of one profile's habits and completions (used by Import). */
export async function replaceUserData(userId, habits, completions) {
  await writeUserData(userId, habits, completions);
}

/** Removes ALL of one profile's habits, completions, activity log and reminder log. */
export async function deleteUserData(userId) {
  rawRemove(userKey(userId, 'habits'));
  rawRemove(userKey(userId, 'completions'));
  rawRemove(userKey(userId, 'activity'));
  rawRemove(userKey(userId, 'reminderLog'));
}

/* ---------- Activity log (added in Phase 5) ----------
   One entry per real user action: { id, at, type, habitId, habitName, date?, detail? }.
   type is 'created' | 'updated' | 'completed' | 'uncompleted' | 'deleted'.
   Only the newest ACTIVITY_LIMIT entries are kept. */
export async function getActivity(userId) {
  return readArray(userKey(userId, 'activity'), 'activity entries');
}

export async function addActivity(userId, entry) {
  const log = await getActivity(userId);
  log.push({ ...entry, id: generateId('act'), at: new Date().toISOString() });
  const trimmed = log.length > ACTIVITY_LIMIT ? log.slice(log.length - ACTIVITY_LIMIT) : log;
  await writeJSON(userKey(userId, 'activity'), trimmed);
}

/* ---------- Reminder log (added in Phase 5) ----------
   Remembers which reminders were already shown today, so each fires once per day.
   Shape: { date: "YYYY-MM-DD", habitIds: [...] } */
export async function getReminderLog(userId) {
  const empty = { date: '', habitIds: [] };
  let data;
  try {
    data = await readJSON(userKey(userId, 'reminderLog'), null);
  } catch (error) {
    if (error instanceof StorageError && error.code === 'corrupt') return empty;
    throw error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
  if (typeof data.date !== 'string' || !Array.isArray(data.habitIds)) return empty;
  return { date: data.date, habitIds: data.habitIds.filter((id) => typeof id === 'string') };
}

export async function saveReminderLog(userId, log) {
  await writeJSON(userKey(userId, 'reminderLog'), log);
}

/** Removes every key this app created, except the theme choice. Used to recover from damaged data. */
export async function clearAllAppData() {
  const keysToRemove = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX) && key !== KEYS.theme) keysToRemove.push(key);
    }
  } catch (error) {
    throw new StorageError('blocked', BLOCKED_MESSAGE);
  }
  keysToRemove.forEach((key) => rawRemove(key));
}