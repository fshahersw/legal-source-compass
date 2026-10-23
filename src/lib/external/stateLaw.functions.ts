/**
 * What the atlas holds of one state's law, for the overview's Law section: the constitution record (state_constitutions),
 * the administrative code record (state_regulation_codes), state rules-of-court documents (court_rule_documents) and the
 * number of limitation periods recorded (limitation_periods, counted only; rules are never read or changed here).
 * The statutory code itself comes from getStateCodeEntry. Read-only, bounded reads keyed by exact state code; a part that
 * fails to load is named in `unavailable`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  parseConstitution,
  parseRegulationCode,
  type Constitution,
  type RegulationCode,
} from "./courtRulesLaw.functions";
import { num, obj, str } from "./placeAnalysisParse";
import { restGet } from "./rest.server";

export type RuleDocument = {
  id: string;
  title: string;
  sections: number | null;
  status: string | null;
  url: string | null;
};
export type StateLaw = {
  usps: string;
  constitution: Constitution | null;
  regulations: RegulationCode | null;
  rules: RuleDocument[];
  limitations: number | null;
  unavailable: ("constitution" | "regulations" | "rules" | "limitations")[];
};

const official = (v: unknown): string | null => {
  const s = str(v, 600);
  return /^https?:\/\/[^\s]+$/.test(s) ? s : null;
};

/** One rules-of-court document row; rows without an id or title are dropped. */
export function parseRuleDocument(row: {
  id: unknown;
  title: unknown;
  c: unknown;
  u: unknown;
}): RuleDocument | null {
  const id = str(row.id, 80);
  const title = str(row.title, 200);
  if (!/^[a-z0-9-]{2,80}$/.test(id) || !title) return null;
  const cells = obj(row.c);
  return {
    id,
    title,
    sections: num(cells["sections"]),
    status: str(cells["status"], 120) || null,
    url: official(row.u),
  };
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: StateLaw }>();

export const getStateLaw = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(/^[A-Z]{2}$/) }).parse(d))
  .handler(async ({ data }): Promise<StateLaw> => {
    const hit = cache.get(data.usps);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const u = data.usps;
    const reads = await Promise.allSettled([
      restGet<{ title: unknown; c: unknown }[]>(
        `corpus_records?select=title,c:item->constitution&dataset=eq.state_constitutions&id=eq.${u}&limit=1`,
      ),
      restGet<{ c: unknown }[]>(
        `corpus_records?select=c:item->regulation_code&dataset=eq.state_regulation_codes&id=eq.${u}&limit=1`,
      ),
      restGet<{ id: unknown; title: unknown; c: unknown; u: unknown }[]>(
        `corpus_records?select=id,title,c:item->cells,u:item->rule_document->>url&dataset=eq.court_rule_documents&state=eq.${u}&order=ordinal.asc&limit=60`,
      ),
      restGet<unknown[]>(`corpus_records?select=id&dataset=eq.limitation_periods&state=eq.${u}`, {
        count: true,
        range: [0, 0],
      }),
    ]);
    const unavailable: StateLaw["unavailable"] = [];
    const ok = <T>(r: PromiseSettledResult<T>, part: StateLaw["unavailable"][number]): T | null => {
      if (r.status === "fulfilled") return r.value;
      unavailable.push(part);
      return null;
    };
    const con = ok(reads[0], "constitution");
    const reg = ok(reads[1], "regulations");
    const rules = ok(reads[2], "rules");
    const lim = ok(reads[3], "limitations");
    const value: StateLaw = {
      usps: u,
      constitution: con?.rows[0] ? parseConstitution(con.rows[0].title, con.rows[0].c) : null,
      regulations: reg?.rows[0] ? parseRegulationCode(reg.rows[0].c) : null,
      rules: (rules?.rows ?? []).flatMap((r) => {
        const d = parseRuleDocument(r);
        return d ? [d] : [];
      }),
      limitations: lim ? (lim.total ?? lim.rows.length) : null,
      unavailable,
    };
    if (!unavailable.length) cache.set(u, { at: Date.now(), value });
    return value;
  });
