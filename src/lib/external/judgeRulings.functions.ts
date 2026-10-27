/**
 * Recorded expert-admissibility (Rule 702 / Daubert) rulings for one judge, from the planned dataset
 * judge_expert_rulings (scripts/enrichment/judge_rulings, not yet published). Until that dataset exists this returns
 * null and the judge page shows nothing for it.
 *
 * Only records the builder attributed exactly carry filters.judge_profile; the reader takes those, and nothing else.
 * Outcome and movant codes outside the published sets become "not_determined" / "other": never guessed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { JUDGE_ID } from "./judgeCourtListener.functions";

export const RULINGS_DATASET = "judge_expert_rulings";

export const RULING_OUTCOMES = [
  "granted",
  "granted_in_part",
  "denied",
  "denied_as_moot",
  "deferred",
  "not_determined",
] as const;
export type RulingOutcome = (typeof RULING_OUTCOMES)[number];
export const RULING_MOVANTS = ["plaintiff", "defendant", "other"] as const;
export type RulingMovant = (typeof RULING_MOVANTS)[number];

export type ExpertRuling = {
  id: string;
  date: string | null;
  courtId: string | null;
  docket: string | null;
  caption: string | null;
  /** Expert name as printed in the ruling. */
  expert: string | null;
  movant: RulingMovant;
  /** Movant as printed ("Defendants Bayer AG et al."). */
  movantPrinted: string | null;
  outcome: RulingOutcome;
  /** How the ruling was attributed to this judge (court + docket → assigned judge, MDL judge link + signer). */
  basis: string | null;
  sourceUrl: string | null;
};
export type JudgeExpertRulings = {
  /** corpus_datasets label, as published. */
  label: string | null;
  rulings: ExpertRuling[];
  /** The dataset's published precision note (hand-checked sample), when present. */
  precision: string | null;
  /** What the dataset covers (sources, courts, dockets), as its published metadata states it; null when not stated. */
  coverage: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const first = (v: unknown): string | null => (Array.isArray(v) ? str(v[0]) : str(v));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTP = /^https?:\/\//;

export function parseRuling(
  row: { id: unknown; source_url?: unknown; filters?: unknown; item: unknown },
  profileId: string,
): ExpertRuling | null {
  const id = str(row.id);
  const it = obj(row.item);
  const filters = obj(row.filters);
  if (!id || !it) return null;
  if (str(it["kind"]) === "judge") return null; // per-judge rollup rows are not rulings
  const linked = Array.isArray(filters?.["judge_profile"])
    ? (filters["judge_profile"] as unknown[])
    : [];
  if (linked.length !== 1 || linked[0] !== profileId) return null;
  const cells = obj(it["cells"]) ?? {};
  const outcome = first(filters?.["outcome"]) ?? str(cells["outcome"]);
  const movant = first(filters?.["movant"]) ?? str(cells["movant_side"]);
  const date = str(cells["date"]);
  const url = str(row.source_url);
  return {
    id,
    date: date && DATE.test(date) ? date : null,
    courtId: str(cells["court_id"]),
    docket: str(cells["docket_number"]),
    caption: str(cells["caption"]),
    expert: str(cells["expert"]),
    movant: (RULING_MOVANTS as readonly string[]).includes(movant ?? "")
      ? (movant as RulingMovant)
      : "other",
    movantPrinted: str(cells["movant"]),
    outcome: (RULING_OUTCOMES as readonly string[]).includes(outcome ?? "")
      ? (outcome as RulingOutcome)
      : "not_determined",
    basis: str(cells["attribution_basis"]) ?? str(obj(it["detail"])?.["attribution_basis"]),
    sourceUrl: url && HTTP.test(url) ? url : null,
  };
}

export const getJudgeExpertRulings = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<JudgeExpertRulings | null> => {
    const meta = await restGet<{ label: string | null; metadata: unknown }[]>(
      `corpus_datasets?select=label,metadata&id=eq.${RULINGS_DATASET}&limit=1`,
    );
    if (meta.rows.length !== 1) return null;
    const filter = encodeURIComponent(JSON.stringify({ judge_profile: [data.id] }));
    const rows = await restGet<
      { id: string; source_url: string | null; filters: unknown; item: unknown }[]
    >(
      `corpus_records?select=id,source_url,filters,item&dataset=eq.${RULINGS_DATASET}&filters=cs.${filter}&order=ordinal.asc&limit=1000`,
    );
    const rulings = rows.rows
      .map((r) => parseRuling(r, data.id))
      .filter((r): r is ExpertRuling => !!r)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
    const m = obj(meta.rows[0]!.metadata);
    return {
      label: str(meta.rows[0]!.label),
      rulings,
      precision: str(obj(m?.["summary"])?.["precision"]) ?? str(m?.["precision"]),
      coverage:
        str(obj(m?.["summary"])?.["coverage"]) ?? str(m?.["coverage"]) ?? str(m?.["description"]),
    };
  });
