import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNoSectionSource, decodeHtmlEntities, parseChapter } from './nc-parser-core.mjs';

const chapter = { chapterId: '1', sourceUrl: 'https://example.test/chapter-1.html' };

test('retains repeated citation occurrences and effective-version body text', () => {
  const html = [
    '<h1>Chapter 1</h1><p>General Provisions</p>',
    '<p>§ 1-52. (Effective until December 1, 2025) Old text.</p>',
    '<p>Former operative text.</p>',
    '<p>§ 1-52. (Effective December 1, 2025) New text.</p>',
    '<p>Current operative text.</p>',
  ].join('');
  const parsed = parseChapter(chapter, html, 'a'.repeat(64));
  assert.equal(parsed.sections.length, 2);
  assert.deepEqual(parsed.sections.map(row => row.occurrenceWithinCitation), [1, 2]);
  assert.deepEqual(parsed.sections.map(row => row.sourceVersionQualifier), [
    'Effective until December 1, 2025',
    'Effective December 1, 2025',
  ]);
  assert.deepEqual(parsed.sections.map(row => row.bodyText), ['Former operative text.', 'Current operative text.']);
  assert.equal(parsed.sections[0].citationIdentity, parsed.sections[1].citationIdentity);
});

test('parses dotted native section identifiers without truncating them at the decimal point', () => {
  const html = [
    '<p>§ 20-123. Trailers and towed vehicles.</p><p>Base section text.</p>',
    '<p>§ 20-123.2 Speedometer.</p><p>Dotted section text.</p>',
    '<p>§ 20-123.2. Speedometer alternate punctuation.</p><p>Alternate-source text.</p>',
    '<p>§ 105-130.1A Purpose.</p><p>Alphanumeric suffix text.</p>',
    '<p>§ 1-2.3.4. Multiple dotted suffix.</p><p>Multi-part ID text.</p>',
    '<p>§ 1-87.2: Reserved for future codification purposes.</p>',
    '<p>§ 105-446.3:1. Repealed by Session Law.</p>',
    '<p>§ 20-123. Repeated base citation.</p><p>Repeated base text.</p>',
  ].join('');
  const { sections } = parseChapter(chapter, html, '1'.repeat(64));
  assert.deepEqual(sections.map(row => row.sectionId), [
    '20-123', '20-123.2', '20-123.2', '105-130.1A', '1-2.3.4', '1-87.2', '105-446.3:1', '20-123',
  ]);
  assert.deepEqual(sections.filter(row => row.sectionId === '20-123').map(row => row.occurrenceWithinCitation), [1, 2]);
  assert.equal(sections.filter(row => row.sectionId === '20-123.2').length, 2);
  assert.deepEqual(sections.filter(row => row.sectionId === '20-123.2').map(row => row.heading), [
    'Speedometer.', 'Speedometer alternate punctuation.',
  ]);
  const malformedNoBoundary = parseChapter(chapter, '<p>§ 20-123.2Speedometer</p>', '2'.repeat(64));
  assert.equal(malformedNoBoundary.sections.length, 0);
  const malformedIdentifier = parseChapter(chapter, '<p>§ 143.215.74H. Assistance.</p>', '3'.repeat(64));
  assert.equal(malformedIdentifier.sections.length, 0);
  assert.deepEqual(malformedIdentifier.unparsedSingleSectionMarkerRows.map(row => row.text), ['§ 143.215.74H. Assistance.']);
});

test('resolves exact chapter-specific printed identifier exceptions backed by publisher section records', () => {
  const html = [
    '<p>G.S. 78A-13 applies to this transaction.</p>',
    '<p>§ 78A -13. Disclosures required in offer and sale of viaticals.</p>',
    '<p>Disclosures must be provided.</p>',
  ].join('');
  const parsed = parseChapter({ ...chapter, chapterId: '78A' }, html, '7'.repeat(64));
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].sectionId, '78A-13');
  assert.equal(parsed.sections[0].sourceHeadingText, '§ 78A -13. Disclosures required in offer and sale of viaticals.');
  assert.equal(parsed.sections[0].sourceIdentityReconciliation.kind, 'exact-publisher-section-record-confirms-printed-identifier');
  assert.equal(parsed.sections[0].sourceIdentityReconciliation.publisherSectionRecord.htmlSha256, '4f8087c23d1eae915fcce1ee462542f4d715712302ffa65bb4c11456b0bbd245');
  assert.equal(parsed.sections[0].sourceHeadingText, '§ 78A -13. Disclosures required in offer and sale of viaticals.');
  assert.equal(parsed.sections[0].heading, 'Disclosures required in offer and sale of viaticals.');

  const mismatchedChapter = parseChapter({ ...chapter, chapterId: '99' }, html, '9'.repeat(64));
  assert.equal(mismatchedChapter.sections.length, 0);
  assert.equal(mismatchedChapter.unparsedSingleSectionMarkerRows[0].text, '§ 78A -13. Disclosures required in offer and sale of viaticals.');

  const taxRepeal = parseChapter({ ...chapter, chapterId: '105' }, '<p>§ 105 151.11. Repealed by Session Laws 2013-316, s. 1.1(b), effective for taxable years beginning on or after January 1, 2014.</p>', '8'.repeat(64));
  assert.equal(taxRepeal.sections[0].sectionId, '105-151.11');
  assert.equal(taxRepeal.sections[0].sourceHeadingText, '§ 105 151.11. Repealed by Session Laws 2013-316, s. 1.1(b), effective for taxable years beginning on or after January 1, 2014.');
  assert.match(taxRepeal.sections[0].sourceIdentityReconciliation.publisherSectionRecord.indexUrl, /Chapter105$/);

  const assistance = parseChapter({ ...chapter, chapterId: '143' }, '<p>§ 143.215.74H. Assistance.</p><p>Department assistance text.</p>', 'a'.repeat(64));
  assert.equal(assistance.sections[0].sectionId, '143-215.74H');
  assert.equal(assistance.sections[0].bodyText, 'Department assistance text.');
  assert.equal(assistance.sections[0].sourceHeadingText, '§ 143.215.74H. Assistance.');

  const unsupportedSpacing = parseChapter({ ...chapter, chapterId: '78A' }, '<p>§ 78A -14. Different heading.</p>', 'b'.repeat(64));
  assert.equal(unsupportedSpacing.sections.length, 0);
  assert.equal(unsupportedSpacing.unparsedSingleSectionMarkerRows[0].text, '§ 78A -14. Different heading.');

  const distantCrossReference = parseChapter({ ...chapter, chapterId: '78A' }, [
    '<p>G.S. 78A-13 is referenced elsewhere on this page.</p>',
    '<p>§ 78A -13. A title not present in the publisher section record.</p>',
  ].join(''), 'c'.repeat(64));
  assert.equal(distantCrossReference.sections.length, 0);
  assert.equal(distantCrossReference.unparsedSingleSectionMarkerRows[0].text, '§ 78A -13. A title not present in the publisher section record.');
});

test('classifies explicit chapter repeal/transfer language as a source stub', () => {
  const parsed = parseChapter(chapter, '<h1>Chapter 2</h1><p>General Statutes Commission</p><p>§§ 2-1 through 2-60. Repealed and transferred to Chapter 150B.</p>', 'b'.repeat(64));
  assert.equal(parsed.sections.length, 0);
  const status = classifyNoSectionSource(parsed);
  assert.equal(status.parseStatus, 'source_explicit_status_stub');
  assert.ok(status.evidence.some(text => text.includes('Repealed and transferred')));
});

test('keeps range and multi-citation status notices out of section bodies without inventing IDs', () => {
  const html = [
    '<p>§ 58-76-30. Officer liable for negligence in collecting debt.</p><p>When a claim is placed in the hands of any sheriff or coroner for collection, and he does not use due diligence in collecting the same.</p>',
    '<p>§ 58-77-1, 58-77-5. Repealed by Session Laws 1999-132, s. 12.1, effective June 4, 1999.</p>',
    '<p>§ 58-78-1. State Fire and Rescue Commission created; membership.</p><p>(a) There is created the State Fire and Rescue Commission of the Department.</p>',
  ].join('');
  const parsed = parseChapter({ ...chapter, chapterId: '58' }, html, '4'.repeat(64));
  assert.deepEqual(parsed.sections.map(row => [row.sectionId, row.bodyText]), [
    ['58-76-30', 'When a claim is placed in the hands of any sheriff or coroner for collection, and he does not use due diligence in collecting the same.'],
    ['58-78-1', '(a) There is created the State Fire and Rescue Commission of the Department.'],
  ]);
  assert.deepEqual(parsed.sourceNotices.map(row => row.kind), ['multi_citation_source_notice']);
  assert.equal(parsed.sourceNotices[0].text, '§ 58-77-1, 58-77-5. Repealed by Session Laws 1999-132, s. 12.1, effective June 4, 1999.');
  assert.equal(parsed.unparsedSingleSectionMarkerRows.length, 0);
  const range = parseChapter({ ...chapter, chapterId: '1' }, '<p>§§ 1-63 through 1-64. Repealed by Session Laws 1967, c. 954, s. 4.</p>', '5'.repeat(64));
  assert.equal(range.sections.length, 0);
  assert.equal(range.sourceNotices[0].kind, 'multi_section_source_notice');
  assert.equal(range.sourceNotices[0].text, '§§ 1-63 through 1-64. Repealed by Session Laws 1967, c. 954, s. 4.');
  const compactRange = parseChapter({ ...chapter, chapterId: '1' }, '<p>§§1-63 through 1-64. Repealed by Session Laws 1967, c. 954, s. 4.</p>', '6'.repeat(64));
  assert.equal(compactRange.sourceNotices.length, 1);
  assert.equal(compactRange.sourceNotices[0].kind, 'multi_section_source_notice');
});

test('flags a nonempty chapter with no section headings for review, not as a stub', () => {
  const parsed = parseChapter(chapter, '<h1>Chapter 3</h1><p>Rules governing this chapter.</p><p>Additional nonempty source text.</p>', 'c'.repeat(64));
  assert.equal(parsed.sections.length, 0);
  assert.equal(classifyNoSectionSource(parsed).parseStatus, 'nonempty_no_section_heading_review');
  assert.deepEqual(parsed.sourceParagraphs.map(row => row.text), ['Chapter 3', 'Rules governing this chapter.', 'Additional nonempty source text.']);
});

test('clears stale child hierarchy at article and subchapter boundaries', () => {
  const html = [
    '<p>SUBCHAPTER I. General</p>',
    '<p>Article 1.</p><p>First article</p><p>Part 1. Initial Part</p>',
    '<p>§ 1-1. One</p><p>Body one.</p>',
    '<p>Article 2. Second article</p><p>§ 1-2. Two</p><p>Body two.</p>',
    '<p>Part 3. New Part</p><p>§ 1-3. Three</p><p>Body three.</p>',
    '<p>SUBCHAPTER II. Special Rules</p><p>§ 1-4. Four</p><p>Body four.</p>',
  ].join('');
  const { sections } = parseChapter(chapter, html, 'd'.repeat(64));
  assert.deepEqual(sections.map(row => row.hierarchy), [
    { subchapter: 'I. General', articleNumber: '1', articleTitle: 'First article', part: '1. Initial Part' },
    { subchapter: 'I. General', articleNumber: '2', articleTitle: 'Second article', part: null },
    { subchapter: 'I. General', articleNumber: '2', articleTitle: 'Second article', part: '3. New Part' },
    { subchapter: 'II. Special Rules', articleNumber: null, articleTitle: null, part: null },
  ]);
});

test('preserves operative text embedded in a section heading when no body paragraph follows', () => {
  const html = '<h1>Chapter 10</h1><p>§ 10-1. Repealed by Session Laws 2024-1, s. 2.</p>';
  const parsed = parseChapter(chapter, html, 'e'.repeat(64));
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].heading, 'Repealed by Session Laws 2024-1, s. 2.');
  assert.equal(parsed.sections[0].bodyText, '');
  assert.equal(parsed.sections[0].text, parsed.sections[0].heading);
  assert.equal(parsed.sections[0].textFromHeadingFallback, true);
  assert.deepEqual(parsed.sourceParagraphs.map(row => row.text), [
    'Chapter 10',
    '§ 10-1. Repealed by Session Laws 2024-1, s. 2.',
  ]);
});

test('unknown entities remain visible and malformed numeric entities fail closed', () => {
  assert.equal(decodeHtmlEntities('Text &unknown; &amp; &#x41;'), 'Text &unknown; & A');
  const parsed = parseChapter(chapter, '<p>§ 1-7. Heading</p><p>Unknown &notDefined; entity remains.</p>', 'f'.repeat(64));
  assert.equal(parsed.sections[0].bodyText, 'Unknown &notDefined; entity remains.');
  assert.throws(() => decodeHtmlEntities('bad &#x110000; entity'), RangeError);
  assert.throws(() => decodeHtmlEntities('bad &#999999999999999999999; entity'), RangeError);
  assert.throws(() => parseChapter(chapter, '<p>§ 1-8. Heading</p><p>malformed &#x110000; source</p>', '0'.repeat(64)), RangeError);
});
