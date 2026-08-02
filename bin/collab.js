#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loginCommand } from '../src/commands/login.js';
import { logoutCommand } from '../src/commands/logout.js';
import { whoamiCommand } from '../src/commands/whoami.js';
import { projectsCommand } from '../src/commands/projects.js';
import { tasksCommand } from '../src/commands/tasks.js';
import { taskCommand } from '../src/commands/task.js';
import { activityCommand } from '../src/commands/activity.js';

const program = new Command();

program
  .name('collab')
  .description('Unofficial CLI for self-hosted ActiveCollab')
  .version('0.1.0');

program
  .command('login <url>')
  .description('Log in to a self-hosted ActiveCollab instance')
  .option('-e, --email <email>', 'account email (will prompt if omitted)')
  .option('-p, --password <password>', 'account password (will prompt if omitted, safer to let it prompt)')
  .action(loginCommand);

program
  .command('logout')
  .description('Clear the locally stored session')
  .action(logoutCommand);

program
  .command('whoami')
  .description('Show the currently logged in account and server')
  .action(whoamiCommand);

program
  .command('projects')
  .description('List all projects you can see')
  .action(projectsCommand);

program
  .command('tasks')
  .description('Your "My Work" tasks, grouped by project and list (default view)')
  .option('-a, --all', 'include completed tasks')
  .action(tasksCommand);

program
  .command('task <taskId>')
  .description('Show one task in detail, including comments')
  .action(taskCommand);

program
  .command('activity')
  .description('Recent notifications/activity feed')
  .option('-n, --limit <n>', 'how many entries to show', '20')
  .action(activityCommand);

program
  .argument('[taskIdOrNothing]')
  .action((taskIdOrNothing) => {
    // "collab" alone -> the My Work list. "collab <number>" -> shorthand for "collab task <number>".
    if (taskIdOrNothing) {
      taskCommand(taskIdOrNothing);
    } else {
      tasksCommand({});
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err.message || err));
  process.exit(1);
});
