import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { conversations } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDbSchema();
    const list = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt));
    return NextResponse.json({ conversations: list });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      modelId?: string;
      personaId?: string;
      folder?: string;
      systemPrompt?: string;
    };

    const [created] = await db
      .insert(conversations)
      .values({
        title: body.title?.trim() || "New Revenge Session",
        modelId: body.modelId || "revenge-omega-x",
        personaId: body.personaId || "unchained",
        folder: body.folder || "General",
        systemPrompt: body.systemPrompt || null,
      })
      .returning();

    return NextResponse.json({ conversation: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await ensureDbSchema();
    await db.delete(conversations);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clear conversations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
