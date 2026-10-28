/**
 * Visual stories (/insights/stories): the MDL docket told in motion. Opens with the counts and an AI summary, then the
 * docket race (the twelve largest MDLs in every captured JPML pending report, played from the first report to the
 * latest, with a scrubbable timeline), the streamgraph of the whole docket with the same playhead, and the live
 * defendant network (companies, MDLs and product groups from SEC filings).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, type TableSpec } from "@/components/charts/ChartCard";
import { KpiStrip } from "@/components/kit/KpiCard";
import { Section } from "@/components/kit/Section";
import { SectionIndex } from "@/components/kit/SectionIndex";
import { AiSummary, buildSectionContext } from "@/components/kit/ai";
import { DocketRace, DocketTimeline } from "./DocketRace";
import { CATEGORY_COLOR, reportLabel } from "./storiesColors";
import { DocketStream } from "./DocketStream";
import { DefendantNetwork } from "./DefendantNetwork";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  leaders,
  rankAt,
  shortTitle,
  streamLayers,
  type Docket,
  type Network,
} from "./storiesModel";
import { defendantNetworkQuery, mdlAtlasQuery, mdlDocketQuery } from "./storiesQuery";
import { ChordSection, FieldSection, MapSection, StrandsSection } from "./AtlasSections";
import { PlaybackBar } from "./PlaybackBar";
import { courtShort, latestMdls, type Atlas } from "./atlasModel";
import type { PlaybackControls, Speed } from "./playback";

const n = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v).toLocaleString("en-US")
    : "Not recorded";
const JPML = {
  label: "JPML, Pending MDL Dockets by Actions Pending",
  url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
};
const SEC = { label: "SEC EDGAR company filings", url: "https://www.sec.gov/edgar/search/" };

/** Reports advanced per second at 1×: the 89 captured reports play in about 40 seconds. */
const FRAMES_PER_SECOND = 2.2;

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Playback of the docket frames: a requestAnimationFrame loop that advances the fractional frame while playing. */
function usePlayback(last: number): PlaybackControls {
  const [t, setT] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  useEffect(() => setT(last), [last]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev: number | null = null;
    const k = FRAMES_PER_SECOND * Number(speed);
    const step = (ts: number) => {
      if (prev !== null) {
        const dt = Math.min(0.1, (ts - prev) / 1000);
        setT((v) => {
          const nv = v + dt * k;
          if (nv >= last) {
            setPlaying(false);
            return last;
          }
          return nv;
        });
      }
      prev = ts;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, last]);
  return {
    t,
    playing,
    speed,
    setSpeed,
    play: () => {
      setT((v) => (v >= last - 0.001 ? 0 : v));
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    restart: () => {
      setT(0);
      setPlaying(true);
    },
    end: () => {
      setPlaying(false);
      setT(last);
    },
    scrub: (v: number) => {
      setPlaying(false);
      setT(v);
    },
  };
}

function storyFacts(d: Docket, net: Network | null) {
  const last = d.dates.length - 1;
  let peakI = 0;
  d.totals.forEach((v, i) => {
    if (v > (d.totals[peakI] ?? 0)) peakI = i;
  });
  const lead = leaders(d);
  const byId = new Map(d.mdls.map((m) => [m.mdl, m] as const));
  const now = rankAt(d.mdls, last, 5);
  const biggest = [...d.mdls].sort((a, b) => b.peak - a.peak)[0];
  const companies = net ? new Map<string, { company: string; mdls: number }>() : null;
  if (net && companies)
    for (const l of net.links) {
      const c = companies.get(l.cik) ?? { company: l.company, mdls: 0 };
      c.mdls++;
      companies.set(l.cik, c);
    }
  const topCompanies = companies
    ? [...companies.values()].sort((a, b) => b.mdls - a.mdls).slice(0, 5)
    : [];
  return {
    last,
    peakI,
    lead,
    byId,
    now,
    biggest,
    topCompanies,
    companyCount: companies?.size ?? null,
  };
}

function topJudges(atlas: Atlas) {
  const by = new Map<string, number>();
  for (const r of latestMdls(atlas))
    if (r.m.judge) by.set(r.m.judge, (by.get(r.m.judge) ?? 0) + r.pending);
  return [...by.entries()]
    .map(([judge, actions]) => ({ judge, actions }))
    .sort((a, b) => b.actions - a.actions)
    .slice(0, 3);
}

export function VisualStories() {
  const docketQ = useQuery(mdlDocketQuery);
  const netQ = useQuery(defendantNetworkQuery);
  const atlasQ = useQuery(mdlAtlasQuery);
  const atlas = atlasQ.data ?? null;
  const docket = docketQ.data ?? null;
  const network = netQ.data ?? null;
  const facts = useMemo(() => (docket ? storyFacts(docket, network) : null), [docket, network]);
  const play = usePlayback(docket ? docket.dates.length - 1 : 0);

  // the race starts itself the first time it is on screen, unless the reader asked for less motion
  const raceRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = raceRef.current;
    if (
      !el ||
      !docket ||
      started.current ||
      reducedMotion() ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !started.current) {
          started.current = true;
          play.restart();
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docket]);

  const context = useMemo(() => {
    if (!docket || !facts) return null;
    const last = facts.last;
    return buildSectionContext({
      title: "Visual stories: the MDL docket",
      scope:
        "Actions pending in each MDL across every captured JPML pending-docket report, and the companies SEC filings link to MDLs as defendants",
      period: `${reportLabel(docket.dates[0] ?? "")} to ${reportLabel(docket.dates[last] ?? "")} (${docket.dates.length} reports)`,
      source: "JPML Pending MDL Dockets reports; SEC EDGAR filings",
      figures: [
        { label: "Actions pending, latest report", value: n(docket.totals[last]) },
        { label: "MDLs listed, latest report", value: n(docket.listed[last]) },
        {
          label: `Peak actions pending (${reportLabel(docket.dates[facts.peakI] ?? "")})`,
          value: n(docket.totals[facts.peakI]),
        },
        ...(facts.biggest
          ? [
              {
                label: `Largest single MDL in these reports: MDL ${facts.biggest.mdl} ${shortTitle(facts.biggest.title)}, peak`,
                value: n(facts.biggest.peak),
              },
            ]
          : []),
        ...facts.lead.map((l) => ({
          label: `Largest MDL from ${reportLabel(docket.dates[l.frame] ?? "")}`,
          value: `MDL ${l.mdl} ${shortTitle(facts.byId.get(l.mdl)?.title ?? "")}`,
        })),
        ...facts.now.map((r) => ({
          label: `MDL ${r.m.mdl} ${shortTitle(r.m.title)}, pending in the latest report`,
          value: n(r.m.values[last]),
        })),
        ...(network && facts.companyCount !== null
          ? [
              {
                label: "Companies SEC filings link to an MDL as a defendant",
                value: n(facts.companyCount),
              },
              { label: "Company–MDL links", value: n(network.links.length) },
              {
                label: "Links that cite the MDL number or caption",
                value: n(network.links.filter((l) => l.tier === "A" || l.tier === "B").length),
              },
              ...facts.topCompanies.map((c) => ({
                label: `${c.company}: MDLs linked`,
                value: n(c.mdls),
              })),
            ]
          : []),
        ...(atlas
          ? [
              ...[...atlas.districts]
                .sort((a, b) => (b.values.at(-1) ?? 0) - (a.values.at(-1) ?? 0))
                .slice(0, 4)
                .map((d) => ({
                  label: `${courtShort(d)}: actions pending, latest report`,
                  value: n(d.values.at(-1)),
                })),
              ...topJudges(atlas).map((j) => ({
                label: `Judge ${j.judge}: actions pending`,
                value: n(j.actions),
              })),
              { label: "MDLs in all captured reports", value: n(atlas.mdls.length) },
            ]
          : []),
      ],
      maxFigures: 36,
    });
  }, [docket, network, facts, atlas]);

  if (docketQ.isPending)
    return (
      <div className="space-y-3" role="status" aria-label="Loading the visual stories">
        <div className="h-28 animate-pulse rounded-xl border border-border bg-muted/40" />
        <div className="h-[620px] animate-pulse rounded-xl border border-border bg-muted/30" />
      </div>
    );
  if (docketQ.isError)
    return (
      <p role="alert" className="rounded-md border border-border p-3 text-sm">
        The docket history could not be read just now.{" "}
        <button
          type="button"
          className="text-primary underline"
          onClick={() => void docketQ.refetch()}
        >
          Retry
        </button>
      </p>
    );
  if (!docket || !facts || !docket.dates.length)
    return (
      <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
        The docket history is not published yet.
      </p>
    );

  const last = facts.last;
  const near = Math.round(play.t);
  const leaderNow = rankAt(docket.mdls, near, 1)[0];
  const first = facts.lead[0];
  const lastLead = facts.lead.at(-1);
  const peakDate = reportLabel(docket.dates[facts.peakI] ?? "");
  const change = (docket.totals[last] ?? 0) - (docket.totals[facts.peakI] ?? 0);

  const raceTable: TableSpec = {
    caption: `Every captured JPML pending-docket report (${docket.dates.length}): actions pending, MDLs listed and the largest MDL.`,
    columns: [
      { label: "Report" },
      { label: "Actions pending", align: "right" },
      { label: "MDLs listed", align: "right" },
      { label: "Largest MDL" },
      { label: "Its actions pending", align: "right" },
    ],
    rows: docket.dates.map((date, i) => {
      const top = rankAt(docket.mdls, i, 1)[0];
      return {
        key: date,
        cells: [
          reportLabel(date),
          n(docket.totals[i]),
          n(docket.listed[i]),
          top ? `MDL ${top.m.mdl} ${shortTitle(top.m.title)}` : "Not recorded",
          top ? n(top.v) : "Not recorded",
        ],
      };
    }),
  };
  const layers = streamLayers(docket, 12);
  const streamTable: TableSpec = {
    caption: "The twelve MDLs drawn as their own layers, by their peak in these reports.",
    columns: [
      { label: "MDL" },
      { label: "Name" },
      { label: "Type" },
      { label: "Peak pending", align: "right" },
      { label: "Latest report", align: "right" },
    ],
    rows: layers.named.map((m) => ({
      key: String(m.mdl),
      cells: [
        String(m.mdl),
        shortTitle(m.title),
        CATEGORY_LABEL[m.category],
        n(m.peak),
        m.values[last] === null ? "Not listed" : n(m.values[last]),
      ],
    })),
  };
  const netTable: TableSpec | undefined = network
    ? {
        caption: `Company–MDL links from SEC filings (${network.links.length}), with the evidence each filing gives.`,
        columns: [
          { label: "Company" },
          { label: "MDL" },
          { label: "MDL name" },
          { label: "Evidence" },
          { label: "Filings", align: "right" },
          { label: "First" },
          { label: "Last" },
        ],
        rows: network.links.map((l) => {
          const m = network.mdls.find((x) => x.mdl === l.mdl);
          return {
            key: `${l.cik}-${l.mdl}`,
            cells: [
              l.company,
              String(l.mdl),
              shortTitle(m?.title ?? ""),
              l.tierLabel,
              n(l.verified),
              l.first ?? "Not recorded",
              l.last ?? "Not recorded",
            ],
          };
        }),
      }
    : undefined;
  const usedCategories = CATEGORIES.filter(
    (c) => layers.named.some((m) => m.category === c) || c === "other",
  );

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label="Visual stories summary" className="space-y-3">
        <KpiStrip
          label="The MDL docket"
          cellBasis="basis-[calc(50%-1px)] md:basis-[calc(33.333%-1px)] xl:basis-[calc(20%-1px)]"
          items={[
            {
              key: "now",
              label: "Actions pending in MDLs",
              value: n(docket.totals[last]),
              meta: `JPML report of ${reportLabel(docket.dates[last] ?? "")}`,
            },
            {
              key: "peak",
              label: "Peak in these reports",
              value: n(docket.totals[facts.peakI]),
              meta: `${peakDate} · ${change <= 0 ? "down" : "up"} ${n(Math.abs(change))} since`,
            },
            {
              key: "listed",
              label: "MDLs listed",
              value: n(docket.listed[last]),
              meta: `${docket.dates.length} reports captured since ${docket.dates[0]?.slice(0, 4) ?? ""}`,
            },
            {
              key: "lead",
              label: "Largest MDL now",
              value: lastLead ? `MDL ${lastLead.mdl}` : "Not recorded",
              meta: lastLead ? shortTitle(facts.byId.get(lastLead.mdl)?.title ?? "") : undefined,
            },
            {
              key: "net",
              label: "Companies named as defendants",
              value: facts.companyCount === null ? "Not recorded" : n(facts.companyCount),
              meta: network
                ? `${n(network.links.length)} links to ${n(network.mdls.length)} MDLs in SEC filings`
                : "SEC filing links not published",
            },
          ]}
        />
        <AiSummary context={context} title="AI story brief" />
      </section>

      <SectionIndex
        items={[
          { id: "story-race", label: "Docket race" },
          { id: "story-map", label: "Court map" },
          { id: "story-field", label: "Every case" },
          { id: "story-stream", label: "Shape of the docket" },
          { id: "story-strands", label: "Every MDL's life" },
          { id: "story-network", label: "Defendant network" },
          { id: "story-chord", label: "Sued together" },
        ]}
      />

      <Section
        id="story-race"
        title="Which MDLs have held the most cases"
        description="The twelve largest MDLs by actions pending in each captured JPML report, played from the first report to the latest. Press play, drag the timeline, or pause on any report."
      >
        <div ref={raceRef}>
          <ChartCard
            title={
              first && lastLead && facts.biggest
                ? `${facts.lead.length - 1} changes at the top since ${docket.dates[0]?.slice(0, 4)}; ${shortTitle(facts.byId.get(lastLead.mdl)?.title ?? "")} leads now, and ${shortTitle(facts.biggest.title)} peaked at ${n(facts.biggest.peak)} actions`
                : "The largest MDLs, report by report"
            }
            subtitle={`Actions pending per MDL · ${docket.dates.length} JPML reports, ${reportLabel(docket.dates[0] ?? "")} – ${reportLabel(docket.dates[last] ?? "")}`}
            table={raceTable}
            sources={[JPML]}
            about={
              <div className="space-y-2">
                <p>
                  The JPML (Judicial Panel on Multidistrict Litigation) publishes a report of every
                  pending MDL and the number of actions (individual cases) pending in it. Each frame
                  is one captured report.
                </p>
                <p>
                  Between two reports the bars glide so the motion is easy to follow; the in-between
                  values are drawn only. Paused on a report, every bar, rank and figure is that
                  report&apos;s own count. Reports are not evenly spaced: few before 2016, about
                  monthly from 2023.
                </p>
              </div>
            }
            minHeight={620}
          >
            <div className="space-y-2">
              <PlaybackBar
                play={play}
                status={`Report ${near + 1} of ${docket.dates.length} · ${reportLabel(docket.dates[near] ?? "")}${leaderNow ? ` · leading: ${shortTitle(leaderNow.m.title)}` : ""}`}
                extra={
                  <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {CATEGORIES.filter((c) => docket.mdls.some((m) => m.category === c)).map(
                      (c) => (
                        <li key={c} className="flex items-center gap-1.5">
                          <span
                            className="inline-block size-2.5 rounded-sm"
                            style={{ background: CATEGORY_COLOR[c] }}
                          />
                          {CATEGORY_LABEL[c]}
                        </li>
                      ),
                    )}
                  </ul>
                }
              />
              <DocketRace docket={docket} t={play.t} height={540} />
              <DocketTimeline docket={docket} t={play.t} onScrub={play.scrub} />
            </div>
          </ChartCard>
        </div>
      </Section>

      {atlas ? (
        <MapSection atlas={atlas} docket={docket} play={play} />
      ) : (
        <AtlasPending q={atlasQ} />
      )}

      {atlas ? <FieldSection atlas={atlas} /> : null}

      <Section
        id="story-stream"
        title="The shape of the docket"
        description="All actions pending in MDLs, report by report. The twelve largest MDLs are their own layers and every other MDL is one grey layer, so each slice adds up to that report's total. The line follows the race above."
      >
        <ChartCard
          title={`Actions pending peaked at ${n(docket.totals[facts.peakI])} in ${peakDate} and stood at ${n(docket.totals[last])} in the latest report`}
          subtitle="Actions pending per MDL, stacked around a centre line · hover a layer to read the report"
          table={streamTable}
          sources={[JPML]}
          about={
            <p>
              A streamgraph stacks the layers around a moving centre line instead of a flat axis, so
              the thickness of a layer at any report is its actions pending and the total thickness
              is the report total. Layer colour is the litigation type:{" "}
              {usedCategories.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(", ")}.
            </p>
          }
          minHeight={400}
        >
          <DocketStream docket={docket} t={play.t} height={400} />
        </ChartCard>
      </Section>

      {atlas ? <StrandsSection atlas={atlas} play={play} /> : null}

      <Section
        id="story-network"
        title="Who is defending what"
        description="Every company an SEC filing names as a defendant in an MDL, linked to that MDL and to the product groups tracked for it. Drag nodes, search, or click one for its links."
      >
        {netQ.isPending ? (
          <div
            className="h-[640px] animate-pulse rounded-xl border border-border bg-muted/30"
            role="status"
            aria-label="Loading the network"
          />
        ) : network ? (
          <ChartCard
            title={
              facts.topCompanies[0]
                ? `${n(facts.companyCount)} companies, ${n(network.mdls.length)} MDLs; ${facts.topCompanies[0].company} is linked to the most, ${n(facts.topCompanies[0].mdls)}`
                : "Companies linked to MDLs in SEC filings"
            }
            subtitle="Company–MDL defendant links from SEC filings, with MDL product groups"
            table={netTable}
            sources={[SEC, JPML]}
            about={
              <div className="space-y-2">
                <p>
                  A link is recorded only when a company&apos;s own SEC filing discusses the MDL as
                  litigation against it. Filings that cite the MDL number or the official caption
                  are solid lines; filings that only describe the subject are dashed and should be
                  checked before use.
                </p>
                <p>
                  The layout is a force simulation: linked nodes pull together and every node pushes
                  the others away. Where a node ends up on the canvas carries no meaning by itself.
                </p>
              </div>
            }
            minHeight={640}
          >
            <DefendantNetwork network={network} />
          </ChartCard>
        ) : (
          <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            {netQ.isError
              ? "The defendant network could not be read just now."
              : "The defendant network is not published yet."}
          </p>
        )}
      </Section>

      {network ? <ChordSection network={network} /> : null}
    </div>
  );
}

function AtlasPending({
  q,
}: {
  q: { isPending: boolean; isError: boolean; refetch: () => unknown };
}) {
  if (q.isPending)
    return (
      <div
        className="h-[560px] animate-pulse rounded-xl border border-border bg-muted/30"
        role="status"
        aria-label="Loading the MDL atlas"
      />
    );
  return (
    <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
      {q.isError
        ? "The court map and case dots could not be read just now."
        : "The MDL atlas is not published yet."}{" "}
      {q.isError ? (
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      ) : null}
    </p>
  );
}
