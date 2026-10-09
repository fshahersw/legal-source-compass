import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(
  path.join(process.env.ATLAS_BROWSER_TOOLING_ROOT ?? import.meta.dirname, "package.json"),
);
const { chromium } = require("playwright");
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../../..");
const output = path.resolve(
  process.env.ATLAS_BROWSER_OUTPUT ?? path.join(root, ".verification/limitations"),
);
const evidenceRoot = path.resolve(
  process.env.LIM_BUNDLE_DIR ?? path.join(root, "private/data/limitations"),
);
const baseUrl = process.env.ATLAS_BASE_URL ?? "http://127.0.0.1:5217";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.ATLAS_BROWSER_CHANNEL ? { channel: process.env.ATLAS_BROWSER_CHANNEL } : {}),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
let mode = "original";
const errors = [],
  checks = [],
  cache = new Map();
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/api/bundles?**", async (route) => {
  const u = new URL(route.request().url()),
    name = u.searchParams.get("file");
  if (!name?.startsWith("limitations/") || name.includes("..")) return route.continue();
  if (mode === "failed")
    return route.fulfill({ status: 503, body: "Synthetic source refresh failure" });
  if (!cache.has(name))
    cache.set(name, await readFile(path.join(evidenceRoot, name.slice("limitations/".length))));
  let b = cache.get(name);
  if (mode === "updated" && name === "limitations/sources.json") {
    const j = JSON.parse(b.toString());
    for (const source of j.sources.filter((x) => x.state === "CA"))
      source.verifiedAt = "2026-10-08T23:59:00Z";
    b = Buffer.from(JSON.stringify(j));
  }
  const p = Number(u.searchParams.get("page") ?? 0),
    size = 256 * 1024,
    sha = createHash("sha256").update(b).digest("hex");
  await route.fulfill({
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Atlas-Snapshot-Sha256": sha,
      "X-Atlas-Snapshot-Bytes": String(b.length),
      "X-Atlas-Page": String(p),
      "X-Atlas-Page-Count": String(Math.ceil(b.length / size)),
    },
    body: b.subarray(p * size, Math.min(b.length, (p + 1) * size)),
  });
});
const confirmations = [
  "I checked that this state's limitations law governs this claim.",
  "I checked the legally relevant start dates under the cited rule.",
  "I checked this claim category and statutory version against the facts.",
];
async function finishReview() {
  for (const c of confirmations) await page.getByRole("checkbox", { name: c }).check();
  await page.getByRole("button", { name: "Continue to review" }).click();
  for (const group of ["screening", "tolling", "scope", "authority"]) {
    const section = page.getByTestId("review-group-" + group);
    if (!(await section.count())) continue;
    const toggle = section.getByRole("button").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const bulk = section.getByRole("button", { name: /Mark \d+ unanswered as checked/ });
    if (await bulk.isEnabled()) await bulk.click();
  }
  await page.getByRole("button", { name: "Assess deadline", exact: true }).click();
  await page.getByTestId("guided-result").waitFor();
}
try {
  await page.goto(baseUrl + "/limitations?state=CA&claim=personal_injury", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByTestId("guided-calculator").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Continue to timeline" }).click();
  await page.locator("#guided-date-accrualDate").fill("2024-01-01");
  await finishReview();
  assert((await page.getByTestId("guided-result").innerText()).includes("Jan 1, 2026"));
  mode = "updated";
  await page.getByRole("button", { name: "Refresh source release", exact: true }).click();
  await page
    .getByText("Rule or source evidence changed", { exact: true })
    .waitFor({ timeout: 45000 });
  assert.equal(await page.getByTestId("guided-result").count(), 0);
  assert.equal(await page.locator("#guided-date-accrualDate").inputValue(), "2024-01-01");
  for (const c of confirmations)
    assert.equal(await page.getByRole("checkbox", { name: c }).isChecked(), false);
  checks.push(
    "An actual source-metadata change preserves entered dates but invalidates every legal confirmation, factor decision and result",
  );
  await finishReview();
  mode = "failed";
  await page.getByRole("button", { name: "Refresh source release", exact: true }).click();
  await page.getByText("Source refresh failed", { exact: true }).waitFor({ timeout: 45000 });
  assert.equal(await page.getByTestId("guided-result").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Assess deadline", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Print assessment", exact: true }).count(),
    0,
  );
  assert.equal(await page.getByRole("button", { name: "Export review", exact: true }).count(), 0);
  checks.push(
    "A failed network refresh suppresses the cached date and print action, and disables calculation without erasing case facts",
  );
  const report = {
    checkedAt: new Date().toISOString(),
    checks,
    errors,
    caseData:
      "Synthetic browser failure and metadata update; immutable real legal rule contents are unchanged",
  };
  await writeFile(
    path.join(output, "source-refresh-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  assert.equal(errors.length, 0);
} catch (error) {
  console.log("BROWSER_FAILURE", String(error));
  await page.screenshot({ path: path.join(output, "source-refresh-error.png"), fullPage: true });
  process.exitCode = 1;
} finally {
  await browser.close();
}
