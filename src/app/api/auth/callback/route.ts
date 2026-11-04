import { NextResponse } from "next/server";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * OAuth / magic-link callback. Exchanges the PKCE code for a session and
 * writes the session cookies, then redirects back into the app.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/chat";
  const errorDescription = url.searchParams.get("error_description");

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/chat";

  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/chat?auth_error=${encodeURIComponent(errorDescription)}`, url.origin)
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
