"use client";

/**
 * Small fetch wrapper used by the chat UI.
 *
 * Its job: keep a stable *guest data scope* even when the browser drops the
 * httpOnly guest cookie (Safari ITP, embedded webviews, cross-site iframes).
 * Without this, each request would be treated as a brand-new guest and the
 * user's conversation history would appear to vanish mid-chat.
 *
 * The scope id lives in localStorage purely as a data-partition label — it
 * grants nothing, and a signed-in session always takes precedence server-side.
 */
const SCOPE_KEY = "revenge.guestScope";

export function getGuestScope(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(SCOPE_KEY) ?? "";
  } catch {
    return "";
  }
}

export async function rememberGuestScope(scopeId: string | undefined | null) {
  if (!scopeId || typeof window === "undefined") return;
  try {
    localStorage.setItem(SCOPE_KEY, scopeId);
  } catch {
    /* storage disabled — cookie path still works */
  }
}

/** fetch() with the guest-scope header attached. */
export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const scope = getGuestScope();
  if (scope && !headers.has("x-revenge-guest")) {
    headers.set("x-revenge-guest", scope);
  }
  const res = await fetch(input, { ...init, headers });
  return res;
}

/** Prime the guest scope once per page load. */
export async function primeGuestScope() {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const data = await res.json();
    if (data?.guest?.scopeId) await rememberGuestScope(data.guest.scopeId);
  } catch {
    /* ignore */
  }
}
