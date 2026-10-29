import { createFileRoute } from "@tanstack/react-router";

const KINDS = ["fact", "preference", "procedure"] as const;

/** The agent's memory for the caller's workspace: list it, add or edit one entry, and delete one. */
export const Route = createFileRoute("/api/agent/memory")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { guard, json, failure } = await import("@/lib/agent/http.server");
        const who = await guard(request, "memory");
        if (who instanceof Response) return who;
        const { listMemories, listEpisodes } = await import("@/lib/agent/store.server");
        try {
          const [memories, episodes] = await Promise.all([
            listMemories(who.owner),
            listEpisodes(who.owner, 20),
          ]);
          return json({ memories, episodes });
        } catch (error) {
          return failure(error, "Memory could not be read.");
        }
      },
      POST: async ({ request }) => {
        const { guard, json, readJson, failure, UUID_RE } = await import("@/lib/agent/http.server");
        const who = await guard(request, "memory-write", 120);
        if (who instanceof Response) return who;
        const body = await readJson(request, 16384);
        if (body instanceof Response) return body;
        const kind = KINDS.includes(body["kind"] as (typeof KINDS)[number])
          ? (body["kind"] as (typeof KINDS)[number])
          : "fact";
        const title = typeof body["title"] === "string" ? body["title"].trim() : "";
        const text = typeof body["body"] === "string" ? body["body"].trim() : "";
        if (!title || !text) return json({ error: "A memory needs a title and a body." }, 400);
        const id = typeof body["id"] === "string" && UUID_RE.test(body["id"]) ? body["id"] : null;
        const tags = Array.isArray(body["tags"])
          ? body["tags"].filter((t): t is string => typeof t === "string")
          : [];
        const { putMemory } = await import("@/lib/agent/store.server");
        try {
          return json({
            memory: await putMemory(who.owner, { id, kind, title, body: text, tags }),
          });
        } catch (error) {
          return failure(error, "The memory could not be saved.");
        }
      },
      DELETE: async ({ request }) => {
        const { guard, json, failure, UUID_RE } = await import("@/lib/agent/http.server");
        const who = await guard(request, "memory-write", 120);
        if (who instanceof Response) return who;
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!UUID_RE.test(id)) return json({ error: "A memory id is required." }, 400);
        const { deleteMemory } = await import("@/lib/agent/store.server");
        try {
          return json({ deleted: await deleteMemory(who.owner, id) });
        } catch (error) {
          return failure(error, "The memory could not be deleted.");
        }
      },
    },
  },
});
