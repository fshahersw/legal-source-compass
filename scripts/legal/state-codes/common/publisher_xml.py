"""Deterministic publisher XML rendering without external entity resolution."""
import re
import xml.etree.ElementTree as ET

BLOCKS = {'p','para','paragraph','section','div','li','table','tr','td','br','h1','h2','h3','h4'}

def xml_plain_text(xml_bytes: bytes) -> str:
    if len(xml_bytes) > 32 * 1024 * 1024:
        raise ValueError('Publisher XML exceeds extraction bounds')
    lowered = xml_bytes.lower()
    if b'<!doctype' in lowered or b'<!entity' in lowered or b'\x00' in xml_bytes:
        raise ValueError('Publisher XML contains an unsupported document type/entity/encoding')
    root = ET.fromstring(xml_bytes)
    pieces = []
    def walk(node):
        block = node.tag.rsplit('}',1)[-1].lower() in BLOCKS
        if block: pieces.append('\n')
        if node.text: pieces.append(node.text)
        for child in node:
            walk(child)
            if child.tail: pieces.append(child.tail)
        if block: pieces.append('\n')
    walk(root)
    return re.sub(r'\s+', ' ', ''.join(pieces)).strip()
