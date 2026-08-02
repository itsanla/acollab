import Table from 'cli-table3';
import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { formatDate, formatLabel, statusIcon } from '../format.js';

export async function tasksCommand(options) {
  const config = requireConfig();
  if (!config.userId) {
    console.error('No user ID stored for this session, re-run: collab login <url>');
    process.exit(1);
  }
  const client = new Client(config);
  const data = await client.myTasks(config.userId);

  let tasks = data.tasks;
  if (!options.all) tasks = tasks.filter((t) => !t.is_completed);

  const projects = data.related.Project || {};
  const taskLists = data.related.TaskList || {};

  // Group: project_id -> task_list_id -> [tasks]
  const grouped = new Map();
  for (const task of tasks) {
    if (!grouped.has(task.project_id)) grouped.set(task.project_id, new Map());
    const byList = grouped.get(task.project_id);
    if (!byList.has(task.task_list_id)) byList.set(task.task_list_id, []);
    byList.get(task.task_list_id).push(task);
  }

  if (grouped.size === 0) {
    console.log(chalk.gray('No open tasks assigned to you.'));
    return;
  }

  for (const [projectId, byList] of grouped) {
    const project = projects[projectId];
    console.log(chalk.bold.cyan(`\n${project?.name ?? `Project #${projectId}`}`));

    for (const [taskListId, taskGroup] of byList) {
      const taskList = taskLists[taskListId];
      console.log(chalk.bold(`  ${taskList?.name ?? `List #${taskListId}`}`));

      const table = new Table({
        head: ['', 'ID', 'Name', 'Label', 'Due'],
        style: { head: [] },
      });
      for (const t of taskGroup) {
        table.push([statusIcon(t), t.id, t.name, formatLabel(t.labels), formatDate(t.due_on)]);
      }
      console.log(table.toString());
    }
  }

  console.log(chalk.gray(`\n${tasks.length} task(s)${options.all ? '' : ' (open only, use --all to include completed)'}`));
}
