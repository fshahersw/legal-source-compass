/**
 * The mark shown with a court's photograph: the verified official artwork for that exact court id, else the community
 * mark registered for that id and recorded system, else a stored court image, else a labelled court-type emblem
 * (never presented as a seal). Same precedence as CourtArtwork.
 */
import {
  artworkForCourtId,
  classifyCourtType,
  courtTypeLabels,
  recordedCourtArtwork,
  type CourtTypeGroup,
} from "@/lib/courts/artwork";
import { buildEntityView } from "@/lib/external/entityView";
import { plainMediaLabel } from "@/lib/corpus/heldMedia";
import { fileUrl } from "@/lib/external/groups";
import { communityCourtArtwork } from "@/lib/visuals/registry";

export type CourtMark =
  | {
      kind: "verified";
      src: string;
      shape: "seal" | "banner" | "photo";
      label: string;
      description: string;
      sourcePage: string;
      retrievedAt: string;
      group: CourtTypeGroup;
    }
  | {
      kind: "community";
      src: string;
      shape: "seal";
      label: string;
      description: string;
      sourcePage: string;
      license: string;
      group: CourtTypeGroup;
    }
  | {
      kind: "recorded";
      src: string;
      shape: "seal";
      label: string;
      description: string;
      group: CourtTypeGroup;
    }
  | { kind: "type"; label: string; description: string; group: CourtTypeGroup };

export function resolveCourtMark(
  courtId: string,
  system: string | null | undefined,
  type: string | null | undefined,
  recordedLinks: readonly { url: string; label: string }[] = [],
): CourtMark {
  const group = classifyCourtType(system, type);
  const verified = artworkForCourtId(courtId, system);
  if (verified)
    return {
      kind: "verified",
      src: verified.assetPath,
      shape: verified.kind,
      label:
        verified.kind === "seal"
          ? "Verified official court artwork"
          : "Mark shown on the court homepage",
      description: verified.description,
      sourcePage: verified.sourcePage,
      retrievedAt: verified.retrievedAt,
      group,
    };
  const community = communityCourtArtwork(courtId, system);
  if (community)
    return {
      kind: "community",
      src: community.path,
      shape: "seal",
      label: "Court mark · Free Law Project",
      description: community.name,
      sourcePage: community.source,
      license: community.license,
      group,
    };
  const recorded = recordedCourtArtwork(recordedLinks);
  if (recorded)
    return {
      kind: "recorded",
      src: fileUrl(recorded.url),
      shape: "seal",
      label: "Recorded court image",
      description: plainMediaLabel(recorded.label),
      group,
    };
  return {
    kind: "type",
    label: "Court type",
    description: courtTypeLabels[group],
    group,
  };
}

/** Recorded system and type of a court_spine record, derived exactly as the court page derives them. */
export function recordedSystemAndType(raw: Record<string, unknown> | null | undefined): {
  system: string;
  type: string;
} {
  const view = buildEntityView(raw ?? {});
  const facts = new Map(view.facts.map(([key, value]) => [key.toLowerCase(), value]));
  const fact = (key: string) =>
    typeof facts.get(key) === "string" ? String(facts.get(key)) : null;
  const cells = (raw?.["cells"] && typeof raw["cells"] === "object" ? raw["cells"] : {}) as Record<
    string,
    unknown
  >;
  return {
    system: String(raw?.["system"] ?? cells["system"] ?? fact("system") ?? "Unknown system"),
    type: String(
      raw?.["type"] ?? cells["type"] ?? fact("type") ?? view.subtitle?.split(" · ")[0] ?? "Court",
    ),
  };
}
