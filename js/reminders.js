/* js/reminders.js
   Habit reminders. What this can and cannot do:

   WORKS    While the app is open in a browser tab (even a background tab), it
            checks every 30 seconds. A habit gets a reminder when ALL of these
            are true: its reminder is switched on, it is scheduled today, it is
            not done yet, the reminder time has been reached, and it has not
            already been reminded today.
   CATCH-UP If you open the app after a reminder time has passed and the habit
            is still not done, the reminder shows once when the app loads.
   POPUP    A browser notification is shown too, but only if the user has
            allowed notifications. Permission can only be requested from a
            click (see requestNotificationPermission).
   NEVER    Nothing happens while the tab or browser is closed. That would need
            a service worker plus a push server, which this project does not have.
            Background tabs may be slowed down by the browser, so a reminder can
            arrive a little late. Some phone browsers do not allow notifications
            from web pages at all. */

import { loadHabitsForToday, isScheduledOn } from './habits.js';
import { getReminderLog, saveReminderLog } from './storage.js';
import { toISODate } from './dates.js';

const CHECK_INTERVAL_MS = 30000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------- Browser notification support ---------- */
/** 'unsupported' | 'insecure' | 'default' (not asked yet) | 'granted' | 'denied' */
export function getNotificationStatus() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return Notification.permission;
}

/** A sentence describing the status, safe to show on the page. */
export function describeNotificationStatus(status) {
  switch (status) {
    case 'granted': return 'Allowed. Reminders can pop up while the app is open in a tab.';
    case 'denied': return 'Blocked. Allow notifications for this site in your browser settings to use pop-ups. In-app reminders still appear.';
    case 'default': return 'Not enabled yet. In-app reminders still appear while the app is open.';
    case 'insecure': return 'Notifications need a secure page (https or localhost). In-app reminders still appear.';
    default: return 'This browser does not support notifications. In-app reminders still appear.';
  }
}

/** Asks the browser for permission. Call this ONLY from a click handler (browsers ignore or block other calls).
    Returns the new status. */
export async function requestNotificationPermission() {
  const status = getNotificationStatus();
  if (status !== 'default') return status;
  await new Promise((resolve) => {
    // Older browsers use a callback, newer ones return a Promise; this handles both.
    const maybePromise = Notification.requestPermission(resolve);
    if (maybePromise && typeof maybePromise.then === 'function') maybePromise.then(resolve);
  });
  return getNotificationStatus();
}

/** Shows a browser notification if allowed. Returns true if one was shown. */
function showBrowserNotification(title, body, tag) {
  if (getNotificationStatus() !== 'granted') return false;
  try {
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch (error) {
    return false; // e.g. some mobile browsers only allow notifications from a service worker
  }
}

/** For the Settings "send a test" button. Returns true if a notification was shown. */
export function sendTestNotification() {
  return showBrowserNotification(
    'Habit Tracker test',
    'Notifications are working. Reminders show while the app is open in a tab.',
    'habit-tracker-test',
  );
}

/* ---------- The reminder checker ---------- */
export function reminderMessage(habit) {
  return `Reminder: "${habit.name}" (set for ${habit.reminder.time})`;
}

/** Starts checking for due reminders for one profile.
    onDue(habit, message) is called once per due habit (use it to show an in-app message).
    Returns { checkNow, stop }. Call stop() if the profile changes. */
export function startReminders({ userId, onDue }) {
  let busy = false;
  let stopped = false;

  async function checkNow() {
    if (busy || stopped) return;
    busy = true;
    try {
      const now = new Date();
      const today = toISODate(now);
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const { habits, completedToday } = await loadHabitsForToday(userId, today);
      let log = await getReminderLog(userId);
      if (log.date !== today) log = { date: today, habitIds: [] };

      const due = habits.filter((habit) => habit.reminder
        && habit.reminder.enabled === true
        && TIME_PATTERN.test(String(habit.reminder.time))
        && habit.reminder.time <= time
        && isScheduledOn(habit, today)
        && !completedToday.has(habit.id)
        && !log.habitIds.includes(habit.id));

      if (due.length === 0) return;

      // Remember them BEFORE announcing, so a reminder can never repeat if something fails afterwards.
      log.habitIds.push(...due.map((habit) => habit.id));
      await saveReminderLog(userId, log);

      due.forEach((habit) => {
        const message = reminderMessage(habit);
        showBrowserNotification('Habit reminder', message, `habit-${habit.id}`);
        if (typeof onDue === 'function') onDue(habit, message);
      });
    } catch (error) {
      console.warn('Reminder check failed:', error);
    } finally {
      busy = false;
    }
  }

  const timer = window.setInterval(checkNow, CHECK_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') checkNow();
  };
  document.addEventListener('visibilitychange', onVisible);
  checkNow();

  return {
    checkNow,
    stop() {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}