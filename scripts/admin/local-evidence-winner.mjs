/** Mirrors the private SQL winner: later local snapshot, then read, then smaller SHA. */
export function selectLocalEvidenceWinner(first, second) {
  const key = (r) => JSON.stringify([r.source_system, r.entity_type, r.native_id]);
  if (first && second && key(first) !== key(second)) throw new Error('Winner comparison cannot merge distinct local identities.');
  const rank = (r) => {
    const p = r.provenance, instant = Date.parse(p.observed_at);
    if (!Number.isFinite(instant) || !/^[a-f0-9]{64}$/.test(p.record_sha256 ?? '')) throw new Error('Invalid local winner provenance.');
    const day = p.local_snapshot_as_of ?? new Date(instant).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('Invalid local snapshot date.');
    return [day, instant, p.record_sha256];
  };
  if (!first) { if (second) rank(second); return second; }
  if (!second) { rank(first); return first; }
  const a = rank(first), b = rank(second);
  if (a[0] !== b[0]) return a[0] > b[0] ? first : second;
  if (a[1] !== b[1]) return a[1] > b[1] ? first : second;
  return a[2] <= b[2] ? first : second;
}
