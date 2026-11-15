"use client";

/**
 * AccountPanel — profile, appearance, personalisation and privacy controls.
 * Everything here is backed by /api/settings (per-owner) or /api/auth/*.
 */
import { useCallback, useEffect, useState } from "react";
import { signOut } from "@/lib/auth-client";
import { apiFetch } from "@/lib/api-client";
import {
  Check,
  Download,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";

interface Props {
  user: { id: string; email: string | null; name: string; avatarUrl: string | null };
}

type Theme = "dark" | "light" | "system";

interface Settings {
  theme: Theme;
  personalInstructions: string;
  memoryEnabled: boolean;
  defaultModelId: string;
  defaultPersonaId: string;
  customSystemPrompt: string;
  temperature: number;
  maxTokens: number;
  webSearchDefault: boolean;
  autoFailover: boolean;
  streamResponses: boolean;
}

const FALLBACK: Settings = {
  theme: "dark",
  personalInstructions: "",
  memoryEnabled: true,
  defaultModelId: "revenge-omega-x",
  defaultPersonaId: "unchained",
  customSystemPrompt: "",
  temperature: 0.7,
  maxTokens: 8192,
  webSearchDefault: false,
  autoFailover: true,
  streamResponses: true,
};

export function AccountPanel({ user }: Props) {
  const [settings, setSettings] = useState<Settings>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<Array<{ id: string; content: string; category: string; enabled: boolean }>>([]);
  const [stats, setStats] = useState<{ chats: number; messages: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [sRes, stRes] = await Promise.all([
        apiFetch("/api/settings", { cache: "no-store" }),
        apiFetch("/api/stats", { cache: "no-store" }),
      ]);
      const sData = await sRes.json();
      const stData = await stRes.json();
      if (sData.settings) {
        setSettings({ ...FALLBACK, ...sData.settings });
      }
      setMemories(Array.isArray(sData.memories) ? sData.memories : []);
      setStats({ chats: stData.chats ?? 0, messages: stData.messages ?? 0 });
    } catch {
      setError("Could not load your preferences.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
      setSavedAt(1);
      if (patch.theme) applyTheme(patch.theme);
    } catch {
      setError("Could not save that change. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const exportChats = async () => {
    try {
      const res = await apiFetch("/api/conversations", { cache: "no-store" });
      const data = await res.json();
      const convs = data.conversations ?? [];
      const full: unknown[] = [];
      for (const c of convs) {
        const r = await apiFetch(`/api/conversations/${c.id}`, { cache: "no-store" });
        if (r.ok) full.push(await r.json());
      }
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), conversations: full }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `revenge-gpt-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed.");
    }
  };

  const deleteAllChats = async () => {
    if (!confirm("Delete every conversation in your account? This cannot be undone.")) return;
    const res = await apiFetch("/api/conversations", { method: "DELETE" });
    if (res.ok) {
      setStats((s) => (s ? { ...s, chats: 0, messages: 0 } : s));
    }
  };

  const initials = (user.name || user.email || "?").charAt(0).toUpperCase();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your account…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="h-16 w-16 rounded-full object-cover ring-2 ring-[var(--border-strong)]"
            />
          ) : (
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[var(--accent)] text-2xl font-bold text-white">
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[var(--text-primary)]">{user.name}</h1>
            <p className="truncate text-[13px] text-[var(--text-muted)]">{user.email}</p>
            <div className="mt-2 flex items-center gap-3 text-[12px] text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[var(--accent)]">
                <ShieldCheck className="h-3 w-3" /> Private account
              </span>
              {stats && (
                <span>
                  {stats.chats} chats · {stats.messages} messages
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* appearance */}
      <section id="appearance" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-[var(--text-primary)]">Appearance</h2>
        <p className="mb-4 text-[12.5px] text-[var(--text-muted)]">Choose how REVENGE GPT looks on this device.</p>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "dark" as Theme, label: "Dark", icon: Moon },
              { id: "light" as Theme, label: "Light", icon: Sun },
              { id: "system" as Theme, label: "System", icon: Monitor },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = settings.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => save({ theme: t.id })}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-[12.5px] transition ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {active && <Check className="h-3 w-3 text-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* personalisation */}
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-[var(--text-primary)]">Personal instructions</h2>
        <p className="mb-3 text-[12.5px] text-[var(--text-muted)]">
          Added to the system prompt of every new chat in your account.
        </p>
        <textarea
          value={settings.personalInstructions}
          onChange={(e) => setSettings({ ...settings, personalInstructions: e.target.value })}
          placeholder="e.g. I'm a backend engineer. Prefer TypeScript, be concise, show diffs before full files."
          rows={4}
          className="w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => save({ personalInstructions: settings.personalInstructions })}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--text-primary)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--bg-main)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save instructions
          </button>
          {savedAt && <span className="text-[12px] text-[var(--text-muted)]">Saved</span>}
          {error && <span className="text-[12px] text-red-400">{error}</span>}
        </div>
      </section>

      {/* memory */}
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Memory</h2>
            <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
              Memories are private to your account and injected into future chats.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.memoryEnabled}
            onClick={() => save({ memoryEnabled: !settings.memoryEnabled })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              settings.memoryEnabled ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                settings.memoryEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
        {memories.length > 0 && (
          <ul className="mt-4 space-y-2">
            {memories.slice(0, 20).map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[12.5px] text-[var(--text-secondary)]"
              >
                <span className="mt-0.5 rounded bg-[var(--bg-elevated-2)] px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">
                  {m.category}
                </span>
                <span className="flex-1">{m.content}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* data & privacy */}
      <section id="privacy" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <h2 className="mb-1 text-[15px] font-semibold text-[var(--text-primary)]">Data & privacy</h2>
        <p className="mb-4 text-[12.5px] text-[var(--text-muted)]">
          Your conversations, memories and API keys are scoped to your account and cannot be read by other users.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportChats}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)]"
          >
            <Download className="h-3.5 w-3.5" /> Export all chats (JSON)
          </button>
          <button
            type="button"
            onClick={deleteAllChats}
            className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-3 py-1.5 text-[12.5px] text-red-400 transition hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete all my chats
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[12.5px] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated-2)]"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </section>

      <p className="flex items-center gap-1.5 pb-6 text-[11.5px] text-[var(--text-muted)]">
        <UserRound className="h-3.5 w-3.5" /> Account ID {user.id}
      </p>
    </div>
  );
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "claude-light"
        : "claude-dark"
      : theme === "light"
      ? "claude-light"
      : "claude-dark";
  root.dataset.theme = resolved;
  localStorage.setItem("revenge-theme", theme);
}
