import chalk from 'chalk';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { loadContext, absorbTaskLists, absorbProjects } from '../context.js';
import { normalizeTask } from '../normalize.js';
import { emit } from '../output.js';
import { toIso } from '../format.js';

// One call that answers "what is this person working on, and what needs
// attention first". Built for an agent opening a session with no prior context,
// so it is deliberately opinionated: it buckets by urgency rather than handing
// back a flat list and leaving the triage to the reader.
export async function briefCommand(options) {
  const config = requireConfig();
  const nowMs = Date.now();
  const client = new Client(config);
  const ctx = await loadContext(client, { baseUrl: config.baseUrl, nowMs });

  const [mine, notifications] = await Promise.all([
    client.userTasks(config.userId),
    client.notifications().catch(() => ({ notifications: [], related: {} })),
  ]);

  absorbTaskLists(ctx, mine.related);
  absorbProjects(ctx, mine.related);

  const tasks = (mine.tasks || []).map((t) => normalizeTask(t, ctx));

  const buckets = {
    overdue: [],
    due_today: [],
    due_this_week: [],
    later: [],
    no_due_date: [],
  };
  for (const t of tasks) {
    const d = t.days_until_due;
    if (d === null) buckets.no_due_date.push(t);
    else if (d < 0) buckets.overdue.push(t);
    else if (d === 0) buckets.due_today.push(t);
    else if (d <= 7) buckets.due_this_week.push(t);
    else buckets.later.push(t);
  }
  for (const list of Object.values(buckets)) {
    list.sort((a, b) => (a.due_on || '').localeCompare(b.due_on || ''));
  }

  const byProject = new Map();
  for (const t of tasks) {
    const key = t.project?.id ?? 0;
    if (!byProject.has(key)) {
      byProject.set(key, { project_id: key, project_name: t.project?.name ?? null, open_tasks: 0, overdue: 0 });
    }
    const entry = byProject.get(key);
    entry.open_tasks += 1;
    if (t.is_overdue) entry.overdue += 1;
  }

  const nameById = new Map(ctx.rawUsers.map((u) => [u.id, u.display_name]));
  const relatedTasks = notifications.related?.Task || {};
  const relatedComments = notifications.related?.Comment || {};
  const recent = (notifications.notifications || []).slice(0, 8).map((n) => ({
    action: n.class?.replace(/Notification$/, '') ?? null,
    actor: nameById.get(n.sender_id) ?? null,
    target: relatedTasks[n.parent_id]?.name ?? `${n.parent_type ?? ''} #${n.parent_id ?? ''}`,
    excerpt: n.comment_id && relatedComments[n.comment_id]
      ? (relatedComments[n.comment_id].body_plain_text || '').trim().slice(0, 200)
      : null,
    occurred_at: toIso(n.created_on),
  }));

  const data = {
    user: { id: config.userId, name: config.displayName, email: config.email },
    as_of: new Date(nowMs).toISOString(),
    summary: {
      open_tasks: tasks.length,
      overdue: buckets.overdue.length,
      due_today: buckets.due_today.length,
      due_this_week: buckets.due_this_week.length,
      no_due_date: buckets.no_due_date.length,
      projects_involved: byProject.size,
    },
    // Only the fields an agent needs to decide what to open next; the full
    // record is one `collab task <id>` away.
    attention: {
      overdue: buckets.overdue.map(slim),
      due_today: buckets.due_today.map(slim),
      due_this_week: buckets.due_this_week.map(slim),
    },
    backlog: {
      later: buckets.later.map(slim),
      no_due_date: buckets.no_due_date.map(slim),
    },
    by_project: [...byProject.values()].sort((a, b) => b.open_tasks - a.open_tasks),
    recent_activity: recent,
    next_steps: {
      task_detail: 'collab task <id>',
      completed_work: 'collab tasks --status completed',
      colleague_work: 'collab tasks --user <id|email|name>',
    },
  };

  emit({
    command: 'brief',
    data,
    meta: { api_requests: client.requestCount },
    human: options.human,
    renderHuman: renderBriefHuman,
  });
}

function slim(t) {
  return {
    id: t.id,
    name: t.name,
    project: t.project?.name ?? null,
    task_list: t.task_list?.name ?? null,
    labels: t.labels,
    due_on: t.due_on,
    days_until_due: t.days_until_due,
    comments_count: t.comments_count,
  };
}

function renderBriefHuman(d) {
  console.log(chalk.bold(`\n${d.user.name} — ${d.summary.open_tasks} open task(s) across ${d.summary.projects_involved} projects`));
  console.log(
    chalk.gray(
      `${d.summary.overdue} overdue, ${d.summary.due_today} due today, ${d.summary.due_this_week} due this week, ${d.summary.no_due_date} undated`,
    ),
  );

  const section = (title, list, color) => {
    if (!list.length) return;
    console.log(color(`\n${title} (${list.length})`));
    for (const t of list) {
      const late = t.days_until_due !== null && t.days_until_due < 0 ? chalk.red(` ${Math.abs(t.days_until_due)}d late`) : '';
      const label = t.labels.length ? chalk.gray(` [${t.labels.join(', ')}]`) : '';
      console.log(`  ${String(t.id).padEnd(8)} ${t.name}${label}${late}`);
      console.log(chalk.gray(`           ${t.project ?? ''}${t.due_on ? ` · due ${t.due_on}` : ''}`));
    }
  };

  section('OVERDUE', d.attention.overdue, chalk.bold.red);
  section('DUE TODAY', d.attention.due_today, chalk.bold.yellow);
  section('DUE THIS WEEK', d.attention.due_this_week, chalk.bold);

  if (d.recent_activity.length) {
    console.log(chalk.bold('\nRECENT ACTIVITY'));
    for (const e of d.recent_activity) {
      console.log(chalk.gray(`  ${e.occurred_at?.slice(0, 16).replace('T', ' ')}  `) + `${e.actor ?? '?'} ${e.action} ${chalk.bold(e.target)}`);
    }
  }
  console.log('');
}
