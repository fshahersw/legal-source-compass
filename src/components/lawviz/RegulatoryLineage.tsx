/**
 * Regulatory lineage of one CFR part, as swimlanes on one time axis: the U.S. Code sections that authorize it (the laws
 * that enacted or amended each one), the Federal Register documents that list the part among their CFR references, and
 * the dates its sections changed in the eCFR. Every lane comes from exact keys (lawviz_part_lineage_v1); citations the
 * authority line prints as "et seq.", ranges or notes are listed as printed and never drawn as a section.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChartFrame, type ChartStatus, type TableSpec } from "@/components/charts/ChartFrame";
import {
  Swimlanes,
  type SwimEvent,
  type SwimGroup,
  type SwimLane,
} from "@/components/charts/Swimlanes";
import { Segmented } from "@/components/enforcement/parts";
import { getPartLineage, type LineageAuthority } from "@/lib/lawviz/lawviz.functions";
import { FR_LANES, frLane, type Lineage } from "@/lib/lawviz/lineage";
import { Notice } from "./parts";
import { fmtDate, fmtInt } from "./format";

const MAX_STATUTE_LANES = 10;
type Span = "1994" | "2017" | "all";
const KIND_LABEL: Record<string, string> = {
  source_credit: "source credit",
  amendment_note: "Amendments note",
  status_note: "status heading",
};
const REASON_LABEL: Record<LineageAuthority["reason"], string> = {
  exact: "Exact section",
  et_seq: "“et seq.” — not expanded",
  range: "Range — not expanded",
  note: "Note — not a section",
  appendix: "Appendix citation",
  other_form: "Not a section citation",
};

const GROUPS: SwimGroup[] = [
  {
    id: "law",
    label: "Authorizing statutes: laws enacting or amending each cited section",
    slot: 0,
  },
  { id: "fr", label: "Federal Register documents citing this part", slot: 1 },
  { id: "ver", label: "Section versions in the eCFR", slot: 2 },
];

const today = () => new Date().toISOString().slice(0, 10);
/** "101.9" -> "§ 101.9"; an appendix keeps its own name. */
const sectionLabel = (identifier: string) =>
  /^\d/.test(identifier) ? `§ ${identifier}` : identifier;

function buildLanes(l: Lineage, title: string, part: string, laneLimit: number) {
  const lanes: SwimLane[] = [];
  for (const s of l.statutes.slice(0, laneLimit)) {
    lanes.push({
      id: `law-${s.id}`,
      group: "law",
      label: s.citation.replace(/\s+/g, " "),
      emptyText: "No enacting or amending law with a recorded date",
      events: s.laws
        .filter((x) => x.enacted)
        .map((x) => ({
          id: `${s.id}|${x.id}`,
          date: x.enacted!,
          label: x.label,
          detail: x.kinds.map((k) => KIND_LABEL[k] ?? k).join(", "),
          href: `/records/public_laws_enacted/${encodeURIComponent(x.id)}`,
        })),
    });
  }
  for (const lane of FR_LANES) {
    const base = {
      id: `fr-${lane.id}`,
      group: "fr",
      label: lane.label,
      emptyText: "None recorded",
    };
    if (l.fr.complete)
      lanes.push({
        ...base,
        events: l.fr.docs
          .filter((d) => frLane(d.type) === lane.id)
          .map((d) => ({
            id: d.id,
            date: d.date,
            label: d.citation ?? "Federal Register document",
            detail: d.title.length > 90 ? `${d.title.slice(0, 89)}…` : d.title,
            href: d.url,
          })),
      });
    else {
      const bars = new Map<string, number>();
      for (const m of l.fr.months)
        if (frLane(m.type) === lane.id) bars.set(m.month, (bars.get(m.month) ?? 0) + m.n);
      lanes.push({ ...base, bars: [...bars.entries()].map(([month, n]) => ({ month, n })) });
    }
  }
  lanes.push({
    id: "ver-all",
    group: "ver",
    label: `Any of its ${fmtInt(l.versions.sections)} sections`,
    emptyText: "No version dates recorded",
    events: l.versions.dates.map((d) => ({
      id: `all-${d.date}`,
      date: d.date,
      label: `${fmtInt(d.n)} ${d.n === 1 ? "section" : "sections"} changed`,
      weight: d.n,
      href: `https://www.ecfr.gov/on/${d.date}/title-${title}/part-${encodeURIComponent(part)}`,
    })),
  });
  for (const s of l.versions.lanes) {
    lanes.push({
      id: `ver-${s.id}`,
      group: "ver",
      label: `${sectionLabel(s.identifier)}${s.removed ? " (removed)" : ""}`,
      emptyText: "No substantive change recorded",
      events: s.dates.map((d) => ({
        id: `${s.id}@${d.date}`,
        date: d.date,
        label: d.fr.length ? d.fr.map((f) => f.citation).join("; ") : "Version date",
        detail: s.removed ? "removed section" : "text as of this date",
        href: s.removed
          ? null
          : `/law/cfr/${title}/${encodeURIComponent(s.identifier)}?asof=${d.date}`,
      })),
    });
  }
  return lanes;
}

export function RegulatoryLineage({ title, part }: { title: string; part: string }) {
  const fn = useServerFn(getPartLineage);
  const navigate = useNavigate();
  const [span, setSpan] = useState<Span>("1994");
  const q = useQuery({
    queryKey: ["lawviz-lineage", title, part],
    queryFn: () => fn({ data: { title, part } }),
    staleTime: 30 * 60_000,
  });
  const data = q.data;
  const lin = data?.lineage.status === "ok" ? data.lineage : null;
  const lanes = useMemo(
    () => (lin ? buildLanes(lin, title, part, MAX_STATUTE_LANES) : []),
    [lin, title, part],
  );
  const earliest = useMemo(() => {
    let min = "9999-12-31";
    for (const ln of lanes) {
      for (const e of ln.events ?? []) if (e.date < min) min = e.date;
      for (const b of ln.bars ?? []) if (`${b.month}-01` < min) min = `${b.month}-01`;
    }
    return min === "9999-12-31" ? "1994-01-01" : `${min.slice(0, 4)}-01-01`;
  }, [lanes]);
  const start = span === "all" ? earliest : span === "2017" ? "2017-01-01" : "1994-01-01";
  const domain: [string, string] = [start, today()];

  const status: ChartStatus = q.isLoading
    ? { kind: "loading" }
    : q.error
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !data || data.lineage.status === "unavailable"
        ? {
            kind: "empty",
            reason:
              "Regulatory lineage is not available yet: it is read from the database views that have not been published. The authorities this part cites are listed below.",
          }
        : data.lineage.status === "invalid"
          ? { kind: "empty", reason: "This part cannot be looked up for lineage." }
          : lin?.empty
            ? {
                kind: "empty",
                reason:
                  "No authorizing U.S. Code section, Federal Register document or section version is recorded for this part.",
              }
            : { kind: "ready" };

  const notices: string[] = [];
  if (lin && !lin.fr.complete)
    notices.push(
      `${fmtInt(lin.fr.total)} Federal Register documents cite this part: they are drawn as monthly counts, and the latest ${fmtInt(lin.fr.docs.length)} are listed in the table.`,
    );
  if (lin && lin.statutes.length > MAX_STATUTE_LANES)
    notices.push(
      `${lin.statutes.length - MAX_STATUTE_LANES} more authorizing sections are listed in the table, not drawn.`,
    );
  if (data && data.notDrawn.length)
    notices.push(
      `${data.notDrawn.length} further exact authorities exceed the 24 read for one page.`,
    );
  if (lin?.versions.selection === "most_changed")
    notices.push(
      `The part has ${fmtInt(lin.versions.sections)} sections: the first versions lane counts every one, the others show the ${lin.versions.lanes.length} most changed.`,
    );
  if (lin?.dropped)
    notices.push(`${fmtInt(lin.dropped)} stored rows could not be read and are left out.`);

  const table: TableSpec | undefined = lin
    ? {
        caption: `Lineage of ${title} CFR part ${part}`,
        columns: [
          { label: "Lane", align: "left" },
          { label: "Date", align: "left" },
          { label: "Item", align: "left" },
        ],
        rows: [
          ...lin.statutes.flatMap((s) =>
            (s.laws.length ? s.laws : [null]).map((x, i) => ({
              key: `law-${s.id}-${x?.id ?? i}`,
              muted: !x || !x.enacted,
              cells: [
                s.citation,
                x ? fmtDate(x.enacted) : "Not recorded",
                x ? (
                  <Link
                    to="/records/$dataset/$id"
                    params={{ dataset: "public_laws_enacted", id: x.id }}
                    className="text-primary hover:underline"
                  >
                    {x.label}
                  </Link>
                ) : (
                  "No enacting or amending law linked"
                ),
              ],
            })),
          ),
          ...lin.fr.docs.map((d) => ({
            key: `fr-${d.id}`,
            cells: [
              `Federal Register: ${d.type}`,
              fmtDate(d.date),
              d.url ? (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {d.citation ?? d.id} — {d.title}
                </a>
              ) : (
                `${d.citation ?? d.id} — ${d.title}`
              ),
            ],
          })),
          ...lin.versions.lanes.flatMap((s) =>
            s.dates.map((d) => ({
              key: `ver-${s.id}-${d.date}`,
              cells: [
                `${sectionLabel(s.identifier)}${s.removed ? " (removed)" : ""}`,
                fmtDate(d.date),
                d.fr.map((f) => f.citation).join("; ") || "Version date",
              ],
            })),
          ),
        ],
      }
    : undefined;

  const onOpen = (e: SwimEvent) => {
    if (!e.href) return;
    if (e.href.startsWith("/")) void navigate({ href: e.href } as never);
    else window.open(e.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-2">
      <ChartFrame
        title="Regulatory lineage"
        unit="dated events"
        period={`${start.slice(0, 4)}–${today().slice(0, 4)}`}
        sources={[
          { label: "Office of the Law Revision Counsel", url: "https://uscode.house.gov/" },
          {
            label: "Parallel Table of Authorities (CFR Index, GovInfo)",
            url: "https://www.govinfo.gov/app/details/GPO-CFR-INDEX-2025",
          },
          { label: "Federal Register", url: "https://www.federalregister.gov/" },
          { label: "eCFR versioner", url: "https://www.ecfr.gov/developers/documentation/api/v1" },
        ]}
        status={status}
        table={table}
        minHeight={260}
        asOf={lin?.part_record?.asOf ? `${fmtDate(lin.part_record.asOf)} (eCFR)` : undefined}
        partialNotice={notices.length ? notices.join(" ") : undefined}
        actions={
          <Segmented
            label="Time span"
            value={span}
            options={[
              { id: "1994", label: "Since 1994" },
              { id: "2017", label: "Since 2017" },
              { id: "all", label: "All years" },
            ]}
            onChange={setSpan}
          />
        }
        notes={[
          "Authorizing statutes are the U.S. Code sections this part's authority line or the Parallel Table of Authorities cites by exact title and section; each dot is a law the Office of the Law Revision Counsel cites in that section's source credit, Amendments note or status heading, at its enactment date.",
          "Federal Register documents are those whose CFR references list this exact title and part (from 1994); a document that cites a part may amend it or only discuss it.",
          "Section versions are the dates the eCFR lists a substantive change (from January 3, 2017; an earlier date is the version in force then). A larger dot holds several events on one day; ◂ counts events before the time span.",
        ]}
      >
        {lin ? (
          <div className="pb-2">
            <Swimlanes
              groups={GROUPS}
              lanes={lanes}
              domain={domain}
              ariaLabel={`Lineage of ${title} CFR part ${part}: authorizing statutes, Federal Register documents and section versions over time.`}
              onOpen={onOpen}
              unitLabel={(n, lane) =>
                `${fmtInt(n)} ${
                  lane.group === "fr"
                    ? n === 1
                      ? "document"
                      : "documents"
                    : lane.group === "law"
                      ? n === 1
                        ? "law"
                        : "laws"
                      : lane.id === "ver-all"
                        ? n === 1
                          ? "section change"
                          : "section changes"
                        : n === 1
                          ? "change"
                          : "changes"
                }`
              }
            />
          </div>
        ) : null}
      </ChartFrame>
      {data ? (
        <AuthorityList
          authorities={data.authorities}
          missing={lin?.missing ?? []}
          drawn={lin?.statutes.slice(0, MAX_STATUTE_LANES).map((s) => s.id) ?? []}
        />
      ) : null}
    </div>
  );
}

function AuthorityList({
  authorities,
  missing,
  drawn,
}: {
  authorities: LineageAuthority[];
  missing: string[];
  drawn: string[];
}) {
  if (!authorities.length)
    return (
      <Notice>
        No U.S. Code authority is printed for this part or listed for it in the Parallel Table of
        Authorities.
      </Notice>
    );
  const exact = authorities.filter((a) => a.reason === "exact").length;
  return (
    <details className="rounded-md border border-border bg-surface px-3 py-1.5 text-[12px]">
      <summary className="cursor-pointer select-none text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
        U.S. Code authorities for this part: {fmtInt(exact)} exact sections,{" "}
        {fmtInt(authorities.length - exact)} printed otherwise
      </summary>
      <ul className="m-0 mt-1.5 grid list-none gap-x-6 gap-y-0.5 p-0 sm:grid-cols-2">
        {authorities.map((a) => {
          const [t, key] = a.id ? a.id.split(/:(.*)/s) : [null, null];
          const notStored = a.id ? missing.includes(a.id) : false;
          return (
            <li
              key={`${a.id ?? a.printed}`}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2"
            >
              {a.id && t && key && !notStored ? (
                <Link
                  to="/law/uscode/$title/$section"
                  params={{ title: t, section: key }}
                  className="text-primary hover:underline"
                >
                  {a.printed}
                </Link>
              ) : (
                <span>{a.printed}</span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {notStored ? "Not in the stored Code" : REASON_LABEL[a.reason]}
                {a.id && !notStored && !drawn.includes(a.id) ? " · not drawn" : ""}
                {" · "}
                {a.basis
                  .map((b) => (b === "ptoa" ? "Parallel Table" : "authority note"))
                  .join(" and ")}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
