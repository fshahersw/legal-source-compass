import {
  publishedSectionBody,
  showRecorded,
  type SectionFields,
} from "@/lib/law/stateCodeContract";

function Row({ label, value, href }: { label: string; value: string | null; href?: boolean }) {
  const shown = showRecorded(value);
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">
        {href && value ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {shown}
          </a>
        ) : (
          shown
        )}
      </dd>
    </>
  );
}

/** The fields every full-code section page shows. Missing source fields read "Not recorded". */
export function SectionReadout({ fields, text }: { fields: SectionFields; text?: string | null }) {
  const body = text !== undefined ? text : publishedSectionBody(fields);
  return (
    <article className="space-y-4">
      <header>
        <h3 className="text-base font-semibold">
          {showRecorded(fields.heading ?? fields.citation)}
        </h3>
        {fields.status ? (
          <p className="mt-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm font-semibold">
            Status as printed: {fields.status}
          </p>
        ) : null}
      </header>
      <dl className="grid gap-y-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-3">
        <Row label="Citation" value={fields.citation} />
        <Row label="Heading" value={fields.heading} />
        <Row label="History / source note" value={fields.history} />
        <Row label="Edition" value={fields.edition} />
        <Row label="Currency" value={fields.currency} />
        <Row label="Source" value={fields.sourceUrl} href />
      </dl>
      {body ? (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 text-sm leading-relaxed">
          {body}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">Text: Not recorded</p>
      )}
    </article>
  );
}
