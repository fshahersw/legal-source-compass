import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { listCensusAreas } from "@/lib/external/census.functions";
import { NOT_RECORDED } from "@/lib/external/censusModel";

/**
 * A searchable list of a state's counties or equivalents with Census figures, for a state the county map does not cover
 * (Puerto Rico's municipios). Each row opens the county page.
 */
export function AreaList({ usps, stateName }: { usps: string; stateName: string }) {
  const fn = useServerFn(listCensusAreas);
  const q = useQuery({
    queryKey: ["census-areas", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60_000,
  });
  const [text, setText] = useState("");
  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return (q.data ?? []).filter((a) => !needle || a.name.toLowerCase().includes(needle));
  }, [q.data, text]);
  return (
    <section
      className="resource-panel"
      aria-label={`Counties of ${stateName}`}
      data-testid="area-list"
    >
      <div className="research-band">
        <h2 className="text-heading font-semibold text-foreground">{stateName} counties and equivalents</h2>
        <span className="text-xs text-muted-foreground">
          {q.data ? `${q.data.length} areas` : ""}
        </span>
      </div>
      <p className="m-0 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
        The county map does not cover {stateName}. Choose an area to see its Census figures; the
        population is the latest American Community Survey 5-year estimate.
      </p>
      {q.isPending ? (
        <p role="status" className="m-0 px-3 py-6 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.error ? (
        <div role="alert" className="p-3 text-xs">
          The list could not load.{" "}
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : !q.data.length ? (
        <p className="m-0 px-3 py-6 text-xs text-muted-foreground">
          No county Census figures are recorded for {stateName}.
        </p>
      ) : (
        <>
          <div className="relative border-b border-border/70 p-2">
            <Search
              className="pointer-events-none absolute left-4 top-4 size-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={`Filter ${stateName} areas`}
              placeholder="Find an area"
              className="h-9 bg-surface pl-8 text-xs"
            />
          </div>
          {shown.length ? (
            <ul className="m-0 grid list-none gap-x-4 p-0 md:grid-cols-2">
              {shown.map((a) => (
                <li key={a.fips} className="border-b border-border/60">
                  <Link
                    to="/places/$state/$county"
                    params={{ state: usps, county: a.fips }}
                    search={{ tab: "counties" }}
                    className="resource-row"
                  >
                    <span className="min-w-0 flex-1 text-[13px] font-medium">
                      {a.name.replace(/, [^,]+$/, "")}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {a.population != null ? a.population.toLocaleString("en-US") : NOT_RECORDED}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-3 py-6 text-center text-xs text-muted-foreground">
              No area matches “{text}”.
            </p>
          )}
        </>
      )}
    </section>
  );
}
