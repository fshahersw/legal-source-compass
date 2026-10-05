import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = 'private/audit-2026-10-05/full-state-codes/or';

function entityDecode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const numeric = entity[1]?.toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : whole;
    }
    const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sect: '§', para: '¶' };
    return named[entity.toLowerCase()] ?? whole;
  });
}

function htmlText(fragment, encoding) {
  const decoded = new TextDecoder(encoding).decode(Buffer.from(fragment, 'latin1'));
  return entityDecode(decoded
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n[\t ]*/g, '\n')
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseChapterHtml(bytes, chapterId) {
  const raw = Buffer.from(bytes).toString('latin1');
  const charset = raw.match(/<meta\b[^>]*charset\s*=\s*["']?([^"'\s;>]+)/i)?.[1]?.toLowerCase();
  const encoding = charset === 'windows-1252' || charset === 'cp1252' ? 'windows-1252'
    : charset === 'utf-8' || charset === 'utf8' ? 'utf-8'
      : null;
  if (!encoding) throw new Error(`Unsupported or missing publisher charset for chapter ${chapterId}: ${charset ?? 'none'}`);
  const citation = new RegExp(`^\\s*(${escapeRegExp(String(chapterId))}\\.\\d+[A-Z]?)\\b`, 'i');
  const paragraphs = [...raw.matchAll(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    html: match[0],
    boldTexts: [...match[0].matchAll(/<b\b[^>]*>([\s\S]*?)<\/b\s*>/gi)].map((bold) => htmlText(bold[1], encoding)),
  }));
  const sectionHeads = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const bold = paragraphs[i].boldTexts.find((text) => citation.test(text));
    if (!bold) continue;
    const match = bold.match(citation);
    if (!match) continue;
    sectionHeads.push({ paragraphIndex: i, citation: match[1], title: bold.slice(match[0].length).replace(/[.:;]+$/, '').trim() });
  }
  const metadata = raw.match(/Chapter\s+([0-9]+[A-Z]?)\s+([^<\r\n]+)/i);
  const chapterTitle = metadata
    ? htmlText(metadata[2], encoding).replace(/^[\u2010-\u2015-]\s*/, '')
    : null;
  const sections = sectionHeads.map((head, i) => {
    const start = paragraphs[head.paragraphIndex].start;
    const end = sectionHeads[i + 1] ? paragraphs[sectionHeads[i + 1].paragraphIndex].start : raw.length;
    return {
      chapter: String(chapterId),
      chapterTitle,
      citation: `ORS ${head.citation}`,
      title: head.title || null,
      sourceSpan: { byteStart: start, byteEnd: end },
      text: htmlText(raw.slice(start, end), encoding),
    };
  });
  return { encoding, sections };
}

export function parseTitleChapterListHtml(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const charset = raw.match(/<meta\b[^>]*charset\s*=\s*["']?([^"'\s;>]+)/i)?.[1]?.toLowerCase();
  const encoding = charset === 'windows-1252' || charset === 'cp1252' ? 'windows-1252'
    : charset === 'utf-8' || charset === 'utf8' ? 'utf-8'
      : null;
  if (!encoding) throw new Error(`Unsupported or missing publisher charset: ${charset ?? 'none'}`);
  const paragraphs = [...raw.matchAll(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    text: htmlText(match[0], encoding),
  }));
  const titleIndex = paragraphs.findIndex((p) => /^TITLE\s+\d+[A-Z]?$/i.test(p.text));
  if (titleIndex < 0) return { encoding, titleNumber: null, titleName: null, chapters: [] };
  const titleNumber = paragraphs[titleIndex].text.match(/^TITLE\s+(\d+[A-Z]?)$/i)?.[1] ?? null;
  const titleName = paragraphs.slice(titleIndex + 1).find((p) => p.text && !/^Chapter\s+\d+/i.test(p.text))?.text.replace(/\s+/g, ' ').trim() ?? null;
  const startIndex = paragraphs.findIndex((p, i) => i > titleIndex && /^Chapter\s+\d+[A-Z]?\./i.test(p.text));
  if (startIndex < 0) return { encoding, titleNumber, titleName, chapters: [] };
  const chapters = [];
  for (let i = startIndex; i < paragraphs.length; i += 1) {
    const paragraph = paragraphs[i];
    if (/^_{3,}$/.test(paragraph.text)) break;
    const first = paragraph.text.match(/^Chapter\s+(\d+[A-Z]?)\.\s*([\s\S]+)$/i);
    const next = paragraph.text.match(/^(\d+[A-Z]?)\.\s+([\s\S]+)$/i);
    const match = first ?? next;
    if (!match) continue;
    chapters.push({ chapter: match[1], title: match[2].replace(/\s+/g, ' ').trim(), sourceSpan: { byteStart: paragraph.start, byteEnd: paragraph.end } });
  }
  return { encoding, titleNumber, titleName, chapters };
}

export function parseTitleRows(text) {
  const rows = [];
  let volume = null;
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const range = pending.description.match(/\bChs?\.?\s+(\d+[A-Z]?)\s*(?:-|–|—|to)\s*(\d+[A-Z]?)\b/i);
    const single = pending.description.match(/\bCh\.\s*(\d+[A-Z]?)\b/i);
    if (!range && !single) throw new Error(`Title row has no parsed chapter range: ${pending.description}`);
    rows.push({
      volume: pending.volume,
      titleNumber: pending.titleNumber,
      titleName: pending.description.slice(0, (range ?? single).index).replace(/[\s–—-]+$/, '').trim(),
      chapterStart: range?.[1] ?? single[1],
      chapterEnd: range?.[2] ?? single[1],
    });
    pending = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const volumeMatch = line.match(/^\s*Volume\s+(\d+)\s*$/i);
    if (volumeMatch) { volume = Number(volumeMatch[1]); continue; }
    const titleMatch = volume >= 1 && volume <= 19
      ? line.match(/^\s*(?:Title\s+)?(\d+[A-Z]?)\s+(.+?)\s*$/i)
      : null;
    if (titleMatch) {
      if (pending) flush();
      pending = { volume, titleNumber: titleMatch[1], description: titleMatch[2] };
      if (/\bChs?\.?\s+\d|\bCh\.\s*\d/i.test(pending.description)) flush();
    } else if (pending && line.trim()) {
      pending.description += ` ${line.trim()}`;
      if (/\bChs?\.?\s+\d|\bCh\.\s*\d/i.test(pending.description)) flush();
    }
  }
  if (pending) flush();
  return rows;
}

export function expandChapterRange(start, end, availableIds) {
  const parseId = (id) => {
    const match = String(id).match(/^(\d+)([A-Z]*)$/i);
    if (!match) throw new Error(`Invalid chapter identifier: ${id}`);
    return { number: Number(match[1]), suffix: match[2].toUpperCase() };
  };
  const first = parseId(start), last = parseId(end);
  return availableIds.filter((id) => {
    const item = parseId(id);
    if (item.number < first.number || item.number > last.number) return false;
    if (item.number === first.number && item.suffix < first.suffix) return false;
    if (item.number === last.number && item.suffix > last.suffix) return false;
    return true;
  });
}

async function main() {
  const manifest = JSON.parse(await readFile(`${root}/chapter-acquisition-manifest.json`, 'utf8'));
  const candidateInventory = JSON.parse(await readFile(`${root}/ors-chapter-inventory-candidates.json`, 'utf8'));
  const candidateIds = candidateInventory.chapterIds.map(String);
  const titlesText = await readFile(`${root}/ors-titles-chapters-2025.txt`, 'utf8');
  const titleRows = parseTitleRows(titlesText);
  const chapterTitles = new Map();
  for (const title of titleRows) {
    for (const chapterId of expandChapterRange(title.chapterStart, title.chapterEnd, candidateIds)) {
      if (chapterTitles.has(chapterId)) throw new Error(`Duplicate title-table chapter assignment: ${chapterId}`);
      chapterTitles.set(chapterId, title);
    }
  }
  const unassignedCandidates = candidateIds.filter((id) => !chapterTitles.has(id));
  if (unassignedCandidates.length) throw new Error(`Title table did not classify chapters: ${unassignedCandidates.join(', ')}`);

  const rows = [];
  const emptyChapters = [];
  for (const chapter of manifest.chapters) {
    const bytes = await readFile(chapter.localPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== chapter.sha256 || bytes.length !== chapter.bytes) throw new Error(`Pinned source mismatch for ORS chapter ${chapter.inventoryId}`);
    const parsed = parseChapterHtml(bytes, chapter.inventoryId);
    if (!parsed.sections.length) {
      const raw = bytes.toString('latin1');
      const formerProvisions = new RegExp(`Chapter\\s+${escapeRegExp(String(chapter.inventoryId))}\\s+\\(Former Provisions\\)`, 'i').test(raw);
      emptyChapters.push({
        chapter: String(chapter.inventoryId),
        httpStatus: chapter.status,
        sourceSha256: sha256,
        classification: formerProvisions ? 'former-provisions-note-only-no-numbered-section-headings' : 'no-section-heading-detected-needs-review',
        hasReservedPlaceholder: /\[Reserved for expansion\]/i.test(htmlText(raw.slice(0, Math.min(raw.length, 16000)), parsed.encoding)),
        hasHistoricalRepealOrExpiryNote: /\b(?:repealed|expired|stood repealed|in effect until)\b/i.test(htmlText(raw.slice(0, Math.min(raw.length, 16000)), parsed.encoding)),
      });
    }
    for (const section of parsed.sections) {
      const title = chapterTitles.get(String(chapter.inventoryId));
      rows.push({
        edition: '2025 Oregon Revised Statutes',
        volume: title?.volume ?? null,
        titleNumber: title?.titleNumber ?? null,
        titleName: title?.titleName ?? null,
        chapter: section.chapter,
        chapterTitle: section.chapterTitle,
        citation: section.citation,
        title: section.title,
        source: { url: chapter.url, rawPath: chapter.localPath, rawSha256: chapter.sha256, ...section.sourceSpan },
        text: section.text,
      });
    }
  }
  const body = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  const outputPath = `${root}/ors-2025-section-inventory.jsonl`;
  await writeFile(outputPath, body, { flag: 'wx' });
  const duplicateCitations = [...new Set(rows.map((row) => row.citation).filter((citation, i, all) => all.indexOf(citation) !== i))];
  const report = {
    edition: '2025 Oregon Revised Statutes',
    parserVersion: 3,
    capturedChapters: manifest.capturedCount,
    titleRows: titleRows.length,
    titleRangeClassifiedCandidates: chapterTitles.size,
    candidateChapters: manifest.inventoryCandidateCount,
    unresolvedChapters: manifest.unresolvedCount,
    http404AtDerivedChapterPathCount: manifest.notPublishedAtDerivedPathCount,
    sectionRows: rows.length,
    inventoryComplete: false,
    inventoryStatus: 'These section rows cover captured chapters from the title-range candidate set only. The official publisher chapter TOCs reveal additional suffix chapters; exact-ID TOC enumeration and additive acquisition are still pending.',
    duplicateCitationsRetainedAsDistinctSourceSpans: duplicateCitations,
    sourceFilesWithNoDetectedSections: emptyChapters,
    outputPath,
    outputSha256: createHash('sha256').update(body).digest('hex'),
    limitation: 'This is the 2025 published edition text, not a consolidated 2026 code. The official 2026 Update instructions and chapter notices must be reconciled with 2025 special-session and 2026 regular-session Oregon Laws before a current-as-of-2026 claim. A 404 at a derived chapter URL does not establish that a chapter or provision is absent from the ORS.',
  };
  await writeFile(`${root}/ors-2025-section-inventory-report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
