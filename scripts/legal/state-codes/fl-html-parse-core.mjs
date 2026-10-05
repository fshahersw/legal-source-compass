import crypto from 'node:crypto';

export function decodeUtf8Strict(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function decodeHtmlEntities(s) {
  return s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function textContent(html) {
  return decodeHtmlEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function classMatches(openTag, className) {
  const m = openTag.match(/\bclass=["']([^"']*)["']/i);
  return Boolean(m?.[1].split(/\s+/).includes(className));
}

export function extractElementInnerHtmlByClass(html, className) {
  const openPattern = /<([a-z][a-z0-9]*)\b[^>]*>/gi;
  for (const open of html.matchAll(openPattern)) {
    if (!classMatches(open[0], className)) continue;
    const tag = open[1];
    const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    const tail = html.slice(open.index);
    token.lastIndex = 0;
    let depth = 0;
    let foundStart = null;
    for (const current of tail.matchAll(token)) {
      const piece = current[0];
      const absoluteIndex = open.index + current.index;
      if (/^<\//.test(piece)) depth--;
      else {
        if (foundStart === null) foundStart = absoluteIndex + piece.length;
        depth++;
      }
      if (foundStart !== null && depth === 0) return { innerHtml: html.slice(foundStart, absoluteIndex), start: open.index, end: absoluteIndex + piece.length, tag };
    }
    return { innerHtml: null, start: open.index, end: null, tag, unmatched: true };
  }
  return null;
}

export function extractClassText(html, className) {
  const element = extractElementInnerHtmlByClass(html, className);
  return element?.innerHtml == null ? null : textContent(element.innerHtml);
}

export function extractSectionBlocks(html) {
  const tags = /<div\b[^>]*>|<\/div\s*>/gi;
  const blocks = [];
  const unmatchedStarts = [];
  const nestedStarts = [];
  let active = null;
  let depth = 0;
  for (const m of html.matchAll(tags)) {
    const token = m[0];
    const isClose = /^<\//.test(token);
    if (!active) {
      if (!isClose && classMatches(token, 'Section')) {
        active = { start: m.index, openEnd: m.index + token.length };
        depth = 1;
      }
      continue;
    }
    if (!isClose && classMatches(token, 'Section')) nestedStarts.push(m.index);
    if (isClose) depth--;
    else depth++;
    if (depth === 0) {
      active.end = m.index + token.length;
      blocks.push(active);
      active = null;
    }
  }
  if (active) unmatchedStarts.push(active.start);
  return { blocks, unmatchedStarts, nestedStarts };
}

function citationFromSection(block) {
  const number = extractClassText(block, 'SectionNumber');
  if (!number) return { printed: null, normalized: null };
  const normalized = number.replace(/\s+/g, '');
  return { printed: number, normalized: /^\d{1,4}(?:\.\d+[A-Za-z]?)*(?:[A-Za-z])?$/.test(normalized) ? normalized : null };
}

export function parseSectionOccurrences(html, rawSha256) {
  const extracted = extractSectionBlocks(html);
  const seen = new Map();
  let missingNativeCitationCount = 0;
  const sections = extracted.blocks.map(span => {
    const block = html.slice(span.start, span.end);
    const citation = citationFromSection(block);
    if (!citation.normalized) missingNativeCitationCount++;
    const occurrence = (seen.get(citation.normalized) || 0) + 1;
    if (citation.normalized) seen.set(citation.normalized, occurrence);
    const fullText = textContent(block);
    const historyElement = extractElementInnerHtmlByClass(block, 'HistoryText');
    return {
      nativeCitationAsPrinted: citation.printed,
      normalizedCitationForJoin: citation.normalized,
      occurrenceOrdinalWithinChapter: occurrence,
      catchlineAsPrinted: extractClassText(block, 'CatchlineText'),
      historyAsPrinted: historyElement?.innerHtml == null ? null : textContent(historyElement.innerHtml),
      historyElementBalanced: !historyElement?.unmatched,
      text: fullText,
      sourceSpanUtf16: { start: span.start, end: span.end },
      sourceRawSha256: rawSha256,
      sectionTextSha256: crypto.createHash('sha256').update(fullText, 'utf8').digest('hex'),
    };
  });
  return { sections, unmatchedSectionBlockStarts: extracted.unmatchedStarts, nestedSectionBlockStarts: extracted.nestedStarts, missingNativeCitationCount };
}

export function extractChapterSectionIndex(html) {
  const rows = [];
  const tokenPattern = /<div\b[^>]*>|<\/div\s*>/gi;
  for (const m of html.matchAll(tokenPattern)) {
    if (/^<\//.test(m[0]) || !classMatches(m[0], 'IndexItem')) continue;
    const start = m.index;
    const tail = html.slice(start);
    const element = extractElementInnerHtmlByClass(tail, 'IndexItem');
    if (!element?.innerHtml) continue;
    const citation = extractClassText(element.innerHtml, 'SectionNumber');
    if (citation) rows.push({ nativeCitationAsPrinted: citation.replace(/\s+/g, ''), catchlineAsPrinted: extractClassText(element.innerHtml, 'Catchline') });
  }
  return rows;
}

export function occurrenceMismatches(indexRows, sectionRows) {
  const counts = rows => {
    const map = new Map();
    for (const row of rows) {
      const id = (row.nativeCitationAsPrinted || row.normalizedCitationForJoin || '').replace(/\s+/g, '');
      if (id) map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  };
  const expected = counts(indexRows);
  const actual = counts(sectionRows);
  return [...new Set([...expected.keys(), ...actual.keys()])].flatMap(citation => {
    const indexCount = expected.get(citation) || 0;
    const sectionCount = actual.get(citation) || 0;
    return indexCount === sectionCount ? [] : [{ citation, publisherIndexOccurrences: indexCount, fullTextSectionOccurrences: sectionCount }];
  });
}

export function chapterPairState({ nativeChapterId, printedChapterNumber, expectedTitleRoman, printedTitleNumber, expectedEdition, indexHasEdition, bodyHasEdition, sectionIndexCount, sectionOccurrences }) {
  const printedChapter = printedChapterNumber?.match(/\bCHAPTER\s+([\dA-Z-]+)/i)?.[1] || null;
  const printedTitle = printedTitleNumber?.match(/\bTITLE\s+([IVXLCDM]+)/i)?.[1] || null;
  if (printedChapter !== String(nativeChapterId) || printedTitle !== String(expectedTitleRoman)) return { status: 'identity_mismatch', printedChapter, printedTitle };
  if (!indexHasEdition || !bodyHasEdition || !expectedEdition) return { status: 'edition_unverified', printedChapter, printedTitle };
  if (sectionIndexCount === 0 && sectionOccurrences === 0) return { status: 'unresolved_empty_chapter', printedChapter, printedTitle };
  if (sectionIndexCount !== sectionOccurrences) return { status: 'section_count_mismatch', printedChapter, printedTitle };
  return { status: 'validated_structure', printedChapter, printedTitle };
}
