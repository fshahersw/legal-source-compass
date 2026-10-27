// Pure per-MDL assembly of the de-dockets packet (no I/O), so the rules that protect the data can be tested:
//   * DocketBird rows above the highest published entry number; oldest-window rows held back when a gap separates them from the newest window;
//   * CourtListener rows deduplicated against published ids and against the DocketBird rows of the same packet;
//   * gap arithmetic (filled / still missing), partial months, and the sw_matters_v1 patch (cells, registry.entries captures, entry facts),
//     each guarded by the values read before the packet was built.
import { makeEntryRecord } from "../members-entry-record.mjs";
import {
  sheetEntries,
  selectNew,
  gapAfterPublished,
  docketbirdEntryRecord,
  tally,
} from "./entries-packet.mjs";

const month = (d) => (typeof d === "string" && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
const range = (r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`);
const isoDay = (ts) => (typeof ts === "string" ? ts.slice(0, 10) : "date not recorded");

/** Gap between the oldest and the newest provider window (null when they meet or only one order was read). */
export function windowGap(windows) {
  const chrono = windows.filter((w) => w.sort === "chronological" && w.max_number != null);
  const recent = windows.filter((w) => w.sort === "recent" && w.min_number != null);
  if (!chrono.length || !recent.length) return null;
  const hi = Math.max(...chrono.map((w) => w.max_number));
  const lo = Math.min(...recent.map((w) => w.min_number));
  return lo > hi + 1 ? { from: hi + 1, to: lo - 1 } : null;
}

/**
 * Splits new DocketBird entries into rows to publish and rows held back. When the oldest and the newest window leave a gap, the oldest-window
 * entries are held by default: published alone, a monthly series would read the multi-year gap as months without filings. A text entry is
 * placed by the entry it follows.
 */
export function splitOldestWindow(entries, windows, { includeOldest = false } = {}) {
  const gap = windowGap(windows);
  if (!gap || includeOldest) return { publish: entries, held: [], gap };
  return {
    publish: entries.filter((e) => e.anchor > gap.to),
    held: entries.filter((e) => e.anchor <= gap.to),
    gap,
  };
}

/** Months a monthly series must show as partial because a recorded gap cuts into them (yyyy-mm, sorted). */
export function partialMonths({ windows, gaps, publishedMaxDate, oldestPublished }) {
  const out = new Set();
  const recentStart =
    windows
      .filter((w) => w.sort === "recent" && w.min_date)
      .map((w) => w.min_date)
      .sort()[0] ?? null;
  const chronoEnds = windows
    .filter((w) => w.sort === "chronological" && w.max_date)
    .map((w) => w.max_date);
  for (const g of gaps) {
    if (g.kind === "between_oldest_and_newest_window") {
      if (month(recentStart)) out.add(month(recentStart));
      if (oldestPublished) for (const d of chronoEnds) out.add(month(d));
    } else if (g.kind === "between_published_and_newest_window" && (g.still_missing ?? 1) > 0) {
      const a = month(publishedMaxDate);
      const b = month(recentStart);
      if (a && b) {
        let [y, m] = a.split("-").map(Number);
        for (let k = 0; k < 600; k++) {
          const s = `${y}-${String(m).padStart(2, "0")}`;
          out.add(s);
          if (s >= b) break;
          m++;
          if (m > 12) {
            m = 1;
            y++;
          }
        }
      }
    } else if (g.kind === "older_than_newest_window" && month(recentStart))
      out.add(month(recentStart));
  }
  return [...out].filter(Boolean).sort();
}

/** registry.entries capture for the DocketBird rows of one master docket (always partial: only provider windows were read). */
export function docketbirdCapture({
  ctx,
  windows,
  gaps,
  published,
  held,
  prevRows,
  run,
  includeOldest,
  publishedMaxDate,
}) {
  const observedAt =
    windows
      .map((w) => w.retrieved_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const split = gaps.some((g) => g.kind === "between_oldest_and_newest_window");
  const read = windows.map((w) => ({
    order: w.sort === "recent" ? "newest" : "oldest",
    entry_numbers: w.min_number != null ? { from: w.min_number, to: w.max_number } : null,
    filed: { from: w.min_date, to: w.max_date },
    provider_documents_returned: w.entries_returned,
    published: w.sort === "recent" || includeOldest || !split,
  }));
  const oldestPublished = read.some((w) => w.order === "oldest" && w.published);
  const months = partialMonths({ windows, gaps, publishedMaxDate, oldestPublished });
  const total = windows.find((w) => Number.isInteger(w.entries_total))?.entries_total ?? null;
  const readText = read
    .map(
      (w) =>
        `${w.order} window, entries ${w.entry_numbers ? range(w.entry_numbers) : "not numbered"}, filed ${w.filed.from ?? "?"} to ${w.filed.to ?? "?"}${w.published ? "" : ", held back"}`,
    )
    .join("; ");
  const gapText = gaps
    .filter((g) => g.entry_numbers)
    .map(
      (g) =>
        `entries ${range(g.entry_numbers)} are not recorded${g.still_missing != null ? ` (${g.still_missing} still missing after CourtListener)` : ""}`,
    );
  return {
    provider: "docketbird",
    docket_key: ctx.docket_key,
    captured: prevRows + published,
    provider_total: null,
    complete: false,
    observed_at: observedAt,
    refresh_run: run,
    recent_records: published,
    coverage: {
      unit: "docket entry",
      windows: read,
      gaps,
      held_back_rows: held,
      partial_months: months,
      provider_documents_total: total,
    },
    qualification: [
      `Partial: rows published from the DocketBird docket sheet as read on ${isoDay(observedAt)} (${readText}).`,
      gapText.length ? `${gapText.join("; ").replace(/^e/, "E")}.` : null,
      months.length ? `Partial months: ${months.join(", ")}.` : null,
      prevRows > 0
        ? `The ${prevRows} DocketBird rows published earlier on this docket are one row per document (attachments and text entries apart); these are one row per entry.`
        : null,
      total != null
        ? `The provider lists ${total} documents for the docket, attachments and text entries included; that is not an entry total.`
        : null,
      "Not a complete docket census.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** registry.entries capture for the CourtListener rows of one master docket after an incremental pass. */
export function courtlistenerCapture({
  ctx,
  clDocketId,
  prevRows,
  added,
  fetched,
  since,
  untexted,
  observedAt,
  run,
}) {
  return {
    provider: "courtlistener",
    docket_key: ctx.docket_key,
    cl_docket_id: clDocketId ?? null,
    captured: prevRows + added,
    provider_total: null,
    complete: false,
    observed_at: observedAt,
    refresh_run: run,
    recent_records: fetched,
    coverage: {
      unit: "docket entry",
      filed_on_or_after: since,
      added_rows: added,
      added_rows_without_text: untexted,
    },
    qualification: `Partial incremental refresh: CourtListener docket entries filed on or after ${since}, read ${isoDay(observedAt)} (${fetched} entries read, ${added} new rows, ${untexted} of them with no docket text in RECAP). Not a complete docket census; the provider total was not checked.`,
  };
}

export const FACT_CL = "Docket entries captured / provider total (CourtListener)";
export const FACT_DB = "Docket entries captured (DocketBird docket sheet)";

/**
 * Builds everything one master docket contributes to the packet.
 *   t        master target (master-targets file)
 *   before   before snapshot {dataset, matter_cells, matter_registry, existing_courtlistener_ids_since_max_date}
 *   caps     landed DocketBird captures of the target's case; clRows: collected CourtListener lake-shaped rows of the MDL
 *   entryEnv env of makeEntryRecord ({run, SCHEMA, DS_ENTRIES, finish, masterLink, matterLink, clDocketUrl})
 * Returns {rows, releaseRows, heldRows, manifest, matter}.
 */
export function assembleMdl({
  t,
  before,
  caps = [],
  clRows = [],
  run,
  includeOldest = false,
  seenIds = new Set(),
  entryEnv,
}) {
  const ctx = {
    mdl: t.mdl,
    docket_key: t.docket_key,
    docket_number: t.entries_docket_number ?? t.docket_number,
    court_id: t.court_id,
    docketbird_case_id: t.docketbird_case_id,
  };
  const b = before.dataset[t.mdl];
  const providerRows = b.provider_rows ?? {};
  const maxNum =
    b.max_entry_number !== undefined ? b.max_entry_number : (t.before?.max_entry_number ?? null);
  const m = {
    before: { rows: b.rows, max_date: b.max_date, withheld: b.w_text + b.w_doc + b.w_contact },
    sources: {},
    added: null,
    after: null,
    gaps: [],
    held_back: null,
  };
  const rows = [];
  const releaseRows = [];
  const heldRows = [];
  const captures = [];
  const facts = [];
  let dbWindows = [];
  // DocketBird
  if (caps.length) {
    const { entries, windows, stats } = sheetEntries(caps);
    dbWindows = windows;
    const fresh = selectNew(entries, maxNum);
    const { publish, held, gap } = splitOldestWindow(fresh, windows, { includeOldest });
    for (const e of publish) {
      const { rec } = docketbirdEntryRecord(e, ctx, { run });
      if (seenIds.has(rec.id)) continue;
      seenIds.add(rec.id);
      rows.push(rec);
      const alt = docketbirdEntryRecord(e, ctx, { run, releaseTextMentions: true }).rec;
      if (alt.item.cells.description_withheld !== rec.item.cells.description_withheld)
        releaseRows.push(alt);
    }
    for (const e of held) heldRows.push(docketbirdEntryRecord(e, ctx, { run }).rec);
    const pubGap = gapAfterPublished(windows, maxNum);
    if (pubGap)
      m.gaps.push({
        provider: "docketbird",
        kind: "between_published_and_newest_window",
        entry_numbers: pubGap,
      });
    if (gap)
      m.gaps.push({
        provider: "docketbird",
        kind: "between_oldest_and_newest_window",
        entry_numbers: gap,
      });
    if (
      !windows.some((w) => w.sort === "chronological") &&
      maxNum == null &&
      !windows.some((w) => w.min_number === 1)
    )
      m.gaps.push({
        provider: "docketbird",
        kind: "older_than_newest_window",
        note: "only the newest window was read",
      });
    if (held.length)
      m.held_back = {
        rows: held.length,
        reason:
          "oldest window separated from the newest window by a gap; held so a monthly series does not read the gap as months without filings",
        entry_numbers: {
          from: Math.min(...held.map((e) => e.anchor)),
          to: Math.max(...held.map((e) => e.anchor)),
        },
      };
    m.sources.docketbird = {
      case_id: t.docketbird_case_id,
      basis: t.docketbird_basis,
      windows,
      stats,
      entries_in_windows: entries.length,
      new_entries: fresh.length,
      published_entries: rows.length,
    };
  } else {
    m.sources.docketbird = {
      case_id: t.docketbird_case_id,
      windows: [],
      note: "no capture: the connector did not answer for this docket (timed out)",
    };
  }
  const dbAdded = rows.length;
  // CourtListener (incremental collection)
  let clAdded = 0;
  if (clRows.length) {
    const existing = new Set(before.existing_courtlistener_ids_since_max_date?.[t.mdl] ?? []);
    // An entry already added from the DocketBird sheet (same docket, same entry number) is not added twice; an unnumbered CourtListener entry
    // is added only when it is older than the first DocketBird row added for the MDL (from that date on the sheet's text entries stand for it).
    const dbNumbers = new Set(
      rows.filter((r) => r.item.cells.entry_number != null).map((r) => r.item.cells.entry_number),
    );
    const dbRecentMin =
      rows
        .map((r) => r.item.cells.date_filed)
        .filter(Boolean)
        .sort()[0] ?? null;
    let skippedOverlap = 0;
    let alreadyPublished = 0;
    let untexted = 0;
    for (const r of clRows) {
      if (existing.has(r.native_id)) {
        alreadyPublished++;
        continue;
      }
      const n = Number.isInteger(r.data.entry_number) ? r.data.entry_number : null;
      if (
        (n != null && dbNumbers.has(n)) ||
        (n == null && dbRecentMin && (r.data.date_filed ?? "9999") >= dbRecentMin)
      ) {
        skippedOverlap++;
        continue;
      }
      const { rec } = makeEntryRecord(r, { ...ctx, no_registry_links: false }, entryEnv);
      if (seenIds.has(rec.id)) {
        alreadyPublished++;
        continue;
      }
      seenIds.add(rec.id);
      rows.push(rec);
      clAdded++;
      if (!rec.item.cells.description && !rec.item.cells.description_withheld) untexted++;
    }
    const dates = clRows
      .map((r) => r.data.date_filed)
      .filter(Boolean)
      .sort();
    m.sources.courtlistener = {
      docket: t.cl_docket_ids[0],
      fetched: clRows.length,
      already_published: alreadyPublished,
      overlapping_docketbird: skippedOverlap,
      new_entries: clAdded,
      new_entries_without_text: untexted,
      dates: [dates[0] ?? null, dates.at(-1) ?? null],
    };
    const g = m.gaps.find((x) => x.kind === "between_published_and_newest_window");
    if (g) {
      const got = new Set(
        rows
          .filter(
            (r) => r.item.cells.provider === "courtlistener" && r.item.cells.entry_number != null,
          )
          .map((r) => r.item.cells.entry_number),
      );
      let missing = 0;
      for (let k = g.entry_numbers.from; k <= g.entry_numbers.to; k++) if (!got.has(k)) missing++;
      g.filled_from_courtlistener = g.entry_numbers.to - g.entry_numbers.from + 1 - missing;
      g.still_missing = missing;
    }
    if (clAdded) {
      const observedAt =
        clRows
          .map((r) => r.retrieved_at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
      const capture = courtlistenerCapture({
        ctx,
        clDocketId: t.cl_docket_ids[0],
        prevRows: providerRows.courtlistener ?? 0,
        added: clAdded,
        fetched: clRows.length,
        since: b.max_date,
        untexted,
        observedAt,
        run,
      });
      captures.push(capture);
      facts.push([
        FACT_CL,
        `${capture.captured} published; ${clAdded} added in an incremental pass (filed on or after ${b.max_date}, read ${isoDay(observedAt)}, ${untexted} without docket text); provider total not checked`,
      ]);
    }
  }
  if (dbAdded) {
    const capture = docketbirdCapture({
      ctx,
      windows: dbWindows,
      gaps: m.gaps.filter((g) => g.provider === "docketbird"),
      published: dbAdded,
      held: heldRows.length,
      prevRows: providerRows.docketbird ?? 0,
      run,
      includeOldest,
      publishedMaxDate: b.max_date,
    });
    captures.unshift(capture);
    const ranges = capture.coverage.windows
      .filter((w) => w.published && w.entry_numbers)
      .map((w) => range(w.entry_numbers));
    facts.push([
      FACT_DB,
      `${capture.captured} published from the windows read ${isoDay(capture.observed_at)} (entries ${ranges.join(" and ") || "not numbered"}); not the whole docket`,
    ]);
  }
  const addedTally = tally(rows);
  m.added = { ...addedTally, docketbird: dbAdded, courtlistener: clAdded };
  m.after = {
    rows: b.rows + addedTally.rows,
    withheld: m.before.withheld + addedTally.withheld,
    max_date: [b.max_date, addedTally.max_date].filter(Boolean).sort().at(-1) ?? null,
  };
  m.optional_release = {
    docketbird_rows_changed: releaseRows.length,
    courtlistener_text_withheld_ids: rows
      .filter(
        (r) =>
          r.item.cells.provider === "courtlistener" &&
          r.item.cells.description_withheld === "sealed_or_restricted_text",
      )
      .map((r) => r.id),
  };
  // sw_matters_v1 patch: cells always (they are stale against their dataset); captures and entry facts only where rows were added.
  let matter = null;
  const cellsBefore = before.matter_cells?.[t.mdl];
  if (cellsBefore) {
    const stored = before.matter_registry?.[t.mdl] ?? { captures: [], entry_facts: [] };
    const registry_entries = captures.map((set) => {
      const prev = stored.captures.find(
        (c) => c.provider === set.provider && c.docket_key === set.docket_key,
      );
      return {
        match: prev ? { captured: prev.captured, observed_at: prev.observed_at ?? null } : null,
        set,
      };
    });
    let entryFacts = null;
    if (facts.length) {
      const kept = stored.entry_facts.filter((f) => !facts.some((n) => n[0] === f[0]));
      entryFacts = { expected: stored.entry_facts, set: [...kept, ...facts] };
    }
    matter = {
      id: `sw-matter:${t.mdl}`,
      run,
      expected_before: cellsBefore,
      set: { entries_published: m.after.rows, entries_withheld: m.after.withheld },
      registry_entries,
      entry_facts: entryFacts,
    };
  }
  return { rows, releaseRows, heldRows, manifest: m, matter };
}

const isEntryFact = (f) => String(f?.[0] ?? "").startsWith("Docket entries captured");

/**
 * Applies one matter patch to a stored sw_matters_v1 record (pure). Returns {state: 'apply', item, detail} | {state: 'done'} when this run
 * already applied it | {state: 'stale', reason} when the stored record no longer holds the values the packet was built against.
 */
export function composeMatterPatch(stored, p) {
  const cells = stored.item?.cells ?? {};
  const entries = Array.isArray(stored.detail?.registry?.entries)
    ? stored.detail.registry.entries
    : [];
  const factsNow = Array.isArray(stored.detail?.facts) ? stored.detail.facts : [];
  const cellsAre = (o) => Object.entries(o).every(([k, v]) => (cells[k] ?? null) === v);
  const capturesApplied = p.registry_entries.every((r) =>
    entries.some(
      (e) =>
        e.provider === r.set.provider &&
        e.docket_key === r.set.docket_key &&
        e.refresh_run === p.run &&
        e.captured === r.set.captured,
    ),
  );
  if (cellsAre(p.set) && capturesApplied) return { state: "done" };
  if (!cellsAre(p.expected_before))
    return { state: "stale", reason: "stored cells changed since the packet was built" };
  const nextEntries = [...entries];
  for (const r of p.registry_entries) {
    const i = nextEntries.findIndex(
      (e) => e.provider === r.set.provider && e.docket_key === r.set.docket_key,
    );
    if (r.match == null) {
      if (i >= 0)
        return {
          state: "stale",
          reason: `a ${r.set.provider} capture appeared since the packet was built`,
        };
      nextEntries.push(r.set);
      continue;
    }
    if (i < 0) return { state: "stale", reason: `the ${r.set.provider} capture is gone` };
    const e = nextEntries[i];
    if (e.captured !== r.match.captured || (e.observed_at ?? null) !== r.match.observed_at)
      return {
        state: "stale",
        reason: `the ${r.set.provider} capture changed since the packet was built`,
      };
    nextEntries[i] = { ...r.set, previous_snapshot: e };
  }
  let nextFacts = factsNow;
  if (p.entry_facts) {
    const current = factsNow.filter(isEntryFact);
    if (JSON.stringify(current) !== JSON.stringify(p.entry_facts.expected))
      return { state: "stale", reason: "the entry facts changed since the packet was built" };
    const at = factsNow.findIndex(isEntryFact);
    const rest = factsNow.filter((f) => !isEntryFact(f));
    nextFacts =
      at < 0
        ? [...rest, ...p.entry_facts.set]
        : [...rest.slice(0, at), ...p.entry_facts.set, ...rest.slice(at)];
  }
  return {
    state: "apply",
    item: { ...stored.item, cells: { ...cells, ...p.set } },
    detail: {
      ...stored.detail,
      facts: nextFacts,
      registry: { ...(stored.detail?.registry ?? {}), entries: nextEntries },
    },
  };
}
