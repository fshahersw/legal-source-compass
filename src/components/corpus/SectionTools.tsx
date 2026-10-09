import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, Link2, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalError } from "@/components/corpus/ExternalBadge";
import { getLimitationRulesForSection } from "@/lib/limitations/sectionRules.functions";
import type { ClaimType } from "@/lib/limitations/types";
import { publishedSectionBody, type SectionFields } from "@/lib/law/stateCodeContract";

function useCopy(): [string | null, (key: string, value: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return [
    copied,
    (key, value) => {
      void navigator.clipboard
        .writeText(value)
        .then(() => setCopied(key))
        .catch(() => setCopied("failed"));
    },
  ];
}

/** Copy, source and cross-link actions for one section. Every value shown comes from the record itself. */
export function SectionTools({
  fields,
  state,
  nativeId,
}: {
  fields: SectionFields;
  state: string;
  /** Public projection native id (`ST:<citation path>`); omit when the reader is not a projection. */
  nativeId?: string | undefined;
}) {
  const [copied, copy] = useCopy();
  const body = publishedSectionBody(fields);
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    setHref(window.location.href);
  }, [nativeId, fields.citation]);
  return (
    <div className="space-y-2" data-testid="section-tools">
      {copied === "failed" ? (
        <p role="alert" className="text-xs text-destructive">
          Copy failed. Select the citation or text and copy it manually.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {fields.sourceUrl ? (
          <Button asChild size="sm">
            <a href={fields.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 size-3.5" />
              Official source
            </a>
          </Button>
        ) : null}
        {fields.citation ? (
          <Button size="sm" variant="outline" onClick={() => copy("cite", fields.citation!)}>
            <Copy className="mr-1 size-3.5" />
            {copied === "cite" ? "Copied" : "Copy citation"}
          </Button>
        ) : null}
        {body ? (
          <Button size="sm" variant="outline" onClick={() => copy("text", body)}>
            <Copy className="mr-1 size-3.5" />
            {copied === "text" ? "Copied" : "Copy text"}
          </Button>
        ) : null}
        {href ? (
          <Button size="sm" variant="outline" onClick={() => copy("link", href)}>
            <Link2 className="mr-1 size-3.5" />
            {copied === "link" ? "Copied" : "Copy link"}
          </Button>
        ) : null}
      </div>
      {nativeId ? <RelatedTimeLimits state={state} nativeId={nativeId} /> : null}
    </div>
  );
}

function RelatedTimeLimits({ state, nativeId }: { state: string; nativeId: string }) {
  const fn = useServerFn(getLimitationRulesForSection);
  const query = useQuery({
    queryKey: ["section-limitation-rules", state, nativeId],
    queryFn: () => fn({ data: { state, nativeId } }),
    staleTime: 5 * 60 * 1000,
  });
  if (query.isLoading) return null;
  if (query.error)
    return (
      <div className="text-xs">
        <ExternalError error={query.error} />
      </div>
    );
  const rules = query.data?.rules ?? [];
  if (!rules.length) return null;
  return (
    <section
      className="rounded-md border border-border bg-muted/40 p-3"
      aria-label="Time limits citing this section"
      data-testid="related-time-limits"
    >
      <h4 className="flex items-center gap-1.5 text-sm font-semibold">
        <Scale className="size-4" aria-hidden />
        Time limits citing this section
        <span className="font-normal text-muted-foreground">
          · {rules.length} {rules.length === 1 ? "rule" : "rules"} · release{" "}
          {query.data?.ruleVersion}
        </span>
      </h4>
      <ul className="mt-2 divide-y divide-border">
        {rules.map((rule) => (
          <li
            key={rule.ruleId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-sm"
          >
            <Link
              to="/limitations"
              search={{ state, claim: rule.claimType as ClaimType, view: "calculator" }}
              className="font-medium text-primary underline underline-offset-4"
            >
              {rule.claimLabel}
              {rule.subtype ? ` · ${rule.subtype}` : ""}
            </Link>
            <span className="text-muted-foreground">
              {rule.ruleKind}
              {rule.period ? ` · ${rule.period}` : ""}
              {rule.effectiveFrom || rule.effectiveThrough
                ? ` · ${rule.effectiveFrom ?? "…"} → ${rule.effectiveThrough ?? "current"}`
                : ""}
              {rule.computation === "research_only" ? " · research only" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {rule.matchedBy.includes("citation") ? "cited by pinpoint" : "quoted text found here"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
