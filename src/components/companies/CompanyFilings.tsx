import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Panel } from "@/components/enforcement/parts";
import { cn } from "@/lib/utils";
import { edgarCompanyUrl } from "./companyData";
import {
  FILING_GROUPS,
  filingsIn,
  ITEM_LABEL,
  type FilingGroup,
  type StatementsProfile,
} from "./companyStatements";
import { Notice, SourceLine } from "./CompanyUi";

export function FilingsTab({ cik, profile }: { cik: string; profile: StatementsProfile | null }) {
  const [group, setGroup] = useState<FilingGroup | "all">("all");
  const all = profile?.filings ?? [];
  if (!all.length)
    return (
      <Notice>
        No filings list is stored for this registrant.{" "}
        <a
          href={edgarCompanyUrl(cik)}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          Open its EDGAR filing index
        </a>
        .
      </Notice>
    );
  const rows = filingsIn(all, group);
  return (
    <div className="space-y-3">
      <Panel
        title="SEC filings"
        subtitle={`${all.length} most recent 10-K, 10-Q, 8-K, 20-F, 6-K, proxy and registration filings`}
        actions={
          <a
            href={edgarCompanyUrl(cik)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            All filings on EDGAR <ExternalLink className="size-3" aria-hidden />
          </a>
        }
      >
        <div
          className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-1.5"
          role="group"
          aria-label="Filing type"
        >
          {[{ id: "all" as const, label: "All" }, ...FILING_GROUPS].map((g) => {
            const n = filingsIn(all, g.id).length;
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={group === g.id}
                disabled={!n}
                onClick={() => setGroup(g.id)}
                className={cn(
                  "rounded border px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50",
                  group === g.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {g.label}
                <span className="ml-1 tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="max-h-[40rem] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-[1] bg-surface">
              <tr className="text-left text-[11px] text-muted-foreground">
                <th scope="col" className="border-b border-border px-3 py-1.5 font-normal">
                  Filed
                </th>
                <th scope="col" className="border-b border-border px-2 py-1.5 font-normal">
                  Form
                </th>
                <th scope="col" className="border-b border-border px-2 py-1.5 font-normal">
                  Period or items
                </th>
                <th scope="col" className="border-b border-border px-2 py-1.5 font-normal">
                  Description
                </th>
                <th
                  scope="col"
                  className="border-b border-border px-3 py-1.5 text-right font-normal"
                >
                  Links
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const items = (f.items ?? "")
                  .split(",")
                  .map((i) => i.trim())
                  .filter(Boolean);
                return (
                  <tr key={f.accn} className="align-top">
                    <td className="whitespace-nowrap border-b border-border/50 px-3 py-1 tabular-nums">
                      {f.date}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/50 px-2 py-1 font-medium">
                      {f.form}
                    </td>
                    <td className="border-b border-border/50 px-2 py-1 text-muted-foreground">
                      {items.length ? (
                        <span
                          title={items.map((i) => `${i} ${ITEM_LABEL[i] ?? ""}`.trim()).join("; ")}
                        >
                          {items
                            .filter((i) => i !== "9.01")
                            .map((i) => ITEM_LABEL[i] ?? `Item ${i}`)
                            .join("; ") || "Exhibits"}
                        </span>
                      ) : f.reportDate ? (
                        `Period ${f.reportDate}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className="max-w-[22rem] truncate border-b border-border/50 px-2 py-1 text-muted-foreground"
                      title={f.description ?? undefined}
                    >
                      {/* EDGAR's description often only repeats the form ("FORM 8-K"); that adds nothing. */}
                      {f.description &&
                      f.description.toUpperCase().replace(/^FORM\s+/, "") !== f.form.toUpperCase()
                        ? f.description
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/50 px-3 py-1 text-right">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        Document
                      </a>
                      {f.indexUrl ? (
                        <>
                          {" · "}
                          <a
                            href={f.indexUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            Index
                          </a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <SourceLine>
        Source: SEC EDGAR submissions for CIK {cik}
        {profile?.retrieved ? `, retrieved ${profile.retrieved}` : ""}. Links open the filing on
        sec.gov.
      </SourceLine>
    </div>
  );
}
