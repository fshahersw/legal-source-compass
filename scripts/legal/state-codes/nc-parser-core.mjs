export function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&sect;/gi, '§')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–');
}

export function plainTextOf(markup) {
  return decodeHtmlEntities(markup
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim());
}

export function extractParagraphs(html) {
  const rows = [];
  const pattern = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const value = plainTextOf(match[2]);
    if (value) rows.push({ tag: match[1].toLowerCase(), text: value, sourceOffset: match.index });
  }
  return rows;
}

export function sectionHeading(text) {
  // Require whitespace between the entire native section number and its title.
  // In particular, `§ 20-123.2 Speedometer` has no punctuation after the ID;
  // treating the ID's decimal dot as a delimiter would truncate it to 20-123.
  const match = text.match(/^§\s*([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?:\.[A-Za-z0-9]+)*(?::[A-Za-z0-9]+)*)(?:[.:]?\s+)(.+)$/u);
  if (!match) return null;
  return { sectionId: match[1], heading: match[2].trim() };
}

export function parseChapter(chapter, html, rawSha256) {
  const rows = extractParagraphs(html);
  const hierarchy = { subchapter: null, articleNumber: null, articleTitle: null, part: null };
  let pendingArticle = false;
  let chapterTitle = null;
  let active = null;
  const sections = [];
  const otherHeadings = [];
  const unparsedSingleSectionMarkerRows = [];
  const finish = () => {
    if (!active) return;
    active.bodyText = active.paragraphs.join('\n');
    active.textFromHeadingFallback = !active.bodyText;
    active.text = active.bodyText || active.heading;
    delete active.paragraphs;
    sections.push(active);
    active = null;
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const section = sectionHeading(row.text);
    if (section) {
      finish();
      active = {
        chapterId: chapter.chapterId,
        sectionId: section.sectionId,
        citationIdentity: `${chapter.chapterId}:${section.sectionId}`,
        citation: `N.C. Gen. Stat. § ${section.sectionId}`,
        heading: section.heading,
        sourceVersionQualifier: section.heading.match(/^\((Effective[^)]*)\)\s*/i)?.[1] || null,
        hierarchy: { ...hierarchy },
        source: {
          url: chapter.sourceUrl,
          rawSha256,
          htmlCharacterOffset: row.sourceOffset,
          paragraphIndex: index,
        },
        paragraphs: [],
      };
      continue;
    }
    if (/^§\s/.test(row.text)) {
      finish();
      const nextSection = rows.slice(index + 1).find(candidate => sectionHeading(candidate.text));
      unparsedSingleSectionMarkerRows.push({
        text: row.text,
        sourceOffset: row.sourceOffset,
        sourceEndCharacterOffset: nextSection?.sourceOffset ?? html.length,
        paragraphIndex: index,
      });
      continue;
    }
    const subchapter = row.text.match(/^SUBCHAPTER\s+([IVXLCDM0-9A-Z]+)\.?\s*(.*)$/i);
    if (subchapter) {
      finish();
      pendingArticle = false;
      hierarchy.subchapter = [subchapter[1], subchapter[2]].filter(Boolean).join('. ').trim();
      hierarchy.articleNumber = null;
      hierarchy.articleTitle = null;
      hierarchy.part = null;
      otherHeadings.push({ chapterId: chapter.chapterId, kind: 'subchapter', text: row.text, sourceOffset: row.sourceOffset });
      continue;
    }
    const article = row.text.match(/^Article\s+([A-Za-z0-9.-]+)\.?\s*(.*)$/i);
    if (article) {
      finish();
      const inlineTitle = article[2].trim() || null;
      pendingArticle = !inlineTitle;
      hierarchy.articleNumber = article[1].replace(/\.$/, '');
      hierarchy.articleTitle = inlineTitle;
      hierarchy.part = null;
      otherHeadings.push({ chapterId: chapter.chapterId, kind: 'article', text: row.text, sourceOffset: row.sourceOffset });
      continue;
    }
    if (pendingArticle && !active && !/^§\s/.test(row.text) && row.tag === 'p' && !/^(?:Part|SUBCHAPTER|Chapter)\b/i.test(row.text)) {
      hierarchy.articleTitle = row.text;
      pendingArticle = false;
      continue;
    }
    const part = row.text.match(/^Part\s+([A-Za-z0-9.-]+)\.?\s*(.*)$/i);
    if (part) {
      finish();
      pendingArticle = false;
      hierarchy.part = [part[1].replace(/\.$/, ''), part[2]].filter(Boolean).join('. ').trim();
      otherHeadings.push({ chapterId: chapter.chapterId, kind: 'part', text: row.text, sourceOffset: row.sourceOffset });
      continue;
    }
    if (/^Chapter\s+[0-9A-Z]/i.test(row.text) && !chapterTitle) {
      const following = rows[index + 1]?.text;
      if (following && !sectionHeading(following)) chapterTitle = following;
      continue;
    }
    if (active) active.paragraphs.push(row.text);
  }
  finish();
  const repeatedIds = sections.map(section => section.sectionId).filter((id, index, all) => all.indexOf(id) !== index);
  const occurrenceCounts = new Map();
  for (const section of sections) {
    const occurrence = (occurrenceCounts.get(section.citationIdentity) || 0) + 1;
    occurrenceCounts.set(section.citationIdentity, occurrence);
    section.occurrenceWithinCitation = occurrence;
  }
  return {
    sections,
    hierarchyHeadings: otherHeadings,
    chapterTitle,
    paragraphCount: rows.length,
    repeatedSectionIds: [...new Set(repeatedIds)],
    unparsedSingleSectionMarkerRows,
    sourceParagraphs: rows,
  };
}

const explicitStatus = /\b(?:repealed|recodified|transferred|expired|unconstitutional|abolished)\b/i;
export function classifyNoSectionSource(parsed) {
  const evidence = parsed.sourceParagraphs
    .filter(row => row.text !== parsed.chapterTitle && !/^Chapter\s+[0-9A-Z]/i.test(row.text))
    .map(row => row.text);
  if (!evidence.length) return { parseStatus: 'chapter_heading_only_no_body_text', evidence: [] };
  if (evidence.some(text => explicitStatus.test(text))) {
    return { parseStatus: 'source_explicit_status_stub', evidence };
  }
  return { parseStatus: 'nonempty_no_section_heading_review', evidence };
}
