import unittest
from decode_bulk import exact_row


class CopyCsvTest(unittest.TestCase):
    def test_null_empty_and_literal_null(self):
        self.assertEqual(exact_row(',"","NULL",\n'), [None, "", "NULL", None])

    def test_embedded_quotes_backslashes_and_newlines(self):
        self.assertEqual(exact_row('"a\\"b","x\\\\y","first\nsecond"\n'), ['a"b', 'x\\y', 'first\nsecond'])

    def test_multiline_and_comma(self):
        self.assertEqual(exact_row('"1","alpha,beta","next\nline"\r\n'), ['1', 'alpha,beta', 'next\nline'])

    def test_rejects_trailing_record(self):
        with self.assertRaises(ValueError):
            exact_row('"one"\n"two"\n')


if __name__ == "__main__":
    unittest.main()
