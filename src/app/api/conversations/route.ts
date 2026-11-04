import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { conversations } from "@/db/schema";
import { getOwner } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { and, desc, eq, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/conversations — only the caller's own conversations.
 *
 * Guest sessions see their own guest-scoped rows. Legacy rows created before
 * accounts existed have ownerKey 'legacy:public' and are deliberately NOT
 * listed here (they were never private, but they also aren't the caller's).
 */
export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return NextResponse.json({ conversations: [], scoped: false });
    }

    const rl = rateLimit(`convs:get:${owner.key}:${clientKey(req)}`, 240, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const list = await db
      .select()
      .from(conversations)
      .where(eq(conversations.ownerKey, owner.key))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
      .limit(500);

    return NextResponse.json({
      conversations: list,
      scoped: true,
      ownerKind: owner.kind,
      authenticated: owner.kind === "user",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return NextResponse.json({ error: "Session unavailable", code: "NO_SESSION" }, { status: 401 });
    }

    const rl = rateLimit(`convs:post:${owner.key}`, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many new chats. Give it a second.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

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
        ownerKey: owner.key,
        title: (body.title?.trim() || "New Revenge Session").slice(0, 120),
        modelId: (body.modelId || "revenge-omega-x").slice(0, 80),
        personaId: (body.personaId || "unchained").slice(0, 80),
        folder: (body.folder || "General").slice(0, 80),
        systemPrompt: body.systemPrompt ? body.systemPrompt.slice(0, 8000) : null,
      })
      .returning();

    return NextResponse.json({ conversation: created }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/conversations — delete ALL of the caller's conversations.
 * Never a global truncate: signed-in and guest data stay isolated.
 */
export async function DELETE() {
  try {
    await ensureDbSchema();
    const owner = await getOwner();
    if (!owner) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }
    const deleted = await db
      .delete(conversations)
      .where(and(eq(conversations.ownerKey, owner.key), or()))
      .returning({ id: conversations.id });
    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clear conversations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
