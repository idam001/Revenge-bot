import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { appSettings, memories } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function getOrCreateSettings() {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, "default"));

  if (row) return row;

  const [created] = await db
    .insert(appSettings)
    .values({ id: "default" })
    .returning();
  return created;
}

export async function GET() {
  try {
    await ensureDbSchema();
    const settings = await getOrCreateSettings();
    const memoryList = await db
      .select()
      .from(memories)
      .orderBy(desc(memories.createdAt));

    return NextResponse.json({ settings, memories: memoryList });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await ensureDbSchema();
    await getOrCreateSettings();

    const body = (await req.json()) as {
      defaultModelId?: string;
      defaultPersonaId?: string;
      customSystemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      reasoningEffort?: string;
      webSearchDefault?: boolean;
      autoFailover?: boolean;
      streamResponses?: boolean;
      featureFlags?: Record<string, boolean>;
    };

    const updates: Partial<typeof appSettings.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof body.defaultModelId === "string")
      updates.defaultModelId = body.defaultModelId;
    if (typeof body.defaultPersonaId === "string")
      updates.defaultPersonaId = body.defaultPersonaId;
    if (typeof body.customSystemPrompt === "string")
      updates.customSystemPrompt = body.customSystemPrompt;
    if (typeof body.temperature === "number")
      updates.temperature = Math.max(0, Math.min(2, body.temperature));
    if (typeof body.maxTokens === "number")
      updates.maxTokens = Math.max(256, Math.min(16384, body.maxTokens));
    if (typeof body.reasoningEffort === "string")
      updates.reasoningEffort = body.reasoningEffort;
    if (typeof body.webSearchDefault === "boolean")
      updates.webSearchDefault = body.webSearchDefault;
    if (typeof body.autoFailover === "boolean")
      updates.autoFailover = body.autoFailover;
    if (typeof body.streamResponses === "boolean")
      updates.streamResponses = body.streamResponses;
    if (body.featureFlags && typeof body.featureFlags === "object") {
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(body.featureFlags).slice(0, 80)) {
        if (/^[a-z0-9_]{1,40}$/i.test(k) && typeof v === "boolean") clean[k] = v;
      }
      updates.featureFlags = clean;
    }

    const [updated] = await db
      .update(appSettings)
      .set(updates)
      .where(eq(appSettings.id, "default"))
      .returning();

    return NextResponse.json({ settings: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const body = (await req.json()) as {
      action: "addMemory" | "toggleMemory" | "deleteMemory" | "clearMemories";
      id?: string;
      content?: string;
      category?: string;
    };

    if (body.action === "addMemory" && body.content?.trim()) {
      const [created] = await db
        .insert(memories)
        .values({
          content: body.content.trim().slice(0, 600),
          category: body.category || "preference",
          enabled: true,
        })
        .returning();
      return NextResponse.json({ memory: created });
    }

    if (body.action === "toggleMemory" && body.id) {
      const [existing] = await db
        .select()
        .from(memories)
        .where(eq(memories.id, body.id));
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const [updated] = await db
        .update(memories)
        .set({ enabled: !existing.enabled })
        .where(eq(memories.id, body.id))
        .returning();
      return NextResponse.json({ memory: updated });
    }

    if (body.action === "deleteMemory" && body.id) {
      await db.delete(memories).where(eq(memories.id, body.id));
      return NextResponse.json({ ok: true });
    }

    if (body.action === "clearMemories") {
      await db.delete(memories);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid memory action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
