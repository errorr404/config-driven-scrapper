import type { SourceConfig, SeenLink } from "./types.js";

function getByPath(obj: any, path: string | undefined): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => {
    if (acc == null) return undefined;
    // Numeric segment — array index
    if (/^\d+$/.test(key)) return acc[Number(key)];
    return acc[key];
  }, obj);
}

function buildLink(item: any, source: SourceConfig): string | null {
  const linkRaw = source.linkField ? getByPath(item, source.linkField) : null;
  if (!linkRaw) return null;
  const cleaned = String(linkRaw).replace(/\\/g, "/").trim();
  if (!cleaned) return null;
  let url = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : source.linkPrefix
      ? `${source.linkPrefix.replace(/\/+$/, "")}/${cleaned.replace(/^\/+/, "")}`
      : cleaned;
  if (source.linkSuffix) url += source.linkSuffix;
  return url;
}

export function extractJsonItems(jsonText: string, source: SourceConfig): SeenLink[] {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSON parse failed: ${(e as Error).message}`);
  }

  const items = getByPath(parsed, source.itemsPath ?? "data");
  if (!Array.isArray(items)) {
    throw new Error(
      `itemsPath "${source.itemsPath ?? "data"}" did not resolve to an array (got ${typeof items})`,
    );
  }

  const idField = source.idField ?? "id";
  const titleCandidates = Array.isArray(source.titleField)
    ? source.titleField
    : source.titleField
      ? [source.titleField]
      : ["headline", "title", "name"];

  const out: SeenLink[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  for (const item of items) {
    const id = getByPath(item, idField);
    if (id == null) continue;
    const stableKey = String(id);
    if (seen.has(stableKey)) continue;

    let title = "";
    for (const f of titleCandidates) {
      const v = getByPath(item, f);
      if (typeof v === "string" && v.trim()) {
        title = v.trim();
        break;
      }
    }
    if (!title) title = stableKey;

    const link = buildLink(item, source) ?? `${source.url}#${stableKey}`;

    seen.add(stableKey);
    out.push({
      href: link,
      text: title.slice(0, 200),
      firstSeenAt: now,
    });
  }

  return out;
}
