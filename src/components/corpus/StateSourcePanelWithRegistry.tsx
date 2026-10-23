import { useState, type ComponentProps } from "react";
import { StateSourcePanel } from "./StateSourcePanel";
import { useGovEvidence } from "./useGovEvidence";

/**
 * The state resource list with government domain registry tags: the panel reports which addresses are on screen, one lookup
 * asks the registries about them, and a listed host gets a quiet tag. A failed lookup leaves the list exactly as it was.
 */
export function StateSourcePanelWithRegistry(
  props: Omit<ComponentProps<typeof StateSourcePanel>, "registry" | "onVisibleUrls">,
) {
  const [visible, setVisible] = useState<string[]>([]);
  const registry = useGovEvidence(visible, !props.loading);
  return <StateSourcePanel {...props} registry={registry} onVisibleUrls={setVisible} />;
}
