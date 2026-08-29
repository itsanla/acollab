// Date-range parsing for task filtering.
//
// Everything here works on 'YYYY-MM-DD' strings in the INSTANCE's calendar, not
// the caller's and not UTC. Due dates are stored as midnight UTC, but "today"
// has to mean today where the user is, otherwise the answer flips seven hours
// early every night in Asia/Jakarta.

const DAY_MS = 86400000;

export function localDateOf(unixSeconds, gmtOffsetSeconds = 0) {
  if (!unixSeconds) return null;
  return new Date((unixSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

export function todayLocal(nowMs, gmtOffsetSeconds = 0) {
  return new Date(nowMs + gmtOffsetSeconds * 1000).toISOString().slice(0, 10);
}

function toDayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayIndex(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function shift(iso, days) {
  return fromDayIndex(toDayIndex(iso) + days);
}

// 0 = Sunday .. 6 = Saturday, matching Date#getUTCDay.
function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function startOfWeek(iso, firstWeekDay) {
  const diff = (weekdayOf(iso) - firstWeekDay + 7) % 7;
  return shift(iso, -diff);
}

function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const RANGE_KEYWORDS = [
  'today',
  'tomorrow',
  'yesterday',
  'this-week',
  'last-week',
  'next-week',
  'this-month',
  'last-month',
  'next-month',
];

// Accepts: a keyword, YYYY-MM-DD, YYYY-MM-DD..YYYY-MM-DD, +Nd (next N days),
// -Nd (last N days). Returns {from, to, label} or {error, message}.
export function parseRange(expr, { today, firstWeekDay = 1 } = {}) {
  if (!expr) return null;
  const raw = String(expr).trim().toLowerCase();

  switch (raw) {
    case 'today':
      return { from: today, to: today, label: 'today' };
    case 'tomorrow':
      return { from: shift(today, 1), to: shift(today, 1), label: 'tomorrow' };
    case 'yesterday':
      return { from: shift(today, -1), to: shift(today, -1), label: 'yesterday' };
    case 'this-week': {
      const start = startOfWeek(today, firstWeekDay);
      return { from: start, to: shift(start, 6), label: 'this-week' };
    }
    case 'last-week': {
      const start = shift(startOfWeek(today, firstWeekDay), -7);
      return { from: start, to: shift(start, 6), label: 'last-week' };
    }
    case 'next-week': {
      const start = shift(startOfWeek(today, firstWeekDay), 7);
      return { from: start, to: shift(start, 6), label: 'next-week' };
    }
    case 'this-month':
      return { from: startOfMonth(today), to: endOfMonth(today), label: 'this-month' };
    case 'last-month': {
      const anchor = shift(startOfMonth(today), -1);
      return { from: startOfMonth(anchor), to: endOfMonth(anchor), label: 'last-month' };
    }
    case 'next-month': {
      const anchor = shift(endOfMonth(today), 1);
      return { from: startOfMonth(anchor), to: endOfMonth(anchor), label: 'next-month' };
    }
    default:
      break;
  }

  // "last-30d" and "next-30d" exist alongside "-30d"/"+30d" because an argument
  // beginning with a dash is swallowed by the option parser, and requiring the
  // caller to remember `--` for one form of one flag is a trap.
  const worded = raw.match(/^(last|past|next)-(\d+)d$/);
  if (worded) {
    const n = Number(worded[2]);
    return worded[1] === 'next'
      ? { from: today, to: shift(today, n), label: `next ${n} days` }
      : { from: shift(today, -n), to: today, label: `last ${n} days` };
  }

  const relative = raw.match(/^([+-]?)(\d+)d$/);
  if (relative) {
    const n = Number(relative[2]);
    if (relative[1] === '-') return { from: shift(today, -n), to: today, label: `last ${n} days` };
    return { from: today, to: shift(today, n), label: `next ${n} days` };
  }

  if (raw.includes('..')) {
    const [a, b] = raw.split('..');
    if (!ISO_DATE.test(a) || !ISO_DATE.test(b)) {
      return { error: 'bad_range', message: `Range must be YYYY-MM-DD..YYYY-MM-DD (got "${expr}")` };
    }
    // Accepting a reversed range silently would return nothing and look like
    // "no tasks" rather than "you wrote the dates backwards".
    return a <= b
      ? { from: a, to: b, label: `${a}..${b}` }
      : { error: 'bad_range', message: `Range start ${a} is after end ${b}` };
  }

  if (ISO_DATE.test(raw)) return { from: raw, to: raw, label: raw };

  return {
    error: 'bad_range',
    message: `Unrecognised date range "${expr}"`,
  };
}

// Which timestamp a range is applied to. Kept separate from parsing because the
// same range means different things depending on the field.
export const DATE_FIELDS = ['due', 'created', 'completed', 'start', 'updated'];

export function dateValueFor(task, field, gmtOffset) {
  switch (field) {
    case 'due':
      return task.due_on;
    case 'start':
      return task.start_on;
    // These are instants rather than calendar dates, so they are folded into the
    // instance's calendar day before comparison.
    case 'created':
      return task.created_at ? localDateOf(Date.parse(task.created_at) / 1000, gmtOffset) : null;
    case 'completed':
      return task.completed_at ? localDateOf(Date.parse(task.completed_at) / 1000, gmtOffset) : null;
    case 'updated':
      return task.updated_at ? localDateOf(Date.parse(task.updated_at) / 1000, gmtOffset) : null;
    default:
      return null;
  }
}
