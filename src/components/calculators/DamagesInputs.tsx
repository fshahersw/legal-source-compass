/**
 * Damages inputs: official figures an expert or a settlement model starts from, each with its release and link. Inputs
 * only: nothing here computes lost earnings, an award or a present value of damages, and nothing is legal advice.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartFrame, LineTrend, metricFormatter, type ChartStatus } from "@/components/charts";
import { DumbbellRange } from "@/components/charts/editorial";
import { AiSummary, AskAiButton, buildSectionContext, type FigureInput } from "@/components/kit";
import { STATES } from "@/lib/corpus/geo";
import { getAwiSeries, getOewsIndex, getOewsWages } from "@/lib/calculators/damages.functions";
import { compoundGrowth, metroStates, socLabel } from "@/lib/calculators/damagesInputs";
import { EconSourcesPanel } from "./EconSourcesPanel";
import { LifeExpectancyLookup } from "./LifeExpectancyLookup";
import { Field, Figure, Note, Panel, SubHeading } from "./shared";
import { controlClass } from "./format";

const usd0 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "Not recorded" : `$${Math.round(v).toLocaleString("en-US")}`;
const OEWS_SOURCE = {
  label: "BLS Occupational Employment and Wage Statistics",
  url: "https://www.bls.gov/oes/",
};
const AWI_SOURCE = {
  label: "Social Security Administration, national average wage index (Federal Register notices)",
  url: "https://www.ssa.gov/oact/cola/AWI.html",
};

export function DamagesInputs() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Note kind="warn">
        Official inputs only. Nothing on this tab computes lost earnings, an award or a present
        value of damages, and none of it is legal advice.
      </Note>
      <WagePercentiles />
      <WageIndex />
      <SubHeading>Remaining life expectancy (NCHS U.S. life tables)</SubHeading>
      <LifeExpectancyLookup />
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[12px] font-medium">
          Sources and dataset status
        </summary>
        <div className="p-2">
          <EconSourcesPanel />
        </div>
      </details>
    </div>
  );
}

function WagePercentiles() {
  const index = useQuery({
    queryKey: ["oews-index"],
    queryFn: () => getOewsIndex(),
    staleTime: 30 * 60_000,
  });
  const [soc, setSoc] = useState("472061");
  const [usps, setUsps] = useState("NJ");
  const [metro, setMetro] = useState("");
  const [filter, setFilter] = useState("");
  const occupations = useMemo(
    () => (index.data?.occupations ?? []).filter((o) => o.soc !== "000000"),
    [index.data],
  );
  const shownOcc = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = f
      ? occupations.filter((o) => o.title.toLowerCase().includes(f) || socLabel(o.soc).includes(f))
      : occupations;
    const keep = list.slice(0, 400);
    return keep.some((o) => o.soc === soc)
      ? keep
      : [...occupations.filter((o) => o.soc === soc), ...keep];
  }, [occupations, filter, soc]);
  const stateArea = index.data?.areas.find((a) => a.type === "S" && a.usps === usps) ?? null;
  const metros = (index.data?.areas ?? []).filter(
    (a) => a.type === "M" && metroStates(a.area).includes(usps),
  );
  const metroArea = metros.find((m) => m.id === metro) ?? null;
  const areaIds = [stateArea?.id, metroArea?.id].filter((x): x is string => !!x);
  const wages = useQuery({
    queryKey: ["oews-wages", soc, areaIds.join(",")],
    queryFn: () => getOewsWages({ data: { soc, areas: areaIds } }),
    enabled: /^\d{6}$/.test(soc) && !!index.data,
    staleTime: 30 * 60_000,
  });
  const occ = occupations.find((o) => o.soc === soc) ?? null;
  const rows = wages.data ?? [];
  const release = rows[0]?.release ?? index.data?.release ?? null;
  const local =
    rows.find((r) => r.type === "M") ?? rows.find((r) => r.type === "S") ?? rows[0] ?? null;
  const national = rows.find((r) => r.type === "N") ?? null;
  const status: ChartStatus =
    index.isPending || wages.isPending
      ? { kind: "loading" }
      : index.isError || wages.isError
        ? { kind: "error", onRetry: () => void (index.isError ? index.refetch() : wages.refetch()) }
        : !rows.some((r) => r.wage)
          ? {
              kind: "empty",
              reason: "Not recorded: BLS publishes no estimate for this occupation in these areas.",
            }
          : { kind: "ready" };
  const figures: FigureInput[] = rows.flatMap((r) => [
    { label: `${r.area}: annual median wage`, value: usd0(r.wage?.median) },
    {
      label: `${r.area}: 10th to 90th percentile`,
      value: `${usd0(r.wage?.p10)} to ${usd0(r.wage?.p90)}`,
    },
    { label: `${r.area}: employment`, value: r.wage?.employment ?? null, unit: "jobs" },
  ]);
  const context = occ
    ? buildSectionContext({
        id: "oews-wages",
        title: `Wages of ${occ.title} (SOC ${socLabel(occ.soc)})`,
        period: release ?? undefined,
        source: OEWS_SOURCE.label,
        figures,
      })
    : null;
  return (
    <Panel title="Occupation wage percentiles">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Field label="Occupation (filter by words or SOC code)" htmlFor="oews-filter">
            <input
              id="oews-filter"
              className={controlClass}
              value={filter}
              placeholder="e.g. nurse, laborer, 47-2061"
              onChange={(e) => setFilter(e.target.value)}
            />
          </Field>
          <select
            aria-label="Occupation"
            className={`${controlClass} mt-1`}
            value={soc}
            onChange={(e) => setSoc(e.target.value)}
          >
            {shownOcc.map((o) => (
              <option key={o.soc} value={o.soc}>
                {socLabel(o.soc)} {o.title}
              </option>
            ))}
          </select>
        </div>
        <Field label="State" htmlFor="oews-state">
          <select
            id="oews-state"
            className={controlClass}
            value={usps}
            onChange={(e) => {
              setUsps(e.target.value);
              setMetro("");
            }}
          >
            {STATES.map((s) => (
              <option key={s.usps} value={s.usps}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Metro area (optional)" htmlFor="oews-metro">
          <select
            id="oews-metro"
            className={controlClass}
            value={metro}
            onChange={(e) => setMetro(e.target.value)}
          >
            <option value="">None</option>
            {metros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.area}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {local?.wage ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <Figure
            label={`Median, ${local.area}`}
            value={usd0(local.wage.median)}
            sub={release ?? undefined}
          />
          <Figure
            label={`Median, ${national?.area ?? "National"}`}
            value={usd0(national?.wage?.median)}
            sub={release ?? undefined}
          />
          <Figure
            label={`Middle half, ${local.area}`}
            value={`${usd0(local.wage.p25)} to ${usd0(local.wage.p75)}`}
            sub="25th to 75th percentile"
          />
          <Figure
            label={`Employment, ${local.area}`}
            value={
              local.wage.employment != null
                ? local.wage.employment.toLocaleString("en-US")
                : "Not recorded"
            }
            sub="jobs (wage and salary)"
          />
        </div>
      ) : null}
      <ChartFrame
        title={occ ? `${occ.title}: annual wage range` : "Annual wage range"}
        unit="annual wage, 10th to 90th percentile"
        period={release ?? undefined}
        sources={[
          OEWS_SOURCE,
          ...rows.flatMap((r) =>
            r.sourceUrl ? [{ label: `BLS OEWS, ${r.area}`, url: r.sourceUrl }] : [],
          ),
        ]}
        status={status}
        headingLevel="h3"
        actions={
          <AskAiButton
            sectionId="oews-wages"
            title="Occupation wages"
            context={context}
            size="icon"
          />
        }
        notes={[
          "Wage and salary workers only: OEWS excludes the self-employed. Percentiles are of annual wages as BLS publishes them for the release shown.",
          "BLS special codes (wages at or above the top code, or no estimate) read Not recorded, never zero. Metro areas are listed for a state when the BLS area name carries its code.",
        ]}
        table={{
          caption: "OEWS annual wage percentiles",
          columns: [
            { label: "Area" },
            { label: "10th", align: "right" },
            { label: "25th", align: "right" },
            { label: "Median", align: "right" },
            { label: "75th", align: "right" },
            { label: "90th", align: "right" },
            { label: "Mean", align: "right" },
            { label: "Employment", align: "right" },
          ],
          rows: rows.map((r) => ({
            key: r.id,
            cells: [
              `${r.area}${r.wage?.footnotes.length ? ` (BLS footnote ${r.wage.footnotes.join(", ")})` : ""}`,
              usd0(r.wage?.p10),
              usd0(r.wage?.p25),
              usd0(r.wage?.median),
              usd0(r.wage?.p75),
              usd0(r.wage?.p90),
              usd0(r.wage?.annualMean),
              r.wage?.employment != null
                ? r.wage.employment.toLocaleString("en-US")
                : "Not recorded",
            ],
          })),
        }}
      >
        {rows.length ? (
          <DumbbellRange
            rows={rows.map((r) => ({
              id: r.id,
              label: r.area,
              a: r.wage?.p10 ?? null,
              b: r.wage?.p90 ?? null,
              note: `Median ${usd0(r.wage?.median)}`,
              highlight: r === local,
            }))}
            aLabel="10th percentile"
            bLabel="90th percentile"
            format={(v) => usd0(v)}
            tickFormat={(v) => `$${Math.round(v / 1000)}k`}
            ariaLabel="Annual wage, 10th to 90th percentile, by area"
          />
        ) : null}
      </ChartFrame>
      <AiSummary context={context} />
    </Panel>
  );
}

function WageIndex() {
  const q = useQuery({
    queryKey: ["ssa-awi"],
    queryFn: () => getAwiSeries(),
    staleTime: 30 * 60_000,
  });
  const pts = useMemo(() => q.data ?? [], [q.data]);
  const last = pts.at(-1) ?? null;
  const g10 = last ? compoundGrowth(pts, last.year - 10, last.year) : null;
  const g5 = last ? compoundGrowth(pts, last.year - 5, last.year) : null;
  const status: ChartStatus = q.isPending
    ? { kind: "loading" }
    : q.isError
      ? { kind: "error", onRetry: () => void q.refetch() }
      : pts.length < 2
        ? { kind: "empty", reason: "Not recorded." }
        : { kind: "ready" };
  const years = pts.length
    ? Array.from({ length: last!.year - pts[0]!.year + 1 }, (_, i) => String(pts[0]!.year + i))
    : [];
  const byYear = new Map(pts.map((p) => [String(p.year), p.value]));
  const pctText = (v: number | null) => (v == null ? "Not recorded" : `${v.toFixed(2)}% a year`);
  const context = last
    ? buildSectionContext({
        id: "ssa-awi",
        title: "National average wage index",
        period: `${pts[0]!.year}-${last.year}`,
        source: AWI_SOURCE.label,
        figures: [
          { label: `Wage index ${last.year}`, value: usd0(last.value), note: last.citation },
          { label: `Compound growth ${last.year - 5}-${last.year}`, value: pctText(g5) },
          { label: `Compound growth ${last.year - 10}-${last.year}`, value: pctText(g10) },
        ],
      })
    : null;
  return (
    <Panel title="Wage growth: SSA national average wage index">
      {last ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure label={`Index, ${last.year}`} value={usd0(last.value)} sub={last.citation} />
          <Figure
            label={`Growth ${last.year - 5}-${last.year}`}
            value={pctText(g5)}
            sub="compound, per year"
          />
          <Figure
            label={`Growth ${last.year - 10}-${last.year}`}
            value={pctText(g10)}
            sub="compound, per year"
          />
        </div>
      ) : null}
      <ChartFrame
        title="National average wage index by year"
        unit="dollars"
        period={last ? `${pts[0]!.year}-${last.year}` : undefined}
        sources={[AWI_SOURCE]}
        status={status}
        headingLevel="h3"
        actions={
          <AskAiButton sectionId="ssa-awi" title="Wage index" context={context} size="icon" />
        }
        notes={[
          "Each value is the amount SSA states in its Federal Register notice for that year (cited in the table). Years before 1994 are not in this dataset (Not recorded).",
          "A national average of all wages: it is not an occupation's or a person's wage path.",
        ]}
        table={{
          caption: "National average wage index",
          columns: [
            { label: "Year" },
            { label: "Index", align: "right" },
            { label: "Federal Register" },
          ],
          rows: [...pts].reverse().map((p) => ({
            key: String(p.year),
            cells: [
              String(p.year),
              `$${p.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
              p.sourceUrl ? (
                <a
                  key="a"
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {p.citation}
                  {p.publicationDate ? ` (${p.publicationDate})` : ""}
                </a>
              ) : (
                p.citation
              ),
            ],
          })),
        }}
      >
        {pts.length >= 2 ? (
          <LineTrend
            series={[
              {
                id: "awi",
                label: "Wage index",
                points: years.map((y) => ({ key: y, value: byYear.get(y) ?? null })),
              },
            ]}
            axis={{ keys: years, label: (k) => k, tick: (k) => k }}
            formatter={metricFormatter("currency_usd")}
            ariaLabel="National average wage index by year"
            height={220}
          />
        ) : null}
      </ChartFrame>
      <AiSummary context={context} />
    </Panel>
  );
}
