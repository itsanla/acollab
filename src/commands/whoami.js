import chalk from 'chalk';
import { requireConfig, configPath } from '../config.js';
import { Client } from '../client.js';
import { emit } from '../output.js';

export async function whoamiCommand(options) {
  const config = requireConfig();
  const client = new Client(config);

  const [info, session] = await Promise.all([client.info(), client.userSession()]);
  const users = await client.users();
  const me = users.find((u) => u.id === (session.logged_user_id ?? config.userId));

  const data = {
    user: me
      ? {
          id: me.id,
          name: me.display_name,
          email: me.email,
          title: me.title || null,
          company_id: me.company_id ?? null,
        }
      : { id: config.userId, name: config.displayName, email: config.email },
    server: {
      url: config.baseUrl,
      application: info.application,
      version: info.version,
      instance_id: session.instance_id ?? null,
      projects_total: session.projects_total ?? null,
    },
    // The instance's own display preferences. Worth surfacing because every
    // timestamp this CLI emits is UTC ISO, and this is what the user sees in
    // the web UI instead.
    preferences: {
      timezone: session.settings?.timezone ?? null,
      gmt_offset: session.settings?.gmt_offset ?? null,
      date_format: session.settings?.format_date ?? null,
      time_format: session.settings?.format_time ?? null,
    },
    session_file: configPath(),
  };

  emit({
    command: 'whoami',
    data,
    meta: { api_requests: client.requestCount },
    human: options.human,
    renderHuman: (d) => {
      console.log(`${chalk.bold(d.user.name)} <${d.user.email}>${d.user.title ? chalk.gray(` — ${d.user.title}`) : ''}`);
      console.log(`Server: ${d.server.url} (${d.server.application} ${d.server.version})`);
      console.log(chalk.gray(`Timezone: ${d.preferences.timezone ?? 'unknown'} | ${d.server.projects_total ?? '?'} projects visible`));
    },
  });
}
