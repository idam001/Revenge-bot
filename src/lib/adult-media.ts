export type AdultMediaResult = { playUrl: string; format: "mp4" | "hls"; downloads: string[]; sourcePageUrl?: string };

const MEDIA_FIELDS = new Set([
  "downloadurl", "download_url", "video_url", "videourl", "video_url_high", "videourlhigh",
  "video_url_low", "videourllow", "setvideourlhigh", "setvideourllow", "video_url_hls",
  "videourlhls", "m3u8_base_url", "m3u8baseurl", "hls_url", "hlsurl", "hls", "mp4",
  "mp4_url", "mp4url", "play_url", "playurl", "src", "source", "high", "low", "best", "worst", "480p", "720p", "1080p",
]);

const PAGE_FIELDS = ["page_url", "webpage_url", "permalink", "watch_url", "watchUrl", "url", "link", "href"] as const;
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Prefer the actual watch page, never a media/download field, when resolving provider details. */
export function sourcePageUrlOf(row: Record<string, unknown>, source: "xnxx" | "xvideos"): string {
  const hostAllowed = (value: string) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return source === "xnxx" ? /(^|\.)xnxx\.com$/.test(host) : /(^|\.)xvideos\.com$/.test(host);
    } catch { return false; }
  };
  for (const key of PAGE_FIELDS) {
    const value = httpUrl(row[key]);
    if (value && hostAllowed(value)) return value;
  }
  return "";
}

function mediaKind(url: string): "mp4" | "hls" | "" {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4")) return "mp4";
    if (path.endsWith(".m3u8")) return "hls";
  } catch { /* invalid URL */ }
  return "";
}

/**
 * Extract only explicitly named media fields and media URLs with recognized stream suffixes.
 * Arbitrary `url`/`href`/page metadata is intentionally not treated as playable media.
 */
export function adultMediaOf(value: unknown): AdultMediaResult | null {
  const found: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 8 || item == null) return;
    if (Array.isArray(item)) { for (const child of item.slice(0, 40)) visit(child, depth + 1); return; }
    if (typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (typeof child === "string" && MEDIA_FIELDS.has(normalizeKey(key))) {
        const url = httpUrl(child);
        if (url && mediaKind(url)) found.push(url);
      } else if (Array.isArray(child) || (child && typeof child === "object")) {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  const unique = [...new Set(found)];
  const downloads = unique.filter(url => mediaKind(url) === "mp4");
  const playUrl = downloads[0] || unique.find(url => mediaKind(url) === "hls");
  if (!playUrl) return null;
  return { playUrl, format: mediaKind(playUrl) as "mp4" | "hls", downloads };
}
