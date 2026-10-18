/**
 * CMS Open Payments panel for one manufacturer, for embedding on company pages.
 * Lookup is by exact normalized name (or CMS reporting-entity ID); nothing is matched fuzzily.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, HandCoins } from "lucide-react";
import { ChartCard } from "@/components/fda-analytics/FdaCharts";
import { StateFlag } from "@/components/corpus/EntityArtwork";
import {
  getManufacturerPayments,
  type AdverseManufacturer,
  type ManufacturerPayments,
} from "@/lib/external/openPayments.functions";
import { fullUsd, int, pct, ReportBars, ShareBars, usd, YearBars } from "./PaymentsCharts";
import { kpiTooltip } from "./companyViewNotes";

export function manufacturerPaymentsQuery(name: string, entityId?: string) {
  return {
    queryKey: ["open-payments-manufacturer", name, entityId ?? ""],
    queryFn: () => getManufacturerPayments({ data: { name, entityId } }),
    staleTime: 10 * 60 * 1000,
  };
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div
      className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
      title={kpiTooltip({ label, value, note })}
    >
      <p className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-base font-semibold leading-tight">{value}</p>
      {note ? (
        <p className="line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function Unattributed({ adverse }: { adverse: AdverseManufacturer }) {
  if (!adverse.unattributed.length) return null;
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <p className="text-[11px] font-medium">
        Other MAUDE spellings found by phrase search · not attributed
      </p>
      <p className="text-[11px] text-muted-foreground">
        Plants, divisions or other companies sharing a word. All-time report counts, shown as review
        leads only; they are not added to the totals above.
      </p>
      <ul className="mt-1 grid gap-x-3 text-[11px] sm:grid-cols-2">
        {adverse.unattributed.slice(0, 6).map((u) => (
          <li key={u.name} className="flex justify-between gap-2">
            <span className="line-clamp-2 min-w-0 break-words" title={u.name}>
              {u.name}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {int(u.reportsAllTime)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdverseBlock({
  adverse,
  deviceShare,
}: {
  adverse: AdverseManufacturer | null;
  deviceShare: number | null;
}) {
  if (!adverse)
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground">
        {deviceShare != null && deviceShare < 0.1
          ? "Not searched in MAUDE: under 10% of this entity's general-payment dollars are on device or medical-supply records."
          : "MAUDE report counts are not available for this entity."}
      </p>
    );
  if (!adverse.matched)
    return (
      <>
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No MAUDE device manufacturer name normalizes to this company's name. That is not a count
          of zero reports: MAUDE may list the company under a plant, division or subsidiary name.
        </p>
        <Unattributed adverse={adverse} />
      </>
    );
  return (
    <>
      <ReportBars rows={adverse.years} />
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">
        <span className="rounded border border-warning/40 bg-warning/15 px-1 py-px font-medium text-warning-foreground">
          Requires review
        </span>{" "}
        Lower bound: {int(adverse.total)} reports received 2017–2025 under{" "}
        {adverse.matchedNames.length === 1 ? "the spelling" : "the spellings"}{" "}
        {adverse.matchedNames.map((n) => `“${n.name}”`).join(", ")}.{" "}
        <span className="font-medium text-foreground">
          Name coverage{" "}
          {adverse.coverage == null
            ? "not available"
            : `${pct(adverse.coverage, 1)} of ${int(adverse.denominator)} reports whose manufacturer name contains this company's name`}
        </span>
        {adverse.coverage != null && adverse.coverage < 0.8
          ? ": most same-name reports are filed under plant, division or other spellings, so this count understates the company's reports."
          : "."}
        {adverse.ambiguous.length
          ? ` Excluded as ambiguous (claimed by several companies): ${adverse.ambiguous.map((a) => `“${a.name}”`).join(", ")}.`
          : ""}
        {adverse.seriesUrl ? (
          <>
            {" "}
            <a
              href={adverse.seriesUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              openFDA query
            </a>
          </>
        ) : null}
      </p>
      <Unattributed adverse={adverse} />
    </>
  );
}

export function ManufacturerPaymentsView({
  payments: m,
  adverse,
}: {
  payments: ManufacturerPayments;
  adverse: AdverseManufacturer | null;
}) {
  const latest = m.years.find((y) => y.year === m.latestYear) ?? m.years.at(-1);
  const prior = m.years.find((y) => latest && y.year === latest.year - 1);
  const change =
    latest?.general != null && prior?.general ? latest.general / prior.general - 1 : null;
  const yearRows = m.years.map((y) => ({
    year: y.year,
    general: y.general,
    research: y.research,
    archive: y.source === "archive",
  }));
  const natureTotal = m.nature.reduce((a, r) => a + r.amount, 0);
  const stateTotal = m.states.reduce((a, r) => a + r.amount, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <HandCoins className="size-4 text-primary" aria-hidden="true" />
            {m.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            CMS reporting entity {m.entityId}
            {m.hqState ? ` · ${m.hqState}` : ""}
            {m.country ? `, ${m.country}` : ""} · rank {m.rank} of 300 by 2017–2025 general +
            research dollars
            {m.altNames.length ? ` · also reported as ${m.altNames.slice(0, 2).join("; ")}` : ""}
          </p>
        </div>
        <a
          href={m.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          CMS company profile <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi
          label="General payments 2017–2025"
          value={usd(m.totals.general)}
          note={`${int(m.totals.generalRecords)} records`}
        />
        <Kpi
          label="Research payments 2017–2025"
          value={usd(m.totals.research)}
          note={`${int(m.totals.researchRecords)} records`}
        />
        <Kpi
          label={`General payments ${latest?.year ?? ""}`}
          value={usd(latest?.general)}
          note={
            change == null
              ? "No prior-year base"
              : `${change >= 0 ? "+" : ""}${pct(change)} vs ${prior?.year}`
          }
        />
        <Kpi
          label="Device / supply share"
          value={pct(m.deviceShare)}
          note="of general dollars, first listed product"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Payments by program year"
          subtitle="General and research dollars; dashed line is the median general year"
          footnote="2019–2025 from CMS summary datasets; 2017–2018 (lighter) summed from CMS archived detail files."
        >
          <YearBars rows={yearRows} />
        </ChartCard>
        <ChartCard
          title="Nature of payment"
          subtitle="Share of 2017–2025 general-payment dollars"
          footnote="CMS reporting-entity × nature summaries (2019–2025) and archived detail files."
        >
          <ShareBars
            rows={m.nature.map((n) => ({
              key: n.code || n.label,
              label: n.label,
              amount: n.amount,
            }))}
            total={natureTotal}
            limit={7}
          />
        </ChartCard>
        <ChartCard
          title="Top recipient states"
          subtitle="General payments by recipient state, 2017–2025"
          footnote={`Detail-file sums match the CMS summary in ${m.stateCheck.matched} of ${m.stateCheck.of} checked program years.`}
        >
          {m.states.length ? (
            <ul className="divide-y divide-border/60 text-xs">
              {m.states.slice(0, 8).map((s) => (
                <li key={s.state} className="flex items-center gap-2 px-3 py-1.5">
                  <StateFlag state={s.state} className="h-3" />
                  <span className="w-8 font-mono">{s.state}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(s.amount / (m.states[0]?.amount || 1)) * 100}%` }}
                    />
                  </span>
                  <span className="w-28 text-right font-mono text-muted-foreground">
                    {usd(s.amount)} · {pct(stateTotal ? s.amount / m.totals.general : null)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">Not recorded</p>
          )}
        </ChartCard>
        <ChartCard
          title="Top products"
          subtitle="General-payment dollars by first listed product, 2017–2025"
          footnote="A record's full amount is credited to its first listed product; records can name up to five."
        >
          {m.products.length ? (
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col />
                <col className="w-24" />
                <col className="w-20" />
              </colgroup>
              <tbody className="divide-y divide-border/60">
                {m.products.slice(0, 8).map((p) => (
                  <tr key={`${p.name}:${p.type}`}>
                    <td className="px-3 py-1.5" title={p.name}>
                      <span className="line-clamp-2 break-words">{p.name}</span>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{p.type}</td>
                    <td className="px-3 py-1.5 text-right font-mono" title={fullUsd(p.amount)}>
                      {usd(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No product recorded on payments.
            </p>
          )}
        </ChartCard>
      </div>
      <ChartCard
        title="MAUDE device adverse-event reports"
        subtitle="openFDA device/event, reports by date received, exact normalized-name match"
        footnote="Same-name rule: case and punctuation ignored, legal forms must agree; plants, divisions and subsidiaries are not merged, so counts are a lower bound."
      >
        <AdverseBlock adverse={adverse} deviceShare={m.deviceShare} />
      </ChartCard>
      <p className="text-[11px] text-muted-foreground">
        Sources:{" "}
        {m.sources.map((s, i) => (
          <span key={s.url}>
            {i ? " · " : ""}
            <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
              {s.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}

/** Drop-in panel: pass the company name (exact legal name as CMS lists it) or a CMS reporting-entity ID. */
export function OpenPaymentsPanel({
  name,
  entityId,
}: {
  name: string;
  entityId?: string | undefined;
}) {
  const q = useQuery(manufacturerPaymentsQuery(name, entityId));
  return (
    <section aria-label="CMS Open Payments" className="space-y-2">
      {q.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-14 animate-pulse rounded-md border border-border bg-muted/50" />
          <div className="h-56 animate-pulse rounded-md border border-border bg-muted/50" />
        </div>
      ) : q.isError ? (
        <p
          role="alert"
          className="rounded-md border border-border px-3 py-3 text-sm text-destructive"
        >
          Open Payments data could not be loaded.
        </p>
      ) : !q.data?.matches.length && q.data?.secAdverse.length ? (
        q.data.secAdverse.map((a) => (
          <ChartCard
            key={a.entityId}
            title={`MAUDE device reports · ${a.name}`}
            subtitle={`SEC registrant (CIK ${a.entityId}${a.sicDescription ? `, ${a.sicDescription}` : ""}) · reports by date received, exact normalized-name match`}
            footnote="No top-300 CMS Open Payments reporting entity has this exact name; affiliates report payments under their own names."
          >
            <AdverseBlock adverse={a} deviceShare={null} />
          </ChartCard>
        ))
      ) : !q.data?.matches.length ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No top-300 CMS Open Payments reporting entity has the name “{name}” (case and punctuation
          ignored; the legal form, such as Inc. or plc, must agree). Affiliates report under their
          own names;{" "}
          <Link
            to="/companies/payments"
            search={{ q: name.split(/[\s,]+/)[0] ?? "" }}
            className="text-primary underline"
          >
            search the manufacturer ranking
          </Link>
          .
        </p>
      ) : (
        q.data.matches.map((match) => (
          <ManufacturerPaymentsView
            key={match.payments.entityId}
            payments={match.payments}
            adverse={match.adverse}
          />
        ))
      )}
    </section>
  );
}
