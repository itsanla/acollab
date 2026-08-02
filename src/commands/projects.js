import Table from 'cli-table3';
import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';

export async function projectsCommand() {
  const config = requireConfig();
  const client = new Client(config);
  const projects = await client.projects();

  const table = new Table({ head: ['ID', 'Name', 'Tasks', 'Last activity'] });
  for (const p of projects) {
    table.push([
      p.id,
      p.is_completed ? chalk.gray(p.name) : p.name,
      p.count_tasks ?? 0,
      p.last_activity_on ? new Date(p.last_activity_on * 1000).toISOString().slice(0, 10) : '',
    ]);
  }
  console.log(table.toString());
}
