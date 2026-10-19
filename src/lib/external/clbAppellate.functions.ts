/**
 * Appellate timing (dataset clb_appellate_timing) and recorded panels (clb_appellate_panels) from CourtListener's bulk files,
 * compiled by scripts/enrichment/courtlistener_rest. Timing uses the originating-court information attached to appellate
 * dockets; panels are the person ids CourtListener lists on opinion clusters. People and courts are exact ids; record links are
 * kept only when they name exactly that id. A judge page reaches its panel record through the judge_cl_crosswalk (linked tiers
 * only). Stored JSON is validated here; malformed values are dropped, never repaired. Read-only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { JUDGE_ID, parseCrosswalk } from "./judgeCourtListener.functions";

const obj = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const count = (v: unknown) => {
  const n = num(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
};
const pct = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const days = (v: unknown) => {
  const n = num(v);
  return n != null && n >= 0 && n < 200_000 ? n : null;
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => {
  const s = str(v, 10);
  return s && ISO_DAY.test(s) ? s : null;
};
const year = (v: unknown) => {
  const n = count(v);
  return n != null && n >= 1700 && n <= 2100 ? n : null;
};

export const APPELLATE_COURT_ID = /^[A-Za-z0-9]{2,24}$/;
const courtLink = (v: unknown, courtId: string) => {
  const s = str(v);
  return s && s === `/courts/${courtId}` ? s : null;
};
const statsLink = (v: unknown, personId: number) => {
  const s = str(v);
  return s && s === `/records/clb_judge_dockets/${personId}` ? s : null;
};

export type TimingInterval = {
  key: string;
  label: string;
  /** Appeals with both dates, the later not before the earlier. */
  n: number;
  /** Appeals whose two dates are in reverse order; left out. */
  negativeSetAside: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
};
export type AppellateTiming = {
  courtId: string;
  name: string;
  appeals: number;
  courtDockets: number | null;
  appealsPctOfDockets: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  intervals: TimingInterval[];
  byYear: {
    yr: number;
    appeals: number;
    medianDays: number | null;
    medianDaysToNotice: number | null;
  }[];
  fromCourts: {
    courtId: string;
    name: string;
    appeals: number;
    sharePct: number | null;
    medianDays: number | null;
    link: string | null;
  }[];
  lowerJudges: {
    personId: number;
    name: string;
    appeals: number;
    firstFiled: string | null;
    lastFiled: string | null;
    mainFrom: string | null;
    statsRecord: string | null;
  }[];
  lowerJudgesWithId: number | null;
  /** Share of appeals whose lower-court judge is recorded as a person id. */
  lowerJudgeIdPct: number | null;
};
export type PanelPerson = { personId: number; name: string; statsRecord: string | null };
export type AppellatePanels = {
  courtId: string;
  name: string;
  clustersWithPanel: number;
  courtClusters: number | null;
  panelPctOfClusters: number | null;
  firstFiled: string | null;
  lastFiled: string | null;
  medianSize: number | null;
  sizes: { size: number; clusters: number; sharePct: number | null }[];
  byYear: { yr: number; clusters: number; medianSize: number | null }[];
  judges: (PanelPerson & {
    panels: number;
    sharePct: number | null;
    firstFiled: string | null;
    lastFiled: string | null;
  })[];
  judgesCount: number | null;
  pairs: {
    a: PanelPerson;
    b: PanelPerson;
    panels: number;
    firstFiled: string | null;
    lastFiled: string | null;
  }[];
  pairsCount: number | null;
};
export type JudgePanels = {
  personId: number;
  name: string;
  panels: number;
  firstFiled: string | null;
  lastFiled: string | null;
  courts: { courtId: string; name: string; panels: number; link: string | null }[];
  byYear: { yr: number; panels: number }[];
  coPanelists: (PanelPerson & { panels: number })[];
  coPanelistsCount: number | null;
  joinedByOpinions: number | null;
};

function person(v: unknown): PanelPerson | null {
  const o = obj(v);
  const personId = count(o?.["person_id"]);
  const name = str(o?.["name"]);
  if (personId == null || !name) return null;
  return { personId, name, statsRecord: statsLink(o?.["stats_record"], personId) };
}

export function parseAppellateTiming(raw: unknown, courtId: string): AppellateTiming | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const name = str(p["name"]);
  const appeals = count(p["appeals"]);
  if (!name || appeals == null || appeals === 0) return null;
  const intervals: TimingInterval[] = arr(p["intervals"]).flatMap((x) => {
    const o = obj(x);
    const key = str(o?.["key"], 40);
    const label = str(o?.["label"], 120);
    const n = count(o?.["n"]);
    const neg = count(o?.["negative_set_aside"]);
    if (!key || !label || n == null || neg == null || n > appeals) return [];
    const q = [days(o?.["p25"]), days(o?.["p50"]), days(o?.["p75"])];
    const ordered = q.every((v) => v != null) && q[0]! <= q[1]! && q[1]! <= q[2]!;
    return [
      {
        key,
        label,
        n,
        negativeSetAside: neg,
        p25: ordered ? q[0]! : null,
        p50: ordered ? q[1]! : null,
        p75: ordered ? q[2]! : null,
      },
    ];
  });
  const fields = obj(p["fields"]);
  const withId = count(fields?.["lower_judge_id"]);
  return {
    courtId,
    name,
    appeals,
    courtDockets: count(p["court_dockets"]),
    appealsPctOfDockets: pct(p["appeals_pct_of_dockets"]),
    firstFiled: day(p["first_filed"]),
    lastFiled: day(p["last_filed"]),
    intervals,
    byYear: arr(p["by_year"])
      .flatMap((x) => {
        const o = obj(x);
        const yr = year(o?.["yr"]);
        const n = count(o?.["appeals"]);
        return yr != null && n != null && n <= appeals
          ? [
              {
                yr,
                appeals: n,
                medianDays: days(o?.["median_days"]),
                medianDaysToNotice: days(o?.["median_days_to_notice"]),
              },
            ]
          : [];
      })
      .sort((a, b) => a.yr - b.yr),
    fromCourts: arr(p["from_courts"]).flatMap((x) => {
      const o = obj(x);
      const id = str(o?.["court_id"], 24);
      const nm = str(o?.["name"]);
      const n = count(o?.["appeals"]);
      return id && APPELLATE_COURT_ID.test(id) && nm && n != null && n <= appeals
        ? [
            {
              courtId: id,
              name: nm,
              appeals: n,
              sharePct: pct(o?.["share_pct"]),
              medianDays: days(o?.["median_days"]),
              link: courtLink(o?.["link"], id),
            },
          ]
        : [];
    }),
    lowerJudges: arr(p["lower_judges"]).flatMap((x) => {
      const pp = person(x);
      const o = obj(x);
      const n = count(o?.["appeals"]);
      return pp && n != null && n <= appeals
        ? [
            {
              ...pp,
              appeals: n,
              firstFiled: day(o?.["first_filed"]),
              lastFiled: day(o?.["last_filed"]),
              mainFrom: str(o?.["main_from_name"]),
            },
          ]
        : [];
    }),
    lowerJudgesWithId: count(p["lower_judges_with_id"]),
    lowerJudgeIdPct: withId != null && appeals ? Math.round((1000 * withId) / appeals) / 10 : null,
  };
}

export function parseAppellatePanels(raw: unknown, courtId: string): AppellatePanels | null {
  const p = obj(raw);
  if (!p || p["court_id"] !== courtId) return null;
  const name = str(p["name"]);
  const clusters = count(p["clusters_with_panel"]);
  if (!name || clusters == null || clusters === 0) return null;
  return {
    courtId,
    name,
    clustersWithPanel: clusters,
    courtClusters: count(p["court_clusters"]),
    panelPctOfClusters: pct(p["panel_pct_of_clusters"]),
    firstFiled: day(p["first_filed"]),
    lastFiled: day(p["last_filed"]),
    medianSize: num(p["median_size"]),
    sizes: arr(p["sizes"]).flatMap((x) => {
      const o = obj(x);
      const size = count(o?.["size"]);
      const n = count(o?.["clusters"]);
      return size != null && size > 0 && size < 50 && n != null && n <= clusters
        ? [{ size, clusters: n, sharePct: pct(o?.["share_pct"]) }]
        : [];
    }),
    byYear: arr(p["by_year"])
      .flatMap((x) => {
        const o = obj(x);
        const yr = year(o?.["yr"]);
        const n = count(o?.["clusters"]);
        return yr != null && n != null && n <= clusters
          ? [{ yr, clusters: n, medianSize: num(o?.["median_size"]) }]
          : [];
      })
      .sort((a, b) => a.yr - b.yr),
    judges: arr(p["judges"]).flatMap((x) => {
      const pp = person(x);
      const o = obj(x);
      const n = count(o?.["panels"]);
      return pp && n != null && n <= clusters
        ? [
            {
              ...pp,
              panels: n,
              sharePct: pct(o?.["share_pct"]),
              firstFiled: day(o?.["first_filed"]),
              lastFiled: day(o?.["last_filed"]),
            },
          ]
        : [];
    }),
    judgesCount: count(p["judges_count"]),
    pairs: arr(p["pairs"]).flatMap((x) => {
      const o = obj(x);
      const a = person(o?.["a"]);
      const b = person(o?.["b"]);
      const n = count(o?.["panels"]);
      return a && b && a.personId !== b.personId && n != null && n <= clusters
        ? [
            {
              a,
              b,
              panels: n,
              firstFiled: day(o?.["first_filed"]),
              lastFiled: day(o?.["last_filed"]),
            },
          ]
        : [];
    }),
    pairsCount: count(p["pairs_count"]),
  };
}

export function parseJudgePanels(raw: unknown, personId: number): JudgePanels | null {
  const p = obj(raw);
  if (!p || p["person_id"] !== personId) return null;
  const name = str(p["name"]);
  const panels = count(p["panels"]);
  if (!name || panels == null || panels === 0) return null;
  return {
    personId,
    name,
    panels,
    firstFiled: day(p["first_filed"]),
    lastFiled: day(p["last_filed"]),
    courts: arr(p["courts"]).flatMap((x) => {
      const o = obj(x);
      const id = str(o?.["court_id"], 24);
      const nm = str(o?.["name"]);
      const n = count(o?.["panels"]);
      return id && APPELLATE_COURT_ID.test(id) && nm && n != null && n <= panels
        ? [{ courtId: id, name: nm, panels: n, link: courtLink(o?.["link"], id) }]
        : [];
    }),
    byYear: arr(p["by_year"])
      .flatMap((x) => {
        const o = obj(x);
        const yr = year(o?.["yr"]);
        const n = count(o?.["panels"]);
        return yr != null && n != null && n <= panels ? [{ yr, panels: n }] : [];
      })
      .sort((a, b) => a.yr - b.yr),
    coPanelists: arr(p["co_panelists"]).flatMap((x) => {
      const pp = person(x);
      const n = count(obj(x)?.["panels"]);
      return pp && pp.personId !== personId && n != null && n <= panels
        ? [{ ...pp, panels: n }]
        : [];
    }),
    coPanelistsCount: count(p["co_panelists_count"]),
    joinedByOpinions: count(p["joined_by_opinions"]),
  };
}

export type AppellateCourt = { timing: AppellateTiming | null; panels: AppellatePanels | null };

export const getClbAppellateCourt = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(APPELLATE_COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<AppellateCourt> => {
    const id = encodeURIComponent(data.id);
    const [t, pn] = await Promise.all([
      restGet<{ p: unknown }[]>(
        `corpus_records?select=p:item->profile&dataset=eq.clb_appellate_timing&id=eq.${id}&limit=1`,
      ),
      restGet<{ p: unknown }[]>(
        `corpus_records?select=p:item->profile&dataset=eq.clb_appellate_panels&id=eq.court:${id}&limit=1`,
      ),
    ]);
    return {
      timing: t.rows.length === 1 ? parseAppellateTiming(t.rows[0]!.p, data.id) : null,
      panels: pn.rows.length === 1 ? parseAppellatePanels(pn.rows[0]!.p, data.id) : null,
    };
  });

/** A judge page's panel record: only for a crosswalk tier that links the page to exactly one CourtListener person. */
export const getClbJudgePanels = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(JUDGE_ID) }).parse(d))
  .handler(async ({ data }): Promise<JudgePanels | null> => {
    const x = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.judge_cl_crosswalk&id=eq.${data.id}&limit=1`,
    );
    const c = x.rows.length === 1 ? parseCrosswalk(x.rows[0]!.p, data.id) : null;
    if (!c || !c.linked || c.clPersonId === null) return null;
    const r = await restGet<{ p: unknown }[]>(
      `corpus_records?select=p:item->profile&dataset=eq.clb_appellate_panels&id=eq.judge:${c.clPersonId}&limit=1`,
    );
    return r.rows.length === 1 ? parseJudgePanels(r.rows[0]!.p, c.clPersonId) : null;
  });
