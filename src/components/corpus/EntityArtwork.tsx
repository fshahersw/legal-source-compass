import { Building2, CircleUserRound, MapPin } from "lucide-react";
import { useState } from "react";
import { agencyArtwork, stateArtwork } from "@/lib/visuals/registry";
import { canonicalState } from "@/lib/corpus/stateHub";
import { fileUrl } from "@/lib/external/groups";
import { cn } from "@/lib/utils";
export function StateMark({ state, className }: { state: string; className?: string }) {
  const identity = canonicalState(state),
    asset = stateArtwork(state);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-[var(--blue-tint)] p-2",
        className,
      )}
      title={
        identity
          ? `${identity.name} geographic outline — not a government seal`
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
    </span>
  );
}
export function AgencyMark({ name, className }: { name: string; className?: string }) {
  const asset = agencyArtwork(name);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1.5",
        className,
      )}
      title={asset ? `${name} · GSA image repository; no endorsement implied` : name}
    >
      {asset && failed !== asset.path ? (
        <img
          src={asset.path}
          alt={`${name} mark`}
          className="size-full object-contain"
          loading="lazy"
          onError={() => setFailed(asset.path)}
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
