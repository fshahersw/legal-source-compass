import { createFileRoute } from "@tanstack/react-router";
import { json, optionsResponse, requireApiKey } from "@/lib/external/apiAuth.server";

/**
 * GET /api/public/corpus/record/:id?dataset=<id>
 * Full record detail: title, subtitle, facts, links, sections, text
 * (with a truncation flag), photo and qualification text.
 */
export const Route = createFileRoute("/api/public/corpus/record/$id")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request, params }) => {
        const denied = requireApiKey(request);
        if (denied) return denied;
        const id = params.id;
        if (!id || id.length > 300) return json({ error: "Invalid record id." }, 400);
        const dataset = new URL(request.url).searchParams.get("dataset")?.trim() || null;
        if (dataset && !/^[a-z0-9_]{1,80}$/.test(dataset)) return json({ error: "Invalid dataset id." }, 400);

        const { rpcPost } = await import("@/lib/external/rest.server");
        const d = await rpcPost<any>("corpus_detail", { p_id: id, p_datasets: dataset ? [dataset] : null, p_full: false });
        if (!d) return json({ error: "Record not found." }, 404);
        const facts: [string, string][] = Array.isArray(d.facts)
          ? d.facts.filter((f: unknown) => Array.isArray(f) && f.length >= 2).map((f: unknown[]) => [String(f[0]), typeof f[1] === "string" ? f[1] : JSON.stringify(f[1])])
          : [];
        return json({
          id: String(d.id ?? id),
          dataset: dataset ?? d.dataset ?? null,
          title: d.title ?? d.name ?? null,
          subtitle: d.subtitle ?? null,
          qualification: d.qualification ?? null,
          facts,
          links: Array.isArray(d.links) ? d.links.filter((l: any) => typeof l?.url === "string") : [],
          sections: Array.isArray(d.sections)
            ? d.sections.map((s: any) => ({ title: s?.title ?? s?.label ?? s?.heading ?? null, items: Array.isArray(s?.items) ? s.items : [] }))
            : [],
          text: typeof d.text === "string" ? d.text : null,
          textTruncated: !!d.text_truncated,
          photo: typeof d.photo_url === "string" ? d.photo_url : null,
        });
      },
    },
  },
});
