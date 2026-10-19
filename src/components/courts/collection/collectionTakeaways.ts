/**
 * Key takeaways for the five tabs of /courts/collection, computed from the data the tab has already loaded. Every figure
 * names what it is a share of; none compares the snapshot's partial year with a complete one; unknowns are left out.
 */
import {
  compact,
  int,
  medianOf,
  usableTakeaways,
  type Takeaway,
} from "@/components/analysis/analysisFormat";
import type {
  CitationMatrix,
  DisclosureData,
  DocketLevel,
  DocketNosList,
  DocketOverview,
  DocketState,
  DocketYear,
  FlowsMap,
  ScotusCiters,
  SchemaTableRow,
  TopCited,
} from "@/lib/external/clbCollection.functions";
import {
  decadeLabel,
  decadeOf,
  partialYearText,
  peakCompleteYear,
  pct,
  sharePct,
  stateName,
  thinYears,
  yearRuns,
  latestCompleteYear,
} from "./collectionFormat";

export type DocketTakeawayInput = {
  overview: DocketOverview | null;
  years: readonly DocketYear[];
  levels: readonly DocketLevel[];
  states: readonly DocketState[];
  nos: DocketNosList | null;
  snapshot: string | null;
};

export function docketTakeaways(input: DocketTakeawayInput): Takeaway[] {
  const { overview, years, levels, states, nos, snapshot } = input;
  const total = overview?.dockets ?? null;
  const out: (Takeaway | null)[] = [];

  out.push(
    overview
      ? {
          id: "size",
          figure: compact(overview.dockets),
          text: `dockets in CourtListener's collection${overview.courtsWithDockets != null ? `, from ${int(overview.courtsWithDockets)} courts` : ""}. These are rows in a collection, not a count of court filings.`,
          anchor: "collection-kpis",
          anchorLabel: "See the totals",
        }
      : null,
  );

  const bankruptcy = levels.find((l) => l.code === "FB");
  const bk = bankruptcy ? sharePct(bankruptcy.dockets, total) : null;
  out.push(
    bankruptcy && bk != null
      ? {
          id: "bankruptcy",
          figure: pct(bk),
          text: `of the dockets (${compact(bankruptcy.dockets)}) are in federal bankruptcy courts, the largest court level in the collection.`,
          anchor: "collection-levels",
          anchorLabel: "Court levels",
        }
      : null,
  );

  const federal = levels.filter((l) => l.family === "federal").reduce((a, l) => a + l.dockets, 0);
  const state = levels.filter((l) => l.family === "state").reduce((a, l) => a + l.dockets, 0);
  const fedPct = sharePct(federal, total);
  const statePct = sharePct(state, total);
  out.push(
    levels.length && fedPct != null && statePct != null
      ? {
          id: "federal-state",
          figure: pct(fedPct),
          text: `of the dockets are in federal courts and ${pct(statePct)} in state courts (court levels as stored; the rest are listed separately).`,
          anchor: "collection-levels",
          anchorLabel: "Court levels",
        }
      : null,
  );

  const latest = latestCompleteYear(years);
  const partial = years.find((y) => y.partial) ?? null;
  out.push(
    latest
      ? {
          id: "latest-year",
          figure: compact(latest.dockets),
          text: `dockets filed in ${latest.year}, the latest complete year${latest.yoyPct != null ? ` (${latest.yoyPct > 0 ? "+" : latest.yoyPct < 0 ? "−" : ""}${Math.abs(latest.yoyPct).toLocaleString("en-US", { maximumFractionDigits: 1 })}% on ${latest.year - 1} as published)` : ""}. ${partial ? `${partial.year} is a ${partialYearText(snapshot)} and is not compared.` : ""}`.trim(),
          anchor: "collection-years",
          anchorLabel: "By year",
        }
      : null,
  );

  const topGroup = nos?.groups.rows.length
    ? [...nos.groups.rows].sort((a, b) => b.dockets - a.dockets)[0]
    : null;
  const groupPct = topGroup ? sharePct(topGroup.dockets, nos?.numericCodeDockets ?? null) : null;
  out.push(
    topGroup && groupPct != null && nos?.numericCodeDockets != null
      ? {
          id: "nos-group",
          figure: pct(groupPct),
          text: `of the ${int(nos.numericCodeDockets)} dockets with a numeric nature-of-suit code are in "${topGroup.label}" (this project's grouping of FJC codes).`,
          anchor: "collection-table",
          anchorLabel: "Nature of suit",
        }
      : null,
  );

  const peak = peakCompleteYear(years, (y) => y.dockets);
  out.push(
    peak && latest && peak.year !== latest.year
      ? {
          id: "peak-year",
          figure: String(peak.year),
          text: `has the most dockets of any complete year (${compact(peak.dockets)}), which reflects what CourtListener collected, not necessarily what courts received.`,
          anchor: "collection-years",
          anchorLabel: "By year",
        }
      : null,
  );

  const topState = [...states].sort((a, b) => b.dockets - a.dockets)[0];
  out.push(
    topState && sharePct(topState.dockets, total) != null
      ? {
          id: "top-state",
          figure: topState.code,
          text: `${stateName(topState.code)} has the most dockets of any state or territory (${compact(topState.dockets)}, ${pct(sharePct(topState.dockets, total))} of all dockets).`,
          anchor: "collection-table",
          anchorLabel: "States",
        }
      : null,
  );
  return usableTakeaways(out, 5);
}

// -------------------------------------------------------------------------------------------- citations

/** The share of the matrix's links that sit on its diagonal (a court citing its own opinions); null when the matrix is not square or has a missing cell. */
export function diagonalShare(m: CitationMatrix | null): number | null {
  if (!m) return null;
  let diagonal = 0;
  let total = 0;
  for (let i = 0; i < m.rows.length; i += 1) {
    const col = m.columns.findIndex((c) => c.key === m.rows[i]!.key);
    for (let j = 0; j < m.columns.length; j += 1) {
      const v = m.cells[i]?.[j];
      if (v == null) return null;
      total += v;
      if (j === col) diagonal += v;
    }
  }
  return total > 0 ? (100 * diagonal) / total : null;
}

/** The courts that cite the Supreme Court most, leaving out the Supreme Court's own citations of itself. */
export function topScotusCiter(s: ScotusCiters | null) {
  return s?.citers.find((c) => c.courtId !== "scotus") ?? null;
}

export function citationTakeaways(map: FlowsMap | null): Takeaway[] {
  if (!map) return [];
  const o = map.overview;
  const self = diagonalShare(map.circuits);
  const top = topScotusCiter(map.scotus);
  return usableTakeaways(
    [
      {
        id: "resolved",
        figure: compact(o.resolved),
        text: `citation links resolve to a court on both sides; ${o.sameCourt != null ? `${pct(sharePct(o.sameCourt, o.resolved))} stay within one court. ` : ""}The map is CourtListener's extraction from opinion text, not a census.`,
        anchor: "citations-kpis",
        anchorLabel: "See the totals",
      },
      self != null
        ? {
            id: "self",
            figure: pct(self),
            text: "of the links the thirteen courts of appeals make to the courts of appeals and the Supreme Court are a circuit citing its own opinions (the diagonal of the map).",
            anchor: "citations-circuits",
            anchorLabel: "Circuit map",
          }
        : null,
      top && map.scotus
        ? {
            id: "top-citer",
            figure: compact(top.count),
            text: `links to the Supreme Court come from ${top.name}, the most of any court other than the Supreme Court itself (${pct(sharePct(top.count, map.scotus.total))} of ${compact(map.scotus.total)}).`,
            anchor: "citations-scotus",
            anchorLabel: "Supreme Court citers",
          }
        : null,
      o.excluded != null && o.excluded > 0 && o.mapLinks != null
        ? {
            id: "excluded",
            figure: int(o.excluded),
            text: `map links (${pct(sharePct(o.excluded, o.mapLinks), 2)}) are left out: an opinion is not in the opinion table, two opinions are of the same decision, or a court could not be resolved.`,
            anchor: "citations-kpis",
            anchorLabel: "See the totals",
          }
        : null,
      o.crossPairsNotPublished != null && o.crossLinksNotPublished != null
        ? {
            id: "tail",
            figure: compact(o.crossLinksNotPublished),
            text: `links (${pct(sharePct(o.crossLinksNotPublished, o.resolved))} of the resolved links) are in ${int(o.crossPairsNotPublished)} smaller court pairs that are not published; only the ${int(o.crossEdgesPublished ?? 0)} largest pairs are listed.`,
            anchor: "citations-kpis",
            anchorLabel: "See the totals",
          }
        : null,
    ],
    5,
  );
}

// -------------------------------------------------------------------------------------------- most cited

export function citedTakeaways(rows: readonly TopCited[]): Takeaway[] {
  if (!rows.length) return [];
  const top = [...rows].sort((a, b) => a.rank - b.rank)[0]!;
  const scotus = rows.filter((r) => r.courtId === "scotus").length;
  const decades = new Map<number, number>();
  for (const r of rows) decades.set(decadeOf(r.year), (decades.get(decadeOf(r.year)) ?? 0) + 1);
  const [decade, n] = [...decades].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [];
  const twins = rows.filter((r) => r.twinRanks.length).length;
  const low = rows.filter((r) => r.lowMapRatio).length;
  return usableTakeaways(
    [
      {
        id: "top",
        figure: int(top.timesCited),
        text: `times cited (CourtListener's citation_count): ${top.caseName} (${top.year}), the most-cited opinion among the ${int(rows.length)} listed.`,
        anchor: "cited-table",
        anchorLabel: "See the list",
      },
      scotus > 0
        ? {
            id: "scotus",
            figure: pct(sharePct(scotus, rows.length), 0),
            text: `of the ${int(rows.length)} most-cited opinions (${int(scotus)}) are Supreme Court opinions.`,
            anchor: "cited-table",
            anchorLabel: "See the list",
          }
        : null,
      decade != null && n != null
        ? {
            id: "decade",
            figure: decadeLabel(decade),
            text: `is the decade of decision for the most opinions on the list (${int(n)} of ${int(rows.length)}); citing counts are not adjusted for how long an opinion has been available to cite.`,
            anchor: "cited-table",
            anchorLabel: "See the list",
          }
        : null,
      twins + low > 0
        ? {
            id: "flags",
            figure: int(twins + low),
            text: `listed clusters carry a flag: ${int(twins)} share a reporter citation with another listed cluster (a split decision, so each ranks lower than the decision would) and ${int(low)} have under half as many map links as times cited.`,
            anchor: "cited-table",
            anchorLabel: "See the list",
          }
        : null,
    ],
    5,
  );
}

// -------------------------------------------------------------------------------------------- disclosures

export function disclosureTakeaways(data: DisclosureData | null): Takeaway[] {
  if (!data) return [];
  const o = data.overview;
  const years = data.years.rows;
  const courts = data.courts.rows;
  const coverage = courts.map((c) => sharePct(c.withReport, c.people));
  const median = medianOf(coverage);
  const zero = coverage.filter((c) => c === 0).length;
  const thin = thinYears(years, (y) => y.reports);
  const busiest = [...years].sort((a, b) => b.reports - a.reports)[0];
  const investments = o?.sections.find((s) => s.section === "investments")?.items ?? null;
  const items = o?.sections.reduce((a, s) => a + s.items, 0) ?? null;
  return usableTakeaways(
    [
      o && o.judicialPeople != null && o.judicialWithReport != null
        ? {
            id: "people",
            figure: pct(sharePct(o.judicialWithReport, o.judicialPeople)),
            text: `of the ${int(o.judicialPeople)} people with a judicial position on record have at least one report in CourtListener (${int(o.judicialWithReport)}). Coverage is what CourtListener collected, not whether a judge had to file.`,
            anchor: "disclosures-kpis",
            anchorLabel: "See the totals",
          }
        : null,
      busiest
        ? {
            id: "busiest",
            figure: String(busiest.year),
            text: `is the filing year with the most reports (${int(busiest.reports)}). ${thin.size ? `Filing years ${yearRuns([...thin])} each hold under 5% of that, so read them as thin coverage, not as fewer filings.` : ""}`.trim(),
            anchor: "disclosures-years",
            anchorLabel: "By filing year",
          }
        : null,
      median != null
        ? {
            id: "median-court",
            figure: pct(median),
            text: `is the median court's coverage across the ${int(courts.length)} courts listed (courts with five or more people on record); ${int(zero)} of them have no report at all.`,
            anchor: "disclosures-courts",
            anchorLabel: "By court",
          }
        : null,
      investments != null && items
        ? {
            id: "items",
            figure: pct(sharePct(investments, items)),
            text: `of the ${int(items)} line items are in the investments section. Only counts of rows are shown, never what a report contains.`,
            anchor: "disclosures-sections",
            anchorLabel: "Line items",
          }
        : null,
    ],
    5,
  );
}

// -------------------------------------------------------------------------------------------- data coverage

export function schemaTakeaways(
  tables: readonly SchemaTableRow[],
  notInBulkTables: readonly string[],
): Takeaway[] {
  if (!tables.length) return [];
  const bulk = tables.filter((t) => t.bulk).length;
  const loaded = tables.filter((t) => t.load === "selected" || t.load === "all").length;
  const largest = [...tables]
    .filter((t) => t.rowsLoaded != null)
    .sort((a, b) => (b.rowsLoaded ?? 0) - (a.rowsLoaded ?? 0))[0];
  return usableTakeaways(
    [
      {
        id: "bulk",
        figure: `${int(bulk)} of ${int(tables.length)}`,
        text: "tables in CourtListener's published schema have a public bulk file; the rest cannot be derived from the bulk data.",
        anchor: "schema-tables",
        anchorLabel: "See the tables",
      },
      notInBulkTables.length
        ? {
            id: "not-in-bulk",
            figure: `${int(notInBulkTables.length)} tables`,
            text: "for attorneys, law firms, parties, their roles, docket entries and RECAP documents are in the schema but have no public bulk file, so no attorney or firm statistics can come from the bulk data.",
            anchor: "schema-not-in-bulk",
            anchorLabel: "What is missing",
          }
        : null,
      {
        id: "loaded",
        figure: int(loaded),
        text: `of the ${int(bulk)} tables with a bulk file are loaded in this project's copy (some with selected columns only).`,
        anchor: "schema-tables",
        anchorLabel: "See the tables",
      },
      largest?.rowsLoaded != null
        ? {
            id: "largest",
            figure: compact(largest.rowsLoaded),
            text: `rows are loaded for ${largest.table}, the largest loaded table.`,
            anchor: "schema-tables",
            anchorLabel: "See the tables",
          }
        : null,
    ],
    4,
  );
}
