import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type registry from "@/lib/revenge-tools-registry.json";

type RegistryEndpoint = (typeof registry.endpoints)[number];
type EndpointRecord = RegistryEndpoint & {
  tags: string[];
  provider: { name: string; homepage: string; docsUrl: string };
  source: { kind: string; sourceUrl: string; fetchedAt: string };
  transport: { baseUrl: string; path: string; methods: string[] };
  auth: { type: string; keyEnvVar: string; keyLocation: string; keyName: string; requiredForUse: boolean };
  example: { request: { endpointId: string; method: string; params: Record<string, unknown> }; verified: boolean };
  timing: Record<string, unknown>;
  limits: Record<string, unknown>;
  status: string;
  health: { consecutiveFailures: number };
  nsfw: boolean;
  qualityScore: number;
};

const API_BASE = "https://apis.nabeestech.com";
const URL_PARAM = /^(url|image|image_url|icon|audioUrl|audio_url|source|target|sdm|packUrl|baseUrl|file|fileUrl|videoUrl|video_url)$/i;

function publicIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113));
}

function publicIpv6(ip: string): boolean {
  const value = ip.toLowerCase().split("%", 1)[0];
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (mapped.includes(".")) return publicIpv4(mapped);
    return false;
  }
  // Only global-unicast 2000::/3 is eligible. This excludes loopback,
  // unspecified, link-local, unique-local, multicast, and IPv4-compatible.
  if (!/^2[0-9a-f]{0,3}:/.test(value)) return false;
  return !value.startsWith("2001:db8:") && !value.startsWith("2001:0000:") && !value.startsWith("2002:");
}

/** Basic URL preflight before handing a URL-valued parameter to an upstream. */
export function validatePublicHttpUrl(value: unknown): { ok: true; url: URL } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.length > 2_048) return { ok: false, reason: "URL must be a string no longer than 2,048 characters." };
  let url: URL;
  try { url = new URL(value); } catch { return { ok: false, reason: "URL is invalid." }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only HTTP and HTTPS URLs are allowed." };
  if (url.username || url.password) return { ok: false, reason: "URLs containing credentials are not allowed." };
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    return { ok: false, reason: "Non-standard ports are not allowed." };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") {
    return { ok: false, reason: "Private and local hosts are not allowed." };
  }
  if (host === "0.0.0.0" || host === "::" || host === "::1") return { ok: false, reason: "Private and local hosts are not allowed." };
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !publicIpv4(host)) return { ok: false, reason: "Private, reserved, and link-local IP addresses are not allowed." };
  if (host.includes(":" ) && !publicIpv6(host)) return { ok: false, reason: "Private, reserved, and link-local IP addresses are not allowed." };
  return { ok: true, url };
}

export async function validateUrlParameters(params: Record<string, unknown>): Promise<{ ok: true } | { ok: false; param: string; reason: string }> {
  for (const [key, value] of Object.entries(params)) {
    if (!URL_PARAM.test(key) || value === "" || value == null) continue;
    const checked = validatePublicHttpUrl(value);
    if (!checked.ok) return { ok: false, param: key, reason: checked.reason };
    const host = checked.url.hostname.replace(/^\\[|\\]$/g, "");
    if (isIP(host)) continue;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("DNS timeout")), 2_000); }),
      ]);
      if (!addresses.length || addresses.some((entry) => !(entry.family === 4 ? publicIpv4(entry.address) : publicIpv6(entry.address)))) {
        return { ok: false, param: key, reason: "The URL hostname resolves to a private or reserved network address." };
      }
    } catch {
      return { ok: false, param: key, reason: "Could not verify the URL hostname against private-network access." };
    } finally { if (timeout) clearTimeout(timeout); }
  }
  return { ok: true };
}

function slugTokens(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9+#.-]+/g, " ").trim().split(/\s+/).filter(Boolean);
}
function trigrams(value: string): Set<string> {
  const normalized = `  ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ")}  `;
  const out = new Set<string>();
  for (let i = 0; i < normalized.length - 2; i++) out.add(normalized.slice(i, i + 3));
  return out;
}
function similarity(a: string, b: string): number {
  const aa = trigrams(a); const bb = trigrams(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0; for (const gram of aa) if (bb.has(gram)) common++;
  return (2 * common) / (aa.size + bb.size);
}

export function enrichEndpoint(endpoint: RegistryEndpoint): EndpointRecord {
  const params = (endpoint.params || []) as Array<{ name: string; description?: string; example?: unknown; default?: unknown; placeholder?: unknown }>;
  const completeParams = params.filter((p) => Boolean(p.name && p.description)).length;
  const qualityScore = Math.min(40, completeParams * 5) + 10; // schema + fixed HTTPS transport only
  const method = endpoint.methods.includes("GET") ? "GET" : endpoint.methods[0] || "GET";
  const exampleParams: Record<string, unknown> = {};
  for (const param of params) {
    const value = param.example ?? param.default ?? param.placeholder;
    if (value !== undefined && value !== "") exampleParams[param.name] = value;
  }
  const tags = ["https", "curated", `category:${endpoint.category}`];
  if (params.length) tags.push("has-params");
  if (endpoint.methods.includes("GET")) tags.push("method:get");
  if (endpoint.methods.includes("POST")) tags.push("method:post");
  if (endpoint.category === "18+") tags.push("nsfw");
  return {
    ...endpoint,
    tags,
    provider: { name: "Nabees Tech API", homepage: API_BASE, docsUrl: API_BASE },
    source: { kind: "curated", sourceUrl: "REVENGE curated tools registry", fetchedAt: "2026-11-04T00:00:00.000Z" },
    transport: { baseUrl: API_BASE, path: endpoint.path, methods: endpoint.methods },
    auth: { type: "apiKey", keyEnvVar: "NABEES_API_KEY", keyLocation: "header", keyName: "X-API-Key", requiredForUse: false },
    example: { request: { endpointId: endpoint.id, method, params: exampleParams }, verified: false },
    timing: {},
    limits: { rateLimitNote: "Upstream limits may apply; not independently confirmed." },
    status: "unverified",
    health: { consecutiveFailures: 0 },
    nsfw: endpoint.category === "18+",
    qualityScore,
  } as EndpointRecord;
}

export type DiscoveryFilters = {
  query?: string;
  category?: string;
  tags?: string[];
  auth?: string;
  method?: string;
  minScore?: number;
  limit?: number;
  cursor?: string;
  endpointId?: string;
};

export function discoverEndpoints(endpoints: RegistryEndpoint[], filters: DiscoveryFilters) {
  const enriched = endpoints.map(enrichEndpoint);
  if (filters.endpointId) {
    const exact = enriched.filter((item) => item.id === filters.endpointId).map((endpoint) => ({ endpoint, score: 120, whyMatched: ["exact endpoint id"] }));
    return { matches: exact, total: exact.length, nextCursor: null };
  }
  const query = (filters.query || "").trim().toLowerCase();
  const queryTokens = slugTokens(query);
  const tags = (filters.tags || []).map((tag) => tag.toLowerCase());
  const matches = enriched.map((item) => {
    if (filters.category && item.category !== filters.category) return null;
    if (filters.auth === "none" && item.auth.requiredForUse) return null;
    if (filters.auth && filters.auth !== "none" && item.auth.type !== filters.auth) return null;
    if (filters.method && !item.methods.some((method) => method.toLowerCase() === filters.method?.toLowerCase())) return null;
    if (typeof filters.minScore === "number" && Number(item.qualityScore) < filters.minScore) return null;
    if (tags.some((tag) => !item.tags.some((entry) => entry.toLowerCase() === tag))) return null;
    const text = `${item.id} ${item.name} ${item.description} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
    let score = 0;
    const reasons: string[] = [];
    if (query) {
      if (item.id.toLowerCase() === query) { score += 120; reasons.push("exact endpoint id"); }
      else if (item.id.toLowerCase().startsWith(query)) { score += 80; reasons.push("id prefix"); }
      if (item.name.toLowerCase() === query) { score += 100; reasons.push("exact name"); }
      else if (item.name.toLowerCase().startsWith(query)) { score += 65; reasons.push("name prefix"); }
      const matchedTokens = queryTokens.filter((token) => text.includes(token));
      if (matchedTokens.length) { score += matchedTokens.length * 15; reasons.push(`matched ${matchedTokens.length} search term${matchedTokens.length === 1 ? "" : "s"}`); }
      const fuzzy = similarity(query, `${item.name} ${item.description}`);
      if (fuzzy >= 0.25) { score += Math.round(fuzzy * 20); reasons.push("fuzzy text match"); }
      if (!score) return null;
    }
    return { endpoint: item, score, whyMatched: query ? reasons : ["curated catalog"] };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  matches.sort((a, b) => b.score - a.score || Number(b.endpoint.qualityScore) - Number(a.endpoint.qualityScore) || a.endpoint.name.localeCompare(b.endpoint.name));
  const offset = Math.max(0, Number.parseInt(filters.cursor || "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, filters.limit || 50));
  const page = matches.slice(offset, offset + limit);
  return { matches: page, total: matches.length, nextCursor: offset + limit < matches.length ? String(offset + limit) : null };
}
