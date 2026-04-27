/**
 * Single-source tester. Fetches one source by id, runs extraction, prints links.
 * Does NOT mutate state.json. Use for iterating on per-site config.
 *
 *   npx tsx test-source.ts ssc
 *   npx tsx test-source.ts ssc --raw   # also dump raw HTML to /tmp/<id>.html
 *   npx tsx test-source.ts ssc --limit=50
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "./src/extract.js";
import { fetchPage, closeBrowser } from "./src/fetch.js";
import type { SourceConfig } from "./src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(__dirname, "sources.json");

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith("--"));
  const dumpRaw = args.includes("--raw");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]!, 10) : 25;

  if (!id) {
    console.error("Usage: tsx test-source.ts <id> [--raw] [--limit=N]");
    process.exit(1);
  }

  const sources: SourceConfig[] = JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
  const source = sources.find((s) => s.id === id);
  if (!source) {
    console.error(`No source with id "${id}". Available:`);
    console.error(sources.map((s) => `  ${s.id}`).join("\n"));
    process.exit(1);
  }

  console.log(`\n=== ${source.name} (${source.id}) ===`);
  console.log(`URL:       ${source.url}`);
  console.log(`renderJs:  ${source.renderJs ?? false}`);
  console.log(`container: ${source.containerSelector ?? "(default: body)"}`);
  console.log(`urlPattern:${source.urlPattern ? " /" + source.urlPattern + "/i" : " (none)"}`);
  console.log("");

  const start = Date.now();
  let html: string;
  try {
    html = await fetchPage(source);
  } catch (e) {
    console.error(`✗ FETCH FAILED: ${(e as Error).message}`);
    await closeBrowser();
    process.exit(2);
  }
  const fetchMs = Date.now() - start;

  if (dumpRaw) {
    const out = `/tmp/${source.id}.html`;
    fs.writeFileSync(out, html);
    console.log(`(raw HTML written to ${out})`);
  }

  const links = extract(html, source);
  const extractMs = Date.now() - start - fetchMs;

  console.log(`Fetched ${html.length.toLocaleString()} bytes in ${fetchMs}ms`);
  console.log(`Extracted ${links.length} candidate links in ${extractMs}ms\n`);

  if (links.length === 0) {
    console.log("⚠️  No links matched. Common causes:");
    console.log("   • Page is JS-rendered → set renderJs:true");
    console.log("   • container selector misses the right region");
    console.log("   • urlPattern is too strict — remove it to see what's there");
    console.log("   • keywords filter rejects the site's terminology");
    console.log("");
    console.log(`Try: npx tsx test-source.ts ${source.id} --raw  # then inspect /tmp/${source.id}.html`);
  } else {
    console.log(`First ${Math.min(limit, links.length)} links:\n`);
    for (const l of links.slice(0, limit)) {
      const title = l.text.length > 80 ? l.text.slice(0, 77) + "..." : l.text;
      console.log(`  ${title}`);
      console.log(`    ${l.href}\n`);
    }
  }

  await closeBrowser();
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await closeBrowser();
  process.exit(1);
});
