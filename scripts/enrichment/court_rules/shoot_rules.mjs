// Visual check of the court rules panel and the constitution / regulation pages, with interactions.
//   LSC_PORT=5204 node --env-file=private/scratch/env.sh private/scratch/with_server.mjs scripts/enrichment/court_rules/shoot_rules.mjs <outDir> [1280,1024]
// Saves element and viewport screenshots and prints console errors per step.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");

const [outDir, widthsArg = "1280,1024"] = process.argv.slice(2);
const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const log = [];

async function panel(page) {
  const el = page.locator('section[aria-label="Court rules"]').first();
  await el.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  return el;
}

async function step(name, width, fn) {
  const context = await browser.newContext({ viewport: { width, height: width >= 1280 ? 800 : 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));
  let note = "";
  try {
    note = (await fn(page, (file) => path.join(outDir, `${name}-${file}-${width}.png`))) || "";
  } catch (e) {
    note = "FAILED: " + String(e).slice(0, 200);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1).catch(() => null);
  log.push({ name, width, errors, overflow, note });
  console.log(`${width} ${name} overflow=${overflow} errors=${errors.length} ${note}`);
  await context.close();
}

for (const width of widthsArg.split(",").map(Number)) {
  await step("cand", width, async (page, shot) => {
    await page.goto(BASE + "/courts/cand", { waitUntil: "networkidle", timeout: 90000 });
    let el = await panel(page);
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: shot("points") });
    await el.getByRole("button", { name: /^Page limit/ }).click();
    await page.waitForTimeout(2500);
    await el.screenshot({ path: shot("points-page-limit") });
    await el.getByRole("tab", { name: "Rule documents" }).click();
    await page.waitForTimeout(800);
    await el.screenshot({ path: shot("documents") });
    await el.getByRole("tab", { name: "Search rule text" }).click();
    await el.getByRole("searchbox").or(el.locator("input")).first().fill("summary judgment");
    await el.locator("input").first().press("Enter");
    await page.waitForTimeout(4000);
    await el.screenshot({ path: shot("search") });
    await el.locator("li button[aria-expanded]").first().click();
    await page.waitForTimeout(3000);
    await el.screenshot({ path: shot("search-open") });
    // a link to the official text opens the source panel
    await el.getByRole("link", { name: /Official text/ }).first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: shot("source-panel") });
    return "ok";
  });
  for (const id of ["minn", "reg-ST-nv_state", "nvd", "canb", "calctapp", "ca9"]) {
    await step(id, width, async (page, shot) => {
      await page.goto(BASE + "/courts/" + id, { waitUntil: "networkidle", timeout: 90000 });
      const el = await panel(page);
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: shot("panel") });
      const docsTab = el.getByRole("tab", { name: "Rule documents" });
      if (await docsTab.count()) {
        await docsTab.click();
        await page.waitForTimeout(800);
        await el.screenshot({ path: shot("documents") });
      }
      return (await el.innerText()).split("\n").slice(0, 2).join(" | ").slice(0, 160);
    });
  }
  await step("const-NY", width, async (page, shot) => {
    await page.goto(BASE + "/law/constitutions/NY", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot("view") });
    await page.getByRole("button", { name: /Article III/ }).first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("article-III") });
    await page.locator("#state-constitution-search").fill("jury");
    await page.locator("#state-constitution-search").press("Enter");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("search") });
    return "ok";
  });
  await step("const-index", width, async (page, shot) => {
    await page.goto(BASE + "/law/constitutions?q=eminent%20domain", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("search"), fullPage: true });
    return "ok";
  });
  await step("const-KY", width, async (page, shot) => {
    await page.goto(BASE + "/law/constitutions/KY", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("view") });
    return "ok";
  });
  await step("reg-VA", width, async (page, shot) => {
    await page.goto(BASE + "/law/regulations/VA?q=banking", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("filtered") });
    return "ok";
  });
}
await browser.close();
fs.writeFileSync(path.join(outDir, "steps.json"), JSON.stringify(log, null, 2));
