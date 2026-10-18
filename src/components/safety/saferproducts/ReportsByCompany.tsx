import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { int, NOT_RECORDED, pct } from "@/components/analysis/analysisFormat";
import {
  LoadingBlock,
  Panel,
  Segmented,
  SortHeader,
  StateNote,
} from "@/components/enforcement/parts";
import {
  getSaferProductsCompanies,
  type SaferProductsCompanies,
  type SpCompany,
} from "@/lib/external/saferProducts.functions";
import { ShowMore } from "../ShowMore";
import { UnverifiedBadge } from "./parts";
import { saferProductsCompaniesQuery } from "./queries";
import {
  companyCounts,
  filterCompanies,
  matchLevelShort,
  recallMatchText,
  sortCompanies,
  UNVERIFIED,
  type CompanyRole,
  type CompanySort,
} from "./saferProductsView";

const STEP = 25;

export function ReportsByCompany() {
  const q = useQuery(saferProductsCompaniesQuery);
  if (q.isLoading) return <LoadingBlock label="Loading reports by company" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        Reports by company could not be loaded.
      </StateNote>
    );
  if (!q.data) return <StateNote>Reports by company have not been published yet.</StateNote>;
  return <CompaniesBody data={q.data} />;
}

function CompaniesBody({ data }: { data: SaferProductsCompanies }) {
  const [role, setRole] = useState<CompanyRole>("manufacturer");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CompanySort>("reports");
  const [desc, setDesc] = useState(true);
  const [limit, setLimit] = useState(STEP);
  const counts = useMemo(() => companyCounts(data.companies), [data.companies]);
  const rows = useMemo(
    () => sortCompanies(filterCompanies(data.companies, role, query), sort, desc),
    [data.companies, role, query, sort, desc],
  );
  const shown = rows.slice(0, limit);
  const rc = data.recallCheck;
  const click = (key: CompanySort) => {
    if (sort === key) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(key !== "name");
    }
    setLimit(STEP);
  };

  return (
    <Panel
      id="sp-companies"
      title="Reports by company"
      subtitle={`Manufacturer, importer and retailer strings with at least ${data.threshold ?? 25} reports, exactly as consumers typed them`}
      actions={
        <>
          <UnverifiedBadge />
          <Segmented
            label="Company role"
            value={role}
            options={[
              { id: "manufacturer", label: `Manufacturers (${int(counts.manufacturers)})` },
              { id: "retailer", label: `Retailers (${int(counts.retailers)})` },
            ]}
            onChange={(r) => {
              setRole(r);
              setLimit(STEP);
            }}
          />
        </>
      }
      footnote={
        <>
          <span className="block">
            {UNVERIFIED}: a report naming a company is not a finding about that company. Each name
            is the exact string in the report; spelling variants are listed and never merged, so a
            firm can appear several times (for example Walmart, walmart and WalMart).
          </span>
          <span className="mt-0.5 block">
            “Company-name match” means a recall firm has the same name after normalisation; name
            equality is not identity of firms and says nothing about whether a reported product was
            recalled. Retailer strings were not matched.
            {rc?.reportsByLevel
              ? ` By reports, matches are exact string ${int(rc.reportsByLevel.exact)}, normalised ${int(rc.reportsByLevel.normalised)}, after dropping the recall firm's location ${int(rc.reportsByLevel.locationStripped)}; no match ${int(rc.reportsByLevel.none)}.`
              : ""}
            {rc?.productPairs
              ? ` Exact product-text pairs link ${int(rc.productPairs.pairs)} reports to ${int(rc.productPairs.recalls)} recalls.`
              : ""}
            {counts.withProfile
              ? ` ${int(counts.withProfile)} rows link to a company profile on a unique exact name match.`
              : ""}
          </span>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search company names</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(STEP);
            }}
            placeholder={`Search ${role === "manufacturer" ? "manufacturer" : "retailer"} names`}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          {int(rows.length)} {role === "manufacturer" ? "manufacturer" : "retailer"} strings
        </span>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Unverified SaferProducts.gov reports by {role} name string
            </caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  #
                </th>
                <SortHeader
                  label="Name as recorded"
                  align="left"
                  active={sort === "name"}
                  desc={desc}
                  onClick={() => click("name")}
                />
                <SortHeader
                  label="Unverified reports"
                  active={sort === "reports"}
                  desc={desc}
                  onClick={() => click("reports")}
                />
                <th scope="col" className="hidden px-2 py-1.5 text-right font-medium xl:table-cell">
                  Share
                </th>
                <SortHeader
                  label="Death reports"
                  active={sort === "deaths"}
                  desc={desc}
                  onClick={() => click("deaths")}
                />
                {role === "manufacturer" ? (
                  <SortHeader
                    label="Comment rate"
                    active={sort === "comment"}
                    desc={desc}
                    onClick={() => click("comment")}
                  />
                ) : null}
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Recall company-name match
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Company profile
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((c) => (
                <CompanyRow key={c.id} c={c} showComment={role === "manufacturer"} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StateNote>
          No {role} string matches “{query}”. Only names with at least {data.threshold ?? 25}{" "}
          reports are listed.
        </StateNote>
      )}
      <ShowMore
        shown={shown.length}
        total={rows.length}
        step={STEP}
        onMore={() => setLimit((l) => l + STEP)}
        onAll={() => setLimit(rows.length)}
        noun="names"
      />
    </Panel>
  );
}

function CompanyRow({ c, showComment }: { c: SpCompany; showComment: boolean }) {
  const recall = recallMatchText(c);
  const variantTitle = c.variants.length
    ? `Other spellings listed, not included in these counts: ${c.variants.map((v) => `${v.name} (${int(v.reports)})`).join("; ")}${c.variantCount > c.variants.length ? `; and ${int(c.variantCount - c.variants.length)} more` : ""}`
    : undefined;
  return (
    <tr>
      <td className="px-2 py-1 font-mono text-muted-foreground">{c.rank ?? "—"}</td>
      <td className="max-w-64 px-2 py-1">
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "saferproducts_companies", id: c.id }}
          className="block truncate text-primary hover:underline"
          title={c.name}
        >
          {c.name}
        </Link>
        {c.variantCount > 0 ? (
          <span className="block text-[11px] text-muted-foreground" title={variantTitle}>
            {int(c.variantCount)} other {c.variantCount === 1 ? "spelling" : "spellings"} listed,
            not merged
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1 text-right font-mono">{int(c.reports)}</td>
      <td className="hidden px-2 py-1 text-right font-mono xl:table-cell">{pct(c.sharePct, 2)}</td>
      <td className="px-2 py-1 text-right font-mono">{int(c.deaths)}</td>
      {showComment ? (
        <td className="px-2 py-1 text-right font-mono">
          {c.commentRatePct != null ? pct(c.commentRatePct, 1) : NOT_RECORDED}
        </td>
      ) : null}
      <td className="max-w-64 px-2 py-1" title={recall.detail ?? undefined}>
        {c.recallMatch ? (
          <Link
            to="/records/$dataset/$id"
            params={{ dataset: "saferproducts_recalls_crosscheck", id: c.recallMatch.recordId }}
            className="text-primary hover:underline"
          >
            {recall.text}
          </Link>
        ) : (
          <span className="text-muted-foreground">{recall.text}</span>
        )}
        {c.recallMatch ? (
          <span className="block truncate text-[11px] text-muted-foreground">
            {matchLevelShort(c.recallMatch.level)}
            {c.recallMatch.firstRecall ? `; first ${c.recallMatch.firstRecall}` : ""}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1">
        {c.cik ? (
          <Link
            to="/companies/$cik"
            params={{ cik: c.cik }}
            className="text-primary hover:underline"
            title={c.secTitle ?? undefined}
          >
            SEC profile
          </Link>
        ) : (
          <span className="text-muted-foreground">Not linked</span>
        )}
      </td>
    </tr>
  );
}
