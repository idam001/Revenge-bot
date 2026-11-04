import { db, ensureDbSchema } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureDbSchema();
    return Response.json({ ok: true, app: "REVENGE GPT", creator: "Idam Emmanuel" });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
