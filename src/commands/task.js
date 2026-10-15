import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { loadContext, absorbTaskLists, absorbProjects } from '../context.js';
import { normalizeTask, normalizeComment, normalizeSubtask, normalizeTimeRecord } from '../normalize.js';
import { emit, emitError, EXIT } from '../output.js';
import { resolveUser } from '../format.js';
import { RANGE_KEYWORDS } from '../daterange.js';
import { normalizeAttachment, attachmentSummary, taskFilesDir } from '../attachments.js';
import { materializeAttachments } from '../files.js';

// A task id alone is not addressable in this API: every task read needs its
// project id. Resolution goes cheapest-first.
export async function resolveProjectId(client, ctx, taskId, selfId) {
  const wanted = Number(taskId);

  // 1. The caller's own open work is one request and covers the common case.
  try {
    const mine = await client.userTasks(selfId);
    absorbTaskLists(ctx, mine.related);
    absorbProjects(ctx, mine.related);
    const hit = [...(mine.tasks || []), ...(mine.subtasks || [])].find((t) => t.id === wanted);
    if (hit) return { projectId: hit.project_id, via: 'own_open_tasks' };
  } catch {
    /* fall through to the broad scan */
  }

  // 2. Otherwise sweep every project, archived ones included. Each response
  //    carries its open tasks AND the ids of its completed ones, so one pass
  //    finds anything visible to us, including other people's tasks and
  //    finished work parked in a closed project.
  const found = await client.mapLimit(ctx.allProjects, async (project) => {
    try {
      const payload = await client.projectTasks(project.id);
      const openHit = (payload.tasks || []).some((t) => t.id === wanted);
      const doneHit = (payload.completed_task_ids || []).includes(wanted);
      if (payload.task_lists) {
        for (const tl of payload.task_lists) ctx.taskListsById.set(tl.id, tl);
      }
      return openHit || doneHit ? project.id : null;
    } catch {
      return null;
    }
  });

  const projectId = found.find((id) => id !== null);
  return projectId ? { projectId, via: 'project_scan' } : { projectId: null, via: 'not_found' };
}

// Accepts what people actually paste: a bare id, or the task's web URL
// (https://host/projects/503/tasks/148709), which also names the project and so
// skips the project sweep.
export function parseTaskRef(arg) {
  const s = String(arg ?? '').trim();
  if (/^\d+$/.test(s)) return { taskId: s, projectId: null };
  const m = s.match(/\/projects\/(\d+)\/tasks\/(\d+)(?:[/?#]|$)/);
  return m ? { taskId: m[2], projectId: Number(m[1]) } : null;
}

export async function taskCommand(taskArg, options) {
  const ref = parseTaskRef(taskArg);
  const taskId = ref?.taskId ?? String(taskArg);
  // Rejected before any network work: a non-numeric id can never match, and
  // discovering that via an 18-request sweep wastes two seconds to report a
  // "not found" that is really a malformed argument.
  if (!ref) {
    // "collab task today" is a natural thing to type for a date window. It
    // belongs to the plural command, so say so instead of only refusing.
    const looksLikeRange =
      RANGE_KEYWORDS.includes(String(taskId).toLowerCase()) ||
      /^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?$/.test(String(taskId)) ||
      /^[+-]?\d+d$/.test(String(taskId));

    emitError({
      command: 'task',
      kind: 'bad_argument',
      message: `Expected a numeric task id or a task URL (got "${taskId}")`,
      hint: looksLikeRange
        ? `"${taskId}" is a date range, and ranges list tasks rather than open one. Use: collab tasks ${taskId}`
        : 'Find ids with "collab tasks" or "collab search <text>"',
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }

  const config = requireConfig();
  const nowMs = Date.now();
  const client = new Client(config);
  const ctx = await loadContext(client, { baseUrl: config.baseUrl, nowMs });

  let projectId = options.project ? Number(options.project) : ref.projectId;
  let via = options.project ? 'explicit_flag' : ref.projectId ? 'task_url' : null;

  if (!projectId) {
    const resolved = await resolveProjectId(client, ctx, taskId, config.userId);
    projectId = resolved.projectId;
    via = resolved.via;
  }

  if (!projectId) {
    emitError({
      command: 'task',
      kind: 'task_not_found',
      message: `Task ${taskId} was not found in any project visible to you`,
      hint: 'If you know the project, pass it directly: collab task <id> --project <projectId>',
      human: options.human,
      exitCode: EXIT.ERROR,
    });
    return;
  }

  const detail = await client.taskDetail(projectId, taskId);
  const raw = detail.single;
  if (detail.task_list?.id) ctx.taskListsById.set(detail.task_list.id, detail.task_list);

  // Detail is exactly where the full description belongs.
  const task = normalizeTask(raw, ctx, { fullBody: true });

  let timeRecords = [];
  if (options.time) {
    try {
      const tr = await client.taskTimeRecords(projectId, taskId);
      timeRecords = (tr.time_records || []).map((r) => normalizeTimeRecord(r, ctx));
    } catch {
      timeRecords = [];
    }
  }

  const commentsTruncated = (raw.comments_count ?? 0) > (detail.comments || []).length;
  const comments = (detail.comments || [])
    .map((c) => normalizeComment(c, ctx))
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const attachments = (raw.attachments || []).map((a) => normalizeAttachment(a, { type: 'task' }));
  // The same objects that sit in `attachments` and in comments[].attachments, so
  // the paths recorded on them show up in both places.
  const allFiles = [...attachments, ...comments.flatMap((c) => c.attachments)];
  const fetched =
    options.files !== false && allFiles.length
      ? await materializeAttachments(client, allFiles, {
          dir: taskFilesDir(projectId, taskId),
          allFiles: Boolean(options.allFiles),
        })
      : null;

  const data = {
    ...task,
    resolved_via: via,
    // The endpoint returns bare ids here; resolving them keeps the promise that
    // no consumer has to join against a separate people list.
    subscribers: (detail.subscribers || []).map((s) =>
      resolveUser(ctx.users, typeof s === 'object' ? s.id : s),
    ),
    subtask_items: (detail.subtasks || []).map((s) => normalizeSubtask(s, ctx)),
    // The detail endpoint hands back at most 30 comments and offers no paging
    // parameter (the dedicated /comments route 500s). Silently returning 30 of
    // 43 would make any summary of the discussion quietly wrong, so the shortfall
    // is stated rather than hidden.
    comments_meta: {
      total: raw.comments_count ?? 0,
      returned: (detail.comments || []).length,
      truncated: commentsTruncated,
      note: commentsTruncated
        ? 'The API caps this endpoint at the 30 most recent comments and exposes no way to page further. Older comments are only visible in the web UI.'
        : null,
    },
    comments,
    // Files on the task itself; each comment carries its own under
    // comments[].attachments. files_meta covers both.
    attachments,
    files_meta: filesMeta(allFiles, attachments.length, fetched, commentsTruncated, options),
    reminders: (detail.reminders || []).length,
    tracked_time_hours: detail.tracked_time ?? 0,
    tracked_expenses: detail.tracked_expenses ?? 0,
    ...(options.time ? { time_records: timeRecords } : {}),
  };

  emit({
    command: 'task',
    data,
    meta: { api_requests: client.requestCount, project_id: projectId },
    human: options.human,
    renderHuman: renderTaskHuman,
  });
}

function filesMeta(all, fromTask, fetched, commentsTruncated, options) {
  const notes = [];
  if (options.files === false && all.length) notes.push('Files were not fetched (--no-files); attachments carry no paths.');
  if (commentsTruncated) notes.push('Files on comments older than the 30 newest are not reachable through the API.');
  return {
    ...attachmentSummary(all),
    from_task: fromTask,
    from_comments: all.length - fromTask,
    directory: fetched?.directory ?? null,
    ...(fetched
      ? {
          readable: fetched.readable,
          downloaded: fetched.downloaded,
          cached: fetched.cached,
          skipped: fetched.skipped,
          failed: fetched.failed,
        }
      : {}),
    complete: !commentsTruncated,
    note: notes.length ? notes.join(' ') : null,
  };
}

function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachmentHuman(a, indent) {
  console.log(`${indent}#${a.id} ${a.name} ${chalk.gray(`(${a.kind}, ${formatBytes(a.size_bytes)})`)}`);
  const pad = ' '.repeat(indent.length + 2);
  if (a.path) console.log(chalk.green(`${pad}${a.path}`));
  if (a.note) console.log(chalk.yellow(`${pad}${a.note}`));
}

function renderTaskHuman(t) {
  console.log(chalk.bold(`\n#${t.number} ${t.name}`));
  const state = t.status === 'completed' ? chalk.green('completed') : chalk.yellow('open');
  const labels = t.labels.length ? ` [${t.labels.join(', ')}]` : '';
  console.log(`${state}${labels}`);
  console.log(chalk.gray(`${t.project?.name ?? ''} / ${t.task_list?.name ?? ''}`));
  console.log(`Assignee : ${t.assignee?.name ?? chalk.gray('unassigned')}`);
  console.log(`Created  : ${t.created_at?.slice(0, 10)} by ${t.created_by?.name ?? '?'}`);

  if (t.due_on) {
    const late = t.is_overdue ? chalk.red(` (${Math.abs(t.days_until_due)} days overdue)`) : '';
    console.log(`Due      : ${t.due_on}${late}`);
  }
  if (t.completed_at) console.log(`Completed: ${t.completed_at.slice(0, 10)} by ${t.completed_by?.name ?? '?'}`);
  if (t.estimate_hours) console.log(`Estimate : ${t.estimate_hours}h`);
  if (t.tracked_time_hours) console.log(`Tracked  : ${t.tracked_time_hours}h`);
  if (t.dependencies.blocked_by) console.log(chalk.red(`Blocked by ${t.dependencies.blocked_by} open task(s)`));
  if (t.url) console.log(chalk.gray(t.url));

  if (t.body) {
    console.log(chalk.bold('\nDescription'));
    console.log(t.body);
  }

  if (t.subtask_items.length) {
    console.log(chalk.bold(`\nSubtasks (${t.subtasks.completed}/${t.subtasks.total} done)`));
    for (const s of t.subtask_items) {
      const mark = s.status === 'completed' ? chalk.green('x') : ' ';
      console.log(`  [${mark}] ${s.name}${s.assignee?.name ? chalk.gray(` — ${s.assignee.name}`) : ''}`);
    }
  }

  if (t.attachments.length) {
    console.log(chalk.bold(`\nAttachments (${t.attachments.length})`));
    for (const a of t.attachments) renderAttachmentHuman(a, '  ');
  }

  if (t.comments.length) {
    const cm = t.comments_meta;
    const suffix = cm?.truncated ? chalk.yellow(` — showing newest ${cm.returned} of ${cm.total}`) : '';
    console.log(chalk.bold(`\nComments (${t.comments.length})`) + suffix);
    for (const c of t.comments) {
      console.log(`\n  ${chalk.cyan(c.author.name)} ${chalk.gray(c.created_at?.slice(0, 16).replace('T', ' '))}`);
      console.log(`  ${c.body.split('\n').join('\n  ')}`);
      for (const a of c.attachments) renderAttachmentHuman(a, '  + ');
    }
  }
  const fm = t.files_meta;
  if (fm.directory) {
    console.log(chalk.gray(`\n${fm.readable}/${fm.total} file(s) readable in ${fm.directory}`));
  }
  if (fm.note) console.log(chalk.yellow(fm.note));
  console.log('');
}
