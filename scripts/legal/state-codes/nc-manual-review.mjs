#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { classifyNoSectionSource, parseChapter } from './nc-parser-core.mjs';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/nc');
const inventory = JSON.parse(await fs.readFile(path.join(base, 'inventory.json'), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function verifySection(chapterId, sectionId) {
  const source = inventory.chapters.find(row => row.chapterId === chapterId);
  if (!source) throw new Error(`Chapter ${chapterId} missing from source inventory`);
  const rawBytes = await fs.readFile(path.join(root, source.rawPath));
  if (sha256(rawBytes) !== source.sha256 || rawBytes.length !== source.bytes) throw new Error(`Raw integrity mismatch for Chapter ${chapterId}`);
  const raw = rawBytes.toString('utf8');
  const parsed = parseChapter(source, raw, source.sha256);
  const row = parsed.sections.find(item => item.sectionId === sectionId);
  if (!row) throw new Error(`Section ${sectionId} missing from parsed Chapter ${chapterId}`);
  const laterHeadings = parsed.sections.filter(item => item.source.htmlCharacterOffset > row.source.htmlCharacterOffset);
  const next = laterHeadings[0] || null;
  const spanEnd = next?.source.htmlCharacterOffset ?? raw.length;
  const span = raw.slice(row.source.htmlCharacterOffset, spanEnd);
  const spanPlainText = parsed.sourceParagraphs
    .filter(item => item.sourceOffset >= row.source.htmlCharacterOffset && item.sourceOffset < spanEnd)
    .map(item => item.text);
  const sourceHeading = parsed.sourceParagraphs.find(item => item.sourceOffset === row.source.htmlCharacterOffset);
  if (!sourceHeading) throw new Error(`Source heading paragraph missing for § ${sectionId}`);
  const expectedParagraphs = [sourceHeading.text, ...row.bodyText.split('\n').filter(Boolean)];
  const parsedTextMatchesSourceSpan = JSON.stringify(spanPlainText) === JSON.stringify(expectedParagraphs);
  if (!parsedTextMatchesSourceSpan) throw new Error(`Extracted paragraphs for § ${sectionId} do not match its source span`);
  return {
    chapterId,
    sectionId,
    citation: row.citation,
    sourceUrl: source.sourceUrl,
    rawPath: source.rawPath,
    rawBytes: source.bytes,
    rawSha256: source.sha256,
    parsedPath: `private/audit-2026-10-05/full-state-codes/nc/parsed/v7/chapters/chapter-${chapterId}.jsonl`,
    sectionOccurrence: row.occurrenceWithinCitation,
    heading: row.heading,
    headingContainsEffectiveVersionQualifier: row.sourceVersionQualifier,
    sourceStartCharacterOffset: row.source.htmlCharacterOffset,
    sourceStartByteOffset: Buffer.byteLength(raw.slice(0, row.source.htmlCharacterOffset), 'utf8'),
    sourceEndCharacterOffset: spanEnd,
    sourceSpanSha256: sha256(Buffer.from(span, 'utf8')),
    sourceSpanBytes: Buffer.byteLength(span, 'utf8'),
    extractedBodyCharacters: row.bodyText.length,
    bodyPreview: row.bodyText.slice(0, 180),
    parsedTextMatchesSourceSpan,
    sourceParagraphs: spanPlainText,
    rawHtmlOpeningExcerpt: span.slice(0, 320),
  };
}

const samples = [];
for (const [chapterId, sectionId] of [
  ['1', '1-15'], ['1', '1-52'], ['105', '105-164.13'],
  ['20', '20-123.2'], ['105', '105-130.1'], ['163', '163-278.2'],
]) {
  samples.push(await verifySection(chapterId, sectionId));
}

const stubSource = inventory.chapters.find(row => row.chapterId === '2');
const stubBytes = await fs.readFile(path.join(root, stubSource.rawPath));
if (sha256(stubBytes) !== stubSource.sha256 || stubBytes.length !== stubSource.bytes) throw new Error('Raw integrity mismatch for Chapter 2 repeal stub');
const stubParsed = parseChapter(stubSource, stubBytes.toString('utf8'), stubSource.sha256);
const stubStatus = classifyNoSectionSource(stubParsed);
if (stubParsed.sections.length || stubStatus.parseStatus !== 'source_explicit_status_stub') throw new Error('Chapter 2 no longer classifies as an explicit source stub');

const report = {
  schemaVersion: 'nc-manual-source-review/5',
  reviewedAt: new Date().toISOString(),
  sourceInventoryPath: 'private/audit-2026-10-05/full-state-codes/nc/inventory.json',
  sourceInventorySha256: sha256(await fs.readFile(path.join(base, 'inventory.json'))),
  sourceVersionStatementInInventory: inventory.source.publishedVersionStatement,
  manualSectionSamples: samples,
  repealStubSample: {
    chapterId: '2',
    sourceUrl: stubSource.sourceUrl,
    rawPath: stubSource.rawPath,
    rawBytes: stubSource.bytes,
    rawSha256: stubSource.sha256,
    parsedSectionCount: stubParsed.sections.length,
    parseStatus: stubStatus.parseStatus,
    evidence: stubStatus.evidence,
  },
  limitations: 'Manual checks compare parser-extracted source paragraph text with the exact captured chapter HTML span from each section heading through the next section heading. These checks validate extraction and provenance, not the legal currency or official status of the code text.',
};
const out = path.join(base, 'manual-source-review-v5.json');
await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: path.relative(root, out), sampleCount: samples.length, repealStub: report.repealStubSample.parseStatus }, null, 2));
