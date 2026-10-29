/**
 * The agent workspace store: memories, files, episodes and schedules through the agent_* functions
 * (database/contracts/agent-workspace-v1.sql), and file bytes in the private agent-files bucket. Every call is scoped
 * to an owner hash. File downloads use short-lived signed links so images and documents open without custom headers.
 * Server-only.
 */

import type { AgentFile, Episode, FileKind, Memory, MemoryKind, Schedule } from "./store.types";

export type { AgentFile, Episode, FileKind, Memory, MemoryKind, Schedule } from "./store.types";

const BUCKET = "agent-files";

function creds() {
  const url = process.env["EXTERNAL_SUPABASE_URL"];
  const key = process.env["EXTERNAL_SUPABASE_KEY"];
  if (!url || !key) throw new Error("The agent workspace is not configured.");
  return { url: url.replace(/\/$/, ""), key };
}
/**
 * Call an agent_* function. Errors the functions raise on purpose (limits, a missing row, a failed check) come back
 * with their own readable message; anything else stays generic.
 */
async function rpcPost<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { url, key } = creds();
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      ...storageHeaders(key),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let err: { code?: string; message?: string } = {};
    try {
      err = (await res.json()) as { code?: string; message?: string };
    } catch {
      err = {};
    }
    if (err.code && /^(P0001|P0002|23514|22023|54000)$/.test(err.code) && err.message)
      throw new Error(err.message.slice(0, 300));
    console.error(`agent rpc ${fn} failed [${res.status}] ${err.code ?? ""}`);
    throw new Error("The agent workspace could not be reached.");
  }
  return (await res.json()) as T;
}

function storageHeaders(key: string): Record<string, string> {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

// ------------------------------------------------------------------------------------------------- memories

export const putMemory = (
  owner: string,
  m: { id?: string | null; kind: MemoryKind; title: string; body: string; tags?: string[] },
) =>
  rpcPost<Memory>("agent_memory_put", {
    p_owner: owner,
    p_id: m.id ?? null,
    p_kind: m.kind,
    p_title: m.title.slice(0, 200),
    p_body: m.body.slice(0, 4000),
    p_tags: (m.tags ?? []).slice(0, 12).map((t) => t.slice(0, 40)),
  });
export const listMemories = (owner: string, kind?: MemoryKind) =>
  rpcPost<Memory[]>("agent_memory_list", { p_owner: owner, p_kind: kind ?? null, p_limit: 500 });
export const deleteMemory = (owner: string, id: string) =>
  rpcPost<boolean>("agent_memory_delete", { p_owner: owner, p_id: id });
export const touchMemories = (owner: string, ids: string[]) =>
  ids.length
    ? rpcPost<null>("agent_memory_touch", { p_owner: owner, p_ids: ids })
    : Promise.resolve(null);

// ------------------------------------------------------------------------------------------------- files

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/html": "html",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "text/plain": "txt",
};

/** Save a file: small text inline (notes, reports, data), anything else as bytes in the bucket. */
export async function saveFile(
  owner: string,
  f: {
    kind: FileKind;
    title: string;
    mime: string;
    text?: string | null;
    bytes?: Uint8Array | null;
    source?: string | null;
    meta?: Record<string, unknown>;
    unread?: boolean;
  },
): Promise<AgentFile> {
  let storagePath: string | null = null;
  let size = f.text ? new TextEncoder().encode(f.text).length : 0;
  if (f.bytes) {
    if (f.bytes.length > 25 * 1024 * 1024) throw new Error("The file is larger than 25 MB.");
    const ext = EXT[f.mime] ?? "bin";
    storagePath = `${owner}/${crypto.randomUUID()}.${ext}`;
    const { url, key } = creds();
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${storagePath}`, {
      method: "POST",
      headers: { ...storageHeaders(key), "content-type": f.mime, "x-upsert": "false" },
      body: new Uint8Array(f.bytes),
    });
    if (!res.ok) throw new Error(`The file could not be stored (${res.status}).`);
    size = f.bytes.length;
  }
  return await rpcPost<AgentFile>("agent_file_put", {
    p_owner: owner,
    p_kind: f.kind,
    p_title: f.title.slice(0, 300) || "Untitled",
    p_mime: f.mime,
    p_bytes: size,
    p_storage_path: storagePath,
    p_text: f.bytes ? null : (f.text ?? null),
    p_source: f.source ?? null,
    p_meta: f.meta ?? {},
    p_unread: f.unread ?? false,
  });
}

export const listFiles = (
  owner: string,
  opts: { kind?: FileKind | null; limit?: number; offset?: number } = {},
) =>
  rpcPost<{ total: number; unread: number; rows: AgentFile[] }>("agent_file_list", {
    p_owner: owner,
    p_kind: opts.kind ?? null,
    p_limit: opts.limit ?? 60,
    p_offset: opts.offset ?? 0,
  });
export const getFile = (owner: string, id: string) =>
  rpcPost<AgentFile | null>("agent_file_get", { p_owner: owner, p_id: id });
export const updateFile = (
  owner: string,
  id: string,
  patch: { title?: string; pinned?: boolean; unread?: boolean },
) =>
  rpcPost<AgentFile | null>("agent_file_update", {
    p_owner: owner,
    p_id: id,
    p_title: patch.title ?? null,
    p_pinned: patch.pinned ?? null,
    p_unread: patch.unread ?? null,
  });

export async function deleteFile(owner: string, id: string): Promise<boolean> {
  const out = await rpcPost<{ deleted: boolean; storage_path: string | null }>(
    "agent_file_delete",
    { p_owner: owner, p_id: id },
  );
  if (out.storage_path) {
    const { url, key } = creds();
    await fetch(`${url}/storage/v1/object/${BUCKET}/${out.storage_path}`, {
      method: "DELETE",
      headers: storageHeaders(key),
    }).catch(() => undefined);
  }
  return out.deleted;
}

/** The bytes of a stored file (or its inline text), with its type. */
export async function fileContent(
  file: AgentFile,
): Promise<{ body: BodyInit; mime: string } | null> {
  if (file.storage_path) {
    const { url, key } = creds();
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${file.storage_path}`, {
      headers: storageHeaders(key),
    });
    if (!res.ok || !res.body) return null;
    return { body: res.body, mime: file.mime };
  }
  if (typeof file.text_body === "string")
    return { body: file.text_body, mime: `${file.mime}; charset=utf-8` };
  return null;
}

// ------------------------------------------------------------------------------------------------- episodes

export const putEpisode = (owner: string, task: string, summary: string, pages: string[]) =>
  rpcPost<null>("agent_episode_put", {
    p_owner: owner,
    p_task: task,
    p_summary: summary,
    p_pages: pages.slice(0, 20),
  });
export const listEpisodes = (owner: string, limit = 20) =>
  rpcPost<Episode[]>("agent_episode_list", { p_owner: owner, p_limit: limit });

// ------------------------------------------------------------------------------------------------- schedules

export const putSchedule = (
  owner: string,
  s: {
    id?: string | null;
    title: string;
    task: string;
    cadence: Schedule["cadence"];
    at: string;
    weekday?: number | null;
    monthday?: number | null;
    tz?: string;
    active?: boolean;
    nextRunAt: number | null;
  },
) =>
  rpcPost<Schedule>("agent_schedule_put", {
    p_owner: owner,
    p_id: s.id ?? null,
    p_title: s.title,
    p_task: s.task,
    p_cadence: s.cadence,
    p_at_time: s.at,
    p_weekday: s.weekday ?? null,
    p_monthday: s.monthday ?? null,
    p_tz: s.tz ?? "America/Chicago",
    p_active: s.active ?? true,
    p_next_run_at: s.nextRunAt === null ? null : new Date(s.nextRunAt).toISOString(),
  });
export const listSchedules = (owner: string) =>
  rpcPost<Schedule[]>("agent_schedule_list", { p_owner: owner });
export const getSchedule = (owner: string, id: string) =>
  rpcPost<Schedule | null>("agent_schedule_get", { p_owner: owner, p_id: id });
export const deleteSchedule = (owner: string, id: string) =>
  rpcPost<boolean>("agent_schedule_delete", { p_owner: owner, p_id: id });
export const claimSchedules = (limit = 2) =>
  rpcPost<(Schedule & { owner: string })[]>("agent_schedules_claim", { p_limit: limit });
export const finishSchedule = (
  id: string,
  status: string,
  fileId: string | null,
  nextRunAt: number | null,
) =>
  rpcPost<null>("agent_schedule_finish", {
    p_id: id,
    p_status: status,
    p_file: fileId,
    p_next_run_at: nextRunAt === null ? null : new Date(nextRunAt).toISOString(),
  });
export const claimTick = (token: string) =>
  rpcPost<boolean>("agent_tick_claim", { p_token: token });

// ------------------------------------------------------------------------------------------------- signed links

const enc = new TextEncoder();
async function linkKey(): Promise<CryptoKey | null> {
  const base =
    process.env["NAVIGATOR_SIGNING_KEY"]?.trim() || process.env["EXTERNAL_SUPABASE_KEY"]?.trim();
  if (!base) return null;
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(`agent-file-link|${base}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** A download link for one file, valid for `ttlSec` (default one hour). */
export async function signedFileUrl(
  owner: string,
  id: string,
  ttlSec = 3600,
  now = Date.now(),
): Promise<string | null> {
  const key = await linkKey();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${owner}|${id}|${exp}`)));
  return `/api/agent/file?o=${owner}&id=${id}&exp=${exp}&sig=${sig}`;
}

export async function verifyFileLink(
  owner: string,
  id: string,
  exp: number,
  sig: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const key = await linkKey();
  if (!key) return false;
  const want = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${owner}|${id}|${exp}`)));
  if (want.length !== sig.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
