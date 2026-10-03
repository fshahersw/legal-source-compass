/** Payload shapes shared by the matter server functions and the matter UI (no server code lives here). */
import type { CaseRow } from "./cases";
import type { MatterDocument, RegistrySummary } from "./documents";
import type { DocketEntry } from "./entries";
import type { MatterOverview } from "./overview";
import type { AppearanceRow, CounselRow, PartyKind } from "./parties";

export type MasterDocketMeta = {
  docketNumber: string | null;
  courtId: string | null;
  dateFiled: string | null;
  dateTerminated: string | null;
  dateLastFiling: string | null;
  sourceAsOf: string | null;
};

export type JpmlReference = { id: string; kind: string; title: string; url: string };

export type MatterOverviewPayload = {
  overview: MatterOverview;
  master: MasterDocketMeta | null;
  /** judges-dataset id of the single profile native-id-linked to this MDL, else null. */
  judgeProfile: { id: string; name: string } | null;
  jpmlReferences: JpmlReference[];
  sw: { tier: 1 | 2 | null; shortName: string | null };
};

export type MatterCasesPayload = {
  /** Master docket + saved-docket-sample members, merged by CourtListener docket id. */
  rows: CaseRow[];
  inventoryTotal: number;
  /** Dockets whose FJC IDB record carries this MDL number (historical/administrative); null when not published. */
  fjc: { total: number | null; capped: boolean } | null;
  inventoryPublished: boolean;
};

export type FjcCasesPage = {
  rows: CaseRow[];
  total: number | null;
  capped: boolean;
  offset: number;
  pageSize: number;
};

export type EntriesPayload = {
  source: "activity" | "cl_entries";
  entries: DocketEntry[];
  total: number | null;
  capped: boolean;
  offset: number;
  pageSize: number;
  /** Totals per available source so the UI can offer the switch. */
  available: { activity: number | null; clEntries: number | null };
  /** Newest date of each available source, when known. */
  coverage: { activityLast: string | null; clLast: string | null };
};

export type RegistryDocumentsPayload =
  | {
      connected: true;
      summary: RegistrySummary;
      rows: MatterDocument[];
      truncated: boolean;
      caseKeys: string[];
    }
  | { connected: false; reason: string; caseKeys: string[] };

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
  totalActions: number | null;
  pendingActions: number | null;
  asOf: string | null;
  casesInSample: number | null;
  docketEntriesInSample: number | null;
  savedDocuments: number | null;
  swAppearances: number | null;
  registry: HubRegistry;
};
