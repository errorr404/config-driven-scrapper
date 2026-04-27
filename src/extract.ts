import { load } from "cheerio";
import type { SourceConfig, SeenLink } from "./types.js";
import { extractJsonItems } from "./extract-json.js";
import { extractSitemapItems } from "./extract-sitemap.js";

export function extract(payload: string, source: SourceConfig): SeenLink[] {
  if (source.type === "json") return extractJsonItems(payload, source);
  if (source.type === "sitemap") return extractSitemapItems(payload, source);
  return extractLinks(payload, source);
}

/**
 * Stable key for diff/dedup. When `stripQuery` is set, we drop the ?query so URLs with
 * per-request signatures (e.g. AWS-presigned S3) don't appear "new" on every fetch.
 */
export function dedupeKey(link: SeenLink, source: SourceConfig): string {
  if (!source.stripQuery) return link.href;
  try {
    const u = new URL(link.href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return link.href;
  }
}

const DEFAULT_KEYWORDS = [
  "recruitment",
  "vacancy",
  "vacancies",
  "notification",
  "advertisement",
  "advt",
  "bharti",
  "bharati",
  "notice",
  "apply online",
  "online application",
  "engagement",
  "appointment",
  "career",
];

const DEFAULT_EXCLUDE = [
  "google.com/maps",
  "facebook.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "linkedin.com",
  "whatsapp.com",
];

// Strip common a11y prefixes/suffixes that wrap the actual title in aria-label/title attrs.
const ARIA_PREFIX = /^(View|Download|Open|Read more about|Click to view|Click)\s+/i;
const ARIA_SUFFIX = /\s*(- opens in a new window|PDF\s*[\d.]+\s*[KMG]?B.*|\(opens in (a )?new window\)|opens in new tab.*)$/i;

function pickBestAttrText(...candidates: string[]): string {
  for (const c of candidates) {
    if (!c) continue;
    let cleaned = c.replace(ARIA_PREFIX, "").replace(ARIA_SUFFIX, "").trim();
    cleaned = cleaned.replace(/\s+/g, " ");
    if (cleaned.length > 5) return cleaned;
  }
  return "";
}

// UUID-only or hex-only segment (Liferay-style asset paths, etc.) — uninformative.
const UUID_LIKE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const HEX_ONLY = /^[0-9a-f]{16,}$/i;

function deriveTitleFromUrl(absolute: string): string {
  let pathname: string;
  try {
    pathname = new URL(absolute).pathname;
  } catch {
    return "";
  }
  const segments = pathname.split("/").filter(Boolean);
  // Walk from end → return the most informative segment (prefer one with a known extension,
  // else first non-UUID/non-hex segment).
  const isUseless = (s: string) => UUID_LIKE.test(s) || HEX_ONLY.test(s) || /^\d+$/.test(s);
  let best = "";
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = decodeURIComponent(segments[i]!);
    if (/\.(pdf|html|htm|aspx|php|doc|docx|xls|xlsx)$/i.test(s)) {
      best = s;
      break;
    }
    if (!isUseless(s) && !best) best = s;
  }
  return best.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[+_]/g, " ").trim();
}

export function extractLinks(html: string, source: SourceConfig): SeenLink[] {
  const $ = load(html);
  const root = source.containerSelector ? $(source.containerSelector) : $("body");
  const keywords = (source.keywords ?? DEFAULT_KEYWORDS).map((k) => k.toLowerCase());
  const excludeKeywords = [
    ...DEFAULT_EXCLUDE,
    ...(source.excludeKeywords ?? []),
  ].map((k) => k.toLowerCase());
  const urlPattern = source.urlPattern ? new RegExp(source.urlPattern, "i") : null;
  const excludePattern = source.excludePattern ? new RegExp(source.excludePattern, "i") : null;

  const out = new Map<string, SeenLink>();
  const now = new Date().toISOString();

  root.find("a[href]").each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") ?? "").trim();
    let rawText = $el.text().replace(/\s+/g, " ").trim();
    const ariaLabel = ($el.attr("aria-label") ?? "").trim();
    const titleAttr = ($el.attr("title") ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;

    let absolute: string;
    try {
      absolute = new URL(href, source.url).toString();
    } catch {
      return;
    }

    if (urlPattern && !urlPattern.test(absolute)) return;
    if (excludePattern && excludePattern.test(absolute)) return;

    const lowerHref = absolute.toLowerCase();
    const lowerText = rawText.toLowerCase();

    if (excludeKeywords.some((k) => lowerHref.includes(k) || lowerText.includes(k))) return;

    // When urlPattern is set, treat it as the explicit allowlist — skip keyword gate.
    if (!urlPattern) {
      const isPdf = lowerHref.endsWith(".pdf") || lowerHref.includes(".pdf?");
      const matches = keywords.some((k) => lowerText.includes(k) || lowerHref.includes(k));
      if (!isPdf && !matches) return;
    }

    // Title resolution. Prefer URL filename when titleFromUrl=true OR when link text is
    // empty / Angular template / single common-noise word (English/Hindi/PDF/Click/here).
    const trimmed = rawText.replace(/[\s\/\\.,;:|>•·]+$/u, "").trim();
    const isGeneric =
      /^(english|hindi|pdf|click here|click|here|view|download|read more|details?)\s*(\([^)]*\))?$/i.test(trimmed);
    if (source.titleFromUrl || !rawText || /^\{\{.*\}\}$/.test(rawText) || isGeneric) {
      // Try aria-label / title attribute first (often holds real description on icon-only links).
      const fromAttr = pickBestAttrText(ariaLabel, titleAttr);
      if (fromAttr) rawText = fromAttr;
      else {
        const derived = deriveTitleFromUrl(absolute);
        if (derived) rawText = derived;
      }
      if (!rawText) rawText = "(no title)";
    }

    if (out.has(absolute)) return;
    out.set(absolute, { href: absolute, text: rawText.slice(0, 200), firstSeenAt: now });
  });

  return Array.from(out.values());
}
