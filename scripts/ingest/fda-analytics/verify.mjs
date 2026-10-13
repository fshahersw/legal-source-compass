/** Re-derive every published aggregate from its hash-checked private official response. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { CATALOG } from './catalog.mjs';
import { dateSearch, enumSearch, queryUrl, readDatePoints, readEnumeratedFacet, readFacet, readTotal } from './collect.mjs';
import { requireValue, sha256, payloadHash, isoDate } from '../regulatory/core.mjs';

export async function verifySnapshotEvidence(snapshot, directory) {
  requireValue(snapshot?.schemaVersion === 'fda-analytics/1' && /^[a-f0-9-]{36}$/i.test(snapshot.runId) && Array.isArray(snapshot.datasets) && snapshot.datasets.length === CATALOG.length && Array.isArray(snapshot.receipts) && snapshot.receipts.length <= 1500, 'SNAPSHOT_INVALID');
  isoDate(snapshot.window.from); isoDate(snapshot.window.to);
  requireValue(new Set(snapshot.datasets.map((d) => d.id)).size === CATALOG.length, 'DATASET_IDENTITY_INVALID');
  const evidence = new Map(); let bytes = 0;
  for (const r of snapshot.receipts) {
    requireValue(/^[a-f0-9]{64}$/.test(r.sha256) && r.id === sha256(r.url + '\n' + r.sha256) && !evidence.has(r.id), 'RECEIPT_IDENTITY_INVALID');
    const u = new URL(r.url); requireValue(CATALOG.some((d) => d.endpoint === u.origin + u.pathname) && !u.username && !u.password && !u.hash && !u.port && [...u.searchParams.keys()].every((key) => ['search', 'count', 'limit', 'sort'].includes(key)) && ['1', '1000'].includes(u.searchParams.get('limit')), 'RECEIPT_URL_INVALID');
    requireValue(r.byteCount > 0 && r.byteCount <= 8 * 1024 * 1024 && r.contentType === 'application/json' && Number.isInteger(r.httpStatus) && r.httpStatus >= 200 && r.httpStatus <= 599 && Date.parse(r.retrievedAt) <= Date.parse(snapshot.generatedAt), 'RECEIPT_METADATA_INVALID');
    const raw = await fs.readFile(path.join(directory, 'objects', r.sha256 + '.raw')); bytes += raw.length;
    requireValue(bytes <= 100 * 1024 * 1024 && raw.length === r.byteCount && sha256(raw) === r.sha256, 'RAW_EVIDENCE_HASH_MISMATCH');
    const json = JSON.parse(raw); requireValue((typeof json?.meta?.last_updated === 'string' ? json.meta.last_updated : null) === r.lastUpdated, 'RELEASE_EVIDENCE_MISMATCH');
    const noMatches = r.httpStatus === 404 && json?.error?.code === 'NOT_FOUND' && json?.error?.message === 'No matches found!';
    evidence.set(r.id, { receipt: r, json, noMatches });
  }
  const refs = (metric, url, required = true) => {
    requireValue(Array.isArray(metric.receiptIds) && new Set(metric.receiptIds).size === metric.receiptIds.length, 'METRIC_RECEIPTS_INVALID');
    const found = metric.receiptIds.map((id) => { const r = evidence.get(id); requireValue(r, 'METRIC_RECEIPT_MISSING'); return r; }).filter((r) => r.receipt.url === url);
    requireValue(!required || found.length > 0, 'EXACT_QUERY_EVIDENCE_MISSING');
    for (const r of found) requireValue(r.receipt.httpStatus === 200 || r.noMatches, 'FAILED_METRIC_EVIDENCE');
    return found;
  };
  let metrics = 0;
  for (const d of snapshot.datasets) {
    const definition = CATALOG.find((v) => v.id === d.id); requireValue(definition && d.endpoint === definition.endpoint && d.productFamily === definition.productFamily && d.countUnit === definition.countUnit, 'DATASET_IDENTITY_INVALID');
    if (['failed', 'unavailable'].includes(d.status)) { requireValue(d.total.value === null && d.series === null && d.facets.length === 0 && d.statusReason, 'FAILED_DATASET_HAS_METRICS'); continue; }
    requireValue(['ready', 'partial'].includes(d.status) && (d.status === 'ready' || d.statusReason), 'DATASET_STATUS_INVALID');
    for (const id of [...d.total.receiptIds, ...(d.series?.receiptIds ?? []), ...d.facets.flatMap((f) => f.receiptIds)]) {
      const r = evidence.get(id); requireValue(r && r.receipt.url.split('?')[0] === d.endpoint && (r.noMatches || r.receipt.lastUpdated === d.sourceUpdatedAt), 'METRIC_RELEASE_EVIDENCE_MISMATCH');
    }
    for (const r of refs(d.total, queryUrl(d.endpoint))) requireValue(readTotal(r) === d.total.value && r.receipt.lastUpdated === d.sourceUpdatedAt, 'TOTAL_EVIDENCE_MISMATCH'); metrics++;
    if (d.series) {
      const s = d.series; requireValue(s.dateField === definition.dateField && s.range.from >= snapshot.window.from && s.range.to <= snapshot.window.to && Date.parse(s.range.to) - Date.parse(s.range.from) === 729 * 86400000, 'SERIES_SCOPE_INVALID');
      const search = dateSearch(s.dateField, s.range);
      const totals = refs(s, queryUrl(d.endpoint, search)); const counts = refs(s, queryUrl(d.endpoint, search, s.dateField));
      requireValue(totals.every((r) => readTotal(r) === s.matchedRecords), 'SERIES_TOTAL_EVIDENCE_MISMATCH');
      requireValue(counts.every((r) => payloadHash(readDatePoints(r, s.range)) === payloadHash(s.points)), 'SERIES_POINTS_EVIDENCE_MISMATCH');
      const complete = s.points.reduce((n, p) => n + p.count, 0) === s.matchedRecords;
      requireValue(s.complete === complete && (!s.completeThrough || (complete && s.completeThrough <= s.points.at(-1)?.date && s.completeThrough < snapshot.generatedAt.slice(0, 10))), 'SERIES_COVERAGE_INVALID'); metrics += 2;
    }
    for (const f of d.facets) {
      const def = definition.facets.find((v) => v.field === f.field); requireValue(def, 'FACET_FIELD_NOT_REVIEWED');
      const search = f.scope.kind === 'window' ? dateSearch(definition.dateField, f.scope) : undefined;
      if (f.scope.kind === 'window') requireValue(d.series?.completeThrough === f.scope.to && f.scope.from >= snapshot.window.from, 'FACET_SCOPE_INVALID');
      const denominators = refs(f, queryUrl(d.endpoint, search)); requireValue(denominators.every((r) => readTotal(r) === f.denominator), 'FACET_DENOMINATOR_EVIDENCE_MISMATCH');
      if (def.enumTerms) { const terms = def.enumTerms.map(([value]) => refs(f, queryUrl(d.endpoint, enumSearch(f.field, value, search)))[0]); requireValue(payloadHash(readEnumeratedFacet(terms, f.denominator, def, f.scope, f.receiptIds)) === payloadHash(f), 'ENUM_FACET_EVIDENCE_MISMATCH'); metrics++; continue; }
      const counted = f.denominator === 0 ? null : refs(f, queryUrl(d.endpoint, search, f.field))[0];
      requireValue(payloadHash(readFacet(counted, f.denominator, def, f.scope, f.receiptIds)) === payloadHash(f), 'FACET_EVIDENCE_MISMATCH'); metrics++;
    }
  }
  return { verified: true, datasetCount: snapshot.datasets.length, receiptCount: evidence.size, metrics, rawBytes: bytes, payloadSha256: payloadHash(snapshot) };
}
