import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseTitlePage} from './wa-title-page-parser.mjs';

const wa = process.argv[2] ?? 'private/audit-2026-10-05/full-state-codes/wa';
const stage = path.join(wa, 'title-pages-1650');
const followupDir = path.join(wa, 'title-26-exact-href-1655');
const basePath = path.join(stage, 'native-title-chapter-link-inventory.json');
const outputPath = path.join(stage, 'native-title-chapter-link-inventory-with-title26-followup.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const baseBytes = await fs.readFile(basePath);
const base = JSON.parse(baseBytes);
const archive = JSON.parse(await fs.readFile(path.join(wa, 'archive-title-links.json'), 'utf8'));
const pilotReceipt = JSON.parse(await fs.readFile(path.join(wa, 'capture-pilot-20261005', 'receipt.json'), 'utf8'));
const title26Plan = JSON.parse(await fs.readFile(path.join(wa, 'title-26-exact-href-1655-plan.json'), 'utf8'));
const followupReceiptBytes = await fs.readFile(path.join(followupDir, 'receipt.json'));
const followupReceipt = JSON.parse(followupReceiptBytes);
const record = followupReceipt.results?.[0];
const sourceRow = archive.titleRows.find(row => row.titleLabel === '26');
if (!sourceRow || title26Plan.requests.length !== 1 || title26Plan.requests[0].url !== sourceRow.href || record?.url !== sourceRow.href || record.status !== 200 || record.outcome !== 'captured') throw new Error('Title26 follow-up is not an exact successful capture of the literal archive href.');
const body = await fs.readFile(record.rawPath);
if (body.length !== record.bytes || sha256(body) !== record.sha256 || body.length > title26Plan.maxObjectBytes || body.length > title26Plan.maxTotalBytes) throw new Error('Title26 follow-up body failed size/hash verification.');
const parsed = parseTitlePage(body.toString('utf8'));
if (parsed.nativeTitleId !== '26' || parsed.chapterIdentityMismatches.length || parsed.titlePdfIdentityMismatches.length) throw new Error('Title26 follow-up failed native identity checks.');
if (base.capturedTitlePages.some(page => page.titleLabel === '26')) throw new Error('Title26 already present in base inventory.');

const page = {
  titleLabel: '26', archiveCaption: sourceRow.caption, archiveHref: sourceRow.href,
  requestedUrl: record.url, finalUrl: record.finalUrl, rawPath: record.rawPath,
  rawBytes: record.bytes, rawSha256: record.sha256, nativeTitleId: parsed.nativeTitleId,
  identity: 'native-title-heading-matches-archive-row', chapterCount: parsed.chapters.length,
  titlePdfCount: parsed.titlePdfLinks.length, followupKind: 'exact-literal-archive-href-capture'
};
base.capturedTitlePages.push(page);
base.capturedTitlePages.sort((left, right) => archive.titleRows.findIndex(row => row.titleLabel === left.titleLabel) - archive.titleRows.findIndex(row => row.titleLabel === right.titleLabel));
for (const link of parsed.chapters) base.chapterLinks.push({titleLabel: '26', nativeTitleId: '26', ...link, source: {url: record.finalUrl, rawPath: record.rawPath, rawSha256: record.sha256}});
for (const link of parsed.titlePdfLinks) base.titlePdfLinks.push({titleLabel: '26', nativeTitleId: '26', ...link, source: {url: record.finalUrl, rawPath: record.rawPath, rawSha256: record.sha256}});
base.titleCoverage = base.titleCoverage.map(coverage => coverage.titleLabel === '26' ? {...coverage, status: 'raw-captured-and-native-identity-verified', rawSha256: record.sha256, priorMalformedUrl404s: 'Earlier requests had one extra encoded %20 before 26; they are not treated as evidence about this exact URL.'} : coverage);
base.stageA.supplementalCapture = {planPath: path.join(wa, 'title-26-exact-href-1655-plan.json'), planSha256: sha256(await fs.readFile(path.join(wa, 'title-26-exact-href-1655-plan.json'))), receiptPath: path.join(followupDir, 'receipt.json'), receiptSha256: sha256(followupReceiptBytes), requestedUrlExactArchiveHref: record.url === sourceRow.href, nativeTitleId: parsed.nativeTitleId, rawBytes: record.bytes, rawSha256: record.sha256, chapterHtmlLinksAdded: parsed.chapters.length, titlePdfLinksAdded: parsed.titlePdfLinks.length};
const chapterGroups = new Map();
for (const link of base.chapterLinks) { const refs = chapterGroups.get(link.href) ?? []; refs.push(`${link.titleLabel}:${link.chapterId}`); chapterGroups.set(link.href, refs); }
base.counts.rawNativeTitlePagesCaptured = base.capturedTitlePages.length;
base.counts.nativeTitleHeadingsMatchingRows = base.capturedTitlePages.filter(item => item.identity === 'native-title-heading-matches-archive-row').length;
base.counts.chapterHtmlLinksObserved = base.chapterLinks.length;
base.counts.distinctChapterHtmlHrefs = chapterGroups.size;
base.counts.duplicateChapterHrefGroups = [...chapterGroups.values()].filter(refs => refs.length > 1).length;
base.counts.titleDigestOrCompletePdfLinksObserved = base.titlePdfLinks.length;
base.counts.distinctTitlePdfHrefs = new Set(base.titlePdfLinks.map(link => link.href)).size;
base.counts.unverifiedTitle25Rows = base.titleCoverage.filter(item => item.status === 'unresolved-publisher-collision-not-covered').length;
base.counts.direct404Title26Rows = base.titleCoverage.filter(item => item.status === 'direct-title-page-http-404-no-body').length;
base.coverageLimits = base.coverageLimits.filter(limit => !limit.startsWith('The Title 26 raw direct GET returned 404'));
base.coverageLimits.unshift('Title 26 is now verified from the exact literal raw archive href. Title 25 remains unverified: its archive row points to native Title 26 / Domestic Relations, not Title 25 / Partnerships.');
base.supersedesInventory = {path: basePath, sha256: sha256(baseBytes), reason: 'Additive immutable exact-href Title26 capture; base Stage A inventory is preserved unchanged.'};
base.counts.title25Unresolved = true;
base.counts.title26Verified = true;
base.edition = '2026 RCW archive title-page links observed for native titles; not current-law reconciliation';
await fs.writeFile(outputPath, JSON.stringify(base, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({outputPath,baseInventorySha256:sha256(baseBytes),counts:base.counts,outputSha256:sha256(await fs.readFile(outputPath))}));
