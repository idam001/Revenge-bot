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
  guest?: { scoped: boolean; scopeId?: string };
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
/* ------------------------------------------------------------------ */
/*  Sign-in human check (shared by every "Continue with Google" button) */
/* ------------------------------------------------------------------ */

export interface SignInChallenge {
  answer: string;
  display: string;
}

const CHALLENGE_WORDS = [
  "orbit", "lantern", "copper", "velvet", "harbor", "cactus", "falcon",
  "marble", "python", "tundra", "beacon", "anchor", "garnet", "willow",
  "quartz", "ember", "signal", "cobalt", "saddle", "thunder",
];

export function makeSignInChallenge(): SignInChallenge {
  const answer = CHALLENGE_WORDS[Math.floor(Math.random() * CHALLENGE_WORDS.length)];
  const display = answer
    .split("")
    .map((ch, i) => (i === 2 ? `${ch}\u200d` : ch))
    .join("");
  return { answer, display };
}

/** Does the typed text match the challenge? Case and stray spaces are forgiven. */
export function challengePasses(challenge: SignInChallenge, typed: string): boolean {
  return typed.trim().toLowerCase() === challenge.answer.toLowerCase();
}

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

/** Broadcast an auth change so greetings, avatars and scoped lists refresh. */
export function notifyAuthChanged(user?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("revenge:auth-changed", { detail: user ?? null }));
}

export async function signOut() {
  const supabase = createSupabaseBrowserClient();
  if (supabase) {
    await supabase.auth.signOut().catch(() => {});
  }
  // Also clear the guest cookie so the next session starts clean.
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
  notifyAuthChanged(null);
  // Force a full page transition so Supabase cookies and in-memory auth state are discarded.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/";
}
