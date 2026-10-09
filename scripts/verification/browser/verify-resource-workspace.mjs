import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(
  path.join(
    process.env.ATLAS_BROWSER_TOOLING_ROOT ?? path.resolve(root, "../tooling"),
    "package.json",
  ),
);
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
const base = process.env.ATLAS_BASE_URL ?? "http://127.0.0.1:5421";
const output = path.resolve(
  process.env.ATLAS_BROWSER_OUTPUT ?? path.resolve(root, "../verification/resource-workspace"),
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.ATLAS_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [],
  checks = [],
  violations = [];
page.on("pageerror", (e) => errors.push(e.message));
const requests = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname === "/api/bundles") requests.push(u.searchParams.get("file"));
});
await context.route("**/api/bundles?**", async (route) => {
  const u = new URL(route.request().url());
  const r = await fetch(
    new URL(
      u.pathname + u.search,
      process.env.ATLAS_VERIFY_BUNDLE_ORIGIN ?? "https://firastest1.com",
    ),
    { signal: AbortSignal.timeout(45000) },
  );
  const headers = Object.fromEntries(
    [...r.headers].filter(
      ([k]) => !["content-encoding", "content-length", "set-cookie"].includes(k.toLowerCase()),
    ),
  );
  await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
});
async function scan(name) {
  const r = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  violations.push(
    ...r.violations.map((v) => ({
      page: name,
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, failure: n.failureSummary })),
    })),
  );
  await page.screenshot({ path: path.join(output, name + ".png"), fullPage: true });
}
try {
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "State research atlas", exact: true }).waitFor();
  await page.locator('path[data-state="NE"]').waitFor({ timeout: 60000 });
  assert.equal(await page.locator("path[data-state]").count(), 51);
  assert.equal(
    await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link").count(),
    4,
  );
  for (const label of ["Matters", "People", "Cases & dockets", "Expert rulings"])
    assert.equal(await page.getByRole("link", { name: label, exact: true }).count(), 0);
  assert.equal(await page.locator('a[href$=".json"]').count(), 0);
  const mapHeight = await page.getByTestId("geography-map").boundingBox();
  assert(mapHeight.height < 600);
  checks.push(
    "Compact navy map, 51 canonical state/DC targets, four primary sections and no technical download links",
  );
  await scan("home-desktop");
  await page.locator('path[data-state="NE"]').focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Nebraska", level: 1, exact: true }).waitFor();
  await page.getByLabel("Resource category", { exact: true }).waitFor();
  const resourceList = page.getByRole("list", { name: "Available research resources" });
  await resourceList.locator("a").first().waitFor({ timeout: 60000 });
  assert((await resourceList.locator("a").first().getAttribute("href")).startsWith("http"));
  assert.equal(
    await page.getByRole("link", { name: /2 collections|old-import|previous-source/ }).count(),
    0,
  );
  await page.locator('a[href="/courts/neb"]').waitFor();
  assert.equal(new URL(page.url()).pathname, "/places/NE");
  checks.push(
    "Nebraska overview shows actual resource destinations and scoped court entries, rather than metadata-only cards",
  );
  await scan("nebraska-resources");
  const category = page.getByLabel("Resource category", { exact: true });
  const choices = await category
    .locator("option")
    .evaluateAll((n) => n.map((x) => ({ value: x.value, text: x.textContent })));
  assert(choices.length > 1);
  await category.selectOption(choices[1].value);
  const filteredCount = await resourceList.locator("li").count();
  assert(filteredCount > 0);
  await page
    .getByRole("searchbox", { name: "Filter this state's sources", exact: true })
    .fill("nothing-matches-123456");
  await page.getByText("No resources match these filters.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  checks.push(
    "Concise title-based resource groups and all-word search narrow the actual links; reset restores them",
  );
  await page
    .getByRole("navigation", { name: "Nebraska research" })
    .getByRole("button", { name: "Courts", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Court system", exact: true }).selectOption("Federal");
  await page.getByRole("link", { name: /District Court, D. Nebraska/ }).waitFor();
  assert.equal(await page.getByRole("link", { name: /Nebraska Supreme Court/ }).count(), 0);
  await page.getByRole("combobox", { name: "Switch state", exact: true }).selectOption("NV");
  await page.getByRole("heading", { name: "Nevada", level: 1, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has("system"), false);
  await page.getByRole("link", { name: /District Court, D. Nevada/ }).waitFor();
  assert.equal(await page.getByRole("link", { name: /D. Nebraska/ }).count(), 0);
  checks.push(
    "Scoped courts retain exact state identity; switching state clears incompatible system filters",
  );
  await page.goto(base + "/places/NE/32003?tab=counties", { waitUntil: "domcontentloaded" });
  await page.getByRole("alert").filter({ hasText: "does not belong" }).waitFor();
  checks.push("A Nevada county cannot be displayed as a Nebraska county");
  await page.goto(base + "/law", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Law & regulation", level: 1 }).waitFor();
  await page.getByRole("link", { name: /FDA.*Food, drugs/ }).click();
  await page.getByRole("textbox", { name: "Find an agency", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Find an agency", exact: true }).inputValue(),
    "Food and Drug Administration",
  );
  await page.getByRole("link", { name: /Food and Drug Administration/ }).waitFor();
  checks.push("Compact agency shortcuts open their exact filtered directory");
  await scan("agency-search");
  await page.goto(base + "/law", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "State law shortcuts", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "State law shortcuts", exact: true })
      .getByRole("link")
      .count(),
    52,
  );
  await scan("law-desktop");
  await page.goto(base + "/places/NE", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Resource category", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await scan("nebraska-mobile");
  checks.push(
    "390px resource workspace has no horizontal overflow and the primary resources remain readable",
  );
  assert(!requests.includes("corpus/insights.json"));
  assert(!requests.includes("research/court-crosswalk.json"));
  checks.push("State research routes do not fetch retired litigation datasets");
  assert.equal(errors.length, 0);
  assert.equal(violations.length, 0);
} catch (error) {
  console.error(String(error));
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  await writeFile(
    path.join(output, "failure.txt"),
    String(error) + "\n" + (await page.locator("body").innerText()),
  );
  process.exitCode = 1;
} finally {
  const report = {
    checkedAt: new Date().toISOString(),
    checks,
    errors,
    accessibilityViolations: violations,
    data: "Synthetic bounded court/agency fixture API; actual protected research bundles and pinned artwork. No production database writes.",
  };
  await writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
