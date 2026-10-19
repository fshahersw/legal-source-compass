/**
 * MDL network views over three published datasets built from the matter registry joined to CourtListener dockets by exact docket id:
 * mdl_hierarchy (per MDL: master docket, transferee judge, member actions by evidence, originating courts), judge_flows (originating
 * judge to transferee judge edges, by exact CourtListener person ids) and mdl_state_scope (originating dockets per state and the
 * across-state associations with multiplicity control). Read-only; malformed values are dropped, never guessed, and only in-app links
 * of known shapes are kept.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { parseCrosswalk, JUDGE_ID } from "./judgeCourtListener.functions";
import { restGet } from "./rest.server";

export type PersonRef = { name: string; personId: number; link: string | null };
export type YearN = { year: number; n: number };
export type OriginCourt = {
  courtId: string;
  court: string;
  state: string | null;
  dockets: number;
  link: string | null;
};
export type MdlHierarchy = {
  mdl: number;
  title: string;
  actions: number;
  records: number | null;
  jpmlTotal: number | null;
  jpmlPending: number | null;
  registrySharePct: number | null;
  masterDocket: { number: string | null; clDocketId: number | null } | null;
  transfereeCourt: { id: string; name: string } | null;
  transfereeJudge: PersonRef | null;
  judgeAsPrinted: string | null;
  memberJudges: {
    joined: number | null;
    top: (PersonRef & { dockets: number; sharePct: number | null })[];
  };
  byBasis: { basis: string; label: string; actions: number }[];
  membersByYear: YearN[];
  origin: {
    dockets: number;
    courts: number | null;
    states: number | null;
    medianDaysToClose: number | null;
    daysN: number | null;
    byYear: YearN[];
    byCourt: OriginCourt[];
    byState: { state: string; dockets: number }[];
  } | null;
};
export type FlowEdge = { other: PersonRef; dockets: number; mdls: number[] };
export type JudgeMdlFlows = {
  personId: number;
  name: string | null;
  transferee: { actions: number | null; mdls: number[] } | null;
  received: FlowEdge[];
  sent: FlowEdge[];
};
export type ScopeTest = {
  key: string;
  label: string;
  n: number;
  rho: number;
  ci: [number, number] | null;
  p: number | null;
  pBh: number | null;
  holds: boolean;
};
export type StateMdlScope = {
  state: string;
  name: string;
  dockets: number;
  per100k: number | null;
  population: number | null;
  populationYear: number | null;
  rankPer100k: number | null;
  rankedStates: number;
  mdls: { mdl: number; dockets: number }[];
  tests: ScopeTest[];
  totalDockets: number | null;
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, n = 300): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown): number | null => {
  const x = num(v);
  return x !== null && x >= 0 && x <= 100 ? x : null;
};
const STATE = /^[A-Z]{2}$/;
const COURT_ID = /^[a-z0-9]{2,20}$/;
const INTERNAL = /^\/(courts|records|judges|matters|places)\/[A-Za-z0-9_:.~%/-]{1,200}$/;
const link = (v: unknown): string | null => {
  const s = text(v, 260);
  return s && INTERNAL.test(s) ? s : null;
};
const mdlNumber = (v: unknown): number | null => {
  const n = count(v);
  return n !== null && n > 0 && n < 100000 ? n : null;
};

export function parsePerson(v: unknown): PersonRef | null {
  const o = obj(v);
  const personId = count(o?.["person_id"]);
  const name = text(o?.["name"], 160);
  if (!o || personId === null || personId === 0 || !name) return null;
  return { name, personId, link: link(o["link"]) };
}

function yearRows(v: unknown, field: string): YearN[] {
  return arr(v)
    .map((r) => {
      const o = obj(r);
      const year = count(o?.["year"]);
      const n = count(o?.[field]);
      return year !== null && year >= 1950 && year <= 2100 && n !== null ? { year, n } : null;
    })
    .filter((r): r is YearN => r !== null)
    .sort((a, b) => a.year - b.year);
}

export function parseMdlHierarchy(raw: unknown, mdl: number): MdlHierarchy | null {
  const p = obj(raw);
  if (!p || mdlNumber(p["mdl"]) !== mdl) return null;
  const actions = count(p["actions"]);
  if (actions === null) return null;
  const master = obj(p["master_docket"]);
  const courtId = text(p["transferee_court"], 20);
  const courtName = text(p["transferee_court_name"], 200);
  const mj = obj(p["member_judges"]);
  const origin = obj(p["origin"]);
  const originDockets = count(origin?.["dockets"]);
  return {
    mdl,
    title: text(p["title"], 300) ?? `MDL ${mdl}`,
    actions,
    records: count(p["records"]),
    jpmlTotal: count(p["jpml_total"]),
    jpmlPending: count(p["jpml_pending"]),
    registrySharePct: num(p["registry_share_of_jpml_pct"]),
    masterDocket: master
      ? {
          number: text(master["docket_number"], 60),
          clDocketId: count(master["cl_docket_id"]) || null,
        }
      : null,
    transfereeCourt:
      courtId && COURT_ID.test(courtId) ? { id: courtId, name: courtName ?? courtId } : null,
    transfereeJudge: parsePerson(p["transferee_judge"]),
    judgeAsPrinted: text(p["judge_as_printed"], 160),
    memberJudges: {
      joined: count(mj?.["joined"]),
      top: arr(mj?.["top"])
        .map((r) => {
          const person = parsePerson(r);
          const dockets = count(obj(r)?.["dockets"]);
          return person && dockets !== null
            ? { ...person, dockets, sharePct: pct(obj(r)?.["share_pct"]) }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .slice(0, 10),
    },
    byBasis: arr(p["by_basis"])
      .map((r) => {
        const o = obj(r);
        const basis = text(o?.["basis"], 40);
        const label = text(o?.["label"], 120);
        const n = count(o?.["actions"]);
        return basis && label && n !== null ? { basis, label, actions: n } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.actions - a.actions),
    membersByYear: yearRows(p["members_by_year"], "actions"),
    origin:
      origin && originDockets !== null && originDockets > 0
        ? {
            dockets: originDockets,
            courts: count(origin["courts"]),
            states: count(origin["states"]),
            medianDaysToClose: num(origin["median_days_to_close_in_origin"]),
            daysN: count(origin["n_days"]),
            byYear: yearRows(origin["by_year"], "dockets"),
            byCourt: arr(origin["by_court"])
              .map((r) => {
                const o = obj(r);
                const id = text(o?.["court_id"], 20);
                const dockets = count(o?.["dockets"]);
                const state = text(o?.["state"], 2);
                return id && COURT_ID.test(id) && dockets !== null
                  ? {
                      courtId: id,
                      court: text(o?.["court"], 160) ?? id,
                      state: state && STATE.test(state) ? state : null,
                      dockets,
                      link: link(o?.["link"]),
                    }
                  : null;
              })
              .filter((r): r is OriginCourt => r !== null)
              .sort((a, b) => b.dockets - a.dockets),
            byState: arr(origin["by_state"])
              .map((r) => {
                const o = obj(r);
                const state = text(o?.["state"], 2);
                const dockets = count(o?.["dockets"]);
                return state && STATE.test(state) && dockets !== null ? { state, dockets } : null;
              })
              .filter((r): r is { state: string; dockets: number } => r !== null)
              .sort((a, b) => b.dockets - a.dockets),
          }
        : null,
  };
}

/** Edges whose id names this person on one side; `other` is the person on the opposite side. */
export function parseEdges(
  rows: { id: string; p: unknown }[],
  personId: number,
  side: "from" | "to",
): FlowEdge[] {
  const otherSide = side === "from" ? "to" : "from";
  return rows
    .map((r) => {
      const p = obj(r.p);
      const self = parsePerson(p?.[side]);
      const other = parsePerson(p?.[otherSide]);
      const dockets = count(p?.["dockets"]);
      if (!p || !self || self.personId !== personId || !other || !dockets) return null;
      const mdls = arr(p["mdls"])
        .map(mdlNumber)
        .filter((m): m is number => m !== null);
      return { other, dockets, mdls };
    })
    .filter((e): e is FlowEdge => e !== null)
    .sort((a, b) => b.dockets - a.dockets || a.other.name.localeCompare(b.other.name));
}

export function parseScopeTests(raw: unknown): ScopeTest[] {
  return arr(obj(raw)?.["tests"])
    .map((t) => {
      const o = obj(t);
      const key = text(o?.["key"], 60);
      const label = text(o?.["label"], 200);
      const n = count(o?.["n"]);
      const rho = num(o?.["rho"]);
      const ci = arr(o?.["ci"]).map(num);
      if (!key || !label || n === null || rho === null || rho < -1 || rho > 1) return null;
      return {
        key,
        label,
        n,
        rho,
        ci:
          ci.length === 2 && ci[0] !== null && ci[1] !== null
            ? ([ci[0], ci[1]] as [number, number])
            : null,
        p: num(o?.["p"]),
        pBh: num(o?.["p_bh"]),
        holds: o?.["survives"] === true,
      };
    })
    .filter((t): t is ScopeTest => t !== null)
    .sort((a, b) => Number(b.holds) - Number(a.holds) || Math.abs(b.rho) - Math.abs(a.rho));
}

export function parseStateScope(
  raw: unknown,
  usps: string,
  ranking: { state: string; per100k: number | null }[],
): Omit<StateMdlScope, "tests" | "totalDockets"> | null {
  const p = obj(raw);
  if (!p || text(p["state"], 2) !== usps) return null;
  const dockets = count(p["dockets"]);
  if (dockets === null) return null;
  const per100k = num(p["per_100k"]);
  const ranked = ranking
    .filter((r) => r.per100k !== null)
    .sort((a, b) => (b.per100k ?? 0) - (a.per100k ?? 0));
  const position = ranked.findIndex((r) => r.state === usps);
  return {
    state: usps,
    name: text(p["name"], 80) ?? usps,
    dockets,
    per100k,
    population: count(p["population"]),
    populationYear: count(p["population_year"]),
    rankPer100k: dockets > 0 && position >= 0 ? position + 1 : null,
    rankedStates: ranked.length,
    mdls: arr(p["mdls"])
      .map((r) => {
        const o = obj(r);
        const mdl = mdlNumber(o?.["mdl"]);
        const n = count(o?.["dockets"]);
        return mdl !== null && n !== null && n > 0 ? { mdl, dockets: n } : null;
      })
      .filter((r): r is { mdl: number; dockets: number } => r !== null)
      .sort((a, b) => b.dockets - a.dockets),
  };
}

const profileOf = async (dataset: string, id: string): Promise<unknown> => {
  const r = await restGet<{ p: unknown }[]>(
    `corpus_records?select=p:item->profile&dataset=eq.${dataset}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return r.rows[0]?.p ?? null;
};

export const getMdlHierarchy = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ mdl: z.number().int().min(1).max(99999) }).parse(d))
  .handler(async ({ data }): Promise<MdlHierarchy | null> =>
    parseMdlHierarchy(await profileOf("mdl_hierarchy", `mdl:${data.mdl}`), data.mdl),
  );

export const getJudgeMdlFlows = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<JudgeMdlFlows | null> => {
    const crosswalk = parseCrosswalk(await profileOf("judge_cl_crosswalk", data.id), data.id);
    if (!crosswalk?.linked || crosswalk.clPersonId === null) return null;
    const pid = crosswalk.clPersonId;
    const edges = (pattern: string) =>
      restGet<{ id: string; p: unknown }[]>(
        `corpus_records?select=id,p:item->profile&dataset=eq.judge_flows&id=like.${encodeURIComponent(pattern)}&limit=300`,
      ).then((r) => r.rows);
    const [transferee, sentRows, receivedRows] = await Promise.all([
      profileOf("judge_flows", `judge:${pid}`),
      edges(`edge:${pid}~*`),
      edges(`edge:*~${pid}`),
    ]);
    const t = obj(transferee);
    const tJudge = parsePerson(t?.["judge"]);
    const sent = parseEdges(sentRows, pid, "from");
    const received = parseEdges(receivedRows, pid, "to");
    const asTransferee =
      t && tJudge?.personId === pid
        ? {
            actions: count(t["actions"]),
            mdls: arr(t["mdls"])
              .map(mdlNumber)
              .filter((m): m is number => m !== null),
          }
        : null;
    if (!asTransferee && !sent.length && !received.length) return null;
    return {
      personId: pid,
      name: crosswalk.clName ?? tJudge?.name ?? null,
      transferee: asTransferee,
      received,
      sent,
    };
  });

export const getStateMdlScope = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ usps: z.string().regex(STATE) }).parse(d))
  .handler(async ({ data }): Promise<StateMdlScope | null> => {
    const [stateProfile, overview, ranking] = await Promise.all([
      profileOf("mdl_state_scope", `state:${data.usps}`),
      profileOf("mdl_state_scope", "overview:all"),
      restGet<{ c: unknown }[]>(
        "corpus_records?select=c:item->cells&dataset=eq.mdl_state_scope&id=like.state%3A*&limit=100",
      ).then((r) =>
        r.rows
          .map((row) => {
            const c = obj(row.c);
            const state = text(c?.["state"], 2);
            return state && STATE.test(state) ? { state, per100k: num(c?.["per_100k"]) } : null;
          })
          .filter((r): r is { state: string; per100k: number | null } => r !== null),
      ),
    ]);
    const state = parseStateScope(stateProfile, data.usps, ranking);
    if (!state) return null;
    return {
      ...state,
      tests: parseScopeTests(overview),
      totalDockets: count(obj(overview)?.["dockets"]),
    };
  });
