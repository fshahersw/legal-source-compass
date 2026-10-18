import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Landmark } from "lucide-react";
import {
  getStateFederalData,
  type StateFederalData,
} from "@/lib/external/stateFederalData.functions";

const NOT_RECORDED = "Not recorded";
const fmt = (n: number) => n.toLocaleString("en-US");
const usdMillions = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 2 })}B`
    : `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;

/** Headline federal-data figures for a state, each linking to the published record it comes from. */
export function StateFederalDataPanel({ usps }: { usps: string }) {
  const fn = useServerFn(getStateFederalData);
  const q = useQuery({
    queryKey: ["state-federal-data", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section className="resource-panel" aria-label="Federal enforcement and complaint data">
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Landmark className="size-4" aria-hidden />
          Federal enforcement and complaints
        </h2>
        <span className="text-[11px] text-[var(--navy-muted)]">CFPB · EPA ECHO</span>
      </div>
      {q.isPending ? (
        <p role="status" className="px-3 py-6 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.error ? (
        <div role="alert" className="p-3 text-xs">
          Federal data could not load.
          <button type="button" className="ml-2 underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <Rows usps={usps} data={q.data} />
      )}
    </section>
  );
}

function Row({
  dataset,
  id,
  title,
  value,
  note,
}: {
  dataset: string;
  id: string;
  title: string;
  value: string;
  note: string;
}) {
  return (
    <li>
      <Link
        to="/records/$dataset/$id"
        params={{ dataset, id }}
        className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">{title}</span>
          <span className="block text-[11px] text-muted-foreground">{note}</span>
        </span>
        <span className="shrink-0 font-mono text-[13px]">{value}</span>
        <ArrowRight className="size-3.5 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

function Rows({ usps, data }: { usps: string; data: StateFederalData }) {
  if (!data.cfpb && !data.epa && !data.facilities)
    return (
      <p className="p-3 text-xs text-muted-foreground">
        No federal enforcement or complaint records are published for this state yet.
      </p>
    );
  return (
    <>
      <ul className="divide-y divide-border/70">
        {data.cfpb ? (
          <Row
            dataset="cfpb_complaints_states"
            id={data.cfpb.recordId}
            title="Consumer finance complaints (CFPB)"
            value={fmt(data.cfpb.complaints)}
            note={
              data.cfpb.per100k2025 != null
                ? `${data.cfpb.per100k2025.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} per 100,000 residents in 2025${data.cfpb.rank != null ? `, rank ${data.cfpb.rank} of 51` : ""}`
                : `Per-capita ${NOT_RECORDED}`
            }
          />
        ) : null}
        {data.epa ? (
          <Row
            dataset="epa_echo_case_series"
            id={data.epa.recordId}
            title="EPA enforcement cases"
            value={fmt(data.epa.opened)}
            note={`${fmt(data.epa.concluded)} concluded · ${usdMillions(data.epa.fedPenalty)} federal penalties settled, all years (a multi-state case counts in each state)`}
          />
        ) : null}
        {data.facilities ? (
          <Row
            dataset="epa_echo_state_programs"
            id={data.facilities.recordId}
            title="Regulated facilities (ECHO)"
            value={fmt(data.facilities.facilities)}
            note={`${fmt(data.facilities.formal5y)} with a formal action in 5 years · ${fmt(data.facilities.sncNow)} significant violators now`}
          />
        ) : null}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 px-3 py-2 text-[11px]">
        <Link
          to="/law/enforcement"
          search={{ state: usps }}
          className="text-primary hover:underline"
        >
          EPA enforcement for this state
        </Link>
        <Link
          to="/law/enforcement"
          search={{ tab: "cfpb" }}
          className="text-primary hover:underline"
        >
          Consumer complaints nationally
        </Link>
      </div>
    </>
  );
}
