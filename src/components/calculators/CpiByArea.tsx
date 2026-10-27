/**
 * Prices by area: BLS CPI-U all items, annual averages for one area beside the U.S. city average, each rebased to 100 in
 * a chosen year (areas publish on different index bases, so only changes compare, never levels).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartFrame, LineTrend, metricFormatter, type ChartStatus, type PeriodAxis } from "@/components/charts";
import { AiSummary, AskAiButton, buildSectionContext } from "@/components/kit";
import { getCpiAreas } from "@/lib/calculators/damages.functions";
import { cpiChange, lastYear, rebase, type CpiArea } from "@/lib/calculators/damagesInputs";
import { Field, Figure } from "./shared";
import { controlClass } from "./format";

const US = "CUUR0000SA0";
const SOURCE = {
  label: "U.S. Bureau of Labor Statistics, CPI-U all items, annual averages",
  url: "https://www.bls.gov/cpi/regional-resources.htm",
};
const idx = metricFormatter("ratio");
const pct = (v: number | null) =>
  v == null ? "Not recorded" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

export function CpiByArea() {
  const q = useQuery({ queryKey: ["cpi-areas"], queryFn: () => getCpiAreas(), staleTime: 30 * 60_000 });
  const areas = useMemo(() => q.data ?? [], [q.data]);
  const us = areas.find((a) => a.seriesId === US) ?? null;
  const choices = areas.filter((a) => a.seriesId !== US);
  const [sid, setSid] = useState<string>("CUURS12ASA0");
  const area: CpiArea | null = choices.find((a) => a.seriesId === sid) ?? choices[0] ?? null;
  const end = area ? lastYear(area) : null;
  const usEnd = us ? lastYear(us) : null;
  const common = end != null && usEnd != null ? Math.min(end, usEnd) : end;
  const firstCommon =
    area && us ? Math.max(area.annual[0]!.year, us.annual[0]!.year) : (area?.annual[0]?.year ?? null);
  const [baseChoice, setBaseChoice] = useState<number | null>(null);
  const base =
    baseChoice != null && firstCommon != null && common != null && baseChoice >= firstCommon && baseChoice < common
      ? baseChoice
      : common != null && firstCommon != null
        ? Math.max(firstCommon, common - 10)
        : null;
  const years =
    base != null && common != null ? Array.from({ length: common - base + 1 }, (_, i) => String(base + i)) : [];
  const axis: PeriodAxis = { keys: years, label: (k) => k, tick: (k) => k };
  const line = (a: CpiArea | null, id: string, label: string) => {
    const pts = a && base != null ? rebase(a, base) : [];
    const by = new Map(pts.map((p) => [String(p.year), p.value]));
    return { id, label, points: years.map((y) => ({ key: y, value: by.get(y) ?? null })) };
  };
  const series = area ? [line(area, "area", area.area), ...(us ? [line(us, "us", "U.S. city average")] : [])] : [];
  const areaChange = area && base != null && common != null ? cpiChange(area, base, common) : null;
  const usChange = us && base != null && common != null ? cpiChange(us, base, common) : null;
  const status: ChartStatus = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !area || years.length < 2
        ? { kind: "empty", reason: "Not recorded: fewer than two annual averages for this area." }
        : { kind: "ready" };
  const context =
    area && base != null && common != null
      ? buildSectionContext({
          id: "cpi-by-area",
          title: `Price change in ${area.area}`,
          period: `${base}-${common} annual averages`,
          source: SOURCE.label,
          figures: [
            { label: `${area.area}: change in CPI-U`, value: pct(areaChange), period: `${base}-${common}` },
            { label: "U.S. city average: change in CPI-U", value: pct(usChange), period: `${base}-${common}` },
            { label: `${area.area}: last annual average`, value: end != null ? `${end}` : null },
          ],
        })
      : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80 max-w-full">
          <Field label="Area" htmlFor="cpi-area">
            <select id="cpi-area" className={controlClass} value={area?.seriesId ?? ""} onChange={(e) => setSid(e.target.value)}>
              {choices.map((a) => (
                <option key={a.seriesId} value={a.seriesId}>
                  {a.area}
                  {lastYear(a) !== usEnd ? ` (ends ${lastYear(a)})` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-32">
          <Field label="From year" htmlFor="cpi-base">
            <select
              id="cpi-base"
              className={controlClass}
              value={base ?? ""}
              onChange={(e) => setBaseChoice(Number(e.target.value))}
            >
              {firstCommon != null && common != null
                ? Array.from({ length: common - firstCommon }, (_, i) => common - 1 - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))
                : null}
            </select>
          </Field>
        </div>
      </div>
      {area && base != null && common != null ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure label={`${area.area}, ${base}-${common}`} value={pct(areaChange)} sub="change in annual average CPI-U" />
          <Figure label={`U.S. city average, ${base}-${common}`} value={pct(usChange)} sub="change in annual average CPI-U" />
          <Figure label="Index base of the area series" value={area.basePeriod || "Not recorded"} sub={area.seriesId} />
        </div>
      ) : null}
      <ChartFrame
        title={area ? `Prices in ${area.area} against the U.S. city average` : "Prices by area"}
        unit={base != null ? `index, ${base} = 100` : "index"}
        period={base != null && common != null ? `${base}-${common}, annual averages` : undefined}
        sources={[SOURCE, ...(area?.sourceUrl ? [{ label: `BLS series ${area.seriesId}`, url: area.sourceUrl }] : [])]}
        status={status}
        headingLevel="h3"
        actions={<AskAiButton sectionId="cpi-by-area" title="Prices by area" context={context} size="icon" />}
        notes={[
          "All-items CPI-U, not seasonally adjusted, BLS annual averages. Each area keeps its own published index base, so the lines are rebased to 100 in the chosen year and only changes compare.",
          "BLS publishes no regional medical-care CPI in this dataset; the national medical series are in the calculator above.",
          "Some area series were discontinued (shown with their last year); a year BLS does not publish is Not recorded.",
        ]}
        table={
          area
            ? {
                caption: `CPI-U annual averages, ${area.area} and U.S. city average`,
                columns: [
                  { label: "Year" },
                  { label: `${area.area} (published index)`, align: "right" },
                  { label: "U.S. city average (published index)", align: "right" },
                ],
                rows: years.map((y) => ({
                  key: y,
                  cells: [
                    y,
                    area.annual.find((p) => String(p.year) === y)?.value.toFixed(3) ?? "Not recorded",
                    us?.annual.find((p) => String(p.year) === y)?.value.toFixed(3) ?? "Not recorded",
                  ],
                })),
              }
            : undefined
        }
      >
        {series.length && years.length >= 2 ? (
          <LineTrend series={series} axis={axis} formatter={idx} zero={false} ariaLabel="CPI-U rebased by area" height={240} />
        ) : null}
      </ChartFrame>
      <AiSummary context={context} />
    </div>
  );
}
