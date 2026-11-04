"use client";

import { createSupabaseBrowserClient } from "./supabase-browser";

export interface ClientUser {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

export async function fetchMe(): Promise<{
  authenticated: boolean;
  user: ClientUser | null;
  authConfigured: boolean;
}> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    if (!res.ok) throw new Error("me failed");
    return await res.json();
  } catch {
    return { authenticated: false, user: null, authConfigured: false };
  }
}

/** Kick off Google OAuth. Redirects back to /api/auth/callback. */
export async function signInWithGoogle(next = "/chat") {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    return { error: "Google sign-in is not configured on this deployment." };
  }
  const redirectTo = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  return { error: error?.message ?? null };
}

export async function signOut() {
  const supabase = createSupabaseBrowserClient();
  if (supabase) {
    await supabase.auth.signOut().catch(() => {});
  }
  // Also clear the guest cookie so the next session starts clean.
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
  window.location.href = "/";
}
