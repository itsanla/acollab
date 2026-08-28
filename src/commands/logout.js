import { clearConfig, configPath } from '../config.js';
import { emit } from '../output.js';

export function logoutCommand(options) {
  clearConfig();
  emit({
    command: 'logout',
    data: { logged_out: true, session_file: configPath() },
    human: options.human,
    renderHuman: () => console.log('Logged out. Local session cleared.'),
  });
}
