import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { emit } from '../output.js';
import { toIso } from '../format.js';

// ActiveCollab names these classes after the event, not the object, so they are
// mapped to plain verbs rather than passed through raw.
const ACTION = {
  NewCommentNotification: 'commented_on',
  NewTaskNotification: 'created_task',
  NewSubtaskNotification: 'created_subtask',
  NewReactionNotification: 'reacted_to',
  TaskReassignedNotification: 'reassigned',
  SubtaskReassignedNotification: 'reassigned_subtask',
  NewProjectNotification: 'created_project',
  InstanceCreatedActivityLog: 'created',
  InstanceUpdatedActivityLog: 'updated',
  CommentCreatedActivityLog: 'commented_on',
};

function labelFor(cls) {
  return ACTION[cls] || cls?.replace(/(Notification|ActivityLog)$/, '') || 'unknown';
}

export async function activityCommand(options) {
  const config = requireConfig();
  const client = new Client(config);

  const source = options.feed === 'project' ? 'whats-new' : 'notifications';
  const [payload, users] = await Promise.all([
    source === 'whats-new' ? client.whatsNew() : client.notifications(),
    client.users(),
  ]);

  const nameById = new Map(users.map((u) => [u.id, u.display_name]));
  const related = payload.related || {};
  const tasks = related.Task || {};
  const projects = related.Project || {};
  const comments = related.Comment || {};

  const rows = payload.notifications || payload.activity_logs || [];
  // undefined means "not supplied" and falls back to the default; 0 is a real
  // request for zero rows.
  const limit = options.limit === undefined ? 25 : Number(options.limit);

  const events = rows.slice(0, limit).map((n) => {
    const parentType = n.parent_type || null;
    const parentId = n.parent_id ?? null;
    const target =
      parentType === 'Task' && tasks[parentId]
        ? { type: 'Task', id: parentId, name: tasks[parentId].name, project_id: tasks[parentId].project_id ?? null }
        : parentType === 'Project' && projects[parentId]
          ? { type: 'Project', id: parentId, name: projects[parentId].name }
          : { type: parentType, id: parentId, name: null };

    const commentBody = n.comment_id && comments[n.comment_id]
      ? (comments[n.comment_id].body_plain_text || '').trim().slice(0, 400)
      : null;

    return {
      id: n.id,
      action: labelFor(n.class),
      raw_class: n.class,
      actor: {
        id: n.sender_id ?? n.created_by_id ?? null,
        name: nameById.get(n.sender_id ?? n.created_by_id) ?? n.created_by_name ?? null,
      },
      target,
      comment_excerpt: commentBody,
      occurred_at: toIso(n.created_on),
      url: n.url_path ? `${config.baseUrl}${n.url_path}` : null,
    };
  });

  emit({
    command: 'activity',
    data: { feed: source, events },
    meta: {
      api_requests: client.requestCount,
      counts: { returned: events.length, available: rows.length },
      ...(rows.length > events.length ? { truncated: true, limit } : {}),
    },
    human: options.human,
    renderHuman: (d, meta) => {
      for (const e of d.events) {
        const when = e.occurred_at?.slice(0, 16).replace('T', ' ') ?? '';
        console.log(
          `${chalk.gray(when)}  ${chalk.cyan(e.actor.name ?? '?')} ${e.action} ${chalk.bold(e.target.name ?? `${e.target.type} #${e.target.id}`)}`,
        );
        if (e.comment_excerpt) console.log(chalk.gray(`    "${e.comment_excerpt.slice(0, 120)}"`));
      }
      console.log(chalk.gray(`\n${meta.counts.returned} of ${meta.counts.available} events`));
    },
  });
}
