import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import chalk from 'chalk';
import { issueToken, Client } from '../client.js';
import { saveConfig } from '../config.js';

const CHAR_CTRL_C = '\x03';
const CHAR_BACKSPACE = '\x7f';
const CHAR_BACKSPACE_ALT = '\x08';

// readline doesn't mask input by default; this mutes the raw echo for one prompt.
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
        process.exit(1);
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
  if (!url) {
    console.error('Usage: collab login <self-hosted-url> [--email you@example.com]');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = options.email || (await rl.question('Email: '));
    rl.close();
    const password = options.password || (await askHidden('Password: '));

    const token = await issueToken(url, email, password);
    const client = new Client({ baseUrl: url, token });
    const info = await client.info();
    const user = await client.findUserByEmail(email);

    if (!user) {
      console.error(chalk.yellow('Logged in, but could not find your own user record via /users (permissions?). "collab whoami" may not work.'));
    }

    saveConfig({
      baseUrl: url,
      email,
      token,
      userId: user?.id ?? null,
      displayName: user?.display_name ?? email,
      appVersion: info.version,
    });

    console.log(chalk.green(`Logged in to ${info.application} ${info.version} as ${user?.display_name ?? email}`));
  } catch (err) {
    console.error(chalk.red(`Login failed: ${err.message}`));
    process.exit(1);
  }
}
