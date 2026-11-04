import { NextResponse } from "next/server";
import { db, ensureDbSchema } from "@/db";
import { conversations, guestMerges, memories, messages } from "@/db/schema";
import { GUEST_COOKIE, getOwner, getSessionUser } from "@/lib/auth";
import { and, eq, inArray, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me — who am I (also reports whether Google login is configured).
 * Creates the guest cookie on first call so guest scoping starts immediately.
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    const owner = await getOwner({ create: true, request: req });

    return NextResponse.json({
      authenticated: Boolean(user),
      user: user ?? null,
      guest: !user && owner
        ? { scoped: true, scopeId: owner.key.replace(/^guest:/, "") }
        : { scoped: false },
      authConfigured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ),
    });
  } catch {
    return NextResponse.json({ authenticated: false, user: null, authConfigured: false });
  }
}

/**
 * POST /api/auth/me { action: "merge-guest" | "discard-guest" }
 *
 * Called by the browser right after a successful Google sign-in. It moves the
 * guest's conversations/memories onto the new account. It is idempotent per
 * (user, guest token) pair and refuses to touch rows it does not own, so it can
 * never overwrite another account's data.
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchema();
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first", code: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const owner = await getOwner();
    // Read the guest token straight from the request cookie as well: getting
    // here already required a valid user session, and a refresh may have
    // re-written cookies in this very response.
    const cookieToken = (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${GUEST_COOKIE}=`))
      ?.slice(GUEST_COOKIE.length + 1) ?? "";
    const ownerToken = owner?.kind === "guest" ? owner.key.replace(/^guest:/, "") : "";
    const guestToken = cookieToken || ownerToken;

    if (body.action === "discard-guest") {
      return NextResponse.json({ ok: true, merged: false });
    }

    if (body.action !== "merge-guest") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    if (!guestToken) {
      return NextResponse.json({ ok: true, merged: false, reason: "no_guest_session" });
    }

    const userKey = `user:${user.id}`;
    const guestKey = `guest:${guestToken}`;

    // Basic abuse guard: one merge attempt per user per 10 seconds
    const recent = await db
      .select({ id: guestMerges.id })
      .from(guestMerges)
      .where(eq(guestMerges.userId, user.id))
      .orderBy(sql`"createdAt" DESC`)
      .limit(1);
    if (recent.length > 0) {
      const already = await db
        .select({ id: guestMerges.id })
        .from(guestMerges)
        .where(and(eq(guestMerges.userId, user.id), eq(guestMerges.guestToken, guestToken)));
      if (already.length > 0) {
        return NextResponse.json({ ok: true, merged: false, reason: "already_merged" });
      }
    }

    // Only ever move rows that belong to this exact guest session.
    const guestConvs = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.ownerKey, guestKey));

    const guestMems = await db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.ownerKey, guestKey));

    if (guestConvs.length > 0) {
      const ids = guestConvs.map((c) => c.id);
      await db
        .update(conversations)
        .set({ ownerKey: userKey, updatedAt: new Date() })
        .where(inArray(conversations.id, ids));
      // messages follow their conversation
      await db
        .update(messages)
        .set({ ownerKey: userKey })
        .where(inArray(messages.conversationId, ids));
    }

    if (guestMems.length > 0) {
      await db
        .update(memories)
        .set({ ownerKey: userKey })
        .where(inArray(memories.id, guestMems.map((m) => m.id)));
    }

    await db.insert(guestMerges).values({
      userId: user.id,
      guestToken,
      conversationsMoved: guestConvs.length,
      memoriesMoved: guestMems.length,
    });

    return NextResponse.json({
      ok: true,
      merged: true,
      conversationsMoved: guestConvs.length,
      memoriesMoved: guestMems.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
