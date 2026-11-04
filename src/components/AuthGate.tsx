"use client";

import { useEffect, useRef, useState } from "react";
import {
  makeSignInChallenge,
  challengePasses,
  type SignInChallenge,
} from "@/lib/auth-client";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

type Status = "checking" | "ready" | "signed-out";

/* ------------------------------------------------------------------ */
/*  Sign-in human check                                                */
/* ------------------------------------------------------------------ */

/** Cloudflare Turnstile site key, if the deployment configured one. */
const TURNSTILE_SITE_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) || "";

/**
 * A small proof-of-human step before OAuth.
 *
 * Supabase does not CAPTCHA-check Google OAuth callbacks, so bot volume has to be
 * stopped before the redirect. When NEXT_PUBLIC_TURNSTILE_SITE_KEY is set we use
 * Cloudflare Turnstile (free, usually invisible); otherwise this self-contained
 * challenge runs with no external dependency and no key.
 */
function HumanCheck({
  onVerified,
}: {
  onVerified: (token: string | null) => void;
}) {
  const [challenge, setChallenge] = useState<SignInChallenge>(() => makeSignInChallenge());
  const [typed, setTyped] = useState("");
  const [shake, setShake] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const holderRef = useRef<HTMLDivElement>(null);

  // Turnstile path (only when a site key exists).
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !holderRef.current) return;
    const scriptId = "cf-turnstile-script";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const render = () => {
      const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => void } };
      if (!w.turnstile || !holderRef.current) return;
      w.turnstile.render(holderRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => {
          setTurnstileToken(token);
          onVerified(token);
        },
      });
    };
    const timer = window.setInterval(render, 400);
    return () => window.clearInterval(timer);
  }, [onVerified]);

  if (TURNSTILE_SITE_KEY) {
    return (
      <div className="mt-4">
        <div ref={holderRef} />
        {!turnstileToken && (
          <p className="mt-2 text-center text-[11.5px] text-[var(--text-secondary)]">
            Confirming you are human…
          </p>
        )}
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (challengePasses(challenge, typed)) {
      onVerified(null);
      return;
    }
    setShake(true);
    setTyped("");
    setChallenge(makeSignInChallenge());
    window.setTimeout(() => setShake(false), 400);
  };

  return (
    <form onSubmit={submit} className="mt-4">
      <label
        htmlFor="human-check"
        className="block text-[12.5px] text-[var(--text-secondary)]"
      >
        Quick check before we send you to Google — type this word:
      </label>
      <div className="mt-2 flex items-stretch gap-2">
        <div
          aria-label="Challenge word"
          className="select-none rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3.5 py-2 font-mono text-[15px] tracking-[0.18em] text-[var(--text-primary)]"
        >
          {challenge.display}
        </div>
        <input
          id="human-check"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`min-w-0 flex-1 rounded-lg border bg-[var(--bg-main)] px-3 py-2 text-[14px] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] ${
            shake ? "border-red-400" : "border-[var(--border-strong)]"
          }`}
          placeholder="the word above"
        />
        <button
          type="submit"
          className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]"
        >
          Verify
        </button>
      </div>
    </form>
  );
}


/**
 * Moves any conversations saved under the pre-gate anonymous scope onto this
 * account. Safe to call on every load: the server treats repeats as a no-op.
 */
async function claimLegacyGuestChats() {
  try {
    await fetch("/api/auth/claim-guest", { method: "POST" });
  } catch {
    // Non-fatal: the user keeps working even if the claim cannot run.
  }
}

/**
 * Google sign-in gate.
 *
 * Everything inside the app requires a signed-in account. The old guest mode is
 * gone from this path entirely: no anonymous scope is issued, so there is no way
 * to reach the studio without identifying yourself first.
 *
 * Guest conversations created before this gate shipped are claimed automatically
 * on first sign-in (see /api/auth/claim-guest), so nothing you already had is
 * stranded.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [humanVerified, setHumanVerified] = useState(false);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        // Auth is not configured — do not lock the owner out of their own app.
        if (alive) setStatus("ready");
        return;
      }
      try {
        const { data } = await supabase.auth.getUser();
        if (alive) setStatus(data.user ? "ready" : "signed-out");
        if (data.user) void claimLegacyGuestChats();
      } catch {
        if (alive) setStatus("signed-out");
      }
    };

    void check();

    const supabase = createSupabaseBrowserClient();
    const sub = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setStatus(session?.user ? "ready" : "signed-out");
    });

    return () => {
      alive = false;
      sub?.data.subscription.unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setBusy(false);
      setError("Sign-in is not configured on this deployment.");
      return;
    }
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/chat`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (err) {
      setBusy(false);
      setError(err.message);
    }
    // On success the browser navigates to Google; keep the spinner up.
  };

  if (status === "checking") {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[var(--bg-main)]">
        <div className="flex items-center gap-2.5 text-[13.5px] text-[var(--text-secondary)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" />
          Checking your session…
        </div>
      </div>
    );
  }

  if (status === "ready") return <>{children}</>;

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center bg-[var(--bg-main)] px-5">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <div
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)]"
            aria-hidden="true"
          >
            <span className="text-[22px]">💀</span>
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-primary)]">
            REVENGE GPT
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-secondary)]">
            Sign in to open the studio. Your chats stay private to your account.
          </p>
        </div>

        <HumanCheck onVerified={() => setHumanVerified(true)} />

        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={busy || !humanVerified}
          className="flex w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-[14px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: "#ffffff",
            color: "#1f1f1f",
            border: "1px solid rgba(0,0,0,0.12)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
          }}
        >
          {busy ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
          )}
          {busy ? "Redirecting to Google…" : humanVerified ? "Continue with Google" : "Verify above to continue"}
        </button>

        {error && (
          <p className="mt-3 text-center text-[12.5px] text-red-400" role="alert">
            {error}
          </p>
        )}

        <p className="mt-6 text-center text-[11.5px] leading-relaxed text-[var(--text-tertiary,#8a8a8a)]">
          By continuing you agree to use this studio responsibly.
        </p>
      </div>
    </div>
  );
}
