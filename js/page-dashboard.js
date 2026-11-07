/* js/page-dashboard.js
   Dashboard page. Every number is calculated by stats.js from the open
   profile's saved habits and completions (nothing is hardcoded).

   Flow:  storage.js (read)  ->  stats.js (calculate)  ->  this file (draw).
   Ticking a habit goes through habits.js, then everything is reloaded and redrawn,
   so the numbers, ring, chart and activity list always agree. */

import { ready, icon, escapeHtml, showToast, renderEmptyState, streakLabel, PRIORITY_LABELS } from './ui.js';
import { StorageError, getCompletions, getActivity } from './storage.js';
import { listHabits, setHabitDone, describeSchedule } from './habits.js';
import { computeDashboardStats, summariseWeek, recentActivity, describeActivity } from './stats.js';
import {
  formatDayMonth,
  formatLongDate,
  formatTimestamp,
  getWeekday,
  parseISODate,
  startOfWeek,
  toISODate,
  WEEKDAY_NAMES,
} from './dates.js';

const byId = (id) => document.getElementById(id);
const ACTIVITY_TYPES = ['created', 'updated', 'completed', 'uncompleted', 'deleted'];

const state = {
  profile: null,
  today: '',
  habits: [],
  hiddenCount: 0,
  stats: null,
  week: null,
  activity: [], // null when the activity log could not be read
};

function errorText(error) {
  if (error instanceof StorageError) return error.message;
  console.error(error);
  return 'Something went wrong. Please try again.';
}

/* ---------- Loading ---------- */
async function load() {
  const userId = state.profile.id;
  const today = toISODate();
  const [list, completions, activity] = await Promise.all([
    listHabits(userId),
    getCompletions(userId),
    getActivity(userId).catch(() => null), // a damaged log must not break the dashboard
  ]);
  state.today = today;
  state.habits = list.habits;
  state.hiddenCount = list.hiddenCount;
  state.stats = computeDashboardStats(list.habits, completions, today);
  state.week = summariseWeek(list.habits, state.stats.index, startOfWeek(today), today);
  state.activity = activity;
}

/* ---------- Statistic cards, ring ---------- */
function renderStats() {
  const { stats, habits } = state;
  const day = stats.today;
  const overall = stats.overall;

  byId('stat-active').textContent = stats.activeCount;
  byId('stat-scheduled').textContent = day.scheduled;
  byId('stat-done').textContent = day.completed;
  byId('stat-remaining').textContent = day.remaining;

  const best = stats.bestCurrent;
  byId('stat-streak').textContent = best.days;
  byId('stat-streak-hint').textContent = best.habit
    ? `${best.days === 1 ? 'day' : 'days'} in a row: ${best.habit.name}`
    : 'Complete a habit to start one';

  byId('stat-overall').textContent = overall.percent === null ? '\u2013' : `${overall.percent}%`;
  byId('stat-overall-hint').textContent = overall.scheduled === 0
    ? 'Nothing scheduled yet'
    : `${overall.completed} of ${overall.scheduled} scheduled days`;

  const percent = day.percent;
  byId('ring').style.setProperty('--value', percent === null ? 0 : percent);
  byId('ring').setAttribute('aria-label', percent === null
    ? 'No habits scheduled today'
    : `${percent}% of today's scheduled habits completed`);
  byId('ring-value').textContent = percent === null ? '\u2013' : `${percent}%`;
  byId('ring-caption').textContent = habits.length === 0
    ? 'No habits yet'
    : (day.scheduled === 0 ? 'Nothing scheduled today' : `${day.completed} of ${day.scheduled} habits done`);
}

/* ---------- Today's habits ---------- */
function renderRow(habit, done) {
  const name = escapeHtml(habit.name);
  const id = escapeHtml(habit.id);
  const streak = state.stats.streaks.get(habit.id) || { current: 0, best: 0 };
  return `<li class="habit-item" data-done="${done}">
    <button class="habit-toggle" type="button" data-action="toggle" data-id="${id}" aria-pressed="${done}" aria-label="Done today: ${name}">${icon('check', 20)}</button>
    <div>
      <p class="habit-item__name">${name}</p>
      <div class="habit-item__meta">
        <span class="badge badge--category">${escapeHtml(habit.category)}</span>
        <span class="badge badge--${habit.priority}">${PRIORITY_LABELS[habit.priority]} priority</span>
        <span>${escapeHtml(describeSchedule(habit.schedule))}</span>
        <span class="habit-item__streak">${icon('flame', 14)}${escapeHtml(streakLabel(streak.current))}</span>
      </div>
    </div>
    <div class="habit-item__trailing">
      <span class="badge ${done ? 'badge--done' : 'badge--pending'}">${done ? 'Done today' : 'Not done yet'}</span>
    </div>
  </li>`;
}

function renderTodayList() {
  const { habits, stats } = state;
  const day = stats.today;
  const resting = stats.activeCount - day.scheduled; // active habits that are not scheduled today

  if (habits.length === 0) {
    return renderEmptyState({
      icon: 'target',
      title: 'No habits yet',
      text: 'Create your first habit and it will appear here as part of today\'s plan.',
      actionLabel: 'Go to Habits',
      actionHref: 'habits.html',
    });
  }
  if (day.scheduled === 0) {
    return renderEmptyState({
      icon: 'calendar',
      title: 'Nothing scheduled today',
      text: resting > 0
        ? `None of your ${resting} active ${resting === 1 ? 'habit is' : 'habits are'} scheduled for today. Enjoy the rest day.`
        : 'None of your habits are active today. They may start on a later date, or have ended.',
      actionLabel: 'Go to Habits',
      actionHref: 'habits.html',
      compact: true,
    });
  }

  const doneIds = new Set(day.doneHabits.map((habit) => habit.id));
  const rows = day.scheduledHabits
    .slice()
    .sort((a, b) => Number(doneIds.has(a.id)) - Number(doneIds.has(b.id))) // not done first
    .map((habit) => renderRow(habit, doneIds.has(habit.id)))
    .join('');
  const note = resting > 0
    ? `<p class="card__subtitle">${resting} other active ${resting === 1 ? 'habit is' : 'habits are'} not scheduled today.</p>`
    : '';
  return `<ul class="habit-list" aria-label="Habits scheduled today">${rows}</ul>${note}`;
}

/* ---------- Weekly progress ---------- */
function renderWeek() {
  const { week, habits } = state;
  if (habits.length === 0) {
    return renderEmptyState({
      icon: 'chart',
      title: 'No weekly data yet',
      text: 'Once you create habits and complete them, each day of the week appears here.',
      compact: true,
    });
  }

  const columns = [];
  const spoken = [];
  week.days.forEach((day) => {
    const label = WEEKDAY_NAMES[getWeekday(day.date)];
    const percentText = day.percent === null ? '\u2013' : `${day.percent}%`;
    let countText;
    if (day.isFuture) {
      countText = day.scheduled > 0 ? `${day.scheduled} due` : '\u2013';
      spoken.push(day.scheduled > 0 ? `${label} ${day.scheduled} due` : `${label} nothing scheduled`);
    } else if (day.scheduled === 0) {
      countText = 'none';
      spoken.push(`${label} nothing scheduled`);
    } else {
      countText = `${day.completed}/${day.scheduled}`;
      spoken.push(`${label} ${day.percent}% (${day.completed} of ${day.scheduled})`);
    }
    const classes = ['week-chart__col'];
    if (day.isToday) classes.push('week-chart__col--today');
    if (day.isFuture) classes.push('week-chart__col--future');
    columns.push(`<div class="${classes.join(' ')}">
      <div class="week-chart__track"><div class="week-chart__bar${day.percent === 100 ? ' week-chart__bar--full' : ''}" style="--value:${day.percent === null ? 0 : day.percent}"></div></div>
      <span class="week-chart__label">${label}</span>
      <span class="week-chart__pct">${percentText}</span>
      <span class="week-chart__count">${escapeHtml(countText)}</span>
    </div>`);
  });

  const rate = week.percent === null ? '\u2013' : `${week.percent}%`;
  const detail = week.scheduled === 0
    ? 'Nothing has been scheduled so far this week.'
    : `${week.completed} of ${week.scheduled} scheduled so far done, ${week.missed} missed.`;

  return `<p class="card__subtitle">${escapeHtml(formatDayMonth(week.weekStart))} to ${escapeHtml(formatDayMonth(week.weekEnd))}</p>
    <div class="week-chart section-gap" role="img" aria-label="Weekly completion: ${escapeHtml(spoken.join(', '))}">${columns.join('')}</div>
    <div class="week-summary">
      <div class="week-summary__line"><span>Weekly completion rate</span><strong>${rate}</strong></div>
      <div class="progress" aria-hidden="true"><div class="progress__fill" style="--value:${week.percent === null ? 0 : week.percent}"></div></div>
      <p class="card__subtitle">${escapeHtml(detail)}</p>
    </div>`;
}

/* ---------- Overall ---------- */
function renderOverall() {
  const { overall, bestEver } = state.stats;
  if (overall.scheduled === 0) {
    return renderEmptyState({
      icon: 'chart',
      title: 'No statistics yet',
      text: 'Overall figures appear once one of your habits has had a scheduled day.',
      compact: true,
    });
  }
  const best = bestEver.habit
    ? `<p class="card__subtitle">Best streak ever: ${bestEver.days} ${bestEver.days === 1 ? 'day' : 'days'} (${escapeHtml(bestEver.habit.name)})</p>`
    : '';
  return `<div class="week-summary__line"><span>Completion since each habit started</span><strong>${overall.percent}%</strong></div>
    <div class="progress" aria-hidden="true"><div class="progress__fill" style="--value:${overall.percent}"></div></div>
    <ul class="figure-list">
      <li><span class="figure__value">${overall.scheduled}</span><span class="figure__label">Scheduled days</span></li>
      <li><span class="figure__value">${overall.completed}</span><span class="figure__label">Completed</span></li>
      <li><span class="figure__value">${overall.missed}</span><span class="figure__label">Missed</span></li>
    </ul>
    ${best}`;
}

/* ---------- Recent activity ---------- */
function renderActivity() {
  if (state.activity === null) {
    return `<div class="notice notice--warning" role="status">${icon('info', 18)}<span>Recent activity could not be read. Your habits are not affected.</span></div>`;
  }
  const entries = recentActivity(state.activity, 8);
  if (entries.length === 0) {
    return renderEmptyState({
      icon: 'clock',
      title: 'No activity yet',
      text: 'Creating, editing, completing and deleting habits is recorded here, newest first. Only actions from now on are recorded.',
      compact: true,
    });
  }
  const rows = entries.map((entry) => {
    const kind = ACTIVITY_TYPES.includes(entry.type) ? entry.type : 'completed';
    return `<li class="activity-item">
      <span class="activity-item__dot activity-item__dot--${kind}"></span>
      <div>${escapeHtml(describeActivity(entry, state.today))}<time class="activity-item__time" datetime="${escapeHtml(entry.at)}">${escapeHtml(formatTimestamp(entry.at))}</time></div>
    </li>`;
  }).join('');
  return `<ul class="activity-list">${rows}</ul>`;
}

/* ---------- Drawing everything ---------- */
function render() {
  const label = byId('today-label');
  label.textContent = formatLongDate(parseISODate(state.today));
  label.setAttribute('datetime', state.today);

  renderStats();

  const hiddenNotice = state.hiddenCount > 0
    ? `<div class="notice notice--warning" role="status">${icon('info', 18)}<span>${state.hiddenCount} saved ${state.hiddenCount === 1 ? 'record is' : 'records are'} damaged and hidden. Nothing was deleted.</span></div>`
    : '';
  byId('today-list').innerHTML = `<div class="stack stack--sm">${hiddenNotice}${renderTodayList()}</div>`;
  byId('week-region').innerHTML = renderWeek();
  byId('overall-region').innerHTML = renderOverall();
  byId('activity-region').innerHTML = renderActivity();
}

async function refresh(focusId = null) {
  await load();
  render();
  if (focusId) {
    const target = [...byId('today-list').querySelectorAll('[data-action="toggle"]')]
      .find((element) => element.dataset.id === focusId);
    if (target) target.focus();
  }
}

/* ---------- Tick off today ---------- */
async function toggleHabit(button, habit) {
  if (toISODate() !== state.today) {
    try {
      await refresh();
      showToast('The date has changed, so the dashboard was refreshed for the new day.', 'warning');
    } catch (error) {
      showToast(errorText(error), 'error');
    }
    return;
  }

  const isDone = state.stats.today.doneHabits.some((item) => item.id === habit.id);
  const wantDone = !isDone;
  button.disabled = true;
  try {
    const result = await setHabitDone(state.profile.id, habit.id, state.today, wantDone);
    if (!result.ok) {
      await refresh();
      showToast(result.message, 'error');
      return;
    }
    await refresh(habit.id);
    if (result.changed) {
      showToast(
        wantDone ? `"${habit.name}" marked done for today.` : `"${habit.name}" marked not done.`,
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

/* ---------- Start ---------- */
async function start() {
  try {
    state.profile = await ready;
    if (!state.profile) {
      byId('today-list').innerHTML = '<p class="card__subtitle">Your habits could not be loaded. If you were not sent to the start page, see the message at the top of this page.</p>';
      byId('week-region').textContent = '';
      byId('overall-region').textContent = '';
      byId('activity-region').textContent = '';
      return;
    }

    byId('today-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="toggle"]');
      if (!button) return;
      const habit = state.habits.find((item) => item.id === button.dataset.id);
      if (habit) toggleHabit(button, habit);
    });

    // If the tab was left open past midnight, refresh for the new day when the user returns.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || toISODate() === state.today) return;
      try {
        await refresh();
      } catch (error) {
        showToast(errorText(error), 'error');
      }
    });

    await refresh();
  } catch (error) {
    const detail = error instanceof StorageError ? '' : ` Technical detail: ${error && error.message ? error.message : String(error)}`;
    byId('today-list').innerHTML = `<div class="notice notice--warning" role="alert">${icon('info', 18)}<span>${escapeHtml(errorText(error))}${escapeHtml(detail)} Your data has not been changed.</span></div>`;
  }
}

start();