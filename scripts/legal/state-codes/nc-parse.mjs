#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseChapter, classifyNoSectionSource } from './nc-parser-core.mjs';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/nc');
const inventoryPath = path.join(base, 'inventory.json');
const parsedDir = path.join(base, 'parsed/v15/chapters');
const reportPath = path.join(base, 'parse-report-v15.json');
await fs.mkdir(parsedDir, { recursive: true });

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
if (inventory.counts?.acquiredHttp200 !== inventory.chapters?.length) {
  throw new Error('Refusing to parse an incomplete or failed chapter inventory.');
}
const tocCapture = inventory.source.tocCapture;
const tocBytes = await fs.readFile(path.join(root, tocCapture.rawPath));
if (sha256(tocBytes) !== tocCapture.sha256 || tocBytes.length !== tocCapture.bytes) throw new Error('TOC capture does not match its source receipt.');
const versionBlock = tocBytes.toString('utf8').match(/The General Statutes include changes through([\s\S]*?)<\/h5>/i)?.[1] || '';
const sourceVersion = versionBlock
  ? `The General Statutes include changes through ${versionBlock.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+\./g, '.')}`
  : null;
const allSections = [];
const results = [];
for (const chapter of inventory.chapters) {
  const rawPath = path.join(root, chapter.rawPath);
  const bytes = await fs.readFile(rawPath);
  const rawSha256 = sha256(bytes);
  if (rawSha256 !== chapter.sha256 || bytes.length !== chapter.bytes) throw new Error(`Raw source receipt mismatch for Chapter ${chapter.chapterId}`);
  const parsed = parseChapter(chapter, bytes.toString('utf8'), rawSha256);
  const rawText = bytes.toString('utf8');
  const unresolvedHeadings = parsed.unparsedSingleSectionMarkerRows.map(row => {
    const rawSpan = rawText.slice(row.sourceOffset, row.sourceEndCharacterOffset);
    const rawSpanBytes = Buffer.from(rawSpan, 'utf8');
    return {
      ...row,
      rawSpanBytes: rawSpanBytes.length,
      rawSpanSha256: sha256(rawSpanBytes),
    };
  });
  const notices = parsed.sourceNotices.map(row => {
    const rawSpan = rawText.slice(row.sourceOffset, row.sourceEndCharacterOffset);
    const rawSpanBytes = Buffer.from(rawSpan, 'utf8');
    return {
      ...row,
      rawSpanBytes: rawSpanBytes.length,
      rawSpanSha256: sha256(rawSpanBytes),
    };
  });
  const outputPath = path.join(parsedDir, `chapter-${chapter.chapterId}.jsonl`);
  const body = parsed.sections.map(row => JSON.stringify(row)).join('\n') + (parsed.sections.length ? '\n' : '');
  await fs.writeFile(outputPath, body, { flag: 'wx' });
  const noSection = parsed.sections.length ? { parseStatus: 'parsed_sections', evidence: [] } : classifyNoSectionSource(parsed);
  results.push({
    chapterId: chapter.chapterId,
    sourceUrl: chapter.sourceUrl,
    rawPath: chapter.rawPath,
    rawSha256,
    rawBytes: bytes.length,
    chapterTitle: parsed.chapterTitle,
    paragraphCount: parsed.paragraphCount,
    paragraphDispositionCounts: parsed.paragraphDispositionCounts,
    unassignedParagraphCount: parsed.unassignedParagraphCount,
    sectionCount: parsed.sections.length,
    unparsedSingleSectionMarkerRows: unresolvedHeadings,
    sourceNotices: notices,
    hierarchyHeadingCount: parsed.hierarchyHeadings.length,
    repeatedSectionIds: parsed.repeatedSectionIds,
    parsedPath: path.relative(root, outputPath).replaceAll('\\', '/'),
    parsedSha256: sha256(Buffer.from(body, 'utf8')),
    parseStatus: noSection.parseStatus,
    noSectionSourceEvidence: noSection.evidence,
  });
  allSections.push(...parsed.sections);
}

const identityGroups = new Map();
const sectionIdChapters = new Map();
for (const row of allSections) {
  const group = identityGroups.get(row.citationIdentity) || [];
  group.push(row);
  identityGroups.set(row.citationIdentity, group);
  const chapters = sectionIdChapters.get(row.sectionId) || new Set();
  chapters.add(row.chapterId);
  sectionIdChapters.set(row.sectionId, chapters);
}
const repeatedSectionIdentities = [...identityGroups]
  .filter(([, rows]) => rows.length > 1)
  .map(([citationIdentity, rows]) => ({
    citationIdentity,
    occurrences: rows.map(row => ({
      occurrenceWithinCitation: row.occurrenceWithinCitation,
      heading: row.heading,
      sourceVersionQualifier: row.sourceVersionQualifier,
      source: row.source,
    })),
  }));
const report = {
  schemaVersion: 'nc-general-statutes-parse-report/15',
  parserRevision: 15,
  parser: 'scripts/legal/state-codes/nc-parser-core.mjs',
  parsedAt: new Date().toISOString(),
  sourceInventory: inventory.counts,
  sourceVersion,
  sourceTocRawPath: tocCapture.rawPath,
  sourceTocSha256: tocCapture.sha256,
  counts: {
    chaptersInSourceInventory: inventory.chapters.length,
    chaptersParsed: results.length,
    extractedSourceParagraphRows: results.reduce((sum, x) => sum + x.paragraphCount, 0),
    unassignedSourceParagraphCount: results.reduce((sum, x) => sum + x.unassignedParagraphCount, 0),
    sourceParagraphDispositionCounts: Object.fromEntries([...new Set(results.flatMap(x => Object.keys(x.paragraphDispositionCounts)))].map(role => [role, results.reduce((sum, x) => sum + (x.paragraphDispositionCounts[role] || 0), 0)])),
    chaptersWithSections: results.filter(x => x.sectionCount > 0).length,
    chaptersWithExplicitStatusStub: results.filter(x => x.parseStatus === 'source_explicit_status_stub').length,
    chaptersWithNonemptyUnparsedText: results.filter(x => x.parseStatus === 'nonempty_no_section_heading_review').length,
    chapterHeadingOnlyWithoutBody: results.filter(x => x.parseStatus === 'chapter_heading_only_no_body_text').length,
    parserFailureCount: results.filter(x => x.parseStatus === 'nonempty_no_section_heading_review' || x.unassignedParagraphCount > 0).length,
    unresolvedSingleSectionMarkerCount: results.reduce((sum, x) => sum + x.unparsedSingleSectionMarkerRows.length, 0),
    unresolvedSingleSectionMarkerRows: results.flatMap(x => x.unparsedSingleSectionMarkerRows.map(row => ({ chapterId: x.chapterId, ...row }))),
    sourceNoticeCount: results.reduce((sum, x) => sum + x.sourceNotices.length, 0),
    sourceNoticeKinds: Object.fromEntries([...new Set(results.flatMap(x => x.sourceNotices.map(row => row.kind)))].map(kind => [kind, results.reduce((sum, x) => sum + x.sourceNotices.filter(row => row.kind === kind).length, 0)])),
    sourceNotices: results.flatMap(x => x.sourceNotices.map(row => ({ chapterId: x.chapterId, ...row }))),
    sourceStubCount: results.filter(x => x.parseStatus === 'source_explicit_status_stub').length,
    statutorySectionOccurrences: allSections.length,
    uniqueSectionCitationIdentities: identityGroups.size,
    repeatedCitationIdentityCount: repeatedSectionIdentities.length,
    sourceIdentityReconciliationCount: allSections.filter(row => row.sourceIdentityReconciliation).length,
    sourceIdentityReconciliations: allSections.filter(row => row.sourceIdentityReconciliation).map(row => ({
      chapterId: row.chapterId,
      sectionId: row.sectionId,
      citationIdentity: row.citationIdentity,
      sourceHeadingText: row.sourceHeadingText,
      reconciliation: row.sourceIdentityReconciliation,
      source: row.source,
    })),
    additionalSourceOccurrencesWithinRepeatedIdentities: repeatedSectionIdentities.reduce((sum, x) => sum + x.occurrences.length - 1, 0),
    repeatedSectionIdentities,
    sectionIdAcrossChapterCollisions: [...sectionIdChapters]
      .filter(([, chapters]) => chapters.size > 1)
      .map(([sectionId, chapters]) => ({ sectionId, chapterIds: [...chapters].sort() })),
  },
  chapters: results,
  caveat: 'Parser extracts section-body paragraphs from acquired chapter HTML, not TOC rows. Repeated section citations remain distinct source occurrences and retain any effective-date qualifier printed in the heading; the parser selects or collapses no version. A source page with no section heading is not treated as parser success merely because its chapter appears in the TOC: explicit repeal/transfer/expiry stubs are reported separately, and nonempty unclassified pages are flagged for review. Source HTML hashes/byte lengths were checked before parsing. The source pages state a through-session-law marker and warn that the website General Statutes are not official; this derivative is not a current-law certification.',
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ reportPath: path.relative(root, reportPath), counts: report.counts }, null, 2));
