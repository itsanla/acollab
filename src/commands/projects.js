import chalk from 'chalk';
import Table from 'cli-table3';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { loadContext } from '../context.js';
import { normalizeProject } from '../normalize.js';
import { emit } from '../output.js';

export async function projectsCommand(options) {
  const config = requireConfig();
  const nowMs = Date.now();
  const client = new Client(config);
  const ctx = await loadContext(client, { baseUrl: config.baseUrl, nowMs });

  let raw = ctx.projects;
  if (options.archived) {
    raw = await client.archivedProjects();
  }

  const projects = raw
    .map((p) => normalizeProject(p, ctx))
    .sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || ''));

  emit({
    command: 'projects',
    data: { scope: options.archived ? 'archived' : 'active', projects },
    meta: { api_requests: client.requestCount, counts: { returned: projects.length } },
    human: options.human,
    renderHuman: (d) => {
      const table = new Table({
        head: ['ID', 'Name', 'Open', 'Members', 'Leader', 'Last activity'],
        style: { head: [] },
        colWidths: [7, 44, 8, 9, 22, 14],
        wordWrap: true,
      });
      for (const p of d.projects) {
        table.push([
          p.id,
          p.status === 'completed' ? chalk.gray(p.name) : p.name,
          p.open_task_count ?? '',
          p.member_count,
          p.leader?.name || '',
          p.last_activity_at?.slice(0, 10) || '',
        ]);
      }
      console.log(table.toString());
    },
  });
}
