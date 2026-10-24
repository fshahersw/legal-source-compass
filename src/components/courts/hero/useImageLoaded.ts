import { useCallback, useState } from "react";

/** Tracks whether an <img> has loaded, including one already complete from cache when it mounts. */
export function useImageLoaded(src: string | null) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && src && img.complete && img.naturalWidth > 0) setLoaded(src);
    },
    [src],
  );
  return {
    ref,
    loaded: !!src && loaded === src,
    failed: !!src && failed === src,
    onLoad: () => src && setLoaded(src),
    onError: () => src && setFailed(src),
  };
}
