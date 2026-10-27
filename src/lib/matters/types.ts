/** Payload shapes shared by the matter server functions and the matter UI (no server code lives here). */
import type { MdlLens } from "@/lib/external/mdlLens.functions";
import type { CompanyLink, FinPoint } from "@/components/companies/companyData";
import type { DatedEntry, DocketDatesSummary } from "./docketDates";
import type {
  ClassifiedEntry,
  CourtPageMatch,
  DocketRole,
  KindCount,
  LedgerSequence,
  ORDERS_RULE_VERSION,
} from "./orders";
import type { JpmlPoint, WhatChanged } from "./whatChanged";
import type { CasesPage, CaseRow, RegistryLabels } from "./cases";
import type { DocumentsPage, MatterDocument, RegistrySummary } from "./documents";
import type { DocketEntry } from "./entries";
import type { EntryArchive, RegistryEntry } from "./timeline";
import type { MatterOverview } from "./overview";
import type { AppearanceRow, CounselRow, PartyKind } from "./parties";
import type {
  AttorneyView,
  FirmGroup,
  PartiesCounts,
  PartyView,
  SeegerWeissSummary,
} from "./registryParties";
import type { CaseIdPlanEntry, RegistryMatter, RegistryMetrics } from "./registry";

export type MasterDocketMeta = {
  docketNumber: string | null;
  courtId: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  dateLastFiling: string | null;
  sourceAsOf: string | null;
  sourceCheckedAt: string | null;
};

export type JpmlReference = { id: string; kind: string; title: string; url: string };

export type MatterOverviewPayload = {
  overview: MatterOverview;
  master: MasterDocketMeta | null;
  /** judges-dataset id of the single profile native-id-linked to this MDL, else null. */
  judgeProfile: { id: string; name: string } | null;
  jpmlReferences: JpmlReference[];
  sw: { tier: 1 | 2 | null; shortName: string | null };
  /** The Seeger Weiss matter registry's record for this MDL, when the registry publishes one; null otherwise. */
  registry: RegistryMatter | null;
  /**
   * Registry datasets that are released (corpus_datasets.ready) and can be browsed for this matter with the generic
   * dataset browser; null while they are held ("not yet available").
   */
  registryReleased: { entries: string | null; parties: string | null };
  /**
   * Exact row counts in the released registry datasets for this MDL, read live. Only filled when the MDL has no
   * `sw_matters_v1` record (otherwise the record's own counts are used); null when the dataset is held or unread.
   */
  liveRegistry: { entries: number | null; parties: number | null };
};

/**
 * What the member-case list is made of, computed once per matter on the server: the unfiltered composition, which
 * sources contributed and how many rows each did. Small enough to ship with every page.
 */
export type CasesScope = {
  /** Master docket + registry dockets + saved-docket-sample members, merged by CourtListener docket id. */
  listed: number;
  /** Rows read from the matter registry's docket projection (its own total when the read was cut short). */
  registryRows: number;
  /** The registry read stopped at its row limit, so `registryRows` is more than the rows in hand. */
  registryTruncated: boolean;
  /** Evidence-kind and role labels as the registry dataset itself publishes them. */
  labels: RegistryLabels | undefined;
  inventoryPublished: boolean;
  inventoryTotal: number;
  /** Role composition of the whole list (unfiltered), most frequent first. */
  roles: { value: string; label: string; count: number }[];
  /** Rows the registry counts as one action each. */
  actionRows: number;
  /** Dockets whose FJC IDB record carries this MDL number (historical/administrative); null when not published. */
  fjc: { total: number | null; capped: boolean } | null;
};

/** One page of the member-case list plus the scope it was cut from. */
export type MatterCasesPageResponse = CasesPage & { scope: CasesScope };

export type FjcCasesPage = {
  rows: CaseRow[];
  total: number | null;
  capped: boolean;
  offset: number;
  pageSize: number;
};

export type EntriesPayload = {
  source: "activity";
  entries: DocketEntry[];
  total: number | null;
  capped: boolean;
  offset: number;
  pageSize: number;
  available: { activity: number | null };
  coverage: { activityLast: string | null };
};

/** One page of the matter registry's docket-entry timeline, newest first. */
export type TimelinePayload = {
  entries: RegistryEntry[];
  /** Entries matching the filter (all pages), exact. */
  total: number;
  offset: number;
  pageSize: number;
};

/**
 * Which verified PDFs the archive holds for the entries of one timeline page, keyed by entry id. Read separately from
 * the page itself because the first read of a matter's archive index takes a few seconds.
 */
export type TimelineArchivePayload =
  | {
      connected: true;
      /** False when the archive holds more rows than were indexed, so "not archived" may only be "not read". */
      complete: boolean;
      byEntry: Record<string, EntryArchive>;
    }
  | { connected: false; reason: string };

export type RegistryDocumentsPayload =
  | {
      connected: true;
      summary: RegistrySummary;
      rows: MatterDocument[];
      /** Source-native records read before byte-identical PDFs are grouped. */
      sourceRecordsLoaded: number;
      sourceRecordsExcluded: number;
      truncated: boolean;
      /** Provider case ids asked for: matter registry, derived docket keys, or a registered spelling of one of those. */
      caseIds: CaseIdPlanEntry[];
    }
  | { connected: false; reason: string; caseIds: CaseIdPlanEntry[] };

/** The verified PDFs filed under one registry docket's own provider case ids (the member-case drawer). */
export type CaseDocumentsPayload = {
  /** Provider case ids asked for (never the ones the registry marks as conflicting with the docket identity). */
  ids: string[];
  /** Null when the registry records no usable case id for the docket. */
  documents: RegistryDocumentsPayload | null;
};

/**
 * One page of the matter's verified PDFs with the facets and totals of the whole list. The server holds the list (up
 * to 5,000 rows) and sends 50 at a time; the open document of the viewer is looked up in the whole list.
 */
export type RegistryDocumentsPageResponse =
  | {
      connected: true;
      summary: RegistrySummary;
      /** The archive holds more rows than the server read. */
      truncated: boolean;
      caseIds: CaseIdPlanEntry[];
      /** Rows the server holds for this matter (before any filter). */
      loaded: number;
      /** Source-native records read, comparable to summary.total even after PDF grouping. */
      sourceRecordsLoaded: number;
      sourceRecordsExcluded: number;
      page: DocumentsPage;
      /** The document named by the viewer's key, wherever it is in the list; null when it is not in it. */
      viewed: MatterDocument | null;
    }
  | { connected: false; reason: string; caseIds: CaseIdPlanEntry[] };

export type LegacyDocument = {
  id: string;
  entryNumber: number | null;
  date: string | null;
  docType: string | null;
  description: string | null;
  pageCount: number | null;
  /** RECAP link recorded for a free, unsealed document; null otherwise (shown as held). */
  recapUrl: string | null;
  docketEntryUrl: string | null;
  held: boolean;
};

export type PartiesPayload = {
  kind: PartyKind;
  rows: CounselRow[];
  total: number | null;
  capped: boolean;
  offset: number;
  pageSize: number;
  /** Exact totals for each kind for this MDL. */
  totals: Record<PartyKind, number | null>;
};

/** What the matter registry holds for the master docket's parties and counsel (numbers only; the lists load apart). */
export type RegistryPartiesSummary = {
  counts: PartiesCounts;
  /** Party types with the number of parties of each, defendants first. */
  types: { value: string; count: number }[];
  seegerWeiss: SeegerWeissSummary;
};

/** Parties of the master docket: a grouped overview (first rows of each type) or one filtered, paged list. */
export type RegistryPartiesList = {
  total: number;
  offset: number;
  pageSize: number;
  rows: PartyView[];
  /** Set only for the unfiltered first page. */
  groups: { type: string; count: number; rows: PartyView[] }[] | null;
};

/** A firm as listed on the Counsel view: attorneys beyond the cap are counted, not sent. */
export type FirmListItem = Omit<FirmGroup, "attorneys"> & {
  attorneys: AttorneyView[];
  attorneyCount: number;
};

export type RegistryCounselList = {
  total: number;
  offset: number;
  pageSize: number;
  firms: FirmListItem[];
};

export type AppearancesPayload = { rows: AppearanceRow[]; published: boolean };

export type HubRegistry =
  { open: number; held: number; total: number } | { notConnected: true } | { none: true } | null;

export type HubRow = {
  mdl: string;
  tier: 1 | 2;
  shortName: string;
  /** False when the corpus holds no MDL record for this number (e.g. closed matters outside the JPML pending list). */
  inCorpus: boolean;
  title: string | null;
  status: string | null;
  courtName: string | null;
  masterDocket: string | null;
  judgePrinted: string | null;
  /** Id of the `judges` profile linked to the MDL record (data-quality native links); null when none. */
  judgeProfileId: string | null;
  totalActions: number | null;
  pendingActions: number | null;
  asOf: string | null;
  casesInSample: number | null;
  docketEntriesInSample: number | null;
  savedDocuments: number | null;
  swAppearances: number | null;
  registry: HubRegistry;
  /** Member and transferor dockets the matter registry holds for this MDL; null when the registry has no record for it. */
  registryDockets: number | null;
  /** The matter registry's computed numbers (evidence mix, entries captured vs reported, last capture); null without a record. */
  metrics: RegistryMetrics | null;
};

/* ------------------------------------------------------------------ MDL command page (command.functions.ts) */

/** What the collected master-docket text covers for one MDL, so gaps are visible rather than silent. */
export type EntryCoverage = {
  /** Entries the projection holds for the MDL (sw_docket_entries_v1); null when it could not be counted. */
  total: number | null;
  /** Entries published without their text, by the projection's own reason; never classified. */
  withheld: { reason: string; count: number }[];
  withheldTotal: number;
  /** Entries published with no text at all (not withheld); null when not counted. */
  noText: number | null;
  /** Latest filing date in the collected entries; later docket activity is not collected. */
  collectedThrough: string | null;
  /** Candidate entries the anchored prefilters returned and the classifier read. */
  candidatesRead: number;
};

export type Rule702Summary = {
  /** Order entries whose own title rules on a Rule 702 / Daubert motion. */
  rulings: number;
  byOutcome: { granted: number; denied: number; granted_in_part: number; not_stated: number };
  /** Motion entries naming Rule 702 / Daubert (counted apart, never as rulings). */
  motions: number;
};

export type KeyOrdersPayload = {
  mdl: string;
  rule: typeof ORDERS_RULE_VERSION;
  dataset: "sw_docket_entries_v1";
  coverage: EntryCoverage;
  /** Classified entries that carry at least one kind, oldest first. */
  entries: ClassifiedEntry[];
  ledger: Record<"cmo" | "pto", LedgerSequence>;
  counts: KindCount[];
  rule702: Rule702Summary;
  readAt: string;
};

/** A date set on the docket with the entry it was read from and that entry's role. */
export type DocketDateRow = DatedEntry & { entryRole: DocketRole };

export type DocketDatesPayload = {
  mdl: string;
  rows: DocketDateRow[];
  collectedThrough: string | null;
  readAt: string;
};

/** Documents-layer files of one docket entry, joined on mdl + court + master docket number + entry number. */
export type OrderDocument = {
  id: string;
  entryNumber: number;
  attachment: number | null;
  title: string | null;
  docType: string | null;
  pageCount: number | null;
  pagesWithText: number | null;
  textStatus: string | null;
  sourceUrl: string | null;
};

export type OrderDocumentsPayload =
  | {
      connected: true;
      master: { docketKey: string; courtId: string; docketNumber: string };
      /** Keyed by the docket entry number as text. */
      byEntry: Record<string, OrderDocument[]>;
    }
  | { connected: false; reason: string };

/** One sw_matter_regulatory_links_v1 row: a topical association, never MDL membership. */
export type RegulatoryLink = {
  id: string;
  title: string;
  fdaId: string | null;
  /** The link record's own date; the dataset does not state whether it is a report or an initiation date. */
  date: string | null;
  firm: string | null;
  classification: string | null;
  signal: string | null;
  linkBasis: string | null;
  association: string | null;
  fdaKind: string | null;
  fdaRecord: string | null;
  sourceUrl: string | null;
};

export type RegulatoryLinksPayload = {
  mdl: string;
  rows: RegulatoryLink[];
  /** The selection rule the dataset publishes for this MDL's links; null when none. */
  rule: string | null;
  caveats: string[];
};

export type DefendantRow = {
  id: string;
  /** As printed; null when the projection withheld it. */
  name: string | null;
  types: string[];
  dateTerminated: string | null;
  counselCount: number | null;
  /** Firm lines of the party's active counsel, as printed (never merged). */
  firms: string[];
};

export type DefendantRosterPayload = {
  mdl: string;
  /** Parties whose printed party type is exactly "Defendant". */
  defendants: DefendantRow[];
  /** Parties listed with "Defendant" and another type ("Defendant / Plaintiff"), kept apart. */
  mixed: DefendantRow[];
  /** Firm lines as printed, ranked by exact-"Defendant" parties they represent (active counsel only). */
  firms: { firm: string; parties: number }[];
  /** Terminated exact-"Defendant" parties per month of termination (yyyy-mm). */
  terminatedByMonth: { month: string; count: number }[];
  /** The registry's own party capture: parties published and whether the capture is complete. */
  capture: { published: number | null; complete: boolean | null };
  /** "N of M parties published" style note; says when the capture is incomplete. */
  captureNote: string;
};

/** A typed docket event from corpus_workspace_docket_links (the source's own classification). */
export type TypedEvent = {
  documentType: string;
  date: string | null;
  dateBasis: string | null;
  entryNumber: string | null;
  evidenceUrl: string | null;
  linkageBasis: string | null;
  sourceDataset: string;
  sourceRecordId: string;
  /** "mdl": the row carries this MDL number; "master_docket": a blank-MDL row on this MDL's exact master docket. */
  attribution: "mdl" | "master_docket";
};

export type TypedEventsPayload = {
  mdl: string;
  events: TypedEvent[];
  byType: {
    type: string;
    count: number;
    first: string | null;
    last: string | null;
    undated: number;
  }[];
  /** First and last event date collected; nothing after `last` is collected. */
  window: { first: string | null; last: string | null };
  /** The master docket used for blank-MDL rows; null when none was used. */
  masterDocket: { courtId: string; docketNumber: string } | null;
  blankMdlAttributed: number;
};

export type SecFinancialSeries = { label: string; points: FinPoint[] };

export type SecDefendant = {
  cik: string;
  name: string;
  link: CompanyLink;
  /** Company-wide figures from the registrant's own XBRL facts; never attributed to this MDL. */
  accrual: SecFinancialSeries | null;
  legalPayments: SecFinancialSeries | null;
  possibleLoss: SecFinancialSeries | null;
  financialsSourceUrl: string | null;
  financialsRetrieved: string | null;
};

export type SecDefendantsPayload = {
  mdl: string;
  /** Tier A/B links (the filing cites the MDL number or caption) not flagged for review. */
  named: SecDefendant[];
  /** Tier C links and links flagged for review: kept apart, labelled "requires review". */
  review: SecDefendant[];
  caveats: string[];
};

export type MdlCommandMode = "registry" | "recorded";

export type MdlCommandPayload = {
  mdl: string;
  mode: MdlCommandMode;
  /** False when neither the registry nor any lens record holds this MDL number. */
  found: boolean;
  overview: MatterOverviewPayload | null;
  lens: MdlLens | null;
  orders: KeyOrdersPayload | null;
  dates: DocketDatesPayload | null;
  /** Upcoming and summary figures relative to `asOf`. */
  datesSummary: DocketDatesSummary | null;
  courtPageOrders: CourtPageMatch[];
  whatChanged: WhatChanged;
  /** JPML monthly-report points used for the deltas (jpml_mdl_pending_series). */
  jpmlPoints: JpmlPoint[];
  jpmlSourceUrl: string | null;
  asOf: string;
  /** Sections whose read failed; the page shows them as unavailable rather than empty. */
  errors: string[];
};
