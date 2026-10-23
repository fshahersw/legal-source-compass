import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink } from "lucide-react";
import { Panel, StateNote } from "@/components/enforcement/parts";
import { getRegsDocket } from "@/lib/external/apiLaw.functions";
import { HitRow } from "./ApiLawBrowser";

export const docketQueryKey = (id: string) => ["regs-docket", id] as const;

/** One Regulations.gov docket: its facts as published, and every held Rule, Proposed Rule and Notice that names it. */
export function DocketView({ docketId }: { docketId: string }) {
  const fn = useServerFn(getRegsDocket);
  const q = useQuery({ queryKey: docketQueryKey(docketId), queryFn: () => fn({ data: { docketId } }), staleTime: 10 * 60 * 1000 });
  if (q.isLoading)
    return <div className="h-64 animate-pulse rounded-md border border-border bg-muted/40" aria-busy="true" aria-label="Loading the docket" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        }
      >
        The docket could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return (
      <StateNote>
        No docket {docketId} is held. It may belong to an agency outside the twelve this atlas reads, or the collection is
        not loaded yet.{" "}
        <a href={`https://www.regulations.gov/docket/${encodeURIComponent(docketId)}`} target="_blank" rel="noreferrer" className="text-primary underline">
          Open it on Regulations.gov
        </a>
      </StateNote>
    );
  const { docket, documents, documentsTotal } = q.data;
  const external = docket?.links.filter((l) => /^https:\/\//.test(l.url)) ?? [];
  return (
    <div className="space-y-4">
      {docket ? (
        <Panel
          title="Docket"
          subtitle={docket.subtitle}
          actions={external.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">
              {l.label}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        >
          <dl className="m-0 grid gap-x-6 gap-y-1 px-3 py-2 text-[12.5px] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            {docket.facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="m-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : (
        <StateNote>
          The docket record is not held (it was not in the agencies' docket listing when read); the documents below name it.
        </StateNote>
      )}
      <Panel
        title="Rules, proposed rules and notices in this docket"
        subtitle={
          documentsTotal == null
            ? "Newest first"
            : `${documentsTotal.toLocaleString("en-US")} held${documentsTotal > documents.length ? `; the newest ${documents.length} are listed` : ""}`
        }
        footnote="Supporting materials and the comments themselves stay on Regulations.gov; comment counts are the public submissions posted there."
      >
        {documents.length ? (
          <ol className="m-0 list-none divide-y divide-border/70 p-0">
            {documents.map((h) => (
              <HitRow
                key={h.id}
                h={h}
                dataset="regulations_gov_documents"
                columns={[
                  ["posted", "Posted"],
                  ["fr_doc", "FR doc."],
                  ["comment_period", "Comment period"],
                  ["comments", "Comments posted"],
                ]}
              />
            ))}
          </ol>
        ) : (
          <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
            No Rule, Proposed Rule or Notice in this docket is held. Its other documents are on Regulations.gov.
          </p>
        )}
      </Panel>
    </div>
  );
}
