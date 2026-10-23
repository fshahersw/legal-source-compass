/** Where every number in the calculators comes from, with each dataset's publication status. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { getEconStatus } from "@/lib/calculators/econ.functions";
import { FredNotice, Note, Panel } from "./shared";

const DATASETS: { id: string; label: string; source: string; url: string; cadence: string }[] = [
  {
    id: "econ_fred_series",
    label: "FRED series: metadata and latest values",
    source:
      "Federal Reserve Bank of St. Louis (FRED); data from the Federal Reserve Board (H.15), BLS and BEA",
    url: "https://fred.stlouisfed.org/",
    cadence: "Refreshed twice a day",
  },
  {
    id: "econ_fred_observations",
    label: "FRED observations by series and year, with vintage dates",
    source: "FRED and ALFRED real-time history",
    url: "https://alfred.stlouisfed.org/",
    cadence: "Refreshed twice a day when a release publishes",
  },
  {
    id: "econ_nchs_life_tables",
    label: "United States life tables, 2018–2024",
    source: "National Center for Health Statistics, National Vital Statistics Reports",
    url: "https://www.cdc.gov/nchs/products/life_tables.htm",
    cadence: "Yearly report",
  },
  {
    id: "econ_ssa_awi",
    label: "National average wage index, 1994–2024",
    source: "Social Security Administration notices in the Federal Register",
    url: "https://www.federalregister.gov/",
    cadence: "Yearly notice (October)",
  },
  {
    id: "econ_bls_cpi_areas",
    label: "CPI-U by area (regions and metropolitan areas)",
    source: "Bureau of Labor Statistics",
    url: "https://www.bls.gov/cpi/",
    cadence: "Monthly",
  },
  {
    id: "econ_bls_oews",
    label: "Occupational employment and wages (May 2025)",
    source: "Bureau of Labor Statistics, OEWS",
    url: "https://www.bls.gov/oes/",
    cadence: "Yearly (spring)",
  },
  {
    id: "census_acs_cvap_counties",
    label: "Citizen voting-age population by county",
    source: "Census Bureau, ACS 5-year table B29001",
    url: "https://www.census.gov/programs-surveys/acs",
    cadence: "Yearly (December)",
  },
  {
    id: "econ_state_judgment_rates",
    label: "State judgment interest rates (cited only)",
    source: "State legislatures and agencies",
    url: "https://malegislature.gov/Laws/GeneralLaws",
    cadence: "Rebuilt when a cited page changes",
  },
  {
    id: "company_federal_awards",
    label: "Federal awards to firms in the SAM exclusion list (exact UEI)",
    source: "USAspending.gov",
    url: "https://www.usaspending.gov/",
    cadence: "Rebuilt quarterly",
  },
];

export function EconSourcesPanel() {
  const q = useQuery({
    queryKey: ["econ-status"],
    queryFn: () => getEconStatus(),
    staleTime: 5 * 60_000,
  });
  return (
    <Panel title="Sources and publication status">
      {q.data?.staged ? (
        <Note kind="warn">
          Preview: values come from staged build files, not the published corpus.
        </Note>
      ) : null}
      {q.isLoading ? <Note kind="loading">Reading the dataset catalog…</Note> : null}
      {q.data?.error ? <Note kind="error">{q.data.error}</Note> : null}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-[12px]">
          <caption className="sr-only">Datasets behind the calculators</caption>
          <thead className="text-muted-foreground">
            <tr className="border-b border-border text-left">
              <th className="py-1 pr-3 font-medium">Dataset</th>
              <th className="py-1 pr-3 font-medium">Publisher</th>
              <th className="py-1 pr-3 font-medium">Updates</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {DATASETS.map((d) => {
              const s = q.data?.datasets?.[d.id];
              return (
                <tr key={d.id} className="border-b border-border/60 align-top">
                  <td className="py-1 pr-3">
                    {s ? (
                      <Link
                        to="/data/$dataset"
                        params={{ dataset: d.id }}
                        className="text-primary hover:underline"
                      >
                        {d.label}
                      </Link>
                    ) : (
                      d.label
                    )}
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {d.id}
                    </span>
                  </td>
                  <td className="py-1 pr-3">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {d.source} <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                    </a>
                  </td>
                  <td className="py-1 pr-3 text-muted-foreground">{d.cadence}</td>
                  <td className="py-1 tabular-nums">
                    {q.isLoading
                      ? "…"
                      : s
                        ? `${s.ready ? "Published" : "Loading"} · ${s.records?.toLocaleString("en-US") ?? "Not recorded"} records`
                        : "Not published yet"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <FredNotice />
    </Panel>
  );
}
