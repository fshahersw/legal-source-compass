#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractParagraphs, plainTextOf } from './nc-parser-core.mjs';

const root = process.cwd();
const base = path.join(root, 'private/audit-2026-10-05/full-state-codes/nc');
const inventory = JSON.parse(await fs.readFile(path.join(base, 'inventory.json'), 'utf8'));
const parse = JSON.parse(await fs.readFile(path.join(base, 'parse-report-v15.json'), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rows = [];
const nonParagraphText = [];
const divsWithoutParagraphText = [];
let paragraphHeadingOpenTags = 0;
let nonemptyDivCount = 0;
let divCount = 0;
let sourceMarkupBytes = 0;

for (const source of inventory.chapters) {
  const rawBytes = await fs.readFile(path.join(root, source.rawPath));
  if (rawBytes.length !== source.bytes || sha256(rawBytes) !== source.sha256) throw new Error(`Chapter ${source.chapterId} raw capture failed hash/byte check`);
  const html = rawBytes.toString('utf8');
  sourceMarkupBytes += rawBytes.length;
  const tags = [...html.matchAll(/<(?:p|h[1-6])\b/gi)];
  paragraphHeadingOpenTags += tags.length;
  const extracted = extractParagraphs(html);
  rows.push({ chapterId: source.chapterId, openedParagraphHeadingTags: tags.length, extractedNonemptyParagraphRows: extracted.length });

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] || '';
  const outsideParagraphs = body
    .replace(/<(p|h[1-6])\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const residualText = plainTextOf(outsideParagraphs).replace(/\u00a0/g, ' ').trim();
  if (residualText) nonParagraphText.push({ chapterId: source.chapterId, text: residualText.slice(0, 250) });

  for (const match of html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div\s*>/gi)) {
    divCount += 1;
    const inner = match[1];
    const innerText = plainTextOf(inner.replace(/<(p|h[1-6])\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')).trim();
    if (!innerText) continue;
    nonemptyDivCount += 1;
    if (innerText.replace(/\u00a0/g, ' ').trim()) {
      divsWithoutParagraphText.push({ chapterId: source.chapterId, sourceOffset: match.index, text: innerText.slice(0, 250) });
    }
  }
}

const report = {
  schemaVersion: 'nc-source-text-completeness-audit/1',
  auditedAt: new Date().toISOString(),
  inventoryPath: 'private/audit-2026-10-05/full-state-codes/nc/inventory.json',
  parserReportPath: 'private/audit-2026-10-05/full-state-codes/nc/parse-report-v15.json',
  chapterCount: rows.length,
  totalVerifiedRawBytes: sourceMarkupBytes,
  paragraphHeadingOpenTags: paragraphHeadingOpenTags,
  nonemptyExtractedParagraphHeadingRows: rows.reduce((sum, row) => sum + row.extractedNonemptyParagraphRows, 0),
  parserDispositionRows: parse.counts.extractedSourceParagraphRows,
  parserUnassignedRows: parse.counts.unassignedSourceParagraphCount,
  paragraphHeadingTagCountsByChapter: rows,
  bodyVisibleTextOutsideParagraphHeadingElements: nonParagraphText,
  divWrapperCount: divCount,
  divWrappersWithDirectTextOutsideParagraphHeadingElements: nonemptyDivCount,
  divDirectTextExamples: divsWithoutParagraphText,
  result: nonParagraphText.length === 0 && divsWithoutParagraphText.length === 0 && parse.counts.unassignedSourceParagraphCount === 0
    ? 'No source body text outside paragraph/heading blocks was found; all extracted paragraph/heading rows received a parser disposition.'
    : 'Review required: source body text or extracted rows remain outside the accounted blocks.',
  caveat: 'This checks markup and parser disposition, not legal completeness beyond the captured publisher pages. Source table content wrapped in paragraph elements is included as paragraph text.',
};
await fs.writeFile(path.join(base, 'text-completeness-audit-v6.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
const md = [
  '# NC captured-source text completeness audit',
  '',
  `${report.chapterCount} raw chapters verified (${report.totalVerifiedRawBytes} bytes). ${report.nonemptyExtractedParagraphHeadingRows} nonempty paragraph/heading rows were extracted and assigned to a parser disposition; ${report.parserUnassignedRows} were unassigned.`,
  `Visible body text outside paragraph/heading elements: ${report.bodyVisibleTextOutsideParagraphHeadingElements.length} chapter-level findings. Direct text in div wrappers outside nested paragraph/heading elements: ${report.divWrappersWithDirectTextOutsideParagraphHeadingElements} findings.`,
  '',
  report.result,
  '',
  report.caveat,
  '',
].join('\n');
await fs.writeFile(path.join(base, 'text-completeness-audit-v6.md'), md, { flag: 'wx' });
console.log(JSON.stringify({ chapters: report.chapterCount, paragraphs: report.nonemptyExtractedParagraphHeadingRows, unassigned: report.parserUnassignedRows, bodyTextOutsideParagraphHeading: report.bodyVisibleTextOutsideParagraphHeadingElements.length, divDirectText: report.divWrappersWithDirectTextOutsideParagraphHeadingElements, result: report.result }, null, 2));
