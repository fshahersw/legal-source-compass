import { Info } from "lucide-react";
import { SourceLink } from "@/components/enforcement/parts";
import { NEISS_CREDIT, NEISS_LABEL } from "./neissView";

const NEISS_HOME = "https://www.cpsc.gov/cgibin/NEISSQuery/home.aspx";
const NEISS_ESTIMATES = "https://www.cpsc.gov/cgibin/NEISSQuery/webestimates.html";

/** The label every NEISS figure carries: weighted national estimates, not counts, with the design change stated. */
export function NeissBadge() {
  return (
    <span
      title="Weighted national estimates of emergency-department-treated injuries, with 95% intervals; not case counts."
      className="inline-flex items-center rounded border border-border bg-muted/60 px-1.5 py-px text-[10px] font-medium text-foreground"
    >
      Weighted estimates
    </span>
  );
}

export function NeissNotice({ breakYear }: { breakYear: number | null }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-4"
    >
      <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0">
        <span className="font-semibold">{NEISS_LABEL}.</span> Each figure estimates
        emergency-department visits for injuries associated with a consumer product, projected from
        a probability sample of about 100 hospitals and shown with a 95% interval. It is not a count
        of cases, people or all injuries, and unweighted sample counts are never national estimates.
        CPSC&apos;s unstable rule withholds small estimates.
        {breakYear != null
          ? ` In ${breakYear} CPSC re-stratified the sample, so comparisons across ${breakYear - 1} and ${breakYear} mix two designs.`
          : ""}{" "}
        Source: <SourceLink href={NEISS_HOME}>CPSC NEISS</SourceLink> ·{" "}
        <SourceLink href={NEISS_ESTIMATES}>how CPSC explains the estimates</SourceLink>
      </p>
    </div>
  );
}

export function NeissCredit() {
  return <p className="px-1 text-[11px] leading-4 text-muted-foreground">{NEISS_CREDIT}.</p>;
}
