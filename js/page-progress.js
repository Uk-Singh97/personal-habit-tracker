/* js/page-progress.js
   Progress page: overview, monthly summary and chart, weekly trend, streak table.
   Every figure is calculated by stats.js from the saved habits and completions.
   Charts are plain HTML and CSS (no library). All user text is escaped before
   it goes into innerHTML. */

import { ready, icon, escapeHtml, showToast, renderEmptyState } from './ui.js';
import { StorageError, getCompletions } from './storage.js';
import { listHabits, describeSchedule, MIN_DATE, MAX_DATE } from './habits.js';
import {
  buildIndex,
  computeStreaks,
  summariseStreaks,
  summariseOverall,
  summariseMonth,
  summariseWeek,
  summariseHabit,
} from './stats.js';
import {
  addDays,
  formatDayMonth,
  formatMonthYear,
  formatShortDate,
  parseISODate,
  shiftMonth,
  startOfWeek,
  toISODate,
} from './dates.js';

const byId = (id) => document.getElementById(id);
const WEEKS_SHOWN = 8;

const monthKey = (year, monthIndex) => year * 12 + monthIndex;
const MIN_KEY = monthKey(parseISODate(MIN_DATE).getFullYear(), parseISODate(MIN_DATE).getMonth());
const MAX_KEY = monthKey(parseISODate(MAX_DATE).getFullYear(), parseISODate(MAX_DATE).getMonth());

const state = {
  profile: null,
  today: '',
  habits: [],
  hiddenCount: 0,
  index: new Map(),
  streaks: new Map(),
  view: { year: 0, monthIndex: 0 },
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
  state.streaks = computeStreaks(list.habits, state.index, state.today);
}

/* ---------- Overview cards ---------- */
function renderOverview() {
  const overall = summariseOverall(state.habits, state.index, state.today);
  const { bestCurrent, bestEver } = summariseStreaks(state.habits, state.streaks, state.today);

  byId('ov-overall').textContent = overall.percent === null ? '\u2013' : `${overall.percent}%`;
  byId('ov-overall-hint').textContent = overall.scheduled === 0
    ? 'Nothing scheduled yet'
    : `${overall.completed} of ${overall.scheduled} scheduled days`;

  byId('ov-current').textContent = bestCurrent.days;
  byId('ov-current-hint').textContent = bestCurrent.habit ? bestCurrent.habit.name : 'Complete a habit to start one';

  byId('ov-best').textContent = bestEver.days;
  byId('ov-best-hint').textContent = bestEver.habit ? bestEver.habit.name : 'No streak yet';

  byId('ov-missed').textContent = overall.missed;
}

/* ---------- Monthly summary ---------- */
function monthFigures(m) {
  const percent = m.percent === null ? '\u2013' : `${m.percent}%`;
  let note = 'Figures count days up to and including today.';
  if (m.monthStart > state.today) note = 'This month has not started yet, so there are no figures.';
  else if (m.scheduled === 0) note = 'No habits were scheduled in this month up to today.';
  return `<ul class="figure-list figure-list--four">
      <li><span class="figure__value">${percent}</span><span class="figure__label">Completion</span></li>
      <li><span class="figure__value">${m.scheduled}</span><span class="figure__label">Scheduled</span></li>
      <li><span class="figure__value">${m.completed}</span><span class="figure__label">Completed</span></li>
      <li><span class="figure__value">${m.missed}</span><span class="figure__label">Missed</span></li>
    </ul>
    <p class="card__subtitle section-gap">${escapeHtml(note)}</p>`;
}

function monthChart(m) {
  const total = m.days.length;
  let allDone = 0;
  let someDone = 0;
  let noneDone = 0;
  m.days.forEach((day) => {
    if (day.isFuture || day.scheduled === 0) return;
    if (day.completed === day.scheduled) allDone += 1;
    else if (day.completed > 0) someDone += 1;
    else noneDone += 1;
  });
  const summary = allDone + someDone + noneDone === 0
    ? 'no scheduled days so far'
    : `${plural(allDone, 'day', 'days')} with everything done, ${plural(someDone, 'day', 'days')} partly done, ${plural(noneDone, 'day', 'days')} with nothing done`;

  const columns = m.days.map((day) => {
    const value = day.percent === null ? 0 : day.percent;
    const showLabel = day.day === 1 || day.day % 5 === 0 || day.day === total;
    const label = showLabel
      ? `<span class="month-chart__label"><span>${day.day}</span></span>`
      : '<span class="month-chart__label"></span>';
    const when = formatShortDate(day.date);
    let tip = `${when}: ${day.completed} of ${day.scheduled} done`;
    if (day.isFuture) tip = `${when}: not due yet`;
    else if (day.scheduled === 0) tip = `${when}: nothing scheduled`;
    const classes = ['month-chart__col'];
    if (day.isToday) classes.push('month-chart__col--today');
    if (day.isFuture) classes.push('month-chart__col--future');
    return `<div class="${classes.join(' ')}" title="${escapeHtml(tip)}">
      <div class="month-chart__track"><div class="month-chart__bar${value === 100 ? ' month-chart__bar--full' : ''}" style="--value:${value}"></div></div>
      ${label}
    </div>`;
  }).join('');

  const aria = `Daily completion for ${formatMonthYear(m.year, m.monthIndex)}: ${summary}`;
  return `<div class="month-chart" style="--days:${total}" role="img" aria-label="${escapeHtml(aria)}">${columns}</div>
    <p class="card__subtitle chart-note">Each bar is one day. A tall green bar means every scheduled habit was done. Dimmed bars are days not due yet. Days with nothing scheduled have no bar.</p>`;
}

function monthHabitTable(m) {
  if (m.monthStart > state.today) {
    return '<p class="card__subtitle">This month has not started yet.</p>';
  }
  if (m.habitRows.length === 0) {
    return renderEmptyState({
      icon: 'calendar',
      title: 'No scheduled days this month',
      text: 'None of your habits had a scheduled day in this month up to today.',
      compact: true,
    });
  }
  const rows = m.habitRows.map((row) => `<tr>
      <th scope="row" class="data-table__name">${escapeHtml(row.habit.name)}</th>
      <td class="num">${row.completed}</td>
      <td class="num">${row.scheduled}</td>
      <td class="num"><div class="rate-cell"><div class="progress" aria-hidden="true"><div class="progress__fill" style="--value:${row.percent === null ? 0 : row.percent}"></div></div><span>${row.percent === null ? '\u2013' : `${row.percent}%`}</span></div></td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="data-table">
      <caption class="visually-hidden">Completion by habit for ${escapeHtml(formatMonthYear(m.year, m.monthIndex))}</caption>
      <thead><tr><th scope="col">Habit</th><th scope="col" class="num">Done</th><th scope="col" class="num">Scheduled</th><th scope="col" class="num">Rate</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderMonth() {
  const m = summariseMonth(state.habits, state.index, state.view.year, state.view.monthIndex, state.today);
  byId('month-label').textContent = formatMonthYear(m.year, m.monthIndex);
  const key = monthKey(m.year, m.monthIndex);
  byId('prev-month').disabled = key <= MIN_KEY;
  byId('next-month').disabled = key >= MAX_KEY;
  byId('month-summary').innerHTML = monthFigures(m);
  byId('month-chart').innerHTML = monthChart(m);
  byId('month-habits').innerHTML = monthHabitTable(m);
}

/* ---------- Weekly trend ---------- */
function renderTrend() {
  const thisMonday = startOfWeek(state.today);
  const weeks = [];
  for (let i = WEEKS_SHOWN - 1; i >= 0; i -= 1) {
    weeks.push(summariseWeek(state.habits, state.index, addDays(thisMonday, -7 * i), state.today));
  }

  const spoken = [];
  const columns = weeks.map((week, position) => {
    const isCurrent = position === weeks.length - 1;
    const value = week.percent === null ? 0 : week.percent;
    const percentText = week.percent === null ? '\u2013' : `${week.percent}%`;
    const countText = week.scheduled === 0 ? 'none' : `${week.completed}/${week.scheduled}`;
    const label = isCurrent ? 'This week' : formatDayMonth(week.weekStart);
    spoken.push(week.scheduled === 0
      ? `week of ${formatDayMonth(week.weekStart)} nothing scheduled`
      : `week of ${formatDayMonth(week.weekStart)} ${week.percent}% (${week.completed} of ${week.scheduled})`);
    const classes = ['week-chart__col'];
    if (isCurrent) classes.push('week-chart__col--today');
    return `<div class="${classes.join(' ')}">
      <div class="week-chart__track"><div class="week-chart__bar${value === 100 ? ' week-chart__bar--full' : ''}" style="--value:${value}"></div></div>
      <span class="week-chart__label">${escapeHtml(label)}</span>
      <span class="week-chart__pct">${percentText}</span>
      <span class="week-chart__count">${escapeHtml(countText)}</span>
    </div>`;
  }).join('');

  const scored = weeks.filter((week) => week.percent !== null);
  let best = '';
  if (scored.length > 0) {
    const top = scored.reduce((winner, week) => (week.percent > winner.percent ? week : winner));
    best = `<p class="card__subtitle section-gap">Highest week: ${top.percent}% (week of ${escapeHtml(formatDayMonth(top.weekStart))}). The current week only counts days up to today.</p>`;
  } else {
    best = '<p class="card__subtitle section-gap">No habit has been scheduled in these weeks yet.</p>';
  }

  byId('trend-region').innerHTML = `<div class="trend-chart" style="--cols:${weeks.length}" role="img" aria-label="Weekly completion for the last ${weeks.length} weeks: ${escapeHtml(spoken.join(', '))}">${columns}</div>${best}`;
}

/* ---------- Streak table ---------- */
function renderStreaks() {
  const rows = state.habits.map((habit) => ({
    habit,
    streak: state.streaks.get(habit.id) || { current: 0, best: 0, totalCompleted: 0 },
    summary: summariseHabit(habit, state.index.get(habit.id), state.today),
  })).sort((a, b) => (b.streak.current - a.streak.current)
    || (b.streak.best - a.streak.best)
    || a.habit.name.localeCompare(b.habit.name, undefined, { sensitivity: 'base' }));

  const body = rows.map(({ habit, streak, summary }) => `<tr>
      <th scope="row" class="data-table__name">${escapeHtml(habit.name)}<br><span class="field__hint">${escapeHtml(describeSchedule(habit.schedule))}</span></th>
      <td class="num">${icon('flame', 14)} ${streak.current}</td>
      <td class="num">${streak.best}</td>
      <td class="num">${streak.totalCompleted}</td>
      <td class="num">${summary.percent === null ? '\u2013' : `${summary.percent}%`}</td>
    </tr>`).join('');

  byId('streak-region').innerHTML = `<div class="table-wrap"><table class="data-table">
      <caption class="visually-hidden">Current and best streak for each habit</caption>
      <thead><tr><th scope="col">Habit</th><th scope="col" class="num">Current (days)</th><th scope="col" class="num">Best (days)</th><th scope="col" class="num">Completed</th><th scope="col" class="num">Overall rate</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/* ---------- Drawing everything ---------- */
function render() {
  const noHabits = state.habits.length === 0;
  byId('progress-loading').hidden = true;
  byId('progress-main').hidden = noHabits;
  byId('progress-empty').hidden = !noHabits;

  byId('progress-notice').innerHTML = state.hiddenCount > 0
    ? `<div class="notice notice--warning section-gap" role="status">${icon('info', 18)}<span>${plural(state.hiddenCount, 'saved record is', 'saved records are')} damaged and hidden. Nothing was deleted.</span></div>`
    : '';

  if (noHabits) {
    byId('progress-empty').innerHTML = renderEmptyState({
      icon: 'chart',
      title: 'No progress to summarise yet',
      text: 'Create a habit and complete it a few times. Weekly and monthly summaries and streaks will appear here.',
      actionLabel: 'Go to Habits',
      actionHref: 'habits.html',
    });
    return;
  }

  renderOverview();
  renderMonth();
  renderTrend();
  renderStreaks();
}

async function refresh() {
  await load();
  render();
}

async function safely(task) {
  try {
    await task();
  } catch (error) {
    showToast(errorText(error), 'error');
  }
}

/* ---------- Month navigation ---------- */
async function changeMonth(delta) {
  const next = shiftMonth(state.view.year, state.view.monthIndex, delta);
  const key = monthKey(next.year, next.monthIndex);
  if (key < MIN_KEY || key > MAX_KEY) return;
  state.view = next;
  await refresh();
}

function bindEvents() {
  byId('prev-month').addEventListener('click', () => safely(() => changeMonth(-1)));
  byId('next-month').addEventListener('click', () => safely(() => changeMonth(1)));
  byId('this-month').addEventListener('click', () => safely(async () => {
    state.view = viewOf(toISODate());
    await refresh();
  }));

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
      byId('progress-loading').textContent = 'Progress is not available. If you were not sent to the start page, see the message at the top of this page.';
      return;
    }
    state.today = toISODate();
    state.view = viewOf(state.today);
    bindEvents();
    await refresh();
  } catch (error) {
    const detail = error instanceof StorageError ? '' : ` Technical detail: ${error && error.message ? error.message : String(error)}`;
    byId('progress-loading').innerHTML = `<span class="notice notice--warning" role="alert">${icon('info', 18)}<span>${escapeHtml(errorText(error))}${escapeHtml(detail)} Your data has not been changed.</span></span>`;
  }
}

start();