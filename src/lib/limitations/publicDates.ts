/**
 * Public-date suggestions for the Time Limits calculators (pure model, no I/O).
 *
 * Dates come from corpus records the user picks by exact identifier: an MDL number, an FDA application or PMA number,
 * an FDA recall number, a CPSC recall number or an NHTSA campaign. They are suggestions only:
 *  - nothing is attached to an MDL, product or rule by name similarity;
 *  - a date reaches the calculator only when the user accepts it, and only into SUGGESTIBLE_FIELDS;
 *  - accepting goes through the calculators' own fact editors, which reset the legal confirmations;
 *  - no rule, source, coverage or manifest data is read or written here, and no period is computed.
 */

export const PUBLIC_DATE_KINDS = [
  "mdl",
  "drug_application",
  "device_pma",
  "fda_drug_recall",
  "fda_device_recall",
  "cpsc_recall",
  "nhtsa_recall",
] as const;
export type PublicDateKind = (typeof PUBLIC_DATE_KINDS)[number];

export const KIND_LABELS: Record<PublicDateKind, string> = {
  mdl: "MDL",
  drug_application: "FDA drug application",
  device_pma: "FDA device PMA",
  fda_drug_recall: "FDA drug recall",
  fda_device_recall: "FDA device recall",
  cpsc_recall: "CPSC recall",
  nhtsa_recall: "NHTSA recall",
};

/**
 * Exact identifier shapes, widened to every shape the corpus datasets publish (measured 2026-10-27): FDA recall
 * numbers of 2012-2016 such as D-723-2016 and Z-229-2014 and the few printed without the first hyphen; older PMAs
 * numbered N18033; CPSC numbers with a letter suffix such as 98167a; NHTSA campaigns such as 21V00D000. An identifier
 * still maps to one record id by exact equality. Anything else is a text search whose results the user must pick from.
 */
export const IDENTIFIER_PATTERNS: Record<PublicDateKind, RegExp> = {
  mdl: /^[1-9]\d{2,4}$/,
  drug_application: /^(NDA|ANDA|BLA)\d{5,6}$/,
  device_pma: /^(P\d{6}|N\d{4,6})$/,
  fda_drug_recall: /^D-?\d{3,5}-\d{1,5}$/,
  fda_device_recall: /^Z-?\d{3,5}-\d{1,5}$/,
  cpsc_recall: /^\d{5,6}[a-z]?$/,
  nhtsa_recall: /^\d{2}[VEITC]\d{2}[0-9A-Z]\d{3}$/,
};

export const IDENTIFIER_HINTS: Record<PublicDateKind, string> = {
  mdl: "MDL number, e.g. 2973",
  drug_application: "NDA, ANDA or BLA number, e.g. NDA020193",
  device_pma: "PMA number, e.g. P100047",
  fda_drug_recall: "FDA recall number, e.g. D-0042-2027",
  fda_device_recall: "FDA recall number, e.g. Z-1974-2021",
  cpsc_recall: "CPSC recall number, e.g. 73039",
  nhtsa_recall: "NHTSA campaign, e.g. 10V377000",
};

export const PUBLIC_DATE_DATASETS: Record<PublicDateKind, string> = {
  mdl: "mdl_intel_hearing_orders",
  drug_application: "agency_safety_openfda_drugsfda",
  device_pma: "agency_safety_openfda_device_pma",
  fda_drug_recall: "agency_safety_openfda_drug_enforcement",
  fda_device_recall: "agency_safety_openfda_device_enforcement",
  cpsc_recall: "agency_safety_cpsc_recalls_api",
  nhtsa_recall: "agency_safety_nhtsa_recalls",
};
export const MDLS_DATASET = "mdls";

/**
 * Strip spaces and set the case the dataset uses, so "nda 020193" and "z-1974-2021" match their exact shapes. CPSC
 * suffixes are lower-case in the corpus ids (cpsc-api:98167a), so a CPSC number is lower-cased instead.
 */
export function normalizeIdentifier(kind: PublicDateKind, q: string): string {
  const t = q.trim();
  if (kind === "mdl") return t.replace(/^mdl\s*(no\.?)?\s*/i, "");
  const compact = t.replace(/\s+/g, "");
  return kind === "cpsc_recall" ? compact.toLowerCase() : compact.toUpperCase();
}

/** The exact identifier the text is, or null when it is free text. */
export function exactIdentifier(kind: PublicDateKind, q: string): string | null {
  const id = normalizeIdentifier(kind, q);
  return IDENTIFIER_PATTERNS[kind].test(id) ? id : null;
}

/** The corpus record id an identifier maps to (PMA: the base record, whose supplements' ids extend it). */
export function recordIdFor(kind: PublicDateKind, identifier: string): string {
  switch (kind) {
    case "mdl":
      return identifier;
    case "drug_application":
      return `openfda:drug/drugsfda:${identifier}`;
    case "device_pma":
      return `openfda:device/pma:${identifier}`;
    case "fda_drug_recall":
      return `openfda:drug/enforcement:${identifier}`;
    case "fda_device_recall":
      return `openfda:device/enforcement:${identifier}`;
    case "cpsc_recall":
      return `cpsc-api:${identifier}`;
    case "nhtsa_recall":
      return identifier;
  }
}

/* ---------- candidates ---------- */

export type PublicDateEvent =
  | "jpml_transfer_order"
  | "fda_recall_initiated"
  | "fda_recall_classified"
  | "fda_enforcement_report_posted"
  | "fda_labeling_supplement_approved"
  | "pma_labeling_supplement_decision"
  | "cpsc_recall_notice"
  | "nhtsa_part573_received"
  | "nhtsa_owner_notification";

export const EVENT_LABELS: Record<PublicDateEvent, string> = {
  jpml_transfer_order: "JPML transfer order",
  fda_recall_initiated: "Recall initiated by the firm",
  fda_recall_classified: "FDA classified the recall",
  fda_enforcement_report_posted: "Posted in FDA's Enforcement Report",
  fda_labeling_supplement_approved: "Labeling supplement approved",
  pma_labeling_supplement_decision: "PMA labeling supplement decision",
  cpsc_recall_notice: "CPSC recall notice",
  nhtsa_part573_received: "Part 573 defect report date",
  nhtsa_owner_notification: "Owner notification date",
};

/** What each event does and does not mean, shown in the chip's About popover. */
export const EVENT_CAVEATS: Record<PublicDateEvent, string> = {
  jpml_transfer_order:
    "The date the Judicial Panel on Multidistrict Litigation centralized the cases. It is centralization, not a limitations trigger.",
  fda_recall_initiated:
    "The date the firm began the recall, as reported to FDA. It can come before any public notice.",
  fda_recall_classified:
    "The date FDA's center classified the recall (Class I, II or III). It is not the public notice date.",
  fda_enforcement_report_posted:
    "The date FDA posted the recall in its weekly Enforcement Report. Earlier public notices (the firm's announcement, FDA press or safety communications) may exist and are not recorded here.",
  fda_labeling_supplement_approved:
    "Drugs@FDA records an approved labeling supplement. What changed in the label is not recorded here, so this may be routine labeling.",
  pma_labeling_supplement_decision:
    "FDA's decision date on a PMA supplement whose reason is a labeling change. What changed is not recorded here.",
  cpsc_recall_notice: "The date CPSC lists for the recall notice.",
  nhtsa_part573_received:
    "The report date NHTSA records for the manufacturer's Part 573 defect or noncompliance report.",
  nhtsa_owner_notification:
    "The owner notification date NHTSA records for the campaign; owners may receive letters later.",
};

export type PublicDateCandidate = {
  /** Stable key: dataset, record id and event. */
  key: string;
  eventType: PublicDateEvent;
  date: string;
  label: string;
  sourceDataset: string;
  recordId: string;
  identifier: string;
  /** Link to the official page or file, or null ("Not recorded"). */
  officialUrl: string | null;
  /** "record": the record's own official page; "source_file": the official bulk file or API query the row came from. */
  urlKind: "record" | "source_file" | null;
  pdfUrl: string | null;
  publisher: string;
  basis: string;
  caveat: string;
  anomaly: string | null;
  /** Other records of the same event and date (e.g. a second GovInfo part of one transfer order), shown on the chip. */
  related?: { recordId: string; officialUrl: string | null; pdfUrl: string | null }[];
};

export type MdlProductAid = { label: string; kind: string | null; basis: string };

export type PublicDatesResult = {
  kind: PublicDateKind;
  identifier: string;
  title: string | null;
  candidates: PublicDateCandidate[];
  /** MDL only: products the JPML title names (an aid to open the application search; never attached automatically). */
  products: MdlProductAid[];
  /** Notes such as "no GovInfo transfer order in the corpus" or a date mismatch. */
  notes: string[];
  found: boolean;
};

export type PublicDateHit = {
  kind: PublicDateKind;
  identifier: string;
  label: string;
  date: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 600): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(s: string): string | null {
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
function day(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return validDay(iso[1]!);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return compact ? validDay(`${compact[1]}-${compact[2]}-${compact[3]}`) : null;
}
export function httpUrl(v: unknown): string | null {
  const s = str(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const OPENFDA = "U.S. Food and Drug Administration (openFDA)";
/** An FDA enforcement date earlier than this is shown as published, with a note. */
export const ENFORCEMENT_FLOOR = "2000-01-01";

/** Date-ordering checks for an FDA enforcement record. Records are shown as published, never corrected. */
export function enforcementAnomalies(dates: {
  initiation: string | null;
  classification: string | null;
  report: string | null;
}): string[] {
  const out: string[] = [];
  const { initiation, classification, report } = dates;
  if (initiation && initiation < ENFORCEMENT_FLOOR)
    out.push(`Recall initiation date ${initiation} is earlier than ${ENFORCEMENT_FLOOR}.`);
  if (initiation && report && initiation > report)
    out.push(`Recall initiation date ${initiation} is after the report date ${report}.`);
  if (initiation && classification && classification < initiation)
    out.push(`Classification date ${classification} is before the initiation date ${initiation}.`);
  return out;
}

function candidate(
  c: Omit<PublicDateCandidate, "key" | "caveat"> & { caveat?: string },
): PublicDateCandidate {
  return {
    ...c,
    caveat: c.caveat ?? EVENT_CAVEATS[c.eventType],
    key: `${c.sourceDataset}|${c.recordId}|${c.eventType}|${c.date}`,
  };
}

type Row = { id?: unknown; source_url?: unknown; item?: unknown; detail?: unknown };

/**
 * Transfer-order rows of mdl_intel_hearing_orders, kept only when order.mdl equals the MDL number exactly. GovInfo
 * publishes some orders in two parts (-0 and -1) with the same date; those collapse into one chip that prefers the
 * part with a signed date and lists the other part as related.
 */
export function parseTransferOrders(mdl: string, rows: readonly Row[]): PublicDateCandidate[] {
  const parts: { signed: boolean; c: PublicDateCandidate }[] = [];
  for (const row of rows) {
    const item = obj(row.item);
    const order = obj(item?.["order"]);
    const id = str(row.id, 200);
    if (!id || !order || str(order["mdl"], 10) !== mdl || order["kind"] !== "transfer_order")
      continue;
    const signed = day(order["signed_date"]);
    const issued = day(order["issued"]);
    const date = signed ?? issued;
    if (!date) continue;
    const details =
      httpUrl(row.source_url) ??
      httpUrl(
        arr(item?.["links"])
          .map(obj)
          .find((l) => /govinfo details/i.test(String(l?.["label"] ?? "")))?.["url"],
      );
    parts.push({
      signed: !!signed,
      c: candidate({
        eventType: "jpml_transfer_order",
        date,
        label: signed
          ? `Transfer order signed ${signed}`
          : `Transfer order, GovInfo issued date ${issued}`,
        sourceDataset: PUBLIC_DATE_DATASETS.mdl,
        recordId: id,
        identifier: `MDL ${mdl}`,
        officialUrl: details,
        urlKind: details ? "record" : null,
        pdfUrl: httpUrl(order["pdf"]),
        publisher: "Judicial Panel on Multidistrict Litigation (GovInfo)",
        basis: signed
          ? "Signed date printed on the order"
          : "GovInfo issued date (no signed date recorded)",
        anomaly: null,
      }),
    });
  }
  const byDate = new Map<string, { signed: boolean; c: PublicDateCandidate }[]>();
  for (const p of parts) byDate.set(p.c.date, [...(byDate.get(p.c.date) ?? []), p]);
  const out: PublicDateCandidate[] = [];
  for (const group of byDate.values()) {
    const [primary, ...rest] = [...group]
      .sort(
        (a, b) => Number(b.signed) - Number(a.signed) || a.c.recordId.localeCompare(b.c.recordId),
      )
      .map((p) => p.c);
    if (!primary) continue;
    out.push(
      rest.length
        ? {
            ...primary,
            related: rest.map((r) => ({
              recordId: r.recordId,
              officialUrl: r.officialUrl,
              pdfUrl: r.pdfUrl,
            })),
          }
        : primary,
    );
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** mdls row: title and date_transferred from the JPML pending-MDL report, used to corroborate the GovInfo order. */
export function parseMdlRow(row: Row | undefined): {
  title: string | null;
  dateTransferred: string | null;
  asOf: string | null;
} {
  const item = obj(row?.item);
  return {
    title: str(item?.["title"], 300),
    dateTransferred: day(item?.["date_transferred"]),
    asOf: day(item?.["as_of"]),
  };
}

/** MDL candidates plus corroboration notes. A disagreement shows both dates; neither is corrected. */
export function mdlPublicDates(
  mdl: string,
  orderRows: readonly Row[],
  mdlRow: Row | undefined,
): { candidates: PublicDateCandidate[]; notes: string[]; title: string | null } {
  const orders = parseTransferOrders(mdl, orderRows);
  const pending = parseMdlRow(mdlRow);
  const notes: string[] = [];
  const candidates = [...orders];
  const orderTitle = orderRows
    .map((r) => obj(obj(r.item)?.["order"]))
    .find((o) => str(o?.["mdl"], 10) === mdl);
  const title = pending.title ?? str(orderTitle?.["title"], 300);
  if (pending.dateTransferred) {
    if (!orders.length) {
      notes.push(
        "No GovInfo transfer order for this MDL is in the corpus; the date comes from the JPML pending-MDL report.",
      );
      candidates.push(
        candidate({
          eventType: "jpml_transfer_order",
          date: pending.dateTransferred,
          label: `Date transferred ${pending.dateTransferred} (JPML pending-MDL report${pending.asOf ? ` as of ${pending.asOf}` : ""})`,
          sourceDataset: MDLS_DATASET,
          recordId: mdl,
          identifier: `MDL ${mdl}`,
          officialUrl: null,
          urlKind: null,
          pdfUrl: null,
          publisher: "Judicial Panel on Multidistrict Litigation",
          basis: "date_transferred in the JPML pending-MDL report",
          anomaly: null,
        }),
      );
    } else if (!orders.some((o) => o.date === pending.dateTransferred)) {
      notes.push(
        `The JPML pending-MDL report gives ${pending.dateTransferred}; the GovInfo order gives ${orders.map((o) => o.date).join(", ")}. Both are shown as published.`,
      );
      for (const o of orders)
        o.anomaly = `Differs from the JPML report's date transferred (${pending.dateTransferred}).`;
    }
  }
  if (!candidates.length)
    notes.push(
      "No centralization date is recorded for this MDL. The corpus holds the pending MDLs and GovInfo orders from 2010-10-08.",
    );
  return { candidates, notes, title };
}

export function parseMdlProducts(raw: unknown): MdlProductAid[] {
  const seen = new Set<string>();
  const out: MdlProductAid[] = [];
  for (const r of arr(raw)) {
    const o = obj(r);
    const label = str(o?.["label"], 160);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ label, kind: str(o?.["kind"], 40), basis: str(o?.["basis"], 80) ?? "Not recorded" });
  }
  return out;
}

function sourceFile(detail: Obj | null): string | null {
  return httpUrl(obj(detail?.["original_file"])?.["final_url"]);
}

/** FDA enforcement record (drug or device): the three dates as published, with ordering anomalies noted. */
export function parseEnforcement(
  kind: "fda_drug_recall" | "fda_device_recall",
  row: Row | undefined,
): { candidates: PublicDateCandidate[]; title: string | null } {
  const item = obj(row?.item);
  const id = str(row?.id, 200);
  if (!item || !id) return { candidates: [], title: null };
  const dates = obj(item["dates"]);
  const identifier = str(item["native_id"], 40) ?? id.split(":").pop() ?? id;
  const initiation = day(dates?.["recall_initiation_date"]);
  const classification = day(dates?.["center_classification_date"]);
  const report = day(dates?.["report_date"]);
  const anomalies = enforcementAnomalies({ initiation, classification, report });
  const own = httpUrl(row?.source_url);
  const file = sourceFile(obj(row?.detail));
  const base = {
    sourceDataset: PUBLIC_DATE_DATASETS[kind],
    recordId: id,
    identifier,
    officialUrl: own ?? file,
    urlKind: own ? ("record" as const) : file ? ("source_file" as const) : null,
    pdfUrl: null,
    publisher: OPENFDA,
    anomaly: anomalies.length ? anomalies.join(" ") : null,
  };
  const out: PublicDateCandidate[] = [];
  if (initiation)
    out.push(
      candidate({
        ...base,
        eventType: "fda_recall_initiated",
        date: initiation,
        label: `Recall ${identifier} initiated ${initiation}`,
        basis: "recall_initiation_date",
      }),
    );
  if (classification)
    out.push(
      candidate({
        ...base,
        eventType: "fda_recall_classified",
        date: classification,
        label: `Recall ${identifier} classified ${classification}`,
        basis: "center_classification_date",
      }),
    );
  if (report)
    out.push(
      candidate({
        ...base,
        eventType: "fda_enforcement_report_posted",
        date: report,
        label: `Recall ${identifier} in the Enforcement Report ${report}`,
        basis: "report_date",
      }),
    );
  return { candidates: out, title: str(item["title"], 300) };
}

/** Drugs@FDA application: approved (AP) LABELING supplements only. What changed is not recorded. */
export function parseDrugsFdaLabeling(row: Row | undefined): {
  candidates: PublicDateCandidate[];
  title: string | null;
} {
  const detail = obj(row?.detail);
  const id = str(row?.id, 200);
  if (!detail || !id) return { candidates: [], title: null };
  const application = str(detail["native_id"], 20) ?? id.split(":").pop() ?? id;
  const file = sourceFile(detail);
  const out: PublicDateCandidate[] = [];
  for (const s of arr(detail["submissions"])) {
    const o = obj(s);
    if (!o) continue;
    if (
      str(o["submission_class_code"], 40) !== "LABELING" ||
      str(o["submission_status"], 10) !== "AP"
    )
      continue;
    const date = day(o["submission_status_date"]) ?? day(o["submission_status_date_raw"]);
    const number = str(o["submission_number"], 10);
    if (!date || !number) continue;
    const supplement = `S-${number.padStart(3, "0")}`;
    out.push(
      candidate({
        eventType: "fda_labeling_supplement_approved",
        date,
        label: `${supplement} approved ${date} — what changed is not recorded here`,
        sourceDataset: PUBLIC_DATE_DATASETS.drug_application,
        recordId: `${id}#${supplement}`,
        identifier: `${application} ${supplement}`,
        officialUrl: file,
        urlKind: file ? "source_file" : null,
        pdfUrl: null,
        publisher: OPENFDA,
        basis: "submission_status_date of an approved LABELING supplement",
        anomaly: null,
      }),
    );
  }
  return {
    candidates: out.sort((a, b) => b.date.localeCompare(a.date)),
    title: str(obj(row?.item)?.["title"], 300),
  };
}

/**
 * Device PMA supplements whose recorded reason starts with "Labeling Change". The base record (id without a
 * supplement suffix) gives the title only; a PMA held without supplements is found but has no candidates.
 */
export function parsePmaLabeling(
  pma: string,
  rows: readonly Row[],
): { candidates: PublicDateCandidate[]; title: string | null; found: boolean } {
  const out: PublicDateCandidate[] = [];
  const baseId = `openfda:device/pma:${pma}`;
  let baseTitle: string | null = null;
  let supplementTitle: string | null = null;
  let found = false;
  for (const row of rows) {
    const id = str(row.id, 200);
    const item = obj(row.item);
    if (!id || !item) continue;
    if (id === baseId) {
      found = true;
      baseTitle = baseTitle ?? str(item["title"], 300);
      continue;
    }
    if (!id.startsWith(`${baseId}:`)) continue;
    found = true;
    supplementTitle = supplementTitle ?? str(item["title"], 300);
    const reason = str(item["snippet"], 300);
    if (!reason || !/^Labeling Change/i.test(reason)) continue;
    const date = day(obj(item["dates"])?.["decision_date"]);
    if (!date) continue;
    const native = str(item["native_id"], 40) ?? id.slice(`openfda:device/pma:`.length);
    const file = sourceFile(obj(row.detail));
    out.push(
      candidate({
        eventType: "pma_labeling_supplement_decision",
        date,
        label: `${native} decision ${date} — ${reason}; what changed is not recorded here`,
        sourceDataset: PUBLIC_DATE_DATASETS.device_pma,
        recordId: id,
        identifier: native,
        officialUrl: file,
        urlKind: file ? "source_file" : null,
        pdfUrl: null,
        publisher: OPENFDA,
        basis: "decision_date of a supplement whose reason is a labeling change",
        anomaly: null,
      }),
    );
  }
  return {
    candidates: out.sort((a, b) => b.date.localeCompare(a.date)),
    title: baseTitle ?? supplementTitle,
    found,
  };
}

export function parseCpscRecall(row: Row | undefined): {
  candidates: PublicDateCandidate[];
  title: string | null;
} {
  const item = obj(row?.item);
  const id = str(row?.id, 200);
  if (!item || !id) return { candidates: [], title: null };
  const cells = obj(item["cells"]);
  const recall = obj(item["recall"]);
  const date = day(obj(item["dates"])?.["date"]) ?? day(cells?.["date"]) ?? day(recall?.["date"]);
  const number = str(cells?.["recall_number"], 20) ?? id.replace(/^cpsc-api:/, "");
  const url = httpUrl(row?.source_url) ?? httpUrl(recall?.["url"]);
  return {
    title: str(item["title"], 300),
    candidates: date
      ? [
          candidate({
            eventType: "cpsc_recall_notice",
            date,
            label: `CPSC recall ${number}, ${date}`,
            sourceDataset: PUBLIC_DATE_DATASETS.cpsc_recall,
            recordId: id,
            identifier: number,
            officialUrl: url,
            urlKind: url ? "record" : null,
            pdfUrl: null,
            publisher: "U.S. Consumer Product Safety Commission",
            basis: "Recall date",
            anomaly: null,
          }),
        ]
      : [],
  };
}

export function parseNhtsaRecall(row: Row | undefined): {
  candidates: PublicDateCandidate[];
  title: string | null;
} {
  const item = obj(row?.item);
  const id = str(row?.id, 40);
  if (!item || !id) return { candidates: [], title: null };
  const recall = obj(item["recall"]);
  const url = httpUrl(row?.source_url);
  const report = day(recall?.["report_date"]);
  const notice = day(recall?.["owner_notice"]);
  const anomaly =
    report && notice && notice < report
      ? `Owner notification ${notice} is before the report date ${report}.`
      : null;
  const base = {
    sourceDataset: PUBLIC_DATE_DATASETS.nhtsa_recall,
    recordId: id,
    identifier: id,
    officialUrl: url,
    urlKind: url ? ("record" as const) : null,
    pdfUrl: null,
    publisher: "National Highway Traffic Safety Administration",
    anomaly,
  };
  const out: PublicDateCandidate[] = [];
  if (report)
    out.push(
      candidate({
        ...base,
        eventType: "nhtsa_part573_received",
        date: report,
        label: `Campaign ${id}: Part 573 report ${report}`,
        basis: "report_date",
      }),
    );
  if (notice)
    out.push(
      candidate({
        ...base,
        eventType: "nhtsa_owner_notification",
        date: notice,
        label: `Campaign ${id}: owner notification ${notice}`,
        basis: "owner_notice",
      }),
    );
  return { candidates: out, title: str(item["title"], 300) };
}

/** A text-search row as a pickable hit. Only rows whose identifier has the exact shape are offered. */
export function parseHit(kind: PublicDateKind, row: unknown): PublicDateHit | null {
  const r = obj(row);
  const item = obj(r?.["item"]);
  if (!r || !item) return null;
  let identifier: string | null;
  let label: string | null = str(item["title"], 240) ?? str(r["title"], 240);
  let date: string | null;
  if (kind === "mdl") {
    const order = obj(item["order"]);
    identifier = str(order?.["mdl"], 10) ?? str(item["mdl_number"], 10);
    label = str(order?.["title"], 240) ?? str(item["title"], 240);
    date = day(order?.["signed_date"]) ?? day(order?.["issued"]) ?? day(item["date_transferred"]);
  } else if (kind === "device_pma") {
    identifier = (str(item["native_id"], 40) ?? "").split(":")[0] ?? null;
    date = null;
  } else if (kind === "cpsc_recall") {
    identifier = str(obj(item["cells"])?.["recall_number"], 20);
    date = day(obj(item["cells"])?.["date"]);
  } else if (kind === "nhtsa_recall") {
    identifier = str(r["id"], 20);
    date = day(obj(item["recall"])?.["report_date"]) ?? day(obj(item["cells"])?.["date"]);
  } else {
    identifier = str(item["native_id"], 40);
    date = day(item["sort_date"]);
  }
  if (!identifier || !IDENTIFIER_PATTERNS[kind].test(identifier) || !label) return null;
  return { kind, identifier, label, date };
}

export function dedupeHits(hits: readonly (PublicDateHit | null)[]): PublicDateHit[] {
  const seen = new Set<string>();
  const out: PublicDateHit[] = [];
  for (const h of hits) {
    if (!h || seen.has(h.identifier)) continue;
    seen.add(h.identifier);
    out.push(h);
  }
  return out;
}

/* ---------- calculator binding ---------- */

/**
 * The only calculator fields a public date may be accepted into. Actual discovery, injury, death, diagnosis,
 * exposure, delivery and repose dates are personal or product-event facts and are never suggestible.
 */
export const SUGGESTIBLE_FIELDS = [
  "constructiveDiscoveryDate",
  "accrualDate",
  "causeDiscoveryDate",
] as const;
export type SuggestibleField = (typeof SUGGESTIBLE_FIELDS)[number];

export function isSuggestibleField(key: string): key is SuggestibleField {
  return (SUGGESTIBLE_FIELDS as readonly string[]).includes(key);
}

/** Claims the picker is offered for. */
export const PICKER_CLAIMS = [
  "product_liability",
  "personal_injury",
  "wrongful_death",
  "breach_of_warranty",
] as const;

/** The picker is offered only for injury, product and warranty claims. */
export function pickerApplies(claim: string | undefined): boolean {
  return !!claim && (PICKER_CLAIMS as readonly string[]).includes(claim);
}

/**
 * The rule's own date fields that may receive a suggestion. An accrual field measured from death is a personal fact
 * and is excluded.
 */
export function suggestibleFields<F extends { key: string; label: string }>(
  rule: { accrualBasis: string } | null,
  fields: readonly F[],
): (F & { key: SuggestibleField })[] {
  if (!rule) return [];
  const deathBased = rule.accrualBasis === "death" || rule.accrualBasis === "discovery_of_death";
  return fields.filter(
    (f): f is F & { key: SuggestibleField } =>
      isSuggestibleField(f.key) && !(f.key === "accrualDate" && deathBased),
  );
}

/** True when the date is later than the rule's source review date; the engine would withhold a result. */
export function isAfterReviewCutoff(date: string, cutoff: string | null): boolean {
  return !!cutoff && ISO_DAY.test(date) && date > cutoff;
}

export type AcceptedPublicDate = {
  field: SuggestibleField;
  date: string;
  eventType: PublicDateEvent;
  event: string;
  identifier: string;
  sourceDataset: string;
  recordId: string;
  publisher: string;
  officialUrl: string | null;
  urlKind: PublicDateCandidate["urlKind"];
  acceptedBy: "user";
};

export function acceptCandidate(
  field: SuggestibleField,
  c: PublicDateCandidate,
): AcceptedPublicDate {
  return {
    field,
    date: c.date,
    eventType: c.eventType,
    event: EVENT_LABELS[c.eventType],
    identifier: c.identifier,
    sourceDataset: c.sourceDataset,
    recordId: c.recordId,
    publisher: c.publisher,
    officialUrl: c.officialUrl,
    urlKind: c.urlKind,
    acceptedBy: "user",
  };
}

export type AcceptedPublicDates = Partial<Record<SuggestibleField, AcceptedPublicDate>>;

/** Provenance survives only while the field still holds the accepted date; an edited field drops it. */
export function currentAccepted(
  accepted: AcceptedPublicDates,
  input: Partial<Record<SuggestibleField, string | undefined>>,
): AcceptedPublicDate[] {
  return SUGGESTIBLE_FIELDS.flatMap((field) => {
    const a = accepted[field];
    return a && a.field === field && input[field] === a.date ? [a] : [];
  });
}

/** The export record of each accepted suggestion: dataset, record id, identifier, event type and accepted field. */
export function exportAccepted(list: readonly AcceptedPublicDate[] | undefined) {
  return (list ?? []).map((a) => ({
    acceptedField: a.field,
    date: a.date,
    eventType: a.eventType,
    identifier: a.identifier,
    dataset: a.sourceDataset,
    recordId: a.recordId,
    publisher: a.publisher,
    url: a.officialUrl,
    acceptedBy: a.acceptedBy,
  }));
}
