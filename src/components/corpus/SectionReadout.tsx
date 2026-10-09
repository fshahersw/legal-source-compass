import { publishedSectionBody, type SectionFields } from "@/lib/law/stateCodeContract";
import { safeResourceHref } from "@/lib/corpus/resourcePresentation";

/** Read the provision first. Source history is retained below it, never rewritten or inferred. */
export function SectionReadout({ fields, text }: { fields: SectionFields; text?: string | null }) {
  const body = text !== undefined ? text : publishedSectionBody(fields);
  const href = safeResourceHref(fields.sourceUrl);
  return (
    <article className="space-y-3" data-testid="statute-readout">
      <header className="border-b border-border pb-3">
        {fields.citation ? (
          <p className="mb-1 text-xs font-semibold text-primary">{fields.citation}</p>
        ) : null}
        <h3 className="font-display text-xl font-medium leading-snug">
          {fields.heading ?? fields.citation ?? "Statutory provision"}
        </h3>
        {fields.status ? (
          <p
            role="status"
            className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold"
          >
            {fields.status}
          </p>
        ) : null}
      </header>
      {body ? (
        <div
          className="max-h-[72vh] overflow-auto whitespace-pre-wrap break-words pr-2 font-sans text-[14px] leading-[1.75] selection:bg-[var(--blue-tint)]"
          data-testid="statute-text"
        >
          {body}
        </div>
      ) : (
        <p className="py-3 text-sm text-muted-foreground">Text: Not recorded</p>
      )}
      <details className="border-t border-border pt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-primary">Source & version</summary>
        <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
          {href ? (
            <>
              <dt>Publisher</dt>
              <dd>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Open source publication
                </a>
              </dd>
            </>
          ) : null}
          {fields.edition ? (
            <>
              <dt>Edition</dt>
              <dd className="break-words">{fields.edition}</dd>
            </>
          ) : null}
          <dt>Currency</dt>
          <dd className="break-words">
            {fields.currency ?? "The compilation-through date is not established."}
          </dd>
          {fields.history ? (
            <>
              <dt>History</dt>
              <dd className="whitespace-pre-wrap break-words">{fields.history}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </article>
  );
}
