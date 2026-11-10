/** Optional Playwright browser check against a loopback candidate, with synthetic API fixtures. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.AFFINITY_PLAYWRIGHT_MODULE || "playwright");

const base = process.env.AFFINITY_EVAL_APP_URL || "http://127.0.0.1:3217";
const target = new URL(base);
const defaultYear = require("../src/lib/marketplace/catalog-data.json").defaultYear;
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "browser fixtures require a loopback target");
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const screening = (year) => ({ year, state: "OH", verdict: "marketplace", aptcMonthly: 100, headline: "Synthetic Marketplace result", nextSteps: [], notes: [] });
const board = (year) => ({ year, state: "OH", county: "Synthetic County", medicaidEligible: false, aptcMonthly: 100, totalPlans: 1, plansKeepingAllDoctors: 0, doctorsTotal: 0, drugsTotal: 0, notes: [], plans: [{ id: "synthetic", name: `Synthetic ${year} plan`, metal: "Silver", premiumMonthly: 400, netPremiumMonthly: 300, netPremiumAnnual: 3600, doctorsCovered: 0, doctorsTotal: 0, drugsCovered: 0, drugsTotal: 0, keepsAllDoctors: false, doctors: [], drugs: [] }] });
const nextPaint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.AFFINITY_CHROME_PATH ? { executablePath: process.env.AFFINITY_CHROME_PATH } : {}) });
  const passed = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.goto(new URL("/discover",base).href);
    await page.getByRole("button", { name: "Check my coverage" }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
    assert.equal(await page.getByLabel("Coverage year", { exact: true }).inputValue(), String(defaultYear));
    await page.getByLabel("Employer insurance offer", { exact: true }).selectOption("none");
    await page.getByLabel("Coverage year", { exact: true }).selectOption("2027");
    await page.getByLabel("State", { exact: true }).selectOption("OR");
    await page.getByLabel("ZIP code", { exact: true }).fill("97201");
    await page.getByLabel("Age for 2027 coverage").fill("40");
    await page.getByLabel("Annual household income for 2027").fill("45000");
    await page.getByRole("button", { name: "Check my coverage" }).click();
    const oregon = page.getByRole("link", { name: "Open Explore Health" });
    await oregon.waitFor({ state: "visible" });
    assert.equal(await oregon.getAttribute("href"), "https://explorehealthor.gov");
    assert.match(await page.locator(".verdict-card").innerText(), /Coverage year: 2027/);
    passed.push("Oregon 2027 official handoff and visible year");

    await page.getByLabel("Coverage year", { exact: true }).selectOption("2026");
    assert.equal(await page.locator(".verdict-card").count(), 0);
    let releaseEligibility;
    let eligibilityStarted;
    const eligibilityGate = new Promise((resolve) => { releaseEligibility = resolve; });
    const eligibilityRequest = new Promise((resolve) => { eligibilityStarted = resolve; });
    await page.route("**/api/eligibility", async (route) => {
      const input = route.request().postDataJSON();
      eligibilityStarted();
      await eligibilityGate;
      await route.fulfill(json(screening(input.year)));
    });
    await page.getByRole("button", { name: "Check my coverage" }).click();
    await eligibilityRequest;
    await page.getByLabel("Coverage year", { exact: true }).selectOption("2027");
    const eligibilityResponse = page.waitForResponse((response) => response.url().endsWith("/api/eligibility"));
    releaseEligibility();
    await eligibilityResponse;
    await nextPaint(page);
    assert.equal(await page.locator(".verdict-card").count(), 0);
    passed.push("late 2026 eligibility result cannot reappear after switching to 2027");
    await page.unroute("**/api/eligibility");
    await page.route("**/api/eligibility", (route) => route.fulfill(json(screening(route.request().postDataJSON().year))));
    await page.getByRole("button", { name: "Check my coverage" }).click();
    const compare = page.getByRole("link", { name: "Compare 2027 Marketplace plans" });
    await compare.waitFor({ state: "visible" });
    await compare.click();
    await page.waitForURL("**/plans?year=2027");
    assert.equal(await page.getByLabel("Coverage year", { exact: true }).inputValue(), "2027");
    passed.push("screening-to-plan navigation preserves the requested year");

    const doctorYears = [];
    await page.route("**/api/providers/autocomplete", (route) => {
      doctorYears.push(route.request().postDataJSON().year);
      return route.fulfill(json({ items: [{ npi: "1234567890", name: "Synthetic Doctor" }] }));
    });
    await page.getByLabel("ZIP code", { exact: true }).fill("44106");
    await page.getByRole("combobox", { name: "Add your doctors" }).fill("Smith");
    await page.getByRole("option", { name: "Synthetic Doctor" }).click();
    assert.equal(await page.getByRole("list", { name: "Selected doctors" }).count(), 1);
    await page.getByLabel("Coverage year", { exact: true }).selectOption("2026");
    assert.equal(await page.getByRole("list", { name: "Selected doctors" }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "Add your doctors" }).inputValue(), "");
    await page.getByRole("combobox", { name: "Add your doctors" }).fill("Smith");
    await page.getByRole("option", { name: "Synthetic Doctor" }).waitFor();
    assert.deepEqual(doctorYears, [2027, 2026]);
    passed.push("provider lookup uses the selected year and old selections/suggestions clear");

    await page.getByLabel("Age for 2026 coverage").fill("40");
    await page.getByLabel("Annual household income for 2026").fill("45000");
    await page.route("**/api/plans", (route) => route.fulfill(json(board(route.request().postDataJSON().year))));
    await page.getByRole("button", { name: "Find my plans" }).click();
    await page.locator(".board").waitFor();
    assert.match(await page.locator(".board").innerText(), /Coverage year: 2026/);
    await page.getByLabel("Coverage year", { exact: true }).selectOption("2027");
    assert.equal(await page.locator(".board").count(), 0);
    await page.getByLabel("Coverage year", { exact: true }).selectOption("2026");
    await page.unroute("**/api/plans");
    let releasePlans;
    let plansStarted;
    const plansGate = new Promise((resolve) => { releasePlans = resolve; });
    const plansRequest = new Promise((resolve) => { plansStarted = resolve; });
    await page.route("**/api/plans", async (route) => { plansStarted(); await plansGate; await route.fulfill(json(board(2026))); });
    await page.getByRole("button", { name: "Find my plans" }).click();
    await plansRequest;
    await page.getByLabel("Coverage year", { exact: true }).selectOption("2027");
    const plansResponse = page.waitForResponse((response) => response.url().endsWith("/api/plans"));
    releasePlans();
    await plansResponse;
    await nextPaint(page);
    assert.equal(await page.locator(".board").count(), 0);
    passed.push("old board clears and a late 2026 plan response cannot appear as 2027");
    await page.unroute("**/api/plans");
    await page.route("**/api/plans", (route) => route.fulfill(json(board(2026))));
    await page.getByRole("button", { name: "Find my plans" }).click();
    await page.getByRole("alert").filter({ hasText: "coverage year did not match" }).waitFor();
    assert.equal(await page.locator(".board").count(), 0);
    passed.push("a mismatched response year is rejected");

    fs.mkdirSync("tmp", { recursive: true });
    await page.goto(`${base}/plans?year=2027`);
    await page.screenshot({ path: "tmp/2027-plan-year-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "tmp/2027-plan-year-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    passed.push("390px layout has no horizontal overflow");

    const freshnessResponse = await page.request.get(`${base}/api/freshness`);
    assert.equal(freshnessResponse.status(), 200);
    const freshness = await freshnessResponse.json();
    assert.equal(freshness.marketplace.status, "current");
    assert.equal(freshness.marketplace.defaultYear, defaultYear);
    assert.ok(Date.parse(freshness.marketplace.checkedAt) <= Date.now());
    assert.ok(Date.parse(freshness.marketplace.expiresAt) > Date.now());
    await page.goto(`${base}/sources`);
    await page.getByRole("heading", { name: "Sources and freshness", exact: true }).waitFor();
    assert.match(await page.locator("main").innerText(), /Automatically fetching a document does not renew that review/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: "tmp/freshness-sources-mobile.png", fullPage: true });
    passed.push("real-clock receipt and source-status page distinguish source checks from policy review");

    await page.goto(`${base}/medicaid`);
    if (freshness.guidance.status === "review_required") {
      await page.getByRole("status").filter({ hasText: "awaiting a source review" }).waitFor();
      assert.equal(await page.locator(".medicaid-change-action, .medicaid-action, .medicaid-card-timing").count(), 0);
      await page.getByLabel("Your state", { exact: true }).selectOption("NY");
      assert.equal(await page.locator(".medicaid-state-alert").count(), 0);
      assert.ok(await page.getByRole("link", { name: "Open official state site" }).getAttribute("href"));
      passed.push("overdue policy summaries are withheld while official state handoffs remain available");
    }
    await context.close();
    console.log(JSON.stringify({ evaluatedAt: new Date().toISOString(), target: base, scope: "Headless Chromium with fixed synthetic API fixtures; actual local Oregon handoff. Not a screen-reader or human comprehension audit.", passed }, null, 2));
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
