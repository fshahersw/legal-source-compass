/**
 * MDL filing velocity and acceleration leaderboard (MDL analytics): which MDLs added the most actions over the last
 * 12 JPML monthly reports, whether the last 3 reports run faster or slower than that, and which fast growers are
 * outside the Seeger Weiss matter registry (exact MDL-number match). JPML counts only; nothing estimated.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ChartCard,
  DumbbellRange,
  rankTakeaway,
  type TableSpec,
} from "@/components/charts/recharts";
import { metricFormatter } from "@/components/charts/format";
import {
  AiSummary,
  AskAiButton,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { JPML_SOURCE, count, mdlVelocityQuery, monthLabel } from "./hubQueries";
import {
  PRODUCTS_LIABILITY,
  growthLeaders,
  leaderboardKpis,
  notRecordedReason,
  shortCaption,
  type VelocityRow,
} from "./velocity";

const TOP = 15;
const COUNT = metricFormatter("count");
const ALL = "";

const name = (r: VelocityRow) => shortCaption(r.title) ?? `MDL ${r.mdl}`;
const flag = (r: VelocityRow) =>
  r.inRegistry === false
    ? "Not in our registry"
    : r.inRegistry
      ? "In our registry"
      : "Not recorded";

export function VelocityLeaderboard() {
  const q = useQuery(mdlVelocityQuery);
  const [picked, setType] = useState(PRODUCTS_LIABILITY);
  const model = q.data?.published ? q.data : null;
  const rows = useMemo(() => model?.rows ?? [], [model]);
  const types = useMemo(
    () =>
      [...new Set(rows.filter((r) => r.inLatest && r.type).map((r) => r.type!))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );
  // The default type, or a type no longer in the data, falls back to all types: the select never filters on an
  // option it does not show.
  const type = picked === ALL || types.includes(picked) ? picked : ALL;
  const { ranked, notRecorded } = useMemo(
    () => growthLeaders(rows, (r) => type === ALL || r.type === type),
    [rows, type],
  );
  const kpis = useMemo(() => leaderboardKpis(rows), [rows]);
  const top = ranked.slice(0, TOP);
  const outsideTop = top.filter((r) => r.inRegistry === false);
  const latest = model?.latestMonth ?? null;
  const period = latest ? `12 months to ${monthLabel(latest)}` : undefined;
  const scope = type === ALL ? "all MDLs" : `${type.toLowerCase()} MDLs`;
  const state = q.isPending ? "loading" : q.isError ? "error" : "ready";
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({
          kind: "error",
          message: "The JPML report series could not be read.",
          onRetry: () => void q.refetch(),
        } as const)
      : !model
        ? ({ kind: "empty", reason: "The JPML report series is not published." } as const)
        : !top.length
          ? ({ kind: "empty", reason: "No MDL of this type has a full 12-month window." } as const)
          : ({ kind: "ready" } as const);

  const accelerating = top.filter((r) => r.pace3m !== null && r.pace3m > r.added12m!);
  const lead = rankTakeaway(
    top.map((r) => ({ label: `${name(r)} (MDL ${r.mdl})`, value: r.added12m })),
    count,
    { verb: "added", withRunnerUp: false },
  );
  const title =
    lead && latest
      ? `${lead} actions in the 12 months to ${monthLabel(latest)}; ${accelerating.length} of the top ${top.length} ran faster in the last 3 months`
      : "Actions added per MDL";

  const table: TableSpec | undefined = model
    ? {
        caption: `Actions added per MDL, ${scope}, JPML monthly reports`,
        columns: [
          { label: "MDL" },
          { label: "Litigation" },
          { label: "Type" },
          { label: "Added, 12 months" },
          { label: "Added, 3 months" },
          { label: "3 months × 4" },
          { label: "Pending" },
          { label: "Registry" },
          { label: "Why not recorded" },
        ],
        rows: [...ranked, ...notRecorded].map((r) => ({
          key: r.mdl,
          cells: [
            r.mdl,
            name(r),
            r.type ?? "Not recorded",
            r.added12m ?? "Not recorded",
            r.added3m ?? "Not recorded",
            r.pace3m ?? "Not recorded",
            r.pending ?? "Not recorded",
            flag(r),
            notRecordedReason(r) ?? "",
          ],
          muted: r.added12m === null,
        })),
      }
    : undefined;

  const context = model
    ? buildSectionContext({
        id: "mdl-velocity",
        title: "MDL filing velocity",
        scope,
        period,
        source: JPML_SOURCE.label,
        figures: [
          {
            label: "MDLs that added over 100 actions in the last 3 months",
            value: kpis.fastQuarter,
          },
          {
            label: "Actions added to products-liability MDLs, 12 months",
            value: kpis.plAdded12m,
            unit: "actions",
          },
          { label: "Products-liability MDLs outside our registry", value: kpis.plOutside },
          { label: "Actions pending in those MDLs", value: kpis.plOutsidePending, unit: "actions" },
          ...top.slice(0, 8).flatMap((r) => [
            {
              label: `${name(r)} (MDL ${r.mdl}), added in 12 months`,
              value: r.added12m,
              unit: "actions",
              note: r.inRegistry === false ? "not in our registry" : undefined,
            },
            {
              label: `${name(r)} (MDL ${r.mdl}), added in 3 months`,
              value: r.added3m,
              unit: "actions",
            },
          ]),
        ],
        maxFigures: 24,
      })
    : null;

  const kpiSource = {
    source: { label: JPML_SOURCE.label, href: model?.reportUrl ?? JPML_SOURCE.url },
    asOf: model?.latestReport ?? undefined,
  };

  return (
    <Section
      id="mdl-velocity"
      title="Filing velocity"
      description="Which MDLs are adding actions fastest, and which of them are outside our registry."
      actions={
        <label className="flex items-center gap-2 text-meta text-muted-foreground">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Litigation type"
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value={ALL}>All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <KpiGrid columns={4} label="Filing velocity figures">
        <KpiCard
          as="li"
          label="MDLs adding over 100 actions a quarter"
          value={model ? count(kpis.fastQuarter) : null}
          state={state}
          meta="last 3 reports, all types"
          source={kpiSource}
        />
        <KpiCard
          as="li"
          label="Products-liability actions added"
          value={model ? count(kpis.plAdded12m) : null}
          unit="actions"
          state={state}
          meta={`${kpis.plAdded12mMdls} MDLs with a full 12-month window`}
          source={{
            ...kpiSource,
            period,
            about: (
              <p>
                {kpis.plAdded12mExcluded} products-liability MDLs are left out: not listed in the
                report 12 months earlier, or their cumulative total fell (the Panel re-counted).
              </p>
            ),
          }}
        />
        <KpiCard
          as="li"
          label="Products-liability MDLs outside our registry"
          value={kpis.plOutside !== null ? count(kpis.plOutside) : null}
          state={state}
          meta={
            kpis.plOutsidePending !== null
              ? `${count(kpis.plOutsidePending)} actions pending in them`
              : "Registry could not be read"
          }
          source={{ ...kpiSource, about: <p>Exact MDL-number match against sw_matters_v1.</p> }}
        />
        <KpiCard
          as="li"
          label={`Top ${TOP} growers outside our registry`}
          value={model && model.registryRead ? `${outsideTop.length} of ${top.length}` : null}
          state={state}
          meta={
            outsideTop.length
              ? outsideTop
                  .slice(0, 3)
                  .map((r) => `MDL ${r.mdl}`)
                  .join(", ")
              : scope
          }
          source={kpiSource}
        />
      </KpiGrid>
      <AiSummary
        context={context}
        className="mt-3"
        actions={
          <AskAiButton
            sectionId="mdl-velocity"
            title="MDL filing velocity"
            context={context}
            questions={[
              "Which fast-growing MDLs are outside our registry?",
              "Which MDLs are speeding up, and which are slowing down?",
            ]}
          />
        }
      />
      <ChartCard
        className="mt-4"
        variant="editorial"
        title={title}
        subtitle={`Actions added (change in the JPML cumulative total) · last 12 reports against the last 3 × 4 · top ${TOP} ${scope}`}
        status={status}
        sources={[{ label: JPML_SOURCE.label, url: model?.reportUrl ?? JPML_SOURCE.url }]}
        period={period}
        table={table}
        actions={<AskAiButton sectionId="mdl-velocity-chart" context={context} size="icon" />}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Added = the latest report&apos;s cumulative total minus the total in the report 12 (or
              3) months earlier. The second dot is the 3-month figure times four: right of the first
              dot means the MDL is speeding up.
            </li>
            <li>
              Bold names are not in the Seeger Weiss matter registry (exact MDL number). That says
              nothing about representation.
            </li>
            <li>
              MDLs not listed in the report 12 months earlier, or whose total fell because the
              Panel re-counted, are Not recorded; View data says which. Actions are cases, not
              plaintiffs.
            </li>
          </ul>
        }
        minHeight={360}
      >
        {top.length ? (
          <DumbbellRange
            rows={top.map((r) => ({
              id: r.mdl,
              label: `${name(r)} (${r.mdl})${r.inRegistry === false ? " · not in registry" : ""}`,
              a: r.added12m,
              b: r.pace3m,
              highlight: r.inRegistry === false,
            }))}
            aLabel="Added, last 12 months"
            bLabel="Last 3 months × 4"
            format={count}
            tickFormat={COUNT.tick}
            gapLabel="Pace change"
            labelWidth={220}
            ariaLabel={`Actions added over the last 12 months against the last 3 months times four, top ${TOP} ${scope}`}
          />
        ) : null}
      </ChartCard>
      <p className="mt-2 text-meta text-muted-foreground">
        The priority matters are on the{" "}
        <Link
          to="/matters/seeger-weiss"
          className="text-primary underline-offset-2 hover:underline"
        >
          Seeger Weiss hub
        </Link>
        .
      </p>
    </Section>
  );
}
