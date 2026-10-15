// Attachments: one shape for files on a task and on its comments, and the
// on-disk layout they are downloaded into.
//
// Verified against ActiveCollab 8.0.31 (2026-10-15): pasted images and uploaded
// files are the same LocalAttachment object; `disposition` is "inline" for an
// image placed inside the text and "attachment" for a file in the list below it.
// Both download through /attachments/{id}/download.

import { join } from 'node:path';
import { acollabHome } from './config.js';
import { toIso } from './format.js';

export function normalizeAttachment(raw, source) {
  const dims = raw.file_meta?.dimensions;
  return {
    id: raw.id,
    name: raw.name,
    // file_meta.kind is the more specific of the two ("pdf" where file_type
    // says "document"), so it wins when present.
    kind: raw.file_meta?.kind || raw.file_type || 'other',
    extension: (raw.extension || extOf(raw.name) || '').toLowerCase() || null,
    mime_type: raw.mime_type ?? null,
    size_bytes: raw.size ?? null,
    ...(dims ? { dimensions: { width: dims.width, height: dims.height } } : {}),
    disposition: raw.disposition ?? null,
    md5: raw.md5 ?? null,
    source,
    created_by: raw.created_by_id
      ? { id: raw.created_by_id, name: raw.created_by_name ?? null, email: raw.created_by_email ?? null }
      : null,
    created_at: toIso(raw.created_on),
  };
}

function extOf(name) {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,10})$/);
  return m ? m[1] : null;
}

// The server's body_plain_text renders an inline image as
// "[https://.../proxy.php?proxy=download_file&...&id=<n>&...&i=--DOWNLOAD-TOKEN--]",
// a link that never works (see Client.downloadAttachment). Swapped for the same
// marker htmlToText produces, so task bodies and comments read alike.
export function replaceDeadFileLinks(text, attachments = []) {
  if (!text) return text;
  const byId = new Map(attachments.map((a) => [String(a.id), a]));
  return text.replace(/\[?https?:\/\/[^\s\]]*proxy\.php\?proxy=download_file[^\s\]]*\]?/g, (link) => {
    const id = link.match(/[?&]id=(\d+)/)?.[1];
    if (!id) return link;
    const a = byId.get(id);
    const label = a?.kind === 'image' ? 'image' : 'file';
    return `[${label} #${id}${a?.name ? `: ${a.name}` : ''}]`;
  });
}

export function attachmentSummary(attachments) {
  const byKind = {};
  let bytes = 0;
  for (const a of attachments) {
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    bytes += a.size_bytes ?? 0;
  }
  return { total: attachments.length, by_kind: byKind, total_bytes: bytes };
}

// Mirrors the web URL (/projects/503/tasks/148709), so a path and a link to the
// same task are recognisably the same thing.
export function taskFilesDir(projectId, taskId) {
  return join(acollabHome(), 'projects', String(projectId), 'tasks', String(taskId));
}

// "<id>-<slug>": the id keeps the many identically named pastes ("image.png")
// apart and traces a file back to its attachment; the slug is ASCII without
// spaces so an agent can pass the path to a shell without quoting mistakes.
export function fileStem(attachment) {
  const base = String(attachment.name || 'file').replace(/\.[A-Za-z0-9]{1,10}$/, '');
  const slug = base
    .replace(/×/g, 'x')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${attachment.id}-${slug || 'file'}`;
}
