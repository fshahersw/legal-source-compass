import { useCallback, useMemo } from "react";
import { courtShort, type Atlas } from "./atlasModel";

/** Short court name ("D. New Jersey") for a JPML district code, from the atlas; the code itself when unknown. */
export function useDistrictName(atlas: Atlas | null) {
  const names = useMemo(
    () => new Map((atlas?.districts ?? []).map((d) => [d.code, courtShort(d)] as const)),
    [atlas],
  );
  return useCallback((code: string) => names.get(code) ?? code, [names]);
}
