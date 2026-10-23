/**
 * Law atlas: a zoomable icicle of the United States Code (title › chapter › section) or the Code of Federal Regulations
 * (title › chapter › part › section). Height = sections or stored text; colour = recency of change (median year of the
 * latest recorded change across the sections). Click or Enter zooms; a section opens its page. Data: lawviz_atlas_v1.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ChevronRight, CornerLeftUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ChartFrame, type ChartStatus, type TableSpec } from "@/components/charts/ChartFrame";
import { Icicle, type IcicleDatum } from "@/components/charts/Icicle";
import { Segmented } from "@/components/enforcement/parts";
import {
  RECENCY_BINS,
  UNIT_WORD,
  childNoun,
  fullName,
  isLeaf,
  nodeLink,
  recencyBin,
  shortName,
  sizeOf,
  type AtlasCorpus,
  type AtlasLink,
  type AtlasNode,
  type AtlasView,
  type SizeBy,
} from "@/lib/lawviz/atlas";
import { getAtlasView } from "@/lib/lawviz/lawviz.functions";
import { Notice, RampLegend } from "./parts";
import { builtNote, fmtDate, fmtInt } from "./format";
import { RAMP, rampInkLight } from "./ramp";

const COPY: Record<
  AtlasCorpus,
  { title: string; sources: { label: string; url: string }[]; colour: string; root: string }
> = {
  usc: {
    title: "Atlas of the United States Code",
    root: "United States Code",
    sources: [
      {
        label: "Office of the Law Revision Counsel",
        url: "https://uscode.house.gov/download/download.shtml",
      },
      {
        label: "Statutes at Large (GovInfo)",
        url: "https://www.govinfo.gov/app/collection/statute",
      },
    ],
    colour:
      "Colour is the year of the latest law the Office of the Law Revision Counsel cites in a section's source credit, Amendments note or status heading, joined by exact law id to the Statutes at Large; a title or chapter shows the median of its sections' years.",
  },
  cfr: {
    title: "Atlas of the Code of Federal Regulations",
    root: "Code of Federal Regulations",
    sources: [
      { label: "eCFR", url: "https://www.ecfr.gov/" },
      { label: "eCFR versioner", url: "https://www.ecfr.gov/developers/documentation/api/v1" },
    ],
    colour:
      "Colour is the year of the latest version the eCFR lists for a section (its point-in-time record begins on January 3, 2017; an earlier year is the date of the version in force then); a title, chapter or part shows the median of its sections' years.",
  },
};

type Focus = { node: string | null; range: AtlasNode | null };

/** A typed router link for an atlas node's page. */
function AtlasLinkTo({
  link,
  className,
  children,
}: {
  link: AtlasLink;
  className?: string;
  children: ReactNode;
}) {
  switch (link.to) {
    case "/law/uscode/$title":
      return (
        <Link
          to={link.to}
          params={link.params}
          search={{ q: undefined, c: link.search.c }}
          className={className}
        >
          {children}
        </Link>
      );
    case "/law/uscode/$title/$section":
      return (
        <Link to={link.to} params={link.params} className={className}>
          {children}
        </Link>
      );
    case "/law/cfr/$title":
      return (
        <Link to={link.to} params={link.params} className={className}>
          {children}
        </Link>
      );
    case "/law/cfr/$title/part/$part":
      return (
        <Link to={link.to} params={link.params} className={className}>
          {children}
        </Link>
      );
    case "/law/cfr/$title/$section":
      return (
        <Link to={link.to} params={link.params} search={link.search} className={className}>
          {children}
        </Link>
      );
  }
}

export function LawAtlas({ corpus }: { corpus: AtlasCorpus }) {
  const copy = COPY[corpus];
  const [focus, setFocus] = useState<Focus>({ node: null, range: null });
  const [sizeBy, setSizeBy] = useState<SizeBy>("sections");
  const fn = useServerFn(getAtlasView);
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: [
      "lawviz-atlas",
      corpus,
      focus.node,
      focus.range?.range?.lo ?? null,
      focus.range?.range?.hi ?? null,
    ],
    queryFn: () =>
      fn({
        data: {
          corpus,
          node: focus.node,
          ...(focus.range?.range ? { from: focus.range.range.lo, to: focus.range.range.hi } : {}),
        },
      }),
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
  const view: AtlasView | undefined = q.data;
  const ok = view?.status === "ok" ? view : null;
  const unit = UNIT_WORD[corpus];

  const colourOf = (n: AtlasNode) => {
    const b = recencyBin(corpus, n.medianYear);
    return b === null
      ? { fill: null, light: false }
      : { fill: RAMP[b] ?? null, light: rampInkLight(b) };
  };

  // The focus shown at the left: the range itself when one is open, else the node the server returned.
  // While the next level loads the previous one stays on screen (dimmed): a range applies only to its own payload.
  const range =
    focus.range &&
    ok?.range &&
    ok.focus.id === focus.range.parent &&
    ok.range[0] === focus.range.range?.lo
      ? focus.range
      : null;
  const shownFocus = ok ? (range ?? ok.focus) : null;
  const root = useMemo((): IcicleDatum | null => {
    if (!ok || !shownFocus) return null;
    const grand = new Map<string, AtlasNode[]>();
    for (const g of ok.grandchildren) {
      if (!g.parent) continue;
      grand.set(g.parent, [...(grand.get(g.parent) ?? []), g]);
    }
    // Cells carry the full name (truncated to fit). Children not loaded are not drawn as empty boxes: the tooltip and
    // the table say how many there are.
    const datum = (n: AtlasNode, kids?: AtlasNode[]): IcicleDatum => {
      const c = colourOf(n);
      return {
        id: n.id,
        label: n.kind === "root" ? copy.root : fullName(corpus, n),
        value: sizeOf(n, sizeBy),
        fill: c.fill,
        lightInk: c.light,
        ...(kids ? { children: kids.map((k) => datum(k, grand.get(k.id))) } : {}),
      };
    };
    return datum(shownFocus, ok.children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, shownFocus, sizeBy, corpus]);

  const byId = useMemo(() => {
    const m = new Map<string, AtlasNode>();
    if (ok)
      for (const n of [ok.focus, ...ok.path, ...ok.children, ...ok.grandchildren]) m.set(n.id, n);
    if (range) m.set(range.id, range);
    return m;
  }, [ok, range]);

  const zoom = (n: AtlasNode) => {
    if (n.kind === "range" && n.parent) setFocus({ node: n.parent, range: n });
    else setFocus({ node: n.id === corpus ? null : n.id, range: null });
  };
  const open = (n: AtlasNode) => {
    const l = nodeLink(corpus, n);
    if (l) void navigate(l as never);
  };
  const up = () => {
    if (!ok) return;
    if (range) setFocus({ node: ok.focus.id === corpus ? null : ok.focus.id, range: null });
    else if (ok.focus.parent)
      setFocus({ node: ok.focus.parent === corpus ? null : ok.focus.parent, range: null });
  };
  const atTop = !!ok && !range && ok.focus.parent === null;

  const tooltipFor = (d: IcicleDatum, depth: number) => {
    const n = byId.get(d.id);
    if (!n) return { title: d.label, rows: [] };
    const rows = [
      { key: "s", label: n.sections === 1 ? unit[0] : unit[1], value: fmtInt(n.sections) },
      { key: "c", label: "characters of text", value: fmtInt(n.chars) },
      {
        key: "y",
        label: isLeaf(n) ? "year of last change" : "median year of last change",
        value: n.medianYear !== null ? String(n.medianYear) : "Not recorded",
      },
      { key: "l", label: "latest change", value: fmtDate(n.lastChange) },
    ];
    if (!isLeaf(n) && n.sections > 0)
      rows.push({
        key: "r",
        label: `of ${fmtInt(n.sections)} with a recorded date`,
        value: fmtInt(n.recorded),
      });
    if (!isLeaf(n) && n.kind !== "range" && depth > 0)
      rows.push({ key: "k", label: childNoun(corpus, n), value: fmtInt(n.children) });
    const hint =
      depth === 0
        ? atTop
          ? undefined
          : "Click or press Escape to go up"
        : isLeaf(n)
          ? "Click or press Enter to open the section"
          : "Click or press Enter to zoom in";
    return {
      title: fullName(corpus, n),
      rows,
      footer:
        [n.status ? `Status: ${n.status}` : null, hint].filter(Boolean).join(" · ") || undefined,
    };
  };
  const describe = (d: IcicleDatum) => {
    const n = byId.get(d.id);
    if (!n) return d.label;
    return `${fullName(corpus, n)}: ${fmtInt(n.sections)} ${n.sections === 1 ? unit[0] : unit[1]}, ${fmtInt(n.chars)} characters, ${
      n.medianYear !== null
        ? `${isLeaf(n) ? "last changed" : "median year of last change"} ${n.medianYear}`
        : "change date not recorded"
    }.`;
  };

  const status: ChartStatus = q.isLoading
    ? { kind: "loading" }
    : q.error
      ? { kind: "error", onRetry: () => void q.refetch() }
      : !view || view.status === "unavailable"
        ? {
            kind: "empty",
            reason:
              "The atlas is not available yet: its figures are computed in the database from the stored code and have not been published. The titles below are unaffected.",
          }
        : view.status === "empty"
          ? { kind: "empty", reason: `No ${unit[1]} are recorded for the ${copy.root} yet.` }
          : view.status === "not_found" || view.status === "invalid"
            ? {
                kind: "empty",
                reason: "That part of the atlas is no longer recorded. Start again from the top.",
              }
            : { kind: "ready" };

  const table: TableSpec | undefined = ok
    ? {
        caption: `${fullName(corpus, shownFocus!)}: ${ok.binned ? "runs of consecutive units" : "contents"}`,
        columns: [
          { label: "Name", align: "left" },
          { label: unit[1][0]!.toUpperCase() + unit[1].slice(1) },
          { label: "Characters" },
          { label: "With a change date" },
          { label: "Median year" },
          { label: "Latest change" },
        ],
        rows: ok.children.map((n) => {
          const l = nodeLink(corpus, n);
          const name = fullName(corpus, n);
          return {
            key: n.id,
            muted: n.sections === 0,
            cells: [
              l ? (
                <AtlasLinkTo link={l} className="text-primary hover:underline">
                  {name}
                </AtlasLinkTo>
              ) : (
                <button
                  type="button"
                  className="text-left text-primary hover:underline"
                  onClick={() => zoom(n)}
                >
                  {name}
                </button>
              ),
              fmtInt(n.sections),
              fmtInt(n.chars),
              fmtInt(n.recorded),
              n.medianYear !== null ? String(n.medianYear) : "Not recorded",
              fmtDate(n.lastChange),
            ],
          };
        }),
      }
    : undefined;

  const notices: string[] = [];
  if (ok?.binned)
    notices.push(
      `${fullName(corpus, ok.focus)} holds ${fmtInt(ok.childrenTotal)} ${unit[1]}; they are drawn as ${ok.children.length} runs of consecutive ones. Open a run to see each one.`,
    );
  if (ok?.truncated)
    notices.push(
      `Only the first ${fmtInt(ok.children.length)} of ${fmtInt(ok.childrenTotal)} are drawn.`,
    );
  if (ok?.dropped)
    notices.push(`${fmtInt(ok.dropped)} stored rows could not be read and are left out.`);
  const zeroHidden = ok ? ok.children.filter((n) => sizeOf(n, sizeBy) === 0).length : 0;
  const crumbs = ok ? [...ok.path, ok.focus, ...(range ? [range] : [])] : [];
  const focusLink = shownFocus ? nodeLink(corpus, shownFocus) : null;

  return (
    <ChartFrame
      title={copy.title}
      unit={
        sizeBy === "sections"
          ? `${unit[1]} (height) · recency of change (colour)`
          : "characters of stored text (height) · recency of change (colour)"
      }
      sources={copy.sources}
      status={status}
      table={table}
      minHeight={420}
      partialNotice={notices.length ? notices.join(" ") : undefined}
      actions={
        <Segmented
          label="Size by"
          value={sizeBy}
          options={[
            { id: "sections", label: "Sections" },
            { id: "chars", label: "Text volume" },
          ]}
          onChange={setSizeBy}
        />
      }
      notes={[
        "Each band is one level: the left band is where you are, the next shows what it contains, the third what those contain. Height is proportional to the count of sections, or to the characters of their stored text.",
        copy.colour,
        "Hatched cells have no recorded change date. Use the arrow keys inside the chart to move, Enter to zoom in or open a section, Escape to go back up; the table lists every row with a link.",
      ]}
      footnotes={[
        ...builtNote(view?.builtAt ?? null),
        ...(ok
          ? [
              `${fmtInt(ok.focus.recorded)} of ${fmtInt(ok.focus.sections)} ${unit[1]} here have a recorded change date.`,
            ]
          : []),
        ...(zeroHidden
          ? [
              `${fmtInt(zeroHidden)} ${zeroHidden === 1 ? "entry" : "entries"} with no ${sizeBy === "chars" ? "stored text" : unit[1]} ${zeroHidden === 1 ? "is" : "are"} listed in the table but not drawn.`,
            ]
          : []),
      ]}
    >
      {ok && root ? (
        <div className="space-y-2 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav aria-label="Atlas level" className="min-w-0">
              <ol className="m-0 flex list-none flex-wrap items-center gap-0.5 p-0 text-[12px]">
                {crumbs.map((n, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <li key={n.id} className="flex min-w-0 items-center gap-0.5">
                      {i > 0 ? (
                        <ChevronRight
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      ) : null}
                      {last ? (
                        <span aria-current="location" className="truncate font-medium">
                          {n.kind === "root" ? copy.root : shortName(corpus, n)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => zoom(n)}
                          className="truncate rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {n.kind === "root" ? copy.root : shortName(corpus, n)}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
            <div className="flex items-center gap-3 text-[12px]">
              {!atTop ? (
                <button
                  type="button"
                  onClick={up}
                  className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <CornerLeftUp className="size-3" aria-hidden />
                  Up one level
                </button>
              ) : null}
              {focusLink ? (
                <AtlasLinkTo
                  link={focusLink}
                  className="inline-flex items-center gap-1 rounded text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Open {shortName(corpus, shownFocus!)}
                  <ArrowRight className="size-3" aria-hidden />
                </AtlasLinkTo>
              ) : null}
            </div>
          </div>
          <RampLegend
            title={corpus === "usc" ? "Year of latest amendment" : "Year of latest eCFR version"}
            labels={RECENCY_BINS[corpus].map((b) => b.label)}
          />
          <Icicle
            root={root}
            height={440}
            ariaLabel={`${copy.title}, at ${fullName(corpus, shownFocus!)}.`}
            describe={describe}
            tooltip={tooltipFor}
            busy={q.isFetching}
            onUp={atTop ? undefined : up}
            onSelect={(d) => {
              const n = byId.get(d.id);
              if (!n) return;
              if (isLeaf(n)) open(n);
              else zoom(n);
            }}
          />
          {ok.children.length === 0 ? (
            <Notice>Nothing is recorded under {fullName(corpus, shownFocus!)}.</Notice>
          ) : null}
        </div>
      ) : null}
    </ChartFrame>
  );
}
