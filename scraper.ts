/**
 * GovtGate vacancy scraper — config-driven, parallel, set-based diff.
 *
 * Pipeline per source:
 *   1. Fetch page (HTTP, or Playwright if renderJs)
 *   2. Extract candidate links (scoped by containerSelector + filtered by url/keyword rules)
 *   3. Diff against state.json (Set semantics — no windowed-array trim bug)
 *   4. Append net-new to result list
 *
 * Cross-source: pool.ts runs CONCURRENCY sources in parallel.
 *
 * State: links keyed by href, age-evicted at 1y. First-run treats all current links as
 * "already seen" — no backlog spam.
 *
 * Run:
 *   npx tsx scraper.ts            # one pass
 *   npx tsx scraper.ts --bootstrap # alias; same one-pass behaviour
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract, dedupeKey } from "./src/extract.js";
import { fetchPage, closeBrowser } from "./src/fetch.js";
import { pool } from "./src/pool.js";
import { loadState, saveState, backupStateDaily } from "./src/state.js";
import { notifyTelegram, formatMessage } from "./src/notify.js";
import type { SourceConfig, CheckResult, State } from "./src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, "sources.json");

const CONCURRENCY_HTTP = 10;
const CONCURRENCY_JS = 3; // Playwright is heavy, limit harder

async function checkSource(source: SourceConfig, state: State): Promise<CheckResult> {
  const start = Date.now();
  try {
    const html = await fetchPage(source);
    const links = extract(html, source);
    // Diagnostic: when a fetch succeeds but yields 0 links, the response was either
    // a server stub or the urlPattern doesn't match what came back. Log size + a
    // small head/tail so we can tell which without bringing the whole body home.
    if (links.length === 0) {
      const head = html.slice(0, 160).replace(/\s+/g, " ").trim();
      const tail = html.slice(-120).replace(/\s+/g, " ").trim();
      console.log(`    ↳ [${source.id}] 0 links from ${html.length}B body. head="${head}" tail="${tail}"`);
    }
    const prevState = state[source.id];
    const isFirstRun = !prevState;
    const now = new Date().toISOString();

    if (isFirstRun) {
      const linksMap: Record<string, (typeof links)[0]> = {};
      for (const l of links) linksMap[dedupeKey(l, source)] = l;
      state[source.id] = { links: linksMap, lastCheckedAt: now };
      return { source, added: [], total: links.length, durationMs: Date.now() - start, isFirstRun };
    }

    const seen = prevState.links;
    const added = links.filter((l) => !seen[dedupeKey(l, source)]);
    for (const l of added) seen[dedupeKey(l, source)] = l;
    prevState.lastCheckedAt = now;
    delete prevState.lastError;

    return { source, added, total: links.length, durationMs: Date.now() - start, isFirstRun };
  } catch (e) {
    const message = (e as Error).message;
    if (state[source.id]) {
      state[source.id].lastError = message;
      state[source.id].lastCheckedAt = new Date().toISOString();
    }
    return {
      source,
      added: [],
      total: 0,
      durationMs: Date.now() - start,
      isFirstRun: false,
      error: message,
    };
  }
}

function logResult(r: CheckResult) {
  const name = r.source.name.padEnd(28);
  const ms = `${r.durationMs}ms`.padStart(7);
  if (r.error) {
    console.log(`  ✗ ${name} ${ms}  ERROR: ${r.error}`);
  } else if (r.isFirstRun) {
    console.log(`  ◌ ${name} ${ms}  bootstrapped (${r.total} links seeded)`);
  } else {
    const tag = r.added.length > 0 ? "★" : "✓";
    console.log(`  ${tag} ${name} ${ms}  ${r.added.length} new / ${r.total} total`);
  }
}

async function main() {
  const allSources: SourceConfig[] = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  const sources = allSources.filter((s) => !s.disabled);
  const skipped = allSources.length - sources.length;
  const state = loadState();

  console.log(
    `[${new Date().toISOString()}] Checking ${sources.length} sources${skipped ? ` (${skipped} disabled)` : ""}…`,
  );
  const passStart = Date.now();

  // Split: HTTP vs JS-rendered. Playwright runs serially-ish; HTTP runs wide.
  const httpSources = sources.filter((s) => !s.renderJs);
  const jsSources = sources.filter((s) => s.renderJs);

  const [httpResults, jsResults] = await Promise.all([
    pool(httpSources, CONCURRENCY_HTTP, (s) =>
      checkSource(s, state).then((r) => {
        logResult(r);
        return r;
      }),
    ),
    pool(jsSources, CONCURRENCY_JS, (s) =>
      checkSource(s, state).then((r) => {
        logResult(r);
        return r;
      }),
    ),
  ]);

  const results = [...httpResults, ...jsResults];
  const passMs = Date.now() - passStart;

  saveState(state);
  backupStateDaily(state);
  await closeBrowser();

  const errored = results.filter((r) => r.error).length;
  const withNew = results.filter((r) => r.added.length > 0);
  const newCount = withNew.reduce((acc, r) => acc + r.added.length, 0);

  console.log(
    `\nPass complete in ${(passMs / 1000).toFixed(1)}s — ${results.length} sources, ${errored} errored, ${newCount} new links across ${withNew.length} sources.`,
  );

  // ALWAYS_NOTIFY=true sends a heartbeat summary even on zero-new-link runs.
  // Useful for confirming the cron is alive; noisy long-term — disable once you trust it.
  const alwaysNotify = process.env.ALWAYS_NOTIFY === "true" || process.env.ALWAYS_NOTIFY === "1";
  const summary = `📊 ${(passMs / 1000).toFixed(1)}s · ${results.length} sources · ${errored} errored · ${newCount} new`;

  if (withNew.length === 0) {
    if (alwaysNotify) {
      const sent = await notifyTelegram(summary);
      console.log(sent ? "Sent heartbeat." : "Skipped heartbeat (Telegram not configured).");
    } else {
      console.log("No new vacancies.");
    }
    return;
  }
  const detail = formatMessage(withNew);
  const message = alwaysNotify ? `${summary}\n\n${detail}` : detail;
  const sent = await notifyTelegram(message);
  console.log(sent ? "Sent Telegram notification." : "Skipped Telegram (not configured).");
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await closeBrowser();
  process.exit(1);
});
