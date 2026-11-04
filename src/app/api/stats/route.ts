import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDbSchema();
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM conversations)::int AS chats,
        (SELECT count(*) FROM messages)::int AS messages,
        (SELECT count(*) FROM messages WHERE "imageUrl" IS NOT NULL)::int AS images,
        (SELECT count(*) FROM messages WHERE "videoUrl" IS NOT NULL)::int AS videos,
        (SELECT count(*) FROM messages WHERE "webSources" IS NOT NULL)::int AS searches,
        COALESCE((SELECT round(avg("tokensPerSec"))::int FROM messages WHERE "tokensPerSec" > 0), 0) AS avg_speed
    `);
    const row = (result.rows?.[0] ?? {}) as Record<string, number>;

    const top = await db.execute(sql`
      SELECT "modelId", count(*)::int AS n
      FROM messages
      WHERE role = 'assistant' AND "modelId" IS NOT NULL
      GROUP BY "modelId" ORDER BY n DESC LIMIT 5
    `);

    return NextResponse.json({
      chats: row.chats ?? 0,
      messages: row.messages ?? 0,
      images: row.images ?? 0,
      videos: row.videos ?? 0,
      searches: row.searches ?? 0,
      avgSpeed: row.avg_speed ?? 0,
      topModels: top.rows ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stats failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
