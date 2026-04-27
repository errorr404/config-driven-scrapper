export type SourceType = "html" | "json" | "sitemap";

export interface SourceConfig {
  id: string;
  name: string;
  url: string;
  tier?: 1 | 2 | 3;
  type?: SourceType; // default: "html"
  disabled?: boolean; // skip in main pass; retained for documentation
  notes?: string;     // free-form note about the source

  // --- HTML extraction ---
  containerSelector?: string;
  urlPattern?: string;        // regex; if set, href MUST match (overrides keyword check)
  excludePattern?: string;    // regex; href MUST NOT match
  keywords?: string[];        // text/href must contain ANY (only used when urlPattern unset)
  excludeKeywords?: string[]; // text/href must contain NONE
  titleFromUrl?: boolean;     // use URL filename as title (when link text is generic/useless)
  renderJs?: boolean;

  // --- JSON extraction (when type="json") ---
  itemsPath?: string;         // dot path into response, e.g. "data" or "result.items"
  idField?: string;           // field on each item used for stable diff key (default: "id")
  titleField?: string | string[]; // field(s) for display title; first non-empty wins
  linkField?: string;         // field for URL/path; if relative, linkPrefix is prepended
  linkPrefix?: string;        // base URL for linkField (e.g. "https://ssc.gov.in/")
  linkSuffix?: string;        // appended after linkField (e.g. "/advertisements")
  dateField?: string;         // optional: timestamp field for ordering

  // --- Diff / dedup ---
  stripQuery?: boolean;       // strip ?query when computing dedupe key (e.g. AWS-signed URLs)

  // --- HTTP ---
  timeoutMs?: number;
  headers?: Record<string, string>;
  insecureTls?: boolean;     // disable TLS cert verification (use only for known-broken govt certs)
  useCurl?: boolean;         // shell out to system curl (handles redirect loops + system CA store)
  method?: "GET" | "POST";   // default: GET
  formData?: Record<string, string>; // multipart form fields (POST only)
}

export interface SeenLink {
  href: string;
  text: string;
  firstSeenAt: string;
}

export interface SourceState {
  links: Record<string, SeenLink>;
  lastCheckedAt: string;
  lastError?: string;
}

export type State = Record<string, SourceState>;

export interface CheckResult {
  source: SourceConfig;
  added: SeenLink[];
  total: number;
  durationMs: number;
  isFirstRun: boolean;
  error?: string;
}
