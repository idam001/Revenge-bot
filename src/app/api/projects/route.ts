import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, ensureDbSchema } from "@/db";
import { conversations, projectHubs } from "@/db/schema";
import { getOwner, requireUser } from "@/lib/auth";
import { serverError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureDbSchema();
    const gate = await requireUser(req);
    if (gate.response) return gate.response;
    const owner = await getOwner({ create: false, request: req });
    if (!owner) return NextResponse.json({ projects: [] });
    const rows = await db.select().from(projectHubs)
      .where(eq(projectHubs.ownerKey, owner.key))
      .orderBy(desc(projectHubs.updatedAt));
    const projectCounts = await db.select({ id: conversations.projectId })
      .from(conversations).where(eq(conversations.ownerKey, owner.key));
    const counts = new Map<string, number>();
    for (const row of projectCounts) {
      if (row.id) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    }
    return NextResponse.json({ projects: rows.map((project) => ({
      ...project,
      conversationCount: counts.get(project.id) ?? 0,
    })) });
  } catch (err) {
    return serverError(err, "Failed to load projects");
  }
}

export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const gate = await requireUser(req);
    if (gate.response) return gate.response;
    const owner = await getOwner({ create: false, request: req });
    if (!owner) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const body = await req.json().catch(() => ({})) as {
      name?: string; description?: string; instructions?: string; color?: string;
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
    const [project] = await db.insert(projectHubs).values({
      ownerKey: owner.key,
      name: name.slice(0, 80),
      description: (body.description ?? "").slice(0, 500),
      instructions: (body.instructions ?? "").slice(0, 8000),
      color: /^[a-z-]{1,24}$/.test(body.color ?? "") ? body.color! : "ember",
    }).returning();
    return NextResponse.json({ project: { ...project, conversationCount: 0 } }, { status: 201 });
  } catch (err) {
    return serverError(err, "Failed to create project");
  }
}
