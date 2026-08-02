import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';

export async function whoamiCommand() {
  const config = requireConfig();
  const client = new Client(config);
  try {
    const info = await client.info();
    console.log(`${chalk.bold(config.displayName)} <${config.email}>`);
    console.log(`Server: ${config.baseUrl} (${info.application} ${info.version})`);
  } catch (err) {
    console.error(chalk.red(`Session looks broken: ${err.message}`));
    console.error('Try: collab login <url>');
    process.exit(1);
  }
}
