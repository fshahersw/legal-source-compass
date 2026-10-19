import { highlightParts } from "./ruleFormat";

/** A search snippet with the query's words marked (no HTML is built from the text). */
export function Highlighted({
  text,
  q,
  className,
}: {
  text: string;
  q: string;
  className?: string;
}) {
  return (
    <span className={className}>
      {highlightParts(text, q).map((p, n) =>
        p.hit ? (
          <mark key={n} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={n}>{p.text}</span>
        ),
      )}
    </span>
  );
}
