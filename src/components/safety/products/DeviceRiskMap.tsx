/**
 * /safety/products?view=devices: the device risk map. FDA product codes by device class and implant flag, joined
 * exactly on product code to PMA approvals and supplements (the design and process changes FDA approved). The MAUDE
 * adverse-event part appears only once MAUDE monthly series are loaded (national:maude has a maude_reports series).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendLines, periodTable } from "@/components/charts/recharts";
import { StackedBarsOverTime } from "@/components/charts/d3/charts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { CLASS_LABEL } from "@/lib/safety/deviceRisk";
import { deviceRiskQuery } from "../sectionQueries";
import { subjectQuery } from "./queries";
import { seriesMonths, subjectHref } from "./productModel";

const SOURCES = [
  {
    label: "FDA product classification (openFDA export 2026-10-02)",
    url: "https://download.open.fda.gov/device/classification/device-classification-0001-of-0001.json.zip",
  },
  { label: "openFDA premarket approvals (PMA)", url: "https://open.fda.gov/apis/device/pma/" },
];
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "device-risk-map";

export function DeviceRiskMap() {
  const q = useQuery(deviceRiskQuery);
  const maude = useQuery(subjectQuery("national:maude"));
  const d = q.data;
  const state = q.isPending ? "loading" : q.isError ? "error" : "ready";
  const years = (d?.years ?? []).filter((y) => Number(y.year) >= 2005);
  const period = years.length ? `${years[0]!.year}–${years.at(-1)!.year}` : undefined;
  const maudeSeries =
    maude.data?.series.find((s) => s.series === "maude_reports" && s.vals.length > 0) ?? null;
  const maudeYears = useMemo(() => {
    if (!maudeSeries) return [];
    const m = new Map<string, number>();
    for (const p of seriesMonths(maudeSeries))
      m.set(p.month.slice(0, 4), (m.get(p.month.slice(0, 4)) ?? 0) + p.value);
    const lastMonth = maudeSeries.coverage_to.slice(5, 7);
    return [...m.entries()].map(([year, reports]) => ({
      year,
      reports,
      partial: year === maudeSeries.coverage_to.slice(0, 4) && lastMonth !== "12",
    }));
  }, [maudeSeries]);
  const cells = (d?.cells ?? []).filter((c) => c.supplements > 0 || c.codes >= 50);
  const context = d
    ? buildSectionContext({
        id: ID,
        title: "Device risk map: class, implants and PMA changes",
        period: d.latestDecision ? `PMA decisions to ${d.latestDecision}` : null,
        source: SOURCES.map((s) => s.label).join("; "),
        figures: [
          { label: "Device product codes", value: d.totals.codes },
          { label: "Implant product codes", value: d.totals.implantCodes },
          { label: "Class III product codes", value: d.totals.classIIICodes },
          { label: "Codes with a PMA record", value: d.totals.codesWithPma },
          { label: "PMA supplements for implant codes", value: d.totals.implantSupplements },
          ...cells.slice(0, 6).map((c) => ({
            label: `${c.label}, ${c.implant}: PMA supplements`,
            value: c.supplements,
          })),
          ...d.codes
            .slice(0, 5)
            .map((c) => ({ label: `${c.code} ${c.name}: PMA supplements`, value: c.supplements })),
        ],
        maxFigures: 20,
      })
    : null;
  return (
    <Section
      id={ID}
      title="Device risk map"
      description="Device classes, implants and the changes FDA approved after approval (PMA supplements)."
      actions={<AskAiButton sectionId={ID} context={context} size="icon" />}
    >
      <KpiGrid columns={4} label="Device classification figures">
        <KpiCard
          as="li"
          label="Implant product codes"
          value={d ? fmt(d.totals.implantCodes) : null}
          meta={d ? `of ${fmt(d.totals.codes)} codes` : undefined}
          state={state}
        />
        <KpiCard
          as="li"
          label="Class III product codes"
          value={d ? fmt(d.totals.classIIICodes) : null}
          meta="Highest risk class"
          state={state}
        />
        <KpiCard
          as="li"
          label="Codes with a PMA record"
          value={d ? fmt(d.totals.codesWithPma) : null}
          meta="Most devices clear through 510(k) instead"
          state={state}
        />
        <KpiCard
          as="li"
          label="PMA supplements, implant codes"
          value={d ? fmt(d.totals.implantSupplements) : null}
          meta={d?.latestDecision ? `decisions to ${d.latestDecision}` : undefined}
          state={state}
          source={{ source: SOURCES.map((s) => ({ label: s.label, href: s.url })) }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <ChartCard
          variant="editorial"
          title="PMA supplements approved per year, implant codes against all others"
          subtitle={`PMA supplements by decision year${period ? ` · ${period}` : ""}`}
          status={
            q.isPending
              ? { kind: "loading" }
              : q.isError
                ? { kind: "error", onRetry: () => void q.refetch() }
                : years.length
                  ? { kind: "ready" }
                  : { kind: "empty", reason: "Not recorded." }
          }
          sources={SOURCES}
          period={period}
          partial={
            years.at(-1)?.partial
              ? `${years.at(-1)!.year} runs to ${d?.latestDecision ?? "the latest decision"}.`
              : undefined
          }
          about={
            <ul className="list-disc space-y-1 pl-4">
              <li>
                A PMA supplement is FDA&apos;s approval of a change to an approved device (design,
                labeling, manufacturing).
              </li>
              <li>
                Supplements join the classification exactly on product code
                {d
                  ? `; ${fmt(d.totals.pmaUnmatched)} PMA rows have a code not in the classification and are left out`
                  : ""}
                .
              </li>
              <li>
                Most devices reach the market through 510(k), so a code without PMA records is
                normal.
              </li>
            </ul>
          }
          table={periodTable(
            years,
            "year",
            [
              { key: "implant", label: "Implant codes" },
              { key: "other", label: "Other codes" },
            ],
            fmt,
            {
              caption: "PMA supplements per year",
              xLabel: "Year",
              partialKey: "partial",
              total: true,
            },
          )}
        >
          <StackedBarsOverTime
            rows={years.map((y) => ({
              period: y.year,
              partial: y.partial,
              values: { implant: y.implant, other: y.other },
            }))}
            keys={["implant", "other"]}
            labels={{ implant: "Implant codes", other: "Other codes" }}
            format={fmt}
          />
        </ChartCard>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-heading font-semibold text-foreground">
            PMA supplements by class and implant flag
          </h3>
          <BarList
            ariaLabel="PMA supplements by device class and implant flag"
            items={cells.map((c) => ({
              id: `${c.cls}-${c.implant}`,
              label: `${c.label} · ${c.implant}`,
              value: c.supplements,
              display: fmt(c.supplements),
              note: `${fmt(c.codesWithPma)} of ${fmt(c.codes)} codes have PMA records`,
            }))}
          />
          <DataDrawer
            title="Device product codes"
            description="Every FDA product code with its class, implant and life-sustaining flags and its PMA originals and supplements. Codes with a product page link to it."
            triggerLabel={`See all ${d?.codes.length ?? 0}`}
            rows={d?.codes ?? []}
            rowKey={(c) => c.code}
            searchable
            columns={[
              {
                key: "code",
                label: "Code",
                value: (c) => c.code,
                render: (c) =>
                  c.hasSubject ? (
                    <a
                      href={subjectHref(`maude:${c.code}`)}
                      className="text-primary hover:underline"
                    >
                      {c.code}
                    </a>
                  ) : (
                    c.code
                  ),
              },
              { key: "name", label: "Device", value: (c) => c.name },
              { key: "cls", label: "Class", value: (c) => CLASS_LABEL[c.cls] ?? c.cls },
              {
                key: "implant",
                label: "Implant",
                value: (c) => (c.implant == null ? null : c.implant ? "Yes" : "No"),
              },
              {
                key: "life",
                label: "Life-sustaining",
                value: (c) => (c.lifeSustaining == null ? null : c.lifeSustaining ? "Yes" : "No"),
              },
              { key: "orig", label: "PMA originals", align: "right", value: (c) => c.originals },
              {
                key: "supp",
                label: "PMA supplements",
                align: "right",
                value: (c) => c.supplements,
              },
              { key: "latest", label: "Latest PMA decision", value: (c) => c.latestDecision },
            ]}
            source={{ source: SOURCES.map((s) => ({ label: s.label, href: s.url })) }}
            className="mt-3"
          />
        </div>
      </div>
      {maudeSeries && maudeYears.length >= 2 ? (
        <ChartCard
          className="mt-4"
          title="MAUDE device reports per year, all devices"
          subtitle={`Reports received · ${maudeSeries.coverage_from} to ${maudeSeries.coverage_to}`}
          sources={[{ label: "openFDA device adverse events (MAUDE)", url: maudeSeries.query_url }]}
          partial={
            maudeYears.at(-1)?.partial ? `${maudeYears.at(-1)!.year} is not complete.` : undefined
          }
          about={<p>{maudeSeries.caveat}</p>}
          table={periodTable(maudeYears, "year", [{ key: "reports", label: "Reports" }], fmt, {
            caption: "MAUDE reports per year",
            xLabel: "Year",
            partialKey: "partial",
          })}
        >
          <TrendLines
            rows={maudeYears}
            xKey="year"
            series={[{ key: "reports", label: "Reports" }]}
            format={fmt}
            partialKey="partial"
            ariaLabel="MAUDE device reports per year"
          />
        </ChartCard>
      ) : (
        <p className="mt-3 text-meta text-muted-foreground">
          MAUDE adverse-event trends by product code appear here once the monthly MAUDE series are
          loaded.
        </p>
      )}
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
