import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getPublicStatuteSections } from "@/lib/law/stateCode.functions";
import { showRecorded } from "@/lib/law/stateCodeContract";

/** The rule citation, plus the public section only when the native id matches exactly. */
export function StatuteCitation({ state, citation }: { state: string; citation: string }) {
  const fn = useServerFn(getPublicStatuteSections);
  const query = useQuery({
    queryKey: ["public-statute-section", state, citation],
    queryFn: () => fn({ data: { state, citation } }),
    enabled: /^[A-Z]{2}$/.test(state) && citation.trim().length > 0,
    staleTime: 5 * 60_000,
  });
  const sections = query.data ?? [];
  return (
    <div data-testid="statute-citation">
      <p>{citation}</p>
      {query.error ? <ExternalError error={query.error} /> : null}
      {query.isSuccess && sections.length === 0 ? (
        <p className="mt-1 text-muted-foreground">Section text not yet public</p>
      ) : null}
      {sections.map((section) => (
        <article
          key={section.nativeId}
          className="mt-2 rounded-md border border-border bg-background p-3"
          aria-label={`Section ${section.citationPath}`}
        >
          <h4 className="text-sm font-semibold">{showRecorded(section.heading)}</h4>
          {section.status ? (
            <p className="mt-1 text-sm font-medium">Status as printed: {section.status}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{section.nativeId}</p>
          <p className="mt-2 text-sm">Currency: {showRecorded(section.currency)}</p>
          <p className="mt-1 text-sm">
            Source:{" "}
            {section.sourceUrl ? (
              <a
                href={section.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-primary underline"
              >
                {section.sourceUrl}
              </a>
            ) : (
              "Not recorded"
            )}
          </p>
          <p className="mt-1 text-sm">
            <Link
              to="/law/codes/$state"
              params={{ state }}
              search={{ section: section.nativeId, q: "" }}
              className="text-primary underline"
            >
              Open this section
            </Link>
          </p>
          {section.text ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
              {section.text}
            </pre>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Text: Not recorded</p>
          )}
        </article>
      ))}
    </div>
  );
}
