import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/corpus/BarList";
import { CorpusLink, useDatasets } from "@/components/corpus/DatasetBrowser";
import { getRecordDetail, queryDataset } from "@/lib/external/catalog.functions";
import { normalizeItem } from "@/lib/external/groups";
import { control, Field, fmt, Pagination, Panel, tableClass, type WorkbenchProps } from "./shared";

export function CitationResearch({ search, update }: WorkbenchProps) {
  const datasets = useDatasets(),
    info = datasets.data?.find((d) => d.id === "citation_index");
  const queryFn = useServerFn(queryDataset),
    detailFn = useServerFn(getRecordDetail);
  const [draft, setDraft] = useState(search.q ?? ""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [docPage, setDocPage] = useState(0);
  const listing = useQuery({
    queryKey: ["research-citations", search.q ?? "", page],
    enabled: info?.ready === true,
    placeholderData: keepPreviousData,
    queryFn: () =>
      queryFn({
        data: { dataset: "citation_index", q: search.q ?? "", filters: {}, offset: page * 50 },
      }),
  });
  const items = (listing.data?.items ?? []).map(normalizeItem);
  const id = selected ?? items[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ["research-authority", id],
    enabled: !!id && info?.ready === true,
    queryFn: () => detailFn({ data: { dataset: "citation_index", id: id! } }),
  });
  const record = detail.data;
  const documents = (record?.sections ?? [])
    .filter((s) => /citing|cited|documents/i.test(s.title ?? ""))
    .flatMap((s) => s.items)
    .map(normalizeItem);
  const pick = (id: string) => {
    setSelected(id);
    setDocPage(0);
  };
  return (
    <div className="space-y-4">
      <Panel
        title="Authorities → citing documents"
        note="Trace a recorded authority to the saved documents and excerpts that cite it. Counts describe this corpus’s extraction; they do not validate the citation or measure precedential weight."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: draft.slice(0, 200) });
            setPage(0);
            setSelected(null);
            setDocPage(0);
          }}
          className="flex items-end gap-2"
        >
          <div className="min-w-0 flex-1">
            <Field label="Search cited authorities">
              <input
                className={control}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. 28 U.S.C. § 1407, Rule 702, or a case citation"
              />
            </Field>
          </div>
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {info
            ? `${fmt(info.records)} authority records · ${info.ready === true ? "Published dataset" : info.ready === false ? "Dataset held from publication" : "Publication status unavailable"}`
            : "Loading publication metadata…"}
          {info?.qualification ? ` · ${info.qualification}` : ""}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Search uses the corpus’s native authority-and-document index; results can match
          citing-document text.
        </p>
        {datasets.error || listing.error ? (
          <p className="mt-3 text-[12px] text-destructive">
            Citation records could not load.{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                datasets.refetch();
                listing.refetch();
              }}
            >
              Retry
            </Button>
          </p>
        ) : null}
        <div className="mt-3 max-h-96 overflow-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Recorded authority</th>
                <th>Native record ID</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={i.id === id ? "bg-primary/10" : ""}>
                  <td>
                    <button className="text-left text-primary underline" onClick={() => pick(i.id)}>
                      {i.title}
                    </button>
                    {i.subtitle && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{i.subtitle}</p>
                    )}
                  </td>
                  <td className="max-w-64 break-all font-mono text-[10px]">{i.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {listing.isLoading && (
          <p className="py-3 text-[12px] text-muted-foreground">Loading authorities…</p>
        )}
        {listing.data && (
          <Pagination
            size={50}
            page={page}
            count={listing.data.total}
            returned={items.length}
            hasNext={items.length === 50}
            onPage={(p) => {
              setPage(p);
              setSelected(null);
              setDocPage(0);
            }}
          />
        )}
        {!listing.isLoading && listing.data && items.length === 0 && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            No recorded authorities match this query.
          </p>
        )}
      </Panel>
      {detail.isLoading && (
        <p className="text-[12px] text-muted-foreground">Loading citation evidence…</p>
      )}
      {detail.error && (
        <p className="text-[12px] text-destructive">
          Citation detail could not load.{" "}
          <Button size="sm" variant="outline" onClick={() => detail.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {record && (
        <Panel
          title={record.title ?? "Recorded authority"}
          note={record.qualification ?? "Native citation record and its saved-document evidence"}
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {record.facts.map(([label, value]) => (
              <Stat key={label} label={label} value={value} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {record.links.map((l, i) => (
              <CorpusLink
                key={`${l.url}-${i}`}
                url={l.url}
                label={l.label}
                aliases={datasets.aliases}
              />
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4 text-center text-[12px]">
            <strong className="break-words">{record.title}</strong>
            <div className="my-2 text-primary" aria-hidden>
              ↓ recorded citations in saved documents ↓
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {documents.slice(0, 3).map((d, i) => (
                <div key={i} className="rounded border border-border bg-surface p-3 text-left">
                  <span className="line-clamp-3">{d.title}</span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    Native citing-document link
                  </span>
                </div>
              ))}
            </div>
            {!documents.length && (
              <p>No citing-document items were returned in this record’s preview.</p>
            )}
          </div>
          <h3 className="mb-3 mt-5 text-[13px] font-semibold">
            Citing documents and recorded excerpts
          </h3>
          <p className="mb-3 text-[11px] text-muted-foreground">
            {fmt(documents.length)} document items returned by the corpus detail preview. A
            publisher’s reported citing-document count may be larger; follow the native document
            links to research further.
          </p>
          <ol className="space-y-4">
            {documents.slice(docPage * 20, docPage * 20 + 20).map((d, i) => (
              <li
                key={`${docPage}-${i}`}
                className="rounded-lg border border-border p-3 text-[12px]"
              >
                <strong className="break-words">{d.title}</strong>
                {d.subtitle && (
                  <p className="my-2 whitespace-pre-wrap break-words text-muted-foreground">
                    {d.subtitle}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  {d.links.map((l, j) => (
                    <CorpusLink
                      key={`${l.url}-${j}`}
                      url={l.url}
                      label={l.label}
                      aliases={datasets.aliases}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <Pagination page={docPage} count={documents.length} onPage={setDocPage} />
          {record.text && (
            <details className="mt-3 text-[12px]">
              <summary className="cursor-pointer text-primary">
                Record text{record.textTruncated ? " (preview)" : ""}
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{record.text}</pre>
            </details>
          )}
        </Panel>
      )}
    </div>
  );
}
