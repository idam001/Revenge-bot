import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { conversations, messages } from "@/db/schema";
import { asc, eq, gte, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDbSchema();
    const { id } = await context.params;

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));

    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const threadMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json({
      conversation: conv,
      messages: threadMessages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDbSchema();
    const { id } = await context.params;
    const body = (await req.json()) as {
      title?: string;
      pinned?: boolean;
      modelId?: string;
      personaId?: string;
      folder?: string;
      systemPrompt?: string;
    };

    const updates: Partial<typeof conversations.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.title === "string" && body.title.trim()) {
      updates.title = body.title.trim().slice(0, 120);
    }
    if (typeof body.pinned === "boolean") updates.pinned = body.pinned;
    if (typeof body.modelId === "string") updates.modelId = body.modelId;
    if (typeof body.personaId === "string") updates.personaId = body.personaId;
    if (typeof body.folder === "string") updates.folder = body.folder;
    if (typeof body.systemPrompt === "string") updates.systemPrompt = body.systemPrompt;

    const [updated] = await db
      .update(conversations)
      .set(updates)
      .where(eq(conversations.id, id))
      .returning();

    return NextResponse.json({ conversation: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDbSchema();
    const { id } = await context.params;
    const body = (await req.json()) as {
      action: "truncateFrom" | "fork" | "toggleBookmark";
      messageId?: string;
    };

    if (body.action === "toggleBookmark" && body.messageId) {
      const [msg] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, body.messageId));
      if (!msg) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
      }
      const [updated] = await db
        .update(messages)
        .set({ bookmarked: !msg.bookmarked })
        .where(eq(messages.id, body.messageId))
        .returning();
      return NextResponse.json({ message: updated });
    }

    if (body.action === "truncateFrom" && body.messageId) {
      const [target] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, body.messageId));
      if (target) {
        await db
          .delete(messages)
          .where(
            and(
              eq(messages.conversationId, id),
              gte(messages.createdAt, target.createdAt)
            )
          );
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "fork") {
      const [orig] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      if (!orig) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const allMsgs = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, id))
        .orderBy(asc(messages.createdAt));

      let subset = allMsgs;
      if (body.messageId) {
        const idx = allMsgs.findIndex((m) => m.id === body.messageId);
        if (idx !== -1) subset = allMsgs.slice(0, idx + 1);
      }

      const [forkedConv] = await db
        .insert(conversations)
        .values({
          title: `${orig.title} (Fork)`,
          modelId: orig.modelId,
          personaId: orig.personaId,
          folder: orig.folder,
          systemPrompt: orig.systemPrompt,
        })
        .returning();

      if (subset.length > 0) {
        await db.insert(messages).values(
          subset.map((m) => ({
            conversationId: forkedConv.id,
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
            reasoningMs: m.reasoningMs,
            modelId: m.modelId,
            providerUsed: m.providerUsed,
            latencyMs: m.latencyMs,
            tokensPerSec: m.tokensPerSec,
            webSources: m.webSources,
            attachments: m.attachments,
            imageUrl: m.imageUrl,
            videoUrl: m.videoUrl,
          }))
        );
      }

      return NextResponse.json({ conversation: forkedConv });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDbSchema();
    const { id } = await context.params;
    await db.delete(conversations).where(eq(conversations.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
