/** react-query factories for the judge profile console panels (read-only server functions). */
import {
  getCourtBenchSeries,
  getExpertRulingBaseline,
  getJudgeCounsel,
  getMdlEndingsBaseline,
} from "@/lib/external/judgeConsole.functions";

const TEN_MIN = 10 * 60 * 1000;

export const courtBenchSeriesQuery = (court: string) => ({
  queryKey: ["judge-console-bench-series", court] as const,
  queryFn: () => getCourtBenchSeries({ data: { court } }),
  staleTime: TEN_MIN,
});

export const rulingBaselineQuery = {
  queryKey: ["judge-console-ruling-baseline"] as const,
  queryFn: () => getExpertRulingBaseline(),
  staleTime: TEN_MIN,
};

export const judgeCounselQuery = (mdls: readonly string[]) => ({
  queryKey: ["judge-console-counsel", ...mdls] as const,
  queryFn: () => getJudgeCounsel({ data: { mdls: [...mdls] } }),
  staleTime: TEN_MIN,
});

export const mdlEndingsBaselineQuery = {
  queryKey: ["judge-console-mdl-endings"] as const,
  queryFn: () => getMdlEndingsBaseline(),
  staleTime: TEN_MIN,
};
