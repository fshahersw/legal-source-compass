import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTitlePage } from './wa-title-page-parser.mjs';

test('extracts exact title/chapter/PDF hrefs from native title table and excludes note cross-links', () => {
  const html = `<!doctype html><html><body>
    <b>Title 28A RCW</b><b>COMMON SCHOOL PROVISIONS</b>
    <div>PDF of <a href='http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/pdf/RCW%20%2028A%20%20TITLE/RCW%20%2028A%20%20%20COMBINEDTITLE.pdf'>Complete Title</a></div>
    <table><tr><td><b>Chapters</b></td></tr>
      <tr><td><a href='http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/RCW%20%2028A%20.%2005%20%20CHAPTER.htm'>28A.05</a></td><td>Common school provisions.</td></tr>
      <tr><td><a href='http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/RCW%20%2028A%20.%20230%20%20CHAPTER.htm'>28A.230</a></td><td>Basic education.</td></tr>
    </table>
    <div>NOTES: <a href='http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/RCW%20%2074%20.%2013%20%20CHAPTER.htm'>74.13</a></div>
  </body></html>`;
  const result = parseTitlePage(html);
  assert.equal(result.nativeTitleId, '28A');
  assert.deepEqual(result.chapters.map(x => [x.chapterId, x.description, x.hrefChapterId]), [
    ['28A.05', 'Common school provisions.', '28A.05'],
    ['28A.230', 'Basic education.', '28A.230'],
  ]);
  assert.equal(result.titlePdfLinks.length, 1);
  assert.equal(result.titlePdfLinks[0].hrefTitleId, '28A');
  assert.equal(result.chapterIdentityMismatches.length, 0);
  assert.equal(result.titlePdfIdentityMismatches.length, 0);
});

test('exposes title and chapter path identity mismatches instead of correcting them', () => {
  const html = `<html><body><b>Title 25 RCW</b><table><tr><td><b>Chapters</b></td></tr>
    <tr><td><a href='http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/RCW%20%2026%20.%2004%20%20CHAPTER.htm'>25.04</a></td><td>Unverified row.</td></tr>
  </table><a href='http://lawfilesext.leg.wa.gov/law/RCWArchive/2026/pdf/RCW%20%2026%20%20TITLE/RCW%20%2026%20%20%20COMBINEDTITLE.pdf'>Complete Title</a></body></html>`;
  const result = parseTitlePage(html);
  assert.equal(result.nativeTitleId, '25');
  assert.equal(result.chapters[0].identityCheck, 'text-or-path-mismatch');
  assert.equal(result.titlePdfLinks[0].hrefTitleId, '26');
  assert.equal(result.titlePdfIdentityMismatches.length, 1);
});

test('fails closed when native heading or chapter table is missing', () => {
  assert.throws(() => parseTitlePage('<html><body>Chapters</body></html>'), /Native Title N RCW heading/);
  assert.throws(() => parseTitlePage('<html><body><b>Title 1 RCW</b></body></html>'), /Native Chapters table heading/);
});
