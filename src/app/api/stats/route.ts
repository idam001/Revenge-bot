import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { sql } from "drizzle-orm";
import { getOwner } from "@/lib/auth";
import { serverError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return NextResponse.json({ chats: 0, messages: 0, images: 0, videos: 0, searches: 0, avgSpeed: 0, topModels: [] });
    }
    const result = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM conversations WHERE "ownerKey" = ${owner.key})::int AS chats,
        (SELECT count(*) FROM messages WHERE "ownerKey" = ${owner.key})::int AS messages,
        (SELECT count(*) FROM messages WHERE "ownerKey" = ${owner.key} AND "imageUrl" IS NOT NULL)::int AS images,
        (SELECT count(*) FROM messages WHERE "ownerKey" = ${owner.key} AND "videoUrl" IS NOT NULL)::int AS videos,
        (SELECT count(*) FROM messages WHERE "ownerKey" = ${owner.key} AND "webSources" IS NOT NULL)::int AS searches,
        COALESCE((SELECT round(avg("tokensPerSec"))::int FROM messages WHERE "ownerKey" = ${owner.key} AND "tokensPerSec" > 0), 0) AS avg_speed
    `);
    const row = (result.rows?.[0] ?? {}) as Record<string, number>;

    const top = await db.execute(sql`
      SELECT "modelId", count(*)::int AS n
      FROM messages
      WHERE role = 'assistant' AND "modelId" IS NOT NULL AND "ownerKey" = ${owner.key}
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
    return serverError(err, "Stats failed");
  }
}
