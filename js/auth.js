/* js/auth.js
   LOCAL DEMO PROFILES. THIS IS NOT AUTHENTICATION.

   The file is called auth.js because it decides "who is using the app", but
   there are no passwords and no security here. A profile is just a name that
   keeps one person's habits separate from another's inside the same browser.
   Anyone using this browser can open any profile. Do not describe this as
   "login" or "secure" in the UI, README or viva.

   Real authentication would need a server that checks passwords. That would
   need an external service, which we did not choose (see the project handover). */

import {
  getProfiles,
  saveProfiles,
  getActiveProfileId,
  setActiveProfileId,
  deleteUserData,
  generateId,
} from './storage.js';

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 24;
const NAME_PATTERN = /^[\p{L}\p{N} .'_-]+$/u;

/** Trims the name and squashes repeated spaces. */
export function normaliseName(name) {
  return String(name).replace(/\s+/g, ' ').trim();
}

/** Returns an error message, or '' when the (already normalised) name is acceptable. */
export function validateDisplayName(name, existingProfiles = []) {
  if (name.length === 0) return 'Enter a profile name.';
  if (name.length < NAME_MIN_LENGTH) return `Use at least ${NAME_MIN_LENGTH} characters.`;
  if (name.length > NAME_MAX_LENGTH) return `Use ${NAME_MAX_LENGTH} characters or fewer.`;
  if (!NAME_PATTERN.test(name)) return "Use only letters, numbers, spaces and these characters: . ' _ -";
  const taken = existingProfiles.some((profile) => profile.displayName.toLowerCase() === name.toLowerCase());
  if (taken) return 'A profile with that name already exists. Choose a different name.';
  return '';
}

/** All profiles, sorted by name. */
export async function listProfiles() {
  const profiles = await getProfiles();
  return profiles.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Creates a profile. Returns { ok: true, profile } or { ok: false, error }. */
export async function createLocalProfile(rawName) {
  const displayName = normaliseName(rawName);
  const profiles = await getProfiles();
  const error = validateDisplayName(displayName, profiles);
  if (error) return { ok: false, error };

  const profile = {
    id: generateId('user'),
    displayName,
    createdAt: new Date().toISOString(),
  };
  await saveProfiles([...profiles, profile]);
  return { ok: true, profile };
}

/** Makes a profile the active one. Returns the profile, or null if it does not exist. */
export async function openProfile(userId) {
  const profiles = await getProfiles();
  const profile = profiles.find((item) => item.id === userId);
  if (!profile) return null;
  await setActiveProfileId(profile.id);
  return profile;
}

/** Stops using the current profile (the profile and its data are kept). */
export async function leaveProfile() {
  await setActiveProfileId(null);
}

/** The profile currently open, or null. */
export async function getActiveProfile() {
  const activeId = await getActiveProfileId();
  if (!activeId) return null;
  const profiles = await getProfiles();
  return profiles.find((profile) => profile.id === activeId) || null;
}

/** For app pages: returns the open profile, or sends the visitor to index.html and returns null. */
export async function requireProfile() {
  const profile = await getActiveProfile();
  if (!profile) {
    window.location.replace('index.html');
    return null;
  }
  return profile;
}

/** Permanently deletes a profile and all of its habits and history. */
export async function deleteLocalProfile(userId) {
  const profiles = await getProfiles();
  await deleteUserData(userId);
  await saveProfiles(profiles.filter((profile) => profile.id !== userId));
  if ((await getActiveProfileId()) === userId) {
    await setActiveProfileId(null);
  }
}