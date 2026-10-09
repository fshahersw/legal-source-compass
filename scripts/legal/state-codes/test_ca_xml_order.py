import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('ca_parse_xml',Path(__file__).with_name('ca-parse.py'))
CA=importlib.util.module_from_spec(spec);spec.loader.exec_module(CA)

class XmlSourceOrder(unittest.TestCase):
 def test_nested_inline_text_preserves_publisher_document_order(self):
  self.assertEqual(CA.xml_plain_text(b'<section><p>one <em>two</em> three</p> tail</section>'),'one two three tail')
 def test_multiple_nested_tails_do_not_move_before_text(self):
  data=b'<section>start <p>A <span>B <i>C</i> D</span> E</p> F</section>'
  self.assertEqual(CA.xml_plain_text(data),'start A B C D E F')
 def test_external_entity_or_doctype_is_not_admitted(self):
  with self.assertRaises(ValueError):CA.xml_plain_text(b'<!DOCTYPE section SYSTEM "https://example.org/entity"><section>unsafe</section>')

if __name__=='__main__':unittest.main()
