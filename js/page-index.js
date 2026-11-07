/* js/page-index.js
   Start page: choose, create or delete LOCAL DEMO PROFILES.
   A profile is only a label that keeps habits separate in this browser.
   There are no passwords; this is not authentication. */

import { escapeHtml, icon, renderEmptyState, showToast, confirmAction } from './ui.js';
import { initStorage, StorageError, clearAllAppData } from './storage.js';
import {
  listProfiles,
  getActiveProfile,
  createLocalProfile,
  openProfile,
  deleteLocalProfile,
} from './auth.js';
import { formatLongDate } from './dates.js';

const byId = (id) => document.getElementById(id);
let profiles = [];
let activeId = null;

function formatCreated(isoText) {
  const date = new Date(isoText);
  return Number.isNaN(date.getTime()) ? 'on an unknown date' : formatLongDate(date);
}

/* ---------- Errors ---------- */
function handleActionError(error) {
  if (!(error instanceof StorageError)) console.error(error);
  showToast(error instanceof StorageError ? error.message : 'Something went wrong. Please try again.', 'error');
}

function showProblem(error) {
  const isStorageError = error instanceof StorageError;
  if (!isStorageError) console.error(error);
  const message = isStorageError ? error.message : 'Something went wrong while reading saved data.';
  const canRecover = isStorageError && error.code === 'corrupt';

  byId('storage-problem').innerHTML = `<div class="notice notice--warning" role="alert">
      ${icon('info', 18)}
      <div class="stack stack--sm">
        <span>${escapeHtml(message)}</span>
        ${canRecover ? '<div><button class="btn btn--danger btn--sm" type="button" id="erase-button">Erase saved app data in this browser</button></div>' : ''}
      </div>
    </div>`;
  byId('profile-region').hidden = true;
  byId('profile-form').hidden = true;

  const erase = byId('erase-button');
  if (erase) erase.addEventListener('click', eraseEverything);
}

async function eraseEverything() {
  const ok = await confirmAction({
    title: 'Erase all saved app data?',
    message: 'This removes every profile, habit and completion record saved by this app in this browser. Your theme choice is kept. This cannot be undone.',
    confirmLabel: 'Erase everything',
    danger: true,
  });
  if (!ok) return;
  try {
    await clearAllAppData();
    window.location.reload();
  } catch (error) {
    handleActionError(error);
  }
}

/* ---------- Profile list ---------- */
function renderProfiles() {
  const region = byId('profile-region');

  if (profiles.length === 0) {
    region.innerHTML = renderEmptyState({
      icon: 'target',
      title: 'No profiles yet',
      text: 'Create a profile below to start. Each profile keeps its own habits and history in this browser.',
      compact: true,
    });
    return;
  }

  const active = profiles.find((profile) => profile.id === activeId);
  const continueBlock = active
    ? `<div><a class="btn btn--primary" href="dashboard.html">Continue as ${escapeHtml(active.displayName)}</a></div>`
    : '';

  const items = profiles.map((profile) => {
    const isActive = profile.id === activeId;
    const name = escapeHtml(profile.displayName);
    const id = escapeHtml(profile.id);
    return `<li class="profile-item">
      <div>
        <p class="profile-item__name">${name} ${isActive ? '<span class="badge badge--done">Last opened</span>' : ''}</p>
        <p class="profile-item__meta">Created ${escapeHtml(formatCreated(profile.createdAt))}</p>
      </div>
      <div class="profile-item__actions">
        <button class="btn btn--secondary btn--sm" type="button" data-action="open" data-id="${id}" aria-label="Open profile ${name}">Open</button>
        <button class="btn btn--ghost btn--sm" type="button" data-action="delete" data-id="${id}" aria-label="Delete profile ${name}">Delete</button>
      </div>
    </li>`;
  }).join('');

  region.innerHTML = `<div class="stack stack--sm">${continueBlock}<ul class="profile-list" aria-label="Saved profiles">${items}</ul></div>`;
}

async function refresh() {
  profiles = await listProfiles();
  const active = await getActiveProfile();
  activeId = active ? active.id : null;
  renderProfiles();
}

/* ---------- Create form ---------- */
function showNameError(message) {
  const input = byId('profile-name');
  const error = byId('profile-name-error');
  error.textContent = message;
  error.hidden = false;
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function clearNameError() {
  const input = byId('profile-name');
  const error = byId('profile-name-error');
  error.textContent = '';
  error.hidden = true;
  input.removeAttribute('aria-invalid');
}

function bindForm() {
  const form = byId('profile-form');
  const input = byId('profile-name');

  input.addEventListener('input', clearNameError);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNameError();
    try {
      const result = await createLocalProfile(input.value);
      if (!result.ok) {
        showNameError(result.error);
        return;
      }
      await openProfile(result.profile.id);
      window.location.href = 'dashboard.html';
    } catch (error) {
      handleActionError(error);
    }
  });
}

/* ---------- Open / delete buttons ---------- */
function bindList() {
  byId('profile-region').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const profile = profiles.find((item) => item.id === button.dataset.id);
    if (!profile) return;

    try {
      if (button.dataset.action === 'open') {
        await openProfile(profile.id);
        window.location.href = 'dashboard.html';
        return;
      }
      if (button.dataset.action === 'delete') {
        const ok = await confirmAction({
          title: `Delete profile "${profile.displayName}"?`,
          message: 'This permanently deletes the profile, all of its habits and its history from this browser. This cannot be undone. Export a backup from Settings first if you might need it.',
          confirmLabel: 'Delete profile',
          danger: true,
        });
        if (!ok) return;
        await deleteLocalProfile(profile.id);
        await refresh();
        showToast(`Profile "${profile.displayName}" deleted.`, 'success');
      }
    } catch (error) {
      handleActionError(error);
    }
  });
}

/* ---------- Start ---------- */
async function start() {
  bindForm();
  bindList();
  try {
    await initStorage();
    await refresh();
  } catch (error) {
    showProblem(error);
  }
}

start();