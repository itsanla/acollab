import { emit } from '../output.js';

// Self-description, generated from the live commander tree so it cannot drift
// from the real flags. The point is that an agent can discover what this CLI can
// do, what each field means, and where the data is incomplete, without anyone
// having written that into its prompt.
export function manifestCommand(program, options) {
  const commands = program.commands
    .filter((c) => c.name() !== 'manifest')
    .map((c) => ({
      name: c.name(),
      usage: `collab ${c.name()} ${c.usage()}`.trim(),
      purpose: c.description(),
      arguments: c.registeredArguments?.map((a) => ({
        name: a.name(),
        required: a.required,
        description: a.description || null,
      })) ?? [],
      flags: c.options.map((o) => ({
        flags: o.flags,
        description: o.description,
        default: o.defaultValue ?? null,
      })),
    }));

  const data = {
    cli: 'acollab-cli',
    version: program.version(),
    output_contract: {
      default_format: 'json',
      human_flag: '-h or --human, accepted by every command',
      help_flag: '--help (note: -h is NOT help in this CLI, it is --human)',
      success_envelope: ['ok=true', 'command', 'generated_at', 'data', 'meta'],
      error_envelope: ['ok=false', 'command', 'generated_at', 'error{kind,message,hint}'],
      exit_codes: {
        0: 'success',
        1: 'runtime or API error',
        2: 'usage error (bad flag, unknown command, ambiguous argument)',
        3: 'not authenticated or session rejected',
      },
    },
    conventions: {
      timestamps: 'ISO-8601 UTC (fields ending in _at)',
      dates: 'YYYY-MM-DD, not timezone-shifted (fields ending in _on)',
      derived_fields:
        'days_until_due and is_overdue are precomputed against the INSTANCE timezone, not UTC, so "overdue" matches what the user sees in the web UI',
      foreign_keys:
        'ids are resolved inline to {id,name,email}; you never have to join against a separate map',
      empty_values: 'zero and false are always emitted; null means genuinely unknown',
      truncation:
        'anything clipped carries a *_truncated flag or a *_meta block next to it; absence of the flag means the value is complete',
      task_status: 'open | completed | trashed',
    },
    // Stated plainly because these are places where the upstream API loses data
    // and a consumer that assumes completeness will be wrong.
    known_limitations: [
      'Task detail returns at most the 30 newest comments; comments_meta.truncated reports when older ones exist and are unreachable via the API.',
      'Completed tasks have no per-user endpoint, so they are gathered per project and filtered client-side; this is the expensive path.',
      'Project archives page at a fixed 30 per page and are walked to exhaustion, capped at 40 pages per project.',
      'Counts for another person reflect what YOU are permitted to see, not their absolute totals.',
      'List commands carry a 280-character body preview (body_truncated says so); "collab task <id>" returns the full description.',
      'Project open_task_count counts OPEN tasks only; a project showing 0 can still hold hundreds of completed ones.',
      'This CLI is read-only. It cannot comment, complete, assign or log time.',
    ],
    typical_agent_flow: [
      'collab brief              # one call: workload, urgency buckets, recent activity',
      'collab task <id>          # full detail of anything the brief surfaced',
      'collab tasks --status all # everything including finished work',
      'collab search <text>      # reach tasks not assigned to you',
    ],
    commands,
  };

  emit({
    command: 'manifest',
    data,
    human: options.human,
    renderHuman: (d) => {
      console.log(`${d.cli} v${d.version}`);
      console.log(`Default output: ${d.output_contract.default_format}. Add -h for human view.\n`);
      for (const c of d.commands) {
        console.log(`  ${c.usage.padEnd(34)} ${c.purpose}`);
      }
      console.log('\nKnown limitations:');
      for (const l of d.known_limitations) console.log(`  - ${l}`);
    },
  });
}
