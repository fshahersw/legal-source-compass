/**
 * Seeger Weiss matter priority, used ONLY to order the hub. A tier never asserts MDL membership, representation or a
 * firm role in any stored data; evidence of the firm's involvement is shown separately where the corpus records it.
 *
 * Source: the orchestrator's loop brief (2026-10-03), derived from the Codex full-matter coverage audit
 * (parent-matters.csv "Firm-linked source evidence" rows). Tier 1 = pending MDLs with firm-linked evidence;
 * Tier 2 = recent or closed matters that matter to the firm.
 */

export type SwTier = 1 | 2;

export type SwMatter = { mdl: number; tier: SwTier; shortName: string };

const T1: [number, string][] = [
  [3047, "Social Media Adolescent Addiction"],
  [3140, "Depo-Provera"],
  [3094, "GLP-1 RAs"],
  [3163, "GLP-1 NAION"],
  [3180, "Dupixent"],
  [3166, "Roblox"],
  [3080, "Insulin Pricing"],
  [3113, "Apple Smartphone Antitrust"],
  [3081, "Bard Implanted Port Catheter"],
  [2846, "Davol/Bard Hernia Mesh"],
  [2873, "AFFF"],
  [2804, "National Prescription Opiate"],
  [3108, "Change Healthcare"],
  [3149, "PowerSchool"],
  [3114, "AT&T"],
  [3185, "Cognizant/TriZetto"],
  [3125, "AngioDynamics Port"],
  [3144, "TikTok Minor Privacy"],
  [3043, "Acetaminophen"],
  [3060, "Hair Relaxer"],
  [3014, "Philips CPAP"],
  [2738, "J&J Talc"],
  [2741, "Roundup"],
  [3026, "Abbott/Mead Preterm Infant Nutrition"],
];

const T2: [number, string][] = [
  [2885, "3M Combat Arms"],
  [2924, "Zantac"],
  [2323, "NFL Concussion"],
  [2973, "Elmiron"],
  [2789, "PPI"],
  [2921, "Allergan Biocell"],
  [2672, "VW Diesel"],
  [2843, "Facebook Privacy"],
  [2800, "Equifax"],
  [3031, "Cattle/Beef"],
  [2606, "Benicar"],
  [2592, "Xarelto"],
  [2545, "Testosterone"],
  [2782, "Physiomesh"],
];

export const SW_MATTERS: SwMatter[] = [
  ...T1.map(([mdl, shortName]): SwMatter => ({ mdl, tier: 1, shortName })),
  ...T2.map(([mdl, shortName]): SwMatter => ({ mdl, tier: 2, shortName })),
];

const BY_MDL = new Map(SW_MATTERS.map((m) => [String(m.mdl), m]));

/** Tier entry for an MDL number string ("3140"), or null when the MDL is not on the priority list. */
export function swMatter(mdl: string): SwMatter | null {
  return BY_MDL.get(mdl) ?? null;
}

export const TIER_LABELS: Record<SwTier, string> = {
  1: "Tier 1 · pending MDLs with firm-linked evidence",
  2: "Tier 2 · recent or closed matters that matter to the firm",
};
