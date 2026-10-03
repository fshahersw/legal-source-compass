"""Verify whole publisher trees before emitting native paths and structural metadata.

API received_on/size fields are retained as technical publisher values, never
treated as legal effective dates or operative-law findings. Full XML is private
evidence for source/authority notes; the normalized corpus is metadata only.
"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET

p = argparse.ArgumentParser()
p.add_argument('--cache', default='C:/Users/firas/.codex/corpus-cache/regulatory/2026-10-02/hierarchy')
a = p.parse_args()
root = Path(a.cache)
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
if not manifest.get('hierarchy_complete') or not manifest.get('part_scope_complete'):
    raise ValueError('Incomplete acquisition cannot become a complete metadata projection')

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)

def original(key):
    entry = manifest['sources'][key]
    raw = (root / entry['file']).read_bytes()
    if not entry['complete'] or digest(raw) != entry['sha256'] or len(raw) != entry['bytes']:
        raise ValueError('Original checksum/size mismatch: ' + key)
    return raw, entry

def envelope(kind, native_id, data, source, as_of):
    return {'schema_version': 'ecfr-authority-notes/1.1' if kind == 'part-authority-notes' else 'ecfr-hierarchy-metadata/1', 'source_system': 'ecfr',
            'entity_type': kind, 'native_id': native_id, 'data': data,
            'provenance': {'source_url': source['url'], 'source_sha256': source['sha256'],
                           'source_as_of': as_of, 'retrieved_at': source['retrieved_at'],
                           'http_status': source['http_status'], 'record_sha256': digest(canonical(data).encode()),
                           'hash_kind': 'sorted-key-compact-utf8-json',
                           'derivation': 'publisher-xml-authority-source-and-section-cita-notes' if kind == 'part-authority-notes' else 'publisher-structure-tree-path'}}

titles = json.loads(original('titles')[0])['titles']
nodes = []
ids = set()
counts = Counter()
unidentified_headings = 0
title_receipts = []
for title in titles:
    if title['reserved']:
        title_receipts.append({'title': title['number'], 'status': 'reserved-no-structure', 'nodes': 0})
        continue
    raw, source = original('title-' + str(title['number']))
    tree = json.loads(raw)
    start = len(nodes)
    def walk(node, ancestors):
        global unidentified_headings
        if not isinstance(node.get('identifier'), str) or not isinstance(node.get('type'), str):
            raise ValueError('Missing publisher identifier/type')
        segment = node['type'] + '-' + quote(node['identifier'], safe='')
        native = '/'.join(ancestors + [segment])
        if native in ids:
            raise ValueError('Duplicate publisher tree path: ' + native)
        ids.add(native)
        children = node.get('children', [])
        if not isinstance(children, list):
            raise ValueError('Invalid native children collection')
        identified = [c for c in children if isinstance(c.get('identifier'), str)]
        unidentified = [c for c in children if not isinstance(c.get('identifier'), str)]
        # Publisher hed1 nodes have no native identifier. Retain their exact
        # metadata/position on the parent; do not manufacture a legal node ID.
        if any(c.get('type') != 'hed1' or c.get('children') for c in unidentified):
            raise ValueError('Unidentified substantive node requires schema review')
        unidentified_headings += len(unidentified)
        child_ids = [native + '/' + c['type'] + '-' + quote(c['identifier'], safe='') for c in identified]
        data = {'title_number': title['number'], 'title_name': title['name'],
                'node_type': node['type'], 'node_identifier': node['identifier'],
                'heading': node.get('label'), 'reserved': node.get('reserved'),
                'parent_native_id': '/'.join(ancestors) or None, 'child_native_ids': child_ids,
                'unidentified_headings': [{'source_child_index': i, 'source_node': c} for i, c in enumerate(children) if not isinstance(c.get('identifier'), str)],
                'snapshot_as_of': title['up_to_date_as_of'],
                'title_latest_amended_on': title['latest_amended_on'], 'title_latest_issue_date': title['latest_issue_date'],
                'source_node': {k: v for k, v in node.items() if k != 'children'}}
        nodes.append(envelope('hierarchy-nodes', native, data, source, title['up_to_date_as_of']))
        counts[node['type']] += 1
        for child in identified:
            walk(child, ancestors + [segment])
    walk(tree, [])
    title_receipts.append({'title': title['number'], 'status': 'complete-tree', 'nodes': len(nodes)-start,
                           'source_as_of': title['up_to_date_as_of'], 'source_url': source['url'], 'sha256': source['sha256']})

parents = 0
child_refs = 0
for row in nodes:
    data = row['data']
    if data['parent_native_id']:
        parents += 1
        if data['parent_native_id'] not in ids:
            raise ValueError('Missing parent target')
    child_refs += len(data['child_native_ids'])
    if any(c not in ids for c in data['child_native_ids']):
        raise ValueError('Missing child target')
if child_refs != parents:
    raise ValueError('Tree edge count mismatch')

notes = []
def txt(element):
    return ''.join(element.itertext()).strip() if element is not None else None

for key in manifest['sources']:
    if not key.startswith('part-'):
        continue
    raw, source = original(key)
    xml = ET.fromstring(raw)
    _, title, part, *_ = key.split('-')
    historical = key.endswith('before-qmsr')
    as_of = '2026-02-01' if historical else next(t['up_to_date_as_of'] for t in titles if str(t['number']) == title)
    if xml.attrib.get('TYPE') != 'PART' or xml.attrib.get('N') != part:
        raise ValueError('Unexpected requested XML part')
    items = [{'section_identifier': n.attrib.get('N'), 'heading': txt(n.find('HEAD')),
              'source_notes': [txt(s) for s in n.findall('SOURCE')],
              'citation_notes': [{'attributes': dict(c.attrib), 'text': txt(c)} for c in n.findall('CITA')]} for n in xml.iter() if n.attrib.get('TYPE') == 'SECTION']
    data = {'title_number': int(title), 'part_number': part, 'snapshot_as_of': as_of,
            'heading': txt(xml.find('HEAD')), 'authority_note': txt(xml.find('AUTH')),
            'source_note': txt(xml.find('SOURCE')), 'sections': items,
            'selection_basis': 'selected-product-safety-and-exposure-research-scope',
            'historical_scope': historical, 'xml_sha256': source['sha256']}
    notes.append(envelope('part-authority-notes', f'title-{title}/part-{part}/as-of-{as_of}', data, source, as_of))

for name, rows in [('hierarchy-nodes', nodes), ('part-authority-notes', notes)]:
    target = root / (name + '.jsonl')
    target.write_text(''.join(canonical(r) + '\n' for r in rows), encoding='utf-8', newline='\n')
    for row in rows:
        if digest(canonical(row['data']).encode()) != row['provenance']['record_sha256']:
            raise ValueError('Normalized record hash mismatch')

receipt = {'schema_version': 'ecfr-hierarchy-receipt/1', 'metadata_only': True, 'pdf_downloads': 0,
           'source_as_of': sorted({r['data']['snapshot_as_of'] for r in nodes}),
           'title_inventory': 50, 'reserved_titles': [t['number'] for t in titles if t['reserved']],
           'complete_title_trees': len(title_receipts)-sum(t['reserved'] for t in titles),
           'nodes': len(nodes), 'node_type_counts': dict(sorted(counts.items())), 'parent_edges': parents,
           'unidentified_heading_metadata_retained': unidentified_headings,
           'part_authority_snapshots': len(notes), 'title_receipts': title_receipts,
           'files': {name: {'records': len(rows), 'sha256': digest((root/(name+'.jsonl')).read_bytes())}
                     for name, rows in [('hierarchy-nodes', nodes), ('part-authority-notes', notes)]},
           'qualification': 'Complete dated publisher hierarchy metadata, including reserved headings and appendices. No complete provision text, incorporated standards, operative-law finding, case applicability, legal effective-date inference, or PDF acquisition.'}
(root/'normalized-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
print(json.dumps({k:v for k,v in receipt.items() if k not in ('title_receipts',)}))
