import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Building2, Gavel, Landmark, Scale, TrendingUp } from "lucide-react";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { getCountyAnalysis, type CountyAnalysis } from "@/lib/external/countyAnalysis.functions";
import type { Distribution } from "@/lib/external/placeAnalysisParse";
import { externalHref } from "@/lib/external/href";
import { cn } from "@/lib/utils";
import { ShareList, YearBars } from "./PlaceCharts";
import { formatPlaceValue, METRIC_BY_KEY, NOT_RECORDED, type PlaceFormat } from "./placeMetrics";

const NOS_LABEL: Record<string, string> = {
  contract: "Contract",
  real_property: "Real property",
  injury: "Personal injury",
  product: "Product liability and health-care injury",
  fraud_property: "Fraud, truth in lending, property damage",
  false_claims: "False Claims Act",
  civil_rights: "Civil rights",
  prisoner: "Prisoner petitions",
  labor: "Labor and employment",
  ip: "Intellectual property",
  securities_antitrust_banking: "Securities, antitrust, banking",
  consumer_credit: "Consumer credit and communications",
  social_security: "Social Security",
  tax: "Tax",
  immigration: "Immigration",
  forfeiture: "Forfeiture and penalty",
  bankruptcy: "Bankruptcy appeals",
  other_statutes: "Other statutes",
  unmapped: "Nature of suit not mapped",
};

const PROFILE_KEYS = [
  "population",
  "density",
  "median_age",
  "pct_under18",
  "pct_65plus",
  "pct_hispanic",
  "pct_white_nh",
  "pct_black_nh",
  "pct_asian_nh",
  "pct_foreign_born",
  "median_hh_income",
  "per_capita_personal_income",
  "poverty_rate",
  "unemployment_rate",
  "pct_bachelors",
  "pct_uninsured",
  "owner_occupied",
  "median_home_value",
  "median_rent",
];
const LEGAL_KEYS = [
  "fjc_core_rate",
  "fjc_rate",
  "osha_rate",
  "cfpb_rate",
  "cfpb_noncredit_rate",
  "echo_formal_per_1k",
];

/** Where the county sits among the state's counties: range, middle half, median and the county's own mark. */
function RangeMark({
  value,
  dist,
  format,
}: {
  value: number | null;
  dist: Distribution | undefined;
  format: PlaceFormat;
}) {
  if (!dist || dist.max <= dist.min) return <span className="block h-3" aria-hidden />;
  const pos = (v: number) =>
    Math.max(0, Math.min(100, ((v - dist.min) / (dist.max - dist.min)) * 100));
  return (
    <span
      className="relative block h-3 w-full min-w-20"
      role="img"
      aria-label={`State counties range ${formatPlaceValue(dist.min, format)} to ${formatPlaceValue(dist.max, format)}, median ${formatPlaceValue(dist.median, format)}${value != null ? `; this county ${formatPlaceValue(value, format)}` : ""}`}
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border-strong" />
      <span
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-sm bg-muted-foreground/25"
        style={{
          left: `${pos(dist.p25)}%`,
          width: `${Math.max(1, pos(dist.p75) - pos(dist.p25))}%`,
        }}
      />
      <span
        className="absolute top-0 h-3 w-px bg-muted-foreground"
        style={{ left: `${pos(dist.median)}%` }}
      />
      {value != null ? (
        <span
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
          style={{ left: `${pos(value)}%`, background: FDA_COLORS[2] }}
        />
      ) : null}
    </span>
  );
}

export function CountyAnalysisPanel({ fips }: { fips: string }) {
  const fn = useServerFn(getCountyAnalysis);
  const q = useQuery({
    queryKey: ["county-analysis", fips],
    queryFn: () => fn({ data: { fips } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isPending)
    return (
      <p role="status" className="mt-3 text-[12px] text-muted-foreground">
        Loading the county analysis…
      </p>
    );
  if (q.error)
    return (
      <p role="alert" className="mt-3 text-[12px]">
        The county analysis could not load.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!q.data)
    return (
      <p className="mt-3 text-[12px] text-muted-foreground">
        No county analysis is recorded for this county.
      </p>
    );
  return <Body c={q.data} />;
}

function Body({ c }: { c: CountyAnalysis }) {
  const l = c.legal;
  const fy = Object.keys(l?.fjcCoreFy ?? {}).sort();
  const nos = Object.entries(l?.nos ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => ({ label: NOS_LABEL[k] ?? k, value: n }));
  const lausYears = Object.keys(c.lausRate).sort();
  const beaYears = Object.keys(c.beaPerCapita).sort();
  return (
    <div className="mt-3 space-y-3" data-testid="county-analysis">
      <DistrictLine c={c} />
      {l?.note ? (
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {l.note}
        </p>
      ) : null}
      <section className="resource-panel" aria-label="Legal activity">
        <div className="research-band">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Gavel className="size-4" aria-hidden />
            Legal activity
          </h3>
          <span className="text-[11px] text-[var(--navy-muted)]">
            per 100,000 residents a year unless noted
          </span>
        </div>
        <div className="overflow-x-auto">
          <CompareTable c={c} keys={LEGAL_KEYS} />
        </div>
        {l?.screened.length ? (
          <div className="border-t border-border/70 px-3 py-2 text-[12px]">
            {l.screened.map((r, i) => (
              <p key={i} className="m-0 flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                <span>
                  Federal filing rates are {NOT_RECORDED}: {r}
                  {l.rateUnscreened != null
                    ? ` (unscreened: ${formatPlaceValue(l.rateUnscreened, "rate")} per 100,000 a year).`
                    : ""}
                </span>
              </p>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 border-t border-border/70 px-3 py-3 md:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-1 text-[12px] font-semibold">
              Core federal civil filings by residents, FY2016-FY2025
            </h4>
            {l && fy.length ? (
              <YearBars
                series={l.fjcCoreFy}
                years={fy}
                label="Core federal civil filings by fiscal year"
              />
            ) : (
              <p className="text-[11px] text-muted-foreground">{NOT_RECORDED}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatPlaceValue(c.metrics["fjc_core_5y"], "int")} core and{" "}
              {formatPlaceValue(c.metrics["fjc_5y"], "int")} total filings FY2021-FY2025;{" "}
              {formatPlaceValue(c.metrics["fjc_own_district_share"], "pct")} filed in the county's
              own district.
            </p>
          </div>
          <div className="min-w-0">
            <h4 className="mb-1 text-[12px] font-semibold">
              What residents sued over, FY2021-FY2025
            </h4>
            <ShareList items={nos} />
          </div>
          <div className="min-w-0">
            <h4 className="mb-1 text-[12px] font-semibold">
              OSHA inspections opened, FY2021-FY2025
            </h4>
            {l ? (
              <YearBars
                series={l.oshaFy}
                years={["2021", "2022", "2023", "2024", "2025"]}
                label="OSHA inspections by fiscal year"
                color={FDA_COLORS[3]!}
              />
            ) : null}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {l?.oshaSplitShare != null
                ? `${l.oshaSplitShare.toFixed(0)}% of these sit in ZIP areas shared with other counties (placed by largest land share).`
                : "Site ZIPs placed in counties by the Census ZCTA file."}
            </p>
          </div>
          <div className="min-w-0">
            <h4 className="mb-1 text-[12px] font-semibold">CFPB complaints received, 2021-2025</h4>
            {l ? (
              <YearBars
                series={l.cfpbY}
                years={["2021", "2022", "2023", "2024", "2025"]}
                label="CFPB complaints by year"
                color={FDA_COLORS[2]!}
              />
            ) : null}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Credit reporting: {formatPlaceValue(l?.cfpbCreditShare, "pct")} of complaints.
              {l?.cfpbSplitShare != null
                ? ` ${l.cfpbSplitShare.toFixed(0)}% come from ZIP areas shared with other counties.`
                : ""}
            </p>
          </div>
        </div>
        {l ? (
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/70 px-3 py-2 text-[11.5px] sm:grid-cols-3">
            <Fact
              label="ECHO-listed facilities"
              value={formatPlaceValue(l.echo["echo_facilities"], "int")}
            />
            <Fact
              label="Active facilities"
              value={formatPlaceValue(l.echo["echo_active"], "int")}
            />
            <Fact
              label="Inspections, last five years"
              value={formatPlaceValue(l.echo["echo_inspections_5y"], "int")}
            />
            <Fact
              label="Formal enforcement actions"
              value={formatPlaceValue(l.echo["echo_formal_actions"], "int")}
            />
            <Fact
              label="Facilities with a formal action"
              value={formatPlaceValue(l.echo["echo_with_formal"], "int")}
            />
            <Fact
              label="Significant noncompliance now"
              value={formatPlaceValue(l.echo["echo_snc"], "int")}
            />
          </dl>
        ) : null}
      </section>
      <section className="resource-panel" aria-label="People and economy">
        <div className="research-band">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="size-4" aria-hidden />
            People, economy and housing
          </h3>
          <span className="text-[11px] text-[var(--navy-muted)]">
            dot: this county · band: middle half of the state's counties
          </span>
        </div>
        <div className="overflow-x-auto">
          <CompareTable c={c} keys={PROFILE_KEYS} moe />
        </div>
        <div className="grid gap-3 border-t border-border/70 px-3 py-3 md:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
              <TrendingUp className="size-3.5" aria-hidden />
              Unemployment rate (BLS, annual averages)
            </h4>
            <YearBars
              series={c.lausRate}
              years={lausYears}
              format="pct"
              label="Unemployment rate by year"
              color={FDA_COLORS[3]!}
            />
          </div>
          <div className="min-w-0">
            <h4 className="mb-1 text-[12px] font-semibold">Per capita personal income (BEA)</h4>
            <YearBars
              series={c.beaPerCapita}
              years={beaYears}
              format="dollars"
              label="Per capita personal income by year"
              color={FDA_COLORS[1]!}
            />
          </div>
        </div>
      </section>
      <section className="resource-panel" aria-label="Cities and places in the county">
        <div className="research-band">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="size-4" aria-hidden />
            Cities and places
          </h3>
          <span className="text-[11px] text-[var(--navy-muted)]">
            10,000+ residents or among the state's 15 largest
          </span>
        </div>
        {c.cities.length ? (
          <ul className="m-0 grid list-none gap-x-4 p-0 px-3 py-2 text-[12px] sm:grid-cols-2">
            {c.cities.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2 py-0.5">
                <Link
                  to="/records/$dataset/$id"
                  params={{ dataset: "city_profiles", id: p.id }}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {p.name}
                </Link>
                {!p.incorporated ? (
                  <span className="text-[10px] text-muted-foreground">CDP</span>
                ) : null}
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatPlaceValue(p.population, "int")}
                </span>
                {p.share != null && p.share < 99.95 ? (
                  <span className="text-[10.5px] text-muted-foreground">
                    {p.share.toFixed(0)}% here
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No place of 10,000 or more residents lies in this county.
          </p>
        )}
      </section>
      <p className="m-0 text-[11px] leading-4 text-muted-foreground">
        Sources: Census ACS 2020-2024 5-year summary file and Population Estimates (Vintage 2025);
        BLS Local Area Unemployment Statistics; BEA CAINC1; FJC Integrated Database (civil); OSHA
        inspection data; CFPB Consumer Complaint Database; EPA ECHO Exporter; 28 U.S.C. ch. 5. Full
        records:{" "}
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "county_profiles", id: c.fips }}
          className="underline"
        >
          county profile
        </Link>
        ,{" "}
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "county_legal_activity", id: c.fips }}
          className="underline"
        >
          legal activity
        </Link>
        .
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="m-0 font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function DistrictLine({ c }: { c: CountyAnalysis }) {
  const d = c.district;
  const ds = c.districtSummary;
  return (
    <section className="resource-panel" aria-label="Federal district">
      <div className="research-band">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Landmark className="size-4" aria-hidden />
          Federal district
        </h3>
        {ds ? (
          <span className="text-[11px] text-[var(--navy-muted)]">
            {ds.counties.length} counties · {formatPlaceValue(ds.population, "int")} residents
          </span>
        ) : null}
      </div>
      <div className="space-y-1 px-3 py-2 text-[12.5px]">
        {d ? (
          <>
            <p className="m-0">
              <Link
                to="/courts/$id"
                params={{ id: d.courtId }}
                className="font-medium text-primary hover:underline"
              >
                {d.district}
              </Link>
              {d.division ? ` · ${d.division}` : ""}
              {d.heldAt.length ? (
                <span className="text-muted-foreground">
                  {" "}
                  · court held at {d.heldAt.join(", ")}
                </span>
              ) : null}
            </p>
            <p className="m-0 text-[11px] text-muted-foreground">
              {d.method === "local_rule" ? "Named in the court's local rules" : "28 U.S.C. ch. 5"}
              {d.codeName &&
              d.method !== "exact" &&
              d.method !== "whole_state" &&
              d.method !== "local_rule"
                ? ` (the Code writes "${d.codeName}")`
                : ""}
              {d.exception ? `; ${d.exception}` : ""}.{" "}
              {d.sourceUrl ? (
                <a
                  href={externalHref(d.sourceUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Source text
                </a>
              ) : null}
            </p>
          </>
        ) : (
          <p className="m-0 text-muted-foreground">
            {NOT_RECORDED}: neither 28 U.S.C. ch. 5 nor the court's local rules name this
            county-equivalent, and a district is never assigned by geography.
          </p>
        )}
      </div>
    </section>
  );
}

function CompareTable({
  c,
  keys,
  moe = false,
}: {
  c: CountyAnalysis;
  keys: string[];
  moe?: boolean;
}) {
  return (
    <table className="w-full min-w-[40rem] text-[12px]">
      <thead>
        <tr className="border-b border-border text-left text-[10.5px] text-muted-foreground">
          <th scope="col" className="px-3 py-1.5 font-medium">
            Measure
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            {c.name}
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            Median county
          </th>
          <th scope="col" className="w-36 px-2 py-1.5 font-medium">
            Among {c.usps} counties
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-medium">
            {c.state}
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            U.S.
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {keys.map((k) => {
          const def = METRIC_BY_KEY.get(k);
          if (!def) return null;
          const v = c.metrics[k] ?? null;
          const acs = moe ? c.acs[k] : undefined;
          const dist = c.stateDistributions[k];
          return (
            <tr key={k}>
              <th scope="row" className="px-3 py-1 text-left font-normal">
                <span className="block">{def.label}</span>
                <span className="block text-[10.5px] text-muted-foreground">{def.unit}</span>
              </th>
              <td
                className={cn(
                  "px-2 py-1 text-right font-mono tabular-nums",
                  v == null && "text-muted-foreground",
                )}
              >
                {formatPlaceValue(v, def.format)}
                {acs?.moe != null && acs.moe > 0 && v != null ? (
                  <span className="block text-[10px] text-muted-foreground">
                    ± {formatPlaceValue(acs.moe, def.format)}
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-1 text-right font-mono tabular-nums text-muted-foreground">
                {formatPlaceValue(dist?.median, def.format)}
              </td>
              <td className="px-2 py-1">
                <RangeMark value={v} dist={dist} format={def.format} />
              </td>
              <td className="px-2 py-1 text-right font-mono tabular-nums">
                {formatPlaceValue(c.stateValues[k], def.format)}
              </td>
              <td className="px-3 py-1 text-right font-mono tabular-nums">
                {formatPlaceValue(c.usValues[k], def.format)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
