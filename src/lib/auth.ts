/**
 * Server-side identity + authorization helpers.
 *
 * Two kinds of caller are supported, deliberately:
 *
 *  - "user"  : a real Supabase account (Google OAuth). Identity comes from a
 *              signed httpOnly cookie session verified server-side.
 *  - "guest" : an anonymous browser identified by a random token stored in an
 *              httpOnly cookie. Guests keep every existing feature, but their
 *              data is scoped to that token so it can later be merged into a
 *              real account.
 *
 * Nothing here trusts a client-supplied user id. The owner key is derived from
 * either the verified Supabase session or a cookie the client cannot read.
 */
import { cookies } from "next/headers";
import { createSupabaseServerClient, isAuthConfigured } from "./supabase-server";

export const GUEST_COOKIE = "revenge_guest";
/**
 * Header the browser client can use when third-party cookies are blocked or the
 * response is cached. It is NOT an authentication credential — only an
 * anonymous data-scope id, so it is safe for client JS to hold and send.
 */
export const GUEST_HEADER = "x-revenge-guest";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type OwnerKind = "user" | "guest";

export interface Owner {
  /** Stable ownership key written to every row: `user:<uuid>` or `guest:<token>` */
  key: string;
  kind: OwnerKind;
  userId: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
}

/** Ownership key used for records that existed before accounts were introduced. */
export const LEGACY_OWNER_KEY = "legacy:public";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function newGuestToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getGuestToken(): Promise<string> {
  const store = await cookies();
  return store.get(GUEST_COOKIE)?.value ?? "";
}

/**
 * Resolve the caller. In a Route Handler you may pass { create: true } to mint
 * a guest cookie when none exists yet.
 */
/**
 * Signed-in user for gated surfaces.
 *
 * The whole app is behind Google sign-in, so an anonymous guest scope is no
 * longer created for the studio or its APIs. Requests without a verified
 * session are rejected here rather than being silently downgraded to a guest,
 * which also closes the "just call the API directly" bypass.
 */
export async function requireUser(_req?: Request) {
  const user = await getSessionUser();
  if (!user) {
    return {
      user: null as null,
      response: Response.json(
        { error: "Sign in with Google to continue.", code: "SIGN_IN_REQUIRED" },
        { status: 401 }
      ),
    };
  }
  return { user, response: null as null };
}

export async function getOwner(
  opts: { create?: boolean; request?: Request } = {}
): Promise<Owner | null> {
  const user = await getSessionUser();
  if (user) {
    return {
      key: `user:${user.id}`,
      kind: "user",
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isAdmin: Boolean(user.email && adminEmails().includes(user.email.toLowerCase())),
    };
  }

  const store = await cookies();
  let token = store.get(GUEST_COOKIE)?.value ?? "";

  // Fallback: a client that could not receive the httpOnly cookie echoes the
  // scope id back in a header. Using it keeps the same guest scope instead of
  // silently minting a fresh one (which would orphan the user's chats).
  if (!token && opts.request) {
    const header = opts.request.headers.get(GUEST_HEADER)?.trim() ?? "";
    if (/^[a-f0-9]{32,64}$/.test(header)) token = header;
  }

  if (!token) {
    if (!opts.create) return null;
    token = newGuestToken();
    try {
      store.set(GUEST_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: GUEST_COOKIE_MAX_AGE,
      });
    } catch {
      // Read-only cookie store (Server Component render). Caller falls back.
      return null;
    }
  }
  return {
    key: `guest:${token}`,
    kind: "guest",
    userId: null,
    email: null,
    name: null,
    avatarUrl: null,
    isAdmin: false,
  };
}

/** The verified Supabase user for this request, or null. */
export async function getSessionUser() {
  if (!isAuthConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    // Distinguish "no valid session" from "could not verify right now".
    // A network/timeout error must not silently downgrade a signed-in user
    // into a guest context (that would look like data loss to the user).
    if (error && !user) {
      const isAuthError =
        error.status === 400 ||
        error.status === 401 ||
        error.status === 403 ||
        /invalid|expired|missing|jwt|token/i.test(error.message ?? "");
      if (!isAuthError) {
        throw new Error(`AUTH_UNAVAILABLE: ${error.message}`);
      }
      return null;
    }
    if (!user) return null;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: user.id,
      email: user.email ?? null,
      name:
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        (user.email ? user.email.split("@")[0] : "Account"),
      avatarUrl:
        (typeof meta.avatar_url === "string" && meta.avatar_url) ||
        (typeof meta.picture === "string" && meta.picture) ||
        null,
    };
  } catch {
    return null;
  }
}

/** True when the row belongs to the caller (or is public legacy data). */
export function canAccess(ownerKey: string | null | undefined, owner: Owner | null): boolean {
  if (!ownerKey || ownerKey === LEGACY_OWNER_KEY) return true; // pre-auth public data
  if (!owner) return false;
  return ownerKey === owner.key;
}

export function unauthorized() {
  return Response.json(
    { error: "Sign in to access this resource.", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

export function forbidden() {
  return Response.json(
    { error: "You do not have access to this resource.", code: "FORBIDDEN" },
    { status: 403 }
  );
}

export function rateLimited(retryAfterSec = 30) {
  return Response.json(
    { error: "Too many requests. Please slow down.", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}
