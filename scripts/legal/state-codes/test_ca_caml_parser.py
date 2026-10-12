import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('ca_caml_parser.py')
spec = importlib.util.spec_from_file_location('ca_caml_parser', MODULE_PATH)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class CamlParserTests(unittest.TestCase):
    def test_preserves_xml_text_and_inserts_reviewable_layout_boundaries(self):
        raw = (
            b'<caml:Content xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#">'
            b'<p>(a)<span class="EnSpace"/>Text<br/>next</p><p>second</p>'
            b'</caml:Content>'
        )
        result = parser.render_caml(raw)
        self.assertEqual(result['text'], '(a)\u2002Text\nnext\nsecond\n')
        self.assertEqual(result['sourceTextCharacters'], len('(a)Textnextsecond'))
        self.assertEqual(result['insertions'], {
            'blockEnd:p': 2,
            'lineBreakElements': 1,
            'semanticSpace:EnSpace': 1,
        })

    def test_renders_structured_fraction_without_dropping_numerator_or_denominator(self):
        raw = (
            b'<caml:Content xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#">'
            b'<p><caml:Fraction><caml:Numerator>1</caml:Numerator>'
            b'<caml:Denominator>4</caml:Denominator></caml:Fraction></p>'
            b'</caml:Content>'
        )
        result = parser.render_caml(raw)
        self.assertEqual(result['text'], '1/4\n')
        self.assertEqual(result['sourceTextCharacters'], 2)
        self.assertEqual(result['insertions']['fractionSeparators'], 1)

    def test_keeps_tables_and_all_cell_text_in_document_order(self):
        raw = (
            b'<caml:Content xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#">'
            b'<table><tr><td>left</td><td></td><td>right</td></tr></table>'
            b'</caml:Content>'
        )
        result = parser.render_caml(raw)
        self.assertEqual(result['text'], 'left\t\tright\n')
        self.assertEqual(result['sourceTextCharacters'], len('leftright'))
        self.assertEqual(result['insertions']['tableCellSeparators'], 2)

    def test_rejects_wrong_root_malformed_xml_and_doctype(self):
        namespace = b'http://lc.ca.gov/legalservices/schemas/caml.1#'
        with self.assertRaisesRegex(ValueError, 'expected publisher caml:Content root'):
            parser.render_caml(b'<Content/>')
        with self.assertRaises(Exception):
            parser.render_caml(b'<caml:Content xmlns:caml="' + namespace + b'"><p></caml:Content>')
        with self.assertRaisesRegex(ValueError, 'DOCTYPE'):
            parser.render_caml(
                b'<!DOCTYPE caml:Content [<!ENTITY x "hidden">]>'
                b'<caml:Content xmlns:caml="' + namespace + b'"><p>&x;</p></caml:Content>'
            )

    def test_reports_unexpanded_publisher_attachments_without_inventing_their_text(self):
        raw = b'<caml:Content xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#"><p>See form.</p><caml:TipIn numPages="2"/></caml:Content>'
        result = parser.render_caml(raw)
        self.assertEqual(result['text'], 'See form.\n')
        self.assertEqual(result['tipIns'], [{'publisher_pages': '2', 'has_text': False}])

    def test_rejects_unknown_elements_instead_of_silently_dropping_semantics(self):
        raw = b'<caml:Content xmlns:caml="http://lc.ca.gov/legalservices/schemas/caml.1#"><caml:Unknown>text</caml:Unknown></caml:Content>'
        with self.assertRaisesRegex(ValueError, 'unclassified'):
            parser.render_caml(raw)


if __name__ == '__main__':
    unittest.main()

