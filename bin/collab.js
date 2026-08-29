#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { loginCommand } from '../src/commands/login.js';
import { logoutCommand } from '../src/commands/logout.js';
import { whoamiCommand } from '../src/commands/whoami.js';
import { peopleCommand } from '../src/commands/people.js';
import { projectsCommand } from '../src/commands/projects.js';
import { tasksCommand } from '../src/commands/tasks.js';
import { taskCommand } from '../src/commands/task.js';
import { activityCommand } from '../src/commands/activity.js';
import { briefCommand } from '../src/commands/brief.js';
import { searchCommand } from '../src/commands/search.js';
import { manifestCommand } from '../src/commands/manifest.js';
import { runCommand, emitError, EXIT } from '../src/output.js';
import { RANGE_KEYWORDS } from '../src/daterange.js';

const program = new Command();

// Commander reports its own failures (unknown option, missing argument) as bare
// text on stderr. A consumer that only knows how to parse this CLI's envelope
// would see nothing it recognises, so those failures are converted too. Applied
// to every subcommand at the bottom of this file, because commander does not
// inherit either setting.
const wantsHuman = process.argv.includes('-h') || process.argv.includes('--human');

// Commander's codes are camelCase; every kind this CLI emits itself is
// snake_case. One vocabulary is easier to match on than two.
function toSnake(code) {
  return String(code || 'usage_error')
    .replace('commander.', '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function handleCommanderExit(err) {
  // Help and version are successful outputs, not errors.
  if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  emitError({
    command: 'collab',
    kind: toSnake(err.code),
    message: err.message,
    hint: 'Run "collab --help" for usage',
    human: wantsHuman,
    exitCode: EXIT.USAGE,
  });
  process.exit(EXIT.USAGE);
}

program
  .name('collab')
  .description(
    'CLI for self-hosted ActiveCollab. Outputs JSON by default (built for AI agents); add -h for a human-readable view.',
  )
  .version('0.3.0')
  // -h is deliberately NOT help here: it is --human. Help stays on --help, which
  // commander still wires up for every subcommand.
  .helpOption('--help', 'display help')
  .showHelpAfterError();

// Applied to every command so the flag behaves identically everywhere.
const human = (cmd) => cmd.option('-h, --human', 'human-readable output instead of JSON');

// Commander hands option values back as strings. Without coercion "--limit abc"
// becomes NaN and is silently ignored, and "--limit -5" reaches Array.slice as a
// negative index and quietly drops rows off the END of the list. Both look like
// success to a consumer, which is worse than an error.
function positiveInt(label) {
  return (value) => {
    if (!/^\d+$/.test(value)) {
      throw new InvalidArgumentError(`${label} must be a non-negative whole number (got "${value}")`);
    }
    return Number(value);
  };
}

human(
  program
    .command('login <url>')
    .description('Authenticate against an ActiveCollab instance and store the session')
    .option('-e, --email <email>', 'account email (prompts when omitted)')
    .option('-p, --password <password>', 'account password (prompts when omitted)'),
).action(runCommand('login', loginCommand));

human(program.command('logout').description('Clear the stored session')).action(
  runCommand('logout', logoutCommand),
);

human(program.command('whoami').description('Current account, server and instance preferences')).action(
  runCommand('whoami', whoamiCommand),
);

human(
  program
    .command('people')
    .description('Directory of users, for finding whose tasks to read')
    .option('-s, --search <text>', 'filter by name, email or title')
    .option('-a, --all', 'include archived accounts'),
).action(runCommand('people', peopleCommand));

human(
  program
    .command('projects')
    .description('Projects visible to you')
    .option('--archived', 'list archived projects instead of active ones'),
).action(runCommand('projects', projectsCommand));

human(
  program
    .command('tasks')
    .argument(
      '[range]',
      'date window: today, tomorrow, yesterday, this-week, last-week, next-week, this-month, last-month, next-month, last-30d, next-7d, 2026-09-01, 2026-09-01..2026-09-30',
    )
    .description('Assigned tasks, open and completed, optionally within a date window')
    .option('-u, --user <ref>', 'whose tasks: "me", a user id, an email, or part of a name', 'me')
    .option('-s, --status <status>', 'open | completed | all (defaults to completed when --date-field completed)')
    .option('-p, --project <id>', 'restrict to one project id', positiveInt('--project'))
    .option('-l, --label <text>', 'only tasks carrying a matching label')
    .option('--overdue', 'only tasks past their due date')
    .option('--due <range>', 'same as the positional range argument')
    .option('-d, --date-field <field>', 'which date the range applies to: due | created | completed | start | updated', 'due')
    .option('-n, --limit <n>', 'cap the number of tasks returned', positiveInt('--limit')),
).action(runCommand('tasks', tasksCommand));

human(
  program
    .command('task <taskId>')
    .description('One task in full: body, comments, subtasks, attachments, dependencies')
    .option('-p, --project <id>', 'skip project lookup by naming the project id', positiveInt('--project'))
    .option('-t, --time', 'include time records for the task'),
).action(runCommand('task', taskCommand));

human(
  program
    .command('activity')
    .description('Recent events: notifications aimed at you, or project-wide changes')
    .option('-n, --limit <n>', 'how many events', positiveInt('--limit'), 25)
    .option('-f, --feed <feed>', 'me | project', 'me'),
).action(runCommand('activity', activityCommand));

human(
  program
    .command('brief')
    .description('A single digest of your current workload, built for an agent starting a session'),
).action(runCommand('brief', briefCommand));

human(
  program
    .command('manifest')
    .description('Machine-readable description of this CLI: commands, output contract, known data gaps'),
).action(runCommand('manifest', (options) => manifestCommand(program, options)));

human(
  program
    .command('search <query>')
    .description('Full-text search across the instance, including tasks not assigned to you')
    .option('-t, --type <type>', 'object class to search: task, project, note, discussion', 'task')
    .option('-m, --mine', 'only results assigned to you')
    .option('--page <n>', 'result page (100 per page)', positiveInt('--page')),
).action(runCommand('search', searchCommand));

// Bare `collab <number>` is shorthand for `collab task <number>`; bare `collab`
// prints help rather than guessing what was wanted.
human(program.argument('[taskId]', 'shorthand for "collab task <taskId>"')).action(
  runCommand('task', async (taskId, options) => {
    if (!taskId) {
      program.outputHelp();
      return;
    }
    if (!/^\d+$/.test(String(taskId))) {
      const arg = String(taskId);
      // A bare date or keyword is a date window, not a command name.
      const looksLikeRange =
        RANGE_KEYWORDS.includes(arg.toLowerCase()) ||
        /^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?$/.test(arg) ||
        /^[+-]?\d+d$/.test(arg);
      emitError({
        // Attributed to the CLI, not to "task": the caller never asked for the
        // task command, they mistyped a command name.
        command: 'collab',
        kind: looksLikeRange ? 'bad_argument' : 'unknown_command',
        message: looksLikeRange ? `"${arg}" is a date range, not a command` : `Unknown command "${arg}"`,
        hint: looksLikeRange ? `Use: collab tasks ${arg}` : 'Run "collab --help" for the command list',
        human: options.human,
        exitCode: EXIT.USAGE,
      });
      return;
    }
    await taskCommand(taskId, options);
  }),
);

// Route commander's own diagnostics through the envelope, on the root and on
// every subcommand. Its plain-text writer is silenced first so a failure does
// not produce both a stray line and a JSON object.
for (const cmd of [program, ...program.commands]) {
  cmd.exitOverride(handleCommanderExit);
  // Without this, `collab tasks completed` quietly discards "completed" and
  // returns OPEN tasks with ok:true, which reads as a valid answer to a question
  // that was never asked. The root keeps its optional [taskId] shorthand.
  if (cmd !== program) cmd.allowExcessArguments(false);
  if (!wantsHuman) {
    cmd.configureOutput({ writeErr: () => {} });
  }
}

program.parseAsync(process.argv).catch((err) => {
  emitError({
    command: 'collab',
    kind: 'internal_error',
    message: err?.message || String(err),
    human: wantsHuman,
  });
});
