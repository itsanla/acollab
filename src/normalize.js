// Turns raw ActiveCollab payloads into the shapes this CLI promises.
//
// The raw API hands back bare integers (`assignee_id`, `project_id`,
// `task_list_id`) with the human names sitting in a separate `related` map, and
// unix-second timestamps. Every consumer would otherwise have to redo the same
// joins and the same date maths, so it happens once, here.

import { htmlToText, toIso, toDateOnly, daysUntil, labelNames, resolveUser } from './format.js';
import { normalizeAttachment, replaceDeadFileLinks } from './attachments.js';

const PREVIEW_CHARS = 280;

export function normalizeTask(raw, ctx, { fullBody = false } = {}) {
  const {
    projectsById = new Map(),
    taskListsById = new Map(),
    users = new Map(),
    baseUrl = '',
    nowMs = 0,
    gmtOffset = 0,
  } = ctx || {};

  const project = projectsById.get(raw.project_id);
  const taskList = taskListsById.get(raw.task_list_id);
  const due = raw.due_on;
  const daysLeft = daysUntil(due, nowMs, gmtOffset);
  const completed = Boolean(raw.is_completed);
  const trashed = Boolean(raw.is_trashed);

  return {
    id: raw.id,
    number: raw.task_number ?? null,
    name: raw.name,
    url: raw.url_path ? `${baseUrl}${raw.url_path}` : null,

    // Three-valued on purpose: a trashed task is neither open work nor finished
    // work, and collapsing it into either one misrepresents it.
    status: trashed ? 'trashed' : completed ? 'completed' : 'open',
    labels: labelNames(raw.labels),
    is_important: Boolean(raw.is_important),
    is_billable: Boolean(raw.is_billable),

    project: raw.project_id ? { id: raw.project_id, name: project?.name ?? null } : null,
    task_list: raw.task_list_id ? { id: raw.task_list_id, name: taskList?.name ?? null } : null,

    assignee: resolveUser(users, raw.assignee_id),
    created_by: raw.created_by_id
      ? { id: raw.created_by_id, name: raw.created_by_name ?? null, email: raw.created_by_email ?? null }
      : null,
    completed_by: raw.completed_by_id
      ? { id: raw.completed_by_id, name: raw.completed_by_name ?? null, email: raw.completed_by_email ?? null }
      : null,
    delegated_by: resolveUser(users, raw.delegated_by_id),

    due_on: toDateOnly(due),
    // Precomputed against the INSTANCE's calendar day so "is this late" never
    // depends on the consumer's clock. Null when there is no due date at all.
    days_until_due: completed ? null : daysLeft,
    is_overdue: !completed && daysLeft !== null && daysLeft < 0,
    start_on: toDateOnly(raw.start_on),

    created_at: toIso(raw.created_on),
    updated_at: toIso(raw.updated_on),
    completed_at: toIso(raw.completed_on),

    // An explicit estimate of 0 is a value the instance actually holds; only a
    // missing field is unknown.
    estimate_hours: raw.estimate === undefined || raw.estimate === null ? null : Number(raw.estimate),
    comments_count: raw.comments_count ?? 0,
    subtasks: {
      total: raw.total_subtasks ?? 0,
      open: raw.open_subtasks ?? 0,
      completed: raw.completed_subtasks ?? 0,
    },
    dependencies: {
      blocked_by: raw.open_dependencies?.parents_count ?? 0,
      blocking: raw.open_dependencies?.children_count ?? 0,
    },
    attachments_count: Array.isArray(raw.attachments) ? raw.attachments.length : 0,

    // Descriptions average ~1.3 KB and account for roughly 40% of a task list's
    // size. A list is for choosing what to open, so it carries a preview and says
    // how much was left behind; `collab task <id>` returns the whole thing.
    ...bodyFields(raw.body, fullBody),
  };
}

function bodyFields(rawBody, fullBody) {
  const text = htmlToText(rawBody);
  if (fullBody) return { body: text };
  if (text.length <= PREVIEW_CHARS) return { body: text, body_truncated: false };
  return {
    body: `${text.slice(0, PREVIEW_CHARS).trimEnd()}...`,
    body_truncated: true,
    body_full_chars: text.length,
    body_hint: 'Run "collab task <id>" for the complete description',
  };
}

export function normalizeComment(raw, ctx) {
  const { baseUrl = '' } = ctx || {};
  const attachments = (raw.attachments || []).map((a) =>
    normalizeAttachment(a, { type: 'comment', comment_id: raw.id, author: raw.created_by_name ?? null }),
  );
  return {
    id: raw.id,
    author: {
      id: raw.created_by_id ?? null,
      name: raw.created_by_name ?? null,
      email: raw.created_by_email ?? null,
    },
    created_at: toIso(raw.created_on),
    edited_at: raw.last_modification_on ? toIso(raw.last_modification_on) : null,
    // Comments carry a plain-text rendition already; only fall back to stripping
    // HTML when the server omits it.
    body: replaceDeadFileLinks(raw.body_plain_text?.trim(), attachments) || htmlToText(raw.body),
    reactions: Array.isArray(raw.reactions) ? raw.reactions.length : 0,
    attachments_count: attachments.length,
    attachments,
    url: raw.url_path ? `${baseUrl}${raw.url_path}` : null,
  };
}

export function normalizeProject(raw, ctx) {
  const { users = new Map(), baseUrl = '', nowMs = 0, gmtOffset = 0 } = ctx || {};
  return {
    id: raw.id,
    name: raw.name,
    url: raw.url_path ? `${baseUrl}${raw.url_path}` : null,
    status: raw.is_completed ? 'completed' : 'active',
    leader: resolveUser(users, raw.leader_id),
    member_ids: Array.isArray(raw.members) ? raw.members : [],
    member_count: Array.isArray(raw.members) ? raw.members.length : 0,
    // The server's count_tasks counts OPEN tasks only, so it is named for what it
    // is. A project showing 0 here can still hold hundreds of completed tasks.
    open_task_count: raw.count_tasks ?? null,
    company_id: raw.company_id ?? null,
    created_at: toIso(raw.created_on),
    last_activity_at: toIso(raw.last_activity_on),
    days_since_activity:
      raw.last_activity_on && nowMs ? -daysUntil(raw.last_activity_on, nowMs, gmtOffset) : null,
    is_billable: Boolean(raw.is_billable),
    budget_type: raw.budget_type ?? null,
  };
}

export function normalizeSubtask(raw, ctx) {
  const { users = new Map(), nowMs = 0, gmtOffset = 0 } = ctx || {};
  return {
    id: raw.id,
    name: raw.name ?? raw.body ?? null,
    status: raw.is_completed ? 'completed' : 'open',
    assignee: resolveUser(users, raw.assignee_id),
    due_on: toDateOnly(raw.due_on),
    days_until_due: raw.is_completed ? null : daysUntil(raw.due_on, nowMs, gmtOffset),
    created_at: toIso(raw.created_on),
    completed_at: toIso(raw.completed_on),
  };
}

export function normalizeTimeRecord(raw, ctx) {
  const { users = new Map() } = ctx || {};
  return {
    id: raw.id,
    hours: raw.value ? Number(raw.value) : 0,
    user: resolveUser(users, raw.user_id),
    date: toDateOnly(raw.record_date),
    summary: raw.summary || null,
    billable: raw.billable_status === 1 || raw.billable_status === true,
    job_type_id: raw.job_type_id ?? null,
  };
}
