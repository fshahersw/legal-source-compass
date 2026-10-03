import { createHash } from 'node:crypto';

/** Metadata workers must settle before the shared quota lock is released. */
export async function runSettledWorkers(tasks, { concurrency = 3, shouldStop = () => null } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Array.isArray(tasks)
    || tasks.some(task => typeof task !== 'function')) throw new Error('Invalid metadata worker pool');
  let cursor = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const stop = shouldStop();
      if (stop) throw new Error(String(stop));
      await tasks[cursor++]();
    }
  }));
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
}

/** Mirrors observation identity: a second query scope remains separate evidence. */
export function nativeObservationKey(record) {
  return JSON.stringify([record.source_system, record.entity_type, record.native_id,
    record.provenance.record_sha256, record.provenance.source_url]);
}

/** Missing and non-boolean publisher blocking fields never authorize relation collection. */
export function sourceDocketAllowsRelations(docket) {
  return !!docket && docket.blocked === false && docket.date_blocked == null;
}

/** A header's blocking flags are trusted only after exact API identity/version checks. */
export function verifiedNativeDocketHeader(record) {
  const expected = 'courtlistener-rest-v4.7/1';
  if (record?.source_system !== 'courtlistener' || record.entity_type !== 'dockets'
    || record.schema_version !== expected || typeof record.native_id !== 'string'
    || !/^[0-9]+$/.test(record.native_id) || String(record.data?.id) !== record.native_id) {
    throw new Error('Invalid native docket support identity/schema');
  }
  const resource = new URL(record.data.resource_uri);
  const source = new URL(record.provenance?.source_url);
  if (resource.origin !== 'https://www.courtlistener.com' || resource.username || resource.password
    || resource.search || resource.hash || resource.pathname !== `/api/rest/v4/dockets/${record.native_id}/`
    || source.origin !== resource.origin || source.username || source.password || source.hash
    || !/^\/api\/rest\/v4\/dockets\/(?:[0-9]+\/)?$/.test(source.pathname)
    || (source.pathname !== '/api/rest/v4/dockets/' && source.pathname !== resource.pathname)) {
    throw new Error('Invalid native docket support resource/source URL');
  }
  const provenance = record.provenance;
  const hash = createHash('sha256').update(JSON.stringify(record.data)).digest('hex');
  if (hash !== provenance.record_sha256 || !/^[a-f0-9]{64}$/.test(provenance.source_sha256 ?? '')
    || provenance.http_status !== 200 || provenance.schema_version !== expected
    || !Number.isFinite(Date.parse(provenance.retrieved_at))) {
    throw new Error('Invalid native docket support payload/provenance');
  }
  return record.data;
}
