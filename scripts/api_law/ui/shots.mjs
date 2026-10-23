// Screenshots and checks of the api-law pages: node shots.mjs <outDir> <path> [path...]
// For each path at 1280x800 and 1024x700, light and dark: HTTP status, h1, console errors, horizontal overflow, result
// rows listed, visible state notes; full-page screenshots. Optional per-path action after "::" — "open" expands the
// first collapsed section (aria-expanded=false) and waits for its text.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = require("playwright");
const [outDir, ...specs] = process.argv.slice(2);
const BASE = process.env.BASE_URL || "http://127.0.0.1:4517";
fs.mkdirSync(outDir, { recursive: true });
const VIEWS = (process.env.VIEWS || "1280x800:light,1024x700:light,1280x800:dark,1024x700:dark").split(",");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--disable-dev-shm-usage", "--renderer-process-limit=1", "--js-flags=--max-old-space-size=768"],
});
const report = [];
for (const view of VIEWS) {
  const [size, scheme] = view.split(":");
  const [width, height] = size.split("x").map(Number);
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  for (const spec of specs) {
    const [p, action] = spec.split("::");
    const errors = [];
    let page = null;
    let status = null;
    let info = { title: null, hOverflow: null, notes: [], results: 0, panels: [], tabs: [] };
    const name = `${(p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home").slice(0, 80)}${action ? "-" + action : ""}-${width}-${scheme}`;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        page = await context.newPage();
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text().slice(0, 300));
        });
        page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
        try {
          const res = await page.goto(BASE + p, { waitUntil: "load", timeout: 120000 });
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
          status = res ? res.status() : null;
        } catch (e) {
          errors.push("goto: " + String(e).slice(0, 200));
        }
        // the dev server may reload once while it optimizes dependencies: wait for the shell's h1, else retry
        const ok = await page.locator("h1").first().waitFor({ timeout: 30000 }).then(() => true, () => false);
        if (ok) break;
        errors.push(`attempt ${attempt + 1}: no h1`);
        await page.close().catch(() => undefined);
        page = null;
      }
      if (!page) throw new Error("page did not render");
      if (scheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
      for (let i = 0; i < 30; i++) {
        if (!(await page.locator('[aria-busy="true"], .animate-pulse').count())) break;
        await page.waitForTimeout(500);
      }
      if (action === "open") {
        // the first collapsed section inside main content (never the sidebar)
        const mine = page.locator('section[aria-label="Legal proceedings in Form 10-K"] button[aria-expanded="false"]');
        const b = (await mine.count()) ? mine.first() : page.locator('main section button[aria-expanded="false"]').first();
        if (await b.count()) await b.scrollIntoViewIfNeeded().catch(() => undefined);
        if (await b.count()) {
          await b.click();
          await page.waitForTimeout(400);
          for (let i = 0; i < 20; i++) {
            if (!(await page.locator(".animate-pulse").count())) break;
            await page.waitForTimeout(500);
          }
        }
      }
      await page.waitForTimeout(500);
      info = await page.evaluate(() => ({
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        notes: [...document.querySelectorAll('[role="status"], [role="alert"]')]
          .map((e) => e.textContent.replace(/\s+/g, " ").trim().slice(0, 160))
          .filter(Boolean)
          .slice(0, 4),
        results: document.querySelectorAll("main li").length,
        panels: [...document.querySelectorAll("section[aria-label]")].map((s) => s.getAttribute("aria-label")).slice(0, 12),
        tabs: [...document.querySelectorAll('nav[aria-label$="sections"] a')].map((a) => a.textContent.trim()),
      }));
      await page.screenshot({ path: path.join(outDir, name + ".png"), fullPage: true }).catch((e) => errors.push("shot: " + e));
    } catch (e) {
      errors.push("failed: " + String(e).slice(0, 200));
    }
    report.push({ path: p, action: action ?? null, width, scheme, status, errors, ...info, file: name + ".png" });
    if (page) await page.close().catch(() => undefined);
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  }
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
for (const r of report)
  console.log(
    `${r.width} ${r.scheme} ${r.path}${r.action ? "::" + r.action : ""} status=${r.status} h1="${r.title}" li=${r.results} hOverflow=${r.hOverflow} errors=${r.errors.length}${r.notes.length ? " notes=" + JSON.stringify(r.notes) : ""}${r.errors.length ? " first=" + JSON.stringify(r.errors[0]) : ""}`,
  );
