"""Read supplied local PDFs into a separate, private evidence packet; no network."""
import csv
import datetime as dt
import hashlib
import io
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE = Path('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02')
ROOT = Path('C:/Users/firas/Downloads/MATTER-ETL-BATCH-PIPELINE/bundles')
OLD = BASE / 'local-pdf-reuse-v1'
OUT = BASE / 'local-pdf-quarantine-v1'
PINS = {
    OLD / 'bundle-source-inventory.json': '5517e4001325994a9e2e9b4bade743c512572c94aede3f2ffafce0154b1caa5f',
    OLD / 'bounded-local-pdf-occurrences-v2.jsonl': '974b72f7b7a4ec34ec9eeadcea4da9d470452eef2afb757f0d1982c6aedd22bf',
    BASE / 'courtlistener/live-normalized/firm-search-hits.jsonl': '78e5c51dca3ab78dadcff4e0f3dd418632677bdad2e99ea6d2972b866e6e26a3',
}


def sha(raw, algorithm='sha256'):
    return hashlib.new(algorithm, raw).hexdigest()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def contained(file):
    file = Path(file)
    if any(re.fullmatch(r'examples?|golden|fixtures?', part, re.I) for part in file.parts):
        raise ValueError('FIXTURE_PATH_HELD')
    file.resolve(strict=True).relative_to(ROOT.resolve(strict=True))
    return file


def write_jsonl(file, rows):
    with file.open('xb') as fp:
        for row in rows:
            fp.write(compact(row) + b'\n')


def main():
    started = now()
    original = {}
    for file, expected in PINS.items():
        raw = file.read_bytes()
        if sha(raw) != expected:
            raise ValueError('PINNED_INPUT_CHANGED')
        original[file] = raw
    inventory_file, old_file, firm_file = PINS
    inventory = json.loads(original[inventory_file])
    old_rows = [json.loads(line) for line in original[old_file].splitlines()]
    old_ids = {row['source_occurrence_sha256'] for row in old_rows}
    if len(old_rows) != 51 or len(old_ids) != 51:
        raise ValueError('ORIGINAL_51_PACKET_REQUIRED')
    firm_rows = [json.loads(line) for line in original[firm_file].splitlines()]
    if len(firm_rows) != 1810:
        raise ValueError('FROZEN_1810_FIRM_SCOPE_REQUIRED')
    firm = {str(row['native_id']): (ordinal, line, row) for ordinal, (line, row) in enumerate(zip(original[firm_file].splitlines(), firm_rows), 1)}
    records, held, artifacts, excluded = [], [], {}, []
    stats, seen_old, parent_proofs = Counter(), set(), {}

    def artifact(file, raw, kind, count=None):
        key = file.as_uri()
        row = {'source_file_uri': key, 'source_sha256': sha(raw), 'source_bytes': len(raw), 'source_kind': kind}
        if count is not None:
            row['source_record_count'] = count
        artifacts[key] = row

    for file, raw in original.items():
        artifact(file, raw, 'pinned_local_packet_or_inventory', len(raw.splitlines()) if file.suffix == '.jsonl' else None)

    def firm_proof(native_id):
        if native_id in parent_proofs:
            return parent_proofs[native_id]
        ordinal, line, hit = firm[native_id]
        p = hit['provenance']
        u = urlparse(p['source_url'])
        q = parse_qs(u.query)
        if u.scheme != 'https' or u.hostname != 'www.courtlistener.com' or u.path != '/api/rest/v4/search/' or q.get('q') != ['firm:"Seeger Weiss"'] or q.get('type') != ['d'] or p['http_status'] != 200 or p['request_method'] != 'GET':
            raise ValueError('EXACT_FIRM_QUERY_REQUIRED')
        if any(re.search(r'token|signature|api.?key|authorization', k, re.I) for k in q):
            raise ValueError('CREDENTIAL_SOURCE_URL_HELD')
        request_id = sha(('GET ' + p['source_url']).encode('utf-8'))
        capture = BASE / 'courtlistener/api' / (request_id + '.json')
        provenance_file = capture.with_name(request_id + '.provenance.json')
        raw = capture.read_bytes()
        provenance_raw = provenance_file.read_bytes()
        metadata = json.loads(provenance_raw)
        if sha(raw) != p['source_sha256'] or any(metadata.get(k) != p[k] for k in ('source_url', 'retrieved_at', 'http_status', 'source_sha256', 'request_method')):
            raise ValueError('ORIGINAL_FIRM_CAPTURE_MISMATCH')
        if sha(compact(hit['data'])) != p['record_sha256'] or str(hit['data']['docket_id']) != native_id:
            raise ValueError('FIRM_RECORD_HASH_OR_NATIVE_PARENT_MISMATCH')
        matches = [(i, result) for i, result in enumerate(json.loads(raw)['results'], 1) if str(result.get('docket_id')) == native_id and result == hit['data']]
        if len(matches) != 1:
            raise ValueError('EXACT_FIRM_NATIVE_RESULT_REQUIRED')
        artifact(capture, raw, 'original_http_firm_search_json', len(json.loads(raw)['results']))
        artifact(provenance_file, provenance_raw, 'original_http_capture_provenance')
        proof = {
            'native_docket_id': native_id, 'association_basis': 'exact_native_id_in_frozen_firm_query_search_result_only',
            'publisher_document_parent_association_verified': False,
            'source_url': p['source_url'], 'retrieved_at': p['retrieved_at'], 'http_status': 200, 'request_method': 'GET',
            'response_sha256': p['source_sha256'], 'record_sha256': p['record_sha256'],
            'record_sha256_codec': 'original-insertion-order-compact-utf8-json/1',
            'original_capture_file_uri': capture.as_uri(), 'original_capture_bytes': len(raw),
            'original_capture_result_ordinal': matches[0][0],
            'original_capture_provenance_file_uri': provenance_file.as_uri(), 'original_capture_provenance_sha256': sha(provenance_raw),
            'firm_scope_file_uri': firm_file.as_uri(), 'firm_scope_file_sha256': PINS[firm_file],
            'firm_scope_record_ordinal': ordinal, 'firm_scope_original_line_sha256': sha(line),
        }
        parent_proofs[native_id] = proof
        return proof

    for bundle in inventory:
        directory = contained(bundle['bundle'])
        manifest_file, csv_file = directory / 'manifest.json', directory / 'docket.csv'
        manifest_raw, csv_raw = manifest_file.read_bytes(), csv_file.read_bytes()
        if sha(manifest_raw) != bundle['manifest_sha256'] or sha(csv_raw) != bundle['docket_csv_sha256']:
            raise ValueError('PINNED_BUNDLE_METADATA_CHANGED')
        manifest = json.loads(manifest_raw)
        csv_rows = list(csv.DictReader(io.StringIO(csv_raw.decode('utf-8-sig'), newline='')))
        artifact(manifest_file, manifest_raw, 'local_bundle_manifest_json')
        artifact(csv_file, csv_raw, 'local_bundle_docket_csv', len(csv_rows))
        parents = {}
        for i, docket in enumerate(manifest['dockets'], 1):
            source = docket['source']
            if source in parents:
                raise ValueError('AMBIGUOUS_MANIFEST_DOCKET_SOURCE')
            parents[source] = (str(docket.get('courtlistener_docket_id')), i)
        files = {}
        for i, item in enumerate(manifest['files'], 1):
            filename = item['file_name']
            if filename in files:
                raise ValueError('AMBIGUOUS_MANIFEST_FILENAME')
            files[filename] = (item, i)
        for ordinal, csv_row in enumerate(csv_rows, 2):
            filename = csv_row.get('file_name', '')
            source = csv_row.get('docket_source', '')
            parent = parents.get(source)
            if not filename:
                stats['csv_row_no_explicit_local_file'] += 1
                continue
            if not parent or parent[0] not in firm:
                stats['excluded_nonfirm_or_unmapped_parent'] += 1
                continue
            stats['firm_parent_source_occurrences'] += 1
            claim, file_ordinal = files.get(filename, (None, None))
            evidence = {
                'bundle_manifest_file': str(manifest_file), 'bundle_manifest_sha256': sha(manifest_raw),
                'docket_csv_file': str(csv_file), 'docket_csv_sha256': sha(csv_raw),
                'csv_ordinal': ordinal, 'explicit_file_name': filename, 'courtlistener_docket_id': parent[0],
                'literal_recap_pdf_url': csv_row.get('recap_pdf_url', ''),
                'source_parent_field': 'manifest.dockets[source=' + source + '].courtlistener_docket_id',
                'csv_record_id_literal': csv_row.get('record_id', ''), 'csv_sha256_claim': csv_row.get('sha256', ''),
                'csv_bytes_claim': csv_row.get('size_bytes', ''), 'manifest_bytes_claim': claim.get('size_bytes') if claim else None,
                'source_availability_literal': csv_row.get('availability', ''), 'source_is_sealed_literal': csv_row.get('is_sealed', ''),
            }
            occurrence_sha = sha(compact(evidence))
            if occurrence_sha in old_ids:
                seen_old.add(occurrence_sha)
                excluded.append({'source_occurrence_sha256': occurrence_sha, 'reason': 'exact_occurrence_already_in_original_51_packet', 'original_packet_sha256': PINS[old_file]})
                continue
            reason = None
            actual_sha256 = actual_sha1 = None
            actual_bytes = 0
            pdf = directory / filename
            try:
                if Path(filename).name != filename or pdf.parent != directory or not claim:
                    raise ValueError('EXPLICIT_MANIFEST_FILE_REQUIRED')
                contained(pdf)
                raw = pdf.read_bytes()
                actual_bytes, actual_sha256, actual_sha1 = len(raw), sha(raw), sha(raw, 'sha1')
                if not raw.startswith(b'%PDF-'):
                    raise ValueError('PDF_MAGIC_MISMATCH')
                if csv_row.get('sha256') != actual_sha256:
                    raise ValueError('CSV_HASH_CONTRADICTS_LOCAL_BODY')
                if int(csv_row.get('size_bytes', '')) != actual_bytes or int(claim['size_bytes']) != actual_bytes:
                    raise ValueError('SOURCE_BYTES_CONTRADICT_LOCAL_BODY')
                if csv_row.get('recap_pdf_url', '') != '':
                    raise ValueError('UNEXPECTED_REMAINING_LOCATOR_HELD')
                proof = firm_proof(parent[0])
            except (OSError, ValueError, KeyError, TypeError) as error:
                reason = str(error) if re.fullmatch(r'[A-Z_]+', str(error)) else type(error).__name__
            if reason:
                held.append({'source_occurrence_sha256': occurrence_sha, 'source_evidence': evidence, 'reason': reason, 'private_only': True, 'transfer_allowed': False})
                stats['held_' + reason] += 1
                continue
            seal_literal = csv_row.get('is_sealed', '')
            seal_status = 'locally_flagged_sealed' if seal_literal == 'true' else 'unknown_local_blank' if seal_literal == '' else 'unknown_local_literal'
            record = {
                'schema_version': 'local-bundle-quarantined-pdf-occurrence/1', 'provider': 'local-matter-bundle',
                'source_occurrence_sha256': occurrence_sha, 'source_occurrence_sha256_codec': 'original-insertion-order-compact-utf8-json/1',
                'native_document_id': None, 'native_case_id': None, 'native_backend_document_id': None,
                'native_backend_identity_asserted': False, 'publisher_native_entity': False, 'publisher_parent_association_verified': False,
                'local_path': str(pdf), 'local_file_uri': pdf.as_uri(), 'actual_sha256': actual_sha256, 'actual_sha1': actual_sha1, 'actual_bytes': actual_bytes,
                'local_binary_sha_verified': True, 'pdf_magic_verified': True,
                'csv_sha256_claim_matches_actual': True, 'csv_bytes_claim_matches_actual': True, 'manifest_bytes_claim_matches_actual': True,
                'literal_recap_pdf_url': None, 'publisher_sealing_asserted': False, 'source_seal_status': seal_status,
                'local_sealed_claim': seal_literal == 'true', 'private_only': True, 'private_quarantine_required': True,
                'public_projection_allowed': False, 'calculation_activation_allowed': False, 'legal_authority_or_outcome_verified': False,
                'network_download_performed': False, 'cloud_body_hash_verified': False, 'transfer_authorization_pending': True,
                'source_evidence': evidence, 'source_csv_original_record_sha256': sha(compact(csv_row)),
                'source_csv_original_record_sha256_codec': 'original-field-order-string-csv-row-compact-utf8-json/1',
                'source_manifest_file_record_ordinal': file_ordinal, 'source_manifest_docket_record_ordinal': parent[1],
                'firm_scope_source_sha256': PINS[firm_file], 'firm_query_parent_evidence': proof,
                'local_verified_at': now(), 'local_verified_at_basis': 'local_full_file_read_not_publisher_or_HTTP_capture',
                'source_http_retrieved_at': None, 'source_http_status': None,
                'local_document_metadata': {k: csv_row.get(k, '') for k in ('record_id', 'docket_source', 'entry_number', 'entry_label', 'attachment_number', 'filed_date', 'description', 'document_title', 'doc_type', 'availability', 'page_count')},
                'source_inventory_sha256': PINS[inventory_file], 'original_51_packet_sha256': PINS[old_file],
            }
            records.append(record)
            stats['prepared_source_occurrences'] += 1
            stats['seal_status_' + seal_status] += 1
    if seen_old != old_ids:
        raise ValueError('ORIGINAL_51_SUBTRACTION_INCOMPLETE')
    if len({r['source_occurrence_sha256'] for r in records}) != len(records):
        raise ValueError('DUPLICATE_SOURCE_OCCURRENCE_IDENTITY')
    # Exclusive creation makes all prior source packets and reviews immutable.
    OUT.mkdir(exist_ok=False)
    packet = OUT / 'local-quarantined-pdf-occurrences-v1.jsonl'
    artifact_file = OUT / 'source-artifact-manifest-v1.jsonl'
    held_file = OUT / 'held-source-occurrences-v1.jsonl'
    excluded_file = OUT / 'excluded-original-51-occurrences-v1.jsonl'
    write_jsonl(packet, records)
    write_jsonl(artifact_file, list(artifacts.values()))
    write_jsonl(held_file, held)
    write_jsonl(excluded_file, excluded)
    unique = {r['actual_sha256']: r['actual_bytes'] for r in records}
    receipt = {
        'schema_version': 'local-bundle-quarantine-preparation-receipt/1', 'started_at': started, 'finished_at': now(),
        'source_unit': 'local supplied PDF file occurrences; no publisher-native document identity',
        'prepared_occurrences': len(records), 'unique_actual_pdf_sha256': len(unique),
        'actual_occurrence_bytes_hashed': sum(r['actual_bytes'] for r in records), 'unique_actual_pdf_bytes': sum(unique.values()),
        'max_actual_pdf_bytes': max(unique.values(), default=0), 'firm_query_native_parents': len(parent_proofs),
        'source_artifacts': len(artifacts), 'held_occurrences': len(held), 'exact_original_51_excluded': len(excluded), 'stats': dict(stats),
        'packet_file_uri': packet.as_uri(), 'packet_sha256': sha(packet.read_bytes()),
        'source_artifact_manifest_sha256': sha(artifact_file.read_bytes()), 'held_ledger_sha256': sha(held_file.read_bytes()),
        'excluded_51_ledger_sha256': sha(excluded_file.read_bytes()), 'pinned_inputs': {file.as_uri(): expected for file, expected in PINS.items()},
        'all_private_quarantine': True, 'all_publisher_backend_document_ids_null': True,
        'network_calls': 0, 'pdf_downloads': 0, 'uploads': 0, 'database_writes': 0, 'local_files_deleted': 0,
        'independent_review_required': True,
    }
    with (OUT / 'preparation-receipt-v1.json').open('xb') as fp:
        fp.write(json.dumps(receipt, ensure_ascii=False, indent=2).encode('utf-8') + b'\n')
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
