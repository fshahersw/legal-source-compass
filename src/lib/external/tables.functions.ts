import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ilikeTerm, restGet } from "./rest.server";

/** Supporting corpus tables that sit outside corpus_records; read-only, whitelisted. */
export const EXTRA_TABLES = {
  corpus_workspace_court_map: { label: "Court map (all courts)", search: "title", order: "title.asc" },
  corpus_workspace_docket_links: { label: "Docket links", search: "docket_number", order: "event_date.desc.nullslast" },
  corpus_display_groups: { label: "Document groups", search: "id", order: "id.asc" },
  corpus_context: { label: "Context records", search: "key", order: "key.asc" },
} as const;
export type ExtraTable = keyof typeof EXTRA_TABLES;
const names = Object.keys(EXTRA_TABLES) as [ExtraTable, ...ExtraTable[]];

export const queryTable = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ table: z.enum(names), q: z.string().max(200).default(""), offset: z.number().int().min(0).max(1_000_000).default(0) }).parse(d))
  .handler(async ({ data }) => {
    const t = EXTRA_TABLES[data.table];
    const q = data.q.trim();
    const filter = q ? `&${t.search}=ilike.${ilikeTerm(q)}` : "";
    const r = await restGet<Record<string, unknown>[]>(`${data.table}?select=*${filter}&order=${t.order}`, { count: !q, range: [data.offset, data.offset + 49] });
    return { json: JSON.stringify(r.rows), total: r.total, pageSize: 50 };
  });
