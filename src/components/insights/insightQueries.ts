import { getDailyInsights } from "@/lib/insights/insights.functions";

/** One section's insight for the page it sits on. */
export const dailyInsightQuery = (section: string) => ({
  queryKey: ["daily-insight", section] as const,
  queryFn: () => getDailyInsights({ data: { section } }),
  staleTime: 10 * 60 * 1000,
});

/** Every section's insight, for the /analytics hub (one request). */
export const allDailyInsightsQuery = {
  queryKey: ["daily-insight", "all"] as const,
  queryFn: () => getDailyInsights({ data: {} }),
  staleTime: 10 * 60 * 1000,
};

/** "2026-10-18" -> "October 18, 2026". Fixed locale and UTC, so server and client render the same text. */
export function formatDayKey(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
