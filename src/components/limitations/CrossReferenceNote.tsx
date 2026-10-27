import { Link } from "@tanstack/react-router";
import { sectionLabel, type CrossReferenceFacts } from "./ruleAuthority";

/**
 * Where a tolling / repose note's cited section is held in the corpus, and whether the note's periods are
 * printed there. Rendered only when the release carries a link for the note; nothing is inferred otherwise.
 */
export function CrossReferenceNote({ link }: { link: CrossReferenceFacts | null }) {
  if (!link) return null;
  const tone =
    link.termCheck === "all_present"
      ? "border-primary/40 text-primary"
      : link.termCheck === "not_all_present"
        ? "border-destructive/50 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <span
      className="ml-1 inline-flex flex-wrap items-center gap-1 align-baseline text-xs"
      data-testid="cross-reference"
    >
      <span className={`inline-block rounded border px-1.5 py-0.5 ${tone}`} title={link.detail}>
        {link.label}
      </span>
      {link.sectionIds.map((nativeId) => (
        <Link
          key={nativeId}
          to="/law/codes/$state"
          params={{ state: link.state }}
          search={{ section: nativeId }}
          className="text-primary underline"
          title={`Open ${nativeId.slice(nativeId.indexOf(":") + 1)} in the state code reader`}
        >
          {sectionLabel(nativeId)}
        </Link>
      ))}
    </span>
  );
}
