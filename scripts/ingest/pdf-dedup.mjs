// Pre-download de-duplication for the private PDF library. Decides, from what is ALREADY stored and hash-verified, whether a queue row needs
// a source download at all. Nothing here fetches from a source; the only network call is the read-only service-role index RPC
// public.corpus_admin_pdf_dedup_index_v1 (database/contracts/corpus-pdf-dedup-index-v1.sql).
//
// Rules (a stored object was hash-checked against its cloud readback before it was registered):
//   1. provider SHA-1 (CourtListener recap sha1 on the row) equals the SHA-1 of a stored object      -> dedup 'provider_sha1_equals_stored_sha1'
//   2. the exact normalized file URL was previously verified into exactly one stored object          -> dedup 'exact_url_previously_verified'
//        ... unless the row carries a provider SHA-1 (or size) that differs from that object: a new version, so DOWNLOAD and record the conflict
//   3. anything else, or any ambiguity (several stored versions of one URL, unknown provider)        -> download
// A dedup registers the new source-native association against the existing object without a source request.
export const OBJECT_PREFIX = 'seeger-weiss/pdf-sha256/';
export const objectKey = sha256 => OBJECT_PREFIX + sha256.slice(0, 2) + '/' + sha256 + '.pdf';
// Providers whose rows carry either a provider SHA-1 or an exact, stable file URL. DocketBird rows use expiring signed URLs and carry no hash.
export const DEDUP_PROVIDERS = new Set(['courtlistener', 'courtlistener-public-locator']);
const HEX64 = /^[a-f0-9]{64}$/, HEX40 = /^[a-f0-9]{40}$/;

export function normalizeSourceUrl(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    u.hash = '';
    return u.href;
  } catch { return null; }
}
const lowerHex40 = v => (typeof v === 'string' && HEX40.test(v.toLowerCase()) ? v.toLowerCase() : null);
const positiveInt = v => (Number.isSafeInteger(v) && v > 0 ? v : null);
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export function createDedupIndex({ loadedAt = new Date().toISOString() } = {}) {
  const bySha256 = new Map(), bySha1 = new Map(), urlToSha256 = new Map(), nativeToSha256 = new Map();
  const index = {
    loaded_at: loadedAt,
    addObject(o) {
      if (!o || !HEX64.test(o.sha256 ?? '') || !HEX40.test(o.sha1 ?? '') || !positiveInt(Number(o.bytes))) return false;
      const object = { sha256: o.sha256, sha1: o.sha1, bytes: Number(o.bytes), first_verified_at: iso(o.first_verified_at) ?? loadedAt };
      bySha256.set(object.sha256, object);
      const prior = bySha1.get(object.sha1);
      // SHA-1 is unique in the library today; if two objects ever shared one, the SHA-1 rule is ambiguous and is switched off for it.
      bySha1.set(object.sha1, prior && prior.sha256 !== object.sha256 ? { ambiguous: true } : object);
      return true;
    },
    addAsset(a) {
      const hashes = (a?.sha256s ?? []).filter(h => HEX64.test(h));
      if (!a?.source_system || !a.native_document_id || !hashes.length) return false;
      const key = a.source_system + '|' + a.native_document_id, set = nativeToSha256.get(key) ?? new Set();
      hashes.forEach(h => set.add(h)); nativeToSha256.set(key, set);
      // For the public-locator family the native_document_id IS the exact RECAP file URL.
      if (a.source_system === 'courtlistener-public-locator') index.addVerifiedUrl(a.native_document_id, hashes);
      return true;
    },
    // Remember a URL -> bytes association (also used for objects verified earlier in the same process).
    addVerifiedUrl(url, sha256s) {
      const key = normalizeSourceUrl(url);
      if (!key) return false;
      const set = urlToSha256.get(key) ?? new Set();
      [].concat(sha256s).filter(h => HEX64.test(h)).forEach(h => set.add(h));
      urlToSha256.set(key, set);
      return true;
    },
    hasObject: sha256 => bySha256.has(sha256),
    getObject: sha256 => bySha256.get(sha256) ?? null,
    stats: () => ({ objects: bySha256.size, urls: urlToSha256.size, native_documents: nativeToSha256.size, loaded_at: loadedAt }),
    classify(row) {
      if (!DEDUP_PROVIDERS.has(row?.provider)) return { action: 'download', reason: 'provider_not_dedupable' };
      const providerSha1 = lowerHex40(row.expected_sha1), providerBytes = positiveInt(row.expected_bytes), url = normalizeSourceUrl(row.download_url);
      // 1. provider-reported SHA-1 equals a stored object's SHA-1
      if (providerSha1) {
        const hit = bySha1.get(providerSha1);
        // The SHA-1 decides. CourtListener's advertised file_size is often stale against the bytes that carry that SHA-1 (the Oct 2 worker
        // already accepts a size disagreement when the SHA-1 matches), so a size disagreement is recorded on the receipt, not treated as a conflict.
        if (hit && !hit.ambiguous) return { action: 'dedup', basis: 'provider_sha1_equals_stored_sha1', object: hit, evidence: { provider_sha1: providerSha1, provider_bytes: providerBytes } };
      }
      // 2. the exact file URL was already verified
      const prior = url ? urlToSha256.get(url) : null;
      if (prior?.size) {
        if (prior.size > 1) return { action: 'download', reason: 'url_has_multiple_stored_versions', conflict: { kind: 'url_has_multiple_stored_versions', stored_sha256s: [...prior].sort() } };
        const object = bySha256.get([...prior][0]);
        if (!object) return { action: 'download', reason: 'url_object_not_in_index' };
        if (providerSha1 && providerSha1 !== object.sha1)
          return { action: 'download', reason: 'provider_sha1_differs_from_stored_for_same_url', conflict: { kind: 'provider_sha1_differs_from_stored_for_same_url', stored_sha256: object.sha256, stored_sha1: object.sha1, provider_sha1: providerSha1 } };
        if (providerBytes !== null && providerBytes !== object.bytes)
          return { action: 'download', reason: 'provider_size_differs_from_stored_for_same_url', conflict: { kind: 'provider_size_differs_from_stored_for_same_url', stored_sha256: object.sha256, stored_bytes: object.bytes, provider_bytes: providerBytes } };
        return { action: 'dedup', basis: 'exact_url_previously_verified', object, evidence: { provider_sha1: providerSha1, provider_bytes: providerBytes } };
      }
      // 3. needs a real download; note when the same native document was verified before with different bytes (a new version)
      const known = nativeToSha256.get(row.provider + '|' + row.native_document_id);
      if (known?.size) return { action: 'download', reason: 'no_stored_match', conflict: { kind: 'native_document_previously_verified_with_other_bytes', stored_sha256s: [...known].sort(), provider_sha1: providerSha1 } };
      return { action: 'download', reason: 'no_stored_match' };
    }
  };
  return index;
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const NETWORK = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const isNetwork = error => { for (let e = error, d = 0; e && d < 5; e = e.cause, d++) if (e.name === 'TimeoutError' || e.name === 'AbortError' || NETWORK.has(e.code) || (e instanceof TypeError && /^(?:fetch failed|terminated)$/.test(e.message))) return true; return false; };

// Pages the read-only RPC (keyset on its own `last` cursor) into a fresh index. Transient registry errors retry with bounded backoff.
export async function loadDedupIndex({ baseUrl, headers, fetchImpl = fetch, pageSize = 5000, attempts = 5, pause = ms => new Promise(r => setTimeout(r, ms)), now = () => new Date().toISOString() } = {}) {
  const index = createDedupIndex({ loadedAt: now() }), started = Date.now(), pages = { objects: 0, assets: 0 };
  async function page(kind, after) {
    for (let attempt = 0; ; attempt++) {
      let failure = null;
      try {
        const res = await fetchImpl(baseUrl + '/rest/v1/rpc/corpus_admin_pdf_dedup_index_v1', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_kind: kind, p_after: after, p_limit: pageSize }), redirect: 'error', signal: AbortSignal.timeout(120000) });
        const text = await res.text();
        if (res.ok) { const data = JSON.parse(text); if (!Array.isArray(data?.rows)) throw Error('DEDUP_INDEX_BAD_RESPONSE'); return data; }
        if (!TRANSIENT.has(res.status)) throw Object.assign(Error('DEDUP_INDEX_HTTP_' + res.status), { permanent: true });
        failure = 'HTTP_' + res.status;
      } catch (error) {
        if (error.permanent || error.message === 'DEDUP_INDEX_BAD_RESPONSE' || !isNetwork(error)) throw error;
        failure = error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      }
      if (attempt + 1 >= attempts) throw Object.assign(Error('DEDUP_INDEX_UNAVAILABLE'), { failure });
      await pause(Math.min(30000, 1000 * 2 ** attempt));
    }
  }
  for (const kind of ['objects', 'assets']) {
    let after = '';
    for (;;) {
      const data = await page(kind, after);
      pages[kind]++;
      for (const r of data.rows) kind === 'objects' ? index.addObject(r) : index.addAsset(r);
      if (data.rows.length < pageSize || data.last == null) break;
      if (data.last === after) throw Error('DEDUP_INDEX_CURSOR_STALLED');
      if (pages[kind] > 1000) throw Error('DEDUP_INDEX_TOO_MANY_PAGES');
      after = data.last;
    }
  }
  index.load = { ms: Date.now() - started, pages };
  return index;
}

// Receipt fields describing a dedup decision (no source URL is ever written to a receipt).
export function dedupReceiptFields(row, plan, index, bucket, project) {
  const object = plan.object;
  return {
    state: 'dedup_matched', bucket, project_id: project,
    dedup_basis: plan.basis, storage_key: objectKey(object.sha256), sha256: object.sha256, sha1: object.sha1, bytes: object.bytes,
    object_first_verified_at: object.first_verified_at, dedup_index_loaded_at: index.loaded_at,
    download_skipped: true, byte_verification: 'earlier_hash_checked_cloud_readback',
    source_expected_bytes: positiveInt(row.expected_bytes), source_size_claim_matched: positiveInt(row.expected_bytes) === null ? null : positiveInt(row.expected_bytes) === object.bytes,
    source_sha1_claim_matched: lowerHex40(row.expected_sha1) === null ? null : lowerHex40(row.expected_sha1) === object.sha1
  };
}
