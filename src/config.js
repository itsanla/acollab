import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.config', 'collab-cli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in');
    this.name = 'NotLoggedInError';
  }
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  // The file holds an API token, so it is owner-only from the moment it exists.
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearConfig() {
  if (existsSync(CONFIG_FILE)) writeFileSync(CONFIG_FILE, '{}', { mode: 0o600 });
}

export function configPath() {
  return CONFIG_FILE;
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
