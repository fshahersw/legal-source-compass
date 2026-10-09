"""Publisher URL identities must survive inventory discovery; synthetic link labels."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('maine_inventory', Path(__file__).with_name('acquire.py'))
acquire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquire)


class ChapterSuffixTest(unittest.TestCase):
    def test_publisher_suffixes_are_not_dropped_or_normalized_away(self):
        page = '''<a href="./title24ch21sec0-1.html">Earlier chapter</a>
<a href="./title24ch21sec0-2.html">Current chapter</a>
<a href="./title24ch25sec0.html">Unsuffixed chapter</a>
<a href="./title24sec2902-2.html">A section, not a chapter</a>'''
        self.assertEqual([m.group(1) for m in acquire.CHAPTER_RE.finditer(page)],
                         ['title24ch21sec0-1.html', 'title24ch21sec0-2.html', 'title24ch25sec0.html'])

    def test_section_suffix_and_alphabetic_section_number_remain_distinct(self):
        page = '''<a href="./title24sec2902-1.html">Earlier section</a>
<a href="./title24sec2902-2.html">Current section</a>
<a href="./title24sec2902-A.html">Different section</a>'''
        self.assertEqual([m.group(1) for m in acquire.SECTION_RE.finditer(page)],
                         ['title24sec2902-1.html', 'title24sec2902-2.html', 'title24sec2902-A.html'])


if __name__ == '__main__':
    unittest.main()
