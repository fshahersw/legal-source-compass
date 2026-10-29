import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY = 14 * 1024 * 1024;
const KINDS = ["document", "image", "figure", "note", "data", "report"] as const;
const MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/markdown",
  "text/plain",
  "text/csv",
  "application/json",
]);

/**
 * The agent folder: list files (with short-lived download links), add one (a Python figure, a note), rename, pin or
 * mark read, and delete. Scoped to the caller's workspace.
 */
export const Route = createFileRoute("/api/agent/files")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { guard, json, failure } = await import("@/lib/agent/http.server");
        const who = await guard(request, "files");
        if (who instanceof Response) return who;
        const { listFiles, signedFileUrl } = await import("@/lib/agent/store.server");
        const { folderHref } = await import("@/lib/agent/tools.server");
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        const limit = Math.min(
          120,
          Math.max(0, Number(url.searchParams.get("limit") ?? "60") || 0),
        );
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
        try {
          const out = await listFiles(who.owner, {
            kind: KINDS.includes(kind as (typeof KINDS)[number])
              ? (kind as (typeof KINDS)[number])
              : null,
            limit: limit || 1,
            offset,
          });
          const rows = limit
            ? await Promise.all(
                out.rows.map(async (f) => ({
                  id: f.id,
                  kind: f.kind,
                  title: f.title,
                  mime: f.mime,
                  bytes: f.bytes,
                  source: f.source,
                  meta: f.meta,
                  unread: f.unread,
                  pinned: f.pinned,
                  created_at: f.created_at,
                  snippet: f.snippet ?? null,
                  url: await signedFileUrl(who.owner, f.id),
                  href: folderHref(f.id),
                })),
              )
            : [];
          return json({ total: out.total, unread: out.unread, rows });
        } catch (error) {
          return failure(error, "The folder could not be read.");
        }
      },
      POST: async ({ request }) => {
        const { guard, json, readJson, failure } = await import("@/lib/agent/http.server");
        const who = await guard(request, "files-write", 120);
        if (who instanceof Response) return who;
        const body = await readJson(request, MAX_BODY);
        if (body instanceof Response) return body;
        const kind = KINDS.includes(body["kind"] as (typeof KINDS)[number])
          ? (body["kind"] as (typeof KINDS)[number])
          : "note";
        const mime =
          typeof body["mime"] === "string" && MIMES.has(body["mime"]) ? body["mime"] : null;
        if (!mime) return json({ error: "That file type is not accepted." }, 400);
        const title =
          typeof body["title"] === "string" && body["title"].trim()
            ? body["title"].trim().slice(0, 300)
            : "Untitled";
        const source = typeof body["source"] === "string" ? body["source"].slice(0, 200) : "upload";
        let bytes: Uint8Array | null = null;
        let text: string | null = null;
        if (typeof body["base64"] === "string") {
          if (!/^image\//.test(mime)) return json({ error: "Only images are sent as bytes." }, 400);
          try {
            const bin = atob(body["base64"]);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          } catch {
            return json({ error: "The image could not be read." }, 400);
          }
          const png =
            bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
          const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
          const webp =
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
          if (!(png || jpg || webp)) return json({ error: "The image could not be read." }, 400);
        } else if (typeof body["text"] === "string") {
          if (/^image\//.test(mime)) return json({ error: "Images are sent as bytes." }, 400);
          text = body["text"].slice(0, 400_000);
        } else return json({ error: "The file is empty." }, 400);
        const { saveFile, signedFileUrl } = await import("@/lib/agent/store.server");
        const { folderHref } = await import("@/lib/agent/tools.server");
        try {
          const f = await saveFile(who.owner, { kind, title, mime, bytes, text, source });
          return json({
            file: {
              id: f.id,
              title: f.title,
              kind: f.kind,
              mime: f.mime,
              url: await signedFileUrl(who.owner, f.id),
              href: folderHref(f.id),
            },
          });
        } catch (error) {
          return failure(error, "The file could not be saved.");
        }
      },
      PATCH: async ({ request }) => {
        const { guard, json, readJson, failure, UUID_RE } = await import("@/lib/agent/http.server");
        const who = await guard(request, "files-write", 120);
        if (who instanceof Response) return who;
        const body = await readJson(request, 8192);
        if (body instanceof Response) return body;
        const id = typeof body["id"] === "string" ? body["id"] : "";
        if (!UUID_RE.test(id)) return json({ error: "A file id is required." }, 400);
        const { updateFile } = await import("@/lib/agent/store.server");
        try {
          const f = await updateFile(who.owner, id, {
            ...(typeof body["title"] === "string" && body["title"].trim()
              ? { title: body["title"].trim().slice(0, 300) }
              : {}),
            ...(typeof body["pinned"] === "boolean" ? { pinned: body["pinned"] } : {}),
            ...(typeof body["unread"] === "boolean" ? { unread: body["unread"] } : {}),
          });
          if (!f) return json({ error: "No such file." }, 404);
          return json({ ok: true });
        } catch (error) {
          return failure(error, "The file could not be changed.");
        }
      },
      DELETE: async ({ request }) => {
        const { guard, json, failure, UUID_RE } = await import("@/lib/agent/http.server");
        const who = await guard(request, "files-write", 120);
        if (who instanceof Response) return who;
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!UUID_RE.test(id)) return json({ error: "A file id is required." }, 400);
        const { deleteFile } = await import("@/lib/agent/store.server");
        try {
          return json({ deleted: await deleteFile(who.owner, id) });
        } catch (error) {
          return failure(error, "The file could not be deleted.");
        }
      },
    },
  },
});
