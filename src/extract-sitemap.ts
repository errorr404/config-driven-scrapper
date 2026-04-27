import type { SourceConfig, SeenLink } from "./types.js";

const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

/**
 * Sitemap extractor. Treats each `<loc>` as a candidate link.
 * urlPattern / excludePattern apply the same way they do for HTML extraction.
 * Title is derived from the URL slug (last path segment, dashes/underscores → spaces).
 */
export function extractSitemapItems(xml: string, source: SourceConfig): SeenLink[] {
  const urlPattern = source.urlPattern ? new RegExp(source.urlPattern, "i") : null;
  const excludePattern = source.excludePattern ? new RegExp(source.excludePattern, "i") : null;

  const out = new Map<string, SeenLink>();
  const now = new Date().toISOString();

  let m: RegExpExecArray | null;
  while ((m = LOC_RE.exec(xml))) {
    const href = m[1].trim();
    if (!href) continue;
    if (urlPattern && !urlPattern.test(href)) continue;
    if (excludePattern && excludePattern.test(href)) continue;
    if (out.has(href)) continue;

    let title = href;
    try {
      const u = new URL(href);
      const segs = u.pathname.split("/").filter(Boolean);
      const last = segs[segs.length - 1] || u.hostname;
      title = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
      if (!title) title = href;
    } catch {
      // fall through with title=href
    }

    out.set(href, { href, text: title.slice(0, 200), firstSeenAt: now });
  }

  return Array.from(out.values());
}
