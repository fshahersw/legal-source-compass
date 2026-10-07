"""Generic landing driver: manifest -> run -> upload/readback -> register objects -> intake+verify -> finish."""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import land_lib as L  # noqa: E402

STORE = '/cursor/stores/bc-24d6c4ee-e9c3-4d34-a42c-3fb9985ace6c/internal/state-codes/batch-a'


def run_landing(st, manifest, assets, sources_by_sha, rows_factory, full_code, notes, extra_status=None,
                work_root=None, workers=12):
    """assets: list of (sha, kind, bytes, content_type). rows_factory(manifest_sha) -> iterator of rows.

    full_code: True only when every section of the publisher's current code is captured.
    """
    supa = L.Supa()
    work = pathlib.Path(work_root or '/tmp/sc/%s/landing' % st)
    work.mkdir(parents=True, exist_ok=True)
    status_path = '%s/%s/status.json' % (STORE, st.lower())
    status = {'state': st, 'contract': 'publisher-code-intake/2', 'schema_version': 'publisher-code-evidence/2',
              'started_at': L.now_z(), 'phase': 'start', 'notes': notes, 'full_code': full_code}
    if extra_status:
        status.update(extra_status)
    L.write_status(status_path, status)

    def progress(msg):
        status['progress'] = msg
        status['updated_at'] = L.now_z()
        L.write_status(status_path, status)
        print(msg, flush=True)

    run_file = work / 'run.json'
    run = None
    result_status = 'partial'
    counts = {}
    try:
        L.assert_landable(assets, sources_by_sha, (extra_status or {}).get('toc_proof'))
        reg = supa.rpc('corpus_publisher_code_register_manifest_v2', {'p_manifest': manifest})
        manifest_sha = reg['manifest_sha256']
        status.update({'manifest_sha256': manifest_sha, 'manifest_registered': reg.get('registered'),
                       'parser': reg.get('parser')})
        if run_file.exists():
            run = json.loads(run_file.read_text())['run_id']
        else:
            run = L.new_run_id()
            run_file.write_text(json.dumps({'run_id': run, 'manifest_sha256': manifest_sha}))
        opened = supa.rpc('corpus_publisher_code_open_run_v2', {'p_run': run, 'p_manifest_sha256': manifest_sha})
        status.update({'run_id': run, 'run_status_at_open': opened.get('status'), 'phase': 'uploading'})
        progress('run %s opened' % run)

        journal = L.Journal(work / 'objects.jsonl')
        n = L.upload_all(supa, journal, assets, workers=workers, progress=progress)
        progress('uploaded/readback verified %d new objects (%d journaled total)' % (n, len(journal.done)))
        status['phase'] = 'registering_objects'
        new_objs = L.register_objects(supa, run, journal, sources_by_sha)
        progress('registered objects (new %d of %d)' % (new_objs, len(sources_by_sha)))

        status['phase'] = 'intake'
        landed = {'code-source-unit': 0, 'code-section': 0}
        n_batches = 0
        verified_all = True
        for batch in L.batches(rows_factory(manifest_sha)):
            res = supa.rpc('corpus_publisher_code_intake_v2', {'p_run': run, 'p_rows': batch})
            proof = supa.rpc('corpus_publisher_code_verify_batch_v2', {'p_run': run, 'p_rows': batch})
            if proof.get('verified') is not True:
                verified_all = False
                raise RuntimeError('batch %d not verified: %s' % (n_batches, json.dumps(proof)[:400]))
            for r in batch:
                landed[r['entity_type']] += 1
            n_batches += 1
            if n_batches % 5 == 0:
                progress('batches %d units %d sections %d (last replayed=%s)' % (
                    n_batches, landed['code-source-unit'], landed['code-section'], res.get('replayed')))
        counts = {'batches': n_batches, 'units_submitted': landed['code-source-unit'],
                  'sections_submitted': landed['code-section'], 'all_batches_verified': verified_all}
        status['counts'] = counts
        result_status = 'completed' if full_code else 'partial'
    except BaseException as exc:  # recorded, then re-raised after the run is closed
        status['error'] = '%s: %s' % (type(exc).__name__, str(exc)[:500])
        status['phase'] = 'failed'
        result_status = 'partial'
        raise
    finally:
        if run:
            try:
                fin = supa.rpc('corpus_publisher_code_finish_run_v2',
                               {'p_run': run, 'p_status': result_status, 'p_counts': {**counts, 'note': 'batch-a ' + st}})
                status['finish'] = fin
                status['run_status'] = fin.get('status')
            except Exception as exc2:  # noqa: BLE001
                status['finish_error'] = str(exc2)[:500]
        status['finished_at'] = L.now_z()
        if status.get('phase') != 'failed':
            status['phase'] = 'finished'
        try:
            cov = supa.rpc('corpus_publisher_code_coverage_v2', {'p_recount': False})
            status['coverage'] = [s for s in cov['states'] if s['jurisdiction'] == st]
        except Exception as exc3:  # noqa: BLE001
            status['coverage_error'] = str(exc3)[:300]
        L.write_status(status_path, status)
    return status
