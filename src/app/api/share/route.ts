import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db, ensureDbSchema } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json().catch(() => ({}))) as { conversationId?: string };
    if (!body.conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, body.conversationId));
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const count = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .limit(1);
    if (count.length === 0) {
      return NextResponse.json({ error: "Nothing to share yet" }, { status: 400 });
    }

    let token = conv.shareToken;
    if (!token) {
      token = crypto.randomBytes(12).toString("hex");
      await db
        .update(conversations)
        .set({ shareToken: token })
        .where(eq(conversations.id, conv.id));
    }
    return NextResponse.json({ token, path: `/share/${token}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Share failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    if (!body.token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }
    await db
      .update(conversations)
      .set({ shareToken: null })
      .where(eq(conversations.shareToken, body.token));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Revoke failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
