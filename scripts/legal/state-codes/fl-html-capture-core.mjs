import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

export function assertFreshPrivateOutputDirectory(outputDirectory, privateRoot) {
  const output = path.resolve(outputDirectory);
  const root = path.resolve(privateRoot);
  const relative = path.relative(root, output);
  if (
    !relative ||
    relative === "." ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Output directory must be a new child directory of the private Florida capture tree.",
    );
  }
  return (async () => {
    const realRoot = await fs.realpath(root);
    const realParent = await fs.realpath(path.dirname(output));
    const resolvedParent = path.relative(realRoot, realParent);
    if (
      resolvedParent.startsWith(`..${path.sep}`) ||
      resolvedParent === ".." ||
      path.isAbsolute(resolvedParent)
    ) {
      throw new Error("Output directory resolves outside the real private Florida capture tree.");
    }
    try {
      await fs.access(output);
      throw new Error(
        "Output directory already exists; immutable capture output must use a fresh destination.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return output;
  })();
}

// Reserve a capture destination atomically after checking that it is a fresh
// child of the private root. Never create it recursively: EEXIST means a
// competing or prior run claimed the immutable destination first.
export async function claimFreshPrivateOutputDirectory(outputDirectory, privateRoot) {
  const output = await assertFreshPrivateOutputDirectory(outputDirectory, privateRoot);
  await fs.mkdir(output);
  return output;
}

export function createSerialStartGate({
  spacingMs = 1020,
  clock = () => performance.now(),
  wallClock = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isFinite(spacingMs) || spacingMs < 1000)
    throw new Error("Serial request spacing must be at least 1000 ms.");
  let lastStart = null;
  return async function nextStart() {
    while (lastStart !== null) {
      const remaining = spacingMs - (clock() - lastStart);
      if (remaining <= 0) break;
      // Add a small timer margin, then recheck the monotonic clock instead of
      // assuming setTimeout woke at the requested instant.
      await sleep(Math.ceil(remaining) + 5);
    }
    const wallStartedAt = wallClock();
    lastStart = clock();
    return new Date(wallStartedAt).toISOString();
  };
}

export function extractNativeTitleLinks(html, landingUrl) {
  const rows = [
    ...html.matchAll(
      /<a\b[^>]*href=["']([^"']*App_mode=Display_Index(?:&amp;|&)Title_Request=([IVXL]+)[^"']*)["'][^>]*>\s*TITLE\s+([IVXL]+)\s*<\/a>/gi,
    ),
  ].map((match) => {
    const rawHref = match[1];
    const href = rawHref.replace(/&amp;/g, "&");
    const url = new URL(href, landingUrl);
    if (
      url.origin !== new URL(landingUrl).origin ||
      url.pathname !== "/statutes/index.cfm" ||
      url.searchParams.get("App_mode")?.toLowerCase() !== "display_index" ||
      url.searchParams.get("Title_Request") !== match[2] ||
      match[2] !== match[3]
    ) {
      throw new Error(
        `Landing page title href failed exact publisher identity validation: ${rawHref}`,
      );
    }
    return { titleRoman: match[2], displayedRoman: match[3], rawHref, resolvedUrl: url.href };
  });
  const unique = new Map();
  for (const row of rows) {
    const existing = unique.get(row.titleRoman);
    if (
      existing &&
      (existing.rawHref !== row.rawHref || existing.displayedRoman !== row.displayedRoman)
    ) {
      throw new Error(
        `Landing page contains conflicting publisher hrefs for Title ${row.titleRoman}.`,
      );
    }
    if (!existing) unique.set(row.titleRoman, row);
  }
  return [...unique.values()];
}

export function exactHttpSuccess(status) {
  return status === 200;
}

export function capBytes(perBodyLimit, totalLimit, alreadyCapturedBytes) {
  for (const value of [perBodyLimit, totalLimit, alreadyCapturedBytes]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Byte caps and totals must be nonnegative safe integers.");
  }
  return Math.min(perBodyLimit, Math.max(0, totalLimit - alreadyCapturedBytes));
}

export function shouldStopAfterCapture({ status, transportError, capExceeded }) {
  return Boolean(transportError || capExceeded || status !== 200);
}

export function unattemptedPlanItems(plan, completedIds) {
  const completed = completedIds instanceof Set ? completedIds : new Set(completedIds);
  return plan
    .filter((item) => !completed.has(item.id))
    .map((item) => ({
      ...item,
      status: "not_attempted_after_stop",
      preStopStatus: item.status ?? null,
    }));
}
