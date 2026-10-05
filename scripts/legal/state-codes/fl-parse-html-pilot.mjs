#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  decodeUtf8Strict, textContent, extractClassText, parseSectionOccurrences,
  extractChapterSectionIndex, occurrenceMismatches, chapterPairState,
} from './fl-html-parse-core.mjs';

const args = process.argv.slice(2);
const root = process.cwd();
const pilotDir = path.resolve(args.find(x => x.startsWith('--pilot-dir='))?.slice('--pilot-dir='.length) || '');
const outArg = args.find(x => x.startsWith('--output='));
if (!pilotDir || !outArg) throw new Error('Provide --pilot-dir=<frozen raw capture> and --output=<new report path>.');
const outPath = path.resolve(outArg.slice('--output='.length));
try { await fs.access(outPath); throw new Error(`Refusing to overwrite immutable parse output: ${outPath}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const manifestBytes = await fs.readFile(path.join(pilotDir, 'pilot-manifest.json'));
const manifest = JSON.parse(decodeUtf8Strict(manifestBytes));
const inventoryPath = path.resolve(root, manifest.inventoryPath || '');
if (!manifest.inventoryPath || !manifest.inventorySha256) throw new Error('Pilot manifest lacks its source inventory path/hash.');
const inventoryBytes = await fs.readFile(inventoryPath);
const inventorySha = crypto.createHash('sha256').update(inventoryBytes).digest('hex');
if (inventorySha !== manifest.inventorySha256) throw new Error('Pilot source inventory hash does not match its frozen manifest.');
const inventory = JSON.parse(decodeUtf8Strict(inventoryBytes));
const edition = inventory.publisherEditionLabel ?? inventory.editionLabelObserved;
if (edition !== 'The 2026 Florida Statutes') throw new Error(`Unexpected source edition label in verified inventory: ${edition ?? 'not recorded'}`);
const normalized = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const hasEdition = html => normalized(textContent(html)).includes(edition);
const titleRomanFromHtml = html => {
  const text = textContent(html);
  const match = text.match(/\bTitle\s+([IVXLCDM]+)\b/i);
  return match?.[1]?.toUpperCase() ?? null;
};
const receiptFor = async relativePath => JSON.parse(decodeUtf8Strict(await fs.readFile(path.join(pilotDir, relativePath))));
const rawFor = relativePath => relativePath.replace(/^receipts\//, 'raw/').replace(/\.json$/i, '.html');
const integrity = (raw, receipt, requestedUrl) => {
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const failures = [];
  if (sha !== receipt.sha256) failures.push('raw_receipt_sha256_mismatch');
  if (raw.length !== receipt.bytes) failures.push('raw_receipt_byte_count_mismatch');
  if (receipt.httpStatus !== 200 || receipt.outcome !== 'captured') failures.push('source_response_not_http_200_captured');
  if (receipt.requestedUrl !== requestedUrl) failures.push('requested_url_mismatch');
  return { sha, failures };
};

const parsedChapters = [];
for (const row of manifest.chapters ?? []) {
  if (row.status !== 'captured') {
    parsedChapters.push({ chapter: row.chapter, titleRoman: row.titleRoman ?? null, status: 'not_captured', sections: [], identityOccurrenceMismatches: [] });
    continue;
  }
  const idxReceipt = await receiptFor(row.contentsIndexReceiptPath);
  const bodyReceipt = await receiptFor(row.fullChapterReceiptPath);
  const idxRaw = await fs.readFile(path.join(pilotDir, rawFor(row.contentsIndexReceiptPath)));
  const bodyRaw = await fs.readFile(path.join(pilotDir, rawFor(row.fullChapterReceiptPath)));
  const idxIntegrity = integrity(idxRaw, idxReceipt, row.contentsIndexUrl);
  const bodyIntegrity = integrity(bodyRaw, bodyReceipt, row.fullChapterUrl);
  let idxHtml, bodyHtml;
  try {
    idxHtml = decodeUtf8Strict(idxRaw);
    bodyHtml = decodeUtf8Strict(bodyRaw);
  } catch (error) {
    parsedChapters.push({ chapter: row.chapter, titleRoman: row.titleRoman, status: 'invalid_utf8', error: String(error?.message || error), receipts: { contentsIndex: idxIntegrity, fullText: bodyIntegrity }, sections: [], identityOccurrenceMismatches: [] });
    continue;
  }
  if (idxHtml.includes('\uFFFD') || bodyHtml.includes('\uFFFD')) {
    parsedChapters.push({ chapter: row.chapter, titleRoman: row.titleRoman, status: 'replacement_character_present', receipts: { contentsIndex: idxIntegrity, fullText: bodyIntegrity }, sections: [], identityOccurrenceMismatches: [] });
    continue;
  }

  const parsed = parseSectionOccurrences(bodyHtml, bodyIntegrity.sha);
  for (const section of parsed.sections) section.chapterNativeId = row.chapter;
  const chapterIndex = extractChapterSectionIndex(bodyHtml);
  const identityMismatches = occurrenceMismatches(chapterIndex, parsed.sections);
  const repeatedMap = new Map();
  for (const section of parsed.sections) {
    if (section.normalizedCitationForJoin) repeatedMap.set(section.normalizedCitationForJoin, (repeatedMap.get(section.normalizedCitationForJoin) || 0) + 1);
  }
  const repeated = [...repeatedMap].filter(([, count]) => count > 1).map(([citation, count]) => ({ citation, occurrences: count }));
  const chapterName = extractClassText(bodyHtml, 'ChapterName');
  const chapterNumber = extractClassText(bodyHtml, 'ChapterNumber');
  const printedTitle = titleRomanFromHtml(bodyHtml);
  const pairState = chapterPairState({
    nativeChapterId: row.chapter, printedChapterNumber: chapterNumber,
    expectedTitleRoman: row.titleRoman, printedTitleNumber: `TITLE ${printedTitle ?? ''}`,
    expectedEdition: edition, indexHasEdition: hasEdition(idxHtml), bodyHasEdition: hasEdition(bodyHtml),
    sectionIndexCount: chapterIndex.length, sectionOccurrences: parsed.sections.length,
  });
  const warnings = {
    rawReceiptIntegrityFailures: [...idxIntegrity.failures.map(x => `contents_index:${x}`), ...bodyIntegrity.failures.map(x => `full_text:${x}`)],
    sectionBlocksWithoutValidNativeCitation: parsed.missingNativeCitationCount,
    unmatchedSectionBlockStarts: parsed.unmatchedSectionBlockStarts,
    nestedSectionBlockStarts: parsed.nestedSectionBlockStarts,
    unbalancedHistoryElements: parsed.sections.filter(section => !section.historyElementBalanced).map(section => section.nativeCitationAsPrinted),
    zeroSectionStructureIsUnresolved: pairState.status === 'unresolved_empty_chapter',
    chapterIndexOccurrenceMismatches: identityMismatches,
  };
  const integrityWarning = warnings.rawReceiptIntegrityFailures.length > 0 || parsed.missingNativeCitationCount > 0 ||
    parsed.unmatchedSectionBlockStarts.length > 0 || parsed.nestedSectionBlockStarts.length > 0 ||
    warnings.unbalancedHistoryElements.length > 0 || identityMismatches.length > 0;
  const status = pairState.status === 'unresolved_empty_chapter' ? 'unresolved_empty_chapter'
    : pairState.status !== 'validated_structure' ? pairState.status
      : integrityWarning ? 'parse_integrity_warning' : 'parsed';
  parsedChapters.push({
    chapter: row.chapter, titleRoman: row.titleRoman,
    chapterNameAsPrinted: chapterName, printedChapterNumber: chapterNumber, printedTitleNumber: printedTitle,
    status, pairState,
    source: {
      contentsIndexUrl: row.contentsIndexUrl, fullChapterUrl: row.fullChapterUrl,
      contentsIndex: { bytes: idxRaw.length, sha256: idxIntegrity.sha, receiptPath: row.contentsIndexReceiptPath, httpStatus: idxReceipt.httpStatus },
      fullText: { bytes: bodyRaw.length, sha256: bodyIntegrity.sha, receiptPath: row.fullChapterReceiptPath, httpStatus: bodyReceipt.httpStatus, sourceEncoding: 'UTF-8 strict' },
    },
    publisherSectionIndex: { entryCount: chapterIndex.length, source: 'Publisher CatchlineIndex/IndexItem records embedded in exact linked full chapter HTML', entries: chapterIndex },
    repeatedCitationOccurrences: repeated, identityOccurrenceMismatches: identityMismatches,
    parseWarnings: warnings, sections: parsed.sections,
  });
}

const captured = parsedChapters.filter(chapter => chapter.status !== 'not_captured');
const report = {
  schemaVersion: 'florida-html-pilot-parse-report/3', parserRevision: 3, parsedAt: new Date().toISOString(),
  parser: 'Strict UTF-8; balanced nested div.Section spans with exact source offsets; full nested HistoryText extraction; native chapter/title/edition identity checks; occurrence-multiplicity reconciliation against publisher CatchlineIndex/IndexItem rows embedded in the same full chapter body. ContentsIndex remains navigation evidence, not a presumed section list. No citation guessing or effective-date interpretation.',
  sourcePilotManifestPath: path.relative(root, path.join(pilotDir, 'pilot-manifest.json')).replaceAll('\\', '/'),
  sourcePilotManifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
  sourceInventoryPath: manifest.inventoryPath, sourceInventorySha256: inventorySha,
  editionContext: { publisherEditionLabel: edition ?? null, note: 'A 2026 edition label is checked in both captured index and chapter body. Future-effective or repealed provisions remain source text and are not classified as current law.' },
  totals: {
    chaptersRequested: manifest.chaptersRequested ?? (manifest.chapters?.length ?? 0),
    chaptersCaptured: captured.length,
    chaptersParsed: parsedChapters.filter(chapter => chapter.status === 'parsed').length,
    chaptersWithWarnings: parsedChapters.filter(chapter => chapter.status === 'parse_integrity_warning').length,
    chaptersUnresolvedEmpty: parsedChapters.filter(chapter => chapter.status === 'unresolved_empty_chapter').length,
    chaptersNotCaptured: parsedChapters.filter(chapter => chapter.status === 'not_captured').length,
    publisherSectionIndexRows: parsedChapters.reduce((n, chapter) => n + (chapter.publisherSectionIndex?.entryCount ?? 0), 0),
    sectionOccurrences: parsedChapters.reduce((n, chapter) => n + (chapter.sections?.length ?? 0), 0),
    chapterTextIdentityMismatches: parsedChapters.reduce((n, chapter) => n + (chapter.identityOccurrenceMismatches?.length ?? 0), 0),
    sourceByteCount: captured.reduce((n, chapter) => n + (chapter.source?.contentsIndex.bytes ?? 0) + (chapter.source?.fullText.bytes ?? 0), 0),
  },
  parsedChapters,
};
await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(report.totals, null, 2));
