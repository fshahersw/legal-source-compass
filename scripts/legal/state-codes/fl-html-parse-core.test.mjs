import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeUtf8Strict, extractClassText, extractChapterSectionIndex, extractSectionBlocks,
  occurrenceMismatches, parseSectionOccurrences, chapterPairState,
} from './fl-html-parse-core.mjs';

test('section parsing preserves nested section text and nested HistoryText contents', () => {
  const html = '<div class="CatchlineIndex"><div class="IndexItem"><span class="SectionNumber">95.11</span><span class="Catchline">Limitations</span></div></div>' +
    '<div class="Section"><span class="SectionNumber">95.11</span><div class="SectionBody"><p>Full <b>nested <i>operative</i></b> text.</p></div>' +
    '<div class="History"><span class="HistoryText">History <span class="HistoryText">nested phrase</span> after.</span></div></div>';
  const result = parseSectionOccurrences(html, 'a'.repeat(64));
  assert.equal(result.sections.length, 1);
  assert.match(result.sections[0].text, /Full nested operative text\./);
  assert.equal(result.sections[0].historyAsPrinted, 'History nested phrase after.');
  assert.equal(result.sections[0].historyElementBalanced, true);
  assert.deepEqual(result.unmatchedSectionBlockStarts, []);
  assert.deepEqual(result.nestedSectionBlockStarts, []);
  assert.deepEqual(extractChapterSectionIndex(html).map(row => row.nativeCitationAsPrinted), ['95.11']);
  assert.equal(extractClassText(html, 'HistoryText'), 'History nested phrase after.');
});

test('unmatched and nested section divs are explicit integrity failures', () => {
  const unmatched = extractSectionBlocks('<div class="Section"><span class="SectionNumber">1.2</span><div>body');
  assert.equal(unmatched.blocks.length, 0);
  assert.equal(unmatched.unmatchedStarts.length, 1);
  const nested = extractSectionBlocks('<div class="Section"><div class="Section"><span class="SectionNumber">1.2</span></div></div>');
  assert.equal(nested.blocks.length, 1);
  assert.equal(nested.nestedStarts.length, 1);
  const parsed = parseSectionOccurrences('<div class="Section"><div class="Section"><span class="SectionNumber">1.2</span></div></div>');
  assert.equal(parsed.nestedSectionBlockStarts.length, 1);
});

test('strict UTF-8 decoding rejects replacement-producing malformed byte sequences', () => {
  assert.equal(decodeUtf8Strict(Buffer.from('Florida', 'utf8')), 'Florida');
  assert.throws(() => decodeUtf8Strict(Buffer.from([0x46, 0x80, 0x4c])), /encoded data/);
});

test('chapter structure requires exact native identity, edition context, and nonempty matched section inventory', () => {
  const base = { nativeChapterId: '95', printedChapterNumber: 'CHAPTER 95', expectedTitleRoman: 'VIII', printedTitleNumber: 'TITLE VIII', expectedEdition: 'The 2026 Florida Statutes', indexHasEdition: true, bodyHasEdition: true, sectionIndexCount: 2, sectionOccurrences: 2 };
  assert.equal(chapterPairState(base).status, 'validated_structure');
  assert.equal(chapterPairState({ ...base, printedChapterNumber: 'CHAPTER 96' }).status, 'identity_mismatch');
  assert.equal(chapterPairState({ ...base, bodyHasEdition: false }).status, 'edition_unverified');
  assert.equal(chapterPairState({ ...base, sectionIndexCount: 0, sectionOccurrences: 0 }).status, 'unresolved_empty_chapter');
  assert.equal(chapterPairState({ ...base, sectionIndexCount: 2, sectionOccurrences: 1 }).status, 'section_count_mismatch');
});

test('publisher reconciliation preserves repeated native citation multiplicity', () => {
  const index = [{ nativeCitationAsPrinted: '1.01' }, { nativeCitationAsPrinted: '1.01' }, { nativeCitationAsPrinted: '1.02' }];
  const parsed = [{ normalizedCitationForJoin: '1.01' }, { normalizedCitationForJoin: '1.02' }, { normalizedCitationForJoin: '1.02' }];
  assert.deepEqual(occurrenceMismatches(index, parsed), [
    { citation: '1.01', publisherIndexOccurrences: 2, fullTextSectionOccurrences: 1 },
    { citation: '1.02', publisherIndexOccurrences: 1, fullTextSectionOccurrences: 2 },
  ]);
});
