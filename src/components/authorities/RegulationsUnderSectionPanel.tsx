import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  mergeAuthorities,
  mergeByCfrTitle,
  sectionKeyId,
  tableEdition,
  type AuthorityRow,
  type CfrTitleParts,
} from "@/lib/external/ecfrAuthorities";
import { getRegulationsUnderSection } from "@/lib/external/ecfrAuthorities.functions";
import { Capped, PanelError, PanelFrame, PanelLoading, SourceFoot } from "./parts";

const PARTS_SHOWN = 8;
const TITLES_SHOWN = 6;

function PartLine({
  cfrTitle,
  part,
  stored,
  heading,
}: {
  cfrTitle: number;
  part: string;
  stored: boolean;
  heading: string | null | undefined;
}) {
  return (
    <li className="flex gap-x-2 py-0.5 leading-snug">
      {stored ? (
        <Link
          to="/law/cfr/$title/part/$part"
          params={{ title: String(cfrTitle), part }}
          className="min-w-[4.25rem] shrink-0 font-medium tabular-nums text-primary hover:underline"
        >
          Part {part}
        </Link>
      ) : (
        <span className="min-w-[4.25rem] shrink-0 font-medium tabular-nums">Part {part}</span>
      )}
      <span className="min-w-0 text-muted-foreground">
        {heading ?? (stored ? "Heading not recorded" : "Not in the stored eCFR")}
      </span>
    </li>
  );
}

function TitleBlock({
  g,
  headings,
}: {
  g: CfrTitleParts;
  headings: Record<string, string | null>;
}) {
  const extra = [
    ...g.ranges.map((x) => `${x} (a range of parts, not expanded)`),
    ...g.unparsed.map((x) => `“${x}” (printed as one entry)`),
  ];
  return (
    <div className="mt-2 first:mt-0">
      <h3 className="m-0 flex flex-wrap items-baseline gap-x-2 text-[12px] font-semibold">
        <Link
          to="/law/cfr/$title"
          params={{ title: String(g.cfrTitle) }}
          className="hover:underline"
        >
          {g.cfrTitle} CFR
        </Link>
        <span className="font-normal text-muted-foreground">
          {g.parts.length.toLocaleString("en-US")} {g.parts.length === 1 ? "part" : "parts"}
          {g.pages.length
            ? ` · table page${g.pages.length > 1 ? "s" : ""} ${g.pages.join(", ")}`
            : ""}
        </span>
      </h3>
      <Capped
        items={g.parts}
        limit={PARTS_SHOWN}
        noun="parts"
        render={(p) => (
          <PartLine
            key={p.part}
            cfrTitle={g.cfrTitle}
            part={p.part}
            stored={p.stored}
            heading={p.stored ? headings[`${g.cfrTitle}:${p.part}`] : null}
          />
        )}
      />
      {extra.length ? (
        <p className="m-0 mt-0.5 text-[11px] text-muted-foreground">
          Also printed: {extra.join("; ")}.
        </p>
      ) : null}
    </div>
  );
}

function EdgeRows({ rows }: { rows: AuthorityRow[] }) {
  const merged = mergeAuthorities(rows);
  return (
    <div className="mt-3 border-t border-border/70 pt-2">
      <h3 className="m-0 text-[12px] font-semibold">
        Printed as a range or “et seq.” that begins or ends at this section
      </h3>
      <p className="m-0 mb-1 text-[11px] text-muted-foreground">
        The table does not say which sections inside the span each part relies on, so these rows are
        shown as printed and not expanded.
      </p>
      <Capped
        items={merged}
        limit={5}
        noun="entries"
        render={(m) => (
          <li key={m.key} className="py-0.5 leading-snug">
            <span className="font-medium">{m.citation}</span>
            <span className="text-muted-foreground">
              {" → "}
              {rows
                .filter((r) => `${r.category}|${r.heading}|${r.authority}` === m.key)
                .map(
                  (r) =>
                    `${r.cfr.title} CFR ${r.cfr.label.toLowerCase() === "part" ? "Part" : "Parts"} ${r.cfr.partsText}`,
                )
                .join("; ")}
            </span>
          </li>
        )}
      />
    </div>
  );
}

/**
 * For a U.S. Code section page: the CFR parts that cite this exact section as rulemaking authority (Parallel Table of
 * Authorities and Rules), with each stored part's heading and a link to its /law/cfr page. A part the table lists but the
 * stored eCFR does not hold is shown unlinked; ranges and "et seq." rows are kept separate and never expanded.
 */
export function RegulationsUnderSectionPanel({
  title,
  sectionKey,
}: {
  title: string;
  sectionKey: string;
}) {
  const valid = sectionKeyId(title, sectionKey) !== null;
  const fn = useServerFn(getRegulationsUnderSection);
  const q = useQuery({
    queryKey: ["regulations-under-section", title, sectionKey],
    queryFn: () => fn({ data: { title, key: sectionKey } }),
    enabled: valid,
    staleTime: 30 * 60 * 1000,
  });
  if (!valid) return null;
  const d = q.data;
  const direct = (d?.exact ?? []).filter((r) => r.link.state === "resolved");
  const notes = (d?.exact ?? []).filter((r) => r.link.state === "resolved_note");
  const groups = mergeByCfrTitle(direct);
  const noteGroups = mergeByCfrTitle(notes);
  const firstSource = [...(d?.exact ?? []), ...(d?.edge ?? [])].find((r) => r.sourceUrl) ?? null;
  const total = groups.reduce((n, g) => n + g.parts.length, 0);
  const aside = !d
    ? null
    : d.status === "unavailable"
      ? null
      : total
        ? `${total.toLocaleString("en-US")} ${total === 1 ? "part" : "parts"} in ${groups.length} ${groups.length === 1 ? "title" : "titles"} · ${tableEdition(d.meta)}`
        : tableEdition(d.meta);
  return (
    <PanelFrame
      label="Regulations that cite this section"
      title="Regulations that cite this section"
      aside={aside}
    >
      {q.isPending ? (
        <PanelLoading label="Loading the regulations that cite this section" />
      ) : q.isError ? (
        <PanelError
          what="The regulations that cite this section"
          onRetry={() => void q.refetch()}
        />
      ) : d!.status === "unavailable" ? (
        <p className="m-0 text-muted-foreground">
          The Parallel Table of Authorities and Rules is not loaded in this workspace, so the
          regulations that cite this section cannot be listed.
        </p>
      ) : (
        <>
          {groups.length ? (
            <Capped
              items={groups}
              limit={TITLES_SHOWN}
              noun="CFR titles"
              render={(g) => (
                <li key={g.cfrTitle}>
                  <TitleBlock g={g} headings={d!.headings} />
                </li>
              )}
            />
          ) : (
            <p className="m-0 text-muted-foreground">
              The table prints no CFR part under this exact section.
              {d!.edge.length
                ? " Rows printed as a range or “et seq.” at this section are listed below."
                : ""}
            </p>
          )}
          {noteGroups.length ? (
            <div className="mt-3 border-t border-border/70 pt-2">
              <h3 className="m-0 mb-1 text-[12px] font-semibold">
                Printed as the note to this section
              </h3>
              {noteGroups.map((g) => (
                <TitleBlock key={g.cfrTitle} g={g} headings={d!.headings} />
              ))}
            </div>
          ) : null}
          {d!.edge.length ? <EdgeRows rows={d!.edge} /> : null}
          {d!.dropped ? (
            <p className="m-0 mt-2 text-[11px] text-muted-foreground">
              {d!.dropped} stored {d!.dropped === 1 ? "row" : "rows"} could not be read and{" "}
              {d!.dropped === 1 ? "is" : "are"} not shown.
            </p>
          ) : null}
          {d!.truncated ? (
            <p className="m-0 mt-2 text-[11px] text-muted-foreground">
              The list was cut at its size limit; open the source for the full table.
            </p>
          ) : null}
          <SourceFoot
            meta={d!.meta}
            url={firstSource?.sourceUrl ?? null}
            page={firstSource?.page ?? null}
          />
        </>
      )}
    </PanelFrame>
  );
}
