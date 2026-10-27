/**
 * MDL venue reads for Courts & judges: MDL hub history (court_jb_districts), FCMS speed and backlog history
 * (fcms_court_profiles), the vacancy x MDL board (judicial_vacancies, judge_cross_districts, judge_cross_profiles),
 * the local-rule practice matrix (court_rule_insights), the transferee-venue scorecard (adds county_profiles and
 * census_acs_cvap_counties) and federal enforcement per district (sec_enforcement_actions, doj_press_releases_*).
 * Read-only; every join is by exact court id, FJC id or county FIPS; the pure models live in src/lib/courts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { restGet } from "./rest.server";
import { countRows, mapLimit, readAllRows } from "@/lib/analytics/tally.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import { parseHubDistrict, type HubDistrict } from "@/lib/courts/mdlHubs";
import { parseFcmsDistrict, type FcmsDistrict } from "@/lib/courts/fcmsHistory";
import {
  buildBoard,
  type Board,
  type DistrictLoadInput,
  type MdlJudgeInput,
  type VacancyInput,
} from "@/lib/courts/vacancyMdl";
import { parseRuleInsight, type RuleInsight } from "@/lib/courts/venuePractice";
import {
  districtCvap,
  parseCountyDistrict,
  parseCvapCounty,
  type DistrictCvap,
} from "@/lib/courts/venueScorecard";
import { parseSecRow, type SecRow } from "@/lib/courts/districtEnforcement";

const COURT_ID = /^[a-z0-9]{2,16}$/;
type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?[\d,]+(\.\d+)?$/.test(v.trim()))
    return Number(v.replace(/,/g, ""));
  return null;
};
const cs = (v: Record<string, string[]>) => encodeURIComponent(JSON.stringify(v));
const failed = (what: string) => (e: unknown) => {
  console.error(what, e);
  throw new Error("This data could not be read just now.");
};

/** Keyed variant of memoAsync: one memo per key. */
function memoBy<T>(fn: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const memos = new Map<string, () => Promise<T>>();
  return (key) => {
    let m = memos.get(key);
    if (!m) {
      m = memoAsync(READ_TTL_MS, () => fn(key));
      memos.set(key, m);
    }
    return m();
  };
}

// ------------------------------------------------------------------------------------------------ MDL hubs

export type HubsPayload = { districts: HubDistrict[]; readAt: string };

const HUB_SELECT =
  "id,source_url,court_id:item->court_id,title:item->title,years:item->years,series:item->series,dash:item->dash,unreconciled_years:item->unreconciled_years";

const readHubs = memoAsync(READ_TTL_MS, async (): Promise<HubsPayload> => {
  const raw = await readAllRows<Json>(
    `corpus_records?select=${HUB_SELECT}&dataset=eq.court_jb_districts&order=ordinal.asc`,
    { max: 500 },
  );
  const districts = raw.flatMap((r) => {
    const { id, source_url, ...item } = r;
    const d = parseHubDistrict({ id, source_url, item });
    return d ? [d] : [];
  });
  return { districts, readAt: new Date().toISOString() };
});

export const getMdlHubHistory = createServerFn({ method: "GET" }).handler(
  async (): Promise<HubsPayload> => readHubs().catch(failed("mdl hub history")),
);

// ------------------------------------------------------------------------------------------------ FCMS history

export type FcmsPayload = { period: string | null; districts: FcmsDistrict[]; readAt: string };

const FCMS_SELECT =
  "id,source_url,title,court:item->fcms->court_id,rank:item->fcms->rank,history:item->fcms->history";
const fcmsName = (title: unknown) =>
  typeof title === "string"
    ? title.replace(/ · FCMS .*$/, "").replace(/^U\.S\. District Court, /, "")
    : null;

const latestFcmsPeriod = memoAsync(READ_TTL_MS, async (): Promise<string | null> => {
  const r = await restGet<{ p: unknown }[]>(
    `corpus_records?select=p:filters->period->>0&dataset=eq.fcms_court_profiles&filters=cs.${cs({ kind: ["district"] })}&order=ordinal.asc&limit=1`,
  );
  const p = r.rows[0]?.p;
  return typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : null;
});

const readFcms = memoAsync(READ_TTL_MS, async (): Promise<FcmsPayload> => {
  const period = await latestFcmsPeriod();
  if (!period) return { period: null, districts: [], readAt: new Date().toISOString() };
  const raw = await readAllRows<Json>(
    `corpus_records?select=${FCMS_SELECT}&dataset=eq.fcms_court_profiles&filters=cs.${cs({ kind: ["district"], period: [period] })}&order=ordinal.asc`,
    { max: 200 },
  );
  const districts = raw.flatMap((r) => {
    const d = parseFcmsDistrict({ ...r, name: fcmsName(r["title"]) });
    return d ? [d] : [];
  });
  return { period, districts, readAt: new Date().toISOString() };
});

export const getFcmsVenues = createServerFn({ method: "GET" }).handler(
  async (): Promise<FcmsPayload> => readFcms().catch(failed("fcms venues")),
);

const readFcmsCourt = memoBy(async (id: string): Promise<FcmsDistrict | null> => {
  const r = await restGet<Json[]>(
    `corpus_records?select=${FCMS_SELECT}&dataset=eq.fcms_court_profiles&filters=cs.${cs({ court: [id], kind: ["district"] })}&order=ordinal.asc&limit=1`,
  );
  const row = r.rows[0];
  return row ? parseFcmsDistrict({ ...row, name: fcmsName(row["title"]) }) : null;
});

/** One district's latest FCMS edition with its history; null for a court FCMS does not profile as a district. */
export const getFcmsCourt = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<FcmsDistrict | null> =>
    readFcmsCourt(data.id).catch(failed("fcms court")),
  );

// ------------------------------------------------------------------------------------------------ MDL load by district

export type DistrictLoad = DistrictLoadInput & {
  mdls: {
    mdl: number;
    title: string;
    judge: string | null;
    pending: number | null;
    type: string | null;
  }[];
};

export function parseDistrictLoad(raw: unknown): DistrictLoad | null {
  const d = obj(obj(raw)?.["d"]);
  const courtId = str(d?.["court_id"], 20);
  if (!d || !courtId || !COURT_ID.test(courtId)) return null;
  return {
    courtId,
    name: str(d["name"]) ?? courtId,
    asOf: str(d["as_of"], 10),
    active: num(d["active"]),
    judgeships: num(d["judgeships"]),
    pendingMdls: num(d["pending_mdls"]),
    pendingActions: num(d["pending_actions"]),
    mdls: (Array.isArray(d["mdls"]) ? d["mdls"] : []).flatMap((m) => {
      const o = obj(m);
      const mdl = num(o?.["mdl"]);
      return o && mdl !== null && Number.isInteger(mdl) && mdl > 0
        ? [
            {
              mdl,
              title: str(o["title"], 300) ?? "",
              judge: str(o["judge"], 120),
              pending: num(o["pending"]),
              type: str(o["type"], 80),
            },
          ]
        : [];
    }),
  };
}

const readLoads = memoAsync(READ_TTL_MS, async (): Promise<DistrictLoad[]> => {
  const raw = await readAllRows<Json>(
    "corpus_records?select=id,d:item->district&dataset=eq.judge_cross_districts&order=ordinal.asc",
    { max: 500 },
  );
  return raw.flatMap((r) => {
    const d = parseDistrictLoad(r);
    return d ? [d] : [];
  });
});

// ------------------------------------------------------------------------------------------------ vacancy x MDL board

export function parseVacancyInput(raw: unknown): VacancyInput | null {
  const r = obj(raw);
  const id = str(r?.["id"], 200);
  const status = r?.["status"];
  if (!r || !id || (status !== "open" && status !== "announced")) return null;
  const court = str(r["court_id"], 20);
  const link = obj(r["link"]);
  const nid = str(link?.["fjc_nid"], 20);
  const profile = str(link?.["judge_profile_id"], 64);
  const day = (v: unknown) => {
    const s = str(v, 10);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  return {
    id,
    courtId: court && COURT_ID.test(court) ? court : null,
    courtName: str(r["court_name"], 160),
    status,
    incumbent: str(r["incumbent"], 120),
    reason: str(r["reason"], 40),
    vacancyDate: day(r["vacancy_date"]),
    daysOpen: num(r["days"]),
    fjcNid: nid && /^\d{1,10}$/.test(nid) ? nid : null,
    linkBasis: str(r["basis"], 30),
    judgeProfileId: profile && /^[a-z0-9]{8,64}$/.test(profile) ? profile : null,
  };
}

export function parseMdlJudge(raw: unknown): MdlJudgeInput | null {
  const c = obj(obj(raw)?.["c"]);
  const nid = str(c?.["nid"], 20);
  const name = str(c?.["name"], 160);
  if (!c || !nid || !name) return null;
  return {
    nid,
    name,
    pending: (Array.isArray(c["pending_mdls"]) ? c["pending_mdls"] : []).flatMap((m) => {
      const o = obj(m);
      const mdl = num(o?.["mdl"]);
      return o && mdl !== null && Number.isInteger(mdl) && mdl > 0
        ? [{ mdl, title: str(o["title"], 300) ?? "", pending: num(o["pending"]) }]
        : [];
    }),
  };
}

const VAC_SELECT =
  "id,court_id:item->court_id,court_name:item->court_name,status:item->status,incumbent:item->incumbent,reason:item->reason,vacancy_date:item->vacancy_date,days:item->days_open_as_of_2026_10_22,link:item->incumbent_fjc_link,basis:item->incumbent_link_basis";

const readVacancies = memoAsync(READ_TTL_MS, async (): Promise<VacancyInput[]> => {
  const lists = await Promise.all(
    ["open", "announced"].map((s) =>
      readAllRows<Json>(
        `corpus_records?select=${VAC_SELECT}&dataset=eq.judicial_vacancies&filters=cs.${cs({ status: [s] })}&order=ordinal.asc`,
        { max: 1000 },
      ),
    ),
  );
  return lists.flat().flatMap((r) => {
    const v = parseVacancyInput(r);
    return v ? [v] : [];
  });
});

const readMdlJudges = memoAsync(READ_TTL_MS, async (): Promise<MdlJudgeInput[]> => {
  const raw = await readAllRows<Json>(
    `corpus_records?select=id,c:item->cross&dataset=eq.judge_cross_profiles&filters=cs.${cs({ pending_mdl: ["yes"] })}&order=ordinal.asc`,
    { max: 2000 },
  );
  return raw.flatMap((r) => {
    const j = parseMdlJudge(r);
    return j ? [j] : [];
  });
});

export type BoardPayload = Board & {
  jpmlAsOf: string | null;
  fcmsPeriod: string | null;
  vacancyAsOf: string;
};

export const getVacancyMdlBoard = createServerFn({ method: "GET" }).handler(
  async (): Promise<BoardPayload> => {
    const [vacancies, loads, fcms, judges] = await Promise.all([
      readVacancies(),
      readLoads(),
      readFcms(),
      readMdlJudges(),
    ]).catch(failed("vacancy mdl board"));
    const months = new Map(
      fcms.districts.map((d) => [
        d.courtId,
        {
          value: d.june.vacant_judgeship_months.at(-1)?.value ?? null,
          rank: d.rank.vacant_judgeship_months ?? null,
        },
      ]),
    );
    const board = buildBoard(vacancies, loads, months, judges);
    const asOf =
      loads
        .map((l) => l.asOf)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null;
    return { ...board, jpmlAsOf: asOf, fcmsPeriod: fcms.period, vacancyAsOf: "2026-10-22" };
  },
);

// ------------------------------------------------------------------------------------------------ venue practice

export type PracticePayload = {
  courts: { courtId: string; name: string; pendingActions: number }[];
  rules: RuleInsight[];
  jpmlAsOf: string | null;
};

const readRules = memoBy(async (court: string): Promise<RuleInsight[]> => {
  const raw = await readAllRows<Json>(
    `corpus_records?select=id,source_url,court:filters->court->>0,ri:item->rule_insight&dataset=eq.court_rule_insights&filters=cs.${cs({ scope: ["federal_local"], court: [court] })}&order=ordinal.asc`,
    { max: 1000 },
  );
  return raw.flatMap((r) => {
    const x = parseRuleInsight(r);
    return x ? [x] : [];
  });
});

/** The districts with the most pending MDL actions (JPML report) and their local-rule values. */
export const getVenuePractice = createServerFn({ method: "GET" })
  .inputValidator((d: { top?: number | undefined } | undefined) =>
    z.object({ top: z.number().int().min(3).max(12).default(8) }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<PracticePayload> => {
    const loads = await readLoads().catch(failed("venue practice loads"));
    const top = loads
      .filter((l) => (l.pendingActions ?? 0) > 0)
      .sort((a, b) => (b.pendingActions ?? 0) - (a.pendingActions ?? 0))
      .slice(0, data.top);
    const rules = await mapLimit(top, 4, (l) => readRules(l.courtId)).catch(
      failed("venue practice rules"),
    );
    return {
      courts: top.map((l) => ({
        courtId: l.courtId,
        name: l.name,
        pendingActions: l.pendingActions ?? 0,
      })),
      rules: rules.flat(),
      jpmlAsOf:
        loads
          .map((l) => l.asOf)
          .filter((x): x is string => !!x)
          .sort()
          .at(-1) ?? null,
    };
  });

// ------------------------------------------------------------------------------------------------ venue scorecard

const readCvapByDistrict = memoAsync(READ_TTL_MS, async () => {
  const [counties, cvap] = await Promise.all([
    readAllRows<Json>(
      "corpus_records?select=id,court:item->profile->district->>court_id,division:item->profile->district->>division&dataset=eq.county_profiles&order=ordinal.asc",
      { max: 6000 },
    ),
    readAllRows<Json>(
      "corpus_records?select=id,years:item->census->years&dataset=eq.census_acs_cvap_counties&order=ordinal.asc",
      { max: 6000 },
    ),
  ]);
  const cd = counties.flatMap((r) => {
    const c = parseCountyDistrict(r);
    return c ? [c] : [];
  });
  const cv = cvap.flatMap((r) => {
    const c = parseCvapCounty(r);
    return c ? [c] : [];
  });
  return {
    byDistrict: districtCvap(cd, cv),
    countiesWithoutDistrict: cd.filter((c) => !c.courtId).length,
    counties: cd.length,
  };
});

export type ScorecardRow = {
  courtId: string;
  name: string;
  pendingActions: number;
  pendingMdls: number | null;
  massTortTitles: string[];
  weightedFilings: number | null;
  over3yPct: number | null;
  monthsToTrial: number | null;
  vacantMonths: number | null;
  cvap: DistrictCvap | null;
};

export type ScorecardPayload = {
  rows: ScorecardRow[];
  jpmlAsOf: string | null;
  fcmsPeriod: string | null;
  cvapYear: string;
  countiesWithoutDistrict: number;
  counties: number;
};

export const getVenueScorecard = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScorecardPayload> => {
    const [loads, fcms, cvap] = await Promise.all([
      readLoads(),
      readFcms(),
      readCvapByDistrict(),
    ]).catch(failed("venue scorecard"));
    const fc = new Map(fcms.districts.map((d) => [d.courtId, d]));
    const last = (d: FcmsDistrict | undefined, k: keyof FcmsDistrict["june"]) =>
      d?.june[k].at(-1)?.value ?? null;
    const rows = loads
      .filter((l) => (l.pendingActions ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.pendingActions ?? 0) - (a.pendingActions ?? 0) || a.courtId.localeCompare(b.courtId),
      )
      .map((l) => {
        const f = fc.get(l.courtId);
        return {
          courtId: l.courtId,
          name: l.name,
          pendingActions: l.pendingActions ?? 0,
          pendingMdls: l.pendingMdls,
          massTortTitles: l.mdls
            .filter((m) => m.type === "Products Liability")
            .map((m) => `MDL ${m.mdl}`),
          weightedFilings: last(f, "pj_weighted_filings"),
          over3yPct: last(f, "civil_over_3y_pct"),
          monthsToTrial: last(f, "median_months_civil_to_trial"),
          vacantMonths: last(f, "vacant_judgeship_months"),
          cvap: cvap.byDistrict.get(l.courtId) ?? null,
        };
      });
    return {
      rows,
      jpmlAsOf:
        loads
          .map((l) => l.asOf)
          .filter((x): x is string => !!x)
          .sort()
          .at(-1) ?? null,
      fcmsPeriod: fcms.period,
      cvapYear: "2024",
      countiesWithoutDistrict: cvap.countiesWithoutDistrict,
      counties: cvap.counties,
    };
  },
);

/** One district's MDL load (JPML report) and CVAP; null when the district holds no row. */
export const getCourtMdlLoad = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<DistrictLoad | null> => {
    const loads = await readLoads().catch(failed("court mdl load"));
    return loads.find((l) => l.courtId === data.id) ?? null;
  });

// ------------------------------------------------------------------------------------------------ enforcement by district

export type DistrictEnforcementPayload = {
  courtId: string;
  sec: SecRow[];
  secTotal: number;
  /** Calendar year -> DOJ press releases naming the court, for each yearly partition that exists. */
  doj: [string, number][];
  asOfYear: number;
  readAt: string;
};

const dojPartitions = memoAsync(
  READ_TTL_MS,
  async (): Promise<{ dataset: string; year: string }[]> => {
    const r = await restGet<{ id: string }[]>(
      "corpus_datasets?select=id&id=like.doj_press_releases_*&order=id.asc&limit=100",
    );
    return r.rows.flatMap((x) => {
      const m = /^doj_press_releases_(\d{4})$/.exec(x.id);
      return m ? [{ dataset: x.id, year: m[1]! }] : [];
    });
  },
);

const readEnforcement = memoBy(async (court: string): Promise<DistrictEnforcementPayload> => {
  const [secRaw, parts] = await Promise.all([
    readAllRows<Json>(
      `corpus_records?select=id,f:filters&dataset=eq.sec_enforcement_actions&filters=cs.${cs({ court: [court] })}&order=ordinal.asc`,
      { max: 10_000 },
    ),
    dojPartitions(),
  ]);
  const doj = await mapLimit(parts, 4, async (p) => {
    const n = await countRows(
      `corpus_records?dataset=eq.${p.dataset}&filters=cs.${cs({ court: [court] })}`,
    );
    return [p.year, n] as [string, number];
  });
  const sec = secRaw.flatMap((r) => {
    const s = parseSecRow(r);
    return s ? [s] : [];
  });
  const readAt = new Date();
  return {
    courtId: court,
    sec,
    secTotal: sec.length,
    doj,
    asOfYear: readAt.getUTCFullYear(),
    readAt: readAt.toISOString(),
  };
});

export const getDistrictEnforcement = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().regex(COURT_ID) }).parse(d))
  .handler(async ({ data }): Promise<DistrictEnforcementPayload> =>
    readEnforcement(data.id).catch(failed("district enforcement")),
  );
