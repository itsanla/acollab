import chalk from 'chalk';

export function formatDate(unixSeconds) {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().slice(0, 10);
}

export function formatLabel(labels) {
  if (!labels || labels.length === 0) return '';
  return labels.map((l) => chalk.hex(l.color || '#888888')(l.name)).join(', ');
}

export function statusIcon(task) {
  return task.is_completed ? chalk.green('✓') : chalk.gray('○');
}

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

// Task/comment bodies come back as HTML. Terminals can't render it, so strip tags
// and decode the handful of entities that actually show up in practice.
export function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}
