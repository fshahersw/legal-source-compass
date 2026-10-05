// Private publisher-file transport. No CLI: a reviewed intake coordinator must
// supply the validated project credential, pinned asset and durable journal.
import { hashBytes } from "../../admin/local-catalog-evidence-contract.mjs";

const project = "xosqzzsnhxcyehcnirpa",
  bucket = "corpus-originals";
const base = `https://${project}.storage.supabase.co/storage/v1`;
const transportErrorNames = new Set([
  "AbortError",
  "ConnectTimeoutError",
  "Error",
  "HeadersTimeoutError",
  "SocketError",
  "TimeoutError",
  "TypeError",
]);
const transportCauseCodes = new Set([
  "EAI_AGAIN",
  "EADDRNOTAVAIL",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "EPROTO",
  "ETIMEDOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_ABORTED",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const fail = (code) => {
  throw new Error(code);
};
export function publisherTransportDiagnostic(error) {
  const readString = (object, property) => {
    try {
      const value = object?.[property];
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };
  const name = readString(error, "name");
  let cause;
  try {
    cause = error?.cause;
  } catch {
    cause = undefined;
  }
  const errorCode = readString(error, "code");
  const causeCode = readString(cause, "code");
  return {
    error_name: transportErrorNames.has(name) ? name : "UnknownError",
    ...(transportCauseCodes.has(errorCode) ? { error_code: errorCode } : {}),
    ...(transportCauseCodes.has(causeCode) ? { error_cause_code: causeCode } : {}),
  };
}
export function publisherObjectKey(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash ?? "")) fail("INVALID_PUBLISHER_OBJECT_HASH");
  return `state-codes/sha256/${hash.slice(0, 2)}/${hash}`;
}
function validateAsset(asset) {
  publisherObjectKey(asset?.sha256);
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 25 * 1024 * 1024)
    fail("INVALID_PUBLISHER_OBJECT_SIZE");
}
async function boundedBytes(response, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > limit) fail("PUBLISHER_READBACK_EXCEEDS_PINNED_SIZE");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function verifyPublisherReadback(response, asset) {
  validateAsset(asset);
  if (response.status !== 200 || response.headers.has("content-range")) {
    await response.body?.cancel();
    fail("PUBLISHER_WHOLE_OBJECT_HTTP_REQUIRED");
  }
  const body = await boundedBytes(response, asset.bytes),
    hash = hashBytes(body);
  if (body.length !== asset.bytes || hash !== asset.sha256)
    fail("PUBLISHER_READBACK_HASH_OR_LENGTH_MISMATCH");
  const textMetrics = {};
  if (asset.kind === "chapter_text_derivative") {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    } catch {
      fail("PUBLISHER_DERIVATIVE_UTF8_REQUIRED");
    }
    textMetrics.readback_text_encoding = "utf-8";
    textMetrics.readback_text_code_points = Array.from(text).length;
  }
  return {
    readback_sha256: hash,
    readback_bytes: body.length,
    http_status: response.status,
    ...textMetrics,
  };
}

/** Reuse only after a complete authenticated GET; write immutable bytes only
 * after an explicit missing-object result. Never overwrite/delete a conflict. */
export async function ensurePublisherObject({
  asset,
  bytes,
  credentials,
  record,
  allowUpload = true,
  fetcher = fetch,
  clock = () => new Date().toISOString(),
}) {
  validateAsset(asset);
  const key = publisherObjectKey(asset.sha256);
  if (!Buffer.isBuffer(bytes) || bytes.length !== asset.bytes || hashBytes(bytes) !== asset.sha256)
    fail("PINNED_PUBLISHER_LOCAL_BYTES_CHANGED");
  if (credentials?.url !== `https://${project}.supabase.co` || typeof record !== "function")
    fail("PINNED_PRIVATE_PROJECT_AND_JOURNAL_REQUIRED");
  const token = credentials.headers?.apikey;
  if (typeof token !== "string") fail("PUBLISHER_SERVICE_CREDENTIAL_REQUIRED");
  if (token.startsWith("ey")) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
    } catch {
      fail("PUBLISHER_SERVICE_CREDENTIAL_REQUIRED");
    }
    if (claims.role !== "service_role" || claims.ref !== project)
      fail("PUBLISHER_SERVICE_CREDENTIAL_REQUIRED");
  } else if (!token.startsWith("sb_secret_")) fail("PUBLISHER_SERVICE_CREDENTIAL_REQUIRED");
  const auth = {
    apikey: token,
    ...(!token.startsWith("sb_") ? { Authorization: `Bearer ${token}` } : {}),
  };
  const request = (url, init = {}) =>
    fetcher(url, {
      ...init,
      headers: { ...auth, ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
  const journal = (event) =>
    record({
      ...event,
      project_id: project,
      bucket,
      sha256: asset.sha256,
      object_key: key,
      at: clock(),
    });
  const bucketResponse = await request(`${base}/bucket/${bucket}`);
  await journal({ state: "private_bucket_response", http_status: bucketResponse.status });
  if (bucketResponse.status !== 200) {
    await bucketResponse.body?.cancel();
    fail("PUBLISHER_PRIVATE_BUCKET_CHECK_FAILED");
  }
  let metadata;
  try {
    metadata = JSON.parse((await boundedBytes(bucketResponse, 65536)).toString("utf8"));
  } catch {
    fail("PUBLISHER_PRIVATE_BUCKET_CHECK_FAILED");
  }
  if (metadata.id !== bucket || metadata.public !== false)
    fail("PUBLISHER_PRIVATE_BUCKET_CHECK_FAILED");

  const read = async () => {
    const response = await request(`${base}/object/authenticated/${bucket}/${key}`);
    await journal({ state: "object_readback_response", http_status: response.status });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (response.status === 400) {
      let details;
      try {
        details = JSON.parse((await boundedBytes(response, 65536)).toString("utf8"));
      } catch {
        fail("PUBLISHER_READBACK_HTTP_400");
      }
      if ((details.code ?? details.error) === "NoSuchKey") return null;
      fail("PUBLISHER_READBACK_HTTP_400");
    }
    return verifyPublisherReadback(response, asset);
  };
  await journal({ state: "readback_before_upload" });
  let verified = await read(),
    disposition = "verified_reuse",
    uploadStatus = null;
  if (!verified) {
    if (allowUpload !== true) fail("PUBLISHER_READ_ONLY_OBJECT_MISSING");
    await journal({ state: "object_confirmed_missing" });
    await journal({ state: "immutable_upload_pending", bytes: asset.bytes });
    let response;
    try {
      response = await request(`${base}/object/${bucket}/${key}`, {
        method: "POST",
        body: bytes,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
          "x-upsert": "false",
        },
      });
    } catch (error) {
      // An unknown upload outcome is resolved by one full readback, never an
      // automatic second write. A later resumed run checks the same key first.
      await journal({
        state: "upload_transport_outcome_unknown",
        ...publisherTransportDiagnostic(error),
      });
    }
    if (response) {
      uploadStatus = response.status;
      await response.body?.cancel();
      await journal({ state: "immutable_upload_response", http_status: uploadStatus });
      if (![200, 201, 400, 409, 408, 500, 502, 503, 504].includes(uploadStatus))
        fail("PUBLISHER_UPLOAD_BLOCKED_OR_REJECTED");
    }
    verified = await read();
    if (!verified) fail("PUBLISHER_OBJECT_MISSING_AFTER_UPLOAD");
    disposition =
      uploadStatus === 200 || uploadStatus === 201
        ? "uploaded_verified"
        : "upload_outcome_resolved_by_full_readback";
  }
  const receipt = {
    project_id: project,
    bucket,
    object_key: key,
    sha256: asset.sha256,
    bytes: asset.bytes,
    ...verified,
    verification_method: "authenticated-whole-object-get-sha256",
    verified_at: clock(),
    disposition,
    upload_http_status: uploadStatus,
    private_only: true,
  };
  await journal({ state: "whole_object_verified", receipt });
  return receipt;
}
