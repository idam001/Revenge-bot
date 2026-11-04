/**
 * Rate limiting.
 *
 * Two layers, because the deployment is serverless:
 *
 *  1. In-memory sliding window — instant, per-instance. Handles the common
 *     burst on a single warm Lambda.
 *  2. Postgres token window — shared by every instance, so the real limit
 *     holds no matter which Lambda answers. This matters: an in-memory-only
 *     limiter is effectively "40 requests per warm instance", which on Vercel
 *     means the effective limit is unbounded.
 *
 * If the database is unreachable the limiter degrades to the in-memory result
 * rather than blocking traffic — availability beats a perfect counter here,
 * and the raw AI routes are already behind one shared budget.
 */
import { pool } from "@/db";

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

let rateTableReady: Promise<void> | null = null;

async function ensureRateTable(): Promise<void> {
  if (!rateTableReady) {
    rateTableReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "rate_hits" (
          "key" text NOT NULL,
          "at" timestamptz NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS "rate_hits_key_at" ON "rate_hits" ("key", "at");`);
    })().catch((err) => {
      rateTableReady = null;
      throw err;
    });
  }
  return rateTableReady;
}

function memoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
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

  if (buckets.size > MAX_KEYS) {
    const firstKey = buckets.keys().next().value;
    if (firstKey) buckets.delete(firstKey);
  }

  return { ok: true, remaining: limit - bucket.hits.length, retryAfterSec: 0 };
}

/**
 * Count this hit and decide. Never throws.
 */
export async function rateLimitShared(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const local = memoryLimit(key, limit, windowMs);
  if (!local.ok) return local;

  try {
    await ensureRateTable();
    // Record + count in one round trip.
    const { rows } = await pool.query<{ total: string; oldest: string | null }>(
      `WITH ins AS (
         INSERT INTO "rate_hits" ("key", "at") VALUES ($1, now())
         RETURNING "at"
       )
       SELECT count(*)::text AS total,
              min("at")::text AS oldest
         FROM "rate_hits"
        WHERE "key" = $1
          AND "at" > now() - ($2::text || ' milliseconds')::interval`,
      [key, String(windowMs)]
    );

    const total = Number(rows[0]?.total ?? 0);
    if (total > limit) {
      const oldest = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : Date.now();
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (Date.now() - oldest)) / 1000));
      return { ok: false, remaining: 0, retryAfterSec };
    }
    return { ok: true, remaining: Math.max(0, limit - total), retryAfterSec: 0 };
  } catch {
    // Database unavailable → fall back to the in-memory decision already made.
    return local;
  }
}

/** Opportunistic cleanup; cheap and best-effort. */
export async function pruneRateHits(): Promise<void> {
  try {
    await ensureRateTable();
    await pool.query(`DELETE FROM "rate_hits" WHERE "at" < now() - interval '10 minutes'`);
  } catch {
    /* best effort */
  }
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
