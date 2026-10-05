#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/nc');
const inventory = JSON.parse(await fs.readFile(path.join(base, 'inventory.json'), 'utf8'));
const parse = JSON.parse(await fs.readFile(path.join(base, 'parse-report-v15.json'), 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const chapterSource = id => inventory.chapters.find(row => row.chapterId === id);
const captures = new Map();
for (const source of inventory.chapters) {
  const bytes = await fs.readFile(path.join(root, source.rawPath));
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) throw new Error(`Chapter ${source.chapterId} failed raw source receipt check`);
  captures.set(source.chapterId, bytes.toString('utf8'));
}
const notice = (chapterId, exactStart) => {
  const row = parse.counts.sourceNotices.find(item => item.chapterId === chapterId && item.text.startsWith(exactStart));
    if (!row) throw new Error(`Source notice not found in v15 report: Chapter ${chapterId}: ${exactStart}`);
  return { ...row, sourceUrl: chapterSource(chapterId).sourceUrl, rawFileSha256: chapterSource(chapterId).sha256 };
};
const verifiedCapture = async id => {
  const receiptName = id.startsWith('GS_78A-13-exception-') ? `${id}.json` : `${id}-exception.json`;
  const receiptPath = path.join(base, 'receipts', receiptName);
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  const rawFile = receipt.rawPath.startsWith('raw/') ? path.join(base, receipt.rawPath) : path.join(root, receipt.rawPath);
  const bytes = await fs.readFile(rawFile);
  if (bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256 || receipt.httpStatus !== 200) {
    throw new Error(`Publisher capture failed receipt verification: ${id}`);
  }
  return { receiptPath: path.relative(root, receiptPath).replaceAll('\\', '/'), ...receipt };
};
const exceptionGroups = [
  { chapterId: '78A', sectionId: '78A-13', captures: ['GS_78A-13-exception-section-html', 'GS_78A-13-exception-section-pdf', 'GS_78A-13-exception-section-library-index'], title: 'Disclosures required in offer and sale of viaticals.', headingPattern: /^§ 78A -13\.\s+Disclosures required in offer and sale of viaticals\.$/u },
  { chapterId: '105', sectionId: '105-151.11', captures: ['105-section-html', '105-section-pdf', '105-section-index'], title: 'Repealed by Session Laws 2013-316, s. 1.1(b), effective for taxable years beginning on or after January 1, 2014.', headingPattern: /^§ 105 151\.11\.\s+Repealed by Session Laws 2013-316, s\. 1\.1\(b\), effective for taxable years beginning on or after January 1, 2014\.$/u },
  { chapterId: '143', sectionId: '143-215.74H', captures: ['143-section-html', '143-section-pdf', '143-section-index'], title: 'Assistance.', headingPattern: /^§ 143\.215\.74H\.\s+Assistance\.$/u },
];
const publisherVerifiedExceptions = [];
for (const candidate of exceptionGroups) {
  const parsed = parse.counts.sourceIdentityReconciliations.find(row => row.citationIdentity === `${candidate.chapterId}:${candidate.sectionId}`);
  if (!parsed || parsed.reconciliation.kind !== 'exact-publisher-section-record-confirms-printed-identifier') {
    throw new Error(`Publisher-confirmed reconciliation missing for ${candidate.citationIdentity || candidate.sectionId}`);
  }
  if (parsed.reconciliation.publisherSectionRecord.publisherTitle !== candidate.title || !candidate.headingPattern.test(parsed.sourceHeadingText)) {
    throw new Error(`Heading/title mismatch for ${candidate.chapterId}:${candidate.sectionId}`);
  }
  const capturesForSection = await Promise.all(candidate.captures.map(verifiedCapture));
  const expectedEvidence = parsed.reconciliation.publisherSectionRecord;
  for (const [index, format] of ['html', 'pdf', 'index'].entries()) {
    if (capturesForSection[index].sha256 !== expectedEvidence[`${format}Sha256`]) {
      throw new Error(`Parser identity evidence does not match retained ${format} receipt for ${candidate.sectionId}`);
    }
  }
  publisherVerifiedExceptions.push({ ...parsed, publisherCaptures: capturesForSection });
}
if (parse.counts.unresolvedSingleSectionMarkerCount !== 0) throw new Error('Unexpected unresolved section markers remain; inspect the new parser report before accepting this audit.');

const items = [
  {
    status: 'preserved_as_nonsection_notice',
    reason: 'The publisher paragraph names two section identifiers and gives a shared repeal notice. It is not one native section heading; no individual section records were synthesized.',
    source: notice('58', '§ 58-77-1, 58-77-5.'),
  },
  {
    status: 'resolved_by_exact_publisher_section_record',
    reconciliation: publisherVerifiedExceptions.find(row => row.citationIdentity === '78A:78A-13'),
  },
  {
    status: 'preserved_as_nonsection_notice',
    reason: 'The publisher paragraph names §§ 115C-489.1 and 115C-489.2 together. It is a shared repeal notice, not one native section heading; no individual record was synthesized.',
    source: notice('115C', '§ 115C-489.1, 115C-489.2:'),
  },
  {
    status: 'resolved_by_exact_publisher_section_record',
    reconciliation: publisherVerifiedExceptions.find(row => row.citationIdentity === '105:105-151.11'),
  },
  {
    status: 'resolved_by_exact_publisher_section_record',
    reconciliation: publisherVerifiedExceptions.find(row => row.citationIdentity === '143:143-215.74H'),
  },
];

const report = {
  schemaVersion: 'nc-source-heading-exceptions-review/1',
  reviewedAt: new Date().toISOString(),
  sourceInventoryPath: 'private/audit-2026-10-05/full-state-codes/nc/inventory.json',
  parseReportPath: 'private/audit-2026-10-05/full-state-codes/nc/parse-report-v15.json',
  reviewMethod: 'Verified captured chapter-source receipts and separate official NCGA section HTML, section PDF, and section-index records against printed heading, publisher native identifier and title. Original printed headings remain unchanged.',
  sourceNoticeCounts: parse.counts.sourceNoticeKinds,
  reviewedExceptions: items,
  publisherVerifiedExceptions,
  textCompletenessAuditPath: 'private/audit-2026-10-05/full-state-codes/nc/text-completeness-audit-v6.json',
};
await fs.writeFile(path.join(base, 'source-heading-exceptions-review-v5.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
const md = [
  '# NC source-heading exceptions review',
  '',
  'The two multi-citation repeal paragraphs remain source notices; no combined notice is synthesized into a section. The plural-§ range/list notices remain preserved as source notices.',
  '',
  'The three malformed printed identifiers are mapped only in their matching chapter after exact publisher section HTML/PDF and chapter-index captures confirmed the native IDs and titles. Each original heading text is preserved in the parser result, with source offsets and capture receipt hashes in the JSON.',
  '',
  'The Chapter 105 section record and index identify 105-151.11 and print a repeal statement referencing Session Laws 2013-316. The Chapter 143 record and index identify 143-215.74H and title it “Assistance.” No legal interpretation is made here.',
  '',
  'The text-completeness audit found no visible body text outside paragraph/heading elements and no unassigned extracted rows. This checks parsing of captured pages, not legal completeness or current-law status.',
  '',
].join('\n');
await fs.writeFile(path.join(base, 'source-heading-exceptions-review-v5.md'), md, { flag: 'wx' });
console.log(JSON.stringify({ output: 'source-heading-exceptions-review-v5.json', reviewedItems: items.length, notices: parse.counts.sourceNoticeCount, unresolved: parse.counts.unresolvedSingleSectionMarkerCount }, null, 2));
