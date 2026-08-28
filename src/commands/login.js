import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { issueToken, Client } from '../client.js';
import { saveConfig } from '../config.js';
import { emit, emitError, EXIT } from '../output.js';

const CHAR_CTRL_C = '\x03';
const CHAR_BACKSPACE = '\x7f';
const CHAR_BACKSPACE_ALT = '\x08';

// readline echoes whatever is typed, which is wrong for a password, so the
// prompt is driven manually with echo suppressed.
function askHidden(question) {
  stdout.write(question);
  let buffer = '';
  return new Promise((resolve) => {
    const cleanup = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk) => {
      const char = chunk.toString();
      if (char === '\n' || char === '\r') {
        cleanup();
        stdout.write('\n');
        resolve(buffer);
        return;
      }
      if (char === CHAR_CTRL_C) {
        cleanup();
        stdout.write('\n');
        process.exit(EXIT.USAGE);
      }
      if (char === CHAR_BACKSPACE || char === CHAR_BACKSPACE_ALT) {
        buffer = buffer.slice(0, -1);
        return;
      }
      buffer += char;
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

export async function loginCommand(url, options) {
  let email = options.email;
  let password = options.password;

  // Prompting is only possible with a terminal attached. In a pipeline the
  // credentials must arrive as flags or env vars, and saying so beats hanging.
  if (!email || !password) {
    if (!stdin.isTTY) {
      emitError({
        command: 'login',
        kind: 'credentials_required',
        message: 'Email and password are required when stdin is not a terminal',
        hint: 'Pass --email and --password, or set COLLAB_EMAIL and COLLAB_PASSWORD',
        human: options.human,
        exitCode: EXIT.USAGE,
      });
      return;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    if (!email) email = await rl.question('Email: ');
    rl.close();
    if (!password) password = await askHidden('Password: ');
  }

  const token = await issueToken(url, email, password);
  const client = new Client({ baseUrl: url, token });
  const [info, session] = await Promise.all([client.info(), client.userSession()]);

  const userId = session.logged_user_id ?? null;
  let displayName = email;
  let resolved = null;
  try {
    const users = await client.users();
    resolved = users.find((u) => u.id === userId) || users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (resolved) displayName = resolved.display_name;
  } catch {
    /* the session is still valid without the directory lookup */
  }

  saveConfig({
    baseUrl: url.replace(/\/+$/, ''),
    email,
    token,
    userId: userId ?? resolved?.id ?? null,
    displayName,
    appVersion: info.version,
  });

  emit({
    command: 'login',
    data: {
      logged_in: true,
      user: { id: userId ?? resolved?.id ?? null, name: displayName, email },
      server: { url: url.replace(/\/+$/, ''), application: info.application, version: info.version },
    },
    meta: { api_requests: client.requestCount },
    human: options.human,
    renderHuman: (d) => {
      console.log(`Logged in to ${d.server.application} ${d.server.version} as ${d.user.name}`);
    },
  });
}
