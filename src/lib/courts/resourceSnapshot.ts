import { z } from "zod";
import { courtResourceDestination, type CourtResource } from "./resources.ts";

export const COURT_RESOURCE_SNAPSHOT = "/data/court-resources/official-links.json";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const publicHttps = z
  .string()
  .max(2000)
  .refine((value) => {
    if (/\s/.test(value)) return false;
    const url = courtResourceDestination(value);
    if (!url || url.protocol !== "https:" || (url.port && url.port !== "443")) return false;
    return (
      url.hostname !== "localhost" && !url.hostname.includes(":") && !/^[\d.]+$/.test(url.hostname)
    );
  }, "A public HTTPS source is required");

export const courtResourceSnapshotSchema = z
  .object({
    schema: z.literal("court-resources/1"),
    release: z.string().min(1).max(80),
    generatedAt: z.string().datetime({ offset: true }),
    resources: z
      .array(
        z
          .object({
            id: z.string().regex(/^resource:[a-f0-9]{64}$/),
            courtId: z.string().regex(/^[a-z0-9_-]{1,80}$/),
            courtName: z.string().min(1).max(300),
            courtSystem: z.enum(["Federal", "State"]),
            label: z.string().min(1).max(1000),
            url: publicHttps,
            kind: z.enum(["rules", "forms", "filing", "fees", "help", "website"]),
            status: z.literal("source_link_observed"),
            provenance: z
              .object({
                sourcePage: publicHttps,
                sourceRecord: z.string().min(1).max(500),
                capturedAt: z.string().datetime({ offset: true }),
                responseSha256: sha256,
                receiptSha256: sha256,
              })
              .strict(),
            review: z
              .object({
                decision: z.literal("approved"),
                reviewer: z.string().min(1).max(200),
                reviewedAt: z.string().datetime({ offset: true }),
                note: z.string().min(1).max(2000),
              })
              .strict(),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()
  .superRefine((bundle, context) => {
    const ids = new Set<string>();
    const destinations = new Set<string>();
    const identities = new Map<string, string>();
    bundle.resources.forEach((resource, index) => {
      const parsedUrl = courtResourceDestination(resource.url);
      const destination = `${resource.courtId}\u0000${parsedUrl?.href ?? resource.url}`;
      const identity = `${resource.courtName}\u0000${resource.courtSystem}`;
      if (ids.has(resource.id) || destinations.has(destination))
        context.addIssue({
          code: "custom",
          path: ["resources", index],
          message: "Duplicate court resource",
        });
      if (identities.has(resource.courtId) && identities.get(resource.courtId) !== identity)
        context.addIssue({
          code: "custom",
          path: ["resources", index],
          message: "Conflicting court identity",
        });
      if (!courtResourceDestination(resource.url, resource.courtSystem))
        context.addIssue({
          code: "custom",
          path: ["resources", index],
          message: "Court system conflicts with destination",
        });
      ids.add(resource.id);
      destinations.add(destination);
      identities.set(resource.courtId, identity);
    });
  });

export type CourtResourceSnapshot = z.infer<typeof courtResourceSnapshotSchema>;
export type ReviewedCourtResource = CourtResource & {
  sourceLabel?: string;
  provenance?: CourtResourceSnapshot["resources"][number]["provenance"];
};
export type CourtResourceSnapshotResult =
  { status: "available"; snapshot: CourtResourceSnapshot } | { status: "not-published" };

export async function loadCourtResourceSnapshot(
  signal?: AbortSignal,
): Promise<CourtResourceSnapshotResult> {
  const { fetchBundleSnapshot } = await import("@/lib/private-data/client");
  const response = await fetchBundleSnapshot(
    COURT_RESOURCE_SNAPSHOT,
    signal ? { signal } : undefined,
  );
  if (response.status === 404) return { status: "not-published" };
  if (!response.ok) throw new Error("The reviewed court resource snapshot could not be loaded.");
  const parsed = courtResourceSnapshotSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The reviewed court resource snapshot failed validation.");
  return { status: "available", snapshot: parsed.data };
}

/** Both exact ID and recorded court system must agree; never match a name, caption or website suffix. */
export function mergeCourtResourceSnapshot(
  stored: CourtResource[],
  snapshot: CourtResourceSnapshot | null,
  courtId: string,
  system?: string | null,
): ReviewedCourtResource[] {
  const result: ReviewedCourtResource[] = stored.map((resource) => ({ ...resource }));
  const byUrl = new Map(result.map((resource, index) => [new URL(resource.url).href, index]));
  for (const resource of snapshot?.resources ?? []) {
    if (
      resource.courtId !== courtId ||
      resource.courtSystem.toLowerCase() !== system?.trim().toLowerCase()
    )
      continue;
    const key = new URL(resource.url).href;
    const index = byUrl.get(key);
    if (index !== undefined) {
      // Retain the corpus label; attach the independently captured source evidence to its exact URL.
      result[index] = {
        ...result[index]!,
        sourceLabel: resource.label,
        kind: resource.kind,
        provenance: resource.provenance,
      };
    } else {
      byUrl.set(key, result.length);
      result.push({
        url: resource.url,
        label: resource.label,
        host: new URL(resource.url).host,
        kind: resource.kind,
        recordedIn: "Reviewed court website capture",
        provenance: resource.provenance,
      });
    }
  }
  return result;
}
