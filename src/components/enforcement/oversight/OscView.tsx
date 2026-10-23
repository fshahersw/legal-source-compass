import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OscFile, OscPublication } from "@/lib/external/oversight.functions";
import { Panel, Segmented, SourceLink, StateNote } from "../parts";
import { FilterSelect, Pager, RetryButton, SearchBox, Skeleton } from "./bits";
import { useDebounced } from "./useDebounced";
import { oscFilesQuery, oscPublicationsQuery, oversightMetaQuery } from "./queries";
import { fmtDate, NOT_RECORDED } from "./oversightView";

type Sub = "files" | "documents" | "news";
/** OSC writes its tags in lower case ("hatch act"); shown with a capital first letter, nothing else changed. */
const tagLabel = (t: string) => (t ? `${t[0]!.toUpperCase()}${t.slice(1)}` : t);
const PUBLICATION_KINDS = [
  { value: "report", label: "Reports" },
  { value: "advisory_opinion", label: "Hatch Act advisory opinions" },
  { value: "testimony", label: "Testimonies and transcripts" },
];

/**
 * The U.S. Office of Special Counsel's own publications: whistleblower disclosure public files, reports, Hatch Act advisory
 * opinions, testimonies and press releases. Titles, agencies and results are as osc.gov lists them; the linked reports are
 * OSC-redacted PDFs opened from osc.gov. Individuals appear only inside titles OSC wrote.
 */
export function OscView() {
  const [sub, setSub] = useState<Sub>("files");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Sub>
          label="Office of Special Counsel publications"
          value={sub}
          onChange={setSub}
          options={[
            { id: "files", label: "Whistleblower public files" },
            { id: "documents", label: "Reports and opinions" },
            { id: "news", label: "Press releases" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          Source:{" "}
          <SourceLink href="https://www.osc.gov/">U.S. Office of Special Counsel</SourceLink>
        </p>
      </div>
      {sub === "files" ? <PublicFiles /> : sub === "documents" ? <Documents /> : <News />}
    </div>
  );
}

function PublicFiles() {
  const meta = useQuery(oversightMetaQuery);
  const dataset = meta.data?.["osc_public_files"];
  const [text, setText] = useState("");
  const [agency, setAgency] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(text.trim(), 350);
  useEffect(() => setPage(0), [q, agency, year]);
  const results = useQuery(oscFilesQuery({ q, a: agency, year, page }));
  return (
    <Panel
      title="Whistleblower disclosure public files"
      subtitle="Cases OSC referred for agency investigation under 5 U.S.C. 1213(c), with the reports it posts"
      footnote={
        <>
          Source: <SourceLink href="https://www.osc.gov/cases/">OSC Public Files</SourceLink>. The
          agency, place, date closed and results are OSC&rsquo;s own listing. The report PDFs are
          redacted by OSC and open from osc.gov.
          {dataset?.coverage ? ` ${dataset.coverage}.` : ""}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={text}
          onChange={setText}
          label="Search public files"
          placeholder="File number, agency, place or result"
        />
        <FilterSelect
          label="Agency"
          value={agency}
          onChange={setAgency}
          options={dataset?.filters["agency"] ?? []}
        />
        <FilterSelect
          label="Year closed"
          value={year}
          onChange={setYear}
          options={dataset?.filters["year"] ?? []}
        />
      </div>
      <ListBody
        state={results}
        empty="No public file matches these filters."
        loading="Loading public files"
        page={page}
        onPage={setPage}
        noun="files"
        items={results.data?.files}
        render={(files: OscFile[]) => (
          <table className="w-full min-w-[50rem] text-xs">
            <caption className="sr-only">
              OSC whistleblower disclosure public files, newest first
            </caption>
            <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  File
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Agency
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Place
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Closed
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Results listed
                </th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Documents
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {files.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {f.number}
                    </a>
                  </td>
                  <td className="px-2 py-1.5">{f.agency ?? NOT_RECORDED}</td>
                  <td className="px-2 py-1.5">{f.location ?? NOT_RECORDED}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                    {fmtDate(f.dateClosed)}
                  </td>
                  <td className="max-w-[18rem] px-2 py-1.5">
                    {f.results.length ? f.results.join("; ") : NOT_RECORDED}
                  </td>
                  <td className="px-3 py-1.5">
                    {f.files.length ? (
                      <ul className="space-y-0.5">
                        {f.files.slice(0, 5).map((d, i) => (
                          <li key={`${d.url}-${i}`}>
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {d.label}
                            </a>
                          </li>
                        ))}
                        {f.files.length > 5 ? (
                          <li className="text-[11px] text-muted-foreground">
                            +{f.files.length - 5} more on{" "}
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              the case page
                            </a>
                          </li>
                        ) : null}
                      </ul>
                    ) : (
                      NOT_RECORDED
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </Panel>
  );
}

function Documents() {
  const meta = useQuery(oversightMetaQuery);
  const dataset = meta.data?.["osc_publications"];
  const [text, setText] = useState("");
  const [kind, setKind] = useState("report");
  const [group, setGroup] = useState("");
  const [year, setYear] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(text.trim(), 350);
  useEffect(() => setPage(0), [q, kind, group, year]);
  const results = useQuery(oscPublicationsQuery({ q, kind, a: group, year, page }));
  return (
    <Panel
      title="Reports, Hatch Act advisory opinions and testimonies"
      subtitle="As OSC groups them on osc.gov; each opens the document on osc.gov"
      footnote={
        <>
          Source: <SourceLink href="https://www.osc.gov/resources/reports/">OSC reports</SourceLink>
          ,{" "}
          <SourceLink href="https://www.osc.gov/services/hatch-act/advisoryopinion/">
            Hatch Act advisory opinions
          </SourceLink>{" "}
          and <SourceLink href="https://www.osc.gov/resources/testimonies/">testimonies</SourceLink>
          . Year is the fiscal year a report title names, or the date a testimony title ends with;
          otherwise Not recorded.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={text}
          onChange={setText}
          label="Search OSC documents"
          placeholder="Title or topic"
        />
        <FilterSelect
          label="Type"
          value={kind}
          onChange={(v) => setKind(v || "report")}
          options={PUBLICATION_KINDS}
          any="Reports"
        />
        <FilterSelect
          label="Group"
          value={group}
          onChange={setGroup}
          options={dataset?.filters["group"] ?? []}
        />
        <FilterSelect
          label="Year"
          value={year}
          onChange={setYear}
          options={dataset?.filters["year"] ?? []}
        />
      </div>
      <PublicationTable
        results={results}
        page={page}
        onPage={setPage}
        empty="No OSC document matches these filters."
      />
    </Panel>
  );
}

function News() {
  const meta = useQuery(oversightMetaQuery);
  const dataset = meta.data?.["osc_publications"];
  const [text, setText] = useState("");
  const [year, setYear] = useState("");
  const [tag, setTag] = useState("");
  const [page, setPage] = useState(0);
  const q = useDebounced(text.trim(), 350);
  useEffect(() => setPage(0), [q, year, tag]);
  const results = useQuery(
    oscPublicationsQuery({ q, kind: "press_release", a: "", year, tag, page }),
  );
  return (
    <Panel
      title="OSC press releases"
      subtitle="Hatch Act enforcement, whistleblower disclosures and other announcements, tagged by OSC"
      footnote={
        <>
          Source: <SourceLink href="https://www.osc.gov/news/">OSC press releases</SourceLink>.
          Titles, dates and tags are OSC&rsquo;s; any person named appears only because OSC named
          them in the release.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <SearchBox
          value={text}
          onChange={setText}
          label="Search OSC press releases"
          placeholder="Title, tag or text"
        />
        <FilterSelect
          label="OSC tag"
          value={tag}
          onChange={setTag}
          options={(dataset?.filters["tag"] ?? []).map((o) => ({
            value: o.value,
            label: tagLabel(o.label),
          }))}
        />
        <FilterSelect
          label="Year"
          value={year}
          onChange={setYear}
          options={dataset?.filters["year"] ?? []}
        />
      </div>
      <PublicationTable
        results={results}
        page={page}
        onPage={setPage}
        empty="No press release matches these filters."
      />
    </Panel>
  );
}

function PublicationTable({
  results,
  page,
  onPage,
  empty,
}: {
  results: ReturnType<
    typeof useQuery<{
      items: OscPublication[];
      total: number | null;
      page: number;
      pageSize: number;
    }>
  >;
  page: number;
  onPage: (p: number) => void;
  empty: string;
}) {
  return (
    <ListBody
      state={results}
      empty={empty}
      loading="Loading OSC documents"
      page={page}
      onPage={onPage}
      noun="items"
      items={results.data?.items}
      render={(items: OscPublication[]) => (
        <table className="w-full min-w-[44rem] text-xs">
          <caption className="sr-only">Office of Special Counsel publications</caption>
          <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-1.5 font-medium">
                Date
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Title
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Type
              </th>
              <th scope="col" className="px-3 py-1.5 font-medium">
                Group or tags
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map((p) => (
              <tr key={p.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-1.5 font-mono">
                  {p.date ? fmtDate(p.date) : p.year ? String(p.year) : NOT_RECORDED}
                </td>
                <td className="max-w-[30rem] px-2 py-1.5">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    {p.title}
                  </a>
                  {p.excerpt ? (
                    <p
                      className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground"
                      title={p.excerpt}
                    >
                      {p.excerpt}
                    </p>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  {p.kindLabel}
                  {p.fileType ? (
                    <span className="text-muted-foreground"> · {p.fileType}</span>
                  ) : null}
                </td>
                <td className="px-3 py-1.5">
                  {p.tags.length ? p.tags.map(tagLabel).join(", ") : (p.group ?? NOT_RECORDED)}
                  {p.parent ? <span className="text-muted-foreground"> · {p.parent}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    />
  );
}

/** Loading, error, empty and populated states of a paged list in one place. */
function ListBody<T>({
  state,
  items,
  render,
  empty,
  loading,
  page,
  onPage,
  noun,
}: {
  state: {
    isError: boolean;
    refetch: () => unknown;
    isFetching: boolean;
    data?: { total: number | null; pageSize: number } | undefined;
  };
  items: T[] | undefined;
  render: (items: T[]) => React.ReactNode;
  empty: string;
  loading: string;
  page: number;
  onPage: (p: number) => void;
  noun: string;
}) {
  if (state.isError)
    return (
      <div className="p-3">
        <StateNote tone="error" action={<RetryButton onRetry={() => void state.refetch()} />}>
          This list could not be loaded.
        </StateNote>
      </div>
    );
  if (!items || !state.data)
    return (
      <div className="p-3">
        <Skeleton label={loading} />
      </div>
    );
  if (!items.length)
    return (
      <div className="p-3">
        <StateNote>{empty}</StateNote>
      </div>
    );
  return (
    <div aria-busy={state.isFetching}>
      <div className="overflow-x-auto">{render(items)}</div>
      <Pager
        page={page}
        pageSize={state.data.pageSize}
        shown={items.length}
        total={state.data.total}
        onPage={onPage}
        busy={state.isFetching}
        noun={noun}
      />
    </div>
  );
}
