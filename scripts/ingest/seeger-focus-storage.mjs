import fs from 'node:fs';
import {privateOriginalStorage, privateCredentials, sha256, boundedRequest} from '../legal/private-original-storage.mjs';

export const metadataKey = hash => `seeger-weiss/focused-metadata-sha256/${hash.slice(0,2)}/${hash}.json`;
export async function focusStorage(credentials, log = () => {}) {
 const storage = await privateOriginalStorage(credentials, log), auth = privateCredentials(credentials);
 return async function preserve(capturePath, parsedPath, info) {
  const raw = fs.readFileSync(capturePath), parsed = fs.readFileSync(parsedPath), data = JSON.parse(parsed);
  const rawHash = sha256(raw), metaHash = sha256(parsed);
  const row = {capture_sha256: rawHash, source_system: info.source_system, source_url: info.source_url,
   native_case_id: info.native_case_id ?? null, retrieved_at: info.retrieved_at,
   capture_storage_key: metadataKey(rawHash), capture_bytes: raw.length,
   metadata_sha256: metaHash, metadata_storage_key: metadataKey(metaHash), metadata_bytes: parsed.length,
   records: data, provenance: {...info.provenance, public_projection_allowed: false, cloud_readback_verified: true,
    courtlistener_api_requests: 0, capture_format: 'provider_tool_or_json_response_capture', source_is_origin_http_wire_bytes: false}};
  // Readback each complete object before the database can acknowledge it.
  await storage.put(row.capture_storage_key, raw);
  await storage.put(row.metadata_storage_key, parsed);
  await boundedRequest(auth.url+'/rest/v1/rpc/corpus_admin_register_pdf_capture_v1', {
   method: 'POST', headers: {...auth.headers, 'Content-Type': 'application/json'}, body: JSON.stringify({p_row: row})
  }, async r => {
   const ack = await r.json();
   if (!r.ok || ack.registered !== true || ack.private_only !== true || ack.capture_sha256 !== rawHash)
    throw Object.assign(Error(`Metadata registry failed HTTP ${r.status}: ${String(ack.message ?? '').slice(0,160)}`), {name:'IntegrityError'});
  }, log);
  return {state:'metadata_cloud_verified', capture_sha256:rawHash, metadata_sha256:metaHash,
   capture_storage_key:row.capture_storage_key, metadata_storage_key:row.metadata_storage_key,
   capture_bytes:raw.length, metadata_bytes:parsed.length, native_case_id:row.native_case_id, source_url:row.source_url};
 };
}
