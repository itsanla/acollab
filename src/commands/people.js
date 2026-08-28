import chalk from 'chalk';
import Table from 'cli-table3';
import { requireConfig } from '../config.js';
import { Client } from '../client.js';
import { emit } from '../output.js';

// Exists so that "show me what X is working on" is answerable: you need X's id
// or email before `collab tasks --user` can do anything.
export async function peopleCommand(options) {
  const config = requireConfig();
  const client = new Client(config);
  const [users, companies, teams] = await Promise.all([
    client.users(),
    client.companies().catch(() => []),
    client.teams().catch(() => []),
  ]);

  const companyById = new Map((companies || []).map((c) => [c.id, c.name]));

  let people = users.map((u) => ({
    id: u.id,
    name: u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' '),
    email: u.email || null,
    title: u.title || null,
    company: u.company_id ? { id: u.company_id, name: companyById.get(u.company_id) ?? null } : null,
    role: u.class || null,
    is_archived: Boolean(u.is_archived),
    created_at: u.created_on ? new Date(u.created_on * 1000).toISOString() : null,
  }));

  if (!options.all) people = people.filter((p) => !p.is_archived);

  if (options.search) {
    const needle = options.search.toLowerCase();
    people = people.filter(
      (p) =>
        p.name?.toLowerCase().includes(needle) ||
        p.email?.toLowerCase().includes(needle) ||
        p.title?.toLowerCase().includes(needle),
    );
  }

  people.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  emit({
    command: 'people',
    data: {
      people,
      teams: (teams || []).map((t) => ({ id: t.id, name: t.name, member_ids: t.members || [] })),
    },
    meta: { api_requests: client.requestCount, counts: { returned: people.length } },
    human: options.human,
    renderHuman: (d) => {
      const table = new Table({
        head: ['ID', 'Name', 'Email', 'Title', 'Company'],
        style: { head: [] },
        colWidths: [7, 26, 32, 26, 22],
        wordWrap: true,
      });
      for (const p of d.people) {
        table.push([p.id, p.name, p.email || '', p.title || '', p.company?.name || '']);
      }
      console.log(table.toString());
      console.log(chalk.gray(`\n${d.people.length} people. Use: collab tasks --user <id|email|name>`));
    },
  });
}
