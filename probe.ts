/**
 * Probe a URL with full Playwright + network intercept. Use when investigating
 * what API a SPA calls so we can target it directly or know what selector to wait for.
 *
 *   npx tsx probe.ts https://ssc.gov.in/notice-board
 */
import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: tsx probe.ts <url>");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
});
const page = await ctx.newPage();

const apiCalls: { url: string; status: number; type: string }[] = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/") || u.includes(".json")) {
    apiCalls.push({ url: u, status: res.status(), type: res.headers()["content-type"] ?? "" });
  }
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(3000); // hold a bit for late XHRs

console.log("\nAPI calls observed:");
for (const c of apiCalls) {
  console.log(`  [${c.status}] ${c.url}  (${c.type.split(";")[0]})`);
}

const html = await page.content();
console.log(`\nFinal DOM size: ${html.length.toLocaleString()} bytes`);

// Show all anchor hrefs from the rendered page
const hrefs = await page.$$eval("a[href]", (els) =>
  els.map((e) => ({ text: (e.textContent || "").trim().slice(0, 100), href: e.getAttribute("href") || "" })),
);
console.log(`\nAnchors in rendered DOM: ${hrefs.length}`);
const interesting = hrefs.filter(
  (h) =>
    !h.href.startsWith("#") &&
    !h.href.startsWith("javascript:") &&
    !h.href.startsWith("mailto:") &&
    h.text.length > 5,
);
console.log(`\nInteresting (text > 5 chars):`);
for (const h of interesting.slice(0, 30)) {
  console.log(`  ${h.text}`);
  console.log(`    → ${h.href}`);
}

await browser.close();
