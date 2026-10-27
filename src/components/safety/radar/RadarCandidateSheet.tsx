/**
 * One radar unit opened from the list: the index chart of its monthly counts against the national total, the score
 * components, the MedDRA terms whose rise is measured and, apart, those that entered the stored top N (prior "Not
 * recorded", never 0), the evidence
 * with links, the MDL-link basis, an "About this score" popover and the AI summary grounded in this unit's figures.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { IndexChart } from "@/components/charts/d3/charts";
import { AiSummary, AskAiButton, InfoPopover, StatusPill } from "@/components/kit";
import { radarCandidateQuery } from "./radarQueries";
import { RadarScoreLegend, RadarScoreStack } from "./RadarScoreStack";
import {
  FAMILY_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
  candidateContext,
  countUnit,
  fmtCount,
  fmtRatio,
  indexSeries,
  type RadarSummary,
  type RadarTerm,
  type RadarUnit,
} from "./radarModel";

const TONE = { none_linked: "warning", terminated_mdl: "neutral", pending_mdl: "info" } as const;

export function RadarAbout({ summary }: { summary: RadarSummary | null }) {
  const m = summary?.method ?? {};
  return (
    <div className="space-y-2 text-meta">
      <p>
        Points come only from counts the sources published. Each part of the score is listed with
        its observed and expected counts, so the total can be checked.
      </p>
      {Object.entries(m).map(([k, v]) => (
        <p key={k}>
          <span className="font-medium capitalize">{k}:</span> {v}
        </p>
      ))}
      <p>{summary?.caveat ?? "Reports do not show that a product caused harm."}</p>
    </div>
  );
}

function Identifiers({ u }: { u: RadarUnit }) {
  const id = u.identifiers;
  const list = (k: string) => (Array.isArray(id[k]) ? (id[k] as unknown[]).map(String) : []);
  const parts: [string, string][] = [];
  if (u.kind === "drug") {
    if (list("spellings").length > 1)
      parts.push(["Published spellings", list("spellings").join("; ")]);
    if (list("brand_names").length)
      parts.push(["Brands (Drugs@FDA)", list("brand_names").join(", ")]);
    if (list("application_numbers").length)
      parts.push(["Applications", list("application_numbers").join(", ")]);
    if (list("sponsors").length) parts.push(["Sponsors", list("sponsors").join(", ")]);
  } else if (u.kind === "vehicle") {
    parts.push([
      "Make / model / component",
      `${String(id["make"])} / ${String(id["model"])} / ${String(id["component"])}`,
    ]);
  } else if (u.kind === "jpml") {
    parts.push(["Caption", String(id["caption"] ?? "")]);
  }
  if (!parts.length) return null;
  return (
    <dl className="grid gap-x-3 gap-y-1 text-meta sm:grid-cols-[max-content_1fr]">
      {parts.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Components({ u }: { u: RadarUnit }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-meta">
        <caption className="sr-only">Score components of {u.label}</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 font-medium">Family</th>
            <th className="py-1 pr-2 font-medium">Measure</th>
            <th className="py-1 pr-2 text-right font-medium">Observed</th>
            <th className="py-1 pr-2 text-right font-medium">Expected</th>
            <th className="py-1 pr-2 text-right font-medium">Ratio (95% low)</th>
            <th className="py-1 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {u.components.map((c, i) => (
            <tr key={`${c.family}-${i}`} className="border-t border-border/60 align-top">
              <td className="py-1 pr-2">{FAMILY_LABEL[c.family]}</td>
              <td className="py-1 pr-2">
                {c.metric}
                {c.note ? <span className="block text-muted-foreground">{c.note}</span> : null}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {c.observed == null ? "—" : fmtCount(c.observed)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {c.expected == null
                  ? "—"
                  : c.expected.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {c.ratio == null ? "—" : `${fmtRatio(c.ratio)} (${fmtRatio(c.ci_low)})`}
              </td>
              <td className="py-1 text-right font-semibold tabular-nums">
                {c.points}
                <span className="font-normal text-muted-foreground">/{c.max_points}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TermList({ terms, topN }: { terms: readonly RadarTerm[]; topN: string }) {
  return (
    <ul className="divide-y divide-border/60 text-meta">
      {terms.map((t) => (
        <li key={t.term} className="flex items-baseline justify-between gap-3 py-1">
          <span className="min-w-0 truncate" title={t.term}>
            {t.term}
            {t.quality ? (
              <span className="ml-1 text-muted-foreground">(product or use problem)</span>
            ) : null}
          </span>
          <span className="shrink-0 tabular-nums">
            {fmtCount(t.recent)} <span className="text-muted-foreground">vs</span>{" "}
            {t.prior == null ? (
              <span className="text-muted-foreground">Not recorded (outside top {topN})</span>
            ) : (
              fmtCount(t.prior)
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Two lists, never mixed: terms whose rise is measured (prior count known, recent above it) and terms that entered the
 * stored top N (prior count not recorded, so their rise is not measured).
 */
function Terms({ u }: { u: RadarUnit }) {
  if (u.kind !== "drug") return null;
  const rising = (u.top_rising_terms ?? []).filter(
    (t) => t.prior != null && t.recent != null && t.recent > t.prior,
  );
  const entered = u.entered_terms ?? [];
  const tw = u.terms_window;
  const topN = tw?.top_n != null ? String(tw.top_n) : "N";
  return (
    <section aria-labelledby="radar-terms" className="space-y-1.5">
      <h3 id="radar-terms" className="text-label font-semibold">
        Rising MedDRA terms
      </h3>
      {rising.length ? (
        <TermList terms={rising} topN={topN} />
      ) : (
        <p className="text-meta text-muted-foreground">
          {u.top_rising_terms || entered.length
            ? "No stored term rose with both windows recorded."
            : "Not recorded: no quarterly term counts are stored for this product."}
        </p>
      )}
      {entered.length ? (
        <>
          <h4 className="pt-1 text-meta font-semibold">
            Entered the top {topN} (prior count not recorded)
          </h4>
          <TermList terms={entered} topN={topN} />
        </>
      ) : null}
      {rising.length || entered.length ? (
        <p className="text-meta text-muted-foreground">
          Reports naming each term, {tw?.recent ?? "recent quarters"} vs{" "}
          {tw?.prior ?? "the prior quarters"}, from the stored top {topN} terms of each quarter.
        </p>
      ) : null}
    </section>
  );
}

function Evidence({ u }: { u: RadarUnit }) {
  const links = u.mdl_status.links;
  return (
    <section aria-labelledby="radar-evidence" className="space-y-1.5">
      <h3 id="radar-evidence" className="text-label font-semibold">
        Evidence
      </h3>
      {u.evidence.length ? (
        <ul className="space-y-1.5 text-meta">
          {u.evidence.map((e) => (
            <li key={`${e.dataset}-${e.id}`} className="min-w-0">
              {e.url ? (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium hover:underline"
                >
                  {e.label}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : (
                <span className="font-medium">{e.label}</span>
              )}
              <span className="text-muted-foreground">
                {" "}
                · {e.date || "date not recorded"}
                {e.basis ? ` · ${e.basis}` : ""}
                {e.points ? ` · ${e.points} pt` : ""}
              </span>
              {e.excerpt ? <q className="mt-0.5 block text-muted-foreground">{e.excerpt}</q> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">
          No regulator, court or filing record is linked by an exact key.
        </p>
      )}
      <h4 className="pt-1 text-meta font-semibold">MDL links</h4>
      {links.length ? (
        <ul className="space-y-1 text-meta">
          {links.map((l, i) => (
            <li key={`${l.mdl}-${l.basis}-${i}`}>
              <span className="font-medium">MDL {l.mdl}</span>{" "}
              <span className="text-muted-foreground">
                ({l.status}) · {l.note ?? l.basis}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-muted-foreground">
          No MDL linked by the exact keys checked (product links, title names, brand to ingredient,
          pharmacologic class, reviewed lists, JPML orders). This is not proof that no MDL or case
          exists.
        </p>
      )}
    </section>
  );
}

export function RadarCandidateSheet({
  id,
  summary,
  onClose,
}: {
  id: string | null;
  summary: RadarSummary | null;
  onClose: () => void;
}) {
  const q = useQuery({ ...radarCandidateQuery(id ?? ""), enabled: !!id });
  const u = q.data ?? null;
  const national =
    u?.kind === "vehicle" ? summary?.national.nhtsa?.series : summary?.national.faers?.series;
  const series = useMemo(() => (u ? indexSeries(u, national) : []), [u, national]);
  const context = useMemo(() => (u ? candidateContext(u) : null), [u]);
  return (
    <Sheet open={!!id} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto p-4 sm:max-w-[min(48rem,94vw)]"
      >
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="text-heading">
            {u?.label ?? (q.isPending ? "Loading…" : "Radar entry")}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
              {u ? (
                <>
                  <StatusPill tone={TONE[u.mdl_status.status]} icon={false}>
                    {STATUS_LABEL[u.mdl_status.status]}
                  </StatusPill>
                  <span>{KIND_LABEL[u.kind]}</span>
                  <span>
                    · {u.points} points · {u.families_present} of 4 families
                    {u.rank ? ` · rank ${u.rank}` : ""}
                  </span>
                  <InfoPopover label="About this score" title="About this score">
                    <RadarAbout summary={summary} />
                  </InfoPopover>
                </>
              ) : null}
            </div>
          </SheetDescription>
        </SheetHeader>
        {q.isError ? (
          <p role="alert" className="text-meta text-destructive">
            This entry could not be read just now.
          </p>
        ) : null}
        {!q.isPending && !q.isError && !u ? (
          <p className="text-meta text-muted-foreground">
            Not recorded: this entry is not in the published radar.
          </p>
        ) : null}
        {u ? (
          <>
            <Identifiers u={u} />
            {u.flags.length ? (
              <ul className="space-y-1 text-meta">
                {u.flags.map((f) => (
                  <li key={f.key}>
                    <StatusPill tone="neutral" icon={false}>
                      {f.label}
                    </StatusPill>{" "}
                    <span className="text-muted-foreground">{f.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <section aria-labelledby="radar-score" className="space-y-2">
              <h3 id="radar-score" className="text-label font-semibold">
                Score
              </h3>
              <RadarScoreStack rows={[u]} ariaLabel={`Score of ${u.label} by family`} max={12} />
              <RadarScoreLegend />
              <Components u={u} />
            </section>
            {series.length ? (
              <section aria-labelledby="radar-index" className="space-y-1">
                <h3 id="radar-index" className="text-label font-semibold">
                  Monthly {countUnit(u.kind)}, indexed to a month you choose
                </h3>
                <p className="text-meta text-muted-foreground">
                  {u.series?.unit} · {series[0]?.points[0]?.date} to{" "}
                  {series[0]?.points.at(-1)?.date} · move across the chart to change the base month
                  · source: {u.series?.source}
                </p>
                <IndexChart series={series} height={240} />
              </section>
            ) : null}
            <Terms u={u} />
            <Evidence u={u} />
            <AiSummary
              context={context}
              title="What this score shows"
              actions={
                <AskAiButton
                  sectionId="radar-candidate"
                  context={context}
                  size="icon"
                  questions={[
                    "Which parts of the score carry the most weight?",
                    "What could explain the rise other than a safety problem?",
                    "What evidence is missing before this could be called a tort?",
                  ]}
                />
              }
            />
            <p className="text-meta text-muted-foreground">{u.caveat}</p>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
