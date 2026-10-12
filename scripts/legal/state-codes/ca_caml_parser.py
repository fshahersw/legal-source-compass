"""Strict, lossless-source CAML text extraction helpers for California exports."""

from collections import Counter
from hashlib import sha256
from lxml import etree

CAML_NAMESPACE = 'http://lc.ca.gov/legalservices/schemas/caml.1#'
SPACE_SPANS = {
    'EnSpace': '\u2002',
    'EmSpace': '\u2003',
    'ThinSpace': '\u2009',
    'NbSpace': '\u00a0',
}
BLOCK_END_TAGS = {'p', 'h1', 'tr', 'table'}
EXPECTED_LOCAL_TAGS = {
    'Content', 'p', 'span', 'br', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
    'colgroup', 'col', 'h1', 'b', 'i', 'u', 'sub', 'sup', 'Fraction',
    'Numerator', 'Denominator', 'LabelledField', 'TipIn',
}


def _local_name(element):
    if not isinstance(element.tag, str):
        return None
    return etree.QName(element).localname


def _add_source(pieces, source_pieces, transforms, text):
    if text:
        pieces.append(text)
        source_pieces.append(text)


def _add_boundary(pieces, transforms, kind, value='\n', force=False):
    if force or (pieces and pieces[-1] and not pieces[-1][-1].isspace()):
        pieces.append(value)
        transforms[kind] += 1


def render_caml(raw_bytes):
    """Return text while preserving source character order and recording inserts.

    Raw CAML remains the authority and is separately retained with a whole-body
    SHA and byte span. This derivative XML-decodes text nodes, inserts explicit
    layout separators, and maps the publisher's empty semantic spacing spans to
    Unicode spaces. It does not strip, trim, normalize, or discard source text.
    """
    parser = etree.XMLParser(
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        recover=False,
        huge_tree=True,
        strip_cdata=False,
    )
    root = etree.fromstring(raw_bytes, parser)
    root_name = etree.QName(root)
    if root_name.localname != 'Content' or root_name.namespace != CAML_NAMESPACE:
        raise ValueError('expected publisher caml:Content root')
    if root.getroottree().docinfo.doctype:
        raise ValueError('CAML document contains a DOCTYPE; explicit review required')

    source_pieces = []
    pieces = []
    transforms = Counter()
    element_counts = Counter()
    attribute_counts = Counter()
    unclassified_tags = Counter()
    unresolved_entities = 0
    tip_ins = []

    for element in root.iter():
        if isinstance(element, etree._Entity):
            unresolved_entities += 1
            continue
        local = _local_name(element)
        if local is None:
            continue
        element_counts[local] += 1
        if local not in EXPECTED_LOCAL_TAGS:
            unclassified_tags[local] += 1
        if local == 'TipIn':
            tip_ins.append({'publisher_pages': element.get('numPages'),
                            'has_text': bool(''.join(element.itertext()).strip())})
        for key, value in element.attrib.items():
            attr_name = etree.QName(key).localname if key.startswith('{') else key
            attribute_counts[f'{local}@{attr_name}={value}'] += 1
    if unresolved_entities:
        raise ValueError(f'unresolved XML entity nodes: {unresolved_entities}')
    if unclassified_tags:
        raise ValueError(f'unclassified publisher XML elements: {dict(unclassified_tags)}')

    def walk(element):
        local = _local_name(element)
        _add_source(pieces, source_pieces, transforms, element.text)
        cell_count = 0
        saw_numerator = False
        fraction_children = [
            child for child in element
            if isinstance(child.tag, str)
        ] if local == 'Fraction' else []
        use_fraction_slash = (
            len(fraction_children) == 2
            and [_local_name(child) for child in fraction_children] == ['Numerator', 'Denominator']
        )

        for child in element:
            child_local = _local_name(child)
            if local == 'tr' and child_local in {'td', 'th'}:
                if cell_count:
                    _add_boundary(pieces, transforms, 'tableCellSeparators', '\t', force=True)
                cell_count += 1

            if local == 'Fraction' and use_fraction_slash and child_local == 'Denominator' and saw_numerator:
                _add_boundary(pieces, transforms, 'fractionSeparators', '/', force=True)

            if local == 'Fraction' and child_local == 'Numerator':
                saw_numerator = True

            if child_local == 'br':
                _add_boundary(pieces, transforms, 'lineBreakElements', '\n', force=True)
                _add_source(pieces, source_pieces, transforms, child.text)
                for grandchild in child:
                    walk(grandchild)
                    _add_source(pieces, source_pieces, transforms, grandchild.tail)
            elif (
                child_local == 'span'
                and child.get('class') in SPACE_SPANS
                and len(child) == 0
                and not (child.text or '')
            ):
                pieces.append(SPACE_SPANS[child.get('class')])
                transforms[f'semanticSpace:{child.get("class")}'] += 1
            else:
                walk(child)

            _add_source(pieces, source_pieces, transforms, child.tail)

        if local in BLOCK_END_TAGS:
            _add_boundary(pieces, transforms, f'blockEnd:{local}')

    walk(root)
    source_text = ''.join(source_pieces)
    itertext = ''.join(root.itertext())
    if source_text != itertext:
        raise ValueError('source text traversal differs from XML itertext order')
    rendered_text = ''.join(pieces)
    if not rendered_text:
        raise ValueError('section has no rendered body text')
    if len(rendered_text) - len(source_text) != sum(transforms.values()):
        raise ValueError('rendered text contains an untracked character transformation')
    return {
        'text': rendered_text,
        'sourceTextSha256': sha256(source_text.encode('utf-8')).hexdigest(),
        'sourceTextCharacters': len(source_text),
        'sourceTextBytes': len(source_text.encode('utf-8')),
        'renderedTextSha256': sha256(rendered_text.encode('utf-8')).hexdigest(),
        'renderedTextCharacters': len(rendered_text),
        'insertions': dict(sorted(transforms.items())),
        'elementCounts': dict(sorted(element_counts.items())),
        'attributeCounts': dict(sorted(attribute_counts.items())),
        'unclassifiedTags': dict(sorted(unclassified_tags.items())),
        'rootTag': 'caml:Content',
        'tipIns': tip_ins,
    }
