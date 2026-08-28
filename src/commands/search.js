import chalk from 'chalk';
import Table from 'cli-table3';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { loadContext } from '../context.js';
import { normalizeTask } from '../normalize.js';
import { emit, emitError, EXIT } from '../output.js';

// Server-side search. This is the only way to reach a task by text without
// walking every project, and it reaches tasks that are not assigned to you.
export async function searchCommand(query, options) {
  // The server answers an empty query with a generic 500, which tells a caller
  // nothing about what to do differently.
  if (!query || !query.trim()) {
    emitError({
      command: 'search',
      kind: 'empty_query',
      message: 'Search query cannot be empty',
      hint: 'Provide text to search for: collab search "sonar"',
      human: options.human,
      exitCode: EXIT.USAGE,
    });
    return;
  }

  const config = requireConfig();
  const nowMs = Date.now();
  const client = new Client(config);
  const ctx = await loadContext(client, { baseUrl: config.baseUrl, nowMs });

  const type = options.type ? capitalize(options.type) : 'Task';
  const raw = await client.search(query, { type, page: options.page });

  // Results arrive wrapped: each element is {hit: {...}} plus scoring metadata.
  const hits = (Array.isArray(raw) ? raw : []).map((r) => r.hit ?? r).filter(Boolean);

  const results = hits.map((h) => {
    if (h.class === 'Task') {
      const t = normalizeTask(h, ctx);
      return { type: 'Task', ...t };
    }
    return {
      type: h.class ?? null,
      id: h.id,
      name: h.name ?? null,
      url: h.url_path ? `${config.baseUrl}${h.url_path}` : null,
    };
  });

  const filtered = options.mine
    ? results.filter((r) => r.assignee?.id === config.userId)
    : results;

  emit({
    command: 'search',
    data: { query, type, mine_only: Boolean(options.mine), results: filtered },
    meta: {
      api_requests: client.requestCount,
      counts: { returned: filtered.length, matched: results.length },
      // The API pages at 100 and gives no total, so a full page means there is
      // probably more behind it.
      ...(hits.length >= 100 ? { more_available: true, hint: 'Pass --page 2 for the next page' } : {}),
    },
    human: options.human,
    renderHuman: (d) => {
      if (!d.results.length) {
        console.log(chalk.gray(`No ${d.type} matches "${d.query}".`));
        return;
      }
      const table = new Table({
        head: ['ID', 'Name', 'Project', 'Status', 'Assignee'],
        style: { head: [] },
        colWidths: [9, 52, 28, 11, 22],
        wordWrap: true,
      });
      for (const r of d.results) {
        table.push([
          r.id,
          r.name,
          r.project?.name ?? '',
          r.status ?? '',
          r.assignee?.name ?? '',
        ]);
      }
      console.log(table.toString());
      console.log(chalk.gray(`\n${d.results.length} result(s)`));
    },
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
