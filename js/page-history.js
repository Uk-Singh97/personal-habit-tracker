/* js/page-history.js
   History page: a month calendar plus a detail panel for the chosen day.

   Flow:  storage.js (read)  ->  stats.js (calculate)  ->  this file (draw).
   Ticking a habit on a day goes through habits.js (same rules as everywhere:
   scheduled days only, never a future date; undoing is always allowed), then
   everything is reloaded and redrawn so the calendar and panel always agree.

   Dates are local "YYYY-MM-DD" text, so the day you tick is the day you see. */

import { ready, icon, escapeHtml, showToast, renderEmptyState, PRIORITY_LABELS } from './ui.js';
import { StorageError, getCompletions } from './storage.js';
import { listHabits, setHabitDone, describeSchedule, MIN_DATE, MAX_DATE } from './habits.js';
import { buildIndex, summariseDay, summariseMonth, dayDetail } from './stats.js';
import {
  addDays,
  formatLongDate,
  formatMonthYear,
  formatShortDate,
  parseISODate,
  shiftMonth,
  toISODate,
  WEEKDAY_NAMES,
} from './dates.js';

const byId = (id) => document.getElementById(id);
const HEADERS = [1, 2, 3, 4, 5, 6, 0].map((day) => WEEKDAY_NAMES[day]); // Monday first

const monthKey = (year, monthIndex) => year * 12 + monthIndex;
const MIN_KEY = monthKey(parseISODate(MIN_DATE).getFullYear(), parseISODate(MIN_DATE).getMonth());
const MAX_KEY = monthKey(parseISODate(MAX_DATE).getFullYear(), parseISODate(MAX_DATE).getMonth());

const state = {
  profile: null,
  today: '',
  habits: [],
  hiddenCount: 0,
  index: new Map(),
  view: { year: 0, monthIndex: 0 },
  selected: '',
  month: null,
};

function errorText(error) {
  if (error instanceof StorageError) return error.message;
  console.error(error);
  return 'Something went wrong. Please try again.';
}

function viewOf(date) {
  const parsed = parseISODate(date);
  return { year: parsed.getFullYear(), monthIndex: parsed.getMonth() };
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/* ---------- Loading ---------- */
async function load() {
  const userId = state.profile.id;
  const [list, completions] = await Promise.all([listHabits(userId), getCompletions(userId)]);
  state.today = toISODate();
  state.habits = list.habits;
  state.hiddenCount = list.hiddenCount;
  state.index = buildIndex(completions);
  state.month = summariseMonth(state.habits, state.index, state.view.year, state.view.monthIndex, state.today);
}

/* ---------- Month controls and summary ---------- */
function renderControls() {
  byId('month-label').textContent = formatMonthYear(state.view.year, state.view.monthIndex);
  const key = monthKey(state.view.year, state.view.monthIndex);
  byId('prev-month').disabled = key <= MIN_KEY;
  byId('next-month').disabled = key >= MAX_KEY;
  byId('goto-date').value = state.selected;
}

function renderSummary() {
  const m = state.month;
  const percent = m.percent === null ? '\u2013' : `${m.percent}%`;
  let note = 'Figures count days up to and including today.';
  if (m.monthStart > state.today) note = 'This month has not started yet, so there are no figures.';
  else if (m.scheduled === 0) note = 'No habits were scheduled in this month up to today.';

  byId('month-summary').innerHTML = `<ul class="figure-list figure-list--four">
      <li><span class="figure__value">${percent}</span><span class="figure__label">Completion</span></li>
      <li><span class="figure__value">${m.scheduled}</span><span class="figure__label">Scheduled</span></li>
      <li><span class="figure__value">${m.completed}</span><span class="figure__label">Completed</span></li>
      <li><span class="figure__value">${m.missed}</span><span class="figure__label">Missed</span></li>
    </ul>
    <p class="card__subtitle section-gap">${escapeHtml(note)}</p>`;
}

/* ---------- Calendar ---------- */
function dayClass(day) {
  if (day.isFuture) return 'cal-day--future';
  if (day.scheduled === 0) return 'cal-day--none';
  if (day.completed === day.scheduled) return 'cal-day--full';
  if (day.completed > 0) return 'cal-day--partial';
  return day.isToday ? 'cal-day--pending' : 'cal-day--missed';
}

function dayLabel(day) {
  const dateText = formatLongDate(parseISODate(day.date));
  let status;
  if (day.scheduled === 0) status = 'nothing scheduled';
  else if (day.isFuture) status = `${plural(day.scheduled, 'habit', 'habits')} scheduled`;
  else status = `${day.completed} of ${day.scheduled} done`;
  return `${dateText}: ${status}${day.isToday ? ' (today)' : ''}`;
}

function renderCalendar() {
  const m = state.month;
  const hasSelected = m.days.some((day) => day.date === state.selected);
  const headers = HEADERS.map((name) => `<span class="calendar__weekday" aria-hidden="true">${name}</span>`).join('');
  const blanks = '<span class="cal-blank" aria-hidden="true"></span>'.repeat(m.leadingBlanks);

  const cells = m.days.map((day, position) => {
    const selected = day.date === state.selected;
    const focusable = selected || (!hasSelected && position === 0);
    const count = !day.isFuture && day.scheduled > 0 ? `${day.completed}/${day.scheduled}` : '';
    return `<button class="cal-day ${dayClass(day)}${day.isToday ? ' cal-day--today' : ''}" type="button" data-date="${day.date}" aria-pressed="${selected}"${day.isToday ? ' aria-current="date"' : ''} tabindex="${focusable ? 0 : -1}" aria-label="${escapeHtml(dayLabel(day))}"><span class="cal-day__num">${day.day}</span><span class="cal-day__count">${count}</span></button>`;
  }).join('');

  const calendar = byId('calendar');
  calendar.setAttribute('aria-label', `Calendar for ${formatMonthYear(state.view.year, state.view.monthIndex)}`);
  calendar.innerHTML = headers + blanks + cells;
}

function focusDay(date) {
  const button = byId('calendar').querySelector(`[data-date="${date}"]`);
  if (button) button.focus();
}

/* ---------- Day details ---------- */
function renderRow(row) {
  const { habit, status, scheduled } = row;
  const name = escapeHtml(habit.name);
  const id = escapeHtml(habit.id);
  const dateText = escapeHtml(formatShortDate(state.selected));
  const done = status === 'done';
  const canToggle = done || status === 'missed' || status === 'pending';

  let badgeClass = 'badge--pending';
  let badgeText = 'Scheduled';
  if (done) {
    badgeClass = scheduled ? 'badge--done' : 'badge--pending';
    badgeText = scheduled ? 'Done' : 'Done, not counted';
  } else if (status === 'missed') {
    badgeClass = 'badge--missed';
    badgeText = 'Missed';
  } else if (status === 'pending') {
    badgeText = 'Not done yet';
  }

  const lead = canToggle
    ? `<button class="habit-toggle" type="button" data-action="toggle" data-id="${id}" aria-pressed="${done}" aria-label="Done on ${dateText}: ${name}">${icon('check', 20)}</button>`
    : `<span class="habit-item__status">${icon('calendar', 18)}</span>`;

  const note = done && !scheduled
    ? '<p class="habit-item__description">This habit is not scheduled on this weekday (its schedule may have changed), so this completion is not counted. You can undo it.</p>'
    : '';

  return `<li class="habit-item" data-done="${done}">
    ${lead}
    <div>
      <p class="habit-item__name">${name}</p>
      ${note}
      <div class="habit-item__meta">
        <span class="badge badge--category">${escapeHtml(habit.category)}</span>
        <span class="badge badge--${habit.priority}">${PRIORITY_LABELS[habit.priority]} priority</span>
        <span>${escapeHtml(describeSchedule(habit.schedule))}</span>
      </div>
    </div>
    <div class="habit-item__trailing"><span class="badge ${badgeClass}">${badgeText}</span></div>
  </li>`;
}

function renderDetail() {
  const date = state.selected;
  const day = summariseDay(state.habits, state.index, date, state.today);
  const rows = dayDetail(state.habits, state.index, date, state.today);
  const shown = rows.filter((row) => row.relevant);
  const notScheduled = rows.length - shown.length;

  let tag = '';
  if (day.isToday) tag = '<span class="badge badge--category">Today</span>';
  else if (day.isFuture) tag = '<span class="badge badge--pending">Not due yet</span>';

  let summary;
  if (day.scheduled === 0) {
    summary = day.isFuture ? 'Nothing is scheduled on this day.' : 'Nothing was scheduled on this day.';
  } else if (day.isFuture) {
    summary = `${plural(day.scheduled, 'habit is', 'habits are')} scheduled. Future days cannot be ticked.`;
  } else {
    const share = day.percent === null ? '' : ` (${day.percent}%)`;
    summary = `${day.completed} of ${plural(day.scheduled, 'scheduled habit', 'scheduled habits')} done${share}.`;
  }

  let body;
  if (shown.length === 0) {
    body = renderEmptyState({
      icon: 'calendar',
      title: 'No habits on this day',
      text: day.isFuture ? 'None of your habits are scheduled on this day.' : 'None of your habits were scheduled on this day.',
      compact: true,
    });
  } else {
    const hint = day.isFuture
      ? ''
      : '<p class="field__hint">Tick a habit to record it for this day, or untick it to undo. Changes appear in Recent activity.</p>';
    const other = notScheduled > 0
      ? `<p class="card__subtitle">${plural(notScheduled, 'other habit is', 'other habits are')} not scheduled on this day.</p>`
      : '';
    body = `${hint}<ul class="habit-list" aria-label="Habits for ${escapeHtml(formatShortDate(date))}">${shown.map(renderRow).join('')}</ul>${other}`;
  }

  byId('detail-region').innerHTML = `<div class="stack stack--sm">
    <div class="cluster"><h3 class="card__title">${escapeHtml(formatLongDate(parseISODate(date)))}</h3>${tag}</div>
    <p>${escapeHtml(summary)}</p>
    ${body}
  </div>`;
}

/* ---------- Drawing everything ---------- */
function render() {
  const noHabits = state.habits.length === 0;
  byId('history-loading').hidden = true;
  byId('history-main').hidden = noHabits;
  byId('history-empty').hidden = !noHabits;

  byId('history-notice').innerHTML = state.hiddenCount > 0
    ? `<div class="notice notice--warning section-gap" role="status">${icon('info', 18)}<span>${plural(state.hiddenCount, 'saved record is', 'saved records are')} damaged and hidden. Nothing was deleted.</span></div>`
    : '';

  if (noHabits) {
    byId('history-empty').innerHTML = renderEmptyState({
      icon: 'calendar',
      title: 'Nothing to show yet',
      text: 'Create a habit and tick it off, and each day will appear here as completed or missed.',
      actionLabel: 'Go to Habits',
      actionHref: 'habits.html',
    });
    return;
  }

  renderControls();
  renderSummary();
  renderCalendar();
  renderDetail();
}

/** Reloads from storage and redraws. focus = { action, id } puts keyboard focus on a detail button afterwards. */
async function refresh(focus = null) {
  await load();
  render();
  if (focus) {
    const target = [...byId('detail-region').querySelectorAll(`[data-action="${focus.action}"]`)]
      .find((element) => element.dataset.id === focus.id);
    if (target) target.focus();
  }
}

async function safely(task) {
  try {
    await task();
  } catch (error) {
    showToast(errorText(error), 'error');
  }
}

/* ---------- Navigation ---------- */
function selectDate(date) {
  state.selected = date;
  renderControls();
  renderCalendar();
  renderDetail();
  focusDay(date);
}

async function goToDate(date) {
  state.view = viewOf(date);
  state.selected = date;
  await refresh();
}

async function changeMonth(delta) {
  const next = shiftMonth(state.view.year, state.view.monthIndex, delta);
  const key = monthKey(next.year, next.monthIndex);
  if (key < MIN_KEY || key > MAX_KEY) return;
  const current = viewOf(state.today);
  state.view = next;
  state.selected = next.year === current.year && next.monthIndex === current.monthIndex
    ? state.today
    : toISODate(new Date(next.year, next.monthIndex, 1));
  await refresh();
}

/* ---------- Tick or untick on the selected day ---------- */
async function toggleHabit(button, habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) return;

  if (toISODate() !== state.today) {
    await refresh();
    showToast('The date has changed, so the page was refreshed for the new day.', 'warning');
    return;
  }

  const date = state.selected;
  const dates = state.index.get(habitId);
  const wasDone = Boolean(dates && dates.has(date));
  button.disabled = true;
  try {
    const result = await setHabitDone(state.profile.id, habitId, date, !wasDone);
    if (!result.ok) {
      await refresh();
      showToast(result.message, 'error');
      return;
    }
    await refresh({ action: 'toggle', id: habitId });
    const when = formatShortDate(date);
    if (result.changed) {
      showToast(
        wasDone ? `"${habit.name}" marked not done for ${when}.` : `"${habit.name}" marked done for ${when}.`,
        'success',
      );
    } else {
      showToast('That habit was already up to date.', 'info');
    }
  } catch (error) {
    showToast(errorText(error), 'error');
  } finally {
    button.disabled = false;
  }
}

/* ---------- Events ---------- */
function bindEvents() {
  byId('prev-month').addEventListener('click', () => safely(() => changeMonth(-1)));
  byId('next-month').addEventListener('click', () => safely(() => changeMonth(1)));
  byId('this-month').addEventListener('click', () => safely(() => goToDate(toISODate())));

  byId('goto-date').addEventListener('change', (event) => {
    const value = event.target.value;
    if (!value) return;
    if (!parseISODate(value) || value < MIN_DATE || value > MAX_DATE) {
      showToast(`Choose a date between ${formatShortDate(MIN_DATE)} and ${formatShortDate(MAX_DATE)}.`, 'error');
      event.target.value = state.selected;
      return;
    }
    safely(() => goToDate(value));
  });

  byId('calendar').addEventListener('click', (event) => {
    const button = event.target.closest('.cal-day');
    if (button) selectDate(button.dataset.date);
  });

  // Arrow keys move between days; Enter or Space (the button's normal behaviour) opens one.
  byId('calendar').addEventListener('keydown', (event) => {
    const button = event.target.closest('.cal-day');
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!button || !(event.key in steps)) return;
    const target = byId('calendar').querySelector(`[data-date="${addDays(button.dataset.date, steps[event.key])}"]`);
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });

  byId('detail-region').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="toggle"]');
    if (button) toggleHabit(button, button.dataset.id);
  });

  // If the tab was left open past midnight, refresh for the new day when the user returns.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.profile && toISODate() !== state.today) {
      safely(() => refresh());
    }
  });
}

/* ---------- Start ---------- */
async function start() {
  try {
    state.profile = await ready;
    if (!state.profile) {
      byId('history-loading').textContent = 'History is not available. If you were not sent to the start page, see the message at the top of this page.';
      return;
    }
    state.today = toISODate();
    state.view = viewOf(state.today);
    state.selected = state.today;
    byId('goto-date').min = MIN_DATE;
    byId('goto-date').max = MAX_DATE;
    bindEvents();
    await refresh();
  } catch (error) {
    const detail = error instanceof StorageError ? '' : ` Technical detail: ${error && error.message ? error.message : String(error)}`;
    byId('history-loading').innerHTML = `<span class="notice notice--warning" role="alert">${icon('info', 18)}<span>${escapeHtml(errorText(error))}${escapeHtml(detail)} Your data has not been changed.</span></span>`;
  }
}

start();