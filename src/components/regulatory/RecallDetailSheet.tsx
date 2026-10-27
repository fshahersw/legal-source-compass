import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { axisTick, StateNote, tooltipStyle } from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getRecallRecord, type RecallSample } from "@/lib/external/recallPatterns.functions";
import { dayLabel, monthLabel, n } from "./recallInsights";
import { RecallComplaintEffect } from "@/components/safety/RecallComplaintEffect";
import { recallCampaignIds } from "@/lib/safety/safetyWindows";

function Samples({
  title,
  items,
  total,
}: {
  title: string;
  items: RecallSample[];
  total?: number | null;
}) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold">
        {title}
        {total && total > items.length ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · showing {items.length} of {n(total)}
          </span>
        ) : null}
      </h3>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {items.map((s) => (
          <li
            key={s.id}
            className="rounded-md border border-border/70 px-2.5 py-2 text-xs leading-snug"
          >
            <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-medium">{s.firm ?? "Firm not recorded"}</span>
              <span className="text-[11px] text-muted-foreground">
                {dayLabel(s.date)}
                {s.classification ? ` · ${s.classification}` : ""}
              </span>
            </p>
            {s.reason ? <p className="m-0 mt-1 text-muted-foreground">{s.reason}</p> : null}
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              {s.recallNumbers.length ? `Recall ${s.recallNumbers.join(", ")}` : `Record ${s.id}`}
              {s.url ? (
                <>
                  {" · "}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Agency notice
                  </a>
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opened theme, firm, cluster or supplier from recall_patterns, read in full when opened. */
export function RecallDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["recall-record", id],
    queryFn: () => getRecallRecord({ data: { id: id! } }),
    enabled: !!id,
    staleTime: 30 * 60 * 1000,
  });
  const d = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle className="text-base">{d?.title ?? "Recall pattern"}</SheetTitle>
          <SheetDescription>
            {d
              ? `${n(d.events)} recalls${d.firms !== null ? ` · ${n(d.firms)} firms` : ""}${d.first ? ` · ${dayLabel(d.first)}` : ""}${d.last && d.last !== d.first ? ` to ${dayLabel(d.last)}` : ""}`
              : "Loading"}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-3 space-y-4">
          {q.isLoading ? (
            <div
              className="h-48 animate-pulse rounded-md border border-border bg-muted/40"
              aria-busy="true"
            />
          ) : q.isError ? (
            <StateNote
              tone="error"
              action={
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => void q.refetch()}
                >
                  Retry
                </button>
              }
            >
              This record could not be loaded.
            </StateNote>
          ) : !d ? (
            <StateNote>This record is not available.</StateNote>
          ) : (
            <>
              {d.reading ? (
                <p className="m-0 rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed">
                  {d.reading}
                </p>
              ) : null}
              {d.growth && d.growth.changePct !== null ? (
                <p className="m-0 text-xs text-muted-foreground">
                  {d.growth.recentYears}: {n(d.growth.recent)} · {d.growth.priorYears}:{" "}
                  {n(d.growth.prior)} ·{" "}
                  <span className={d.growth.changePct > 0 ? "font-medium text-foreground" : ""}>
                    {d.growth.changePct > 0 ? "+" : ""}
                    {Math.round(d.growth.changePct)}%
                  </span>
                </p>
              ) : null}
              {d.byYear.length > 1 ? (
                <div className="h-36" aria-label="Recalls by year">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.byYear} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                      <XAxis dataKey="year" tick={axisTick} interval="preserveStartEnd" />
                      <YAxis tick={axisTick} allowDecimals={false} width={44} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => [n(Number(v)), "Recalls"]}
                      />
                      <Bar dataKey="count" fill={FDA_COLORS[1]!} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
              {d.suppliers.length ? (
                <p className="m-0 text-xs">
                  <span className="text-muted-foreground">Supplier named in recall reasons: </span>
                  {d.suppliers.join("; ")}
                </p>
              ) : null}
              {d.repeatThemes.length || d.themes.length ? (
                <section>
                  <h3 className="mb-1 text-xs font-semibold">Themes</h3>
                  <p className="m-0 text-xs text-muted-foreground">
                    {(d.themes.length ? d.themes : d.repeatThemes)
                      .map((t) => `${t.label} (${n(t.events)})`)
                      .join(" · ")}
                  </p>
                  {d.medianGapDays !== null ? (
                    <p className="m-0 mt-1 text-xs text-muted-foreground">
                      Median gap between recalls: {n(d.medianGapDays)} days
                    </p>
                  ) : null}
                </section>
              ) : null}
              {d.topFirms.length ? (
                <section>
                  <h3 className="mb-1 text-xs font-semibold">
                    {d.kind === "supplier" ? "Recalling firms" : "Firms with the most recalls"}
                  </h3>
                  <p className="m-0 text-xs text-muted-foreground">
                    {d.topFirms
                      .slice(0, 15)
                      .map((f) => `${f.firm} (${n(f.events)})`)
                      .join(" · ")}
                  </p>
                </section>
              ) : null}
              {d.commodities.length ? (
                <section>
                  <h3 className="mb-1 text-xs font-semibold">Products named</h3>
                  <p className="m-0 text-xs text-muted-foreground">
                    {d.commodities.map((c) => `${c.label} (${n(c.count)})`).join(" · ")}
                  </p>
                </section>
              ) : null}
              {d.anomalies.length ? (
                <section>
                  <h3 className="mb-1 text-xs font-semibold">Unusual months</h3>
                  <ul className="m-0 list-none space-y-1 p-0 text-xs">
                    {d.anomalies.map((a) => (
                      <li key={`${a.month}-${a.measure}`}>
                        {monthLabel(a.month)}: {n(a.count)} against a usual {n(a.trailingMedian)}
                        {a.topFirms[0] && a.topFirmShare !== null
                          ? ` · ${a.topFirms[0].firm} ${Math.round(a.topFirmShare)}%`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <Samples
                title={
                  d.kind === "cluster" || d.kind === "supplier"
                    ? "Recalls in this group"
                    : "Most recent recalls"
                }
                items={d.members.length ? d.members : d.recent}
                total={d.membersTotal}
              />
              <RecallComplaintEffect campaigns={recallCampaignIds([...d.members, ...d.recent])} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
