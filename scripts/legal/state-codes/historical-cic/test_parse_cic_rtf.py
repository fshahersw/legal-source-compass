import unittest

from parse_cic_rtf import parse, render


def fixture(body):
    return (r'{\rtf\ansi{\stylesheet{\s9 Section;}{\s10 Code Segment;}{\s11 Body;}{\s2 Level2;}}' + body + '}').encode('ascii')


class HistoricalRtfTests(unittest.TestCase):
    def test_native_hidden_form_transcript_is_separate_from_visible_source_text(self):
        raw=fixture(r'\pard\s9 1-2-3. Form.\par \pard\s10 Text\par \pard\s11 Visible statute.\par \pard\s46 {\v HIDDEN BALLOT \'a8}\par \pard\s11 Click to view form.\par ')
        raw=raw.replace(b'{\\s2 Level2;}',b'{\\s2 Level2;}{\\s46 hidden;}')
        row=parse(raw,'AR','2020-11-06')['sections'][0]
        self.assertEqual(row['text'],'Visible statute.\nClick to view form.')
        self.assertEqual(row['parts']['hidden_text'][0]['text'],'HIDDEN BALLOT ¨')
        self.assertEqual(row['hidden_transcript_paragraphs'],1)
        self.assertTrue(any('not represented' in x for x in row['issues']))
        span=row['parts']['hidden_text'][0]['raw_span']
        self.assertIn(b'HIDDEN BALLOT',raw[span['start']:span['end']])
    def test_native_style_boundaries_keep_statute_history_and_annotations_distinct(self):
        raw=fixture(r'\pard\s9 {\*\bkmkstart 1-2-3}1-2-3. Synthetic.\par \pard\s10 Text\par \pard\s11 Only source law.\par \pard\s10 History\par \pard\s11 Historical note.\par \pard\s10 Annotations\par \pard\s11 Publisher commentary.\par ')
        result=parse(raw,'AR','2020-11-06');row=result['sections'][0]
        self.assertEqual(row['text'],'Only source law.')
        self.assertEqual(row['history'],'Historical note.')
        self.assertEqual(row['annotations'],'Publisher commentary.')
        self.assertEqual(row['native_bookmarks'],['1-2-3'])
        self.assertEqual(row['citation'],'1-2-3')
        self.assertFalse(row['current_law_verified'])
        self.assertFalse(row['publication_allowed'])
        self.assertEqual(row['issues'],[])
        span=row['parts']['text'][0]['raw_span']
        self.assertIn(b'Only source law.',raw[span['start']:span['end']])

    def test_physical_line_wraps_do_not_insert_characters_into_words(self):
        self.assertEqual(render(b'commen\r\nced next\\par line')[0],'commenced next\nline')

    def test_unicode_fallback_and_cp1252_escapes_preserve_exact_punctuation(self):
        self.assertEqual(render(r"\uc1\u167 ? \'93words\'94 \u8212 ?")[0],'§ “words” —')
        self.assertEqual(render(r'\uc1\u-10179 ?\u-8704 ?')[0],'😀')

    def test_escaped_braces_and_bookmark_destinations(self):
        self.assertEqual(render(r'{\*\bkmkstart hidden}visible \{literal\} \\')[0],'visible {literal} '+chr(92))

    def test_repeated_native_citations_are_not_merged(self):
        part=r'\pard\s9 1-2-3. Source version.\par \pard\s10 Text\par \pard\s11 Actual text.\par '
        rows=parse(fixture(part+part),'MS','2020-07-08')['sections']
        self.assertEqual(len(rows),2)
        self.assertNotEqual(rows[0]['heading_raw_span'],rows[1]['heading_raw_span'])
        self.assertTrue(all(any('Repeated' in issue for issue in row['issues'])for row in rows))

    def test_unknown_visible_controls_hold_the_section(self):
        rows=parse(fixture(r'\pard\s9 1-2-3. Synthetic.\par \pard\s10 Text\par \pard\s11 Before\unreviewedvalue17 after.\par '),'TN','2021-05-21')['sections']
        self.assertIn('Unknown text controls: unreviewedvalue',rows[0]['issues'])

    def test_printed_ranges_and_unions_stay_one_literal_source_occurrence(self):
        rows=parse(fixture(r'\pard\s9 16-7-105 \emdash  16-7-107. [Transferred.]\par \pard\s9 16-4-109, 16-4-110. [Reserved.]\par '),'AR','2020-11-06')['sections']
        self.assertEqual([r['citation']for r in rows],['16-7-105 — 16-7-107','16-4-109, 16-4-110'])
        self.assertEqual(len(rows),2)
        self.assertTrue(all(not any('citation' in x for x in r['issues'])for r in rows))

    def test_unrecognized_headings_are_not_falsely_reported_as_duplicate_citations(self):
        rows=parse(fixture(r'\pard\s9 Unclassified A.\par \pard\s9 Unclassified B.\par '),'AR','2020-11-06')['sections']
        self.assertTrue(all(r['citation'] is None for r in rows))
        self.assertTrue(all(not any('Repeated' in x for x in r['issues'])for r in rows))

    def test_missing_text_segment_does_not_promote_annotations(self):
        row=parse(fixture(r'\pard\s9 1-2-3. Repealed.\par \pard\s10 Annotations\par \pard\s11 Editorial text.\par '),'AR','2020-11-06')['sections'][0]
        self.assertEqual(row['text'],'')
        self.assertIn('No statutory text in the original Text segment',row['issues'])

    def test_outline_ends_a_section_and_preserves_outside_text(self):
        rows=parse(fixture(r'\pard\s9 1-2-3. Synthetic.\par \pard\s10 Text\par \pard\s11 Law.\par \pard\s2 Next chapter\par \pard\s11 Context only\par '),'AR','2020-11-06')
        self.assertEqual(rows['sections'][0]['text'],'Law.')
        self.assertEqual([x['text']for x in rows['unmapped']],['Next chapter','Context only'])

    def test_missing_or_ambiguous_native_style_contract_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'Unique native'):
            parse(b'{\\rtf{\\stylesheet{\\s9 Section;}{\\s8 Section;}}\\pard\\s9 1-2-3.}', 'AR','2020-11-06')

    def test_binary_objects_never_silently_become_text(self):
        with self.assertRaisesRegex(ValueError,'Binary'):
            render(r'\bin4 abcd')
        self.assertEqual(render(r'Law {\pict ffffff} remains')[2],1)


if __name__=='__main__':unittest.main()
