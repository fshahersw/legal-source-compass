/**
 * Filing velocity: pending change over 1, 3 and 12 months (JPML reports), the 12-month figures the JPML analytics
 * record, conditional transfer orders per month on the master docket, member dockets by filing date (registry,
 * partial), FJC IDB cases by fiscal year (historical, partial after its cut-off) and the MDL's position among peers.
 */
import { useMemo } from "react";
import { ChartCard, TrendColumns, periodTable } from "@/components/charts/recharts";
import { KpiStrip } from "@/components/kit";
import { PeersCard } from "@/components/lens/MdlLens";
import { MdlCaseYears } from "@/components/mdl/MdlTrendCards";
import { ProfileTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { MEMBER_MONTHS_MAX } from "@/lib/trends/profile";
import type { MdlCommandPayload } from "@/lib/matters/types";
import { ctoPerMonth, momentum } from "./commandView";
import { collectedNote, day, docketSource, fmt, signed } from "./shared";

export function VelocitySection({ cmd }: { cmd: MdlCommandPayload }) {
  const m = useMemo(() => momentum(cmd.jpmlPoints), [cmd.jpmlPoints]);
  const through = cmd.orders?.coverage.collectedThrough ?? null;
  const cto = useMemo(() => ctoPerMonth(cmd.orders?.entries ?? [], through), [cmd.orders, through]);
  const lm = cmd.lens?.mdl ?? null;
  const n = Number(cmd.mdl);
  const memberActions = cmd.overview?.registry?.members.actions ?? null;
  const memberKind =
    memberActions !== null && memberActions <= MEMBER_MONTHS_MAX
      ? "matter-member-months"
      : "mdl-members-years";
  const docket = docketSource(cmd);
  const ctoTotal = cto.reduce((a, r) => a + r.count, 0);
  return (
    <div className="space-y-4">
      <KpiStrip
        label="Change in actions pending"
        items={[
          ...m.map((x) => ({
            key: `m${x.months}`,
            label: `Pending change, ${x.months} ${x.months === 1 ? "month" : "months"}`,
            value: x.change !== null ? signed(x.change) : null,
            meta: x.from ? `${day(x.from)} to ${day(x.to)}` : "No report for that month",
          })),
          {
            key: "new",
            label: "New actions, 12 months",
            value: lm?.new12m != null ? fmt(lm.new12m) : null,
            meta: lm?.asOf ? `JPML analytics, ${day(lm.asOf)}` : "JPML analytics",
          },
          {
            key: "resolved",
            label: "Resolved, 12 months",
            value: lm?.resolved12m != null ? fmt(lm.resolved12m) : null,
            meta: lm?.asOf ? `JPML analytics, ${day(lm.asOf)}` : "JPML analytics",
          },
          {
            key: "peak",
            label: "Peak pending",
            value: lm?.peakPending != null ? fmt(lm.peakPending) : null,
            meta: "Highest report in the series",
          },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {cto.length ? (
          <ChartCard
            variant="editorial"
            title={`${fmt(ctoTotal)} conditional transfer orders entered on the master docket`}
            subtitle="Conditional transfer order entries per month · master docket"
            sources={[docket]}
            partial={collectedNote(through)}
            table={periodTable(cto, "month", [{ key: "count", label: "CTO entries" }], fmt, {
              caption: `MDL ${cmd.mdl}: conditional transfer order entries per month`,
              xLabel: "Month",
              partialKey: "partial",
            })}
            about={
              <p>
                Entries whose own text starts with "Conditional Transfer Order". One CTO can transfer
                many actions; this counts orders, not actions.
              </p>
            }
          >
            <TrendColumns
              rows={cto}
              xKey="month"
              series={[{ key: "count", label: "CTO entries" }]}
              format={fmt}
              partialKey="partial"
              ariaLabel={`Conditional transfer orders per month, MDL ${cmd.mdl}`}
            />
          </ChartCard>
        ) : null}
        {cmd.mode === "registry" ? <ProfileTrend kind={memberKind} id={cmd.mdl} /> : null}
      </div>
      <MdlCaseYears mdl={n} courtId={cmd.lens?.court?.court_id ?? null} />
      {lm ? (
        <TrendGrid columns={2}>
          <PeersCard mdl={n} type={lm.type} />
        </TrendGrid>
      ) : null}
    </div>
  );
}
