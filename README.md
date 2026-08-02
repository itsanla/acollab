# acollab-cli

Unofficial command-line client for **self-hosted ActiveCollab** (API v1). Not affiliated with
ActiveCollab / A51 doo. Built and verified against ActiveCollab 8.0.31.

## Install

```bash
npm install -g acollab-cli
```

Or straight from GitHub, no npm registry needed:

```bash
npm install -g itsanla/acollab
```

### Installing on a server without root

`npm install -g` writes to a system directory by default (e.g. `/usr/lib/node_modules`),
which fails with `EACCES` if your user can't write there and you don't have sudo. Point
npm's global prefix at a directory you own instead:

```bash
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"   # add this line to your shell rc file too
npm install -g acollab-cli
```

## Usage

```bash
collab login https://your-activecollab-instance.example.com
# prompts for email + password, stores a session token in ~/.config/collab-cli/config.json

collab              # no arguments: shows this command list (same as --help)
collab tasks        # your My Work list, grouped by project, open tasks only
collab tasks --all  # include completed tasks
collab projects     # every project you can see
collab task <taskId>   # one task in full, with comments (project is resolved for you)
collab <taskId>         # shorthand for "collab task <taskId>"
collab activity     # recent notifications
collab whoami
collab logout
```

IDs come from the left column of `collab tasks`. `collab task` only looks up tasks that
are in your own My Work list (open or completed); it can't look up arbitrary tasks you're
not assigned to.

## Requirements

- Node.js 18+ (uses the built-in `fetch`)
- A self-hosted ActiveCollab instance with API v1 enabled (this is the default)

## How it authenticates

Uses ActiveCollab's own `POST /api/v1/issue-token` endpoint (username + password once,
in exchange for a reusable token). The token is stored locally in
`~/.config/collab-cli/config.json`, never sent anywhere except your own server.

## What's not implemented yet

Timesheet and Availability, two of the four tabs on the My Work page, aren't covered yet.
Their API paths weren't confirmed working during initial testing. PRs welcome.

## License

MIT
