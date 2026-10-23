/**
 * Assistant tool that finds legal text by meaning in the semantic index (U.S. Code sections, regulations, Supreme Court opinions,
 * federal bills, CRS and Inspector General reports): the passages closest in meaning to a description, when the user's words
 * may differ from the text's own. Read-only. Hits are retrieval aids ranked by closeness of meaning; they are not citations and
 * not proof of what a provision says, so the tool says so in every result and points at the tools that read the real text.
 */
import {
  SEMANTIC_DATASETS,
  SEMANTIC_NOTE,
  datasetLabel,
  normalizeQuery,
} from "@/lib/semantic/semantic";
import { searchSemantic, type Deps } from "@/lib/semantic/semantic.server";
import type { ToolDefinition, ToolOutcome } from "./tools.server";

const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : "");
const MAX_RESULT = 14000;

export const SEMANTIC_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "semantic_search",
    description: `Find provisions, regulations, court opinions, reports and bills BY MEANING in the workspace's semantic index, for questions whose words may differ from the text's own (a situation, a concept, a duty described in plain language). Datasets: ${SEMANTIC_DATASETS.map((d) => `${d.id} (${d.label})`).join(", ")}. Returns up to 10 records ranked by closeness of meaning, each with the matching passage's opening words, its place in the record (passage n of m) and the workspace page. A hit is a lead, not a citation and not proof: before relying on one, read the real text with read_usc_section, read_cfr_section, get_opinion or get_record, and check the proposition against it. Use search_corpus for names, numbers and exact words.`,
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to find, in plain words (2-400 characters), e.g. a duty, right, remedy or situation.",
        },
        datasets: {
          type: "array",
          items: { type: "string", enum: SEMANTIC_DATASETS.map((d) => d.id) },
          description: "Optional: limit to these datasets.",
        },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
  },
];

async function semanticSearchTool(
  input: Record<string, unknown>,
  deps?: Deps,
): Promise<ToolOutcome> {
  const query = normalizeQuery(str(input["query"], 600));
  const datasets = Array.isArray(input["datasets"])
    ? input["datasets"].filter((d): d is string => typeof d === "string").slice(0, 8)
    : null;
  const limit = typeof input["limit"] === "number" ? input["limit"] : 10;
  const out = deps
    ? await searchSemantic(query, datasets, Math.min(10, limit), deps)
    : await searchSemantic(query, datasets, Math.min(10, limit));
  const unavailable = (why: string, label: string, detail: string): ToolOutcome => ({
    content: JSON.stringify({ available: false, reason: why }),
    sources: [],
    label,
    detail,
  });
  switch (out.status) {
    case "invalid":
      throw new Error(out.message);
    case "not_configured":
      return unavailable(
        "Search by meaning is not configured on this deployment. Use search_corpus for words and names.",
        "Searched by meaning",
        "not configured",
      );
    case "not_loaded":
      return unavailable(
        "The semantic index has not been loaded yet. Use search_corpus for words and names.",
        "Searched by meaning",
        "index not loaded",
      );
    case "unavailable":
      throw new Error(
        out.reason === "busy"
          ? "search by meaning is busy; try again shortly"
          : "search by meaning is temporarily unavailable",
      );
    case "ok": {
      const all = out.hits.map((h) => ({
        rank: h.rank,
        dataset: h.dataset,
        dataset_label: datasetLabel(h.dataset),
        title: h.title,
        record_id: h.recordId,
        passage: `${h.passage.number} of ${h.passage.of}`,
        snippet: h.snippet,
        page: h.href,
        source_url: h.sourceUrl,
      }));
      const note = `${SEMANTIC_NOTE} Ranked by closeness of meaning (1 is closest); read the record before relying on it.`;
      let results = all;
      const body = () =>
        JSON.stringify({ query: out.query, note, returned: results.length, results });
      while (results.length > 1 && body().length > MAX_RESULT) results = results.slice(0, -1);
      return {
        content: body(),
        sources: out.hits
          .slice(0, 6)
          .map((h) => ({ title: h.title, url: h.href, internal: true as const })),
        label: "Searched by meaning",
        detail: `“${out.query.slice(0, 80)}” · ${results.length} ${results.length === 1 ? "record" : "records"}`,
      };
    }
  }
}

export const SEMANTIC_EXECUTORS: Record<
  string,
  (input: Record<string, unknown>) => Promise<ToolOutcome>
> = {
  semantic_search: (input) => semanticSearchTool(input),
};

export { semanticSearchTool };
