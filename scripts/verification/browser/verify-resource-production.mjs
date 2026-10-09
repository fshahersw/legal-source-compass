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
const base = process.env.ATLAS_PRODUCTION_ORIGIN ?? "https://firastest1.com";
const output = path.resolve(root, "../verification/resource-production");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const checks = [],
  errors = [],
  failures = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 500 && new URL(r.url()).origin === base)
    failures.push({ path: new URL(r.url()).pathname, status: r.status() });
});
try {
  let found = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
    try {
      await page
        .locator('[data-ui-release="resource-workspace-20261009"]')
        .waitFor({ timeout: 45000 });
      found = true;
      break;
    } catch {
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }
  assert(found, "Production has not served the committed resource-workspace release");
  await page.locator('path[data-state="NE"]').waitFor();
  assert.equal(await page.locator("path[data-state]").count(), 51);
  checks.push("Live custom domain serves the new UI release and all 51 state/DC map targets");
  await page.screenshot({ path: path.join(output, "production-home.png"), fullPage: true });
  await page.goto(base + "/places/NE", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Nebraska", level: 1, exact: true }).waitFor();
  await page
    .getByRole("list", { name: "Available research resources" })
    .locator("a")
    .first()
    .waitFor();
  await page.locator('a[href="/courts/neb"]').waitFor();
  assert.equal(
    await page
      .getByText("Some resources could not load; this list is incomplete.", { exact: true })
      .count(),
    0,
  );
  checks.push(
    "Live Nebraska page loads real research resources and court entries without fixture interception",
  );
  await page.screenshot({ path: path.join(output, "production-nebraska.png"), fullPage: true });
  await page
    .getByRole("navigation", { name: "Nebraska research", exact: true })
    .getByRole("button", { name: "Courts", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search this state's courts", exact: true }).waitFor();
  await page.locator('a[href="/courts/neb"]').waitFor();
  checks.push("Live state-filtered court directory loads from the configured production corpus");
  assert.equal(
    await page.getByRole("link", { name: /^Nebraska Attorney General Reports/ }).count(),
    0,
  );
  assert.equal(await page.getByRole("link", { name: /^Nebraska Courts(?:\s|$)/ }).count(), 0);
  checks.push("Known non-court reference collections are not presented as individual courts");
  await page
    .getByRole("navigation", { name: "Nebraska research", exact: true })
    .getByRole("button", { name: "Judges", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search this state's judges", exact: true }).waitFor();
  await page.locator('a[href^="/judges/"]').first().waitFor();
  checks.push("Live judicial directory returns production profiles inside the selected state");
  await page.goto(base + "/law", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: "Agency shortcuts", exact: true }).waitFor();
  assert.equal(await page.locator('a[href$=".json"]').count(), 0);
  checks.push(
    "Live law workspace renders compact agency and state navigation without JSON download links",
  );
  await page.goto(base + "/limitations?state=CA&claim=personal_injury", {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("guided-calculator").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Export review|Export full assessment|Export coverage/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Continue to timeline", exact: true }).click();
  await page.locator("#guided-date-accrualDate").waitFor();
  checks.push(
    "Live calculator loads the retained rule release with progressive inputs and no primary JSON exports",
  );
  assert.equal(errors.length, 0);
} catch (error) {
  console.error(String(error));
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  await writeFile(
    path.join(output, "failure.txt"),
    String(error) + "\n" + (await page.locator("body").innerText()),
  );
  process.exitCode = 1;
} finally {
  const result = {
    checkedAt: new Date().toISOString(),
    origin: base,
    uiRelease: "resource-workspace-20261009",
    checks,
    errors,
    failedResponses: failures,
    fixturesUsed: false,
    authenticatedDataBypass: false,
  };
  await writeFile(path.join(output, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
