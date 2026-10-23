import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { CFR_TITLE } from "@/lib/external/ecfrFull";
import {
  agencyMatches,
  agencyTree,
  referenceLabel,
  referencedTitles,
  type AgencyNode,
  type CfrReference,
  type PreparedIndex,
} from "@/lib/external/ecfrFindingAids";
import { getAgenciesForTitle, getCfrAgencies } from "@/lib/external/ecfrAuthorities.functions";
import { PanelError, PanelFrame, PanelLoading } from "./parts";

const SOURCE = "https://www.ecfr.gov/api/admin/v1/agencies.json";
const longDay = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function AgencyName({ n, child }: { n: AgencyNode; child?: boolean }) {
  const label = (
    <>
      {n.name}
      {n.shortName ? (
        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{n.shortName}</span>
      ) : null}
    </>
  );
  return n.profileId ? (
    <Link
      to="/agencies/$id"
      params={{ id: n.profileId }}
      className={
        child ? "text-primary hover:underline" : "font-medium text-primary hover:underline"
      }
    >
      {label}
    </Link>
  ) : (
    <span className={child ? "" : "font-medium"}>{label}</span>
  );
}

/** "Title 7: Chapter I, Chapter VIII" per title (or just the chapters when `only` names one title), as the eCFR lists them. */
function References({ refs, only }: { refs: CfrReference[]; only?: number }) {
  const groups: [number | null, string[]][] = [];
  for (const r of refs) {
    if (only !== undefined && r.title !== only) continue;
    let g = groups.find((x) => x[0] === r.title);
    if (!g) {
      g = [r.title, []];
      groups.push(g);
    }
    const label = referenceLabel({ ...r, title: null });
    if (label) g[1].push(label);
  }
  if (!groups.length) return <span className="text-muted-foreground">No CFR title recorded</span>;
  return (
    <span className="text-muted-foreground">
      {groups.map(([t, labels], i) => (
        <span key={String(t)}>
          {i ? "; " : ""}
          {only === undefined && t !== null ? (
            <>
              {CFR_TITLE.test(String(t)) ? (
                <Link
                  to="/law/cfr/$title"
                  params={{ title: String(t) }}
                  className="text-primary hover:underline"
                >
                  Title {t}
                </Link>
              ) : (
                `Title ${t}`
              )}
              {labels.length ? ": " : ""}
            </>
          ) : null}
          {labels.join(", ")}
          {only !== undefined && !labels.length ? "Whole title" : ""}
        </span>
      ))}
    </span>
  );
}

function PreparedList({
  rows,
  byName,
}: {
  rows: PreparedIndex[];
  byName: Map<string, AgencyNode>;
}) {
  if (!rows.length) return null;
  return (
    <details className="mt-3 border-t border-border/70 pt-2">
      <summary className="cursor-pointer text-[12px] font-semibold">
        Agency-prepared indexes printed in CFR volumes ({rows.length})
      </summary>
      <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
        {rows.map((p) => {
          const a = p.linkedAgency ? byName.get(p.linkedAgency) : undefined;
          return (
            <li key={p.id} className="leading-snug">
              <Link
                to="/law/cfr/$title"
                params={{ title: String(p.cfrTitle) }}
                className="font-medium text-primary hover:underline"
              >
                {p.cfrTitle} CFR {p.scope}
              </Link>
              {p.indexesPrinted ? (
                <span className="text-muted-foreground"> {p.indexesPrinted}</span>
              ) : null}
              <span className="text-muted-foreground">
                {" "}
                · {p.agencyAsPrinted ?? "Agency not recorded"}
              </span>
              {a ? <span className="text-muted-foreground"> · eCFR agency: {a.name}</span> : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * Browse the Code of Federal Regulations by agency: the eCFR's own agency list (top-level agencies and their child
 * agencies) with the CFR titles and chapters each is responsible for, as the eCFR lists them. Filter by name, short name or
 * slug. A title name links to the Atlas page for that title.
 */
export function CfrAgencyIndex() {
  const fn = useServerFn(getCfrAgencies);
  const q = useQuery({
    queryKey: ["cfr-agencies"],
    queryFn: () => fn(),
    staleTime: 60 * 60 * 1000,
  });
  const [text, setText] = useState("");
  const [all, setAll] = useState(false);
  const d = q.data;
  const tree = useMemo(() => (d ? agencyTree(d.agencies) : []), [d]);
  const shown = useMemo(() => {
    const t = text.trim();
    if (!t) return tree.map((x) => ({ ...x, kids: x.children }));
    return tree
      .map((x) => {
        const self = agencyMatches(x.node, t);
        const kids = self ? x.children : x.children.filter((c) => agencyMatches(c, t));
        return self || kids.length ? { ...x, kids } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [tree, text]);
  const limit = all || text.trim() ? shown.length : 12;
  const byName = useMemo(() => new Map((d?.agencies ?? []).map((a) => [a.slug, a])), [d]);
  return (
    <PanelFrame
      label="Browse the CFR by agency"
      title="Browse by agency"
      aside={
        d && d.status === "ok"
          ? `${d.agencies.length.toLocaleString("en-US")} agencies and components · eCFR agency list${d.retrievedAt ? `, retrieved ${longDay(d.retrievedAt)}` : ""}`
          : null
      }
    >
      {q.isPending ? (
        <PanelLoading label="Loading the agency list" />
      ) : q.isError ? (
        <PanelError what="The agency list" onRetry={() => void q.refetch()} />
      ) : d!.status === "unavailable" ? (
        <p className="m-0 text-muted-foreground">
          The eCFR agency list is not loaded in this workspace.
        </p>
      ) : (
        <>
          <label className="relative mb-2 block max-w-sm">
            <span className="sr-only">Filter agencies</span>
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Filter by agency name or abbreviation"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2.5 text-xs"
            />
          </label>
          {shown.length ? (
            <ul className="m-0 list-none divide-y divide-border/60 p-0">
              {shown.slice(0, limit).map(({ node, kids }) => (
                <li key={node.slug} className="py-1.5 leading-snug">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <AgencyName n={node} />
                    <References refs={node.references} />
                  </div>
                  {kids.length ? (
                    <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0 pl-4">
                      {kids.map((c) => (
                        <li key={c.slug} className="flex flex-wrap items-baseline gap-x-2">
                          <AgencyName n={c} child />
                          <References refs={c.references} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-muted-foreground">No agency matches “{text.trim()}”.</p>
          )}
          {!text.trim() && shown.length > 12 ? (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="mt-1 rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {all ? "Show fewer" : `+${(shown.length - 12).toLocaleString("en-US")} more agencies`}
            </button>
          ) : null}
          <PreparedList rows={d!.prepared} byName={byName} />
          {d!.dropped ? (
            <p className="m-0 mt-2 text-[11px] text-muted-foreground">
              {d!.dropped} stored {d!.dropped === 1 ? "record" : "records"} could not be read and{" "}
              {d!.dropped === 1 ? "is" : "are"} not shown.
            </p>
          ) : null}
          <p className="m-0 mt-2.5 border-t border-border/70 pt-2 text-[11px] leading-4 text-muted-foreground">
            Source:{" "}
            <a
              href={SOURCE}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              eCFR agency list (admin API)
            </a>
            ; agency-prepared indexes from the CFR Index and Finding Aids. The grouping of chapters
            under agencies is the eCFR’s editorial arrangement; a chapter shared by several agencies
            appears under each.
          </p>
        </>
      )}
    </PanelFrame>
  );
}

/** For a CFR title page: the agencies the eCFR lists for this exact title, with the chapters it gives for that title. */
export function AgenciesForTitlePanel({ title }: { title: string }) {
  const valid = CFR_TITLE.test(title);
  const fn = useServerFn(getAgenciesForTitle);
  const q = useQuery({
    queryKey: ["agencies-for-title", title],
    queryFn: () => fn({ data: { title } }),
    enabled: valid,
    staleTime: 60 * 60 * 1000,
  });
  if (!valid) return null;
  const d = q.data;
  const n = Number(title);
  const list = (d?.agencies ?? [])
    .filter((a) => referencedTitles(a).includes(n))
    .sort((a, b) => a.order - b.order);
  const parentName = (a: AgencyNode) =>
    a.parent ? (d?.agencies.find((x) => x.slug === a.parent)?.name ?? null) : null;
  return (
    <PanelFrame
      label="Agencies responsible for this title"
      title="Agencies responsible for this title"
      aside={d && d.status === "ok" ? "eCFR agency list" : null}
    >
      {q.isPending ? (
        <PanelLoading label="Loading the agencies for this title" />
      ) : q.isError ? (
        <PanelError what="The agencies for this title" onRetry={() => void q.refetch()} />
      ) : d!.status === "unavailable" ? (
        <p className="m-0 text-muted-foreground">
          The eCFR agency list is not loaded in this workspace.
        </p>
      ) : !list.length ? (
        <p className="m-0 text-muted-foreground">
          The eCFR agency list names no agency for title {title}.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-0.5 p-0">
          {list.map((a) => (
            <li key={a.slug} className="flex flex-wrap items-baseline gap-x-2 leading-snug">
              <AgencyName n={a} child />
              <References refs={a.references} only={n} />
              {parentName(a) ? (
                <span className="text-[11px] text-muted-foreground">part of {parentName(a)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}
