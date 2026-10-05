import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const wa = process.argv[2] ?? 'private/audit-2026-10-05/full-state-codes/wa';
const runDir = process.argv[3] ?? path.join(wa, 'complete-title-pdfs-20261005');
const extractionDir = process.argv[4] ?? path.join(runDir, 'text-v4-pypdf');
const outPath = process.argv[5] ?? path.join(runDir, 'capture-extraction-audit-v3.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const planPath = path.join(wa, 'complete-title-pdfs-plan-v2-20261005', 'capture-plan.json');
const receiptPath = path.join(runDir, 'capture-v2', 'receipt.json');
const inventoryPath = path.join(wa, 'title-pages-1650', 'native-title-chapter-link-inventory-with-title26-followup.json');
const manifestPath = path.join(extractionDir, 'extraction-manifest.json');
const [planBytes, receiptBytes, inventoryBytes, manifestBytes] = await Promise.all([planPath, receiptPath, inventoryPath, manifestPath].map(file => fs.readFile(file)));
const plan = JSON.parse(planBytes);
const receipt = JSON.parse(receiptBytes);
const inventory = JSON.parse(inventoryBytes);
const extraction = JSON.parse(manifestBytes);
if (receipt.planSha256 !== sha256(planBytes) || receipt.requestedCount !== 99 || receipt.storedBodies !== 47 || !receipt.stopped || receipt.stopReason !== 'transport-error' || receipt.unattempted.length !== 51) throw new Error('Capture receipt no longer matches the observed bounded stop state.');
if (extraction.captureReceiptSha256 !== sha256(receiptBytes) || extraction.results.length !== 48) throw new Error('Extraction manifest does not pin all 48 retained source PDFs.');
const outcomes = new Map(receipt.results.map(row => [row.id, row]));
const plannedIds = new Set(plan.requests.map(row => row.id));
const plannedById = new Map(plan.requests.map(row => [row.id, row]));
const title1ReceiptBytes = await fs.readFile(path.join(wa, 'capture-pilot-20261005', 'receipt.json'));
const title1Receipt = JSON.parse(title1ReceiptBytes);
if (extraction.retainedTitle1ReceiptSha256 !== sha256(title1ReceiptBytes)) throw new Error('Extraction does not pin the retained Title 1 receipt.');
const title1 = title1Receipt.results.find(row => row.id === 'title-1-complete-pdf');
if (!title1 || title1.outcome !== 'captured') throw new Error('Previously captured Title 1 PDF is absent.');
const textByTitle = new Map();
const extractionRows = [];
let verifiedRawBytes = 0;
for (const row of extraction.results) {
  const source = row.titleId === '1' ? title1 : outcomes.get(row.id);
  if (!source || source.outcome !== 'captured' || row.rawSha256 !== source.sha256 || row.rawBytes !== source.bytes) throw new Error(`Extraction/raw source mismatch for ${row.id}.`);
  if (row.id !== `complete-title-${row.titleId}` || row.sourceUrl !== source.url || textByTitle.has(row.titleId)) throw new Error(`Duplicate or inconsistent title identity: ${row.id}.`);
  if (row.titleId !== '1' && (plannedById.get(row.id)?.url !== source.url || plannedById.get(row.id)?.titleId !== row.titleId)) throw new Error(`Source is not the exact planned title URL: ${row.id}.`);
  const raw = await fs.readFile(source.rawPath);
  if (raw.length !== source.bytes || sha256(raw) !== source.sha256) throw new Error(`Raw PDF SHA/length mismatch: ${row.id}.`);
  const textBytes = await fs.readFile(row.textPath);
  if (textBytes.length !== row.textBytes || sha256(textBytes) !== row.textSha256) throw new Error(`Text derivative SHA/length mismatch: ${row.id}.`);
  if (row.extractedPages !== row.pdfPages || row.pageMetrics.length !== row.pdfPages || row.pageMetrics.some((page, index) => page.page !== index + 1)) throw new Error(`Page-number/order proof failed for ${row.id}.`);
  const lowTextPages = row.pageMetrics.filter(page => page.chars > 0 && page.chars < 30).length;
  if (lowTextPages !== row.lowTextPagesUnder30Chars || row.pageMetrics.filter(page => !page.hasText).length !== row.emptyPages) throw new Error(`Page metrics do not reconcile: ${row.id}.`);
  textByTitle.set(row.titleId, textBytes.toString('utf8'));
  verifiedRawBytes += raw.length;
  extractionRows.push({id: row.id, titleId: row.titleId, rawBytes: raw.length, rawSha256: sha256(raw), textBytes: textBytes.length, textSha256: sha256(textBytes), pages: row.pdfPages, zeroTextPages: row.emptyPages, lowTextPages, replacementChars: row.replacementChars, controlChars: row.controlChars});
}
if (textByTitle.size !== 48 || verifiedRawBytes !== extraction.totals.rawBytes) throw new Error('Whole-file count/byte reconciliation failed.');
const timeout = receipt.results.find(row => row.outcome === 'transport-error');
if (!timeout || timeout.id !== 'complete-title-43' || timeout.status !== 200 || timeout.contentLengthHeader !== '24668777' || !/timeout/i.test(timeout.error)) throw new Error('Expected preserved Title 43 response-timeout record is missing.');
const missedIds = [...plannedIds].filter(id => !outcomes.has(id));
const attemptedFailureIds = receipt.results.filter(row => row.outcome !== 'captured').map(row => row.id);
if (missedIds.length !== 51 || attemptedFailureIds.length !== 1 || !plannedIds.has(timeout.id)) throw new Error('Requested/captured/failed/unattempted totals do not reconcile.');

const headingResults = [];
const capturedTitleIds = new Set(textByTitle.keys());
for (const titleId of capturedTitleIds) {
  const text = textByTitle.get(titleId);
  const chapters = inventory.chapterLinks.filter(row => row.nativeTitleId === titleId);
  for (const chapter of chapters) {
    const escaped = chapter.chapterId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\bChapter\\s+${escaped}\\s+RCW\\b`, 'i');
    if (!pattern.test(text)) headingResults.push({titleId, chapterId: chapter.chapterId, chapterTitle: chapter.description, htmlHref: chapter.href});
  }
}
const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  scope: 'Read-only capture and text-derivative verification for the 2026 WA archive Complete Title PDFs; no publication/current-law claim.',
  sources: {planPath, planSha256: sha256(planBytes), receiptPath, receiptSha256: sha256(receiptBytes), inventoryPath, inventorySha256: sha256(inventoryBytes), extractionManifestPath: manifestPath, extractionManifestSha256: sha256(manifestBytes)},
  acquisition: {requestedNewExactLinks: plan.requests.length, capturedNewPdfs: receipt.storedBodies, failedAttempt: {id: timeout.id, status: timeout.status, error: timeout.error, announcedContentLengthBytes: Number(timeout.contentLengthHeader), storedPartialBodyBytes: 0, sha256: null}, unattemptedNewPdfs: receipt.unattempted.length, remainingNewPdfs: missedIds.length + 1, remainingTitleIds: [...new Set([...missedIds.map(id => id.slice('complete-title-'.length)), timeout.id.slice('complete-title-'.length)])], retainedPriorTitle1: {rawBytes: title1.bytes, rawSha256: title1.sha256}, exactTitle25Status: 'unresolved-publisher-collision-not-covered'},
  verification: {verifiedPdfBodies: extractionRows.length, verifiedRawBytes: verifiedRawBytes, verifiedExtractedFiles: extractionRows.length, allRawAndTextHashesMatch: true, allPdfPagesParsedInExplicitAscendingPageOrder: true, extractionErrors: 0, emptyTextPages: extraction.totals.emptyPages, lowTextPages: extraction.totals.lowTextPages, replacementCharacters: extraction.totals.replacementChars, controlCharacters: extraction.totals.controlChars, extractedCharacters: extraction.totals.textChars, apparentRcwCitationOccurrences: extraction.totals.apparentRcwCitationOccurrences},
  chapterHeadingCheck: {method: 'Each exact chapter citation observed in its verified native title page was searched as the heading form `Chapter <chapterId> RCW` in the corresponding Complete Title PDF derivative. This is a structural check, not section-completeness proof.', capturedTitles: capturedTitleIds.size, expectedChapterLinks: extractionRows.reduce((n, row) => n + inventory.chapterLinks.filter(link => link.nativeTitleId === row.titleId).length, 0), missingHeadingCount: headingResults.length, missingHeadings: headingResults},
  perPdf: extractionRows
};
await fs.writeFile(outPath, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({outPath, outputSha256: sha256(await fs.readFile(outPath)), acquisition: result.acquisition, verification: result.verification, chapterHeadingCheck: {...result.chapterHeadingCheck, missingHeadings: undefined}}));
