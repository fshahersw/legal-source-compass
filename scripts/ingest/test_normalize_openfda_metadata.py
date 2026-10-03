"""Meaningful identity/privacy boundaries; source originals remain unmodified."""
import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).with_name("normalize-openfda-metadata.py")
spec=importlib.util.spec_from_file_location("fda_normalizer",p)
fda=importlib.util.module_from_spec(spec);spec.loader.exec_module(fda)

class NativeFDAContract(unittest.TestCase):
 def test_missing_sentinel_enforcement_identifiers_never_become_entities(self):
  for raw in [{},{"recall_number":None},{"recall_number":""},{"recall_number":"N/A"}]:
   for kind in ("device-enforcement","drug-enforcement"):
    native,data=fda.select_native(raw,kind)
    self.assertIsNone(native);self.assertFalse(data["public_eligible"])
  self.assertEqual(fda.select_native({"recall_number":"D-001-2026"},"drug-enforcement")[0],"D-001-2026")
 def test_undocumented_alternate_recall_identity_is_retained_private_only(self):
  native,data=fda.select_native({"product_res_number":"Z-316/318-3"},"device-recalls")
  self.assertEqual(native,"Z-316/318-3");self.assertEqual(data["native_identity_field"],"product_res_number")
  self.assertFalse(data["public_eligible"])
  native,data=fda.select_native({"cfres_id":"91234","product_res_number":"Z-316/318-3"},"device-recalls")
  self.assertEqual(native,"91234");self.assertTrue(data["public_eligible"])
 def test_absence_null_and_exact_native_values_are_distinct(self):
  _,a=fda.select_native({"product_code":"RFU"},"device-classification")
  _,b=fda.select_native({"product_code":"RFU","regulation_number":None,"device_name":"Laser Fax Machine"},"device-classification")
  self.assertIsNone(a["regulation_number"]);self.assertIsNone(b["regulation_number"])
  self.assertNotIn("regulation_number",a["native_fields_present"])
  self.assertIn("regulation_number",b["native_fields_present"])
  self.assertEqual(b["device_name"],"Laser Fax Machine")
 def test_contact_harmonization_and_recall_narratives_never_enter_public_whitelist(self):
  _,data=fda.select_native({"recall_number":"Z-123-2026","recalling_firm":"Example 123 Main Street","address_1":"123 Main","openfda":{"udi_di":["large"]},"reason_for_recall":"native narrative"},"device-enforcement")
  self.assertNotIn("recalling_firm",data);self.assertNotIn("address_1",data);self.assertNotIn("openfda",data)
  self.assertEqual(data["reason_for_recall"],"native narrative")
  forbidden={"reason_for_recall","product_description","recalling_firm","address_1","openfda","definition","k_numbers","pma_numbers"}
  for public in fda.PUBLIC.values():self.assertFalse(forbidden.intersection(public))
 def test_unreviewed_types_and_unrepresentable_strings_fail_closed(self):
  for raw in [{"product_code":"RFU","device_class":1},{"product_code":"RFU","device_name":["x"]},{"product_code":"RFU","device_name":"a\x00b"},{"product_code":"RFU","device_name":"a\ud800b"}]:
   with self.assertRaises(ValueError):fda.select_native(raw,"device-classification")
  with self.assertRaises(ValueError):fda.select_native({"cfres_id":"ABC"},"device-recalls")
  with self.assertRaises(ValueError):fda.select_native({"cfres_id":"123","k_numbers":[1]},"device-recalls")
  _,data=fda.select_native({"cfres_id":"123","k_numbers":["K123"]},"device-recalls")
  self.assertEqual(data["k_numbers"],["K123"])

if __name__=="__main__":unittest.main()
