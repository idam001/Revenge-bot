import { db, ensureDbSchema } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  const url = new URL(request.url);
  // Liveness intentionally avoids external services; it answers whether the
  // web process can receive a request. Readiness checks the database too.
  if (url.searchParams.get("live") === "1") {
    return Response.json({ ok: true, app: "REVENGE", check: "live" }, { headers });
  }
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    await ensureDbSchema();
    return Response.json({ ok: true, app: "REVENGE", check: "ready", dependencies: { database: "ok" }, latencyMs: Date.now() - startedAt }, { headers });
  } catch {
    return Response.json({ ok: false, app: "REVENGE", check: "ready", dependencies: { database: "unavailable" } }, { status: 503, headers });
  }
}
