import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { Panel } from "@/components/enforcement/parts";
import { cn } from "@/lib/utils";
import { money, NOT_RECORDED } from "./companyData";
import { companyDocumentsQuery, documentTextQuery } from "./companyQueries";
import {
  CHECK_LABEL,
  DOC_TYPE_LABEL,
  documentTitle,
  figureAmount,
  ITEM_LABEL,
  periodLabel,
  type CheckStatus,
  type DocType,
  type Figure,
  type IrDocument,
  type XbrlCheck,
} from "./companyStatements";
import { LoadingBlocks, Notice, SourceLine } from "./CompanyUi";

const FILTERS: { id: "all" | DocType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "earnings_release", label: "Earnings releases" },
  { id: "presentation", label: "Presentations" },
  { id: "transcript", label: "Transcripts" },
  { id: "other", label: "Other exhibits" },
];

export function DocumentsTab({
  cik,
  docId,
  onDoc,
  currency,
}: {
  cik: string;
  docId: string | undefined;
  onDoc: (id: string) => void;
  currency: string | null;
}) {
  const q = useQuery(companyDocumentsQuery(cik));
  const [filter, setFilter] = useState<"all" | DocType>("all");
  if (q.isLoading) return <LoadingBlocks label="Loading investor documents" tiles={0} />;
  if (q.isError)
    return (
      <Notice tone="error">
        Investor documents could not be loaded. {q.error instanceof Error ? q.error.message : ""}
      </Notice>
    );
  const docs = q.data ?? [];
  if (!docs.length)
    return (
      <Notice>
        No earnings releases or presentations are indexed for this registrant: it filed no 8-K under
        Item 2.02 (results of operations) or 7.01 (Regulation FD) with an EX-99 exhibit since
        October 2023.
      </Notice>
    );
  const shown = filter === "all" ? docs : docs.filter((d) => d.docType === filter);
  const selected =
    docs.find((d) => d.id === docId) ??
    docs.find((d) => d.docType === "earnings_release" && d.extraction) ??
    docs[0]!;
  const transcripts = docs.filter((d) => d.docType === "transcript").length;
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.docType, (counts.get(d.docType) ?? 0) + 1);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel
          title="Exhibits to 8-K results and Regulation FD reports"
          className="self-start"
          subtitle={`${docs.length} documents filed since October 2023, newest first`}
          footnote={
            transcripts
              ? `${transcripts} earnings call transcript${transcripts === 1 ? " is" : "s are"} filed as exhibits.`
              : "No earnings call transcripts are filed with the SEC as exhibits in these reports; transcripts published elsewhere are not used."
          }
        >
          <div
            className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-1.5"
            role="group"
            aria-label="Document type"
          >
            {FILTERS.filter((f) => f.id === "all" || counts.get(f.id)).map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px]",
                  filter === f.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
                <span className="ml-1 tabular-nums opacity-70">
                  {f.id === "all" ? docs.length : counts.get(f.id)}
                </span>
              </button>
            ))}
          </div>
          <ul className="max-h-[36rem] overflow-y-auto" aria-label="Documents">
            {shown.map((d) => (
              <li key={d.id} className="border-b border-border/50 last:border-b-0">
                <button
                  type="button"
                  aria-current={d.id === selected.id ? "true" : undefined}
                  onClick={() => onDoc(d.id)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring",
                    d.id === selected.id && "bg-muted",
                  )}
                >
                  <FileText
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{documentTitle(d)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {d.date} · {DOC_TYPE_LABEL[d.docType]} · {d.exhibit}
                      {d.extraction ? " · figures read" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!shown.length ? (
              <li className="px-3 py-4 text-xs text-muted-foreground">
                No documents of this type.
              </li>
            ) : null}
          </ul>
        </Panel>
        <DocumentView d={selected} currency={currency} />
      </div>
      <SourceLine>
        Source: EX-99 exhibits of the registrant&rsquo;s 8-K filings under Items 2.02 and 7.01 on
        sec.gov (up to the twelve latest such filings). Figures are read from the latest four
        earnings releases; a figure is kept only when its quoted passage appears word for word in
        the exhibit and contains the number, and revenue, net income and diluted EPS are compared
        with the registrant&rsquo;s XBRL value for the same quarter.
      </SourceLine>
    </div>
  );
}

const STATUS_STYLE: Record<CheckStatus, string> = {
  matches: "border-primary/30 bg-primary/10 text-primary",
  rounded: "border-primary/30 bg-primary/5 text-primary",
  differs: "border-warning/40 bg-warning/15 text-warning-foreground",
  no_xbrl_value: "border-border bg-muted text-muted-foreground",
  not_extracted: "border-border bg-muted text-muted-foreground",
};

function CheckChip({ check }: { check: XbrlCheck | null }) {
  const status = check?.status ?? "not_extracted";
  return (
    <span
      className={cn(
        "inline-flex rounded border px-1.5 py-px text-[10px] font-medium",
        STATUS_STYLE[status],
      )}
    >
      {CHECK_LABEL[status]}
    </span>
  );
}

function amountText(f: Figure | null, perShare: boolean, currency: string | null) {
  if (!f) return NOT_RECORDED;
  if (perShare) return `${f.value < 0 ? "-" : ""}${Math.abs(f.value).toFixed(2)}`;
  return money(figureAmount(f), currency);
}

function DocumentView({ d, currency }: { d: IrDocument; currency: string | null }) {
  const ex = d.extraction;
  const text = useQuery(documentTextQuery(d.id));
  const items = (d.items ?? "")
    .split(",")
    .map((i) => i.trim())
    .filter(Boolean)
    .map((i) => (ITEM_LABEL[i] ? `${i} ${ITEM_LABEL[i]}` : i));
  const figures: { label: string; f: Figure | null; check: XbrlCheck | null; perShare: boolean }[] =
    ex
      ? [
          { label: "Revenue", f: ex.revenue, check: ex.checks.revenue, perShare: false },
          { label: "Net income", f: ex.netIncome, check: ex.checks.netIncome, perShare: false },
          { label: "Diluted EPS", f: ex.epsDiluted, check: ex.checks.epsDiluted, perShare: true },
        ]
      : [];
  return (
    <Panel
      title={documentTitle(d)}
      subtitle={`${DOC_TYPE_LABEL[d.docType]} · ${d.exhibit} to Form ${d.form} filed ${d.date}${items.length ? ` · Items ${items.join("; ")}` : ""}`}
      actions={
        <>
          <a
            href={d.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Exhibit on sec.gov <ExternalLink className="size-3" aria-hidden />
          </a>
          {d.indexUrl ? (
            <a
              href={d.indexUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Filing index <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </>
      }
    >
      {ex ? (
        <div className="space-y-2 border-b border-border/60 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            Reported period: {ex.periodLabel ?? NOT_RECORDED}
            {ex.quarter
              ? ` · compared with XBRL ${periodLabel(ex.quarter)} (${ex.quarter.end})`
              : ""}
          </p>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                <th className="py-0.5 font-normal">GAAP figure</th>
                <th className="py-0.5 text-right font-normal">In the release</th>
                <th className="py-0.5 text-right font-normal">XBRL, same quarter</th>
                <th className="py-0.5 pl-2 font-normal">Check</th>
              </tr>
            </thead>
            <tbody>
              {figures.map((r) => (
                <tr key={r.label} className="border-t border-border/40">
                  <th scope="row" className="py-1 text-left font-normal">
                    {r.label}
                  </th>
                  <td className="py-1 text-right" title={r.f?.quote}>
                    {amountText(r.f, r.perShare, currency)}
                  </td>
                  <td
                    className="py-1 text-right"
                    title={r.check?.xbrlAccn ? `Accession ${r.check.xbrlAccn}` : undefined}
                  >
                    {r.check?.xbrl !== null && r.check?.xbrl !== undefined
                      ? r.perShare
                        ? r.check.xbrl.toFixed(2)
                        : money(r.check.xbrl, currency)
                      : "—"}
                    {r.check?.derived ? (
                      <span className="text-muted-foreground"> derived</span>
                    ) : null}
                  </td>
                  <td className="py-1 pl-2">
                    <CheckChip check={r.f ? r.check : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ex.segments.length || ex.kpis.length || ex.guidance.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {ex.segments.length ? (
                <div>
                  <h4 className="text-[11px] font-medium text-muted-foreground">
                    Segments in the release
                  </h4>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {ex.segments.map((s) => (
                      <li
                        key={`${s.name}:${s.value}`}
                        className="flex justify-between gap-2"
                        title={s.quote}
                      >
                        <span className="min-w-0 truncate">{s.name}</span>
                        <span className="shrink-0 tabular-nums">
                          {money(figureAmount(s), currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {ex.kpis.length ? (
                <div>
                  <h4 className="text-[11px] font-medium text-muted-foreground">
                    Other reported measures
                  </h4>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {ex.kpis.map((k) => (
                      <li
                        key={`${k.name}:${k.value}`}
                        className="flex justify-between gap-2"
                        title={k.quote}
                      >
                        <span className="min-w-0 truncate">{k.name}</span>
                        <span className="shrink-0 tabular-nums">{k.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {ex.guidance.length ? (
                <div className="md:col-span-2">
                  <h4 className="text-[11px] font-medium text-muted-foreground">
                    Outlook stated in the release
                  </h4>
                  <ul className="mt-0.5 space-y-0.5 text-xs">
                    {ex.guidance.map((g) => (
                      <li key={`${g.metric}:${g.quote}`} title={g.quote}>
                        <span className="font-medium">{g.metric}:</span> {g.text || g.quote}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <details className="text-[11px]">
            <summary className="cursor-pointer text-primary">
              Quoted passages behind these figures
            </summary>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {[
                ...figures.filter((r) => r.f).map((r) => ({ k: r.label, q: r.f!.quote })),
                ...ex.segments.map((s) => ({ k: s.name, q: s.quote })),
                ...ex.kpis.map((k) => ({ k: k.name, q: k.quote })),
                ...ex.guidance.map((g) => ({ k: g.metric, q: g.quote })),
              ].map((x, i) => (
                <li key={`${x.k}:${i}`}>
                  <span className="text-foreground">{x.k}:</span> &ldquo;{x.q}&rdquo;
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : (
        <p className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          {d.docType === "earnings_release"
            ? "Figures are read from the four latest earnings releases only; this document is shown as text."
            : "Figures are read from earnings releases only; this document is shown as text."}
        </p>
      )}
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Text extracted from the exhibit
            {d.chars !== null ? ` · ${d.chars.toLocaleString("en-US")} characters` : ""}
            {d.truncated ? " · first 60,000 shown" : ""}
            {d.transcribed ? " · transcribed from page images" : ""}
          </span>
        </div>
        {text.isLoading ? (
          <div
            className="h-64 animate-pulse rounded border border-border bg-muted/50"
            aria-busy="true"
          />
        ) : text.isError ? (
          <p className="text-xs text-destructive">The text could not be loaded.</p>
        ) : text.data ? (
          <div
            className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-background px-3 py-2 font-mono text-[11px] leading-5"
            tabIndex={0}
            aria-label="Exhibit text"
          >
            {text.data.text}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No text is stored for this exhibit.</p>
        )}
      </div>
    </Panel>
  );
}
