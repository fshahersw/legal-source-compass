import { Building2, CircleUserRound, MapPin } from "lucide-react";
import { useState } from "react";
import { agencyArtwork, stateArtwork, stateFlag } from "@/lib/visuals/registry";
import { canonicalState } from "@/lib/corpus/stateHub";
import { fileUrl } from "@/lib/external/groups";
import { cn } from "@/lib/utils";
import { markImageFailed, useImageFailed } from "@/components/visuals/failedImages";
export function StateMark({
  state,
  className,
  flag = true,
}: {
  state: string;
  className?: string;
  flag?: boolean;
}) {
  const identity = canonicalState(state),
    asset = stateArtwork(state),
    flagAsset = flag ? stateFlag(state) : null;
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-[var(--blue-tint)] p-2",
        className,
      )}
      title={
        identity
          ? `${identity.name} geographic outline${flagAsset ? " and state flag" : ""} — not a government seal`
          : "State not identified"
      }
    >
      {asset && failed !== asset.path ? (
        <img
          src={asset.path}
          alt={`${identity?.name} outline`}
          className="size-full object-contain"
          loading="lazy"
          onError={() => setFailed(asset.path)}
        />
      ) : (
        <MapPin
          aria-label={identity ? `${identity.name} outline unavailable` : "State not identified"}
          className="size-5 text-muted-foreground"
        />
      )}
      {flagAsset && failed !== flagAsset.path ? (
        <img
          src={flagAsset.path}
          alt={`Flag of ${identity?.name}`}
          className="absolute -bottom-1 -right-1 h-[38%] w-auto max-w-[62%] rounded-[3px] border border-surface object-cover shadow-sm ring-1 ring-border/70"
          loading="lazy"
          onError={() => setFailed(flagAsset.path)}
        />
      ) : null}
    </span>
  );
}
export function StateFlag({ state, className }: { state: string; className?: string }) {
  const identity = canonicalState(state),
    asset = stateFlag(state);
  const [failed, setFailed] = useState(false);
  if (!asset || failed) return null;
  return (
    <img
      src={asset.path}
      alt={`Flag of ${identity?.name}`}
      title={`Flag of ${identity?.name} · ${asset.license}`}
      className={cn(
        "inline-block h-4 w-auto rounded-[2px] object-cover ring-1 ring-border/70",
        className,
      )}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
/**
 * An agency's mark. The GSA image-repository mark wins; only when the site has none is `fallback` (a seal or logo
 * recorded for the agency in the agency_images dataset) drawn, credited on the page that passes it.
 */
export function AgencyMark({
  name,
  className,
  fallback,
}: {
  name: string;
  className?: string | undefined;
  fallback?: { url: string; sourcePage: string } | null;
}) {
  const asset = agencyArtwork(name);
  const [failed, setFailed] = useState<string | null>(null);
  const extraFailed = useImageFailed(fallback?.url);
  const extra = !asset && fallback && !extraFailed ? fallback : null;
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1.5",
        className,
      )}
      title={
        asset
          ? `${name} · GSA image repository; no endorsement implied`
          : extra
            ? `${name} · mark from ${new URL(extra.sourcePage).hostname.replace(/^www\./, "")}`
            : name
      }
    >
      {asset && failed !== asset.path ? (
        <img
          src={asset.path}
          alt={`${name} mark`}
          className="size-full object-contain"
          loading="lazy"
          onError={() => setFailed(asset.path)}
        />
      ) : extra ? (
        <img
          src={extra.url}
          alt={`${name} mark`}
          className="size-full object-contain"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => markImageFailed(extra.url)}
        />
      ) : (
        <Building2
          className="size-5 text-slate-500"
          aria-label={`${name}: agency mark not available`}
        />
      )}
    </span>
  );
}
export function JudgePortrait({
  name,
  photo,
  className,
}: {
  name: string;
  photo: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const candidate = photo ? fileUrl(photo) : null;
  const source =
    candidate &&
    (/^https:\/\//.test(candidate) || /^\/(?!\/)/.test(candidate)) &&
    failed !== candidate
      ? candidate
      : null;
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted",
        className,
      )}
    >
      {source ? (
        <img
          src={source}
          alt={`${name}, portrait from the recorded profile`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover object-top"
          onError={() => setFailed(source)}
        />
      ) : (
        <CircleUserRound
          className="size-7 text-muted-foreground/65"
          strokeWidth={1.3}
          aria-label="No recorded portrait"
        />
      )}
    </span>
  );
}
