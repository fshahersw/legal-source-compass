import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet, rpcPost } from "./rest.server";

const ds = z.string().regex(/^[a-z0-9_]{1,80}$/);

/** Full structured record from the corpus's own detail function, as plain JSON. */
export const getEntity = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ dataset: ds, id: z.string().min(1).max(300) }).parse(d))
  .handler(async ({ data }): Promise<{ json: string | null }> => {
    const pid = data.dataset === "mdls" ? data.id.replace(/^mdl:/, "") : data.id;
    const d = await rpcPost<unknown>("corpus_detail", { p_id: pid, p_datasets: [data.dataset], p_full: false });
    if (!d || typeof d !== "object") return { json: null };
    return { json: JSON.stringify(d) };
  });

export type NameRow = { id: string; title: string; state: string | null; subtitle: string | null };
const NAME_DATASETS = ["judges", "mdl_counsel", "counsel_directory", "people"] as const;

/** A–Z name index for a people dataset: names starting with a letter, paginated, with a real count. */
export const listNames = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ dataset: z.enum(NAME_DATASETS), letter: z.string().regex(/^[A-Z]$/), offset: z.number().int().min(0).max(100000).default(0) }).parse(d))
  .handler(async ({ data }) => {
    const r = await restGet<{ id: string; title: string | null; state: string | null; category: string | null }[]>(
      `corpus_records?select=id,title,state,category&dataset=eq.${data.dataset}&title=ilike.${data.letter}*&order=title.asc`,
      { count: true, range: [data.offset, data.offset + 199] },
    );
    const rows: NameRow[] = r.rows.map((x) => ({ id: x.id, title: (x.title ?? x.id).replace(/\s+/g, " ").trim(), state: x.state || null, subtitle: x.category || null }));
    return { rows, total: r.total, pageSize: 200 };
  });
