// Value-level normalisation shared by every command.
// The guiding rule: an AI reading this output should never have to guess what a
// value means, and should never have to join two structures to resolve a name.

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

// ActiveCollab stores task bodies as HTML. Comments already carry
// `body_plain_text`, task bodies do not, so they go through this.
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m])
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// The API speaks unix SECONDS. Emitting raw integers would force every consumer
// to know that; ISO-8601 is unambiguous and sorts lexicographically.
export function toIso(unixSeconds) {
  if (unixSeconds === null || unixSeconds === undefined || unixSeconds === 0) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

export function toDateOnly(unixSeconds) {
  const iso = toIso(unixSeconds);
  return iso ? iso.slice(0, 10) : null;
}

// Whole days from `todayIso` until the due date. Negative means overdue.
// Precomputed because "is this late?" is the single most common question asked
// of this data, and date arithmetic is a place consumers reliably slip up.
export function daysUntil(unixSeconds, nowMs) {
  if (!unixSeconds) return null;
  const dueUtcDay = Math.floor(unixSeconds / 86400);
  const nowUtcDay = Math.floor(nowMs / 1000 / 86400);
  return dueUtcDay - nowUtcDay;
}

export function labelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((l) => l.name).filter(Boolean);
}

// Builds id -> display_name lookups once so callers can resolve people without
// carrying the whole user list around.
export function userIndex(users) {
  const byId = new Map();
  for (const u of users || []) {
    byId.set(u.id, {
      id: u.id,
      name: u.display_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email,
      email: u.email || null,
      title: u.title || null,
    });
  }
  return byId;
}

export function resolveUser(index, id) {
  if (!id) return null;
  return index.get(id) || { id, name: null, email: null, title: null };
}
