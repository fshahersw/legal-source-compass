import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const pilotDir = process.argv[2] ?? 'private/audit-2026-10-05/full-state-codes/wa/capture-pilot-20261005';
const outputPath = process.argv[3] ?? 'private/audit-2026-10-05/full-state-codes/wa/archive-title-links.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const htmlText = (value) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();

const receipt = JSON.parse(await fs.readFile(`${pilotDir}/receipt.json`, 'utf8'));
const capture = receipt.results.find(x => x.id === 'archive-2026-page');
if (!capture || capture.outcome !== 'captured') throw new Error('Archive page has no successful raw capture receipt.');
const body = await fs.readFile(capture.rawPath);
if (body.length !== capture.bytes || sha256(body) !== capture.sha256) throw new Error('Archive raw body does not match its capture receipt.');
const html = body.toString('utf8');
const rows = [];
for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const rowHtml = rowMatch[1];
  const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
  const anchor = rowHtml.match(/<a\b[^>]*href="([^"]+)"[^>]*>\s*Title\s*([^<]+)<\/a>/i);
  if (!anchor) continue;
  const titleLabel = htmlText(anchor[2]);
  const href = anchor[1].replace(/&amp;/g, '&');
  const decodedPath = decodeURIComponent(new URL(href).pathname);
  const pathTitleId = decodedPath.match(/RCW\s+([0-9]+[A-Z]?)\s+TITLE\.htm$/i)?.[1]?.toUpperCase() ?? null;
  rows.push({titleLabel, caption: cells[1] ? htmlText(cells[1]) : '', href, pathTitleId, identityCheck: pathTitleId === titleLabel.toUpperCase() ? 'path-title-matches-row-label' : pathTitleId ? 'path-title-disagrees-with-row-label' : 'path-title-id-not-parsed', rowOrdinal: rows.length + 1});
}
if (!rows.length) throw new Error('No official archive title rows found in captured raw HTML.');
const hrefGroups = new Map();
for (const row of rows) { const group = hrefGroups.get(row.href) ?? []; group.push(row.titleLabel); hrefGroups.set(row.href, group); }
const duplicates = [...hrefGroups].filter(([, labels]) => labels.length > 1).map(([href, titleLabels]) => ({href, titleLabels}));
const result = {
  schemaVersion: 1,
  source: {url: capture.finalUrl, rawPath: capture.rawPath, bytes: capture.bytes, sha256: capture.sha256, retrievedAt: capture.completedAt, receiptPath: `${pilotDir}/receipt.json`},
  scope: 'Only title-row links observed in the official 2026 RCW archive page raw HTML. This is not a chapter or section inventory.',
  titleRows: rows,
  counts: {titleRows: rows.length, distinctExactPageHrefs: hrefGroups.size, duplicateHrefGroups: duplicates.length, identityMismatchRows: rows.filter(x => x.identityCheck === 'path-title-disagrees-with-row-label').length},
  duplicateHrefGroups: duplicates,
  coverageLimit: 'A title row is not proof the linked content matches its label. Verify target page native title identity before assigning coverage.'
};
await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({outputPath, ...result.counts, rawPageSha256: capture.sha256, outputSha256: sha256(await fs.readFile(outputPath))}));
