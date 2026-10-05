import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const wa = process.argv[2] ?? 'private/audit-2026-10-05/full-state-codes/wa';
const outputDir = process.argv[3] ?? path.join(wa, 'complete-title-pdfs-plan-v2-20261005');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inventoryPath = path.join(wa, 'title-pages-1650', 'native-title-chapter-link-inventory-with-title26-followup.json');
const inventoryBytes = await fs.readFile(inventoryPath);
const inventory = JSON.parse(inventoryBytes);
const pilotPath = path.join(wa, 'capture-pilot-20261005', 'receipt.json');
const pilotBytes = await fs.readFile(pilotPath);
const pilot = JSON.parse(pilotBytes);
const stagePath = path.join(wa, 'title-pages-1650', 'receipt.json');
const stageBytes = await fs.readFile(stagePath);
const stage = JSON.parse(stageBytes);
const title26Path = path.join(wa, 'title-26-exact-href-1655', 'receipt.json');
const title26Bytes = await fs.readFile(title26Path);
const title26 = JSON.parse(title26Bytes);

if (inventory.counts.nativeTitleHeadingsMatchingRows !== 100 || inventory.counts.unverifiedTitle25Rows !== 1 || inventory.counts.title26Verified !== true) throw new Error('Native title inventory gate failed.');
if (inventory.source.archiveRawSha256 !== '94d2aaa9c0c255fa1c89dccd8865f26520370244637d00a9e7f10e7b57140264') throw new Error('Unexpected archive source hash.');
for (const [label, receipt, expectedCount] of [['pilot', pilot, 7], ['stage-A', stage, 98], ['exact-Title-26', title26, 1]]) {
  if (receipt.results.length !== expectedCount) throw new Error(`${label} source receipt count is incomplete.`);
  if (label !== 'pilot' && receipt.results.some(row => row.outcome !== 'captured' || row.status !== 200)) throw new Error(`${label} source receipt is incomplete.`);
  if (label === 'pilot' && receipt.results.filter(row => row.outcome === 'captured').length !== 6) throw new Error('Pilot captured-body count changed.');
  for (const row of receipt.results.filter(row => row.outcome === 'captured')) {
    const body = await fs.readFile(row.rawPath);
    if (body.length !== row.bytes || sha256(body) !== row.sha256) throw new Error(`${label} raw body integrity failed: ${row.id}`);
  }
}
if (sha256(inventoryBytes) !== '268052732386672b46978baa0e23333dda1394fc443e2f727bcaf05078b31e94' || sha256(pilotBytes) !== '7fd4f80f03fbc1c48ea3f3abe1cbdde5e9a674654ecdf557491ec48e9ae890dd') throw new Error('Frozen source inventory or pilot receipt hash changed.');

const links = inventory.titlePdfLinks.filter(row => row.label === 'Complete Title');
const byTitle = new Map(links.map(row => [row.titleLabel, row]));
if (links.length !== 100 || byTitle.size !== links.length || !byTitle.has('1')) throw new Error('Expected exactly one native Complete Title link for each of 100 verified titles.');
const titleOne = pilot.results.find(row => row.id === 'title-1-complete-pdf');
if (!titleOne || titleOne.outcome !== 'captured' || titleOne.status !== 200) throw new Error('Existing Title 1 Complete Title PDF is not available.');
const titleOneRaw = await fs.readFile(titleOne.rawPath);
if (titleOneRaw.length !== titleOne.bytes || sha256(titleOneRaw) !== titleOne.sha256) throw new Error('Existing Title 1 Complete Title PDF failed integrity verification.');

const requests = [...byTitle.values()].filter(row => row.titleLabel !== '1').sort((a, b) => Number(a.titleLabel) - Number(b.titleLabel)).map(row => {
  if (row.identityCheck !== 'text-and-path-match' || row.hrefTitleId !== row.nativeTitleId) throw new Error(`Complete Title link identity check failed for title ${row.titleLabel}.`);
  return {id: `complete-title-${row.titleLabel}`, label: `RCW Title ${row.titleLabel} Complete Title PDF`, titleId: row.nativeTitleId, url: row.href, discovery: {titlePageUrl: row.source.url, titlePageRawPath: row.source.rawPath, titlePageRawSha256: row.source.rawSha256, observedLinkLabel: row.label, identityCheck: row.identityCheck}};
});
if (requests.length !== 99 || new Set(requests.map(row => row.url)).size !== 99) throw new Error('Expected 99 unique new exact PDF hrefs.');
const plan = {schemaVersion: 1, edition: '2026 RCW archive Complete Title PDFs; exact publisher hrefs only; not current-law reconciliation', createdAt: new Date().toISOString(), sourceInventoryPath: inventoryPath, sourceInventorySha256: sha256(inventoryBytes), existingTitle1Pdf: {receiptPath: pilotPath, receiptSha256: sha256(pilotBytes), id: titleOne.id, rawPath: titleOne.rawPath, bytes: titleOne.bytes, sha256: titleOne.sha256}, maxRequests: 100, maxObjectBytes: 25 * 1024 * 1024, maxTotalBytes: 500 * 1024 * 1024, delayMs: 1000, timeoutMs: 45000, requests};
await fs.mkdir(outputDir, {recursive: false});
const planPath = path.join(outputDir, 'capture-plan.json');
const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
await fs.writeFile(planPath, planBytes, {flag: 'wx'});
const preflight = {createdAt: new Date().toISOString(), outputDir, planPath, planSha256: sha256(planBytes), requests: requests.length, uniqueUrls: new Set(requests.map(row => row.url)).size, exactSourceInventorySha256: plan.sourceInventorySha256, titleOneRetained: plan.existingTitle1Pdf, caps: {maxRequests: plan.maxRequests, maxObjectBytes: plan.maxObjectBytes, maxTotalBytes: plan.maxTotalBytes, delayMs: plan.delayMs, timeoutMs: plan.timeoutMs}, excludedTitle25: 'Unresolved archive-row collision with Title 26; no Title 25 PDF link inferred.', title26ExactPageReceiptSha256: sha256(title26Bytes)};
await fs.writeFile(path.join(outputDir, 'preflight.json'), JSON.stringify(preflight, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({planPath, planSha256: preflight.planSha256, requests: preflight.requests, uniqueUrls: preflight.uniqueUrls, outputDir}));
