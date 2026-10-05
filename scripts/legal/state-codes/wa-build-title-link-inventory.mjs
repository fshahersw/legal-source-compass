import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseTitlePage} from './wa-title-page-parser.mjs';

const wa = process.argv[2] ?? 'private/audit-2026-10-05/full-state-codes/wa';
const stage = process.argv[3] ?? path.join(wa, 'title-pages-1650');
const outputPath = process.argv[4] ?? path.join(stage, 'native-title-chapter-link-inventory.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));

const pilotDir = path.join(wa, 'capture-pilot-20261005');
const pilotReceiptBytes = await fs.readFile(path.join(pilotDir, 'receipt.json'));
const pilotReceipt = JSON.parse(pilotReceiptBytes);
const archiveInventoryBytes = await fs.readFile(path.join(wa, 'archive-title-links.json'));
const archiveInventory = JSON.parse(archiveInventoryBytes);
const stageReceiptBytes = await fs.readFile(path.join(stage, 'receipt.json'));
const stageReceipt = JSON.parse(stageReceiptBytes);
const stagePlanBytes = await fs.readFile(path.join(stage, 'capture-plan.json'));
const stagePlan = JSON.parse(stagePlanBytes);
const archiveRaw = pilotReceipt.results.find(x => x.id === 'archive-2026-page');
if (!archiveRaw || archiveRaw.outcome !== 'captured') throw new Error('Missing successful official archive raw page receipt.');
const archiveBody = await fs.readFile(archiveRaw.rawPath);
if (archiveBody.length !== archiveRaw.bytes || sha256(archiveBody) !== archiveRaw.sha256 || archiveInventory.source.sha256 !== archiveRaw.sha256) throw new Error('Archive page/inventory source integrity mismatch.');

const checkedPilot = [];
for (const record of pilotReceipt.results.filter(x => x.outcome === 'captured')) {
  const body = await fs.readFile(record.rawPath);
  if (body.length !== record.bytes || sha256(body) !== record.sha256) throw new Error(`Prior pilot raw body failed verification: ${record.id}`);
  checkedPilot.push(record.id);
}
const stagePlanHash = sha256(stagePlanBytes);
if (stageReceipt.planSha256 !== stagePlanHash || stageReceipt.requestedCount !== 98 || stageReceipt.count !== 98 || stageReceipt.stopped || stageReceipt.unattempted.length) throw new Error('Stage A receipt is partial, stopped, or does not pin the expected 98-request plan.');
if (stagePlan.requests.length !== 98 || stageReceipt.results.length !== stagePlan.requests.length) throw new Error('Stage A request/receipt count mismatch.');
if (stageReceipt.results.some(record => record.status !== 200 || record.outcome !== 'captured')) throw new Error('Stage A contains a noncaptured or non-200 result.');

const archiveRows = archiveInventory.titleRows;
const archiveByLabel = new Map(archiveRows.map(row => [row.titleLabel.toUpperCase(), row]));
const requestsById = new Map(stagePlan.requests.map(request => [request.id, request]));
const capturedPages = [];
const parseErrors = [];
const chapterLinks = [];
const titlePdfLinks = [];
const identityMismatches = [];
let stageBytesVerified = 0;
for (const record of stageReceipt.results) {
  const request = requestsById.get(record.id);
  if (!request || request.url !== record.url) throw new Error(`Request/receipt identity mismatch for ${record.id}.`);
  const titleLabel = record.id.slice('title-'.length).toUpperCase();
  const archiveRow = archiveByLabel.get(titleLabel);
  if (!archiveRow || archiveRow.href !== record.url) throw new Error(`Request not backed by exact archive row ${titleLabel}.`);
  const body = await fs.readFile(record.rawPath);
  if (body.length !== record.bytes || body.length > stagePlan.maxObjectBytes || sha256(body) !== record.sha256) throw new Error(`Stage A raw body failed size/hash check: ${record.id}`);
  stageBytesVerified += body.length;
  let parsed;
  try { parsed = parseTitlePage(body.toString('utf8')); }
  catch (error) { parseErrors.push({titleLabel, rawPath: record.rawPath, rawSha256: record.sha256, error: String(error?.message ?? error)}); continue; }
  const identity = parsed.nativeTitleId === titleLabel ? 'native-title-heading-matches-archive-row' : 'native-title-heading-mismatch';
  const page = {
    titleLabel,
    archiveCaption: archiveRow.caption,
    archiveHref: archiveRow.href,
    requestedUrl: record.url,
    finalUrl: record.finalUrl,
    rawPath: record.rawPath,
    rawBytes: record.bytes,
    rawSha256: record.sha256,
    nativeTitleId: parsed.nativeTitleId,
    identity,
    chapterCount: parsed.chapters.length,
    titlePdfCount: parsed.titlePdfLinks.length
  };
  capturedPages.push(page);
  if (identity !== 'native-title-heading-matches-archive-row') identityMismatches.push({...page, kind: 'native-title-heading'});
  if (parsed.chapterIdentityMismatches.length) identityMismatches.push({titleLabel, kind: 'chapter-link-text-path', mismatches: parsed.chapterIdentityMismatches});
  if (parsed.titlePdfIdentityMismatches.length) identityMismatches.push({titleLabel, kind: 'title-pdf-path', mismatches: parsed.titlePdfIdentityMismatches});
  for (const link of parsed.chapters) chapterLinks.push({titleLabel, nativeTitleId: parsed.nativeTitleId, ...link, source: {url: record.finalUrl, rawPath: record.rawPath, rawSha256: record.sha256}});
  for (const link of parsed.titlePdfLinks) titlePdfLinks.push({titleLabel, nativeTitleId: parsed.nativeTitleId, ...link, source: {url: record.finalUrl, rawPath: record.rawPath, rawSha256: record.sha256}});
}

const pilotTitleOne = pilotReceipt.results.find(x => x.id === 'title-1-page');
if (!pilotTitleOne || pilotTitleOne.outcome !== 'captured') throw new Error('Missing previously captured Title 1 HTML pilot.');
const titleOneRow = archiveByLabel.get('1');
const titleOneBody = await fs.readFile(pilotTitleOne.rawPath);
if (sha256(titleOneBody) !== pilotTitleOne.sha256 || titleOneBody.length !== pilotTitleOne.bytes) throw new Error('Title 1 pilot raw body failed verification.');
const titleOneParsed = parseTitlePage(titleOneBody.toString('utf8'));
const titleOneIdentity = titleOneParsed.nativeTitleId === '1' ? 'native-title-heading-matches-archive-row' : 'native-title-heading-mismatch';
capturedPages.unshift({titleLabel: '1', archiveCaption: titleOneRow.caption, archiveHref: titleOneRow.href, requestedUrl: pilotTitleOne.url, finalUrl: pilotTitleOne.finalUrl, rawPath: pilotTitleOne.rawPath, rawBytes: pilotTitleOne.bytes, rawSha256: pilotTitleOne.sha256, nativeTitleId: titleOneParsed.nativeTitleId, identity: titleOneIdentity, chapterCount: titleOneParsed.chapters.length, titlePdfCount: titleOneParsed.titlePdfLinks.length});
if (titleOneIdentity !== 'native-title-heading-matches-archive-row') identityMismatches.push({titleLabel: '1', kind: 'native-title-heading'});
for (const link of titleOneParsed.chapters) chapterLinks.push({titleLabel: '1', nativeTitleId: titleOneParsed.nativeTitleId, ...link, source: {url: pilotTitleOne.finalUrl, rawPath: pilotTitleOne.rawPath, rawSha256: pilotTitleOne.sha256}});
for (const link of titleOneParsed.titlePdfLinks) titlePdfLinks.push({titleLabel: '1', nativeTitleId: titleOneParsed.nativeTitleId, ...link, source: {url: pilotTitleOne.finalUrl, rawPath: pilotTitleOne.rawPath, rawSha256: pilotTitleOne.sha256}});

if (stageBytesVerified !== stageReceipt.storedBytes || stageBytesVerified > stagePlan.maxTotalBytes) throw new Error('Stage A verified aggregate byte count differs from receipt or exceeds plan cap.');
const capturedLabels = new Set(capturedPages.map(page => page.titleLabel.toUpperCase()));
const titleCoverage = archiveRows.map(row => {
  const page = capturedPages.find(item => item.titleLabel.toUpperCase() === row.titleLabel.toUpperCase());
  if (page) return {titleLabel: row.titleLabel, caption: row.caption, href: row.href, status: page.identity === 'native-title-heading-matches-archive-row' ? 'raw-captured-and-native-identity-verified' : 'raw-captured-identity-mismatch', rawSha256: page.rawSha256};
  return {titleLabel: row.titleLabel, caption: row.caption, href: row.href, status: row.titleLabel === '25' ? 'unresolved-publisher-collision-not-covered' : row.titleLabel === '26' ? 'not-attempted-in-stage-a-see-additive-exact-href-follow-up' : 'not-captured'};
});
const chapterHrefGroups = new Map();
for (const link of chapterLinks) { const group = chapterHrefGroups.get(link.href) ?? []; group.push(`${link.titleLabel}:${link.chapterId}`); chapterHrefGroups.set(link.href, group); }
const inventory = {
  schemaVersion: 1,
  edition: '2026 RCW archive title-page links only; not current-law reconciliation',
  createdAt: new Date().toISOString(),
  source: {archiveUrl: archiveRaw.finalUrl, archiveRawPath: archiveRaw.rawPath, archiveRawBytes: archiveRaw.bytes, archiveRawSha256: archiveRaw.sha256, archiveInventoryPath: path.join(wa, 'archive-title-links.json'), archiveInventorySha256: sha256(archiveInventoryBytes)},
  stageA: {planPath: path.join(stage, 'capture-plan.json'), planSha256: stagePlanHash, receiptPath: path.join(stage, 'receipt.json'), receiptSha256: sha256(stageReceiptBytes), requestJournalPath: stageReceipt.requestJournalPath, verifiedRawPages: stageReceipt.storedBodies, verifiedRawBytes: stageBytesVerified, allStageRequestsReturned200: true, minimumDelayMs: stageReceipt.limits.minDelayMs, outputCaps: stageReceipt.limits},
  previousPilot: {receiptPath: path.join(pilotDir, 'receipt.json'), receiptSha256: sha256(pilotReceiptBytes), verifiedPilotRawBodies: checkedPilot.length},
  titleCoverage,
  capturedTitlePages: capturedPages,
  chapterLinks,
  titlePdfLinks,
  parseErrors,
  identityMismatches,
  counts: {archiveTitleRows: archiveRows.length, distinctArchivePageHrefs: archiveInventory.counts.distinctExactPageHrefs, rawNativeTitlePagesCaptured: capturedPages.length, nativeTitleHeadingsMatchingRows: capturedPages.filter(x => x.identity === 'native-title-heading-matches-archive-row').length, chapterHtmlLinksObserved: chapterLinks.length, distinctChapterHtmlHrefs: chapterHrefGroups.size, duplicateChapterHrefGroups: [...chapterHrefGroups].filter(([,refs]) => refs.length > 1).length, titleDigestOrCompletePdfLinksObserved: titlePdfLinks.length, distinctTitlePdfHrefs: new Set(titlePdfLinks.map(x => x.href)).size, parseErrors: parseErrors.length, identityMismatches: identityMismatches.length, unverifiedTitle25Rows: titleCoverage.filter(x => x.status === 'unresolved-publisher-collision-not-covered').length, title26ExcludedFromStageARows: titleCoverage.filter(x => x.status === 'not-attempted-in-stage-a-see-additive-exact-href-follow-up').length},
  coverageLimits: ['Title 25 remains unverified because the publisher maps it to the Title 26 page; no native Title 25 identity was observed.', 'Title 26 was excluded from Stage A because of the archive-row collision; the separate exact-literal-href follow-up resolves Title 26 and is merged only by the additive follow-up tool.', 'This inventory records exact chapter and complete-title/digest PDF hrefs visible in captured title pages. No bulk chapter HTML or PDFs were requested in Stage A.', 'The 2026 archive edition statement does not establish that all statutes are current as of retrieval or incorporate later effective laws.']
};
await fs.writeFile(outputPath, JSON.stringify(inventory, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({outputPath, counts: inventory.counts, stageBytesVerified, outputSha256: sha256(await fs.readFile(outputPath))}));
