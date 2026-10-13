"""Strict streaming official ZIP parser. No network, credentials or database access."""
import argparse
import datetime as dt
import io
import json
import re
import zipfile
from collections import defaultdict

RECALL_FIELDS = 'RECORD_ID CAMPNO MAKETXT MODELTXT YEARTXT MFGCAMPNO COMPNAME MFGNAME BGMAN ENDMAN RCLTYPECD POTAFF ODATE INFLUENCED_BY MFGTXT RCDATE DATEA RPNO FMVSS DESC_DEFECT CONEQUENCE_DEFECT CORRECTIVE_ACTION NOTES RCL_CMPT_ID MFR_COMP_NAME MFR_COMP_DESC MFR_COMP_PTNO DO_NOT_DRIVE PARK_OUTSIDE'.split()
INV_FIELDS = ['NHTSA ACTION NUMBER', 'MAKE', 'MODEL', 'YEAR', 'COMPNAME', 'MFR_NAME', 'ODATE', 'CDATE', 'CAMPNO', 'SUBJECT', 'SUMMARY']


def day(value):
    if not value or value in ('00000000', '99999999'):
        return None
    if not re.fullmatch(r'\d{8}', value):
        raise ValueError('NHTSA_DATE_INVALID')
    return dt.datetime.strptime(value, '%Y%m%d').date().isoformat()


def parse_bulk(filename, source, start, through, maximum=1500):
    dt.date.fromisoformat(start)
    dt.date.fromisoformat(through)
    recall = source == 'nhtsa_recalls'
    if source not in ('nhtsa_recalls', 'nhtsa_investigations'):
        raise ValueError('NHTSA_SOURCE_INVALID')
    member = 'FLAT_RCL_POST_2010.txt' if recall else 'FLAT_INV.txt'
    names = RECALL_FIELDS if recall else INV_FIELDS
    groups = defaultdict(int)
    selected = set()
    total_rows = 0
    with zipfile.ZipFile(filename) as archive:
        entries = archive.infolist()
        if len(entries) != 1 or entries[0].filename != member or entries[0].flag_bits & 1:
            raise ValueError('NHTSA_ZIP_MEMBERS_INVALID')
        if not 0 < entries[0].file_size <= 512 * 1024 * 1024:
            raise ValueError('NHTSA_ZIP_SIZE_INVALID')

        def rows():
            # Preserve embedded Unicode line separators. The official delimiter is TAB and LF/CRLF.
            with io.TextIOWrapper(archive.open(member), encoding='utf-8', errors='strict', newline='') as stream:
                for line in stream:
                    cells = line.rstrip('\r\n').split('\t')
                    if len(cells) != len(names):
                        raise ValueError('NHTSA_COLUMN_COUNT_CHANGED')
                    native = cells[1] if recall else cells[0]
                    # Publisher history includes 21V00H000 and older C89001/EA78A17 IDs.
                    # Preserve the exact identifier, not a guessed modern numeric grammar.
                    if not re.fullmatch(r'[A-Z0-9]{1,12}' if recall else r'[A-Z0-9]{1,10}', native):
                        raise ValueError('NHTSA_NATIVE_ID_INVALID')
                    if recall and not cells[0].isdigit():
                        raise ValueError('NHTSA_RECORD_ID_INVALID')
                    yield native, cells

        for native, cells in rows():
            total_rows += 1
            groups[native] += 1
            dates = (cells[15], cells[16]) if recall else (cells[6], cells[7])
            if any(value and start.replace('-', '') <= value <= through.replace('-', '') for value in dates):
                selected.add(native)
        if total_rows == 0:
            raise ValueError('NHTSA_BULK_EMPTY')
        if len(selected) > maximum:
            raise ValueError('SOURCE_RECORD_CAP')
        retained = defaultdict(list)
        for native, cells in rows():
            if native in selected:
                retained[native].append(cells)
    results = []
    for native in sorted(selected):
        values = sorted(retained[native], key=lambda r: (int(r[0]), r) if recall else tuple(r))
        if len(values) != groups[native]:
            raise ValueError('NHTSA_GROUP_INCOMPLETE')
        if recall and len({r[0] for r in values}) != len(values):
            raise ValueError('NHTSA_DUPLICATE_RECORD_ID')
        if not recall and len({tuple(r) for r in values}) != len(values):
            raise ValueError('NHTSA_DUPLICATE_ASSOCIATION')
        published = [day(r[15] if recall else r[6]) for r in values]
        published = [value for value in published if value]
        first = values[0]
        summary = first[19] if recall else first[10]
        fields = {
            'publisher_field_names': names,
            'publisher_rows': values,
            'association_count': len(values),
            'date_basis': 'Part 573 report received or association creation date' if recall else 'Investigation opening or closing date',
            'qualification': 'Post-2010 official recall bulk; full campaign associations retained. Counts are campaigns, not injuries or affected people.' if recall else 'Official investigation bulk; all associations retained. Opening an investigation does not establish a defect or causation.',
        }
        record = {
            'native_id': native,
            'title': (f'{native}: {first[7]} — {summary}' if recall else f'{native}: {first[9]}')[:1900],
            'document_type': 'vehicle_recall_campaign' if recall else 'vehicle_investigation',
            'published_on': min(published) if published else None,
            'source_updated_on': None,
            'source_url': f'https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber={native}' if recall else 'https://static.nhtsa.gov/odi/ffdd/inv/FLAT_INV.zip',
            'agency_ids': ['nhtsa'],
            'agency_names': ['National Highway Traffic Safety Administration'],
            'entity_refs': [],
            'identifiers': [native],
            'status': None,
            'fields': fields,
            'correction_of': [],
            'evidence_excerpt': summary[:1800],
        }
        if len(json.dumps(record, ensure_ascii=False).encode('utf-8')) > 1000000:
            raise ValueError('NHTSA_NATIVE_GROUP_TOO_LARGE')
        results.append(record)
    return {'records': results, 'total_source_rows': total_rows, 'total_source_native_groups': len(groups), 'selected_native_groups': len(results), 'member': member, 'uncompressed_bytes': entries[0].file_size}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--from', dest='start', required=True)
    parser.add_argument('--through', required=True)
    parser.add_argument('--maximum', type=int, default=1500)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = parse_bulk(args.input, args.source, args.start, args.through, args.maximum)
    with open(args.output, 'w', encoding='utf-8', newline='\n') as destination:
        json.dump(result, destination, ensure_ascii=False)
