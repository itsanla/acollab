// Turns a downloaded attachment into the form an AI reads best: images become
// a JPEG no larger than 1200 px on the long edge, documents become Markdown.
//
// Every converter is lossy (a PDF loses its pictures, a shrunk screenshot its
// smallest text), which is why the original is always kept next to the result
// and every Markdown file names it in its header.
//
// Libraries are imported on first use: sharp alone is a native module, and
// commands that never touch a file should not pay for loading it.

import { copyFile, readFile, writeFile } from 'node:fs/promises';

export const IMAGE_MAX_EDGE = 1200;

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg']);
const SHEET_EXT = new Set(['xlsx', 'xlsm', 'xls', 'ods']);
// Already plain text: readable as downloaded, so they are not rewritten.
const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'sql', 'html', 'htm',
  'ini', 'env', 'sh', 'js', 'ts', 'jsx', 'tsx', 'py', 'php', 'java', 'go', 'rb', 'css', 'groovy', 'bpmn',
]);

// What happens to a file, decided before it is downloaded so that files nothing
// can read (video, archives) are not fetched by default.
export function planFor(attachment) {
  const ext = attachment.extension || '';
  if (IMAGE_EXT.has(ext) || attachment.kind === 'image') return { action: 'image', output: 'jpg' };
  if (ext === 'pdf') return { action: 'pdf', output: 'md' };
  if (ext === 'docx') return { action: 'docx', output: 'md' };
  if (SHEET_EXT.has(ext)) return { action: 'sheet', output: 'md' };
  if (ext === 'pptx') return { action: 'pptx', output: 'md' };
  if (TEXT_EXT.has(ext) || /^text\//.test(attachment.mime_type || '')) return { action: 'text' };
  return { action: 'none' };
}

export async function convert(plan, attachment, originalPath, outputPath) {
  switch (plan.action) {
    case 'image':
      return imageToJpeg(originalPath, outputPath);
    case 'pdf':
      return pdfToMarkdown(attachment, originalPath, outputPath);
    case 'docx':
      return docxToMarkdown(attachment, originalPath, outputPath);
    case 'sheet':
      return sheetToMarkdown(attachment, originalPath, outputPath);
    case 'pptx':
      return pptxToMarkdown(attachment, originalPath, outputPath);
    default:
      throw new Error(`No converter for action "${plan.action}"`);
  }
}

// --- images -------------------------------------------------------------

async function imageToJpeg(src, dest) {
  const sharp = (await import('sharp')).default;
  // failOn 'none': a slightly truncated JPEG from a phone still decodes in every
  // viewer, and refusing it here would hide a picture a person can see.
  const meta = await sharp(src, { failOn: 'none' }).metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);
  const upright = !meta.orientation || meta.orientation === 1;

  // A small, upright JPEG is already what we want; re-encoding would only lose
  // quality.
  if (meta.format === 'jpeg' && longEdge <= IMAGE_MAX_EDGE && upright) {
    await copyFile(src, dest);
    return { converted: `kept as is (${meta.width}x${meta.height} jpeg)`, width: meta.width, height: meta.height };
  }

  const info = await sharp(src, { failOn: 'none' })
    // Applies the EXIF orientation, so a phone photo is not read sideways by a
    // decoder that ignores the tag.
    .rotate()
    .resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    // JPEG has no alpha: without this a transparent PNG turns black.
    .flatten({ background: '#ffffff' })
    // 90 rather than the usual 80 keeps small text in screenshots legible.
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(dest);

  return {
    converted: `${meta.width}x${meta.height} ${meta.format} -> ${info.width}x${info.height} jpeg`,
    width: info.width,
    height: info.height,
  };
}

// --- documents ----------------------------------------------------------

function header(attachment, originalPath, from, extra) {
  return [
    `# ${attachment.name}`,
    '',
    `> Converted by acollab-cli from ${from} (attachment #${attachment.id}). ${extra}`,
    `> Original: ${originalPath}`,
    '',
  ].join('\n');
}

async function pdfToMarkdown(attachment, src, dest) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(src)));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const chars = text.reduce((n, t) => n + t.replace(/\s/g, '').length, 0);
  // A scanned or image-only PDF has no text layer; an empty Markdown file would
  // read as "this document says nothing", so the gap is named instead.
  const textless = chars < 30 * totalPages;

  const body = text
    .map((t, i) => `## Page ${i + 1}\n\n${t.trim() || '_(no text on this page)_'}`)
    .join('\n\n');
  const note = textless
    ? 'Little or no text layer was found: this is likely a scan or a slide deck made of images. Read the original PDF.'
    : 'Text only: images, charts and layout are not included; read the original PDF for those.';

  await writeFile(dest, `${header(attachment, src, 'PDF', note)}\n${body}\n`);
  return {
    converted: `pdf -> markdown, ${totalPages} page(s), ${chars} characters`,
    pages: totalPages,
    ...(textless ? { note: 'No usable text layer; the original PDF must be read instead.' } : {}),
  };
}

async function docxToMarkdown(attachment, src, dest) {
  const mammoth = (await import('mammoth')).default;
  const TurndownService = (await import('turndown')).default;

  let images = 0;
  // Through HTML rather than mammoth's own Markdown writer, which flattens every
  // table into one paragraph per cell and backslash-escapes ordinary
  // punctuation ("\(Maks\. 3\)"). Verified on a real SOP attachment.
  const { value: html } = await mammoth.convertToHtml(
    { path: src },
    {
      // The default inlines every picture as base64, which turns a 2 MB report
      // into megabytes of noise. A marker says where it was.
      convertImage: mammoth.images.imgElement(async () => {
        images += 1;
        return { src: 'acollab-omitted-image' };
      }),
    },
  );

  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    strongDelimiter: '**',
  });
  td.addRule('omittedImage', {
    filter: 'img',
    replacement: (_, node) => {
      const alt = node.getAttribute('alt');
      return `[embedded image${alt ? `: ${alt}` : ''}, see original]`;
    },
  });
  td.addRule('table', {
    filter: 'table',
    replacement: (_, node) => `\n\n${tableToMarkdown(node, td)}\n\n`,
  });

  const md = td.turndown(html);
  const note = images
    ? `${images} embedded image(s) are not included; read the original for those.`
    : 'Formatting beyond headings, lists, tables and emphasis is not kept.';
  await writeFile(dest, `${header(attachment, src, 'DOCX', note)}\n${md.trim()}\n`);
  return { converted: `docx -> markdown, ${md.length} characters${images ? `, ${images} image(s) omitted` : ''}` };
}

// Word tables have no header row of their own, so the first row is taken as one,
// which is how they read in practice. Rows of a nested table belong to that
// table, not to this one.
function tableToMarkdown(table, td) {
  const rows = Array.from(table.getElementsByTagName('tr')).filter((tr) => closest(tr, 'TABLE') === table);
  const grid = rows.map((tr) =>
    Array.from(tr.childNodes)
      .filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')
      .map((cell) => mdCell(td.turndown(cell.innerHTML).replace(/\n+/g, '<br>'))),
  );
  const nonEmpty = grid.filter((r) => r.some((c) => c !== ''));
  if (!nonEmpty.length) return '';
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? '');
  const [head, ...rest] = nonEmpty;
  return [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...rest.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n');
}

function closest(node, name) {
  let n = node.parentNode;
  while (n && n.nodeName !== name) n = n.parentNode;
  return n;
}

function mdCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

async function sheetToMarkdown(attachment, src, dest) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await readFile(src), { type: 'buffer', cellDates: true });
  const parts = [];
  const counts = [];

  for (const name of wb.SheetNames) {
    // raw:false gives the text a person sees in the cell (formatted numbers and
    // dates), not the stored serial value.
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    counts.push(`${name}: ${nonEmpty.length} row(s)`);
    if (!nonEmpty.length) {
      parts.push(`## ${name}\n\n_(empty sheet)_`);
      continue;
    }
    const width = Math.max(...nonEmpty.map((r) => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => mdCell(r[i]));
    const [head, ...rest] = nonEmpty;
    const lines = [
      `| ${pad(head).join(' | ')} |`,
      `| ${Array(width).fill('---').join(' | ')} |`,
      ...rest.map((r) => `| ${pad(r).join(' | ')} |`),
    ];
    parts.push(`## ${name}\n\n${lines.join('\n')}`);
  }

  const note = 'Each sheet is a table whose first non-empty row is the header. Formulas show their computed value; charts and colours are not included.';
  await writeFile(dest, `${header(attachment, src, 'a spreadsheet', note)}\n${parts.join('\n\n')}\n`);
  return { converted: `spreadsheet -> markdown, ${wb.SheetNames.length} sheet(s) (${counts.join('; ')})` };
}

function xmlText(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

async function pptxToMarkdown(attachment, src, dest) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await readFile(src));
  const slideNo = (p) => Number(p.match(/slide(\d+)\.xml$/)[1]);
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNo(a) - slideNo(b));

  const parts = [];
  for (const path of slides) {
    const xml = await zip.file(path).async('string');
    // One <a:p> is one paragraph; its <a:t> runs are the visible text.
    // The patterns require a space or ">" after the tag name so that <a:pPr>,
    // <a:tab> and <a:tbl> are not mistaken for them.
    const paragraphs = [...xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)]
      .map((m) => [...m[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => xmlText(t[1])).join(''))
      .map((t) => t.trim())
      .filter(Boolean);
    parts.push(`## Slide ${slideNo(path)}\n\n${paragraphs.join('\n\n') || '_(no text on this slide)_'}`);
  }

  const note = 'Slide text only: pictures, charts and layout are not included; read the original for those.';
  await writeFile(dest, `${header(attachment, src, 'PPTX', note)}\n${parts.join('\n\n')}\n`);
  return { converted: `pptx -> markdown, ${slides.length} slide(s)` };
}
