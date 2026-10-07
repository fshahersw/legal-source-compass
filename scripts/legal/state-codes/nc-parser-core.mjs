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

// ncleg.gov chapter pages style hierarchy headings (Article/Part/SUBCHAPTER) as centred blocks and
// section body text as justified blocks. A justified body line that merely begins with "Article 4 of
// Chapter 150B ..." or "part of ..." is body text, not a heading. Pages that carry no style rules at all
// give no signal, so every row is then allowed to be a heading (the previous behaviour).
function centredClassNames(html) {
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
  if (!/text-align\s*:/i.test(styles)) return null;
  const names = new Set();
  for (const rule of styles.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
    if (/text-align\s*:\s*center/i.test(rule[2])) names.add(rule[1]);
  }
  return names;
}

export function extractParagraphs(html) {
  const rows = [];
  const centred = centredClassNames(html);
  const pattern = /<(h[1-6]|p)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const value = plainTextOf(match[3]);
    if (!value) continue;
    const tag = match[1].toLowerCase();
    const classes = (match[2].match(/\bclass\s*=\s*"([^"]*)"/i)?.[1] || '').split(/\s+/).filter(Boolean);
    const headingStyle = centred === null || tag !== 'p' || classes.some(name => centred.has(name));
    rows.push({ tag, text: value, sourceOffset: match.index, headingStyle });
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

const reviewedPublisherIdentityExceptions = {
  '78A': {
    pattern: /^§\s*78A\s+-\s*13\.[.:]?\s+(.+)$/u,
    sectionId: '78A-13',
    record: {
      htmlUrl: 'https://ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_78A/GS_78A-13.html',
      htmlSha256: '4f8087c23d1eae915fcce1ee462542f4d715712302ffa65bb4c11456b0bbd245',
      pdfUrl: 'https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_78A/GS_78A-13.pdf',
      pdfSha256: '83ce2dd51d4e2c1d233fe6ff18f31f6815ae12213acb899c11b387cdb9052932',
      indexUrl: 'https://library.ncleg.gov/Laws/GeneralStatuteSections/Chapter78A',
      indexSha256: '09e2fe7a6152103b64409999b2e47aa7b8b8f87b2f7d8c5550f838928b48c32f',
      publisherTitle: 'Disclosures required in offer and sale of viaticals.',
    },
  },
  '105': {
    pattern: /^§\s*105\s+151\.11\.[.:]?\s+(.+)$/u,
    sectionId: '105-151.11',
    record: {
      htmlUrl: 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_105/GS_105-151.11.html',
      htmlSha256: '28e9aefa38dbb5f56dd65a39b19efb930260a063d91aae58574c44b76659e02e',
      pdfUrl: 'https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_105/GS_105-151.11.pdf',
      pdfSha256: 'cb6de8f5d56865490c6bc0b1691225a9b29838afdf2227223771a5dc3eee181a',
      indexUrl: 'https://ncleg.gov/Laws/GeneralStatuteSections/Chapter105',
      indexSha256: '0e64cd9366c98aaa4c2c0e8f0d45d6678bb776758ec75d82aa5782d081f73091',
      publisherTitle: 'Repealed by Session Laws 2013-316, s. 1.1(b), effective for taxable years beginning on or after January 1, 2014.',
    },
  },
  '143': {
    pattern: /^§\s*143\.215\.74H\.[.:]?\s+(.+)$/u,
    sectionId: '143-215.74H',
    record: {
      htmlUrl: 'https://ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_143/GS_143-215.74H.html',
      htmlSha256: '899b928f92e9f66f503991c71edb1dd8bf9d625a4d793c40ab2347b2ea17aafd',
      pdfUrl: 'https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_143/GS_143-215.74H.pdf',
      pdfSha256: 'f2dcef49e39102c282c213eb06b7b3fc1e174d9d2cc3842f9025bd871ee0aed3',
      indexUrl: 'https://ncleg.gov/Laws/GeneralStatuteSections/Chapter143',
      indexSha256: 'fbd777b5ba3d4274394af0e9a6b1c69847046103ed3e2e5ac17cd115b4919f4d',
      publisherTitle: 'Assistance.',
    },
  },
};

export function parseChapter(chapter, html, rawSha256) {
  const rows = extractParagraphs(html);
  const paragraphDispositions = Array(rows.length).fill(null);
  const markParagraph = (index, role) => {
    if (paragraphDispositions[index] === null) paragraphDispositions[index] = role;
  };
  const sectionHeadings = rows.map(row => {
    const exact = sectionHeading(row.text);
    if (exact) return exact;
    const publisherException = reviewedPublisherIdentityExceptions[String(chapter.chapterId).toUpperCase()];
    const publisherMatch = publisherException?.pattern.exec(row.text);
    const normalizedPublisherTitle = publisherMatch?.[1].trim().replace(/\s+/g, ' ');
    if (publisherException && publisherMatch && normalizedPublisherTitle === publisherException.record.publisherTitle) {
      return {
        sectionId: publisherException.sectionId,
        heading: publisherMatch[1].trim(),
        identityReconciliation: {
          kind: 'exact-publisher-section-record-confirms-printed-identifier',
          printedHeading: row.text,
          canonicalIdentifier: publisherException.sectionId,
          publisherSectionRecord: publisherException.record,
        },
      };
    }
    return null;
  });
  const hierarchy = { subchapter: null, articleNumber: null, articleTitle: null, part: null };
  let pendingArticle = false;
  let chapterTitle = null;
  let active = null;
  const sections = [];
  const otherHeadings = [];
  const sourceNotices = [];
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
    if (paragraphDispositions[index] !== null) continue;
    const row = rows[index];
    const section = sectionHeadings[index];
    if (section) {
      markParagraph(index, 'section_heading');
      finish();
      active = {
        chapterId: chapter.chapterId,
        sectionId: section.sectionId,
        citationIdentity: `${chapter.chapterId}:${section.sectionId}`,
        citation: `N.C. Gen. Stat. § ${section.sectionId}`,
        heading: section.heading,
        sourceHeadingText: row.text,
        sourceIdentityReconciliation: section.identityReconciliation || null,
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
    const multiCitationNotice = /^§\s/.test(row.text)
      && /,\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?:\.[A-Za-z0-9]+)*/.test(row.text)
      && /\b(?:repealed|recodified|transferred|expired|unconstitutional|abolished|superseded|redesignated|deleted|not in effect|not effectuated)\b/i.test(row.text);
    if (/^§§/.test(row.text) || multiCitationNotice) {
      markParagraph(index, 'source_notice');
      finish();
      const nextMarkerIndex = rows.findIndex((candidate, candidateIndex) => candidateIndex > index && (sectionHeadings[candidateIndex] || /^§§/.test(candidate.text) || /^§\s/.test(candidate.text)));
      const nextMarker = nextMarkerIndex >= 0 ? rows[nextMarkerIndex] : null;
      sourceNotices.push({
        kind: row.text.startsWith('§§') ? 'multi_section_source_notice' : 'multi_citation_source_notice',
        text: row.text,
        sourceOffset: row.sourceOffset,
        sourceEndCharacterOffset: nextMarker?.sourceOffset ?? html.length,
        paragraphIndex: index,
      });
      continue;
    }
    if (/^§\s/.test(row.text)) {
      markParagraph(index, 'unresolved_section_marker');
      finish();
      const nextMarkerIndex = rows.findIndex((candidate, candidateIndex) => candidateIndex > index && (sectionHeadings[candidateIndex] || /^§§/.test(candidate.text) || /^§\s/.test(candidate.text)));
      const nextMarker = nextMarkerIndex >= 0 ? rows[nextMarkerIndex] : null;
      unparsedSingleSectionMarkerRows.push({
        text: row.text,
        sourceOffset: row.sourceOffset,
        sourceEndCharacterOffset: nextMarker?.sourceOffset ?? html.length,
        paragraphIndex: index,
      });
      continue;
    }
    const subchapter = !row.headingStyle ? null : row.text.match(/^SUBCHAPTER\s+([IVXLCDM0-9A-Z]+)\.?\s*(.*)$/i);
    if (subchapter) {
      markParagraph(index, 'subchapter_heading');
      finish();
      pendingArticle = false;
      hierarchy.subchapter = [subchapter[1], subchapter[2]].filter(Boolean).join('. ').trim();
      hierarchy.articleNumber = null;
      hierarchy.articleTitle = null;
      hierarchy.part = null;
      otherHeadings.push({ chapterId: chapter.chapterId, kind: 'subchapter', text: row.text, sourceOffset: row.sourceOffset });
      continue;
    }
    const article = !row.headingStyle ? null : row.text.match(/^Article\s+([A-Za-z0-9.-]+)\.?\s*(.*)$/i);
    if (article) {
      markParagraph(index, 'article_heading');
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
      markParagraph(index, 'article_title');
      hierarchy.articleTitle = row.text;
      pendingArticle = false;
      continue;
    }
    const part = !row.headingStyle ? null : row.text.match(/^Part\s+([A-Za-z0-9.-]+)\.?\s*(.*)$/i);
    if (part) {
      markParagraph(index, 'part_heading');
      finish();
      pendingArticle = false;
      hierarchy.part = [part[1].replace(/\.$/, ''), part[2]].filter(Boolean).join('. ').trim();
      otherHeadings.push({ chapterId: chapter.chapterId, kind: 'part', text: row.text, sourceOffset: row.sourceOffset });
      continue;
    }
    if (row.headingStyle && /^Chapter\s+[0-9A-Z]/i.test(row.text) && !chapterTitle) {
      markParagraph(index, 'chapter_header');
      const following = rows[index + 1]?.text;
      if (following && !sectionHeadings[index + 1]) {
        chapterTitle = following;
        markParagraph(index + 1, 'chapter_title');
      }
      continue;
    }
    if (active) {
      markParagraph(index, 'section_body');
      active.paragraphs.push(row.text);
    } else {
      markParagraph(index, 'outside_section_preamble');
    }
  }
  finish();
  const repeatedIds = sections.map(section => section.sectionId).filter((id, index, all) => all.indexOf(id) !== index);
  const occurrenceCounts = new Map();
  for (const section of sections) {
    const occurrence = (occurrenceCounts.get(section.citationIdentity) || 0) + 1;
    occurrenceCounts.set(section.citationIdentity, occurrence);
    section.occurrenceWithinCitation = occurrence;
  }
  const paragraphDispositionCounts = {};
  for (const role of paragraphDispositions) paragraphDispositionCounts[role || 'unassigned'] = (paragraphDispositionCounts[role || 'unassigned'] || 0) + 1;
  return {
    sections,
    hierarchyHeadings: otherHeadings,
    chapterTitle,
    paragraphCount: rows.length,
    paragraphDispositionCounts,
    unassignedParagraphCount: paragraphDispositions.filter(role => role === null).length,
    repeatedSectionIds: [...new Set(repeatedIds)],
    sourceNotices,
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
