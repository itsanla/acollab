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
