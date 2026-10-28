/**
 * The atlas sections of Visual stories: where the cases sit (district map with the shared playhead), every case as
 * dots (unit chart), every MDL's life (heatmap) and who is sued together (chord). Each sits in a ChartCard with its
 * data table and sources; the titles are computed from the figures shown.
 */
import { useMemo, useState } from "react";
import { ChartCard, type TableSpec } from "@/components/charts/ChartCard";
import { Section } from "@/components/kit/Section";
import { useCorpus } from "@/lib/corpus/store";
import { CaseField } from "./CaseField";
import { CodefendantChord } from "./CodefendantChord";
import { DistrictMap } from "./DistrictMap";
import { DocketStrands } from "./DocketStrands";
import { DocketTimeline } from "./DocketRace";
import { PlaybackBar } from "./PlaybackBar";
import { useDistrictName } from "./useDistrictName";
import {
  GROUPING_LABEL,
  codefendants,
  displayCompany,
  courtShort,
  latestMdls,
  pendingAt,
  strandOrder,
  unitFor,
  unitTableRows,
  type Atlas,
  type Grouping,
} from "./atlasModel";
import type { PlaybackControls } from "./playback";
import { reportLabel } from "./storiesColors";
import { CATEGORY_LABEL, shortTitle, type Docket, type Network } from "./storiesModel";

const n = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v).toLocaleString("en-US")
    : "Not recorded";
const JPML = {
  label: "JPML, Pending MDL Dockets by Actions Pending",
  url: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
};
const COURTS = {
  label: "Courthouse addresses from each court's website, U.S. Census Bureau Geocoder",
  url: "https://geocoding.geo.census.gov/geocoder/",
};
const SEC = { label: "SEC EDGAR company filings", url: "https://www.sec.gov/edgar/search/" };

export function MapSection({
  atlas,
  docket,
  play,
}: {
  atlas: Atlas;
  docket: Docket;
  play: PlaybackControls;
}) {
  const { geo } = useCorpus();
  const last = atlas.dates.length - 1;
  const near = Math.max(0, Math.min(last, Math.round(play.t)));
  const lastRank = [...atlas.districts].sort(
    (a, b) => (b.values[last] ?? 0) - (a.values[last] ?? 0),
  );
  const top = lastRank[0];
  const latestTotal = atlas.districts.reduce((s, d) => s + (d.values[last] ?? 0), 0);
  const top3 = lastRank.slice(0, 3).reduce((s, d) => s + (d.values[last] ?? 0), 0);
  const table: TableSpec = {
    caption: `Actions pending and MDLs listed per transferee district in the JPML report of ${reportLabel(atlas.dates[near] ?? "")}.`,
    columns: [
      { label: "Court" },
      { label: "Code" },
      { label: "Plotted at" },
      { label: "Actions pending", align: "right" },
      { label: "MDLs listed", align: "right" },
      { label: "Peak in these reports", align: "right" },
    ],
    rows: [...atlas.districts]
      .sort((a, b) => (b.values[near] ?? 0) - (a.values[near] ?? 0))
      .filter((d) => (d.values[near] ?? 0) > 0 || (d.counts[near] ?? 0) > 0)
      .map((d) => ({
        key: d.code,
        cells: [
          courtShort(d),
          d.code,
          d.city && d.state ? `${d.city}, ${d.state}` : "Not recorded",
          n(d.values[near]),
          n(d.counts[near]),
          n(Math.max(...d.values)),
        ],
      })),
  };
  return (
    <Section
      id="story-map"
      title="Where the cases sit"
      description="Actions pending in MDLs by the federal district court that hosts each MDL, moving with the race above. Bubble area is actions pending."
    >
      <ChartCard
        title={
          top
            ? `${courtShort(top)} holds ${n(top.values[last])} actions, ${((100 * (top.values[last] ?? 0)) / (latestTotal || 1)).toFixed(0)}% of all MDL cases; the three largest courts hold ${((100 * top3) / (latestTotal || 1)).toFixed(0)}%`
            : "Actions pending by transferee district"
        }
        subtitle={`Actions pending per transferee district · ${atlas.dates.length} JPML reports, ${reportLabel(atlas.dates[0] ?? "")} – ${reportLabel(atlas.dates[last] ?? "")}`}
        table={table}
        sources={[JPML, COURTS]}
        about={
          <div className="space-y-2">
            <p>
              The transferee district is the federal trial court the JPML sends an MDL to; one judge
              there handles every case in it. Each MDL&apos;s actions are counted under the district
              that report prints.
            </p>
            <p>
              A bubble sits at the courthouse the court lists first on its own website (geocoded by
              the Census Bureau) or, where that is not recorded, the first building with coordinates
              in the court building registry. It marks the court, not the courtroom of a particular
              MDL judge. Courts with no recorded coordinates are listed under the ranking.
            </p>
          </div>
        }
        minHeight={560}
      >
        <div className="space-y-3">
          <PlaybackBar
            play={play}
            status={`Report ${near + 1} of ${atlas.dates.length} · ${reportLabel(atlas.dates[near] ?? "")}`}
          />
          <DistrictMap atlas={atlas} t={play.t} geo={geo} />
          <DocketTimeline docket={docket} t={play.t} onScrub={play.scrub} height={70} />
        </div>
      </ChartCard>
    </Section>
  );
}

const byWord = (g: Grouping) => (g === "mdl" ? "MDL" : GROUPING_LABEL[g].toLowerCase());

export function FieldSection({ atlas }: { atlas: Atlas }) {
  const [by, setBy] = useState<Grouping>("mdl");
  const districtName = useDistrictName(atlas);
  const rows = latestMdls(atlas);
  const total = rows.reduce((s, r) => s + r.pending, 0);
  const unit = unitFor(total);
  const groups = unitTableRows(atlas, by, districtName);
  const top = [...groups].sort((a, b) => b.actions - a.actions)[0];
  const last = atlas.dates.length - 1;
  const table: TableSpec = {
    caption: `Actions pending in the JPML report of ${reportLabel(atlas.dates[last] ?? "")}, by ${byWord(by)}.`,
    columns: [
      { label: GROUPING_LABEL[by] },
      { label: "Actions pending", align: "right" },
      { label: "Share", align: "right" },
      { label: "MDLs", align: "right" },
      { label: "Largest MDL" },
    ],
    rows: groups.map((g) => ({
      key: g.key,
      cells: [
        g.label,
        n(g.actions),
        `${((100 * g.actions) / (total || 1)).toFixed(1)}%`,
        n(g.mdls),
        g.largest,
      ],
    })),
  };
  const lead = rows[0];
  return (
    <Section
      id="story-field"
      title="Every case, as dots"
      description={`Each dot is ${n(unit)} actions pending in the latest JPML report. Regroup them by MDL, type of case, court, judge or the year the MDL was centralized and watch every dot move.`}
    >
      <ChartCard
        title={
          lead && top
            ? `${n(total)} actions pending in ${n(rows.length)} MDLs with open cases; by ${byWord(by)}, ${top.label} holds ${((100 * top.actions) / (total || 1)).toFixed(0)}%${by === "mdl" ? "" : ` (largest MDL: ${lead.m.short})`}`
            : "Actions pending, as dots"
        }
        subtitle={`1 dot = ${n(unit)} actions pending · JPML report of ${reportLabel(atlas.dates[last] ?? "")} · an MDL smaller than one dot still gets one`}
        table={table}
        sources={[JPML]}
        about={
          <div className="space-y-2">
            <p>
              Each MDL gets its pending actions divided by {n(unit)}, rounded to the nearest whole
              dot, with at least one dot so the smallest MDLs stay visible. Dot colour is the type
              of litigation.
            </p>
            <p>
              &quot;Year centralized&quot; is the date the JPML transferred the MDL, as the report
              records it. Groups past the fourteenth are folded into &quot;All others&quot; for MDL,
              court and judge.
            </p>
          </div>
        }
        minHeight={560}
      >
        <CaseField atlas={atlas} districtName={districtName} by={by} onBy={setBy} />
      </ChartCard>
    </Section>
  );
}

export function StrandsSection({ atlas, play }: { atlas: Atlas; play: PlaybackControls }) {
  const last = atlas.dates.length - 1;
  const live = atlas.mdls.filter(
    (m) =>
      pendingAt(m, last) > 0 ||
      (m.start + m.values.length - 1 === last && m.values.at(-1) !== null),
  );
  const newSince2023 = atlas.mdls.filter(
    (m) => (atlas.dates[m.start] ?? "") >= "2023-01-01",
  ).length;
  const ordered = strandOrder(atlas.mdls, "peak");
  const table: TableSpec = {
    caption: `Every MDL in the captured JPML reports (${atlas.mdls.length}), largest first.`,
    columns: [
      { label: "MDL" },
      { label: "Name" },
      { label: "Type" },
      { label: "First listed" },
      { label: "Last listed" },
      { label: "Peak pending", align: "right" },
      { label: "Latest pending", align: "right" },
    ],
    rows: ordered.map((m) => ({
      key: String(m.mdl),
      cells: [
        String(m.mdl),
        m.short,
        CATEGORY_LABEL[m.category],
        atlas.dates[m.start] ?? "",
        atlas.dates[m.start + m.values.length - 1] ?? "",
        n(Math.max(0, ...m.values.map((v) => v ?? 0))),
        m.start + m.values.length - 1 === last ? n(pendingAt(m, last)) : "Not listed",
      ],
    })),
  };
  return (
    <Section
      id="story-strands"
      title="Every MDL's life"
      description="One row per MDL, one column per JPML report. Shade is actions pending; a row begins when the MDL first appears and ends when it leaves the report."
    >
      <ChartCard
        title={`${n(atlas.mdls.length)} MDLs across ${n(atlas.dates.length)} reports; ${n(live.length)} are in the latest, and ${n(newSince2023)} first appeared in 2023 or later`}
        subtitle="Actions pending per MDL per report, log shade · rows by first appearance, size or type"
        table={table}
        sources={[JPML]}
        about={
          <p>
            Each column is one captured report, evenly spaced; the year marks fall at each
            year&apos;s first report. Reports before 2016 are sparse in the capture, so those years
            take only a few columns. An MDL that leaves the report has usually been closed or had
            its cases resolved; the report itself does not say why.
          </p>
        }
        minHeight={860}
      >
        <DocketStrands atlas={atlas} t={play.t} />
      </ChartCard>
    </Section>
  );
}

export function ChordSection({ network }: { network: Network }) {
  const data = useMemo(() => codefendants(network, 18), [network]);
  const label = (c: (typeof data.companies)[number]) =>
    c.also.length
      ? `${displayCompany(c.company)} (+${c.also.length} with the same MDLs)`
      : displayCompany(c.company);
  const titles = new Map(network.mdls.map((m) => [m.mdl, shortTitle(m.title)] as const));
  const pairs: { a: string; b: string; shared: number[] }[] = [];
  data.shared.forEach((row, i) =>
    row.forEach((s, j) => {
      if (j > i && s.length)
        pairs.push({ a: label(data.companies[i]!), b: label(data.companies[j]!), shared: s });
    }),
  );
  pairs.sort((x, y) => y.shared.length - x.shared.length);
  const top = pairs[0];
  const table: TableSpec = {
    caption: `Company pairs SEC filings name as defendants in the same MDL (${pairs.length}).`,
    columns: [
      { label: "Company" },
      { label: "Company" },
      { label: "Shared MDLs", align: "right" },
      { label: "MDLs" },
    ],
    rows: pairs.map((p) => ({
      key: `${p.a}|${p.b}`,
      cells: [
        p.a,
        p.b,
        n(p.shared.length),
        p.shared.map((m) => `${m} ${titles.get(m) ?? ""}`.trim()).join("; "),
      ],
    })),
  };
  return (
    <Section
      id="story-chord"
      title="Sued together"
      description="Companies whose SEC filings name them as defendants in the same MDLs. Each ribbon joins two companies; its width is the MDLs they share."
    >
      <ChartCard
        title={
          top
            ? `${n(pairs.length)} co-defendant pairs among ${n(data.companies.length)} companies; ${top.a} and ${top.b} share the most, ${n(top.shared.length)}`
            : "Companies sued together"
        }
        subtitle="Shared MDLs per company pair, from defendant links in SEC filings"
        table={table}
        sources={[SEC, JPML]}
        about={
          <p>
            Built from the same company–MDL links as the network above. Two companies are joined
            when the filings of each discuss the same MDL as litigation against it; this includes
            links where the filing describes the MDL only by its subject.
          </p>
        }
        minHeight={620}
      >
        <CodefendantChord network={network} />
      </ChartCard>
    </Section>
  );
}
