import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, ShieldQuestion } from "lucide-react";
import { HowToRead } from "@/components/analysis/HowToRead";
import type {
  DisclosureCoverage,
  DisclosureMatch,
  DisclosureSummary,
} from "@/lib/external/judgeCross.functions";
import { cn } from "@/lib/utils";
import { COVERAGE_LABEL, fmtInt } from "./judgeCrossView";

const REVIEW = "Requires review — disclosure name match, not a finding";
const STATUS_STYLE: Record<string, string> = {
  checked: "border-border bg-muted text-foreground",
  no_courtlistener_person: "border-warning/40 bg-warning/10 text-warning-foreground",
  no_disclosures: "border-warning/40 bg-warning/10 text-warning-foreground",
  no_extracted_investments: "border-warning/40 bg-warning/10 text-warning-foreground",
};

function MdlLinks({
  mdls,
}: {
  mdls: { mdl: number; title: string; afterLatestReport?: boolean | null }[];
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {mdls.map((m) => (
        <Link
          key={m.mdl}
          to="/matters/lens/$mdl"
          params={{ mdl: String(m.mdl) }}
          title={
            m.afterLatestReport
              ? `${m.title} — began after the judge's latest available disclosure report`
              : m.title
          }
          className={cn(
            "rounded border px-1 font-mono text-[11px] text-primary hover:bg-muted",
            m.afterLatestReport ? "border-dashed border-warning/60" : "border-border",
          )}
        >
          {m.mdl}
          {m.afterLatestReport ? "†" : ""}
        </Link>
      ))}
    </span>
  );
}

function MatchTable({ matches }: { matches: DisclosureMatch[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="border-b border-border text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Judge</th>
            <th className="px-2 py-1.5 font-medium">MDL</th>
            <th className="px-2 py-1.5 font-medium">Company (party evidence)</th>
            <th className="px-2 py-1.5 font-medium">Disclosed investment, as extracted</th>
            <th className="px-2 py-1.5 font-medium">Report</th>
            <th className="px-3 py-1.5 font-medium">Label</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.id} className="border-b border-border/60 align-top">
              <td className="px-3 py-1.5">
                {m.profileId ? (
                  <Link
                    to="/judges/$id"
                    params={{ id: m.profileId }}
                    className="font-medium hover:underline"
                  >
                    {m.judge}
                  </Link>
                ) : (
                  <span className="font-medium">{m.judge}</span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <MdlLinks mdls={[{ mdl: m.mdl, title: m.mdlTitle }]} />
              </td>
              <td className="px-2 py-1.5">
                <div>{m.company}</div>
                {m.evidenceUrl ? (
                  <a
                    href={m.evidenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-muted-foreground underline underline-offset-2"
                  >
                    {m.evidenceLabel}
                  </a>
                ) : (
                  <div className="text-[11px] text-muted-foreground">{m.evidenceLabel}</div>
                )}
              </td>
              <td className="px-2 py-1.5">
                <div className="font-mono text-[11px]">{m.investment}</div>
                <div className="text-[11px] text-muted-foreground">
                  Gross value {m.grossValue ?? "not recorded"}
                </div>
                {m.tier === "near_match" ? (
                  <div className="text-[11px] text-muted-foreground">Rule: {m.rule}</div>
                ) : null}
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                <a
                  href={m.disclosureUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {m.year}, line {m.line}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
                <div className="text-[11px] text-muted-foreground">
                  page {m.page ?? "not recorded"}
                </div>
              </td>
              <td className="px-3 py-1.5">
                <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-px text-[11px] text-warning-foreground">
                  {m.label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTable({ coverage }: { coverage: DisclosureCoverage[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...coverage].sort(
    (a, b) =>
      b.matches - a.matches ||
      (a.status === "checked" ? 0 : 1) - (b.status === "checked" ? 0 : 1) ||
      a.judge.localeCompare(b.judge),
  );
  const shown = all ? sorted : sorted.slice(0, 15);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-border text-[11px] text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Judge</th>
              <th className="px-2 py-1.5 font-medium">Products-liability MDLs</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Report years checked</th>
              <th className="px-2 py-1.5 text-right font-medium">Lines checked</th>
              <th className="px-2 py-1.5 text-right font-medium">Companies</th>
              <th className="px-2 py-1.5 text-right font-medium">Exact</th>
              <th className="px-3 py-1.5 text-right font-medium">Near</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.nid} className="border-b border-border/60 align-top">
                <td className="px-3 py-1.5">
                  {c.profileId ? (
                    <Link
                      to="/judges/$id"
                      params={{ id: c.profileId }}
                      className="font-medium hover:underline"
                    >
                      {c.judge}
                    </Link>
                  ) : (
                    <span className="font-medium">{c.judge}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <MdlLinks mdls={c.mdls} />
                </td>
                <td className="px-2 py-1.5">
                  {c.status === "checked" && !c.companiesChecked.length ? (
                    <span
                      className="rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground"
                      title="Reports were read, but no company has explicit party evidence for these MDLs, so nothing was compared"
                    >
                      No party evidence
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "rounded border px-1.5 py-px text-[11px]",
                        STATUS_STYLE[c.status] ?? STATUS_STYLE["checked"],
                      )}
                    >
                      {COVERAGE_LABEL[c.status] ?? c.status.replace(/_/g, " ")}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {c.reports.length ? (
                    <span className="flex flex-wrap gap-x-1.5">
                      {c.reports.map((r) => (
                        <a
                          key={r.id}
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                          title={`${r.lines} extracted investment lines${r.amended ? " · amended report" : ""}`}
                        >
                          {r.year}
                          {r.amended ? "ᴬ" : ""}
                        </a>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {fmtInt(c.linesChecked)}
                </td>
                <td
                  className="px-2 py-1.5 text-right font-mono tabular-nums"
                  title={[
                    c.companiesChecked.join("; ") || "No company with explicit party evidence",
                    Object.keys(c.partiesNotCompared).length
                      ? `Not compared (not companies): ${Object.entries(c.partiesNotCompared)
                          .map(([k, v]) => `${v} ${k}`)
                          .join(", ")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join("\n")}
                >
                  {c.companiesChecked.length}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{c.matches}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{c.nearMatches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 15 ? (
        <button
          type="button"
          className="mx-3 my-2 text-[11px] text-primary hover:underline"
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `Show all ${sorted.length} judges`}
        </button>
      ) : null}
    </div>
  );
}

export function DisclosureReview({
  summary,
  coverage,
  matches,
}: {
  summary: DisclosureSummary | null;
  coverage: DisclosureCoverage[];
  matches: DisclosureMatch[];
}) {
  const checked = coverage.filter((c) => c.status === "checked");
  const lines = checked.reduce((s, c) => s + c.linesChecked, 0);
  const years = [...new Set(checked.flatMap((c) => c.yearsChecked))].sort();
  const notChecked = coverage.length - checked.length;
  const noEvidence = checked.filter((c) => !c.companiesChecked.length).length;
  const exact = matches.filter((m) => m.tier === "match");
  const near = matches.filter((m) => m.tier === "near_match");
  const later = coverage.reduce((s, c) => s + c.mdls.filter((m) => m.afterLatestReport).length, 0);
  const excluded = Object.values(summary?.partiesNotCompared ?? {}).reduce((s, v) => s + v, 0);
  return (
    <section
      id="disclosures"
      className="scroll-mt-4 rounded-md border border-border bg-surface"
      aria-label="Financial disclosure name-match review"
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-label font-semibold text-foreground">
            <ShieldQuestion className="size-4 text-warning-foreground" aria-hidden />
            Financial disclosures × MDL defendants — review queue
          </h3>
          <p className="text-xs text-muted-foreground">
            Every row is labelled “{REVIEW}”. A match only means the extracted investment name
            equals a company name with explicit party evidence in that judge’s MDL; it says nothing
            about recusal obligations, timing or ownership.
          </p>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-px border-b border-border/70 bg-border/60 text-xs sm:grid-cols-4">
        {[
          [
            "Judges targeted",
            fmtInt(coverage.length),
            "transferee judges of pending products-liability MDLs",
          ],
          [
            "Reports checked",
            fmtInt(checked.reduce((s, c) => s + c.reports.length, 0)),
            `report years ${years[0] ?? "—"}–${years.at(-1) ?? "—"}`,
          ],
          [
            "Investment lines compared",
            fmtInt(lines),
            `${checked.length} judges with itemised reports`,
          ],
          [
            "Exact / near matches",
            `${fmtInt(exact.length)} / ${fmtInt(near.length)}`,
            [
              notChecked ? `${notChecked} judges could not be checked` : null,
              noEvidence ? `${noEvidence} had no party evidence to compare` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "all targeted judges checked",
          ],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-surface px-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
            <dd className="text-[11px] text-muted-foreground">{note}</dd>
          </div>
        ))}
      </dl>
      {exact.length ? (
        <>
          <h4 className="px-3 pt-2 text-xs font-semibold">Exact name matches</h4>
          <MatchTable matches={exact} />
        </>
      ) : (
        <div className="space-y-0.5 border-b border-border/70 px-3 py-2.5 text-xs">
          <p>
            <span className="font-medium">No exact name matches.</span>{" "}
            <span className="text-muted-foreground">
              None of the {fmtInt(lines)} extracted investment lines in the{" "}
              {years.length ? `${years[0]}–${years.at(-1)}` : ""} reports equals, after
              normalisation, a company with explicit party evidence in the same judge’s
              products-liability MDL.
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            Scope: the checked reports only. The the source bulk files hold no report later than{" "}
            {years.at(-1) ?? "the years shown"} for these judges, so current holdings are not
            covered.
          </p>
        </div>
      )}
      {near.length ? (
        <>
          <h4 className="px-3 pt-2 text-xs font-semibold">Near matches — review</h4>
          <MatchTable matches={near} />
        </>
      ) : (
        <p className="border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">No near matches</span> (reviewed aliases and
          parents, SEC tickers, or investment names beginning with a multi-word party name).
        </p>
      )}
      {later ? (
        <p className="border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
          † {later} MDL{later === 1 ? "" : "s"} began after the judge’s latest available report, so
          no checked report covers the period the judge presided over {later === 1 ? "it" : "them"}.
        </p>
      ) : null}
      <CoverageTable coverage={coverage} />
      <div className="border-t border-border/70 p-3">
        <HowToRead
          title="How the comparison works"
          measures={[
            {
              term: "Disclosures",
              means: `the source bulk financial-disclosure files${summary?.clBulkDate ? ` (${summary.clBulkDate})` : ""}: the ${summary?.yearsPerJudge ?? 3} most recent report years per judge, every extracted Part VII investment row.`,
              caveat:
                "Line = position of the row among the report’s extracted rows; open the PDF to confirm. Judges are linked to the source by the FJC identifier, or by the MDL master docket’s assigned judge when that is the only link and surnames agree.",
            },
            {
              term: "Party evidence",
              means: `A company is compared only when it is named in the JPML caption, listed as a defendant on the master docket’s the source party list, or ${
                summary?.secLinksUsed
                  ? "linked by its own SEC filing that cites the MDL number or caption and describes claims against it"
                  : "(once published) linked by its own SEC filing citing the MDL"
              }. Normalisation ignores case, punctuation, parenthetical notes, “&”/“and”, corporate suffixes and security words; nothing else.`,
              caveat: excluded
                ? `${fmtInt(excluded)} docket party entries that are not companies (defendant placeholders, governments, insurers, unnamed parties) are not compared.`
                : undefined,
            },
            {
              term: "Exact match",
              means: "The normalised investment name equals the normalised party name.",
              caveat: "Not a finding.",
            },
            {
              term: "Near match — review",
              means:
                "The investment equals a reviewed alias of the party (same SEC registrant, or a reviewed parent such as Medtronic for Covidien from 2015), the SEC ticker of the party’s registrant, or begins with a party name of two or more words.",
              caveat: "Not a finding.",
            },
          ]}
        />
      </div>
    </section>
  );
}
