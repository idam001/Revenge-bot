import type { AdultMediaResult } from "@/lib/adult-media";

type Source = "xnxx" | "xvideos";
const MAX_HTML_BYTES = 2_000_000;
const HOSTS: Record<Source, RegExp> = {
  xnxx: /(^|\.)xnxx\.com$/i,
  xvideos: /(^|\.)xvideos\.com$/i,
};

function safeSourceUrl(value: unknown, source: Source): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !HOSTS[source].test(url.hostname)) return "";
    return url.toString();
  } catch { return ""; }
}

function decodeJsUrl(value: string): string {
  return value
    .replace(/\\u0026/gi, "&").replace(/\\x26/gi, "&")
    .replace(/\\u003d/gi, "=").replace(/\\x3d/gi, "=")
    .replace(/\\\//g, "/").replace(/&amp;/gi, "&").trim();
}

function mediaKind(url: string): "mp4" | "hls" | "" {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4")) return "mp4";
    if (path.endsWith(".m3u8")) return "hls";
  } catch { /* invalid URL */ }
  return "";
}

/** Reads only the player fields explicitly emitted by the source's own watch page. */
export function extractAdultSourceMedia(html: string, pageUrl: string, source: Source): AdultMediaResult | null {
  if (typeof html !== "string" || html.length > MAX_HTML_BYTES) return null;
  const safePageUrl = safeSourceUrl(pageUrl, source);
  if (!safePageUrl) return null;
  const found: Array<{ url: string; format: "mp4" | "hls" }> = [];
  const add = (raw: string, declaredFormat = "") => {
    const url = safeSourceUrl(decodeJsUrl(raw), source) || (() => {
      // Stream hosts are distinct from watch-page hosts; require HTTPS and a media URL from an explicit player field.
      try { const candidate = new URL(decodeJsUrl(raw)); return candidate.protocol === "https:" && !candidate.username && !candidate.password ? candidate.toString() : ""; }
      catch { return ""; }
    })();
    if (!url) return;
    const format = declaredFormat === "hls" ? "hls" : declaredFormat === "mp4" ? "mp4" : mediaKind(url);
    if (format) found.push({ url, format });
  };

  const callPattern = /setVideoUrl(High|Low|HLS|Hls)?\s*\(\s*(['"])((?:\\.|[^\\])*?)\2\s*\)/gi;
  for (const match of html.matchAll(callPattern)) {
    const mode = (match[1] || "").toLowerCase();
    add(match[3], mode === "hls" ? "hls" : mode === "high" || mode === "low" ? "mp4" : "");
  }
  const propertyPattern = /(?:videoUrlHigh|videoUrlLow|videoUrlHLS|video_url_high|video_url_low|video_url_hls)\s*[:=]\s*(['"])((?:\\.|[^\\])*?)\1/gi;
  for (const match of html.matchAll(propertyPattern)) {
    const prefix = match[0].slice(0, match[0].indexOf(match[1])).toLowerCase();
    add(match[2], prefix.includes("hls") ? "hls" : "mp4");
  }
  const unique = [...new Map(found.map(item => [`${item.format}:${item.url}`, item])).values()];
  const mp4 = unique.filter(item => item.format === "mp4").map(item => item.url);
  const play = unique.find(item => item.format === "mp4") || unique.find(item => item.format === "hls");
  return play ? { playUrl: play.url, format: play.format, downloads: mp4, sourcePageUrl: safePageUrl } : null;
}

async function readLimited(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_HTML_BYTES) throw new Error("source page too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) { await reader.cancel(); throw new Error("source page too large"); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

/** Best-effort, size-capped public watch-page fallback. It never logs or stores page content. */
export async function resolveAdultSourcePage(value: unknown, source: Source): Promise<AdultMediaResult | null> {
  let current = safeSourceUrl(value, source);
  if (!current) return null;
  for (let redirects = 0; redirects <= 3; redirects++) {
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; REVENGE public media resolver)" },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) return null;
        current = safeSourceUrl(new URL(location, current).toString(), source);
        if (!current) return null;
        continue;
      }
      if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("html")) return null;
      return extractAdultSourceMedia(await readLimited(response), current, source);
    } catch { return null; }
  }
  return null;
}
