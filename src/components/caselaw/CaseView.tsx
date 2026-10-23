import { Copy, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SCDB_DIRECTION, type CaseRecord } from "@/lib/external/caselaw";
import type { CasePage, OpinionLoad } from "@/lib/external/caselaw.functions";
import { citeLine, fmtDay, fmtInt, NOT_RECORDED } from "./caseFormat";
import { AuthoritiesPanel, CitatorPanel } from "./CitatorPanel";
import { OpinionBody } from "./OpinionBody";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

export function CaseFacts({ r }: { r: CaseRecord }) {
  const scdb = r.scdb;
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-[12px] md:grid-cols-[9rem_1fr_9rem_1fr]">
        <Fact label="Citations">{r.citations.length ? r.citations.join(" · ") : NOT_RECORDED}</Fact>
        <Fact label="Court">{r.court}</Fact>
        <Fact label="Date filed">
          {fmtDay(r.dateFiled)}
          {r.dateApprox ? <span className="text-muted-foreground"> (approximate)</span> : null}
        </Fact>
        <Fact label="Docket number">{r.docketNumber ?? NOT_RECORDED}</Fact>
        <Fact label="Status">{r.precedentialStatus ?? NOT_RECORDED}</Fact>
        <Fact label="Judges">
          {r.judges ?? (r.panel.length ? r.panel.join(", ") : NOT_RECORDED)}
        </Fact>
        {r.judges && r.panel.length ? <Fact label="Panel">{r.panel.join(", ")}</Fact> : null}
        {r.caseNameFull ? <Fact label="Parties">{r.caseNameFull}</Fact> : null}
        {r.disposition ? <Fact label="Disposition">{r.disposition}</Fact> : null}
        <Fact label="Cited by">
          {fmtInt(r.citedBy)} opinions in {fmtInt(r.citedByCases)} cases
          <span className="text-muted-foreground">
            {" "}
            · CourtListener count {fmtInt(r.citationCount)}
          </span>
        </Fact>
        {scdb ? (
          <Fact label="SCDB">
            {scdb.id}
            {scdb.decisionDirection
              ? ` · direction ${SCDB_DIRECTION[scdb.decisionDirection] ?? scdb.decisionDirection}`
              : ""}
            {scdb.votesMajority != null && scdb.votesMinority != null
              ? ` · votes ${scdb.votesMajority}–${scdb.votesMinority}`
              : ""}
            <span className="text-muted-foreground">
              {" "}
              (Supreme Court Database fields as CourtListener provides them)
            </span>
          </Fact>
        ) : null}
      </dl>
    </section>
  );
}

function OpinionTab({
  load,
  label,
  author,
}: {
  load: OpinionLoad | undefined;
  label: string;
  author: string | null;
}) {
  if (!load || load.status === "not_stored")
    return (
      <p className="rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground">
        The text of this opinion is not in the reading store yet. Use the CourtListener link above
        to read it there.
      </p>
    );
  if (load.status !== "ok")
    return (
      <p
        role="alert"
        className="rounded-md border border-border px-3 py-2 text-[13px] text-muted-foreground"
      >
        The stored text of this opinion could not be read.
      </p>
    );
  const o = load.opinion;
  return (
    <article
      aria-label={label}
      className="rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <p className="mb-3 text-[12px] text-muted-foreground">
        {[
          (author ?? o.author)
            ? `By ${author ?? o.author}`
            : o.perCuriam
              ? "Per curiam"
              : "Author not recorded",
          o.joinedBy ? `joined by ${o.joinedBy}` : null,
          o.pages.length
            ? `${fmtInt(o.pages.length)} reporter page markers`
            : "no reporter page markers recorded",
        ]
          .filter(Boolean)
          .join(" · ")}
        {o.downloadUrl ? (
          <>
            {" · "}
            <a
              href={o.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              court's file
            </a>
          </>
        ) : null}
      </p>
      <OpinionBody opinion={o} />
    </article>
  );
}

export function CaseView({
  page,
  initialTab,
  onTab,
}: {
  page: CasePage;
  initialTab?: string | undefined;
  onTab?: ((tab: string) => void) | undefined;
}) {
  const r = page.record!;
  const [copied, setCopied] = useState(false);
  const loads = new Map(page.opinions.map((o) => [o.opinionId, o]));
  const ops = r.opinions;
  const valid = new Set(["citator", "authorities", ...ops.map((o) => `op-${o.id}`)]);
  const readable = ops.find((o) => loads.get(o.id)?.status === "ok") ?? ops[0];
  const first =
    initialTab && valid.has(initialTab) ? initialTab : readable ? `op-${readable.id}` : "citator";
  const [tab, setTabState] = useState(first);
  const setTab = (t: string) => {
    setTabState(t);
    onTab?.(t);
  };
  const stored = page.opinions.filter((o) => o.status === "ok").length;
  const line = citeLine(r.caseName, r.citations, r.dateFiled);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={r.courtListenerUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1 size-3.5" />
            CourtListener
          </a>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(line);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy className="mr-1 size-3.5" />
          {copied ? "Copied" : "Copy citation"}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          {ops.length
            ? `${fmtInt(stored)} of ${fmtInt(ops.length)} opinions stored here · CourtListener bulk data, snapshot 2026-09-30`
            : "No opinions recorded for this case"}
        </span>
      </div>
      {page.textError ? (
        <p
          role="alert"
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-[13px]"
        >
          {page.textError}
        </p>
      ) : null}
      <CaseFacts r={r} />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList className="h-8">
            {ops.map((o) => (
              <TabsTrigger key={o.id} value={`op-${o.id}`} className="h-6 px-2 text-[12px]">
                {o.label}
                {o.author ? (
                  <span className="ml-1 text-muted-foreground">
                    · {o.author.replace(/,.*$/, "")}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
            <TabsTrigger value="citator" className="h-6 px-2 text-[12px]">
              Citator
            </TabsTrigger>
            <TabsTrigger value="authorities" className="h-6 px-2 text-[12px]">
              Cited authorities
            </TabsTrigger>
          </TabsList>
        </div>
        {ops.map((o) => (
          <TabsContent key={o.id} value={`op-${o.id}`}>
            <OpinionTab load={loads.get(o.id)} label={o.label} author={o.author} />
          </TabsContent>
        ))}
        <TabsContent value="citator">
          {tab === "citator" ? (
            <CitatorPanel id={r.clusterId} caseName={r.caseName} clCount={r.citationCount} />
          ) : null}
        </TabsContent>
        <TabsContent value="authorities">
          {tab === "authorities" ? <AuthoritiesPanel id={r.clusterId} /> : null}
        </TabsContent>
      </Tabs>
      <details className="text-[12px] text-muted-foreground">
        <summary className="cursor-pointer">Technical details</summary>
        <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
          <dt>Cluster id</dt>
          <dd className="font-mono">{r.clusterId}</dd>
          <dt>Opinion ids</dt>
          <dd className="font-mono">{ops.map((o) => o.id).join(", ") || NOT_RECORDED}</dd>
          <dt>Source</dt>
          <dd>
            CourtListener bulk data (opinions, clusters, citations, citation map, parentheticals),
            snapshot 2026-09-30
          </dd>
        </dl>
      </details>
    </div>
  );
}
