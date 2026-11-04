import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db, ensureDbSchema } from "@/db";
import { GUEST_COOKIE, GUEST_HEADER, getSessionUser } from "@/lib/auth";
import { serverError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * Claims the conversations and memories created under an anonymous guest scope
 * before the Google sign-in gate existed, moving them onto the account.
 *
 * Idempotent by design: `guest_merges` records each (user, guest) pair, so a
 * repeated call is a no-op and can never move someone else's rows twice.
 *
 * Only rows whose ownerKey is exactly that guest scope are touched — a signed-in
 * account's own conversations are never rewritten by this route.
 */
export async function POST(req: Request) {
  try {
    await ensureDbSchema();

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in with Google to continue.", code: "SIGN_IN_REQUIRED" },
        { status: 401 }
      );
    }

    // Same precedence the rest of the app uses: cookie first, header fallback.
    const store = await cookies();
    let token = store.get(GUEST_COOKIE)?.value ?? "";
    if (!token) {
      const header = req.headers.get(GUEST_HEADER)?.trim() ?? "";
      if (/^[a-f0-9]{32,64}$/.test(header)) token = header;
    }
    if (!/^[a-f0-9]{32,64}$/.test(token)) {
      return NextResponse.json({ claimed: 0, reason: "no_guest_scope" });
    }

    const guestKey = `guest:${token}`;
    const userKey = `user:${user.id}`;

    const already = await db.execute(sql`
      SELECT 1 FROM "guest_merges"
      WHERE "userId" = ${user.id} AND "guestToken" = ${token}
      LIMIT 1
    `);
    if (already.rowCount && already.rowCount > 0) {
      return NextResponse.json({ claimed: 0, reason: "already_claimed" });
    }

    const moved = await db.execute(sql`
      WITH convs AS (
        UPDATE "conversations" SET "ownerKey" = ${userKey}
        WHERE "ownerKey" = ${guestKey}
        RETURNING 1
      ), msgs AS (
        UPDATE "messages" SET "ownerKey" = ${userKey}
        WHERE "ownerKey" = ${guestKey}
        RETURNING 1
      ), mems AS (
        UPDATE "memories" SET "ownerKey" = ${userKey}
        WHERE "ownerKey" = ${guestKey}
        RETURNING 1
      ), keys AS (
        UPDATE "provider_keys" SET "ownerKey" = ${userKey}
        WHERE "ownerKey" = ${guestKey}
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM convs)::int AS conversations,
        (SELECT count(*) FROM msgs)::int AS messages,
        (SELECT count(*) FROM mems)::int AS memories,
        (SELECT count(*) FROM keys)::int AS keys
    `);

    const row = (moved.rows?.[0] ?? {}) as {
      conversations?: number;
      messages?: number;
      memories?: number;
      keys?: number;
    };

    await db.execute(sql`
      INSERT INTO "guest_merges" ("userId", "guestToken", "conversationsMoved", "memoriesMoved")
      VALUES (${user.id}, ${token}, ${row.conversations ?? 0}, ${row.memories ?? 0})
    `);

    return NextResponse.json({
      claimed: row.conversations ?? 0,
      messages: row.messages ?? 0,
      memories: row.memories ?? 0,
      providerKeys: row.keys ?? 0,
    });
  } catch (err) {
    console.error("[claim-guest] " + (err instanceof Error ? err.message : err));
    return serverError(err, "Could not link your earlier chats");
  }
}
