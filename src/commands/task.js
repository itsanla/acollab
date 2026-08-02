import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { formatDate, formatLabel, htmlToPlainText } from '../format.js';

async function resolveProjectId(client, userId, taskId) {
  const data = await client.myTasks(userId);
  const all = [...data.tasks, ...data.subtasks];
  const match = all.find((t) => String(t.id) === String(taskId));
  return match?.project_id ?? null;
}

export async function taskCommand(taskId) {
  if (!taskId) {
    console.error('Usage: collab task <taskId>  (or just: collab <taskId>)');
    console.error('Find IDs with "collab tasks" or "collab tasks --all".');
    process.exit(1);
  }
  const config = requireConfig();
  const client = new Client(config);

  const projectId = await resolveProjectId(client, config.userId, taskId);
  if (!projectId) {
    console.error(chalk.red(`Task ${taskId} isn't in your My Work list (checked open + completed).`));
    console.error('It may not be assigned to you, or the ID is wrong. Run "collab tasks --all" to check.');
    process.exit(1);
  }

  const [data, users] = await Promise.all([client.taskDetail(projectId, taskId), client.users()]);
  const t = data.single;
  const userById = new Map(users.map((u) => [u.id, u.display_name]));

  console.log(chalk.bold(`#${t.task_number} ${t.name}`));
  console.log(`${formatLabel(t.labels)}  ${chalk.gray(t.is_completed ? 'completed' : 'open')}`);
  if (t.due_on) console.log(`Due: ${formatDate(t.due_on)}`);
  console.log(`Assignee: ${t.assignee_id ? (userById.get(t.assignee_id) ?? `user #${t.assignee_id}`) : chalk.gray('unassigned')}`);
  if (t.body) {
    console.log('\n' + htmlToPlainText(t.body));
  }

  if (data.comments?.length) {
    console.log(chalk.bold(`\nComments (${data.comments.length}):`));
    for (const c of data.comments) {
      const when = new Date(c.created_on * 1000).toISOString().slice(0, 16).replace('T', ' ');
      console.log(`  ${chalk.cyan(c.created_by_name)} ${chalk.gray(when)}\n    ${htmlToPlainText(c.body)}`);
    }
  }
}
