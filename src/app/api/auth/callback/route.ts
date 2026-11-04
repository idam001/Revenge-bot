import { NextResponse } from "next/server";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * OAuth / magic-link callback. Exchanges the PKCE code for a session, writes the
 * session cookies, then redirects back into the app.
 *
 * Security notes:
 *  - `next` is restricted to a same-origin absolute path. Anything else
 *    (protocol-relative `//evil.com`, `https://…`, backslash tricks) collapses
 *    to /chat, so the callback cannot be used as an open redirect.
 *  - The guest scope is only ever claimed through /api/auth/claim-guest, which
 *    requires a verified session and is idempotent per (user, guest).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") || "/chat";
  const errorDescription = url.searchParams.get("error_description");
  const oauthError = url.searchParams.get("error");

  const safeNext = sanitizeNext(rawNext);

  if (errorDescription || oauthError) {
    const msg = errorDescription || oauthError || "sign_in_failed";
    return NextResponse.redirect(
      new URL(`/chat?auth_error=${encodeURIComponent(msg)}`, url.origin)
    );
  }

  if (!isAuthConfigured()) {
    return NextResponse.redirect(
      new URL("/chat?auth_error=auth_not_configured", url.origin)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/chat?auth_error=missing_code", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/chat?auth_error=auth_not_configured", url.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/chat?auth_error=${encodeURIComponent(error.message)}`, url.origin)
    );
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}

/**
 * Only a plain, same-origin path is allowed as a post-login destination.
 * Returns /chat for anything that could leave the site.
 */
function sanitizeNext(value: string): string {
  if (!value.startsWith("/")) return "/chat";
  // Reject protocol-relative and backslash variants that browsers normalise
  // into a different host.
  if (value.startsWith("//") || value.startsWith("/\\") || value.includes("\\")) {
    return "/chat";
  }
  // Reject an embedded scheme or control characters.
  if (/^\/\s*[a-z][a-z0-9+.-]*:/i.test(value) || /[\u0000-\u001f]/.test(value)) {
    return "/chat";
  }
  // Only app routes are legitimate destinations.
  const allowed = ["/chat", "/account", "/"];
  const path = value.split("?")[0].split("#")[0];
  return allowed.includes(path) ? value : "/chat";
}
