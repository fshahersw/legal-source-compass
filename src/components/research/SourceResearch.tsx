import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportJson } from "@/lib/corpus/research";
import { control, Field, fmt, Panel, Source, tableClass, type WorkbenchProps } from "./shared";

export function SourceResearch({ data, state, update }: WorkbenchProps) {
  const [q, setQ] = useState("");
  const selected = data.resources.states.find((s) => s.code === state);
  const states = selected ? [selected] : data.resources.states;
  const count = data.resources.states.reduce((s, r) => s + r.links.length, 0);
  return (
    <div className="space-y-4">
      <Panel
        title="State court and legal-resource hierarchy"
        note={`Fresh retrieval of DOJ Library Staff’s jurisdiction pages: ${fmt(count)} resource links across 50 states and DC, collected ${data.resources.retrievedAt.slice(0, 10)}. Select a state to browse its hierarchy.`}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field label="Filter resource titles or categories">
              <input
                className={control}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Supreme court, appeals, ethics, civil rules, statutes…"
              />
            </Field>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              exportJson("state-court-resources.json", {
                retrievedAt: data.resources.retrievedAt,
                publisher: "U.S. Department of Justice Library Staff",
                scope: "Publisher hierarchy; linked destinations not independently revalidated",
                states,
              })
            }
          >
            Download selected resources
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Sections and subheadings preserve the publisher’s classification. They describe court and
          resource types, not a case’s appeal path. Retrieval confirms the DOJ page; individual
          linked destinations may be older and have not all been independently checked.
        </p>
        <div className="mt-4 space-y-3">
          {states.map((s) => {
            const links = s.links.filter((l) =>
              `${l.label} ${l.section} ${l.subsection ?? ""}`
                .toLowerCase()
                .includes(q.toLowerCase()),
            );
            if (!links.length) return null;
            const sections = [...new Set(links.map((l) => l.section))];
            return (
              <details
                key={s.code}
                open={!!selected}
                className="rounded-lg border border-border p-3"
              >
                <summary className="cursor-pointer text-[13px] font-semibold">
                  {s.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {links.length} matching resources
                  </span>
                </summary>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                  <Source href={s.sourceUrl}>DOJ jurisdiction source</Source>
                  <button
                    className="text-primary underline"
                    onClick={() => update({ state: s.code, view: "states" })}
                  >
                    Analyze this state
                  </button>
                  <span className="text-muted-foreground">
                    Publisher modified: {s.publisherModifiedAt?.slice(0, 10) ?? "Not recorded"}
                  </span>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {sections.map((section) => (
                    <section key={section} className="border-l-2 border-primary/30 pl-3">
                      <h3 className="mb-2 text-[12px] font-semibold">{section}</h3>
                      <ul className="space-y-2 text-[12px]">
                        {links
                          .filter((l) => l.section === section)
                          .map((l, i) => (
                            <li key={`${l.url}-${i}`}>
                              <Source href={l.url}>{l.label}</Source>
                              {l.subsection && l.subsection !== l.label && (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  {l.subsection}
                                </span>
                              )}
                            </li>
                          ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </Panel>
      <Panel
        title="Research provenance and source downloads"
        note="Official downloads are retained byte-for-byte alongside derived views. Dates, source scope and SHA-256 checksums make each snapshot inspectable."
      >
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Source</th>
                <th>Retrieved</th>
                <th>Original / research capture</th>
                <th>Bytes</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Source href={s.page}>{s.id.replace(/-/g, " ")}</Source>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground">
                        SHA-256
                      </summary>
                      <code className="block max-w-60 break-all text-[10px]">{s.sha256}</code>
                    </details>
                  </td>
                  <td className="whitespace-nowrap">{s.fetchedAt.slice(0, 10)}</td>
                  <td>
                    <a
                      className="text-primary underline"
                      href={`/data/research/raw/${s.file}`}
                      download
                    >
                      {s.file}
                    </a>
                  </td>
                  <td>{fmt(s.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 space-y-2 text-[12px] text-muted-foreground">
          <li>
            FJC: Article III federal service history, including historical appointments. State,
            bankruptcy and magistrate judges are outside this directory.
          </li>
          <li>
            Census: July 1, 2025 state population estimates, Vintage 2025. Territories are outside
            the 51-row rate comparison.
          </li>
          <li>
            U.S. Courts: FY 2025 civil workload and district disposition medians use different case
            populations. Counts from the selected case catalog are displayed separately.
          </li>
          <li>
            DOJ: state resource classifications as published, with retrieval and publisher
            modification dates retained.
          </li>
          <li>
            Citation index: the connected corpus’s published extraction and native source-document
            links.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
