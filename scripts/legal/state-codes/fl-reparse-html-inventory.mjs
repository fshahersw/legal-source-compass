#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractNativeTitleLinks } from './fl-html-capture-core.mjs';

const args = process.argv.slice(2);
const sourceDir = path.resolve(args.find(x => x.startsWith('--source-dir='))?.slice('--source-dir='.length) || '');
const outputArg = args.find(x => x.startsWith('--output='));
if (!sourceDir || !outputArg) throw new Error('Provide --source-dir=<immutable captured index> and --output=<new derivative JSON path>.');
const outputPath = path.resolve(outputArg.slice('--output='.length));
try { await fs.access(outputPath); throw new Error(`Refusing to overwrite immutable inventory: ${outputPath}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
function unescapeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function text(s) { return unescapeHtml(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const romanFor = n => {
  const vals = [[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  return vals.reduce((out, [value, symbol]) => { while (n >= value) { out += symbol; n -= value; } return out; }, '');
};
async function verifiedRaw(rawRel, receiptRel) {
  const [body, receipt] = await Promise.all([
    fs.readFile(path.join(sourceDir, rawRel)),
    fs.readFile(path.join(sourceDir, receiptRel), 'utf8').then(JSON.parse),
  ]);
  if (receipt.sha256 !== sha(body) || receipt.bytes !== body.length || receipt.outcome !== 'captured' || receipt.httpStatus !== 200) {
    throw new Error(`Source raw/receipt verification failed: ${rawRel}`);
  }
  return { body, receipt };
}
const landing = await verifiedRaw('raw/statutes-landing.html', 'receipts/statutes-landing.json');
const landingHtml = landing.body.toString('utf8');
const edition = landingHtml.match(/The\s+2026\s+Florida\s+Statutes/i)?.[0] || null;
const publisherPageDate = text(landingHtml.match(/<td[^>]*id=["']date["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || '');
const titleRows = extractNativeTitleLinks(landingHtml, landing.receipt.finalUrl).map(row => ({
  roman: row.titleRoman, literalRawHref: row.rawHref, resolvedHref: row.resolvedUrl, displayedRoman: row.displayedRoman,
}));
if (titleRows.length !== 49 || titleRows.some((row, i) => row.roman !== romanFor(i + 1) || row.displayedRoman !== row.roman)) {
  throw new Error(`Landing page title inventory did not validate: ${titleRows.length} rows.`);
}
const titles = [];
for (const row of titleRows) {
  const rawRel = `raw/title-indexes/${row.roman}.html`;
  const receiptRel = `receipts/title-indexes/${row.roman}.json`;
  const captured = await verifiedRaw(rawRel, receiptRel);
  const requestedUrl = captured.receipt.requestedUrl;
  const resolvedRequestTarget = row.resolvedHref.split('#')[0];
  const capturedRequestTarget = new URL(requestedUrl).href.split('#')[0];
  const requestHrefAudit = { literalRawHref: row.literalRawHref, resolvedHref: row.resolvedHref, capturedRequestedUrl: requestedUrl, fragmentOnlyDifference: row.resolvedHref !== requestedUrl && resolvedRequestTarget === capturedRequestTarget, requestTargetMatches: resolvedRequestTarget === capturedRequestTarget };
  if (!requestHrefAudit.requestTargetMatches) throw new Error(`Captured Title ${row.roman} request target does not match the landing page native href.`);
  const html = captured.body.toString('utf8');
  const trRows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const ownTitle = trRows.find(m => new RegExp(`<a[^>]+name=["']Title${row.roman}["']`, 'i').test(m[1]));
  if (!ownTitle) throw new Error(`Title ${row.roman} row absent from its captured native index page.`);
  const titleCells = [...ownTitle[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
  const chapterList = [];
  for (const tr of trRows) {
    const hit = tr[1].match(/<a\b[^>]*href=["']([^"']*App_mode=Display_Statute(?:&amp;|&)[^"']*ContentsIndex\.html[^"']*)["'][^>]*>\s*Chapter\s+(\d+[A-Za-z]?)\s*<\/a>/i);
    if (!hit) continue;
    const chapterToc = tr[1].match(/<td\b[^>]*class=["'][^"']*\bChapterTOC\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    const href = unescapeHtml(hit[1]);
    const hrefUrl = new URL(href, captured.receipt.finalUrl);
    const urlPath = decodeURIComponent(hrefUrl.searchParams.get('URL') || '');
    const expectedChapter = urlPath.match(/(?:^|\/)0*(\d+[A-Za-z]?)\/(?:0*\d+[A-Za-z]?)ContentsIndex\.html$/i)?.[1];
    if (expectedChapter !== hit[2]) throw new Error(`Chapter ID/href mismatch in Title ${row.roman}: ${hit[2]} vs ${expectedChapter}`);
    chapterList.push({ nativeChapterId: hit[2], chapterHeadingAsPrinted: chapterToc ? text(chapterToc[1]) : null, contentsIndexUrl: hrefUrl.href });
  }
  if (chapterList.length === 0) throw new Error(`No chapter links parsed from Title ${row.roman}.`);
  titles.push({
    titleNumber: row.roman, titleHeadingAsPrinted: titleCells[1] || null,
    chapterRangeAsPrinted: titleCells[2] || null,
    titleIndexLiteralHref: row.literalRawHref, titleIndexResolvedHref: row.resolvedHref, titlePageCaptureRequestedUrl: requestedUrl,
    titleIndexRequestHrefAudit: requestHrefAudit, sourceRawPath: rawRel, sourceReceiptPath: receiptRel,
    sourceRawBytes: captured.body.length, sourceRawSha256: sha(captured.body),
    chapterLinkCount: chapterList.length, chapters: chapterList,
  });
}
const flat = titles.flatMap(t => t.chapters.map(ch => ({ titleNumber: t.titleNumber, ...ch })));
const byId = new Map();
for (const row of flat) byId.set(row.nativeChapterId, [...(byId.get(row.nativeChapterId) || []), row]);
const inventory = {
  schemaVersion: 'florida-official-title-chapter-link-inventory/2', builtAt: new Date().toISOString(),
  editionLabelObserved: edition, publisherPageDateObserved: publisherPageDate,
  source: {
    landingUrl: landing.receipt.finalUrl, landingRawPath: 'raw/statutes-landing.html',
    landingReceiptPath: 'receipts/statutes-landing.json', landingBytes: landing.body.length, landingSha256: sha(landing.body),
    derivation: 'Exact raw HTML anchors and table rows from native 2026 Display_Index pages; chapter IDs are preserved from publisher link text and checked against the native URL path.',
  },
  titleCount: titles.length, chapterTitleMembershipCount: flat.length, uniqueChapterCount: byId.size,
  duplicatedChapterIds: [...byId.entries()].filter(([, v]) => v.length > 1).map(([chapterId, memberships]) => ({ chapterId, memberships })),
  titles,
  limits: 'This is an inventory of chapter ContentsIndex links, not full chapter text acquisition. Source page edition selection/date do not establish every provision\'s effective date or certify current law.',
};
await fs.writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
const receiptPath = outputPath.replace(/\.json$/i, '.receipt.json');
await fs.writeFile(receiptPath, `${JSON.stringify({ schemaVersion: 'florida-official-title-chapter-link-inventory-receipt/1', outputPath, outputSha256: sha(Buffer.from(`${JSON.stringify(inventory, null, 2)}\n`)), landingSourceSha256: inventory.source.landingSha256, titlePagesVerified: titles.length, chapterTitleMembershipCount: flat.length, uniqueChapterCount: byId.size, duplicatedChapterIds: inventory.duplicatedChapterIds.map(x => x.chapterId), generatedAt: inventory.builtAt }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ titleCount: titles.length, chapterTitleMembershipCount: flat.length, uniqueChapterCount: byId.size, duplicatedChapterIds: inventory.duplicatedChapterIds, editionLabelObserved: edition, publisherPageDateObserved: publisherPageDate }, null, 2));
