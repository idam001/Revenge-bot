import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbSchema } from "@/db";
import { conversations, projectHubs } from "@/db/schema";
import { getOwner, requireUser } from "@/lib/auth";
import { isUuid, serverError } from "@/lib/api-response";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    await ensureDbSchema();
    const gate = await requireUser(req);
    if (gate.response) return gate.response;
    const owner = await getOwner({ create: false, request: req });
    const { id } = await context.params;
    if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    const body = await req.json().catch(() => ({})) as {
      name?: string; description?: string; instructions?: string; color?: string;
    };
    const updates: Partial<typeof projectHubs.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.name === "string") {
      if (!body.name.trim()) return NextResponse.json({ error: "Project name cannot be blank" }, { status: 400 });
      updates.name = body.name.trim().slice(0, 80);
    }
    if (typeof body.description === "string") updates.description = body.description.slice(0, 500);
    if (typeof body.instructions === "string") updates.instructions = body.instructions.slice(0, 8000);
    if (typeof body.color === "string" && /^[a-z-]{1,24}$/.test(body.color)) updates.color = body.color;
    const [project] = await db.update(projectHubs).set(updates)
      .where(and(eq(projectHubs.id, id), eq(projectHubs.ownerKey, owner.key))).returning();
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (err) {
    return serverError(err, "Failed to update project");
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  try {
    await ensureDbSchema();
    const gate = await requireUser(req);
    if (gate.response) return gate.response;
    const owner = await getOwner({ create: false, request: req });
    const { id } = await context.params;
    if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (!isUuid(id)) return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    const [project] = await db.select().from(projectHubs)
      .where(and(eq(projectHubs.id, id), eq(projectHubs.ownerKey, owner.key)));
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    await db.update(conversations).set({ projectId: null, updatedAt: new Date() })
      .where(and(eq(conversations.projectId, id), eq(conversations.ownerKey, owner.key)));
    await db.delete(projectHubs).where(and(eq(projectHubs.id, id), eq(projectHubs.ownerKey, owner.key)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Failed to delete project");
  }
}
