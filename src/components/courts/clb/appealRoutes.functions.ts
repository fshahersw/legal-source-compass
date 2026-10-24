/** Read-only server function for a court's record in clb_court_appeals_to (null when the court has none). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import { parseAppealRoutes, type AppealRoutes } from "./appealRoutes";

export const getClbAppealRoutes = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ court: z.string().regex(/^[a-z0-9_-]{1,40}$/) }).parse(d))
  .handler(async ({ data }): Promise<AppealRoutes | null> => {
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_court_appeals_to&id=eq.court:${data.court}&limit=1`,
    );
    return r.rows.length === 1 ? parseAppealRoutes(r.rows[0]!.p, data.court) : null;
  });
