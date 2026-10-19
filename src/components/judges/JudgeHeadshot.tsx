import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fileUrl } from "@/lib/external/groups";
import { getJudgePortrait } from "@/lib/external/judgePortrait.functions";

const FRAME = "h-36 w-28 shrink-0 rounded-md border border-border object-cover object-top";

/**
 * Profile-header portrait. A photo recorded on the profile wins; otherwise the public-domain portrait of the CourtListener person
 * the crosswalk links (exact-evidence tiers only), credited to the source it records. Nothing is drawn when neither exists.
 */
export function JudgeHeadshot({
  judgeId,
  name,
  recorded,
}: {
  judgeId: string;
  name: string;
  recorded: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["judge-portrait", judgeId],
    queryFn: () => getJudgePortrait({ data: { id: judgeId } }),
    staleTime: Infinity,
    enabled: !recorded,
  });
  if (recorded) {
    const src = recorded.startsWith("/") ? fileUrl(recorded) : recorded;
    if (failed === src) return null;
    return (
      <img
        src={src}
        alt={`${name}, portrait from the recorded profile`}
        className={FRAME}
        onError={() => setFailed(src)}
      />
    );
  }
  if (q.isLoading)
    return (
      <span
        className="block h-36 w-28 shrink-0 animate-pulse rounded-md border border-border bg-muted/50"
        aria-busy="true"
        aria-label="Loading portrait"
      />
    );
  const portrait = q.data;
  if (!portrait || failed === portrait.assetPath) return null;
  return (
    <figure className="w-28 shrink-0">
      <img
        src={portrait.assetPath}
        alt={`${name}, portrait`}
        width={portrait.width}
        height={portrait.height}
        className={FRAME}
        loading="lazy"
        onError={() => setFailed(portrait.assetPath)}
      />
      <figcaption className="mt-1 text-[10px] leading-snug text-muted-foreground">
        {portrait.sourceUrl ? (
          <a
            href={portrait.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2"
          >
            {portrait.sourceLabel}
          </a>
        ) : (
          portrait.sourceLabel
        )}
        <span className="block">{portrait.license}</span>
      </figcaption>
    </figure>
  );
}
