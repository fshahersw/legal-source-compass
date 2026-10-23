import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PART_TOKEN } from "@/lib/external/ecfrAuthorities";
import { getSubjectsForPart } from "@/lib/external/ecfrAuthorities.functions";
import { CFR_PART, CFR_TITLE } from "@/lib/external/ecfrFull";
import { Capped, PanelError, PanelFrame, PanelLoading } from "./parts";

/**
 * For a CFR part page: the subject headings of the CFR Subject/Agency Index that carry a reference to exactly this title
 * and part, each with the printed entries (and the printed lines they hang under). Entries are shown as printed.
 */
export function SubjectsForPartPanel({ title, part }: { title: string; part: string }) {
  const valid = CFR_TITLE.test(title) && CFR_PART.test(part) && PART_TOKEN.test(part);
  const fn = useServerFn(getSubjectsForPart);
  const q = useQuery({
    queryKey: ["subjects-for-part", title, part],
    queryFn: () => fn({ data: { title, part } }),
    enabled: valid,
    staleTime: 30 * 60 * 1000,
  });
  if (!valid) return null;
  const d = q.data;
  return (
    <PanelFrame
      label="Subject index entries for this part"
      title="Indexed under"
      aside={
        d && d.status === "ok" && d.headings.length
          ? `${d.headings.length.toLocaleString("en-US")} subject ${d.headings.length === 1 ? "heading" : "headings"} · CFR Subject/Agency Index`
          : null
      }
    >
      {q.isPending ? (
        <PanelLoading label="Loading the subject index entries for this part" />
      ) : q.isError ? (
        <PanelError what="The subject index entries" onRetry={() => void q.refetch()} />
      ) : d!.status === "unavailable" ? (
        <p className="m-0 text-muted-foreground">
          The CFR Subject/Agency Index is not loaded in this workspace.
        </p>
      ) : !d!.headings.length ? (
        <p className="m-0 text-muted-foreground">
          The CFR Subject/Agency Index prints no entry for part {part} of title {title}.
        </p>
      ) : (
        <>
          <Capped
            items={d!.headings}
            limit={6}
            noun="headings"
            render={(h) => (
              <li key={h.id} className="py-1 leading-snug">
                <span className="font-medium">{h.heading}</span>
                {h.page ? (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    index page {h.page}
                  </span>
                ) : null}
                <ul className="m-0 mt-0.5 list-none space-y-0.5 p-0 pl-3 text-muted-foreground">
                  {h.entries.slice(0, 4).map((e, i) => (
                    <li key={i}>
                      {e.context.length ? <span>{e.context.join(" › ")} › </span> : null}
                      {e.text}
                    </li>
                  ))}
                  {h.entries.length > 4 ? (
                    <li>+{h.entries.length - 4} more entries under this heading</li>
                  ) : null}
                </ul>
              </li>
            )}
          />
          {d!.truncated ? (
            <p className="m-0 mt-2 text-[11px] text-muted-foreground">
              The list was cut at its size limit.
            </p>
          ) : null}
          <p className="m-0 mt-2.5 border-t border-border/70 pt-2 text-[11px] leading-4 text-muted-foreground">
            Source: CFR Subject/Agency Index, CFR Index and Finding Aids, Office of the Federal
            Register. The index directs readers to parts; it is not a list of every provision on a
            subject.
          </p>
        </>
      )}
    </PanelFrame>
  );
}
