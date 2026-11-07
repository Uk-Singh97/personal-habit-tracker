/* js/page-settings.js
   Settings page: profile info, reminders and notifications, export, import,
   and delete actions. Data buttons start disabled in the HTML and are only
   enabled once a profile has loaded, so no control pretends to work. The theme
   selector is handled by ui.js.

   Notification permission can only be requested from a click, so the Enable
   button does it. Reminder rules and limits are explained in reminders.js.
   User-entered text is escaped (or set with textContent) before it is shown. */

import { ready, showToast, confirmAction, escapeHtml } from './ui.js';
import { StorageError, getHabits, getCompletions, deleteUserData } from './storage.js';
import { deleteLocalProfile } from './auth.js';
import { downloadBackup, parseBackupText, applyBackup, MAX_FILE_BYTES } from './backup.js';
import { formatLongDate } from './dates.js';
import { listHabits, describeSchedule } from './habits.js';
import {
  getNotificationStatus,
  describeNotificationStatus,
  requestNotificationPermission,
  sendTestNotification,
} from './reminders.js';

const byId = (id) => document.getElementById(id);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
let profile = null;

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function handleError(error) {
  if (!(error instanceof StorageError)) console.error(error);
  showToast(error instanceof StorageError ? error.message : 'Something went wrong. Please try again.', 'error');
}

/** Runs a task with its button disabled, and reports any error. */
async function withBusy(button, task) {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    handleError(error);
  } finally {
    button.disabled = false;
  }
}

function setFeedback(message, isWarning = false) {
  const box = byId('data-feedback');
  if (!message) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.className = `notice section-gap${isWarning ? ' notice--warning' : ''}`;
  box.textContent = message;
  box.hidden = false;
}

async function refreshSummary() {
  const [habits, completions] = await Promise.all([getHabits(profile.id), getCompletions(profile.id)]);
  byId('data-summary').textContent = habits.length === 0 && completions.length === 0
    ? 'No habits saved for this profile yet. Create one on the Habits page.'
    : `Saved for this profile: ${plural(habits.length, 'habit', 'habits')} and ${plural(completions.length, 'completion record', 'completion records')}.`;
}

function syncImportButton() {
  byId('import-button').disabled = byId('import-file').files.length === 0;
}

/* ---------- Reminders and notifications ---------- */
function renderNotificationStatus() {
  const status = getNotificationStatus();
  const labels = {
    default: 'Enable notifications',
    granted: 'Notifications enabled',
    denied: 'Blocked in browser settings',
    unsupported: 'Not available',
    insecure: 'Not available',
  };
  byId('notif-status').textContent = describeNotificationStatus(status);
  byId('notif-enable').textContent = labels[status] || 'Not available';
  byId('notif-enable').disabled = status !== 'default';
  byId('notif-test').disabled = status !== 'granted';
}

async function enableNotifications() {
  const button = byId('notif-enable');
  button.disabled = true;
  try {
    const status = await requestNotificationPermission();
    if (status === 'granted') {
      showToast('Notifications allowed. Use "Send test notification" to check them.', 'success');
    } else if (status === 'denied') {
      showToast('Notifications were not allowed. You can change this in your browser\'s site settings.', 'warning');
    } else {
      showToast('No choice was made, so notifications are still off.', 'info');
    }
  } catch (error) {
    handleError(error);
  } finally {
    renderNotificationStatus(); // sets the button's state from the real permission
  }
}

function testNotification() {
  const shown = sendTestNotification();
  if (shown) {
    showToast('Test notification sent. If you do not see it, check your computer\'s notification or focus settings.', 'success');
  } else {
    showToast('The browser would not show a notification. Check your browser and system settings.', 'error');
  }
}

function testInAppMessage() {
  showToast('Reminder: "Example habit" (set for 08:00). This is only a test.', 'warning', 20000);
}

async function renderReminderList() {
  const region = byId('reminder-list');
  try {
    const { habits } = await listHabits(profile.id);
    const withReminders = habits
      .filter((habit) => habit.reminder
        && habit.reminder.enabled === true
        && TIME_PATTERN.test(String(habit.reminder.time)))
      .sort((a, b) => a.reminder.time.localeCompare(b.reminder.time)
        || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    if (withReminders.length === 0) {
      region.innerHTML = '<p class="card__subtitle">No habits have a reminder yet. Tick "Remind me" when you create or edit a habit.</p>';
      return;
    }

    const rows = withReminders.map((habit) => `<tr>
        <th scope="row" class="data-table__name">${escapeHtml(habit.name)}</th>
        <td>${escapeHtml(habit.reminder.time)}</td>
        <td>${escapeHtml(describeSchedule(habit.schedule))}</td>
      </tr>`).join('');
    region.innerHTML = `<div class="table-wrap"><table class="data-table">
        <caption class="visually-hidden">Habits that have a reminder</caption>
        <thead><tr><th scope="col">Habit</th><th scope="col">Time</th><th scope="col">Schedule</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (error) {
    region.innerHTML = '<p class="card__subtitle">Your reminders could not be read.</p>';
    handleError(error);
  }
}

/* ---------- Data actions ---------- */
async function exportData() {
  const counts = await downloadBackup(profile);
  showToast(`Backup downloaded (${plural(counts.habits, 'habit', 'habits')}, ${plural(counts.completions, 'completion record', 'completion records')}). Check your Downloads folder.`, 'success');
}

async function importSelectedFile() {
  const file = byId('import-file').files[0];
  if (!file) return;
  setFeedback('');

  if (file.size > MAX_FILE_BYTES) {
    setFeedback('That file is larger than 2 MB, so it was not imported.', true);
    return;
  }

  const parsed = parseBackupText(await file.text());
  if (!parsed.ok) {
    setFeedback(parsed.error, true);
    return;
  }

  const [habits, completions] = await Promise.all([getHabits(profile.id), getCompletions(profile.id)]);
  const anySkipped = parsed.skippedHabits > 0 || parsed.skippedCompletions > 0;
  const skippedText = anySkipped
    ? ` ${plural(parsed.skippedHabits, 'habit', 'habits')} and ${plural(parsed.skippedCompletions, 'completion record', 'completion records')} in the file were invalid or duplicated and will be skipped.`
    : '';

  const confirmed = await confirmAction({
    title: 'Replace this profile\'s data?',
    message: `Profile "${profile.displayName}" currently has ${plural(habits.length, 'habit', 'habits')} and ${plural(completions.length, 'completion record', 'completion records')}. Importing will REPLACE them with ${plural(parsed.habits.length, 'habit', 'habits')} and ${plural(parsed.completions.length, 'completion record', 'completion records')} from the file.${skippedText} This cannot be undone.`,
    confirmLabel: 'Replace data',
    danger: true,
  });
  if (!confirmed) return;

  const result = await applyBackup(profile, parsed);
  byId('import-file').value = '';
  await refreshSummary();
  await renderReminderList();
  const message = `Imported ${plural(result.habits, 'habit', 'habits')} and ${plural(result.completions, 'completion record', 'completion records')}.${anySkipped ? ` Skipped ${plural(parsed.skippedHabits, 'habit', 'habits')} and ${plural(parsed.skippedCompletions, 'completion record', 'completion records')} that were not valid.` : ''}`;
  setFeedback(message, anySkipped);
  showToast('Import complete.', 'success');
}

async function deleteData() {
  const confirmed = await confirmAction({
    title: 'Delete all habits and history?',
    message: `This permanently deletes every habit, completion record, the recent activity list and the reminder history in the profile "${profile.displayName}". The profile itself is kept. Export a backup first if you might need this data. This cannot be undone.`,
    confirmLabel: 'Delete habits and history',
    danger: true,
  });
  if (!confirmed) return;
  await deleteUserData(profile.id);
  setFeedback('');
  await refreshSummary();
  await renderReminderList();
  showToast('Habits and history deleted for this profile.', 'success');
}

async function deleteProfile() {
  const confirmed = await confirmAction({
    title: `Delete profile "${profile.displayName}"?`,
    message: 'This permanently deletes the profile, all of its habits and its history from this browser. This cannot be undone.',
    confirmLabel: 'Delete profile',
    danger: true,
  });
  if (!confirmed) return;
  await deleteLocalProfile(profile.id);
  window.location.href = 'index.html';
}

/* ---------- Start ---------- */
async function start() {
  // Notification controls do not need a profile, so set them up first.
  renderNotificationStatus();
  byId('notif-enable').addEventListener('click', enableNotifications);
  byId('notif-test').addEventListener('click', testNotification);
  byId('notif-inapp-test').addEventListener('click', testInAppMessage);
  // The user may change the browser's permission in another window, then come back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderNotificationStatus();
  });

  profile = await ready;
  if (!profile) {
    byId('profile-name').textContent = 'Not available';
    byId('profile-created').textContent = 'Not available';
    byId('data-summary').textContent = 'Saved data could not be loaded, so the data tools are switched off.';
    byId('reminder-list').textContent = 'Not available.';
    return;
  }

  byId('profile-name').textContent = profile.displayName;
  const created = new Date(profile.createdAt);
  byId('profile-created').textContent = Number.isNaN(created.getTime()) ? 'Unknown' : formatLongDate(created);

  const exportButton = byId('export-button');
  const importButton = byId('import-button');
  const fileInput = byId('import-file');
  const deleteDataButton = byId('delete-data-button');
  const deleteProfileButton = byId('delete-profile-button');

  exportButton.addEventListener('click', () => withBusy(exportButton, exportData));
  importButton.addEventListener('click', async () => {
    await withBusy(importButton, importSelectedFile);
    syncImportButton();
  });
  fileInput.addEventListener('change', () => {
    setFeedback('');
    syncImportButton();
  });
  deleteDataButton.addEventListener('click', () => withBusy(deleteDataButton, deleteData));
  deleteProfileButton.addEventListener('click', () => withBusy(deleteProfileButton, deleteProfile));

  await renderReminderList();

    let readable = true;
  try {
    await refreshSummary();
  } catch (error) {
    readable = false;
    byId('data-summary').textContent = 'The saved data for this profile could not be read. Export and import are switched off, but you can still delete the damaged data below to start fresh.';
    handleError(error);
  }

  // Deleting must stay available, so damaged data can always be cleared.
  deleteDataButton.disabled = false;
  deleteProfileButton.disabled = false;
  if (!readable) return;

  exportButton.disabled = false;
  fileInput.disabled = false;
  syncImportButton();
}

start();