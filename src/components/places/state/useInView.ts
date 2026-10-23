import { useCallback, useEffect, useRef, useState } from "react";

/**
 * True once the element has come near the viewport (and stays true). A page with several data sections loads each one as it
 * is reached rather than all at once; without IntersectionObserver the section loads immediately.
 */
export function useInView<T extends Element>(
  rootMargin = "400px",
): [(el: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || seen) return;
      if (typeof IntersectionObserver === "undefined") {
        setSeen(true);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            io.disconnect();
          }
        },
        { rootMargin },
      );
      io.observe(el);
      observer.current = io;
    },
    [rootMargin, seen],
  );
  return [ref, seen];
}
