/**
 * Tile states of the Insights KPI tiles (loading, error, empty, ok) and the headline series shown on the Overview and at
 * the top of /insights. Shared by KpiTile.tsx and OverviewBoard.tsx.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import type { Topic } from "@/lib/insights/contract";
import { blockDef } from "@/lib/analytics/registry";
import type { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { HUB_BLOCK_TOPIC, kpiFromBlock } from "./kpis";
import type { Kpi } from "./kpis";

export type TileState =
  | { kind: "loading"; id: string; topic: Topic; title: string }
  | { kind: "error"; id: string; topic: Topic; title: string; retry: () => void }
  | { kind: "empty"; id: string; topic: Topic; title: string; reason: string }
  | { kind: "ok"; kpi: Kpi };

export const tileKey = (s: TileState) => (s.kind === "ok" ? s.kpi.id : s.id);
export const tileTopic = (s: TileState) => (s.kind === "ok" ? s.kpi.topic : s.topic);

type BlockData = Awaited<ReturnType<ReturnType<typeof analyticsBlockQuery>["queryFn"]>>;

/** The tile state of one Analytics hub block from its query. */
export function hubTileState(id: string, q: UseQueryResult<BlockData>): TileState {
  const title = blockDef(id)?.title ?? id;
  const topic = HUB_BLOCK_TOPIC[id] ?? "courts";
  if (q.isPending) return { kind: "loading", id, topic, title };
  if (q.isError) return { kind: "error", id, topic, title, retry: () => void q.refetch() };
  if (q.data.status === "empty") return { kind: "empty", id, topic, title, reason: q.data.reason };
  return { kind: "ok", kpi: kpiFromBlock(q.data.data, title, topic) };
}

/** One headline series per main topic: courts, litigation, enforcement, products & safety. */
export const HEADLINE_BLOCKS = [
  "federal-civil",
  "mdl-pending",
  "sec-releases",
  "cpsc-recalls",
] as const;
