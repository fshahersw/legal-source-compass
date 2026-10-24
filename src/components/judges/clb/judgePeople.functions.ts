/**
 * Read-only server functions for a judge page's CourtListener people-database record (clb_judge_people) and disclosure
 * contents (clb_judge_disclosure_items). The page reaches a CourtListener person only through the judge crosswalk
 * (judge_cl_crosswalk, linked tiers), exactly as the page's other CourtListener panels do; records are read by that
 * person id. Returns null when the page is not linked or the record is absent.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "@/lib/external/rest.server";
import {
  JUDGE_ID,
  parseCrosswalk,
  type CrosswalkTier,
} from "@/lib/external/judgeCourtListener.functions";
import {
  parseDisclosureItems,
  parseJudgePeople,
  type DisclosureItems,
  type JudgePeople,
} from "./judgePeople";

export type Linked<T> = { tier: CrosswalkTier; data: T };

async function linkedPerson(judgeId: string) {
  const x = await restGet<{ p: unknown }[]>(
    `corpus_records?select=p:item->profile&dataset=eq.judge_cl_crosswalk&id=eq.${judgeId}&limit=1`,
  );
  const c = x.rows.length === 1 ? parseCrosswalk(x.rows[0]!.p, judgeId) : null;
  return c && c.linked && c.clPersonId !== null ? { tier: c.tier, personId: c.clPersonId } : null;
}

async function profileOf(dataset: string, personId: number): Promise<unknown> {
  const r = await restGet<{ p: unknown }[]>(
    `corpus_records?select=p:item->profile&dataset=eq.${dataset}&id=eq.${personId}&limit=1`,
  );
  return r.rows.length === 1 ? r.rows[0]!.p : null;
}

export const getClbJudgePeople = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<Linked<JudgePeople> | null> => {
    const link = await linkedPerson(data.id);
    if (!link) return null;
    const p = parseJudgePeople(await profileOf("clb_judge_people", link.personId), link.personId);
    return p ? { tier: link.tier, data: p } : null;
  });

export const getClbDisclosureItems = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<Linked<DisclosureItems> | null> => {
    const link = await linkedPerson(data.id);
    if (!link) return null;
    const p = parseDisclosureItems(
      await profileOf("clb_judge_disclosure_items", link.personId),
      link.personId,
    );
    return p ? { tier: link.tier, data: p } : null;
  });
