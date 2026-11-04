import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { appSettings, memories } from "@/db/schema";
import { getOwner } from "@/lib/auth";
import { serverError } from "@/lib/api-response";
import { and, desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Settings are now per-owner. The row id is derived from the owner key so a
 * guest's preferences never leak into a signed-in user's account.
 */
function settingsRowId(ownerKey: string) {
  return `set_${ownerKey}`.slice(0, 120);
}

async function getOrCreateSettings(ownerKey: string) {
  const id = settingsRowId(ownerKey);
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, id));
  if (row) return row;

  const [created] = await db
    .insert(appSettings)
    .values({ id, ownerKey })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, id));
  return existing;
}

export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return NextResponse.json({ settings: null, memories: [] });
    }
    const settings = await getOrCreateSettings(owner.key);
    const memoryList = await db
      .select()
      .from(memories)
      .where(eq(memories.ownerKey, owner.key))
      .orderBy(desc(memories.createdAt))
      .limit(200);

    return NextResponse.json({ settings, memories: memoryList });
  } catch (err) {
    return serverError(err, "Failed to load settings");
  }
}

export async function PUT(req: Request) {
  try {
    await ensureDbSchema();
    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return NextResponse.json({ error: "Session unavailable" }, { status: 401 });
    }
    await getOrCreateSettings(owner.key);

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
      theme?: string;
      personalInstructions?: string;
      memoryEnabled?: boolean;
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
    if (body.theme === "dark" || body.theme === "light" || body.theme === "system")
      updates.theme = body.theme;
    if (typeof body.personalInstructions === "string")
      updates.personalInstructions = body.personalInstructions.slice(0, 8000);
    if (typeof body.memoryEnabled === "boolean")
      updates.memoryEnabled = body.memoryEnabled;
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
      .where(and(eq(appSettings.id, settingsRowId(owner.key)), eq(appSettings.ownerKey, owner.key)))
      .returning();

    return NextResponse.json({ settings: updated });
  } catch (err) {
    return serverError(err, "Failed to save settings");
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

    const owner = await getOwner({ create: true, request: req });
    if (!owner) {
      return NextResponse.json({ error: "Session unavailable", code: "NO_SESSION" }, { status: 401 });
    }

    if (body.action === "addMemory" && body.content?.trim()) {
      const [created] = await db
        .insert(memories)
        .values({
          ownerKey: owner.key,
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
        .where(and(eq(memories.id, body.id), eq(memories.ownerKey, owner.key)));
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const [updated] = await db
        .update(memories)
        .set({ enabled: !existing.enabled })
        .where(and(eq(memories.id, body.id), eq(memories.ownerKey, owner.key)))
        .returning();
      return NextResponse.json({ memory: updated });
    }

    if (body.action === "deleteMemory" && body.id) {
      await db
        .delete(memories)
        .where(and(eq(memories.id, body.id), eq(memories.ownerKey, owner.key)));
      return NextResponse.json({ ok: true });
    }

    if (body.action === "clearMemories") {
      await db.delete(memories).where(eq(memories.ownerKey, owner.key));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid memory action" }, { status: 400 });
  } catch (err) {
    return serverError(err, "Memory action failed");
  }
}
