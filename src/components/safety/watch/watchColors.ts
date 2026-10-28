/** MDL-status colours shared by the watch charts (chart-kit slots). Products that are not rising are drawn in the base grey. */
import { seriesVar } from "@/components/charts/palette";
import type { MdlStatus } from "./watchModel";

export const STATUS_COLOR: Record<MdlStatus, string> = {
  none: seriesVar(1),
  pending: seriesVar(0),
  closed: seriesVar(4),
  unkeyed: seriesVar(5),
};
