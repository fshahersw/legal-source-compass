import test from 'node:test';
import assert from 'node:assert/strict';
import { expandChapterRange, parseChapterHtml, parseTitleChapterListHtml, parseTitleRows } from './or-parse.mjs';

test('parses real body headings only, retains separate same-citation versions and raw byte spans', () => {
  const html = `<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body>
<p>Chapter 12 \u0097 Limitations of Actions</p>
<p>12.010 TOC heading, not a bold body heading</p>
<p><b>12.010 First published text.</b> First version of the section.</p>
<p>New sections were added to this chapter in the 2026 regular session.</p>
<p><b>12.010 Second operative version.</b> A separate source block using the same citation.</p>
<p><b>12.020 Next section.</b> Next section text.</p>
</body></html>`;
  const bytes = Buffer.from(html, 'latin1');
  const parsed = parseChapterHtml(bytes, '12');
  assert.equal(parsed.encoding, 'windows-1252');
  assert.deepEqual(parsed.sections.map((section) => section.citation), ['ORS 12.010', 'ORS 12.010', 'ORS 12.020']);
  assert.equal(parsed.sections[0].chapterTitle, 'Limitations of Actions');
  assert.match(parsed.sections[0].text, /New sections were added/);
  assert.match(parsed.sections[1].text, /Second operative version/);
  for (const section of parsed.sections) {
    const source = bytes.subarray(section.sourceSpan.byteStart, section.sourceSpan.byteEnd).toString('latin1');
    assert.match(source, /<b>12\.0/);
  }
  assert.equal(bytes.subarray(parsed.sections[1].sourceSpan.byteStart, parsed.sections[1].sourceSpan.byteEnd).toString('latin1').startsWith('<p><b>12.010 Second'), true);
});

test('maps wrapped official title rows and alphabetic chapter boundaries', () => {
  const source = `TABLE OF TITLES
Volume 1
Title 1 Courts of Record; Court Officers; Juries – Chs. 1-10
 2 Procedure in Civil Proceedings – Chs. 12-25
Volume 7
Title 26A Economic Development – Chs. 284-285C
 27 Public Borrowing – Chs. 286A-289
Volume 20
General Index A-L`;
  const rows = parseTitleRows(source);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].titleNumber, '2');
  assert.equal(rows[2].volume, 7);
  const chapters = ['284', '285', '285A', '285B', '285C', '286', '286A', '287', '288', '289'];
  assert.deepEqual(expandChapterRange('284', '285C', chapters), ['284', '285', '285A', '285B', '285C']);
  assert.deepEqual(expandChapterRange('286A', '289', chapters), ['286A', '287', '288', '289']);
});

test('uses the publisher chapter TOC as the actual chapter enumeration, including internal suffixes', () => {
  const html = `<meta charset="windows-1252">
<p>TITLE 16</p><p>CRIMES AND PUNISHMENTS</p>
<p>Chapter 161. General Provisions</p><p>162. Offenses Against the State</p>
<p>163. Offenses Against Persons</p><p>163A. Sex Offender Reporting</p>
<p>164. Offenses Against Property</p><p>____________________</p>
<p>Chapter 161 — General Provisions</p><p>161.005 Short title</p>`;
  const parsed = parseTitleChapterListHtml(Buffer.from(html, 'latin1'));
  assert.equal(parsed.titleNumber, '16');
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.chapter), ['161', '162', '163', '163A', '164']);
  assert.equal(parsed.chapters.some((chapter) => chapter.chapter === '161.005'), false);
});

test('rejects missing or unsupported source charset rather than silently decoding', () => {
  assert.throws(() => parseChapterHtml(Buffer.from('<p><b>12.010 Title</b></p>'), '12'), /charset/);
  assert.throws(() => parseChapterHtml(Buffer.from('<meta charset="x-unknown"><p/>'), '12'), /charset/);
});
