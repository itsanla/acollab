import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { formatDate, formatLabel } from '../format.js';

export async function taskCommand(projectId, taskId) {
  if (!projectId || !taskId) {
    console.error('Usage: collab task <project-id> <task-id>  (run "collab tasks" first to find these IDs)');
    process.exit(1);
  }
  const config = requireConfig();
  const client = new Client(config);
  const data = await client.taskDetail(projectId, taskId);
  const t = data.single;

  console.log(chalk.bold(`#${t.task_number} ${t.name}`));
  console.log(`${formatLabel(t.labels)}  ${chalk.gray(t.is_completed ? 'completed' : 'open')}`);
  if (t.due_on) console.log(`Due: ${formatDate(t.due_on)}`);
  console.log(`Assignee: ${t.assignee_id ?? chalk.gray('unassigned')}`);
  if (t.body) {
    console.log('\n' + t.body.replace(/<[^>]+>/g, '').trim());
  }

  if (data.comments?.length) {
    console.log(chalk.bold(`\nComments (${data.comments.length}):`));
    for (const c of data.comments) {
      console.log(`  ${chalk.cyan(c.created_by_name)}: ${(c.body || '').replace(/<[^>]+>/g, '').trim()}`);
    }
  }
}
