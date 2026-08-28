// Reference data every command needs before it can denormalise anything:
// who the people are, what the projects are called, what the task lists are called.
//
// Fetched once per invocation and reused, so a command that touches 40 tasks
// still only pays for one /users and one /projects call.

import { userIndex } from './format.js';

export async function loadContext(client, { baseUrl, nowMs, withProjects = true } = {}) {
  // Archived projects are fetched alongside the active ones because completed
  // work keeps living in them: a finished task in an archived project is absent
  // from /projects entirely, so anything that only walks the active list will
  // report it as "not found".
  const [users, projects, archived] = await Promise.all([
    client.users(),
    withProjects ? client.projects() : Promise.resolve([]),
    withProjects ? client.archivedProjects().catch(() => []) : Promise.resolve([]),
  ]);

  const active = projects.map((p) => ({ ...p, is_archived: false }));
  const archivedTagged = (archived || []).map((p) => ({ ...p, is_archived: true }));
  const all = [...active, ...archivedTagged];

  return {
    baseUrl,
    nowMs,
    users: userIndex(users),
    rawUsers: users,
    projects: active,
    // Everything addressable, archived included. Use this for lookups and scans.
    allProjects: all,
    projectsById: new Map(all.map((p) => [p.id, p])),
    taskListsById: new Map(),
  };
}

// Task lists only ever arrive alongside tasks (there is no usable global
// endpoint), so commands fold them in as they discover them.
export function absorbTaskLists(ctx, related) {
  const lists = related?.TaskList;
  if (!lists) return ctx;
  const entries = Array.isArray(lists) ? lists : Object.values(lists);
  for (const tl of entries) {
    if (tl?.id) ctx.taskListsById.set(tl.id, tl);
  }
  return ctx;
}

export function absorbProjects(ctx, related) {
  const projects = related?.Project;
  if (!projects) return ctx;
  const entries = Array.isArray(projects) ? projects : Object.values(projects);
  for (const p of entries) {
    if (p?.id && !ctx.projectsById.has(p.id)) ctx.projectsById.set(p.id, p);
  }
  return ctx;
}

// Resolves a user reference the way a person would type it: their own id by
// default, a numeric id, an email, or a fragment of a display name.
export function resolveUserRef(ctx, ref, selfId) {
  if (!ref || ref === 'me') return { id: selfId };

  if (/^\d+$/.test(String(ref))) return { id: Number(ref) };

  const needle = String(ref).toLowerCase();
  const exactEmail = ctx.rawUsers.find((u) => u.email?.toLowerCase() === needle);
  if (exactEmail) return { id: exactEmail.id };

  const matches = ctx.rawUsers.filter(
    (u) =>
      u.display_name?.toLowerCase().includes(needle) ||
      u.email?.toLowerCase().includes(needle),
  );
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length > 1) {
    return {
      error: 'ambiguous',
      candidates: matches.slice(0, 10).map((u) => ({
        id: u.id,
        name: u.display_name,
        email: u.email,
      })),
    };
  }
  return { error: 'not_found' };
}
