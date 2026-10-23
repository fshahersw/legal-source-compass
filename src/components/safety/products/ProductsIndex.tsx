/**
 * Products & devices index (/safety/products): MDL product groups (products the JPML titles name), FAERS drugs (openFDA
 * harmonised generic names, ranked by reports) and MAUDE device product codes, searchable, paged, each linking to its page.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Gavel, Pill, Search, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateNote } from "@/components/enforcement/parts";
import { formatCount, KIND_LABELS, NOT_RECORDED, type SafetySubjectRow } from "./productModel";
import { PAGE_SIZE, subjectsQuery, type IndexView } from "./queries";
import { ViewTabs } from "./ViewTabs";

const TABS = [
  { id: "mdl" as const, label: "Named in MDL titles", Icon: Gavel },
  { id: "drugs" as const, label: "Drugs (FAERS)", Icon: Pill },
  { id: "devices" as const, label: "Devices (MAUDE)", Icon: Stethoscope },
];

const NOTES: Record<IndexView, string> = {
  mdl: "Products an MDL's official JPML title names, matched to adverse-event, device-report, recall and complaint data by the title's own words. Each link records its basis.",
  drugs:
    "Drugs by their openFDA harmonised generic name, ranked by the number of FAERS reports that list them (any role).",
  devices:
    "Medical device product codes (FDA classification), ranked by the number of MAUDE reports.",
};

export function ProductsIndex({
  view,
  q,
  page,
  onChange,
}: {
  view: IndexView;
  q: string;
  page: number;
  onChange: (next: { view?: IndexView; q?: string; page?: number }) => void;
}) {
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const query = useQuery(subjectsQuery(view, q, page));
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <div className="min-w-0 space-y-3">
      <ViewTabs
        label="Product lists"
        idPrefix="safety-products"
        tabs={TABS}
        active={view}
        onSelect={(v) => onChange({ view: v, page: 1 })}
      />
      <div
        id="safety-products-panel"
        role="tabpanel"
        aria-labelledby={`safety-products-tab-${view}`}
        className="min-w-0 space-y-3"
      >
        <p className="text-xs leading-5 text-muted-foreground">{NOTES[view]}</p>
        <form
          role="search"
          className="flex max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ q: draft.trim(), page: 1 });
          }}
        >
          <label htmlFor="safety-products-q" className="sr-only">
            Search products
          </label>
          <Input
            id="safety-products-q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              view === "devices" ? "Device name or product code" : "Product, brand or MDL product"
            }
            className="h-8 text-sm"
            maxLength={100}
          />
          <Button type="submit" size="sm" variant="outline" className="h-8">
            <Search className="size-3.5" aria-hidden />
            Search
          </Button>
        </form>
        {query.isLoading ? (
          <div className="space-y-1.5" aria-busy="true" aria-label="Loading products">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-8 animate-pulse rounded border border-border bg-muted/50" />
            ))}
          </div>
        ) : query.error ? (
          <StateNote
            tone="error"
            action={
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                Retry
              </Button>
            }
          >
            The product list could not be loaded.
          </StateNote>
        ) : data === null ? (
          <StateNote>
            Product signal data are not loaded into the corpus yet (safety/1). The other safety
            views are unaffected.
          </StateNote>
        ) : !data || data.rows.length === 0 ? (
          <StateNote>
            {q ? `No product matches “${q}”.` : "No products are recorded for this list yet."}
          </StateNote>
        ) : (
          <>
            <ProductTable rows={data.rows} view={view} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {formatCount(data.total)} {data.total === 1 ? "product" : "products"}
                {pages > 1 ? ` · page ${page} of ${pages}` : ""}
              </span>
              {pages > 1 ? (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={page <= 1}
                    onClick={() => onChange({ page: page - 1 })}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={page >= pages}
                    onClick={() => onChange({ page: page + 1 })}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProductTable({ rows, view }: { rows: SafetySubjectRow[]; view: IndexView }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[520px] text-left text-xs">
        <caption className="sr-only">Products, with their report counts</caption>
        <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {view !== "mdl" ? (
              <th scope="col" className="w-12 px-2 py-1.5 text-right font-medium">
                Rank
              </th>
            ) : null}
            <th scope="col" className="px-2 py-1.5 font-medium">
              {view === "devices" ? "Device (product code)" : "Product"}
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Kind
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Reports
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              MDLs
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
              {view !== "mdl" ? (
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {r.rank ?? "—"}
                </td>
              ) : null}
              <td className="max-w-[28rem] px-2 py-1.5">
                <Link
                  to="/safety/products/$id"
                  params={{ id: r.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {r.label}
                </Link>
                {view === "devices" && typeof r.keys["product_code"] === "string" ? (
                  <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                    {r.keys["product_code"] as string}
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">{KIND_LABELS[r.kind] ?? r.kind}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.reports_total == null ? (
                  <span className="text-muted-foreground">{NOT_RECORDED}</span>
                ) : (
                  formatCount(r.reports_total)
                )}
              </td>
              <td className="px-2 py-1.5">
                {r.mdls.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.mdls.map((m) => (
                      <Link
                        key={m}
                        to="/matters/lens/$mdl"
                        params={{ mdl: String(m) }}
                        className="text-primary hover:underline"
                      >
                        {m}
                      </Link>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
