import asyncio, json, hashlib, re
from pathlib import Path
from playwright.async_api import async_playwright, expect
S = Path("/tmp/browser/atlas/shots"); S.mkdir(parents=True, exist_ok=True)
B = "http://localhost:8080"
results = []
def ok(name, cond, detail=""):
    results.append((name, bool(cond), detail)); print(("PASS" if cond else "FAIL"), name, detail, flush=True)

async def main():
  async with async_playwright() as p:
    br = await p.chromium.launch(headless=True)
    ctx = await br.new_context(viewport={"width":1280,"height":1800}, accept_downloads=True)
    page = await ctx.new_page()
    errs=[]; page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(B+"/", wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ok("fresh: distinct 4,633", True)
    ok("fresh: occurrences 6,372", (await page.get_by_test_id("sidebar-occurrences").inner_text())=="6,372")
    await page.wait_for_timeout(500)
    await page.screenshot(path=str(S/"library.png"))
    pager = await page.locator("text=/of 4,633/").count()
    ok("library pager shows 4,633 rows", pager>0)
    # data & exports counts
    await page.get_by_role("link", name="Data & Exports").first.click()
    facts = page.get_by_test_id("bundle-facts")
    await expect(facts).to_contain_text("258", timeout=20000)
    t = await facts.inner_text()
    for lab,val in [("Endpoint candidates","258"),("Manifest families","8"),("Imported promotions","73"),("Distinct source URLs","4,633"),("Original occurrences","6,372")]:
        ok(f"data-exports {lab}={val}", re.search(lab+r"\s+"+re.escape(val)+r"\b", t) is not None)
    ok("no 'mismatch'", "mismatch" not in t)
    ok("title literal fixed", await page.locator("h1").inner_text()=="Data & Exports")
    ok("origin bundled", "Bundled public data" in await page.get_by_test_id("bundle-origin").inner_text())
    await page.screenshot(path=str(S/"data-exports.png"))
    # overflow check
    ov = await page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    ok("data-exports no horizontal overflow", ov)
    # raw download
    async with page.expect_download() as d:
        await page.get_by_role("button", name="Download original bundle file").click()
    path = await (await d.value).path()
    h = hashlib.sha256(open(path,"rb").read()).hexdigest()
    ok("raw download sha matches bundled", h=="acb1355f66463d76e865e582a2a3cc3e62a235fe0ffa19eb69ea80fb3e7b7b3e", h)
    async with page.expect_download() as d:
        await page.get_by_role("button", name="All sources (JSON)").click()
    j = json.load(open(await (await d.value).path()))
    r0 = j["rows"][0]["imported_raw_record"]
    ok("JSON export keeps raw record + occurrences array", isinstance(r0.get("occurrences"), list) and "formatBasis" in r0 and j["row_count"]==4633)
    async with page.expect_download() as d:
        await page.get_by_role("button", name="Download text").first.click()
    txt = open(await (await d.value).path(), encoding="utf-8").read()
    ok("original file text downloadable", len(txt) > 900000, str(len(txt)))
    # reload persists
    await page.reload(wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ok("after reload still 4,633", True)
    # hash URL preserved
    await page.goto(B+"/", wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    await page.get_by_placeholder(re.compile("Search titles")).fill("generalcode.com/library/#CT")
    await page.wait_for_timeout(400)
    href = await page.locator("tbody tr a[aria-label='Open source in a new tab']").first.get_attribute("href")
    ok("hash URL preserved in link", href=="https://www.generalcode.com/library/#CT", href)
    await page.get_by_placeholder(re.compile("Search titles")).fill("?")
    await page.wait_for_timeout(400)
    href2 = await page.locator("tbody tr a[aria-label='Open source in a new tab']").first.get_attribute("href")
    ok("query URL link retains ?", "?" in (href2 or ""), href2)
    # open drawer, bookmark, review
    await page.locator("tbody tr").first.click()
    drawer = page.get_by_role("dialog")
    await expect(drawer).to_be_visible()
    dhref = await drawer.get_by_role("link", name="Open source").get_attribute("href")
    ok("drawer link equals row link", dhref==href2, dhref)
    await drawer.get_by_role("button", name="Save").click()
    await drawer.get_by_label(re.compile("Reason")).fill("short")
    await drawer.get_by_role("button", name="Accept").click()
    await page.wait_for_timeout(300)
    ok("short reason rejected (no overlay)", await drawer.locator("text=Undo last decision").count()==0)
    await drawer.get_by_label(re.compile("Reason")).fill("Checked the listing heading in the original")
    await drawer.get_by_role("button", name="Accept").click()
    await expect(drawer.get_by_role("button", name="Undo last decision")).to_be_visible()
    ok("review saved with reason", "Checked the listing heading" in await drawer.inner_text())
    await drawer.screenshot(path=str(S/"drawer.png"))
    await drawer.get_by_role("button", name="Undo last decision").click()
    await page.wait_for_timeout(300)
    ok("undo removes overlay", "Checked the listing heading" not in await drawer.inner_text())
    await drawer.get_by_label(re.compile("Reason")).fill("Needs a second look at the hash route")
    await drawer.get_by_role("button", name="Needs follow-up").click()
    await page.keyboard.press("Escape")
    await page.reload(wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ls = await page.evaluate("[localStorage.getItem('lsa.bookmarks.v1'), localStorage.getItem('lsa.review-overlays.v1'), localStorage.getItem('lsa.bundle.v1')]")
    ok("bookmark persisted after reload", ls[0] and len(json.loads(ls[0]))==1, ls[0])
    ok("review persisted after reload", ls[1] and "second look" in ls[1])
    ok("no bundle in localStorage", ls[2] is None)
    await page.get_by_role("link", name=re.compile("^Saved Sources")).first.click()
    await expect(page.locator("tbody tr")).to_have_count(1, timeout=20000)
    ok("Saved Sources shows bookmark after reload", True)
    # all views
    for name, h1 in [("Library","Library"),("Jurisdictions","Jurisdictions"),("Source Families","Source Families"),("Endpoint Explorer","Endpoint Explorer"),("Review Queue","Review Queue"),("Saved Sources","Saved Sources"),("Data & Exports","Data & Exports")]:
        await page.get_by_role("link", name=re.compile("^"+re.escape(name))).first.click()
        await expect(page.locator("h1")).to_have_text(h1, timeout=20000)
        ok(f"nav {name}", True)
        if name=="Source Families":
            await expect(page.get_by_test_id("family-cards").locator("article")).to_have_count(8)
            ok("8 family cards", True, await page.get_by_test_id("families-unassigned").inner_text())
            await page.screenshot(path=str(S/"families.png"))
        if name=="Review Queue":
            ok("review queue lists 1", await page.locator("tbody tr").count()>=1)
        if name=="Endpoint Explorer":
            await page.wait_for_timeout(300)
            ok("endpoint explorer has rows", await page.locator("text=258").count()>0 or await page.locator("tbody tr").count()>0)
    ok("no page errors", not errs, "; ".join(errs[:3]))
    await ctx.close()

    # Legacy migration
    ctx = await br.new_context(viewport={"width":1280,"height":1800}); page = await ctx.new_page()
    await page.goto(B+"/robots.txt")
    legacy = {"bundle_version":"legacy-test","sources":[{"id":"L1","url":"https://legacy.gov/x?y=1#/z","title":"Legacy row","domain":"legacy.gov"}]}
    await page.evaluate("v => { localStorage.setItem('lsa.bundle.v1', v); localStorage.setItem('lsa.bookmarks.v1', JSON.stringify({L1:true})) }", json.dumps(legacy))
    await page.goto(B+"/", wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("1", timeout=60000)
    st = await page.evaluate("localStorage.getItem('lsa.bundle.v1')")
    ok("legacy migrated and legacy key removed after IDB write", st is None)
    ok("bookmarks kept during migration", await page.evaluate("localStorage.getItem('lsa.bookmarks.v1')")=='{"L1":true}')
    await page.reload(wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("1", timeout=60000)
    ok("migrated import survives reload (from IndexedDB)", True)
    await page.get_by_role("link", name="Data & Exports").first.click()
    await page.get_by_role("button", name=re.compile("Remove my import")).click()
    await page.get_by_role("button", name="Remove import").click()
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ok("restore bundled with confirmation", True)
    ok("bookmarks kept on restore", await page.evaluate("localStorage.getItem('lsa.bookmarks.v1')")=='{"L1":true}')
    await page.reload(wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ok("restore survives reload", True)
    # successful user import
    small = Path("/tmp/browser/atlas/small.json"); small.write_text(json.dumps({"bundle_version":"mine","sources":[{"id":"a","url":"https://a.gov/?q=1#/h"},{"id":"b","url":"https://b.gov/"}]}))
    await page.set_input_files("[data-testid=bundle-file-input]", str(small))
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("2", timeout=20000)
    await expect(page.get_by_test_id("bundle-origin")).to_contain_text("Saved in this browser", timeout=20000)
    await page.reload(wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("2", timeout=60000)
    ok("user import saved in IndexedDB survives reload", True)
    await ctx.close()

    # Rejected IndexedDB transaction
    ctx = await br.new_context(viewport={"width":1280,"height":1800}); page = await ctx.new_page()
    await page.goto(B+"/data-exports", wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    await page.evaluate("() => { IDBObjectStore.prototype.put = function(){ throw new DOMException('Quota exceeded (simulated)','QuotaExceededError') } }")
    await page.set_input_files("[data-testid=bundle-file-input]", str(small))
    await expect(page.get_by_test_id("bundle-origin")).to_contain_text("NOT saved", timeout=20000)
    body = await page.locator("main").inner_text()
    ok("rejected save shown explicitly", "saving it to browser storage failed" in body)
    await page.screenshot(path=str(S/"rejected-save.png"))
    await page.reload(wait_until="domcontentloaded")
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ok("after failed save, reload shows bundled (no false claim)", True)
    # rejected localStorage
    await page.evaluate("() => { Storage.prototype.setItem = function(){ throw new DOMException('full','QuotaExceededError') } }")
    await page.get_by_role("link", name="Library", exact=True).first.click()
    await expect(page.locator("h1")).to_have_text("Library", timeout=20000)
    await page.locator("tbody tr").first.click()
    await page.get_by_role("dialog").get_by_role("button", name="Save").click()
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(300)
    ok("rejected bookmark save warned", "NOT saved" in await page.locator("main").inner_text())
    await ctx.close()

    # Default-load failure → error + retry
    ctx = await br.new_context(viewport={"width":1280,"height":1800}); page = await ctx.new_page()
    fail = {"on": True}
    async def handler(route):
        if fail["on"]: await route.fulfill(status=503, body="down")
        else: await route.continue_()
    await page.route("**/data/atlas-import-bundle.json", handler)
    await page.goto(B+"/", wait_until="domcontentloaded")
    await expect(page.get_by_role("alert").filter(has_text="could not be loaded")).to_be_visible(timeout=30000)
    ok("load failure shows error (not empty library)", "HTTP 503" in await page.locator("main").inner_text())
    await page.screenshot(path=str(S/"load-error.png"))
    fail["on"]=False
    await page.get_by_role("button", name="Retry").click()
    await expect(page.get_by_test_id("sidebar-distinct")).to_have_text("4,633", timeout=60000)
    ok("Retry recovers", True)
    await ctx.close(); await br.close()
  print("SUMMARY", sum(r[1] for r in results), "/", len(results))
asyncio.run(main())
