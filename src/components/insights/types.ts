/** Types shared by the Insights adapter, its providers (data layer, bridge, dev fixtures) and the pages. */
import type {
  CrossPoint,
  EntityRef,
  EntityType,
  Fact,
  Freshness,
  Link,
  LinkEvidence,
  MetricDef,
} from "@/lib/insights/contract";
import type {
  CrossArgs,
  EntityArgs,
  EntityResult,
  LatestArgs,
  LinksArgs,
  SeriesArgs,
  SnapshotArgs,
} from "./layerStub";

export type {
  CrossArgs,
  EntityArgs,
  EntityResult,
  LatestArgs,
  LinksArgs,
  SeriesArgs,
  SnapshotArgs,
};

/** The eight contract reads, plus the event-study read the Signals page needs from the data layer. */
export type InsightsLayer = {
  catalog: () => Promise<MetricDef[]>;
  series: (a: SeriesArgs) => Promise<Fact[]>;
  snapshot: (a: SnapshotArgs) => Promise<Fact[]>;
  latest: (a: LatestArgs) => Promise<Fact[]>;
  cross: (a: CrossArgs) => Promise<CrossPoint[]>;
  entity: (a: EntityArgs) => Promise<EntityResult>;
  links: (a: LinksArgs) => Promise<Link[]>;
  freshness: () => Promise<Freshness[]>;
  /** Exact cases for "months from first recall to MDL creation"; null when the layer has no such read. */
  eventStudy?: (() => Promise<EventStudy>) | undefined;
};

/** One case of an event study: an event (first recall of a product) and an outcome (creation of an MDL), linked exactly. */
export type EventStudyCase = {
  id: string;
  /** The MDL. */
  label: string;
  href: string | null;
  eventLabel: string;
  eventDate: string;
  outcomeDate: string;
  /** Calendar months from event to outcome (negative when the MDL came first). */
  months: number;
  evidence: {
    relation: string;
    evidence: LinkEvidence;
    sourceDataset: string;
    sourceRecordId: string;
  };
};

export type EventStudy = {
  title: string;
  event: string;
  outcome: string;
  cases: EventStudyCase[];
  sources: { label: string; url: string }[];
  method: string;
};

/** Where a catalog metric comes from. */
export type MetricOrigin = "layer" | "bridge" | "fixture";

export type CatalogResult = {
  metrics: MetricDef[];
  origin: Record<string, MetricOrigin>;
  /** State of the insights data layer: live, not yet published, or failed to read. */
  layer: "ready" | "not_ready" | "failed";
  /** Bridged readers that failed (the rest of the catalog is still shown). */
  bridgeFailures: string[];
  fixtures: boolean;
};

export type EntityLabel = { id: string; label: string; href: string | null };
export type { EntityRef, EntityType };
