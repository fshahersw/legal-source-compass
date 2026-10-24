import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ImageLoadFailed, OpenImageCredit } from "@/components/visuals/ImageCredit";
import { openJudgePortraitQuery } from "@/components/visuals/queries";
import { fileUrl } from "@/lib/external/groups";
import { getJudgePortrait } from "@/lib/external/judgePortrait.functions";
import { imageSrcSet } from "@/lib/visuals/common";
import { JUDGE_PROFILE_ID, type OpenJudgePortrait } from "@/lib/visuals/judgePortraits";

const FRAME = "h-36 w-28 shrink-0 rounded-md border border-border object-cover object-top";

function Skeleton() {
  return (
    <span
      className="block h-36 w-28 shrink-0 animate-pulse rounded-md border border-border bg-muted/50"
      aria-busy="true"
      aria-label="Loading portrait"
    />
  );
}

/**
 * Profile-header portrait, in this order: a photo recorded on the profile; else the public-domain portrait of the
 * CourtListener person the crosswalk links (exact-evidence tiers only), credited to the source it records; else an
 * open-licence portrait bound to this profile by its exact FJC biography id (dataset judge_portraits_open), with its
 * author, licence and file page. Nothing is drawn when none exists.
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
  // Read in parallel with the crosswalk portrait; used only when that one is absent.
  const open = useQuery({
    ...openJudgePortraitQuery(judgeId),
    enabled: !recorded && JUDGE_PROFILE_ID.test(judgeId),
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
  if (q.isLoading) return <Skeleton />;
  const portrait = q.data;
  if (portrait) {
    if (failed === portrait.assetPath) return null;
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
  if (open.isLoading) return <Skeleton />;
  return open.data ? (
    <OpenPortrait
      portrait={open.data}
      name={name}
      failed={failed === open.data.thumb.url}
      onFail={setFailed}
    />
  ) : null;
}

function OpenPortrait({
  portrait,
  name,
  failed,
  onFail,
}: {
  portrait: OpenJudgePortrait;
  name: string;
  failed: boolean;
  onFail: (url: string) => void;
}) {
  return (
    <figure className="m-0 w-28 shrink-0">
      {failed ? (
        <div className="grid h-36 w-28 place-items-center rounded-md border border-border bg-muted/40 p-2 text-center">
          <ImageLoadFailed image={portrait} noun="portrait" className="text-[10px]" />
        </div>
      ) : (
        <img
          src={portrait.thumb.url}
          srcSet={imageSrcSet(portrait)}
          sizes="7rem"
          alt={`${name}, portrait`}
          width={portrait.thumb.width}
          height={portrait.thumb.height}
          className={FRAME}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => onFail(portrait.thumb.url)}
        />
      )}
      <figcaption className="mt-1">
        <OpenImageCredit image={portrait} label="Portrait" compact className="text-[10px]" />
      </figcaption>
    </figure>
  );
}
