"""Offline snapshot: source-version PDF coverage, never full court completeness."""
import csv
import datetime as dt
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

BASE = Path('C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02')
REPO = Path('C:/Users/firas/OneDrive/Documents/ChatGPT/corpusss/compass')
FIRM_SHA = '78e5c51dca3ab78dadcff4e0f3dd418632677bdad2e99ea6d2972b866e6e26a3'
QUEUES = [
    ('main-docketbird', 'pdf-library-v1/docketbird-queue-v2.jsonl', 'pdf-library-v1/transfers'),
    ('tail-docketbird', 'pdf-library-tail-v1/docketbird-tail-queue-v1.jsonl', 'pdf-library-tail-v1/transfers'),
    ('gap-docketbird', 'pdf-library-gap-retry-v1/docketbird-gap-retry-queue-v1.jsonl', 'pdf-library-gap-retry-v1/transfers'),
    ('recent-docketbird', 'docketbird/recent-expansion-v1/prepared-follow-on-v1/docketbird-recent-pdf-queue-v1.jsonl', 'pdf-library-recent-v1/transfers'),
    ('native-courtlistener', 'pdf-library-v1/courtlistener-queue-v1.jsonl', 'pdf-library-v1/courtlistener-transfers'),
    ('public-courtlistener', 'firecrawl-dockets/pagination-v1/reviewed-v1/courtlistener-public-locator-queue-v1.jsonl', 'pdf-library-public-locator-v1/transfers'),
    ('official-courts', 'pdf-library-v1/official-court-queue-v1.jsonl', 'pdf-library-v1/official-court-transfers'),
]


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def version(row, origin_field='origins'):
    selected = row.get('selected_source_record_sha256')
    origins = row.get(origin_field, [])
    if not selected and origins:
        selected = sorted(origins, key=lambda x: x.get('retrieved_at', ''), reverse=True)[0].get('native_record_sha256')
    retrieved = max((x.get('retrieved_at', '') for x in origins if x.get('native_record_sha256') == selected), default='')
    return selected, retrieved


def rows(file):
    with file.open('rb') as fp:
        for ordinal, line in enumerate(fp, 1):
            if line.strip():
                yield ordinal, line, json.loads(line)


def markdown(value):
    return str(value).replace('|', '\\|').replace('\n', ' ').replace('\r', ' ')


def main():
    started = now()
    out = BASE / 'coverage-snapshots' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out.mkdir(parents=True, exist_ok=False)
    sources, captions, references, scope_tags = [], {}, defaultdict(set), defaultdict(set)
    firm_file = BASE / 'courtlistener/live-normalized/firm-search-hits.jsonl'
    firm_raw = firm_file.read_bytes()
    if sha(firm_raw) != FIRM_SHA:
        raise ValueError('FROZEN_FIRM_INDEX_CHANGED')
    sources.append({'kind': 'frozen_firm_index', 'file_uri': firm_file.as_uri(), 'sha256': FIRM_SHA, 'bytes': len(firm_raw)})
    for ordinal, line, row in rows(firm_file):
        data = row['data']
        captions[str(row['native_id'])] = {'caption': data.get('caseName') or data.get('case_name_full') or 'Not recorded', 'court_id': data.get('court_id'), 'docket_number': data.get('docketNumber'), 'source_record_sha256': row['provenance']['record_sha256'], 'caption_source': 'CourtListener exact native firm-query record', 'source_file_uri': firm_file.as_uri(), 'source_record_ordinal': ordinal, 'source_original_line_sha256': sha(line.rstrip(b'\r\n'))}
    header = BASE / 'courtlistener/live-normalized/dockets.jsonl'
    if header.exists():
        sources.append({'kind': 'native_courtlistener_headers', 'file_uri': header.as_uri(), 'sha256': sha(header.read_bytes())})
        for ordinal, line, row in rows(header):
            data = row['data']
            if not str(row['native_id']) in captions:
                captions[str(row['native_id'])] = {'caption': data.get('case_name') or data.get('case_name_full') or 'Not recorded', 'court_id': data.get('court'), 'docket_number': data.get('docket_number'), 'source_record_sha256': row['provenance']['record_sha256'], 'caption_source': 'CourtListener exact native docket header', 'source_file_uri': header.as_uri(), 'source_record_ordinal': ordinal, 'source_original_line_sha256': sha(line.rstrip(b'\r\n'))}

    # These are caption references only. Provider identities are never merged.
    search_refs = BASE / 'docketbird/recent-expansion-v1/prepared-follow-on-v1/private-search-reference-observations.jsonl'
    for _, _, row in rows(search_refs):
        data = row['data']
        if data.get('definitive_association_allowed') is True:
            for native_case in data.get('provider_case_ids', []):
                references[str(native_case)].add(str(data['native_courtlistener_docket_id']))
    sources.append({'kind': 'qualified_recent_caption_references', 'file_uri': search_refs.as_uri(), 'sha256': sha(search_refs.read_bytes())})

    current, versions_seen, queue_sources = {}, defaultdict(set), defaultdict(set)
    for batch, relative, transfer in QUEUES:
        file = BASE / relative
        hasher, total = hashlib.sha256(), 0
        for ordinal, line, row in rows(file):
            hasher.update(line)
            total += 1
            source_version, selected_at = version(row)
            if not re.fullmatch(r'[a-f0-9]{64}', source_version or ''):
                raise ValueError('SELECTED_SOURCE_VERSION_REQUIRED')
            identity = (row['provider'], str(row['native_document_id']))
            parent = None if row.get('native_case_id') is None else str(row['native_case_id'])
            record = {'provider': row['provider'], 'native_document_id': str(row['native_document_id']), 'native_case_id': parent, 'selected_source_record_sha256': source_version, 'selected_source_observed_at': selected_at, 'eligible': row.get('eligible') is True, 'held_reason': row.get('held_reason'), 'queue_batch': batch, 'queue_file_uri': file.as_uri(), 'queue_record_ordinal': ordinal, 'queue_original_line_sha256': sha(line.rstrip(b'\r\n'))}
            versions_seen[identity].add(source_version)
            queue_sources[identity].add(batch)
            if identity not in current or selected_at > current[identity]['selected_source_observed_at']:
                current[identity] = record
            elif parent != current[identity]['native_case_id']:
                raise ValueError('NATIVE_PARENT_CONTRADICTION')
            if row['provider'] == 'docketbird':
                for evidence in row.get('scope_evidence', []):
                    if evidence.get('kind') == 'exact_native_docket_reference' and evidence.get('courtlistener_docket_id'):
                        references[parent].add(str(evidence['courtlistener_docket_id']))
            elif row['provider'] == 'official-court':
                scope = row.get('source_claims', {}).get('matter_scope')
                if scope:
                    scope_tags[(row['provider'], parent)].add(scope)
        sources.append({'kind': 'frozen_pdf_queue', 'batch': batch, 'file_uri': file.as_uri(), 'sha256': hasher.hexdigest(), 'records': total})

    verified, latest_failed, receipt_sources = {}, {}, []
    for _, _, transfer in QUEUES:
        file = BASE / transfer / 'transfer-receipts.jsonl'
        hasher, consumed, complete_lines, incomplete_lines = hashlib.sha256(), 0, 0, 0
        with file.open('rb') as fp:
            for ordinal, line in enumerate(fp, 1):
                if not line.endswith(b'\n'):
                    incomplete_lines += 1
                    continue
                hasher.update(line)
                consumed += len(line)
                complete_lines += 1
                row = json.loads(line)
                identity = (row.get('provider'), str(row.get('native_document_id')))
                target = current.get(identity)
                if not target:
                    continue
                selected, _ = version(row, 'source_origins')
                if selected != target['selected_source_record_sha256'] or str(row.get('native_case_id')) != str(target['native_case_id']):
                    continue
                if row.get('state') == 'failed':
                    latest_failed[identity] = {'error': row.get('error'), 'recorded_at': row.get('recorded_at')}
                if row.get('state') != 'cloud_verified':
                    continue
                if row.get('project_id') != 'xosqzzsnhxcyehcnirpa' or row.get('bucket') != 'corpus-originals' or not re.fullmatch(r'[a-f0-9]{64}', row.get('sha256') or '') or row.get('storage_key') != 'seeger-weiss/pdf-sha256/' + row['sha256'][:2] + '/' + row['sha256'] + '.pdf' or not isinstance(row.get('bytes'), int) or row['bytes'] < 1:
                    raise ValueError('INVALID_CLOUD_VERIFIED_RECEIPT')
                verified[identity] = {'pdf_sha256': row['sha256'], 'bytes': row['bytes'], 'verified_at': row.get('recorded_at'), 'receipt_file_uri': file.as_uri(), 'receipt_record_ordinal': ordinal, 'receipt_original_line_sha256': sha(line.rstrip(b'\r\n'))}
        receipt_sources.append({'kind': 'live_receipt_complete_prefix', 'file_uri': file.as_uri(), 'prefix_sha256': hasher.hexdigest(), 'prefix_bytes': consumed, 'complete_lines': complete_lines, 'incomplete_lines_excluded': incomplete_lines, 'read_finished_at': now()})

    metadata = {}
    for relative in ['docketbird/private-evidence-v1/private-source-qualified-coverage.jsonl', 'docketbird/private-evidence-tail-v1/private-source-qualified-coverage.jsonl', 'docketbird/recent-expansion-v1/prepared-follow-on-v1/private-source-qualified-coverage.jsonl']:
        file = BASE / relative
        sources.append({'kind': 'provider_metadata_coverage', 'file_uri': file.as_uri(), 'sha256': sha(file.read_bytes())})
        for ordinal, _, row in rows(file):
            metadata[str(row['native_case_id'])] = {'known_document_metadata': row.get('unique_document_metadata'), 'provider_reported_total': row.get('provider_total'), 'provider_snapshot_complete': row.get('complete') is True, 'provider_totals_consistent': row.get('provider_totals_consistent'), 'missing_provider_metadata': row.get('missing_metadata'), 'source_file_uri': file.as_uri(), 'source_record_ordinal': ordinal, 'unit': 'provider snapshot; not full court docket completeness'}

    groups = {}
    for identity, row in current.items():
        key = (row['provider'], row['native_case_id'])
        if key not in groups:
            groups[key] = {'provider': key[0], 'native_case_id': key[1], 'case_name': 'Not recorded', 'case_label_provenance': None, 'referenced_courtlistener_native_ids': [], 'known_queued_document_identities': 0, 'eligible_known_pdf_identities': 0, 'held_pdf_identities': 0, 'cloud_verified_selected_source_version': 0, 'pending_eligible_known_pdf_identities': 0, 'selected_source_failures': 0, 'latest_verified_at': None, 'pdf_coverage_percent': None, 'held_reasons': Counter(), 'queue_batches': set(), 'publisher_native_cross_provider_merge_allowed': False, 'current_firm_participation_verified': False, 'full_court_docket_completeness_asserted': False}
        group = groups[key]
        group['known_queued_document_identities'] += 1
        group['eligible_known_pdf_identities'] += int(row['eligible'])
        group['held_pdf_identities'] += int(not row['eligible'])
        if not row['eligible']:
            group['held_reasons'][str(row['held_reason'])] += 1
        if row['eligible'] and identity in verified:
            group['cloud_verified_selected_source_version'] += 1
            group['latest_verified_at'] = max(group['latest_verified_at'] or '', verified[identity]['verified_at'] or '')
        elif row['eligible']:
            group['pending_eligible_known_pdf_identities'] += 1
            group['selected_source_failures'] += int(identity in latest_failed)
        group['queue_batches'].update(queue_sources[identity])
    for key, group in groups.items():
        provider, native_case = key
        ids = [native_case] if provider in ('courtlistener', 'courtlistener-public-locator') else sorted(references.get(native_case, set())) if provider == 'docketbird' else []
        labels = [(native_id, captions[native_id]) for native_id in ids if native_id in captions]
        if len(labels) == 1:
            native_id, label = labels[0]
            group['case_name'] = label['caption']
            group['case_label_provenance'] = label
            if provider == 'docketbird':
                group['case_label_provenance'] = {**label, 'qualification': 'caption displayed via exact source-qualified reference only; provider identities remain separate'}
        group['referenced_courtlistener_native_ids'] = ids if provider == 'docketbird' else []
        group['source_scope_labels'] = sorted(scope_tags.get(key, set()))
        group['metadata_coverage'] = metadata.get(native_case) if provider == 'docketbird' else None
        group['held_reasons'] = dict(group['held_reasons'])
        group['queue_batches'] = sorted(group['queue_batches'])
        denominator = group['eligible_known_pdf_identities']
        group['pdf_coverage_percent'] = round(100 * group['cloud_verified_selected_source_version'] / denominator, 2) if denominator else None
    full = sorted(groups.values(), key=lambda x: (x['provider'], str(x['native_case_id'])))
    provider_summary = []
    for provider in sorted({row['provider'] for row in full}):
        group = [row for row in full if row['provider'] == provider]
        summary = {'provider': provider, 'native_case_groups': len(group)}
        for field in ('known_queued_document_identities', 'eligible_known_pdf_identities', 'held_pdf_identities', 'cloud_verified_selected_source_version', 'pending_eligible_known_pdf_identities', 'selected_source_failures'):
            summary[field] = sum(x[field] for x in group)
        summary['pdf_coverage_percent'] = round(100 * summary['cloud_verified_selected_source_version'] / summary['eligible_known_pdf_identities'], 3) if summary['eligible_known_pdf_identities'] else None
        provider_summary.append(summary)
    major = sorted([row for row in full if row['provider'] == 'docketbird' and row['case_name'] != 'Not recorded' and '-md-' in str(row['native_case_id'])], key=lambda x: x['eligible_known_pdf_identities'], reverse=True)[:15]
    if len(major) < 15:
        seen = {(x['provider'], x['native_case_id']) for x in major}
        extra = sorted([x for x in full if x['provider'] == 'docketbird' and x['case_name'] != 'Not recorded' and (x['provider'], x['native_case_id']) not in seen], key=lambda x: x['eligible_known_pdf_identities'], reverse=True)
        major += extra[:15-len(major)]
    result = {'schema_version': 'seeger-weiss-source-version-coverage-snapshot/1', 'started_at': started, 'finished_at': now(), 'scope_statement': 'PDF coverage of eligible known frozen-queue identities at their selected source versions; excludes held links; never full court docket completeness or current firm roster', 'firm_index': {'captured_native_docket_ids': 1810, 'indexed_provider_results_captured_percent': 100, 'firm_portfolio_exhaustive': False}, 'target_509_parent_verified_metadata_snapshot': {'complete_prior': 96, 'complete_recent': 343, 'complete_total': 439, 'target_total': 509, 'complete_percent': round(100*439/509,2), 'partial_or_missing': 53, 'unresolved': 17, 'recent_targets':345, 'qualification': 'Parent-verified frozen runtime totals; provider documentmetadata snapshots, not entire court dockets'}, 'parent_database_snapshot': {'as_of_utc': '2026-10-02T16:16:29.982293Z', 'document_entities':74276,'unique_verified_pdfs':31869,'verified_pdf_bytes':19157638383,'qualification':'Parent supplied independently verified DB snapshot; report makes no DB requests; ongoing work increases these totals'}, 'provider_pdf_coverage': provider_summary, 'top_15_major_matter_dockets': major, 'all_native_case_rows': full, 'source_files': sources, 'receipt_prefixes': receipt_sources, 'superseded_queued_source_versions': sum(len(v)-1 for v in versions_seen.values()), 'network_requests':0,'database_requests':0,'downloads':0,'deletions':0}
    (out/'coverage-snapshot.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    columns=['provider','native_case_id','case_name','known_queued_document_identities','eligible_known_pdf_identities','held_pdf_identities','cloud_verified_selected_source_version','pending_eligible_known_pdf_identities','pdf_coverage_percent','selected_source_failures','latest_verified_at','referenced_courtlistener_native_ids','metadata_coverage']
    with (out/'full-native-case-coverage.csv').open('w',encoding='utf-8-sig',newline='') as fp:
        writer=csv.DictWriter(fp,fieldnames=columns);writer.writeheader()
        for row in full:writer.writerow({k:json.dumps(row[k],ensure_ascii=False) if isinstance(row[k],(list,dict)) else row[k] for k in columns})
    lines=['# Seeger Weiss backfill coverage — October 2, 2026','', 'Snapshot: **'+result['finished_at']+'**. Transfers and registration continue.','', '**439 of 509 targeted provider metadata snapshots are complete (86.25%)**: 96 prior plus 343 recent. Another 53 are partial/missing and 17 remain unresolved. The recent run targeted 345 scopes; 343 reached a complete provider document-metadata snapshot. The 1,810-result CourtListener firm-query index was fully captured; this does not establish the entire firm portfolio or a current counsel roster.','', 'PDF percentages below divide durable, fully read-back verified documents at the selected source version by eligible known PDF identities in the frozen queues. Held, restricted, missing-locator, and unavailable records remain separate. Cross-provider IDs and duplicate PDF bodies are not merged.','', '| Provider | Eligible known PDFs | Verified | Held | PDF coverage |','|---|---:|---:|---:|---:|']
    for row in provider_summary:lines.append('| '+row['provider']+' | '+str(row['eligible_known_pdf_identities'])+' | '+str(row['cloud_verified_selected_source_version'])+' | '+str(row['held_pdf_identities'])+' | '+str(row['pdf_coverage_percent'])+'% |')
    lines += ['', '## Major matters and master dockets', '', 'These are exact docket rows, with CourtListener captions displayed through qualified references where needed. A caption reference does not merge provider identities or assert active firm representation.','', '| Matter / source caption | Provider-native docket | Verified / eligible PDFs | Coverage | Provider metadata snapshot |','|---|---|---:|---:|---|']
    for row in major:
        meta=row['metadata_coverage'];label='Complete' if meta and meta['provider_snapshot_complete'] else 'Partial' if meta else 'Not recorded'
        lines.append('| '+markdown(row['case_name'])+' | '+markdown(row['native_case_id'])+' | '+str(row['cloud_verified_selected_source_version'])+' / '+str(row['eligible_known_pdf_identities'])+' | '+str(row['pdf_coverage_percent'])+'% | '+label+' |')
    lines += ['', 'Parent-verified database snapshot at 16:16:29.982293 UTC: **74,276 document entities**, **31,869 distinct verified PDF objects**, and **19,157,638,383 bytes**. Those are database/CAS units, so they differ from provider document identities in this report.','', 'The separate supplied-local packet contains 701 occurrences / 591 distinct bodies, including 12 local sealing flags. Its null backend identities and private quarantine are preserved; it is not silently added to native-provider coverage.','', 'Full private CSV: `'+str(out/'full-native-case-coverage.csv')+'`. Full private JSON retains every native-case row, source file hashes, receipt-prefix hashes, selected-version logic, and caption lineage. No network, database, downloads, or deletion actions were performed for this report.']
    text='\n'.join(lines)+'\n'
    (out/'coverage-snapshot.md').write_text(text,encoding='utf-8')
    (REPO/'docs/seeger-weiss-backfill-coverage-2026-10-02.md').write_text(text,encoding='utf-8')
    print(json.dumps({'snapshot_directory':str(out),'finished_at':result['finished_at'],'provider_summary':provider_summary,'top15':[{'name':x['case_name'],'docket':x['native_case_id'],'verified':x['cloud_verified_selected_source_version'],'eligible':x['eligible_known_pdf_identities'],'percent':x['pdf_coverage_percent']} for x in major],'all_case_rows':len(full),'superseded_queued_versions':result['superseded_queued_source_versions']},ensure_ascii=False))


if __name__=='__main__':
    main()
