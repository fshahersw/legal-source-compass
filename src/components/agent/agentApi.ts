/**
 * Browser calls to the agent workspace routes, with the workspace key and the session token when signed in.
 */
import { supabase } from "@/integrations/supabase/client";
import { agentHeaders } from "@/components/navigator/agentOwner";
import type { FileKind, Memory, MemoryKind, Schedule, Episode } from "@/lib/agent/store.types";

export type FolderFile = {
  id: string;
  kind: FileKind;
  title: string;
  mime: string;
  bytes: number;
  source: string | null;
  meta: Record<string, unknown>;
  unread: boolean;
  pinned: boolean;
  created_at: string;
  snippet: string | null;
  url: string | null;
  href: string;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token: string | undefined;
  try {
    token = (await supabase.auth.getSession()).data.session?.access_token;
  } catch {
    token = undefined;
  }
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...agentHeaders(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? "The agent folder could not be reached.");
  return body as T;
}

export const agentApi = {
  files: (kind?: FileKind | null, limit = 120) =>
    call<{ total: number; unread: number; rows: FolderFile[] }>(
      `/api/agent/files?limit=${limit}${kind ? `&kind=${kind}` : ""}`,
    ),
  unread: () => call<{ total: number; unread: number }>(`/api/agent/files?limit=0`),
  updateFile: (id: string, patch: { title?: string; pinned?: boolean; unread?: boolean }) =>
    call<{ ok: boolean }>(`/api/agent/files`, {
      method: "PATCH",
      body: JSON.stringify({ id, ...patch }),
    }),
  deleteFile: (id: string) =>
    call<{ deleted: boolean }>(`/api/agent/files?id=${id}`, { method: "DELETE" }),
  memory: () => call<{ memories: Memory[]; episodes: Episode[] }>(`/api/agent/memory`),
  saveMemory: (m: {
    id?: string;
    kind: MemoryKind;
    title: string;
    body: string;
    tags?: string[];
  }) => call<{ memory: Memory }>(`/api/agent/memory`, { method: "POST", body: JSON.stringify(m) }),
  deleteMemory: (id: string) =>
    call<{ deleted: boolean }>(`/api/agent/memory?id=${id}`, { method: "DELETE" }),
  schedules: () => call<{ schedules: Schedule[] }>(`/api/agent/schedules`),
  scheduleAction: (id: string, action: "pause" | "resume" | "run" | "delete") =>
    call<Record<string, unknown>>(`/api/agent/schedules`, {
      method: "POST",
      body: JSON.stringify({ id, action }),
    }),
};
