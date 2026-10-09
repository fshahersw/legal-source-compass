"""Official node ancestry, not a guessed title/part ordering, determines hierarchy."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('ca_hierarchy',Path(__file__).with_name('ca_hierarchy.py'))
CA=importlib.util.module_from_spec(spec);spec.loader.exec_module(CA)

def node(path,heading,coords):
    return ['PEN',*coords,heading,'Y','publisher','2026-10-01','1',str(len(path.split('.'))),path.split('.')[-1],path,'Y','','','','']
def section(id='PEN1',vid='v1',coords=None):
    return [id,'PEN','1.','','','','',vid,*(coords or ['NULL','4.','3.','1.','NULL']),'','LOB.lob','Y','','']
def reference(id='PEN1',vid='v1',node_path='2.1.1'):
    return [id,'PEN',node_path,'1.','1','1. Heading','','','','','',vid,'1']
def fixture():
    return [node('2','PART 3. GENERAL RULES',['NULL','NULL','3.','NULL','NULL']),node('2.1','TITLE 4. PROCEDURE',['NULL','4.','3.','NULL','NULL']),node('2.1.1','CHAPTER 1. PROVISIONS',['NULL','4.','3.','1.','NULL'])]
class HierarchyTests(unittest.TestCase):
    def test_official_parent_order_preserves_part_before_title(self):
        result=CA.build_payload([['PEN','Penal Code - PEN']],fixture(),[section()],[reference()])
        hierarchy=CA.hierarchy_for(result,'CA:PEN:1.',section())
        self.assertEqual([h['level'] for h in hierarchy],['code','part','title','chapter','section'])
        self.assertEqual(hierarchy[2]['heading'],'TITLE 4. PROCEDURE')
        self.assertEqual(result['section_count'],1)
    def test_same_coordinates_in_two_publisher_branches_use_exact_version_reference(self):
        nodes=fixture()+[node('3','PART 3. ALTERNATE VERSION',['NULL','NULL','3.','NULL','NULL']),node('3.1','TITLE 4. ALTERNATE',['NULL','4.','3.','NULL','NULL']),node('3.1.1','CHAPTER 1. ALTERNATE',['NULL','4.','3.','1.','NULL'])]
        result=CA.build_payload([['PEN','Penal Code - PEN']],nodes,[section(),section('PEN1B','v2')],[reference(),reference('PEN1B','v2','3.1.1')])
        self.assertEqual(result['overrides']['CA:PEN:1.~2'],'3.1.1')
        self.assertEqual(CA.hierarchy_for(result,'CA:PEN:1.~2',section('PEN1B','v2'))[-2]['heading'],'CHAPTER 1. ALTERNATE')
    def test_missing_parent_or_mismatched_section_reference_is_not_silently_filled(self):
        with self.assertRaisesRegex(ValueError,'parent|ancestor'):
            CA.build_payload([['PEN','Penal Code - PEN']],fixture()[1:],[section()],[reference()])
        with self.assertRaisesRegex(ValueError,'identity|reference'):
            CA.build_payload([['PEN','Penal Code - PEN']],fixture(),[section()],[reference('WRONG')])
    def test_unclassified_publisher_heading_is_preserved_without_inventing_an_article(self):
        nodes=[node('1','PRELIMINARY PROVISIONS',['NULL']*5)]
        row=section(coords=['NULL']*5)
        result=CA.build_payload([['PEN','Penal Code - PEN']],nodes,[row],[reference(node_path='1')])
        entry=CA.hierarchy_for(result,'CA:PEN:1.',row)[1]
        self.assertEqual(entry,{'level':'heading','number':None,'heading':'PRELIMINARY PROVISIONS'})
    def test_node_path_segment_boundaries_do_not_match_a_neighbor(self):
        nodes=[node('1','PART 3. ROOT',['NULL','NULL','3.','NULL','NULL']),node('1.10','TITLE 4. TEN',['NULL','4.','3.','NULL','NULL']),node('1.1','TITLE 5. ONE',['NULL','5.','3.','NULL','NULL'])]
        row=section(coords=['NULL','4.','3.','NULL','NULL'])
        result=CA.build_payload([['PEN','Penal Code - PEN']],nodes,[row],[reference(node_path='1.10')])
        self.assertEqual([h['heading'] for h in CA.hierarchy_for(result,'CA:PEN:1.',row)][1:-1],['PART 3. ROOT','TITLE 4. TEN'])
class SpacingIdentityTest(unittest.TestCase):
    def test_literal_publisher_spacing_difference_is_logged_not_mistaken_for_another_law(self):
        ref=reference();ref[0]='PEN 1';ref[3]=' 1.'
        result=CA.build_payload([['PEN','Penal Code - PEN']],fixture(),[section()],[ref])
        self.assertEqual(result['spacing_only_identity_count'],1)
        self.assertEqual(result['spacing_only_identity_records'][0]['toc_row_id'],'PEN 1')
        self.assertEqual(CA.hierarchy_for(result,'CA:PEN:1.',section())[-2]['heading'],'CHAPTER 1. PROVISIONS')
if __name__=='__main__':unittest.main()
