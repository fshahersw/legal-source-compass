/**
 * Federal awards (USAspending.gov) on a company profile: shown only when an official record states both this company's
 * SEC CIK and its SAM UEI or DUNS (company_federal_awards, linked by exact identifier, never by name).
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Landmark } from "lucide-react";
import { getCompanyFederalAwards } from "@/lib/calculators/econ.functions";
import { cn } from "@/lib/utils";
import { usd } from "./format";

const GROUP_LABEL: Record<string, string> = {
  contracts: "Contracts",
  grants: "Grants",
  direct_payments: "Direct payments",
  other_assistance: "Other assistance",
};

export function CompanyFederalAwardsPanel({ cik, className }: { cik: string; className?: string }) {
  const q = useQuery({
    queryKey: ["company-federal-awards", cik],
    queryFn: () => getCompanyFederalAwards({ data: { cik } }),
    staleTime: 10 * 60_000,
  });
  const body = (() => {
    if (q.isLoading)
      return (
        <div
          className="h-16 animate-pulse rounded-md bg-muted/50"
          aria-busy="true"
          aria-label="Loading federal awards"
        />
      );
    if (q.isError || q.data?.error)
      return (
        <p role="alert" className="text-[12px] text-destructive">
          Federal awards could not be loaded.{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      );
    if (!q.data?.available)
      return (
        <p className="text-[12px] text-muted-foreground">
          Not recorded: the federal awards dataset is not published yet.
        </p>
      );
    if (!q.data.rows.length)
      return (
        <p className="text-[12px] text-muted-foreground">
          Not recorded. Awards are linked to a company only through an official record that states
          both its SEC CIK and its SAM Unique Entity ID (or DUNS); SEC filings and USAspending
          publish no common identifier, and names are never matched, so no award is attributed to
          this company.
        </p>
      );
    return (
      <div className="flex flex-col gap-3">
        {q.data.rows.map((r) => (
          <div key={r.id} className="min-w-0">
            <p className="text-[13px]">
              <span className="font-medium">{r.name}</span> · UEI {r.uei} ·{" "}
              {r.total === null ? "Not recorded" : usd(r.total)} obligated FY2008–FY2026{" "}
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                USAspending <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            </p>
            <ul className="mt-1 grid gap-1 text-[12px] sm:grid-cols-2">
              {Object.entries(r.topAwards).flatMap(([g, list]) =>
                list.slice(0, 3).map((a) => (
                  <li key={`${g}:${a.award_id}`} className="min-w-0 truncate">
                    <span className="text-muted-foreground">{GROUP_LABEL[g] ?? g}:</span>{" "}
                    <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {a.award_id}
                    </a>{" "}
                    · {a.amount === null ? "Not recorded" : usd(a.amount)} ·{" "}
                    {a.agency ?? "Agency not recorded"}
                  </li>
                )),
              )}
            </ul>
          </div>
        ))}
      </div>
    );
  })();
  return (
    <section
      className={cn("rounded-md border border-border bg-surface px-3 py-2", className)}
      aria-labelledby={`fa-${cik}`}
    >
      <h2 id={`fa-${cik}`} className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
        <Landmark aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> Federal awards
      </h2>
      {body}
    </section>
  );
}
