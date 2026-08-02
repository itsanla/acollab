import chalk from 'chalk';
import { clearConfig } from '../config.js';

export function logoutCommand() {
  clearConfig();
  console.log(chalk.green('Logged out. Local session cleared.'));
}
