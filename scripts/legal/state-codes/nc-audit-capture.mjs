#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/nc');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inventoryPath = path.join(base, 'inventory.json');
const inventoryBytes = await fs.readFile(inventoryPath);
const inventory = JSON.parse(inventoryBytes.toString('utf8'));
const tocBytes = await fs.readFile(path.join(root, inventory.source.tocCapture.rawPath));
if (sha256(tocBytes) !== inventory.source.tocCapture.sha256 || tocBytes.length !== inventory.source.tocCapture.bytes) throw new Error('TOC raw capture does not match receipt');
const tocHtml = tocBytes.toString('utf8');
const versionBlock = tocHtml.match(/The General Statutes include changes through([\s\S]*?)<\/h5>/i)?.[1] || '';
const versionStatement = versionBlock
  ? `The General Statutes include changes through ${versionBlock.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+\./g, '.')}`
  : null;

const chapterResults = [];
for (const row of inventory.chapters) {
  const bytes = await fs.readFile(path.join(root, row.rawPath));
  const actualHash = sha256(bytes);
  chapterResults.push({ chapterId: row.chapterId, expectedBytes: row.bytes, actualBytes: bytes.length, expectedSha256: row.sha256, actualSha256: actualHash, valid: actualHash === row.sha256 && bytes.length === row.bytes && row.httpStatus === 200 });
}
if (chapterResults.some(row => !row.valid)) throw new Error('One or more chapter raw files failed receipt verification');

const starts = inventory.chapters.map(row => Date.parse(row.retrievedAt)).sort((a, b) => a - b);
const intervals = starts.slice(1).map((time, index) => time - starts[index]);
const supportReceiptPath = path.join(base, 'receipts/law-modifications-current-linked.json');
const supportReceipt = JSON.parse(await fs.readFile(supportReceiptPath, 'utf8'));
const supportBytes = await fs.readFile(path.join(root, supportReceipt.rawPath));
const supportIntegrityValid = supportBytes.length === supportReceipt.bytes && sha256(supportBytes) === supportReceipt.sha256;
if (!supportIntegrityValid || supportReceipt.httpStatus !== 200) throw new Error('Current modifications page capture failed integrity check');

const parse = JSON.parse(await fs.readFile(path.join(base, 'parse-report-v7.json'), 'utf8'));
const report = {
  schemaVersion: 'nc-state-code-capture-audit/1',
  auditedAt: new Date().toISOString(),
  inventoryPath: 'private/audit-2026-10-05/full-state-codes/nc/inventory.json',
  inventorySha256: sha256(inventoryBytes),
  tableOfContents: {
    url: inventory.source.tocUrl,
    rawPath: inventory.source.tocCapture.rawPath,
    bytes: tocBytes.length,
    sha256: sha256(tocBytes),
    extractedVersionStatement: versionStatement,
    statementSource: 'Exact captured TOC HTML text; this audit does not update the historical inventory record.',
  },
  chapters: {
    tocHtmlLinks: inventory.counts.tocChapterHtmlLinks,
    attempted: inventory.counts.chaptersAttempted,
    http200WithVerifiedRawBodies: chapterResults.filter(row => row.valid).length,
    failures: chapterResults.filter(row => !row.valid),
    totalRawBytes: chapterResults.reduce((sum, row) => sum + row.actualBytes, 0),
    perChapterReceiptVerification: chapterResults,
  },
  requestPacingEvidence: {
    chapterRequestStarts: starts.length,
    minimumRecordedStartIntervalMs: intervals.length ? Math.min(...intervals) : null,
    intervalsUnderConfiguredOneSecondTarget: intervals.filter(value => value < 1000).length,
    configuredTargetMs: inventory.source.minimumStartPaceMs,
    assessment: intervals.some(value => value < 1000) ? 'The captured run did not meet a global one-second start interval. The acquisition script now serializes future request-start reservations; these existing captures retain their own timestamps and are not retroactively described as paced.' : 'Recorded timestamps satisfy the configured minimum interval.',
  },
  currentModificationsSupportCapture: {
    requestedUrl: supportReceipt.requestedUrl,
    rawPath: supportReceipt.rawPath,
    retrievedAt: supportReceipt.retrievedAt,
    httpStatus: supportReceipt.httpStatus,
    bytes: supportReceipt.bytes,
    sha256: supportReceipt.sha256,
    integrityValid: supportIntegrityValid,
    note: 'This exact /Laws/Modifications/Current link was separately captured after the initial inventory. The earlier inventory support entry points to /Laws/Modifications and is retained as historical capture provenance.',
  },
  parser: {
    reportPath: 'private/audit-2026-10-05/full-state-codes/nc/parse-report-v7.json',
    rawChapterReceiptChecksPassedDuringParse: true,
    chapterCount: parse.counts.chaptersParsed,
    sectionOccurrences: parse.counts.statutorySectionOccurrences,
    uniqueCitationIdentities: parse.counts.uniqueSectionCitationIdentities,
    repeatedCitationIdentityCount: parse.counts.repeatedCitationIdentityCount,
    sourceStubCount: parse.counts.sourceStubCount,
    nonemptyNoSectionReviewCount: parse.counts.chaptersWithNonemptyUnparsedText,
    parserFailureCount: parse.counts.parserFailureCount,
    unresolvedSingleSectionMarkerCount: parse.counts.unresolvedSingleSectionMarkerCount,
    unresolvedSingleSectionMarkerRows: parse.counts.unresolvedSingleSectionMarkerRows,
    htmlSourceWasMachineReadable: true,
    ocrNeeded: false,
  },
  caveat: 'NCGA says the published General Statutes pages are not official. The TOC states the through-session-law marker recorded above. This acquisition and parser output are not a certification of current law, uncodified changes, or exhaustive legal text.',
};
if (report.chapters.failures.length || report.parser.parserFailureCount) throw new Error('Audit found chapter acquisition or parse failures');
await fs.writeFile(path.join(base, 'capture-audit-v8.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
const summary = [
  '# North Carolina state-code capture audit',
  '',
  `Audited ${report.chapters.http200WithVerifiedRawBodies}/${report.chapters.tocHtmlLinks} TOC-linked chapter HTML bodies; all response bodies match their recorded SHA-256 and byte counts.`,
  `Parser: ${report.parser.chapterCount} chapters; ${report.parser.sectionOccurrences} section occurrences; ${report.parser.uniqueCitationIdentities} unique citation identities; ${report.parser.repeatedCitationIdentityCount} citations with repeated source occurrences; ${report.parser.sourceStubCount} explicit source stubs; ${report.parser.parserFailureCount} parser failures.`,
  `Unresolved source-heading candidates: ${report.parser.unresolvedSingleSectionMarkerCount}; see capture-audit-v8.json for exact source text, offsets, raw-span SHA-256 and bytes. These rows were retained separately and terminate any preceding section body.`,
  `Captured TOC marker: ${report.tableOfContents.extractedVersionStatement}`,
  `Pacing: ${report.requestPacingEvidence.intervalsUnderConfiguredOneSecondTarget} of ${report.requestPacingEvidence.chapterRequestStarts - 1} adjacent request-start intervals were below the configured 1,000 ms target (minimum ${report.requestPacingEvidence.minimumRecordedStartIntervalMs} ms). ${report.requestPacingEvidence.assessment}`,
  `Current modifications page separately verified: ${report.currentModificationsSupportCapture.requestedUrl} (${report.currentModificationsSupportCapture.bytes} bytes, SHA-256 ${report.currentModificationsSupportCapture.sha256}).`,
  '',
  report.caveat,
  '',
].join('\n');
await fs.writeFile(path.join(base, 'capture-audit-v8.md'), `This v8 report supersedes prior capture-audit reports and references parser v7, which requires a whitespace boundary after each full native section identifier and records unresolved single-marker headings.\n\n${summary}`, { flag: 'wx' });
console.log(JSON.stringify({ auditPath: 'capture-audit-v8.json', chapters: report.chapters.http200WithVerifiedRawBodies, sectionOccurrences: report.parser.sectionOccurrences, uniqueCitationIdentities: report.parser.uniqueCitationIdentities, unresolvedCandidates: report.parser.unresolvedSingleSectionMarkerCount, parserFailures: report.parser.parserFailureCount }, null, 2));
