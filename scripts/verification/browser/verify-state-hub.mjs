import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(
  path.join(process.env.ATLAS_BROWSER_TOOLING_ROOT ?? import.meta.dirname, "package.json"),
);
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
const base = process.env.ATLAS_BASE_URL ?? "http://127.0.0.1:5221";
const output = path.resolve(process.env.ATLAS_BROWSER_OUTPUT ?? ".verification/state-hub");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.ATLAS_BROWSER_CHANNEL ?? "msedge",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [],
  requests = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.pathname === "/api/bundles") requests.push(url.searchParams.get("file"));
});
if (process.env.ATLAS_VERIFY_BUNDLE_ORIGIN) {
  const origin = new URL(process.env.ATLAS_VERIFY_BUNDLE_ORIGIN);
  await context.route("**/api/bundles?**", async (route) => {
    const incoming = new URL(route.request().url());
    const response = await fetch(new URL(incoming.pathname + incoming.search, origin), {
      signal: AbortSignal.timeout(45000),
    });
    const headers = Object.fromEntries(
      [...response.headers].filter(
        ([key]) =>
          !["content-encoding", "content-length", "set-cookie"].includes(key.toLowerCase()),
      ),
    );
    await route.fulfill({
      status: response.status,
      headers,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
try {
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("heading", { name: "A clearer view of the law", exact: true }).waitFor();
  const sidebar = page.locator("aside").first();
  for (const name of ["States & courts", "Law & regulation", "Time limits", "Sources"])
    assert(await sidebar.getByRole("link", { name, exact: true }).count());
  for (const word of ["Matters", "MDLs", "Cases & dockets", "Expert rulings", "People"])
    assert.equal(await sidebar.getByRole("link", { name: word, exact: true }).count(), 0);
  checks.push("Primary navigation has four research sections and no retired litigation entries");
  await page
    .getByRole("button", { name: "Open Nebraska", exact: true })
    .waitFor({ timeout: 60000 });
  assert.equal(await page.locator("svg [data-state]").count(), 51);
  await page.getByRole("button", { name: "Open Nebraska", exact: true }).click();
  await page.getByRole("heading", { name: "Nebraska", exact: true, level: 1 }).waitFor();
  await page.locator("[data-county]").first().waitFor({ timeout: 60000 });
  assert((await page.locator("[data-county]").count()) > 0);
  assert.equal(new URL(page.url()).pathname, "/places/NE");
  assert.equal(
    await page
      .locator("[data-county]")
      .evaluateAll((nodes) =>
        nodes.every((node) => node.getAttribute("data-county").startsWith("31")),
      ),
    true,
  );
  checks.push("Nebraska geometry opens Nebraska; every displayed county belongs to FIPS 31");
  await page
    .getByRole("navigation", { name: "Nebraska research" })
    .getByRole("button", { name: "Courts", exact: true })
    .click();
  assert.equal(new URL(page.url()).searchParams.get("tab"), "courts");
  await page.getByRole("textbox", { name: "Search this state's courts" }).fill("district");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "district");
  await page.getByRole("combobox", { name: "Court system", exact: true }).selectOption("Federal");
  await page.getByRole("combobox", { name: "Switch state", exact: true }).selectOption("NV");
  await page.getByRole("heading", { name: "Nevada", exact: true, level: 1 }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has("q"), false);
  assert.equal(new URL(page.url()).searchParams.has("system"), false);
  checks.push("Court filters are URL-backed and switching state clears incompatible filters");
  await page
    .getByRole("navigation", { name: "Nevada research" })
    .getByRole("button", { name: "Judges", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search this state's judges" }).waitFor();
  checks.push("Judicial directory is reachable inside the state hub");
  await page.screenshot({ path: path.join(output, "state-judges-desktop.png"), fullPage: true });
  await page.goto(base + "/places/ZZ", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "State not found", exact: true }).waitFor();
  checks.push("Unknown states are not relabelled as a real jurisdiction");
  await page.goto(base + "/law", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Food and Drug Administration/ }).click();
  await page.getByRole("textbox", { name: "Find an agency", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Find an agency", exact: true }).inputValue(),
    "Food and Drug Administration",
  );
  checks.push("Featured agency opens its filtered directory rather than an unrelated landing page");
  await page.goto(base + "/places/NE", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Nebraska", exact: true, level: 1 }).waitFor();
  await page.locator("[data-county]").first().waitFor({ timeout: 60000 });
  assert((await page.locator("[data-county]").count()) > 0);
  await page.screenshot({ path: path.join(output, "nebraska-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "nebraska-mobile.png"), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push("390px state page has no horizontal page overflow");
  assert(!requests.includes("corpus/insights.json"));
  assert(!requests.includes("research/court-crosswalk.json"));
  checks.push("State, agency and law navigation does not download the removed case catalog");
  const a11y = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const violations = a11y.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    targets: v.nodes.map((n) => n.target),
  }));
  const report = {
    checkedAt: new Date().toISOString(),
    base,
    checks,
    errors,
    accessibilityViolations: violations,
    bundleSource: process.env.ATLAS_VERIFY_BUNDLE_ORIGIN ?? "deployed application",
    directoryDataVerified: false,
  };
  await writeFile(path.join(output, "state-hub-browser.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(errors.length, 0);
  assert.equal(violations.length, 0);
} catch (error) {
  console.error(String(error));
  await page.screenshot({ path: path.join(output, "state-hub-error.png"), fullPage: true });
  console.log((await page.locator("body").innerText()).slice(0, 3000));
  process.exitCode = 1;
} finally {
  await browser.close();
}
