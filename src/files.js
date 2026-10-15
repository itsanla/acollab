// Downloads a task's attachments into ~/.acollab/projects/<p>/tasks/<t>/ and
// converts each into something an AI can read, recording the result on the
// attachment object itself (path, original_path, status, converted, note).
//
//   <task dir>/<id>-<slug>.jpg|.md   what to read
//   <task dir>/original/<id>-<slug>.<ext>   the file exactly as uploaded
//   <task dir>/.acollab-cache.json   md5 per attachment, so a repeat call is free

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileStem } from './attachments.js';
import { convert, planFor } from './convert.js';

// Bumped whenever a converter's output changes, so cached results from an older
// version are rebuilt instead of being served stale.
const PIPELINE_VERSION = 2;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const CACHE_FILE = '.acollab-cache.json';

async function readCache(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(dir, CACHE_FILE), 'utf8'));
    return parsed?.files && typeof parsed.files === 'object' ? parsed.files : {};
  } catch {
    return {};
  }
}

// Streams to a .part file while hashing, so a 40 MB PDF never sits in memory and
// an interrupted download never leaves a truncated file under the final name.
// Returns a note when the bytes legitimately differ from the upload.
async function download(client, attachment, dest) {
  const res = await client.downloadAttachment(attachment.id, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
  const hash = createHash('md5');
  const tmp = `${dest}.part`;
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      }),
      createWriteStream(tmp),
    );
    const md5 = hash.digest('hex');
    let note = null;
    if (attachment.md5 && md5 !== attachment.md5) {
      // Cloudflare in front of the instance rewrites every text/html response
      // (Cloudflare Fonts inlines Google Fonts links as @font-face blocks, in a
      // different order each time), so an HTML file never matches its checksum.
      // Verified 2026-10-15 against a live instance. Any other type that differs
      // is corrupt and is refused.
      if (!/text\/html/i.test(res.headers.get('content-type') || '')) {
        throw new Error(`Downloaded file does not match the server checksum (md5 ${md5}, expected ${attachment.md5})`);
      }
      note = 'The server proxy rewrote this HTML on download (font declarations), so it differs from the uploaded bytes; the rest of the content is unchanged.';
    }
    await rename(tmp, dest);
    return note;
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function skip(attachment, reason) {
  Object.assign(attachment, { status: 'skipped', path: null, original_path: null, converted: null, note: reason });
}

export async function materializeAttachments(client, attachments, { dir, allFiles = false } = {}) {
  const originalDir = join(dir, 'original');
  await mkdir(originalDir, { recursive: true, mode: 0o700 });
  const cache = await readCache(dir);
  const maxBytes = allFiles ? Infinity : DEFAULT_MAX_BYTES;

  await client.mapLimit(attachments, async (a) => {
    const plan = planFor(a);
    const stem = fileStem(a);
    const originalPath = join(originalDir, a.extension ? `${stem}.${a.extension}` : stem);
    const outputPath =
      plan.action === 'text' ? originalPath : plan.output ? join(dir, `${stem}.${plan.output}`) : null;

    if (plan.action === 'none' && !allFiles) {
      return skip(a, `Not downloaded: ${a.extension || a.kind} files cannot be read as text or image. Pass --all-files to fetch the original anyway.`);
    }
    if ((a.size_bytes ?? 0) > maxBytes) {
      return skip(a, `Not downloaded: larger than ${DEFAULT_MAX_BYTES / 1024 / 1024} MB. Pass --all-files to fetch it.`);
    }

    const hit = cache[a.id];
    if (
      hit &&
      hit.pipeline === PIPELINE_VERSION &&
      hit.md5 === a.md5 &&
      existsSync(originalPath) &&
      (!hit.path || existsSync(hit.path))
    ) {
      Object.assign(a, {
        status: 'cached',
        path: hit.path,
        original_path: originalPath,
        converted: hit.converted,
        ...(hit.note ? { note: hit.note } : {}),
      });
      return;
    }

    let downloadNote = null;
    try {
      downloadNote = await download(client, a, originalPath);
    } catch (err) {
      Object.assign(a, { status: 'failed', path: null, original_path: null, converted: null, note: err.message });
      return;
    }

    let result = { path: null, converted: null, note: null };
    if (plan.action === 'text') {
      result = { path: originalPath, converted: 'none needed (already text)', note: downloadNote };
    } else if (plan.action === 'none') {
      result.note = 'Downloaded as is; no readable form exists for this type.';
    } else {
      try {
        const out = await convert(plan, a, originalPath, outputPath);
        result = { path: outputPath, converted: out.converted, note: out.note ?? null };
      } catch (err) {
        // The original is still on disk and may well be readable directly (a
        // PDF, an image a different decoder handles), so say where it is.
        result = { path: null, converted: null, note: `Conversion failed (${err.message}); the original is at original_path.` };
      }
    }

    Object.assign(a, {
      status: 'downloaded',
      path: result.path,
      original_path: originalPath,
      converted: result.converted,
      ...(result.note ? { note: result.note } : {}),
    });
    cache[a.id] = {
      pipeline: PIPELINE_VERSION,
      md5: a.md5,
      path: result.path,
      converted: result.converted,
      note: result.note ?? null,
    };
  });

  await writeFile(join(dir, CACHE_FILE), JSON.stringify({ files: cache }, null, 2), { mode: 0o600 });

  const count = (s) => attachments.filter((a) => a.status === s).length;
  return {
    directory: dir,
    downloaded: count('downloaded'),
    cached: count('cached'),
    skipped: count('skipped'),
    failed: count('failed'),
    readable: attachments.filter((a) => a.path).length,
  };
}
