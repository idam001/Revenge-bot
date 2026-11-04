"use client";

/**
 * AccountMenu — the single place the user signs in / out and sees who they are.
 * Renders a prominent "Continue with Google" button for guests, and an avatar
 * dropdown for signed-in users. If Google OAuth has not been configured on the
 * project it says so plainly instead of pretending to work.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LogIn,
  LogOut,
  Settings,
  User as UserIcon,
  ChevronDown,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { fetchMe, signInWithGoogle, signOut, type ClientUser } from "@/lib/auth-client";
import { apiFetch, rememberGuestScope } from "@/lib/api-client";

interface Props {
  /** "sidebar" shows the wide card, "header" the compact avatar. */
  variant?: "sidebar" | "header";
  onAuthChange?: (user: ClientUser | null) => void;
}

export function AccountMenu({ variant = "sidebar", onAuthChange }: Props) {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [authConfigured, setAuthConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if ((me as any)?.guest?.scopeId) rememberGuestScope((me as any).guest.scopeId);
    setUser(me.user);
    setAuthConfigured(me.authConfigured);
    setLoading(false);
    onAuthChange?.(me.user);
  }, [onAuthChange]);

  useEffect(() => {
    load();
  }, [load]);

  // Merge any guest work into the account once, right after sign-in.
  useEffect(() => {
    if (!user) return;
    const key = `revenge-merged:${user.id}`;
    if (localStorage.getItem(key)) return;
    apiFetch("/api/auth/me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "merge-guest" }),
    })
      .then((r) => r.json())
      .then((data) => {
        localStorage.setItem(key, "1");
        if (data?.merged && data.conversationsMoved > 0) {
          setBanner(
            `Moved ${data.conversationsMoved} conversation${data.conversationsMoved === 1 ? "" : "s"} from your guest session into your account.`
          );
          window.dispatchEvent(new CustomEvent("revenge:conversations-changed"));
        }
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSignIn = async () => {
    setBusy(true);
    const { error } = await signInWithGoogle("/chat");
    if (error) {
      setBusy(false);
      setBanner(error);
    }
  };

  if (loading) {
    return (
      <div className={variant === "sidebar" ? "px-3 py-2" : "p-2"}>
        <div className="h-9 animate-pulse rounded-lg bg-[var(--bg-elevated-2)]" />
      </div>
    );
  }

  /* ───────────── signed out ───────────── */
  if (!user) {
    if (variant === "header") {
      return (
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy || !authConfigured}
          title={authConfigured ? "Sign in with Google" : "Google sign-in is not configured"}
          className="flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          <span className="hidden sm:inline">Sign in</span>
        </button>
      );
    }
    return (
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy || !authConfigured}
          className="rg-google-btn group flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleGlyph className="h-4 w-4" />
          )}
          Continue with Google
        </button>
        {!authConfigured && (
          <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            Google sign-in needs <code className="text-[var(--accent)]">GOOGLE_CLIENT_ID</code> +{" "}
            <code className="text-[var(--accent)]">GOOGLE_CLIENT_SECRET</code> in Supabase. You can keep using
            the app as a guest — your chats are saved to this browser.
          </p>
        )}
        {banner && (
          <p className="mt-2 rounded-lg bg-[var(--accent-soft)] px-2 py-1.5 text-[11.5px] text-[var(--text-secondary)]">
            {banner}
          </p>
        )}
      </div>
    );
  }

  /* ───────────── signed in ───────────── */
  const initials = (user.name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div ref={menuRef} className="relative px-2 pb-2">
      {banner && (
        <p className="mb-2 rounded-lg bg-[var(--accent-soft)] px-2 py-1.5 text-[11.5px] text-[var(--text-secondary)]">
          {banner}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2 py-2 text-left transition hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border-strong)]"
          />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[13px] font-bold text-white">
            {initials}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {user.name}
          </span>
          <span className="block truncate text-[11px] text-[var(--text-muted)]">{user.email}</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-2 right-2 z-50 mb-1 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        >
          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)]"
          >
            <UserIcon className="h-4 w-4" /> Account & profile
          </Link>
          <Link
            href="/account#appearance"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)]"
          >
            <Settings className="h-4 w-4" /> Preferences
          </Link>
          <Link
            href="/account#privacy"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)]"
          >
            <ShieldCheck className="h-4 w-4" /> Privacy
          </Link>
          <div className="h-px bg-[var(--border-subtle)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut()}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-[13px] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)]"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
