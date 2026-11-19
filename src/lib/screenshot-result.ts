type Row = Record<string, unknown>;
function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const url = new URL(value.trim()); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; }
  catch { return ""; }
}

/** Extract screenshot/image links from common nested provider result envelopes. */
export function screenshotUrlOf(value: unknown, depth = 0): string {
  if (depth > 7 || value == null) return "";
  if (typeof value === "string") {
    const url = safeUrl(value);
    return url && /\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(url) ? url : "";
  }
  if (Array.isArray(value)) { for (const child of value.slice(0, 12)) { const found = screenshotUrlOf(child, depth + 1); if (found) return found; } return ""; }
  if (typeof value !== "object") return "";
  const row = value as Row;
  for (const [key, child] of Object.entries(row)) {
    if (/^(screenshot|screenshotUrl|screenshot_url|image|imageUrl|image_url|preview|previewUrl|preview_url)$/i.test(key)) {
      if (typeof child === "string") { const url = safeUrl(child); if (url) return url; }
      const found = screenshotUrlOf(child, depth + 1); if (found) return found;
    }
  }
  const markedScreenshot = row.success === true || row.screenshot !== undefined || row.screenshot_url !== undefined || row.image !== undefined || row.image_url !== undefined;
  if (markedScreenshot && typeof row.url === "string") {
    const url = safeUrl(row.url);
    if (url) return url;
  }
  for (const key of ["data", "result", "output", "response"]) {
    const child = row[key];
    if (typeof child === "string") { const url = safeUrl(child); if (url) return url; }
    const found = screenshotUrlOf(child, depth + 1); if (found) return found;
  }
  return "";
}
