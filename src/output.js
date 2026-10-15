// Output contract.
//
// JSON is the default because the primary consumer of this CLI is an AI agent.
// Every command emits the same envelope so a consumer can branch on `ok` before
// looking at anything else, and failures stay machine-readable instead of
// becoming free text on stderr.

import chalk from 'chalk';

export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
};

function envelope(command, data, meta) {
  return {
    ok: true,
    command,
    generated_at: new Date().toISOString(),
    data,
    ...(meta ? { meta } : {}),
  };
}

export function emit({ command, data, meta, human, renderHuman }) {
  if (human && typeof renderHuman === 'function') {
    renderHuman(data, meta);
    return;
  }
  process.stdout.write(`${JSON.stringify(envelope(command, data, meta), null, 2)}\n`);
}

// Errors follow the same envelope shape. `kind` is a stable machine token;
// `hint` is the actionable next step, which is what stops an agent from
// retrying the same broken call in a loop.
export function emitError({ command, kind, message, hint, human, exitCode = EXIT.ERROR }) {
  const payload = {
    ok: false,
    command,
    generated_at: new Date().toISOString(),
    error: { kind, message, ...(hint ? { hint } : {}) },
  };
  if (human) {
    process.stderr.write(`${chalk.red(message)}\n`);
    if (hint) process.stderr.write(`${chalk.gray(hint)}\n`);
  } else {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  process.exitCode = exitCode;
}

// Wraps a command action so any thrown error still leaves the process emitting a
// valid envelope rather than a stack trace.
//
// It also normalises options. `-h` is declared on the root as well as on every
// subcommand (the root needs it for the bare `collab <taskId>` shorthand), and
// when both declare it commander binds the flag to the root, leaving the
// subcommand's own options empty. Reading both scopes makes `collab brief -h`
// behave the same as `collab task 1 -h` regardless of where commander filed it.
// The file flags of `collab task` are shared with the shorthand the same way.
const SHARED_FLAGS = { human: false, files: true, allFiles: false };

export function runCommand(command, fn) {
  return async (...args) => {
    // Commander calls actions as (...positionals, options, commandObject).
    const cmdObject = args[args.length - 1];
    const ownOpts = typeof cmdObject?.opts === 'function' ? cmdObject.opts() : args[args.length - 2] || {};
    const parentOpts = typeof cmdObject?.parent?.opts === 'function' ? cmdObject.parent.opts() : {};
    const options = { ...ownOpts };
    // Whichever scope moved a flag away from its default is the one the user typed.
    for (const [key, def] of Object.entries(SHARED_FLAGS)) {
      if (ownOpts[key] !== undefined && ownOpts[key] !== def) options[key] = ownOpts[key];
      else if (parentOpts[key] !== undefined && parentOpts[key] !== def) options[key] = parentOpts[key];
      else options[key] = def;
    }
    options.human = Boolean(options.human);
    const positionals = args.slice(0, Math.max(0, args.length - 2));
    const human = options.human;

    try {
      await fn(...positionals, options);
    } catch (err) {
      const status = err?.status;
      if (err?.name === 'NotLoggedInError') {
        emitError({
          command,
          kind: 'not_logged_in',
          message: 'No active session',
          hint: 'Run: collab login <your-activecollab-url>',
          human,
          exitCode: EXIT.AUTH,
        });
        return;
      }
      if (status === 401 || status === 403) {
        emitError({
          command,
          kind: 'unauthorized',
          message: err.message || 'Not authorised',
          hint: 'The session token may have expired. Run: collab login <url>',
          human,
          exitCode: EXIT.AUTH,
        });
        return;
      }
      emitError({
        command,
        kind: err?.name === 'ApiError' ? 'api_error' : 'internal_error',
        message: err?.message || String(err),
        hint: err?.path ? `Failed while calling ${err.path}` : undefined,
        human,
      });
    }
  };
}
