# acollab-cli

Unofficial command-line client for **self-hosted ActiveCollab** (API v1), built so an AI agent can
read someone's work without a browser. Not affiliated with ActiveCollab / A51 doo.
Developed and verified against ActiveCollab 8.0.31.

**Output is JSON by default.** Add `-h` to any command for a human-readable view.

## Install

```bash
npm install -g acollab-cli
```

Or straight from GitHub:

```bash
npm install -g itsanla/acollab
```

### Installing on a server without root

`npm install -g` writes to a system directory by default, which fails with `EACCES` if your user
can't write there. Point npm's global prefix at a directory you own instead:

```bash
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"   # add to your shell rc too
npm install -g acollab-cli
```

## Usage

```bash
collab login https://your-activecollab.example.com   # prompts for email + password

collab brief                    # one call: workload, urgency buckets, recent activity
collab tasks                    # your open tasks
collab tasks --status all       # open AND completed
collab tasks --status completed --user rozi@javan.co.id   # a colleague's finished work
collab tasks --overdue          # only what is late
collab task 133852              # one task in full: body, comments, subtasks, attachments

# date windows
collab tasks today
collab tasks this-week
collab tasks 2026-09-01..2026-09-30
collab tasks next-7d
collab tasks last-month --date-field completed   # what was actually finished last month
collab search "sonar"           # full-text, reaches tasks not assigned to you
collab projects                 # projects, with archived ones via --archived
collab people                   # directory, for finding whose tasks to read
collab activity                 # recent events
collab manifest                 # machine-readable description of this CLI itself
collab whoami
collab logout
```

Any of these takes `-h` / `--human`:

```bash
collab brief -h
collab task 133852 -h
```

`collab <number>` is shorthand for `collab task <number>`.

### Date windows

`collab tasks [range]` accepts `today`, `tomorrow`, `yesterday`, `this-week`, `last-week`,
`next-week`, `this-month`, `last-month`, `next-month`, a single date (`2026-09-01`), a span
(`2026-09-01..2026-09-30`), or a relative window (`last-30d`, `next-7d`).

Windows resolve in the **instance's** timezone, and weeks start on whichever day the instance is
configured for, so `today` and `this-week` mean the same thing here as they do in the web UI.

`--date-field` chooses which date the window applies to: `due` (default), `created`, `completed`,
`start`, `updated`. Asking for `completed` switches `--status` to `completed` on its own, since an
open task has no completion date.

Relative forms that start with a dash (`-30d`) collide with option parsing and need `collab tasks -- -30d`;
`last-30d` is the same window without the ceremony.

## Why JSON first

The intended caller is an AI agent, so the output is shaped for a machine:

- **Every envelope is the same.** Success is `{ok:true, command, generated_at, data, meta}`;
  failure is `{ok:false, command, generated_at, error:{kind,message,hint}}`. Failures are JSON too,
  so a consumer never has to parse free text off stderr.
- **Foreign keys are resolved inline.** The raw API returns `assignee_id: 879` with the name in a
  separate map. This returns `assignee: {id, name, email, title}`. No joins.
- **No date arithmetic left to the reader.** `due_on` is `YYYY-MM-DD`, and `days_until_due` /
  `is_overdue` are precomputed. Timestamps are ISO-8601 UTC in `*_at` fields.
- **Zero and false are always emitted.** `null` means genuinely unknown, never "empty".
- **Truncation is declared, never silent.** If the server capped something, `meta` or a `*_meta`
  block says so and explains why.
- **`collab manifest`** describes the whole CLI, its output contract, and its known data gaps as
  data, so an agent can learn it without being told.

## `-h` is `--human`, not help

This is a deliberate break from convention, because `-h` is the flag you reach for constantly when
a machine-readable default needs eyeballing. Help lives on `--help`, which works at the root and on
every subcommand (`collab --help`, `collab tasks --help`).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | runtime or API error |
| 2 | usage error (bad flag, unknown command, ambiguous `--user`) |
| 3 | not authenticated, or the stored session was rejected |

## Requirements

- Node.js 18+ (uses the built-in `fetch`)
- A self-hosted ActiveCollab instance with API v1 enabled (the default)

## How it authenticates

Uses ActiveCollab's own `POST /api/v1/issue-token`: email and password once, in exchange for a
reusable token stored at `~/.config/collab-cli/config.json` with mode `0600`. The token is never
printed and never leaves your machine except to your own server.

## Known limitations

These are upstream API constraints, surfaced rather than hidden:

- Task detail returns at most the **30 newest comments** and offers no paging; `comments_meta`
  reports the shortfall when older ones exist.
- There is **no per-user endpoint for completed tasks**, so they are gathered per project and
  filtered client-side. `collab tasks --status all` is the expensive path (roughly 40 requests).
- Project archives page at a fixed 30 per page and are walked to exhaustion (capped at 40 pages).
- Counts for another person reflect **what you are permitted to see**, not their absolute totals.
- **Read-only.** No commenting, completing, assigning or time logging: no write semantics beyond
  `issue-token` were verified against a production instance.

## License

MIT
