/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Good enough to stop casual abuse of expensive AI routes on a single
 * serverless instance. For hard guarantees across many instances, swap the
 * Map for Upstash Redis / Vercel KV — the call signature stays the same.
 */
type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterSec };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  // Bound memory in long-lived instances.
  if (buckets.size > MAX_KEYS) {
    const firstKey = buckets.keys().next().value;
    if (firstKey) buckets.delete(firstKey);
  }

  return { ok: true, remaining: limit - bucket.hits.length, retryAfterSec: 0 };
}

/** Best-effort client identity for rate limiting (never trusted for auth). */
export function clientKey(req: Request): string {
  const h = req.headers;
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  return ip;
}
