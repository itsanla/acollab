import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';

const CLASS_LABEL = {
  NewCommentNotification: 'commented on',
  NewTaskNotification: 'created task',
  NewSubtaskNotification: 'created subtask',
  NewReactionNotification: 'reacted to',
  TaskReassignedNotification: 'reassigned',
  SubtaskReassignedNotification: 'reassigned subtask',
  NewProjectNotification: 'created project',
};

export async function activityCommand(options) {
  const config = requireConfig();
  const client = new Client(config);
  const [data, users] = await Promise.all([client.notifications(), client.users()]);

  const userById = new Map(users.map((u) => [u.id, u.display_name]));
  const tasks = data.related.Task || {};
  const projects = data.related.Project || {};

  const limit = options.limit ? Number(options.limit) : 20;
  const items = data.notifications.slice(0, limit);

  if (items.length === 0) {
    console.log(chalk.gray('No recent activity.'));
    return;
  }

  for (const n of items) {
    const who = userById.get(n.sender_id) ?? `user #${n.sender_id}`;
    const action = CLASS_LABEL[n.class] ?? n.class;
    const target =
      n.parent_type === 'Task' && tasks[n.parent_id]
        ? tasks[n.parent_id].name
        : n.parent_type === 'Project' && projects[n.parent_id]
          ? projects[n.parent_id].name
          : `${n.parent_type ?? ''} #${n.parent_id ?? ''}`;
    const when = new Date(n.created_on * 1000).toISOString().replace('T', ' ').slice(0, 16);

    console.log(`${chalk.gray(when)}  ${chalk.cyan(who)} ${action} ${chalk.bold(target)}`);
  }
}
