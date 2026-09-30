import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { intParam, json, optionsResponse, requireApiKey } from "@/lib/external/apiAuth.server";

const filterKey = z.string().regex(/^[a-z0-9_]{1,40}$/);

/**
 * GET /api/public/corpus/search
 * Bounded, paginated search across the corpus (or one dataset).
 * Params: q (2..200 chars), dataset, limit (1..100, default 50),
 * offset (0..1,000,000), plus filter.<key>=value metadata filters
 * (e.g. filter.state=TX, filter.kind=statutes).
 */
export const Route = createFileRoute("/api/public/corpus/search")({
  server: {
    handlers: {
      OPTIONS: async () => optionsResponse(),
      GET: async ({ request }) => {
        const denied = requireApiKey(request);
        if (denied) return denied;
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").trim();
        const dataset = url.searchParams.get("dataset")?.trim() || null;
        if (dataset && !/^[a-z0-9_]{1,80}$/.test(dataset)) return json({ error: "Invalid dataset id." }, 400);
        if (q && (q.length < 2 || q.length > 200)) return json({ error: "q must be 2..200 characters." }, 400);
        const limit = intParam(url, "limit", 50, 1, 100);
        const offset = intParam(url, "offset", 0, 0, 1_000_000);

        const filters: Record<string, string> = {};
        for (const [k, v] of url.searchParams) {
          if (!k.startsWith("filter.")) continue;
          const key = k.slice("filter.".length);
          if (!filterKey.safeParse(key).success || v.length > 200) return json({ error: `Invalid filter: ${k}` }, 400);
          filters[key] = v;
        }

        const { rpcPost } = await import("@/lib/external/rest.server");
        // Dataset-scoped queries use the bounded listing function; cross-dataset
        // keyword search uses the corpus's own ranked search function.
        const res = dataset
          ? await rpcPost<{ items: Record<string, any>[]; total: number | null; total_capped: boolean }>("corpus_query_bounded", {
              p_q: q || null,
              p_dataset: dataset,
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
              p_count_cap: 10000,
            })
          : await rpcPost<{ items: Record<string, any>[]; total: number | null; total_capped: boolean }>("corpus_query", {
              p_q: q || null,
              p_datasets: null,
              p_filters: filters,
              p_limit: limit,
              p_offset: offset,
              p_sort: null,
            });
        const items = (res.items ?? []).map((i) => ({
          id: String(i["id"] ?? ""),
          dataset: i["dataset"] ?? dataset,
          title: typeof i["title"] === "string" ? (i["title"] as string).replace(/\s+/g, " ").trim() : (i["title"] ?? null),
          state: i["state"] ?? null,
          county: i["county"] ?? null,
          kind: i["kind"] ?? i["group"] ?? null,
          source_url: i["source_url"] ?? null,
          ...Object.fromEntries(Object.entries(i).filter(([k]) => !["id", "dataset", "title", "state", "county", "kind", "group", "source_url"].includes(k))),
        }));
        return json({ items, total: res.total ?? null, totalCapped: !!res.total_capped, limit, offset });
      },
    },
  },
});
