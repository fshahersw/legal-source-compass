"""Eyecite on retained text; offsets always reference Unicode code points.

No text cleaning occurs before extraction. No citation is resolved without a
separate exact native-ID index. Short references and ambiguous reporters remain
visible in the extraction ledger instead of producing guessed graph edges.
"""
import argparse
import hashlib
import importlib.metadata
import json
import pathlib
import sqlite3
import sys

def extract(record):
    from eyecite import get_citations
    text = record.get('attributes', {}).get('text')
    if not isinstance(text, str) or not text:
        return []
    text_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()
    result = []
    for citation in get_citations(text, remove_ambiguous=False):
        start, end = citation.span()
        raw = text[start:end]
        result.append(dict(source_record={k: record[k] for k in ('id', 'type', 'id_authority', 'version')}, source_url=record['source_url'],
                           date=record['date'], raw=raw, normalized=citation.corrected_citation(), evidence=dict(start=start, end=end),
                           extraction_method='eyecite', parser_version=importlib.metadata.version('eyecite'), source_text_sha256=text_hash,
                           parser_class=type(citation).__name__, groups=citation.groups, resolved_record=None))
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--deps', required=True)
    parser.add_argument('--stage')
    parser.add_argument('--packet')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    sys.path.insert(0, args.deps)
    def records():
        if args.stage:
            db = sqlite3.connect(f'file:{pathlib.Path(args.stage).as_posix()}?mode=ro', uri=True)
            for row in db.execute('select payload from records order by record_key'):
                yield json.loads(row[0])
            db.close()
        if args.packet:
            yield from json.loads(pathlib.Path(args.packet).read_text(encoding='utf-8'))['records']
    count = documents = 0
    with open(args.output, 'x', encoding='utf-8') as output:
        for record in records():
            rows = extract(record)
            if rows:
                documents += 1
            for row in rows:
                output.write(json.dumps(row, ensure_ascii=False) + '\n')
                count += 1
    print(json.dumps(dict(documents_with_citations=documents, citation_spans=count, resolved=0, parser_version=importlib.metadata.version('eyecite'), complete=False)))

if __name__ == '__main__':
    main()
