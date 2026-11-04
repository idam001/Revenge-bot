"use client";
/** Browser-only Supabase client. Only ever uses the publishable (anon) key. */
import { createBrowserClient } from "@supabase/ssr";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createSupabaseBrowserClient() {
  if (!URL_ || !ANON) return null;
  return createBrowserClient(URL_, ANON);
}

/**
 * Starts the Google OAuth flow.
 *
 * Used by both the /chat gate and the landing page so a visitor who clicks
 * "Open chat" goes straight to Google instead of being bounced through a
 * second screen. The `next` target is validated server-side by the callback.
 */
export async function startGoogleSignIn(next = "/chat"): Promise<{ error?: string }> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { error: "Sign-in is not configured on this deployment." };
  const redirectTo = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  return error ? { error: error.message } : {};
}
