import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything this CLI keeps lives under one folder in the user's home: the
// session token and the files downloaded from tasks. It is deliberately NOT
// inside the working directory, where a token and client documents would sit
// one `git add .` away from a repository. ACOLLAB_HOME moves it (tests, servers).
export function acollabHome() {
  return process.env.ACOLLAB_HOME || join(homedir(), '.acollab');
}

function configFile() {
  return join(acollabHome(), 'config.json');
}

// Where versions up to 0.3.0 kept the session.
const LEGACY_CONFIG_FILE = join(homedir(), '.config', 'collab-cli', 'config.json');

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in');
    this.name = 'NotLoggedInError';
  }
}

function ensureHome() {
  const dir = acollabHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// An upgrade must not log anyone out, so a session in the old location is moved
// (not copied: a second copy of the token would outlive `collab logout`).
function migrateLegacyConfig() {
  if (process.env.ACOLLAB_HOME || existsSync(configFile()) || !existsSync(LEGACY_CONFIG_FILE)) return;
  try {
    ensureHome();
    renameSync(LEGACY_CONFIG_FILE, configFile());
    chmodSync(configFile(), 0o600);
  } catch {
    /* unreadable legacy file: the user simply logs in again */
  }
}

export function loadConfig() {
  migrateLegacyConfig();
  if (!existsSync(configFile())) return null;
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  ensureHome();
  // The file holds an API token, so it is owner-only from the moment it exists.
  writeFileSync(configFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearConfig() {
  if (existsSync(configFile())) writeFileSync(configFile(), '{}', { mode: 0o600 });
}

export function configPath() {
  return configFile();
}

// Throws rather than exiting, so the caller can still emit a well-formed error
// envelope in whichever format was requested.
export function requireConfig() {
  const config = loadConfig();
  if (!config || !config.token || !config.baseUrl) {
    throw new NotLoggedInError();
  }
  return config;
}
