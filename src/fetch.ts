import { Agent } from "undici";
import { spawn } from "node:child_process";
import type { SourceConfig } from "./types.js";

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

export async function fetchPage(source: SourceConfig): Promise<string> {
  if (source.renderJs) return fetchWithPlaywright(source);
  if (source.useCurl) return fetchWithCurl(source);
  return fetchWithHttp(source);
}

async function fetchWithCurl(source: SourceConfig): Promise<string> {
  const timeoutSec = Math.ceil((source.timeoutMs ?? 45_000) / 1000);
  const headers = { ...DEFAULT_HEADERS, ...source.headers };
  const args: string[] = [
    "--silent",
    "--show-error",
    "--location",
    "--max-time", String(timeoutSec),
    "--max-redirs", "10",
    "--compressed",
  ];
  if (source.insecureTls) args.push("--insecure");
  if (source.method === "POST") args.push("--request", "POST");
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  if (source.formData) {
    for (const [k, v] of Object.entries(source.formData)) {
      args.push("--form", `${k}=${v}`);
    }
  }
  args.push(source.url);

  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/curl", args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        if (!stdout.trim()) reject(new Error("curl returned empty body"));
        else resolve(stdout);
      } else {
        reject(new Error(`curl exit ${code}: ${stderr.trim().slice(0, 200)}`));
      }
    });
    child.on("error", (e) => reject(new Error(`curl spawn failed: ${e.message}`)));
  });
}

async function fetchWithHttp(source: SourceConfig): Promise<string> {
  const headers = { ...DEFAULT_HEADERS, ...source.headers };
  const timeout = source.timeoutMs ?? 45_000;
  const opts: RequestInit & { dispatcher?: unknown } = {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(timeout),
  };
  if (source.insecureTls) opts.dispatcher = insecureAgent;
  const res = await fetch(source.url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

// Lazy-loaded so installs without playwright still work for the HTTP-only path.
let browserPromise: Promise<unknown> | null = null;

async function getBrowser(): Promise<any> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const { chromium } = await import("playwright");
        return chromium.launch({ headless: true });
      } catch (e) {
        throw new Error(
          `Playwright not installed but renderJs:true was requested. Run "npm i playwright && npx playwright install chromium". Original: ${(e as Error).message}`,
        );
      }
    })();
  }
  return browserPromise;
}

async function fetchWithPlaywright(source: SourceConfig): Promise<string> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ userAgent: USER_AGENT });
  const page = await ctx.newPage();
  try {
    await page.goto(source.url, {
      waitUntil: "domcontentloaded",
      timeout: source.timeoutMs ?? 45_000,
    });
    // Give SPAs a moment to hydrate after DOMContentLoaded.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return await page.content();
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      await (browser as any).close();
    } catch {
      // best effort
    }
    browserPromise = null;
  }
}
