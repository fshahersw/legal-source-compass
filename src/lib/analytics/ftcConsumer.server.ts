/**
 * Reads behind the FTC consumer-protection section of the Analytics overview: Do Not Call reported calls (monthly counts,
 * robocall share, subjects), HSR early terminations and the Data Spotlight posts. Each part is read on its own, so one
 * failing dataset leaves the others on screen. Read-only; results are cached for ten minutes. Server-only.
 */
import { restGet } from "@/lib/external/rest.server";
import { memoAsync, READ_TTL_MS } from "@/lib/insights/readers/cache";
import {
  dayRange,
  monthName,
  parseDncMonths,
  parseHsrFiscalYears,
  parseHsrSeries,
  parseOfficialMonths,
  parseSpotlight,
  subjectShares,
  type SpotlightPost,
  type SubjectShare,
} from "@/lib/external/ftcData";
import {
  buildDncMonthly,
  buildDncRobocallShare,
  buildHsrEarlyTerminations,
  DNC_DATA_URL,
} from "./blocks/ftcConsumer";
import type { TrendBlockData } from "./trend";

export type FtcSubjects = {
  /** What the counted window is, e.g. "complaints created September 16 to October 20, 2026". */
  window: string;
  months: string[];
  total: number;
  named: SubjectShare[];
  catchAll: SubjectShare[];
  sourceUrl: string;
};

export type FtcConsumerPart = "dnc" | "hsr" | "spotlight";

export type FtcConsumerOverview = {
  monthly: TrendBlockData | null;
  share: TrendBlockData | null;
  subjects: FtcSubjects | null;
  hsr: TrendBlockData | null;
  spotlight: SpotlightPost[];
  terms: string | null;
  /** Parts whose read failed; the rest is shown. */
  unavailable: FtcConsumerPart[];
};

const cs = (filters: Record<string, string[]>) =>
  `filters=cs.${encodeURIComponent(JSON.stringify(filters))}`;

const DNC_SELECT =
  "id,month:item->>month,complete:item->complete,method:item->>method,first:item->>first_day,last:item->>last_day,days:item->days_covered,dim:item->days_in_month,m:item->metrics,a:item->analytics,subj:item->subjects,api:item->api_count,source_url";

async function readDnc(): Promise<
  Pick<FtcConsumerOverview, "monthly" | "share" | "subjects"> & { terms: string | null }
> {
  const [national, official, summary] = await Promise.all([
    restGet<unknown[]>(
      `corpus_records?select=${DNC_SELECT}&dataset=eq.ftc_dnc_reported_calls&${cs({ kind: ["national"] })}&order=id.asc&limit=400`,
    ),
    restGet<unknown[]>(
      `corpus_records?select=${DNC_SELECT}&dataset=eq.ftc_dnc_reported_calls&${cs({ kind: ["official"] })}&order=id.asc&limit=100`,
    ),
    restGet<{ terms: unknown }[]>(
      "corpus_datasets?select=terms:metadata->summary->>terms&id=eq.ftc_dnc_reported_calls&limit=1",
    ),
  ]);
  const months = parseDncMonths(national.rows);
  const dashboard = parseOfficialMonths(official.rows);
  const records = months.filter((m) => m.method === "records");
  const lastDay = [...records].reverse().find((m) => m.lastDay)?.lastDay ?? null;
  const input = { months, official: dashboard, asOf: lastDay };
  const first = records.find((m) => m.firstDay)?.firstDay;
  const shares = records.length ? subjectShares(records) : null;
  return {
    monthly: buildDncMonthly(input),
    share: buildDncRobocallShare(input),
    subjects:
      shares && shares.total > 0 && first && lastDay
        ? {
            window: `complaints created ${dayRange(first, lastDay)}`,
            months: records.map((m) => monthName(m.month)),
            total: shares.total,
            named: shares.named.slice(0, 10),
            catchAll: shares.catchAll,
            sourceUrl: DNC_DATA_URL,
          }
        : null,
    terms: typeof summary.rows[0]?.terms === "string" ? summary.rows[0].terms : null,
  };
}

async function readHsr(): Promise<TrendBlockData | null> {
  const [series, filings] = await Promise.all([
    restGet<unknown[]>(
      "corpus_records?select=id,s:item->series,cells:item->cells&dataset=eq.ftc_hsr_early_terminations&id=eq.series-by-year&limit=1",
    ),
    restGet<unknown[]>(
      "corpus_records?select=id,m:item->metrics,partial:item->partial&dataset=eq.ftc_hsr_filings&id=like.fy-*&order=id.asc&limit=100",
    ),
  ]);
  const parsed = parseHsrSeries(series.rows[0]);
  if (!parsed) return null;
  return buildHsrEarlyTerminations({ series: parsed, filings: parseHsrFiscalYears(filings.rows) });
}

async function readSpotlight(): Promise<SpotlightPost[]> {
  const r = await restGet<unknown[]>(
    `corpus_records?select=id,title,published:item->>published_display,iso:item->>published_iso,summary:item->>summary,url:item->>page_url,files:item->files&dataset=eq.ftc_publications_index&${cs({ series: ["spotlight"] })}&order=item->>published_iso.desc.nullslast&limit=8`,
  );
  return parseSpotlight(r.rows);
}

export const readFtcConsumerOverview = memoAsync<FtcConsumerOverview>(READ_TTL_MS, async () => {
  const [dnc, hsr, spotlight] = await Promise.allSettled([readDnc(), readHsr(), readSpotlight()]);
  const unavailable: FtcConsumerPart[] = [];
  if (dnc.status === "rejected") unavailable.push("dnc");
  if (hsr.status === "rejected") unavailable.push("hsr");
  if (spotlight.status === "rejected") unavailable.push("spotlight");
  if (unavailable.length === 3) throw new Error("FTC consumer data could not be read.");
  for (const r of [dnc, hsr, spotlight])
    if (r.status === "rejected")
      console.error(
        `FTC consumer overview part failed: ${r.reason instanceof Error ? r.reason.message : "unknown error"}`,
      );
  return {
    monthly: dnc.status === "fulfilled" ? dnc.value.monthly : null,
    share: dnc.status === "fulfilled" ? dnc.value.share : null,
    subjects: dnc.status === "fulfilled" ? dnc.value.subjects : null,
    hsr: hsr.status === "fulfilled" ? hsr.value : null,
    spotlight: spotlight.status === "fulfilled" ? spotlight.value : [],
    terms: dnc.status === "fulfilled" ? dnc.value.terms : null,
    unavailable,
  };
});
