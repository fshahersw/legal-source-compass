import { useQuery } from "@tanstack/react-query";
import { parseRegistry } from "./registry";

/** Loads the bundled registry file in the browser (read-only), parsed once and cached. */
export function useRegistry() {
  return useQuery({
    queryKey: ["registry-v06-1"],
    queryFn: async () => {
      const res = await fetch("/data/registry_v06_1.jsonl");
      if (!res.ok) throw new Error(`Registry file could not be loaded (${res.status}).`);
      return parseRegistry(await res.text());
    },
    staleTime: Infinity,
  });
}
