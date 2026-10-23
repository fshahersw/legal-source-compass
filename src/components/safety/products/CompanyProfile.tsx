/**
 * Company safety facts by the exact name each source publishes (/safety/companies?name=…): CFPB complaints, OSHA
 * inspections and citations, CMS Open Payments, NHTSA complaints and stored MAUDE reports. Sources are never merged:
 * a name that differs by one character is a different company here. Identifiers link only when they are exact (the
 * CMS Open Payments manufacturer id).
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Kpi, LoadingBlock, Panel, StateNote } from "@/components/enforcement/parts";
import { formatCount } from "./productModel";
import { companyQuery } from "./queries";

const usd = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? `$${Math.round(v).toLocaleString("en-US")}`
    : "Not recorded";

export function CompanyProfile({ name }: { name: string }) {
  const q = useQuery(companyQuery(name));
  if (q.isLoading) return <LoadingBlock label="Loading the company" />;
  if (q.error)
    return (
      <StateNote
        tone="error"
        action={
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Retry
          </Button>
        }
      >
        The company facts could not be loaded.
      </StateNote>
    );
  const p = q.data;
  if (!p)
    return (
      <StateNote>Company safety facts are not loaded into the corpus yet (safety/1).</StateNote>
    );
  const none = !p.cfpb && !p.osha && !p.open_payments && !p.nhtsa && !p.maude;
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        Facts recorded under the exact name “{p.name}”. Each source is shown on its own; nothing is
        merged across sources or matched by a similar name.
        {p.identifiers.insights_entities.length ? " Company page (by CMS manufacturer id): " : ""}
        {p.identifiers.insights_entities.map((e) =>
          e.href ? (
            <Link key={e.id} to={e.href} className="ml-1 text-primary hover:underline">
              {e.label}
            </Link>
          ) : (
            <span key={e.id} className="ml-1">
              {e.label}
            </span>
          ),
        )}
      </p>
      {none ? <StateNote>No source records a company under exactly this name.</StateNote> : null}
      {p.cfpb ? (
        <Panel title="CFPB consumer complaints" subtitle={p.cfpb.caveat}>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {Object.entries(p.cfpb.by_year)
              .slice(-6)
              .map(([y, n]) => (
                <Kpi key={y} label={y} value={formatCount(n)} />
              ))}
          </div>
          <div className="grid gap-3 px-3 pb-3 md:grid-cols-2">
            <List
              title="Products"
              rows={p.cfpb.top_products.map((x) => [x.product, formatCount(x.complaints)])}
            />
            <List
              title="Issues"
              rows={p.cfpb.top_issues.map((x) => [x.issue, formatCount(x.complaints)])}
            />
          </div>
        </Panel>
      ) : null}
      {p.osha ? (
        <Panel title="OSHA inspections (DOL enforcement data)">
          <div className="grid gap-2 p-3 sm:grid-cols-4">
            <Kpi
              label="Inspections"
              value={formatCount(p.osha.inspections)}
              note={`${p.osha.first_open ?? "?"} – ${p.osha.last_open ?? "?"}`}
            />
            <Kpi label="Citations" value={formatCount(p.osha.violations)} />
            <Kpi label="Current penalties" value={usd(p.osha.current_penalty)} />
          </div>
        </Panel>
      ) : null}
      {p.open_payments ? (
        <Panel
          title="CMS Open Payments (general payments)"
          subtitle="Amounts attributed to the first product named on each payment record."
        >
          <div className="grid gap-2 p-3 sm:grid-cols-4">
            {Object.entries(p.open_payments.by_year).map(([y, v]) => (
              <Kpi
                key={y}
                label={y}
                value={usd(v.amount_usd)}
                note={`${formatCount(v.records)} records`}
              />
            ))}
          </div>
          <div className="px-3 pb-3">
            <List
              title="Products"
              rows={p.open_payments.top_products.map((x) => [
                x.product || "Not recorded",
                usd(x.amount_usd),
              ])}
            />
          </div>
        </Panel>
      ) : null}
      {p.nhtsa ? (
        <Panel
          title="NHTSA vehicle complaints (manufacturer as recorded)"
          subtitle={p.nhtsa.caveat}
        >
          <div className="grid gap-2 p-3 sm:grid-cols-5">
            <Kpi
              label="Complaints"
              value={formatCount(p.nhtsa.complaints)}
              note={`${p.nhtsa.first ?? "?"} – ${p.nhtsa.last ?? "?"}`}
            />
            <Kpi label="Crash" value={formatCount(p.nhtsa.crash)} />
            <Kpi label="Fire" value={formatCount(p.nhtsa.fire)} />
            <Kpi label="Injured" value={formatCount(p.nhtsa.injured)} />
            <Kpi label="Deaths" value={formatCount(p.nhtsa.deaths)} />
          </div>
        </Panel>
      ) : null}
      {p.maude ? (
        <Panel
          title="MAUDE device reports (stored records)"
          subtitle={`${p.maude.scope}. ${p.maude.caveat}`}
        >
          <div className="p-3">
            <Kpi
              label="Reports naming this maker"
              value={formatCount(p.maude.reports_in_stored_records)}
            />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function List({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold">{title}</h4>
      <ol className="divide-y divide-border/60 rounded border border-border text-xs">
        {rows.length ? (
          rows.map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2 px-2 py-1">
              <span className="min-w-0 truncate" title={k}>
                {k}
              </span>
              <span className="tabular-nums text-muted-foreground">{v}</span>
            </li>
          ))
        ) : (
          <li className="px-2 py-1 text-muted-foreground">Not recorded</li>
        )}
      </ol>
    </div>
  );
}
