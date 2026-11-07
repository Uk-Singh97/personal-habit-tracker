/* js/ui.js
   Shared UI code used by every page:
   - icons (inline SVG)
   - building the sidebar / top bar / tab bar from one list (so nav is defined once)
   - light/dark theme switching
   - opening and closing <dialog> elements, plus a reusable confirm dialog
   - toast messages and page-level error notices
   - reusable HTML renderers (empty state, habit row)
   - checks that a local profile is open on every app page
   - starts the in-tab reminder checker on every app page (see reminders.js)
   It runs itself when loaded, so each page only needs to import it.

   Page scripts that need the open profile can do:
       import { ready } from './ui.js';
       const profile = await ready;   // the profile object, or null */

import { initStorage, StorageError } from './storage.js';
import { getActiveProfile } from './auth.js';
import { startReminders } from './reminders.js';

const THEME_KEY = 'habitTracker:theme';

const NAV_ITEMS = [
  { page: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'home' },
  { page: 'habits', label: 'Habits', href: 'habits.html', icon: 'list' },
  { page: 'history', label: 'History', href: 'history.html', icon: 'calendar' },
  { page: 'progress', label: 'Progress', href: 'progress.html', icon: 'chart' },
  { page: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings' },
];

export const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

/** "3-day streak" or "No streak yet". */
export function streakLabel(days) {
  return days > 0 ? `${days}-day streak` : 'No streak yet';
}

/* ---------- Session: resolves to the open profile (or null) ---------- */
let resolveReady = () => {};
export const ready = new Promise((resolve) => {
  resolveReady = resolve;
});

/* ---------- Icons ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

export function icon(name, size = 20) {
  const paths = ICONS[name] || '';
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/** Fills every element that has data-icon="name" with that icon. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((element) => {
    element.innerHTML = icon(element.dataset.icon, Number(element.dataset.iconSize) || 20);
  });
}

/* ---------- Safe text for HTML ---------- */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

/* ---------- Reusable renderers ---------- */
export function renderEmptyState({ icon: iconName = 'target', title, text, actionLabel, actionHref, actionDialogId, compact = false }) {
  let action = '';
  if (actionLabel && actionHref) {
    action = `<a class="btn btn--primary" href="${actionHref}">${escapeHtml(actionLabel)}</a>`;
  } else if (actionLabel && actionDialogId) {
    action = `<button class="btn btn--primary" type="button" data-open-dialog="${actionDialogId}">${icon('plus', 18)}${escapeHtml(actionLabel)}</button>`;
  }
  return `<div class="empty-state${compact ? ' empty-state--compact' : ''}">
    <span class="empty-state__icon">${icon(iconName, 28)}</span>
    <h3 class="empty-state__title">${escapeHtml(title)}</h3>
    <p class="empty-state__text">${escapeHtml(text)}</p>
    ${action}
  </div>`;
}

/* ---------- Toasts ---------- */
function ensureToastRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

/** Shows a short message. duration is in milliseconds (reminders use a longer one). */
export function showToast(message, type = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  ensureToastRegion().appendChild(toast);
  window.setTimeout(() => toast.remove(), duration);
}

/* ---------- Page-level error notice (e.g. storage problems) ---------- */
export function showPageError(error) {
  const isStorageError = error instanceof StorageError;
  if (!isStorageError) console.error(error);
  const message = isStorageError ? error.message : 'Something went wrong while loading saved data.';
  const main = document.getElementById('main');
  if (!main) return;
  const box = document.createElement('div');
  box.className = 'notice notice--warning';
  box.style.marginBottom = 'var(--space-4)';
  box.setAttribute('role', 'alert');
  box.innerHTML = `${icon('info', 18)}<span>${escapeHtml(message)} <a href="index.html">Open the start page</a> for options.</span>`;
  main.prepend(box);
}

/* ---------- Confirm dialog (used before destructive actions) ----------
   Usage:  const ok = await confirmAction({ title, message, confirmLabel, danger: true });
   Cancel is focused first so Enter does not delete by accident. */
export function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') {
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
    dialog.setAttribute('aria-describedby', 'confirm-dialog-message');
    dialog.innerHTML = `<form class="dialog__form" method="dialog">
      <div class="dialog__header">
        <h2 class="card__title" id="confirm-dialog-title">${escapeHtml(title)}</h2>
      </div>
      <div class="dialog__body">
        <p id="confirm-dialog-message">${escapeHtml(message)}</p>
      </div>
      <div class="dialog__footer">
        <button class="btn btn--ghost" type="button" data-close-dialog autofocus>Cancel</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="submit" value="confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    </form>`;
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      resolve(confirmed);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/* ---------- Theme ---------- */
export function getThemeChoice() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch (error) {
    return 'system';
  }
}

function getEffectiveTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function refreshThemeControls() {
  const effective = getEffectiveTheme();
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    const toDark = effective !== 'dark';
    const label = toDark ? 'Dark theme' : 'Light theme';
    button.innerHTML = icon(toDark ? 'moon' : 'sun') + (button.hasAttribute('data-theme-label') ? `<span>${label}</span>` : '');
    button.setAttribute('aria-label', `Switch to ${label.toLowerCase()}`);
  });
  const select = document.getElementById('theme-select');
  if (select) select.value = getThemeChoice();
}

export function setThemeChoice(choice) {
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch (error) {
    /* Storage blocked: the theme still changes for this visit. */
  }
  refreshThemeControls();
}

function bindThemeControls() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-theme-toggle]')) {
      setThemeChoice(getEffectiveTheme() === 'dark' ? 'light' : 'dark');
    }
  });

  const select = document.getElementById('theme-select');
  if (select) {
    select.addEventListener('change', () => {
      setThemeChoice(select.value);
      showToast('Theme saved on this device.', 'success');
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshThemeControls);
  refreshThemeControls();
}

/* ---------- Dialogs ---------- */
function bindDialogs() {
  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open-dialog]');
    if (opener) {
      const dialog = document.getElementById(opener.dataset.openDialog);
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      return;
    }
    const closer = event.target.closest('[data-close-dialog]');
    if (closer) {
      closer.closest('dialog')?.close();
      return;
    }
    // Clicking the dimmed backdrop closes the dialog
    if (event.target.matches('dialog.dialog')) event.target.close();
  });
}

/* ---------- Navigation shell ---------- */
function brandMarkup() {
  return `<a class="brand" href="index.html">
    <span class="brand__mark">${icon('check', 20)}</span>
    <span class="brand__text">
      <span class="brand__name">Habit Tracker</span>
      <span class="brand__team">Team Galacticos</span>
    </span>
  </a>`;
}

function buildShell() {
  const current = document.body.dataset.page;
  const links = (className) => NAV_ITEMS.map((item) => {
    const ariaCurrent = item.page === current ? ' aria-current="page"' : '';
    return `<a class="${className}" href="${item.href}"${ariaCurrent}>${icon(item.icon)}<span>${item.label}</span></a>`;
  }).join('');

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.innerHTML = `${brandMarkup()}
      <nav class="sidebar__nav" aria-label="Primary">${links('nav-link')}</nav>
      <div class="sidebar__footer">
        <div id="sidebar-profile" class="stack stack--sm"></div>
        <p class="mode-note"><strong>Local demo mode (prototype).</strong> Data stays in this browser. Profiles are not secure logins.</p>
        <button class="btn btn--secondary" type="button" data-theme-toggle data-theme-label></button>
      </div>`;
  }

  const topbar = document.getElementById('mobile-topbar');
  if (topbar) {
    topbar.innerHTML = `${brandMarkup()}
      <button class="btn btn--secondary btn--icon" type="button" data-theme-toggle></button>`;
  }

  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.innerHTML = links('tab-link');
}

function renderProfileInfo(profile) {
  const holder = document.getElementById('sidebar-profile');
  if (!holder) return;
  holder.innerHTML = `<p class="mode-note">Open profile: <strong>${escapeHtml(profile.displayName)}</strong></p>
    <a class="btn btn--secondary btn--sm" href="index.html">Switch profile</a>`;
}

/* ---------- Reminders ----------
   The checker lives in reminders.js. It only works while this page is open.
   A reminder shows as a message here, and as a browser pop-up if allowed. */
function startReminderChecks(profile) {
  try {
    startReminders({
      userId: profile.id,
      onDue: (habit, message) => showToast(message, 'warning', 20000),
    });
  } catch (error) {
    console.warn('Reminders could not be started:', error);
  }
}

/* ---------- Session check ----------
   Home page (index.html): page-index.js handles profiles itself.
   Every other page needs an open profile, otherwise it goes back to index.html. */
async function startSession() {
  if (document.body.dataset.page === 'home') {
    resolveReady(null);
    return;
  }
  try {
    await initStorage();
    const profile = await getActiveProfile();
    if (!profile) {
      window.location.replace('index.html');
      resolveReady(null);
      return;
    }
    renderProfileInfo(profile);
    resolveReady(profile);
    startReminderChecks(profile);
  } catch (error) {
    showPageError(error);
    resolveReady(null);
  }
}

/* ---------- Start-up ---------- */
function init() {
  ensureToastRegion();
  buildShell();
  hydrateIcons();
  bindDialogs();
  bindThemeControls();
  startSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}