import type { PlaceHubTab } from "./placeSearch";

export type StateMode = "overview" | "analysis" | "directory" | "sources";

/** Legacy court/judge/county addresses share one directory mode without changing their destinations. */
export function stateMode(tab: PlaceHubTab): StateMode {
  if (tab === "courts" || tab === "judges" || tab === "counties") return "directory";
  return tab;
}

export const STATE_MODES = [
  { id: "overview", label: "Overview", destination: "overview" },
  { id: "analysis", label: "Analysis", destination: "analysis" },
  { id: "directory", label: "Directories", destination: "courts" },
  { id: "sources", label: "Law & resources", destination: "sources" },
] as const;