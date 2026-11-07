/* js/page-habits.js
   Habits page: list, search/filter/sort, create, edit, delete, and tick off today.

   Flow:  click -> this file reads the form / button -> habits.js checks the rules
          and saves through storage.js -> this file reloads the data and redraws.
   Searching, filtering and sorting never change saved data: filters.js builds a
   new, ordered list from the saved habits every time.

   The page never trusts what is on screen: every change is re-read from storage
   and re-checked by habits.js before saving. All user text goes through
   escapeHtml (or textContent) before it is shown. */

import { ready, icon, escapeHtml, showToast, confirmAction, streakLabel, PRIORITY_LABELS } from './ui.js';
import { StorageError, getCompletions } from './storage.js';
import {
  CATEGORIES,
  DEFAULT_REMINDER_TIME,
  listHabits,
  createHabit,
  updateHabit,
  removeHabit,
  setHabitDone,
  countCompletions,
  describeSchedule,
  scheduleMode,
  getHabitStatus,
} from './habits.js';
import { buildIndex, computeStreaks, summariseDay } from './stats.js';
import {
  DEFAULT_CRITERIA,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  SCHEDULE_OPTIONS,
  SORT_OPTIONS,
  applyCriteria,
  categoriesInUse,
  countActiveFilters,
  isDefaultCriteria,
} from './filters.js';
import { formatLongDate, formatShortDate, parseISODate, toISODate } from './dates.js';

const byId = (id) => document.getElementById(id);

const state = {
  profile: null,
  today: '',
  habits: [],
  index: new Map(),
  streaks: new Map(),
  completedToday: new Set(),
  hiddenCount: 0,
  criteria: { ...DEFAULT_CRITERIA },
  visible: [],
  editingId: null,
  saving: false,
};

/* Filter control id -> the field it changes in state.criteria */
const CONTROL_KEYS = {
  'filter-search': 'search',
  'filter-category': 'category',
  'filter-priority': 'priority',
  'filter-status': 'status',
  'filter-schedule': 'schedule',
  'filter-sort': 'sort',
};

/* Form field -> the id used for its error message (<id>-error) */
const ERROR_BASE = {
  name: 'habit-name',
  description: 'habit-description',
  category: 'habit-category',
  priority: 'habit-priority',
  startDate: 'habit-start',
  schedule: 'habit-schedule',
  days: 'habit-days',
  reminderTime: 'habit-reminder-time',
};
const ERROR_ORDER = ['name', 'description', 'category', 'priority', 'startDate', 'schedule', 'days', 'reminderTime'];

/* ---------- Errors ---------- */
function errorText(error) {
  if (error instanceof StorageError) return error.message;
  console.error(error);
  return 'Something went wrong. Please try again.';
}

function handleError(error) {
  showToast(errorText(error), 'error');
}

/* ---------- Filter controls ---------- */
function fillSelect(id, options) {
  byId(id).innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join('');
}

/** Rebuilds the Category dropdown from the categories that habits actually use. */
function syncCategoryOptions() {
  const categories = categoriesInUse(state.habits);
  if (state.criteria.category !== 'all' && !categories.includes(state.criteria.category)) {
    state.criteria.category = 'all'; // the last habit in that category is gone
  }
  fillSelect('filter-category', [
    { value: 'all', label: 'All categories' },
    ...categories.map((category) => ({ value: category, label: category })),
  ]);
  byId('filter-category').value = state.criteria.category;
}

/** Puts the current criteria into the controls (used by Reset). */
function syncControls() {
  Object.entries(CONTROL_KEYS).forEach(([id, key]) => {
    byId(id).value = state.criteria[key];
  });
}

function enableFilterControls() {
  Object.keys(CONTROL_KEYS).forEach((id) => {
    byId(id).disabled = false;
  });
}

function updateFilterSummary() {
  const total = state.habits.length;
  const active = countActiveFilters(state.criteria);
  byId('filter-reset').disabled = isDefaultCriteria(state.criteria);
  if (total === 0) {
    byId('filter-summary').textContent = '';
    return;
  }
  const filters = active > 0 ? ` \u00b7 ${active} ${active === 1 ? 'filter' : 'filters'} on` : '';
  byId('filter-summary').textContent = `Showing ${state.visible.length} of ${total} ${total === 1 ? 'habit' : 'habits'}${filters}`;
}

function resetCriteria() {
  state.criteria = { ...DEFAULT_CRITERIA };
  syncControls();
  render();
  byId('filter-search').focus();
}

/* ---------- Drawing the list ---------- */
function statusInfo(status, habit) {
  switch (status) {
    case 'done':
      return { label: 'Done today', badge: 'badge--done', iconName: 'check' };
    case 'pending':
      return { label: 'Not done yet', badge: 'badge--pending', iconName: 'clock' };
    case 'rest':
      return { label: 'Not scheduled today', badge: 'badge--pending', iconName: 'calendar' };
    case 'upcoming':
      return { label: `Starts ${formatShortDate(habit.startDate)}`, badge: 'badge--pending', iconName: 'clock' };
    default:
      return { label: `Ended ${formatShortDate(habit.endDate)}`, badge: 'badge--pending', iconName: 'x' };
  }
}

function renderHabit(habit) {
  const done = state.completedToday.has(habit.id);
  const status = getHabitStatus(habit, state.today, done);
  const info = statusInfo(status, habit);
  const name = escapeHtml(habit.name);
  const id = escapeHtml(habit.id);
  const canToggle = status === 'done' || status === 'pending';
  const streak = state.streaks.get(habit.id) || { current: 0, best: 0 };

  const lead = canToggle
    ? `<button class="habit-toggle" type="button" data-action="toggle" data-id="${id}" aria-pressed="${done}" aria-label="Done today: ${name}">${icon('check', 20)}</button>`
    : `<span class="habit-item__status">${icon(info.iconName, 18)}</span>`;

  const description = typeof habit.description === 'string' && habit.description
    ? `<p class="habit-item__description">${escapeHtml(habit.description)}</p>`
    : '';

  const reminder = habit.reminder && habit.reminder.enabled === true
    ? `<span class="habit-item__detail">${icon('bell', 14)}${escapeHtml(String(habit.reminder.time))}</span>`
    : '';

  const best = streak.best > 0
    ? `<span class="habit-item__detail">Best: ${streak.best} ${streak.best === 1 ? 'day' : 'days'}</span>`
    : '';

  return `<li class="habit-item" data-done="${done}">
    ${lead}
    <div>
      <p class="habit-item__name">${name}</p>
      ${description}
      <div class="habit-item__meta">
        <span class="badge badge--category">${escapeHtml(habit.category)}</span>
        <span class="badge badge--${habit.priority}">${PRIORITY_LABELS[habit.priority]} priority</span>
        <span>${escapeHtml(describeSchedule(habit.schedule))}</span>
        <span>From ${escapeHtml(formatShortDate(habit.startDate))}</span>
        <span class="habit-item__streak">${icon('flame', 14)}${escapeHtml(streakLabel(streak.current))}</span>
        ${best}
        ${reminder}
      </div>
    </div>
    <div class="habit-item__trailing">
      <span class="badge ${info.badge}">${escapeHtml(info.label)}</span>
      <button class="btn btn--ghost btn--sm" type="button" data-action="edit" data-id="${id}" aria-label="Edit habit: ${name}">Edit</button>
      <button class="btn btn--ghost btn--sm" type="button" data-action="delete" data-id="${id}" aria-label="Delete habit: ${name}">Delete</button>
    </div>
  </li>`;
}

function emptyStateMarkup() {
  return `<div class="empty-state">
    <span class="empty-state__icon">${icon('target', 28)}</span>
    <h3 class="empty-state__title">No habits yet</h3>
    <p class="empty-state__text">Habits you create will be listed here, with today's progress. Start with one small habit you can do on most days.</p>
    <button class="btn btn--primary" type="button" data-action="new">${icon('plus', 18)}New habit</button>
  </div>`;
}

function noMatchMarkup() {
  return `<div class="empty-state">
    <span class="empty-state__icon">${icon('search', 28)}</span>
    <h3 class="empty-state__title">No habits match</h3>
    <p class="empty-state__text">None of your habits match the current search and filters. Try different words, or reset everything to see all your habits again.</p>
    <button class="btn btn--primary" type="button" data-action="reset">Reset all</button>
  </div>`;
}

function updateSummary() {
  const total = state.habits.length;
  const day = summariseDay(state.habits, state.index, state.today, state.today);
  const parts = [
    `${total} ${total === 1 ? 'habit' : 'habits'}`,
    total > 0 ? (day.scheduled === 0 ? 'nothing scheduled today' : `${day.completed} of ${day.scheduled} scheduled today done`) : null,
    formatLongDate(parseISODate(state.today)),
  ].filter(Boolean);
  byId('habit-count').textContent = parts.join(' \u00b7 ');
}

function render() {
  state.visible = applyCriteria(state.habits, state.criteria, state.completedToday, state.today);
  updateSummary();
  updateFilterSummary();

  const hiddenNotice = state.hiddenCount > 0
    ? `<div class="notice notice--warning" role="status">${icon('info', 18)}<span>${state.hiddenCount} saved ${state.hiddenCount === 1 ? 'record is' : 'records are'} damaged and hidden. ${state.hiddenCount === 1 ? 'It has' : 'They have'} not been deleted or changed.</span></div>`
    : '';

  let content;
  if (state.habits.length === 0) {
    content = emptyStateMarkup();
  } else if (state.visible.length === 0) {
    content = noMatchMarkup();
  } else {
    content = `<ul class="habit-list" aria-label="Your habits">${state.visible.map(renderHabit).join('')}</ul>`;
  }

  byId('habit-list-region').innerHTML = `<div class="stack stack--sm">${hiddenNotice}${content}</div>`;
}

/** Reloads from storage and redraws. `focus` = { action, id } puts keyboard focus on a button afterwards. */
async function refresh(focus = null) {
  const userId = state.profile.id;
  const [list, completions] = await Promise.all([listHabits(userId), getCompletions(userId)]);
  state.today = toISODate();
  state.habits = list.habits;
  state.hiddenCount = list.hiddenCount;
  state.index = buildIndex(completions);
  state.streaks = computeStreaks(list.habits, state.index, state.today);
  state.completedToday = new Set(
    list.habits
      .filter((habit) => {
        const dates = state.index.get(habit.id);
        return Boolean(dates && dates.has(state.today));
      })
      .map((habit) => habit.id),
  );
  syncCategoryOptions();
  render();

  if (focus) {
    const target = [...byId('habit-list-region').querySelectorAll(`[data-action="${focus.action}"]`)]
      .find((element) => element.dataset.id === focus.id);
    if (target) target.focus();
  }
}

/* ---------- Form helpers ---------- */
function clearErrors() {
  const form = byId('habit-form');
  form.querySelectorAll('.field__error').forEach((element) => {
    element.hidden = true;
    element.textContent = '';
  });
  form.querySelectorAll('[aria-invalid]').forEach((element) => element.removeAttribute('aria-invalid'));
  const message = byId('form-message');
  message.hidden = true;
  message.textContent = '';
}

function clearFieldError(target) {
  const base = target.name === 'days' ? 'habit-days' : target.id;
  const error = base ? byId(`${base}-error`) : null;
  if (error && error.classList.contains('field__error')) {
    error.hidden = true;
    error.textContent = '';
  }
  if (target.id) target.removeAttribute('aria-invalid');
}

function showErrors(errors) {
  const form = byId('habit-form');
  let firstControl = null;
  ERROR_ORDER.forEach((key) => {
    const message = errors[key];
    if (!message) return;
    const base = ERROR_BASE[key];
    const errorElement = byId(`${base}-error`);
    errorElement.textContent = message;
    errorElement.hidden = false;
    if (key === 'days') {
      if (!firstControl) firstControl = form.querySelector('input[name="days"]');
    } else {
      const control = byId(base);
      control.setAttribute('aria-invalid', 'true');
      if (!firstControl) firstControl = control;
    }
  });
  if (firstControl) firstControl.focus();
}

/* Errors inside the open dialog are shown inside it, because a toast would be hidden behind the modal. */
function showFormMessage(text) {
  const message = byId('form-message');
  message.textContent = text;
  message.hidden = false;
}

function fillCategories(extraCategory = '') {
  const list = extraCategory && !CATEGORIES.includes(extraCategory)
    ? [...CATEGORIES, extraCategory]
    : CATEGORIES;
  byId('habit-category').innerHTML = list
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join('');
}

function syncFormState() {
  byId('weekday-field').hidden = byId('habit-schedule').value !== 'custom';
  byId('habit-reminder-time').disabled = !byId('habit-reminder').checked;
}

function resetForm(extraCategory = '') {
  clearErrors();
  fillCategories(extraCategory);
  byId('habit-form').reset();
  byId('habit-start').value = toISODate();
  syncFormState();
}

function readForm() {
  const form = byId('habit-form');
  return {
    name: byId('habit-name').value,
    description: byId('habit-description').value,
    category: byId('habit-category').value,
    priority: byId('habit-priority').value,
    startDate: byId('habit-start').value,
    scheduleMode: byId('habit-schedule').value,
    days: [...form.querySelectorAll('input[name="days"]:checked')].map((box) => Number(box.value)),
    reminderEnabled: byId('habit-reminder').checked,
    reminderTime: byId('habit-reminder-time').value,
  };
}

/* ---------- Opening the form ---------- */
function openCreate() {
  resetForm();
  state.editingId = null;
  byId('habit-dialog-title').textContent = 'New habit';
  byId('habit-submit').textContent = 'Save habit';
  byId('habit-dialog').showModal();
  byId('habit-name').focus();
}

function openEdit(habit) {
  resetForm(habit.category);
  state.editingId = habit.id;
  byId('habit-dialog-title').textContent = 'Edit habit';
  byId('habit-submit').textContent = 'Save changes';

  byId('habit-name').value = habit.name;
  byId('habit-description').value = typeof habit.description === 'string' ? habit.description : '';
  byId('habit-category').value = habit.category;
  byId('habit-priority').value = habit.priority;
  byId('habit-start').value = habit.startDate;
  byId('habit-schedule').value = scheduleMode(habit.schedule);
  byId('habit-form').querySelectorAll('input[name="days"]').forEach((box) => {
    box.checked = habit.schedule.days.includes(Number(box.value));
  });

  const reminder = habit.reminder && typeof habit.reminder === 'object' ? habit.reminder : {};
  byId('habit-reminder').checked = reminder.enabled === true;
  byId('habit-reminder-time').value = /^\d{2}:\d{2}$/.test(String(reminder.time)) ? reminder.time : DEFAULT_REMINDER_TIME;

  syncFormState();
  byId('habit-dialog').showModal();
  byId('habit-name').focus();
}

/* ---------- Saving ---------- */
async function handleSubmit(event) {
  event.preventDefault();
  if (state.saving) return;
  clearErrors();

  const dialog = byId('habit-dialog');
  const submit = byId('habit-submit');
  const wasEditing = Boolean(state.editingId);
  const input = readForm();

  state.saving = true;
  submit.disabled = true;
  try {
    const result = wasEditing
      ? await updateHabit(state.profile.id, state.editingId, input)
      : await createHabit(state.profile.id, input);

    if (!result.ok) {
      if (result.errors) {
        showErrors(result.errors);
      } else {
        dialog.close();
        showToast(result.message, 'error');
        await refresh();
      }
      return;
    }

    dialog.close();
    await refresh({ action: 'edit', id: result.habit.id });

    if (result.unchanged) {
      showToast('No changes to save.', 'info');
      return;
    }
    const base = wasEditing
      ? `Changes to "${result.habit.name}" saved.`
      : `Habit "${result.habit.name}" created.`;
    const isVisible = state.visible.some((habit) => habit.id === result.habit.id);
    showToast(isVisible ? base : `${base} It is hidden by your current filters.`, 'success');
  } catch (error) {
    showFormMessage(`${errorText(error)} Your existing data was not changed.`);
  } finally {
    state.saving = false;
    submit.disabled = false;
  }
}

/* ---------- Tick off today ---------- */
async function toggleHabit(button, habit) {
  if (toISODate() !== state.today) {
    try {
      await refresh();
      showToast('The date has changed, so the list was refreshed for the new day.', 'warning');
    } catch (error) {
      handleError(error);
    }
    return;
  }

  const wantDone = !state.completedToday.has(habit.id);
  button.disabled = true;
  try {
    const result = await setHabitDone(state.profile.id, habit.id, state.today, wantDone);
    if (!result.ok) {
      await refresh();
      showToast(result.message, 'error');
      return;
    }
    await refresh({ action: 'toggle', id: habit.id });
    if (result.changed) {
      showToast(
        wantDone ? `"${habit.name}" marked done for today.` : `"${habit.name}" marked not done.`,
        'success',
      );
    } else {
      showToast('That habit was already up to date.', 'info');
    }
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
  }
}

/* ---------- Delete ---------- */
async function deleteFlow(habit) {
  try {
    const count = await countCompletions(state.profile.id, habit.id);
    const records = count > 0
      ? ` and its ${count} completion ${count === 1 ? 'record' : 'records'}`
      : '';
    const confirmed = await confirmAction({
      title: `Delete "${habit.name}"?`,
      message: `This permanently deletes the habit${records} from this profile. This cannot be undone.`,
      confirmLabel: 'Delete habit',
      danger: true,
    });
    if (!confirmed) return;

    const result = await removeHabit(state.profile.id, habit.id);
    await refresh();
    if (!result.ok) {
      showToast(result.message, 'error');
      return;
    }
    showToast(`Habit "${habit.name}" deleted.`, 'success');
    byId('new-habit-button').focus();
  } catch (error) {
    handleError(error);
  }
}

/* ---------- Start ---------- */
function bindEvents() {
  const dialog = byId('habit-dialog');
  const form = byId('habit-form');

  byId('new-habit-button').addEventListener('click', openCreate);

  byId('habit-list-region').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'new') {
      openCreate();
      return;
    }
    if (button.dataset.action === 'reset') {
      resetCriteria();
      return;
    }
    const habit = state.habits.find((item) => item.id === button.dataset.id);
    if (!habit) return;
    if (button.dataset.action === 'toggle') toggleHabit(button, habit);
    if (button.dataset.action === 'edit') openEdit(habit);
    if (button.dataset.action === 'delete') deleteFlow(habit);
  });

  // Search updates as you type; the dropdowns update when you choose a value.
  byId('filter-search').addEventListener('input', (event) => {
    state.criteria.search = event.target.value;
    render();
  });
  Object.entries(CONTROL_KEYS).forEach(([id, key]) => {
    if (id === 'filter-search') return;
    byId(id).addEventListener('change', (event) => {
      state.criteria[key] = event.target.value;
      render();
    });
  });
  byId('filter-reset').addEventListener('click', resetCriteria);

  form.addEventListener('submit', handleSubmit);
  byId('habit-schedule').addEventListener('change', syncFormState);
  byId('habit-reminder').addEventListener('change', syncFormState);
  form.addEventListener('input', (event) => clearFieldError(event.target));
  form.addEventListener('change', (event) => clearFieldError(event.target));

  // Clicking the dimmed area must not close the form and lose what was typed.
  // (Stopping the click here keeps ui.js from closing it. Cancel, X and Esc still work.)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) event.stopPropagation();
  });

  dialog.addEventListener('close', () => {
    state.editingId = null;
    clearErrors();
  });

  // If the tab was left open past midnight, refresh for the new day when the user returns.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !state.profile) return;
    if (toISODate() === state.today || dialog.open) return;
    try {
      await refresh();
    } catch (error) {
      handleError(error);
    }
  });
}

async function start() {
  const region = byId('habit-list-region');
  try {
    state.profile = await ready;

    if (!state.profile) {
      byId('habit-count').textContent = 'Habits are not available.';
      region.innerHTML = '<p class="card__subtitle">Your habits could not be loaded. If you were not sent to the start page, see the message at the top of this page.</p>';
      return;
    }

    fillSelect('filter-priority', PRIORITY_OPTIONS);
    fillSelect('filter-status', STATUS_OPTIONS);
    fillSelect('filter-schedule', SCHEDULE_OPTIONS);
    fillSelect('filter-sort', SORT_OPTIONS);
    syncControls();

    bindEvents();
    await refresh();
    enableFilterControls();
    byId('new-habit-button').disabled = false;
  } catch (error) {
    const detail = error instanceof StorageError ? '' : ` Technical detail: ${error && error.message ? error.message : String(error)}`;
    byId('habit-count').textContent = 'Habits could not be loaded.';
    region.innerHTML = `<div class="notice notice--warning" role="alert">${icon('info', 18)}<span>${escapeHtml(errorText(error))}${escapeHtml(detail)} Your data has not been changed.</span></div>`;
  }
}

start();