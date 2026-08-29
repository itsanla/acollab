import chalk from 'chalk';
import Table from 'cli-table3';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { loadContext, absorbTaskLists, absorbProjects, resolveUserRef } from '../context.js';
import { normalizeTask } from '../normalize.js';
import { emit, emitError, EXIT } from '../output.js';
import { parseRange, dateValueFor, todayLocal, DATE_FIELDS, RANGE_KEYWORDS } from '../daterange.js';

// Open assignments come from one cheap call. Completed ones do not exist on that
// endpoint at all, so they have to be gathered per project from the archive and
// filtered back down to the person we care about.
async function fetchCompletedFor(client, ctx, userId) {
  // Archived projects are included: finished work is exactly what ends up there.
  const archives = await client.mapLimit(ctx.allProjects, async (project) => {
    try {
      // The archive carries task_list_id but no names, and completed tasks often
      // sit in lists that no open task references, so the names have to come from
      // the project's own task payload or every completed row reads "null".
      const [listing, archive] = await Promise.all([
        client.projectTasks(project.id).catch(() => null),
        client.allProjectArchivedTasks(project.id),
      ]);
      for (const tl of listing?.task_lists || []) {
        ctx.taskListsById.set(tl.id, tl);
      }
      return archive;
    } catch {
      // A project we can list but cannot read the archive of should not sink the
      // whole command; the meta block reports the shortfall instead.
      return null;
    }
  });

  const unreadable = archives.filter((a) => a === null).length;
  const capped = archives.filter((a) => a?.truncated).length;
  const completed = archives
    .filter(Boolean)
    .flatMap((a) => a.tasks)
    .filter((t) => t.assignee_id === userId);

  return { completed, unreadable, capped };
}

export async function tasksCommand(range, options) {
  const config = requireConfig();
  const nowMs = Date.now();
  const client = new Client(config);
  const ctx = await loadContext(client, { baseUrl: config.baseUrl, nowMs });

  const target = resolveUserRef(ctx, options.user, config.userId);
  if (target.error === 'empty') {
    emitError({
      command: 'tasks',
      kind: 'empty_user',
      message: '--user was given an empty value',
      hint: 'Omit --user for your own tasks, or pass "me", an id, an email, or part of a name',
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }
  if (target.error === 'ambiguous') {
    const shown = target.candidates.map((c) => `${c.id} (${c.email})`).join(', ');
    emitError({
      command: 'tasks',
      kind: 'ambiguous_user',
      message: `"${options.user}" matches ${target.match_count} people`,
      hint: target.candidates_truncated
        ? `Use an id or email. First ${target.candidates.length} of ${target.match_count}: ${shown}`
        : `Use an id or email: ${shown}`,
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }
  if (target.error === 'not_found') {
    emitError({
      command: 'tasks',
      kind: 'user_not_found',
      message: `No user matches "${options.user}"`,
      hint: 'List everyone with: collab people',
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }

  const dateField = String(options.dateField || 'due').toLowerCase();
  if (!DATE_FIELDS.includes(dateField)) {
    emitError({
      command: 'tasks',
      kind: 'bad_argument',
      message: `--date-field must be one of ${DATE_FIELDS.join(', ')} (got "${options.dateField}")`,
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }

  const today = todayLocal(nowMs, ctx.gmtOffset);
  const rangeExpr = range ?? options.due ?? null;
  const parsed = parseRange(rangeExpr, { today, firstWeekDay: ctx.firstWeekDay });
  if (parsed?.error) {
    emitError({
      command: 'tasks',
      kind: 'bad_range',
      message: parsed.message,
      hint: `Use a keyword (${RANGE_KEYWORDS.join(', ')}), a date (2026-09-01), a span (2026-09-01..2026-09-30), or a relative window (+7d, -30d)`,
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }

  // Filtering on when something was FINISHED only makes sense over finished
  // work, so the status default follows the question being asked rather than
  // silently returning nothing.
  const statusDefault = dateField === 'completed' ? 'completed' : 'open';
  const status = (options.status || statusDefault).toLowerCase();
  if (!['open', 'completed', 'all'].includes(status)) {
    emitError({
      command: 'tasks',
      kind: 'bad_argument',
      message: `--status must be one of open, completed, all (got "${options.status}")`,
      hint: 'Use --status open, --status completed, or --status all',
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }

  const wantOpen = status === 'open' || status === 'all';
  const wantCompleted = status === 'completed' || status === 'all';

  let openRaw = [];
  let subtaskRaw = [];
  let completedRaw = [];
  let unreadableProjects = 0;
  let cappedProjects = 0;

  if (wantOpen) {
    const payload = await client.userTasks(target.id);
    absorbTaskLists(ctx, payload.related);
    absorbProjects(ctx, payload.related);
    openRaw = payload.tasks || [];
    subtaskRaw = payload.subtasks || [];
  }

  if (wantCompleted) {
    const res = await fetchCompletedFor(client, ctx, target.id);
    completedRaw = res.completed;
    unreadableProjects = res.unreadable;
    cappedProjects = res.capped;
  }

  let tasks = [...openRaw, ...completedRaw].map((t) => normalizeTask(t, ctx));

  let unknownProject = false;
  if (options.project !== undefined) {
    const pid = Number(options.project);
    // "No tasks" and "no such project" look identical once the filter has run,
    // and an agent would report the wrong thing. They are distinguished here.
    unknownProject = !ctx.projectsById.has(pid);
    tasks = tasks.filter((t) => t.project?.id === pid);
  }
  if (options.overdue) {
    tasks = tasks.filter((t) => t.is_overdue);
  }
  let undatedExcluded = 0;
  let outsideRange = 0;
  if (parsed) {
    // The two reasons a task drops out are counted separately: "has no due date"
    // and "is dated outside the window" lead to different next actions, and
    // lumping them together would misexplain an empty result.
    tasks = tasks.filter((t) => {
      const value = dateValueFor(t, dateField, ctx.gmtOffset);
      if (value === null) {
        undatedExcluded += 1;
        return false;
      }
      const inside = value >= parsed.from && value <= parsed.to;
      if (!inside) outsideRange += 1;
      return inside;
    });
  }
  if (options.label) {
    const needle = options.label.toLowerCase();
    tasks = tasks.filter((t) => t.labels.some((l) => l.toLowerCase().includes(needle)));
  }

  // Open work first, then by urgency: a null due date sorts last because an
  // undated task is never the most pressing thing on the list.
  tasks.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    if (a.status === 'completed') return (b.completed_at || '').localeCompare(a.completed_at || '');
    if (a.due_on === b.due_on) return 0;
    if (!a.due_on) return 1;
    if (!b.due_on) return -1;
    return a.due_on.localeCompare(b.due_on);
  });

  // Compared against undefined, not truthiness: --limit 0 is a real request for
  // zero rows, and treating it as "no limit" would return everything instead.
  const limit = options.limit === undefined ? null : Number(options.limit);
  const truncated = limit !== null && tasks.length > limit;
  if (truncated) tasks = tasks.slice(0, limit);

  const person = ctx.users.get(target.id) || { id: target.id, name: null };
  const data = {
    user: person,
    filters: {
      status,
      project: options.project ? Number(options.project) : null,
      overdue_only: Boolean(options.overdue),
      label: options.label || null,
      date_range: parsed
        ? { field: dateField, from: parsed.from, to: parsed.to, expression: parsed.label }
        : null,
      // Stated so a consumer can reproduce or shift the window without having to
      // know the instance's timezone rules.
      today_in_instance_timezone: today,
    },
    tasks,
    // Subtasks are separate objects with their own ids; without the parent id
    // they look like tasks that "collab task <id>" cannot find.
    subtasks: subtaskRaw.map((s) => ({
      ...normalizeTask(s, ctx),
      parent_task_id: s.task_id ?? s.parent_id ?? null,
      is_subtask: true,
    })),
  };

  const meta = {
    api_requests: client.requestCount,
    counts: {
      returned: tasks.length,
      open: tasks.filter((t) => t.status === 'open').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      overdue: tasks.filter((t) => t.is_overdue).length,
    },
    ...(truncated ? { truncated: true, limit } : {}),
    ...(unreadableProjects
      ? { warning: `${unreadableProjects} project archive(s) were unreadable and are missing from the completed set` }
      : {}),
    ...(cappedProjects
      ? { warning_truncated: `${cappedProjects} project archive(s) hit the page cap; older completed tasks may be missing` }
      : {}),
    ...(parsed
      ? {
          filtered_out: {
            outside_range: outsideRange,
            no_date_on_field: undatedExcluded,
            field: dateField,
          },
        }
      : {}),
    ...(unknownProject
      ? {
          warning_project: `Project ${options.project} is not among the projects visible to you, so this result is empty for that reason rather than because the project has no tasks`,
        }
      : {}),
  };

  emit({ command: 'tasks', data, meta, human: options.human, renderHuman: renderTasksHuman });
}

function renderTasksHuman(data, meta) {
  const who = data.user?.name || `user ${data.user?.id}`;
  const dr = data.filters.date_range;
  const window = dr ? `, ${dr.field} ${dr.from}..${dr.to} (${dr.expression})` : '';
  console.log(chalk.bold(`\n${who} — ${meta.counts.returned} task(s), ${data.filters.status}${window}`));
  if (meta.filtered_out) {
    const f = meta.filtered_out;
    console.log(
      chalk.gray(`filtered out: ${f.outside_range} outside the window, ${f.no_date_on_field} with no ${f.field} date`),
    );
  }
  if (meta.warning) console.log(chalk.yellow(meta.warning));

  const byProject = new Map();
  for (const t of data.tasks) {
    const key = t.project?.name || `Project #${t.project?.id ?? '?'}`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }

  if (byProject.size === 0) {
    console.log(chalk.gray('No tasks match.'));
    return;
  }

  for (const [projectName, list] of byProject) {
    console.log(chalk.bold.cyan(`\n${projectName}`));
    const table = new Table({
      head: ['State', 'ID', 'Name', 'List', 'Label', 'Due', 'Days'],
      style: { head: [] },
      colWidths: [9, 9, 50, 20, 18, 12, 7],
      wordWrap: true,
    });
    for (const t of list) {
      const icon =
        t.status === 'completed'
          ? chalk.green('done')
          : t.status === 'trashed'
            ? chalk.red('trashed')
            : chalk.gray('open');
      const days =
        t.status === 'completed'
          ? ''
          : t.days_until_due === null
            ? ''
            : t.is_overdue
              ? chalk.red(String(t.days_until_due))
              : String(t.days_until_due);
      table.push([
        icon,
        t.id,
        t.name,
        t.task_list?.name || '',
        t.labels.join(', '),
        t.due_on || '',
        days,
      ]);
    }
    console.log(table.toString());
  }

  console.log(
    chalk.gray(
      `\n${meta.counts.open} open, ${meta.counts.completed} completed, ${meta.counts.overdue} overdue (${meta.api_requests} API calls)`,
    ),
  );
}
