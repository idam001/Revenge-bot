import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDbSchema, pool } from "@/db";
import { requireUser } from "@/lib/auth";
import { hashCustomerKey } from "@/lib/customer-api-keys";
import registry from "@/lib/revenge-tools-registry.json";
import { CUSTOMER_API_KEY_REQUESTS_PER_MINUTE } from "@/lib/rate-limit-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  await ensureDbSchema();
  const result = await pool.query(
    `SELECT k."id", k."name", k."prefix", k."scopes", k."allowedCategories", k."requestsPerMinute",
            k."totalRequests", k."lastUsedAt", k."expiresAt", k."revokedAt", k."createdAt",
            (COUNT(u."id") FILTER (WHERE u."createdAt" >= now() - interval '30 days'))::int AS "requestsLast30Days"
       FROM "customer_api_keys" k
       LEFT JOIN "customer_api_usage" u ON u."keyId" = k."id"
      WHERE k."userId" = $1
      GROUP BY k."id"
      ORDER BY k."createdAt" DESC`,
    [gate.user.id],
  );
  return NextResponse.json({
    keys: result.rows,
    categories: registry.categories.filter(category => category.id !== "cinesubz").map(({ id, name }) => ({ id, name })),
  });
}

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  let body: { name?: unknown; expiresInDays?: unknown; allowedCategories?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return NextResponse.json({ error: "Request too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 48) {
    return NextResponse.json({ error: "Name your key (1–48 characters)." }, { status: 400 });
  }
  const expiresInDays = body.expiresInDays === 30 || body.expiresInDays === 90 || body.expiresInDays === 365
    ? body.expiresInDays : 90;
  const allowedCategoryIds = registry.categories.filter(category => category.id !== "cinesubz").map(category => category.id);
  const selectedCategories = body.allowedCategories === undefined
    ? allowedCategoryIds
    : body.allowedCategories;
  if (!Array.isArray(selectedCategories) || selectedCategories.length < 1 || selectedCategories.length > allowedCategoryIds.length ||
      selectedCategories.some(category => typeof category !== "string" || !allowedCategoryIds.includes(category))) {
    return NextResponse.json({ error: "Choose at least one valid tool category for this key." }, { status: 400 });
  }
  const hasFullAccess = selectedCategories.length === allowedCategoryIds.length;
  const storedCategories = hasFullAccess ? [] : selectedCategories;
  await ensureDbSchema();
  const secret = `rv_live_${randomBytes(32).toString("base64url")}`;
  const prefix = `${secret.slice(0, 15)}…`;
  const client = await pool.connect();
  let created: { id: string; expiresAt: Date };
  try {
    await client.query("BEGIN");
    // Serialize key creation per account so parallel requests cannot exceed the active-key cap.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [gate.user.id]);
    const active = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "customer_api_keys" WHERE "userId" = $1 AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
      [gate.user.id],
    );
    if (Number(active.rows[0]?.count || 0) >= 10) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "You can have up to 10 active API keys. Revoke one to create another." }, { status: 409 });
    }
    const result = await client.query<{ id: string; expiresAt: Date }>(
      `INSERT INTO "customer_api_keys" ("userId", "name", "prefix", "keyHash", "scopes", "allowedCategories", "requestsPerMinute", "expiresAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, ${CUSTOMER_API_KEY_REQUESTS_PER_MINUTE}, now() + ($7::text || ' days')::interval)
       RETURNING "id", "expiresAt"`,
      [gate.user.id, name, prefix, hashCustomerKey(secret), JSON.stringify(["tools:read", "tools:execute"]), JSON.stringify(storedCategories), String(expiresInDays)],
    );
    created = result.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // This is the only response that ever contains the raw secret.
  return NextResponse.json({
    key: { id: created.id, name, prefix, scopes: ["tools:read", "tools:execute"], allowedCategories: storedCategories, requestsPerMinute: CUSTOMER_API_KEY_REQUESTS_PER_MINUTE, expiresAt: created.expiresAt },
    secret,
    warning: "Copy this key now. It cannot be viewed again.",
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  let body: { id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    return NextResponse.json({ error: "A valid key id is required." }, { status: 400 });
  }
  await ensureDbSchema();
  const result = await pool.query(
    `UPDATE "customer_api_keys" SET "revokedAt" = now() WHERE "id" = $1 AND "userId" = $2 AND "revokedAt" IS NULL RETURNING "id"`,
    [body.id, gate.user.id],
  );
  if (result.rowCount !== 1) return NextResponse.json({ error: "Key not found or already revoked." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
