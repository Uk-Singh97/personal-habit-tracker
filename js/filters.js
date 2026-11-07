/* js/filters.js
   Search, filter and sort for the Habits list. Pure functions: they take the
   list and the chosen options and return a new, ordered list. Nothing is saved
   and the page is never touched here. */

import { getHabitStatus } from './habits.js';

/** The "nothing chosen" state. Used for the starting values and for Reset. */
export const DEFAULT_CRITERIA = Object.freeze({
  search: '',
  category: 'all',
  priority: 'all',
  status: 'all',
  schedule: 'all',
  sort: 'name',
});

/* Options for the dropdowns (value = what is stored, label = what the user reads). */
export const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Not done yet today' },
  { value: 'done', label: 'Done today' },
  { value: 'rest', label: 'Not scheduled today' },
  { value: 'upcoming', label: 'Not started yet' },
  { value: 'ended', label: 'Ended' },
];

export const SCHEDULE_OPTIONS = [
  { value: 'all', label: 'All schedules' },
  { value: 'daily', label: 'Every day' },
  { value: 'workdays', label: 'Mon to Fri' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'custom', label: 'Other custom days' },
];

export const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A to Z)' },
  { value: 'priority', label: 'Priority (high first)' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'status', label: 'Completion status' },
];

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
// Habits that still need doing come first, then finished ones, then the rest.
const STATUS_RANK = { pending: 0, done: 1, rest: 2, upcoming: 3, ended: 4 };

/* ---------- Helpers ---------- */
function sameDays(days, expected) {
  const set = new Set(days);
  return set.size === expected.length && expected.every((day) => set.has(day));
}

/** Which schedule filter a habit belongs to: 'daily' | 'workdays' | 'weekends' | 'custom'. */
export function scheduleKind(schedule) {
  if (new Set(schedule.days).size === 7) return 'daily';
  if (sameDays(schedule.days, [1, 2, 3, 4, 5])) return 'workdays';
  if (sameDays(schedule.days, [6, 0])) return 'weekends';
  return 'custom';
}

function normaliseSearch(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function createdTime(habit) {
  const time = Date.parse(habit.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

/** The categories that at least one habit uses, sorted (for the Category dropdown). */
export function categoriesInUse(habits) {
  return [...new Set(habits.map((habit) => habit.category))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** How many of search / category / priority / status / schedule are set (sorting is not counted). */
export function countActiveFilters(criteria) {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  return [
    normaliseSearch(c.search) !== '',
    c.category !== 'all',
    c.priority !== 'all',
    c.status !== 'all',
    c.schedule !== 'all',
  ].filter(Boolean).length;
}

/** True when everything, including the sort order, is at its starting value. */
export function isDefaultCriteria(criteria) {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  return countActiveFilters(c) === 0 && c.sort === DEFAULT_CRITERIA.sort;
}

/* ---------- The main function ---------- */
/** Returns the habits that match every chosen option, in the chosen order.
    Search matches the name or the description; several words must ALL appear.
    completedToday: Set of habit ids done today. today: "YYYY-MM-DD". */
export function applyCriteria(habits, criteria, completedToday, today) {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  const terms = normaliseSearch(c.search).split(' ').filter(Boolean);
  const statusOf = (habit) => getHabitStatus(habit, today, completedToday.has(habit.id));

  const matches = habits.filter((habit) => {
    if (terms.length > 0) {
      const text = `${habit.name} ${typeof habit.description === 'string' ? habit.description : ''}`.toLowerCase();
      if (!terms.every((term) => text.includes(term))) return false;
    }
    if (c.category !== 'all' && habit.category !== c.category) return false;
    if (c.priority !== 'all' && habit.priority !== c.priority) return false;
    if (c.status !== 'all' && statusOf(habit) !== c.status) return false;
    if (c.schedule !== 'all' && scheduleKind(habit.schedule) !== c.schedule) return false;
    return true;
  });

  // Every sort falls back to the name, so the order is always predictable.
  const comparators = {
    name: byName,
    priority: (a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || byName(a, b),
    newest: (a, b) => (createdTime(b) - createdTime(a)) || byName(a, b),
    oldest: (a, b) => (createdTime(a) - createdTime(b)) || byName(a, b),
    status: (a, b) => (STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)]) || byName(a, b),
  };
  return matches.sort(comparators[c.sort] || byName);
}