import { createHash } from "node:crypto";
import { ensureDbSchema, pool } from "@/db";

export type CustomerKeyContext = {
  kind: "customer-key";
  id: string;
  userId: string;
  scopes: string[];
  allowedCategories: string[];
  requestsPerMinute: number;
};

export function hashCustomerKey(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Returns null when no bearer was supplied; otherwise a validated key or an HTTP error. */
export async function authenticateCustomerKey(
  request: Request,
  requiredScope: string,
): Promise<CustomerKeyContext | { response: Response } | null> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const secret = authorization.slice(7).trim();
  if (!/^rv_live_[A-Za-z0-9_-]{40,64}$/.test(secret)) {
    return { response: Response.json({ error: "Invalid API key.", code: "INVALID_API_KEY" }, { status: 401 }) };
  }
  await ensureDbSchema();
  const keyHash = hashCustomerKey(secret);
  const found = await pool.query<{
    id: string; userId: string; scopes: string[]; allowedCategories: string[]; requestsPerMinute: number;
  }>(
    `SELECT "id", "userId", "scopes", "allowedCategories", "requestsPerMinute"
       FROM "customer_api_keys"
      WHERE "keyHash" = $1 AND "revokedAt" IS NULL
        AND ("expiresAt" IS NULL OR "expiresAt" > now())
      LIMIT 1`,
    [keyHash],
  );
  const key = found.rows[0];
  if (!key) {
    return { response: Response.json({ error: "API key is invalid, revoked, or expired.", code: "INVALID_API_KEY" }, { status: 401 }) };
  }
  if (!Array.isArray(key.scopes) || !key.scopes.includes(requiredScope)) {
    return { response: Response.json({ error: `This key does not have the ${requiredScope} scope.`, code: "INSUFFICIENT_SCOPE" }, { status: 403 }) };
  }

  // Key validity is checked here, but quota is intentionally not consumed yet.
  // Callers consume a unit only immediately before an upstream request so
  // catalog reads and validation failures remain free.
  return { kind: "customer-key", id: key.id, userId: key.userId, scopes: key.scopes, allowedCategories: Array.isArray(key.allowedCategories) ? key.allowedCategories : [], requestsPerMinute: key.requestsPerMinute };
}

export async function consumeCustomerKeyRequest(key: Pick<CustomerKeyContext, "id" | "requestsPerMinute">) {
  const { rows } = await pool.query<{ windowCount: number; requestsPerMinute: number }>(
    `UPDATE "customer_api_keys"
        SET "windowCount" = CASE WHEN "windowStartedAt" < date_trunc('minute', now()) THEN 1 ELSE "windowCount" + 1 END,
            "windowStartedAt" = CASE WHEN "windowStartedAt" < date_trunc('minute', now()) THEN date_trunc('minute', now()) ELSE "windowStartedAt" END,
            "totalRequests" = "totalRequests" + 1,
            "lastUsedAt" = now()
      WHERE "id" = $1 AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())
        AND ("windowStartedAt" < date_trunc('minute', now()) OR "windowCount" < "requestsPerMinute")
      RETURNING "windowCount", "requestsPerMinute"`,
    [key.id],
  );
  if (!rows[0]) return { ok: false, limit: key.requestsPerMinute, remaining: 0, retryAfterSec: 60 };
  return { ok: true, limit: Number(rows[0].requestsPerMinute), remaining: Math.max(0, Number(rows[0].requestsPerMinute) - Number(rows[0].windowCount)), retryAfterSec: 0 };
}

export async function customerKeyRateState(key: Pick<CustomerKeyContext, "id" | "requestsPerMinute">) {
  try {
    const { rows } = await pool.query<{ windowCount: number; requestsPerMinute: number }>(
      `SELECT CASE WHEN "windowStartedAt" < date_trunc('minute', now()) THEN 0 ELSE "windowCount" END AS "windowCount", "requestsPerMinute"
         FROM "customer_api_keys" WHERE "id"=$1 AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1`,
      [key.id],
    );
    const row = rows[0];
    const limit = Number(row?.requestsPerMinute ?? key.requestsPerMinute);
    return { limit, remaining: Math.max(0, limit - Number(row?.windowCount || 0)) };
  } catch { return { limit: key.requestsPerMinute, remaining: key.requestsPerMinute }; }
}

export async function recordCustomerKeyUsage(
  keyId: string,
  endpointId: string,
  status: number,
  elapsedMs: number,
) {
  await pool.query(
    `INSERT INTO "customer_api_usage" ("keyId", "endpointId", "status", "elapsedMs") VALUES ($1, $2, $3, $4)`,
    [keyId, endpointId.slice(0, 120), status, Math.max(0, Math.round(elapsedMs))],
  );
}
