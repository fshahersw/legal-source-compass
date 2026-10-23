import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  PART_TOKEN,
  mergeAuthorities,
  sectionAuthorities,
  tableEdition,
  type MergedAuthority,
} from "@/lib/external/ecfrAuthorities";
import {
  getAuthoritiesForPart,
  type StoredSection,
} from "@/lib/external/ecfrAuthorities.functions";
import { CFR_PART, CFR_TITLE } from "@/lib/external/ecfrFull";
import { Capped, PanelError, PanelFrame, PanelLoading, SourceFoot } from "./parts";

const SHOWN = 10;
const pages = (m: MergedAuthority) =>
  m.pages.length ? `table page${m.pages.length > 1 ? "s" : ""} ${m.pages.join(", ")}` : "";

const STATUS: Record<string, string> = {
  repealed: "Repealed",
  omitted: "Omitted",
  transferred: "Transferred",
  renumbered: "Renumbered",
  reserved: "Reserved",
  expired: "Expired",
};

function Group({
  title,
  note,
  items,
  render,
}: {
  title: string;
  note?: string;
  items: MergedAuthority[];
  render: (m: MergedAuthority) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <div className="mt-3 first:mt-0">
      <h3 className="m-0 flex items-baseline gap-x-2 text-[12px] font-semibold">
        {title}
        <span className="font-normal text-muted-foreground">
          {items.length.toLocaleString("en-US")}
        </span>
      </h3>
      {note ? <p className="m-0 mb-0.5 text-[11px] text-muted-foreground">{note}</p> : null}
      <Capped items={items} limit={SHOWN} noun="entries" render={render} />
    </div>
  );
}

function StatuteLine({ m, sec }: { m: MergedAuthority; sec: StoredSection | undefined }) {
  const l = m.link;
  const stored = (l.state === "resolved" || l.state === "resolved_note") && l.title && l.key;
  return (
    <li className="grid grid-cols-[7.75rem_minmax(0,1fr)] gap-x-2 py-0.5 leading-snug">
      {stored ? (
        <Link
          to="/law/uscode/$title/$section"
          params={{ title: l.title!, section: l.key! }}
          className="font-medium text-primary hover:underline"
        >
          {m.citation}
        </Link>
      ) : (
        <span className="font-medium">{m.citation}</span>
      )}
      <span className="text-muted-foreground">
        {stored ? (sec?.heading ?? "Heading not recorded") : "Not in the stored Code"}
        {l.state === "resolved_note" ? " (printed as the note to this section)" : ""}
        {sec?.status && STATUS[sec.status] ? (
          <span className="ml-2 rounded border border-border bg-muted/60 px-1.5 py-px text-[10.5px]">
            {STATUS[sec.status]}
          </span>
        ) : null}
      </span>
    </li>
  );
}

const printed = (m: MergedAuthority) => (
  <li key={m.key} className="py-0.5 leading-snug">
    <span className="font-medium">{m.citation}</span>
    {pages(m) ? <span className="ml-2 text-[11px] text-muted-foreground">{pages(m)}</span> : null}
  </li>
);

/**
 * For a CFR part page: the authorities the Parallel Table of Authorities and Rules lists for this exact part. U.S. Code
 * sections link to /law/uscode pages when they are stored (with their heading); a section the stored Code does not hold,
 * and every range, “et seq.”, Statutes at Large, public law and Presidential document entry, is shown as printed.
 */
export function AuthoritiesForPartPanel({ title, part }: { title: string; part: string }) {
  const valid = CFR_TITLE.test(title) && CFR_PART.test(part) && PART_TOKEN.test(part);
  const fn = useServerFn(getAuthoritiesForPart);
  const q = useQuery({
    queryKey: ["authorities-for-part", title, part],
    queryFn: () => fn({ data: { title, part } }),
    enabled: valid,
    staleTime: 30 * 60 * 1000,
  });
  if (!valid) return null;
  const d = q.data;
  const merged = d ? mergeAuthorities(d.rows) : [];
  const s = sectionAuthorities(merged);
  const first = d?.rows.find((r) => r.sourceUrl) ?? null;
  return (
    <PanelFrame
      label="Statutes this part rests on"
      title="Statutes and other authorities cited for this part"
      aside={
        d && d.status === "ok"
          ? `${merged.length.toLocaleString("en-US")} ${merged.length === 1 ? "authority" : "authorities"} · ${tableEdition(d.meta)}`
          : null
      }
    >
      {q.isPending ? (
        <PanelLoading label="Loading the authorities cited for this part" />
      ) : q.isError ? (
        <PanelError what="The authorities for this part" onRetry={() => void q.refetch()} />
      ) : d!.status === "unavailable" ? (
        <p className="m-0 text-muted-foreground">
          The Parallel Table of Authorities and Rules is not loaded in this workspace, so the
          authorities for this part cannot be listed. The part’s own authority note is printed
          above.
        </p>
      ) : !merged.length ? (
        <p className="m-0 text-muted-foreground">
          The table lists no authority for part {part} of title {title}. The part’s own authority
          note is printed above.
        </p>
      ) : (
        <>
          <Group
            title="U.S. Code"
            items={s.statutes}
            render={(m) => (
              <StatuteLine key={m.key} m={m} sec={m.link.id ? d!.sections[m.link.id] : undefined} />
            )}
          />
          <Group
            title="Ranges, “et seq.” and other forms"
            note="Shown as printed and not expanded into sections."
            items={s.rangesAndOther}
            render={printed}
          />
          <Group title="Statutes at Large" items={s.statutesAtLarge} render={printed} />
          <Group title="Public laws" items={s.publicLaws} render={printed} />
          <Group title="Presidential documents" items={s.presidential} render={printed} />
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
          <SourceFoot meta={d!.meta} url={first?.sourceUrl ?? null} page={first?.page ?? null} />
        </>
      )}
    </PanelFrame>
  );
}
