import { memo, useEffect, useMemo, useState } from "react";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { nextChunkCount, splitMarkdownChunks } from "./readerChunks";

type IdleHandle = { cancel: () => void };

/** Runs a function when the browser is idle (or soon after, where idle callbacks do not exist). */
function whenIdle(fn: () => void): IdleHandle {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 250 });
    return { cancel: () => w.cancelIdleCallback?.(id) };
  }
  const id = window.setTimeout(fn, 16);
  return { cancel: () => window.clearTimeout(id) };
}

/** One piece of the page. Pieces off screen are skipped by layout and paint until they are scrolled near. */
const Piece = memo(function Piece({ text }: { text: string }) {
  return (
    <div style={{ contentVisibility: "auto", containIntrinsicSize: "auto 600px" }}>
      <AssistantMarkdown text={text} />
    </div>
  );
});

/**
 * The page's text. A long page is shown a piece at a time (the first at once, the rest as the browser has time), so opening
 * the text view never blocks the panel, and the whole article is memoised so resizing the panel does not rebuild it.
 */
export const ReaderArticle = memo(function ReaderArticle({
  markdown,
  truncated,
}: {
  markdown: string;
  truncated: boolean;
}) {
  const chunks = useMemo(() => splitMarkdownChunks(markdown), [markdown]);
  const [shown, setShown] = useState(() => nextChunkCount(0, chunks.length));
  useEffect(() => {
    if (shown >= chunks.length) return;
    const handle = whenIdle(() => setShown((n) => nextChunkCount(n, chunks.length)));
    return () => handle.cancel();
  }, [shown, chunks.length]);

  return (
    <article
      className="mx-auto max-w-[44rem] px-6 py-5 text-[14px] leading-relaxed"
      aria-busy={shown < chunks.length}
    >
      <div className="space-y-2">
        {chunks.slice(0, shown).map((chunk, i) => (
          <Piece key={i} text={chunk} />
        ))}
      </div>
      {shown < chunks.length ? (
        <p className="mt-4 text-[12px] text-muted-foreground" role="status">
          Loading the rest of the text…
        </p>
      ) : null}
      {truncated && shown >= chunks.length ? (
        <p className="mt-6 border-t border-border pt-3 text-[12px] text-muted-foreground">
          The text continues on the page. Open it in a new tab to read the rest.
        </p>
      ) : null}
    </article>
  );
});
