import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getOwner } from "@/lib/auth";
import { serverError } from "@/lib/api-response";
import { and, desc, ilike, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const owner = await getOwner({ create: true, request: req });
    if (!owner) return NextResponse.json({ chats: [], hits: [] });
    const q = (new URL(req.url).searchParams.get("q") || "").trim();
    if (q.length < 2) {
      return NextResponse.json({ chats: [], hits: [] });
    }
    const pattern = `%${q.slice(0, 80)}%`;

    const [chats, rows] = await Promise.all([
      db
        .select({
          id: conversations.id,
          title: conversations.title,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .where(and(eq(conversations.ownerKey, owner.key), ilike(conversations.title, pattern)))
        .orderBy(desc(conversations.updatedAt))
        .limit(6),
      db
        .select({
          messageId: messages.id,
          conversationId: messages.conversationId,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
          title: conversations.title,
        })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(and(eq(conversations.ownerKey, owner.key), ilike(messages.content, pattern)))
        .orderBy(desc(messages.createdAt))
        .limit(20),
    ]);

    const hits = rows.map((r) => {
      const idx = r.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 50);
      const snippet =
        (start > 0 ? "…" : "") +
        r.content.slice(start, start + 170).replace(/\s+/g, " ") +
        (start + 170 < r.content.length ? "…" : "");
      return {
        messageId: r.messageId,
        conversationId: r.conversationId,
        role: r.role,
        title: r.title,
        snippet,
        createdAt: r.createdAt,
      };
    });

    return NextResponse.json({ chats, hits });
  } catch (err) {
    return serverError(err, "Search failed");
  }
}
