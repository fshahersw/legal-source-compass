import { createFileRoute } from "@tanstack/react-router";

const SAFE_INLINE =
  /^(image\/(png|jpeg|webp)|application\/pdf|text\/(plain|markdown|csv)|application\/json)/;

/**
 * Download one agent-folder file by its signed link (owner, id, expiry and signature in the query), so images and
 * documents open in a tab or an <img> without custom headers. HTML documents download rather than render, and every
 * response is sandboxed.
 */
export const Route = createFileRoute("/api/agent/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const owner = url.searchParams.get("o") ?? "";
        const id = url.searchParams.get("id") ?? "";
        const exp = Number(url.searchParams.get("exp") ?? "0");
        const sig = url.searchParams.get("sig") ?? "";
        if (
          !/^[a-f0-9]{64}$/.test(owner) ||
          !/^[0-9a-f-]{36}$/i.test(id) ||
          !/^[a-f0-9]{64}$/.test(sig)
        )
          return new Response("Not found", { status: 404 });
        const { verifyFileLink, getFile, fileContent, updateFile } =
          await import("@/lib/agent/store.server");
        if (!(await verifyFileLink(owner, id, exp, sig)))
          return new Response("This link has expired. Open the file again from the folder.", {
            status: 403,
          });
        try {
          const file = await getFile(owner, id);
          if (!file) return new Response("Not found", { status: 404 });
          const content = await fileContent(file);
          if (!content) return new Response("Not found", { status: 404 });
          if (file.unread) void updateFile(owner, id, { unread: false }).catch(() => undefined);
          const ext =
            {
              "text/markdown": "md",
              "text/csv": "csv",
              "text/html": "html",
              "application/pdf": "pdf",
              "application/json": "json",
              "image/png": "png",
              "image/jpeg": "jpg",
              "image/webp": "webp",
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
            }[file.mime] ?? "txt";
          const name = `${
            file.title
              .replace(/[^\w .()-]+/g, " ")
              .trim()
              .slice(0, 120) || "file"
          }.${ext}`;
          const inline = SAFE_INLINE.test(file.mime) && url.searchParams.get("download") !== "1";
          return new Response(content.body, {
            headers: {
              "content-type": content.mime,
              "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"`,
              "cache-control": "private, max-age=600",
              "x-content-type-options": "nosniff",
              // the browser's PDF viewer does not run inside a sandboxed response; PDFs carry no script of ours
              ...(file.mime === "application/pdf"
                ? {}
                : {
                    "content-security-policy":
                      "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
                  }),
              "referrer-policy": "no-referrer",
            },
          });
        } catch (error) {
          console.error("agent file", error);
          return new Response("The file could not be read.", { status: 500 });
        }
      },
    },
  },
});
