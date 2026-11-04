"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FlaskConical,
  Keyboard,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";
import {
  ACCENTS,
  BRANDS,
  BRAND_COLORS,
  CATEGORIES,
  DEFAULT_FLAGS,
  FEATURES,
  type Brand,
  type FeatureDef,
} from "@/lib/feature-catalog";
import { getModelById } from "@/lib/revenge-registry";

interface Stats {
  chats: number;
  messages: number;
  images: number;
  videos: number;
  searches: number;
  avgSpeed: number;
  topModels: Array<{ modelId: string; n: number }>;
}

interface FeatureLabProps {
  open: boolean;
  onClose: () => void;
  flags: Record<string, boolean>;
  onFlag: (id: string, value: boolean) => void;
  onResetFlags: () => void;
  accent: string;
  onAccent: (id: string) => void;
  onShowShortcuts: () => void;
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer shrink-0 ${
        on ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function BrandChip({ brand }: { brand: Brand }) {
  const c = BRAND_COLORS[brand];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
      style={{ color: c, backgroundColor: `${c}1f`, border: `1px solid ${c}55` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
      {brand}
    </span>
  );
}

function StatusPill({ status }: { status: FeatureDef["status"] }) {
  if (status === "live")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide text-emerald-400">
        <Check className="w-3 h-3" /> LIVE
      </span>
    );
  if (status === "new")
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-amber-400/15 text-amber-300 border border-amber-400/40">
        <Zap className="w-3 h-3" /> NEW
      </span>
    );
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-violet-400/10 text-violet-300 border border-violet-400/40">
      ROADMAP
    </span>
  );
}

export function FeatureLab({
  open,
  onClose,
  flags,
  onFlag,
  onResetFlags,
  accent,
  onAccent,
  onShowShortcuts,
}: FeatureLabProps) {
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<Brand | "All">("All");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [stats, setStats] = useState<Stats | null>(null);
  const [savedPulse, setSavedPulse] = useState(false);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && !d.error) setStats(d as Stats);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  const flag = (id: string, v: boolean) => {
    onFlag(id, v);
    setSavedPulse(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setSavedPulse(false), 1400);
  };

  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    return FEATURES.filter((f) => {
      if (brand !== "All" && f.brand !== brand && !(f.also ?? []).includes(brand)) return false;
      if (category !== "All" && f.category !== category) return false;
      if (
        q &&
        !f.name.toLowerCase().includes(q) &&
        !f.blurb.toLowerCase().includes(q) &&
        !f.brand.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [query, brand, category]);

  const sections: Array<{ key: FeatureDef["status"]; title: string; sub: string }> = [
    { key: "new", title: "New this upgrade", sub: "Flip what you want — it applies instantly" },
    { key: "live", title: "Already live in REVENGE", sub: "Built in previous upgrades, always on" },
    { key: "planned", title: "On the roadmap", sub: "Star what you want built next" },
  ];

  const liveCount = FEATURES.filter((f) => f.status === "live").length;
  const newDefs = FEATURES.filter((f) => f.status === "new");
  const votable = newDefs.filter((f) => f.control === "switch");
  const enabledNew = votable.filter((f) => flags[f.id]).length;
  const votes = FEATURES.filter((f) => f.status === "planned" && flags[`vote_${f.id}`]).length;

  if (!open) return null;

  const lengthValue = flags.len_short ? "short" : flags.len_detailed ? "detailed" : "default";
  const setLength = (v: string) => {
    onFlag("len_short", v === "short");
    onFlag("len_detailed", v === "detailed");
    setSavedPulse(true);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setSavedPulse(false), 1400);
  };

  const renderControl = (f: FeatureDef) => {
    switch (f.control) {
      case "switch":
        return (
          <div className="flex items-center justify-between gap-3">
            <span className={`text-[12px] font-medium ${flags[f.id] ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>
              {flags[f.id] ? "On" : "Off"}
            </span>
            <Switch on={Boolean(flags[f.id])} onToggle={() => flag(f.id, !flags[f.id])} label={f.name} />
          </div>
        );
      case "length":
        return (
          <div className="flex rounded-lg bg-[var(--bg-main)] p-0.5 border border-[var(--border-subtle)]">
            {[
              { id: "short", label: "Short" },
              { id: "default", label: "Default" },
              { id: "detailed", label: "Detailed" },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setLength(o.id)}
                className={`flex-1 px-2 py-1.5 rounded-md text-[12px] font-medium transition cursor-pointer ${
                  lengthValue === o.id
                    ? "bg-[var(--accent)] text-white shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      case "accent":
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.name}
                aria-label={`Accent ${a.name}`}
                onClick={() => onAccent(a.id)}
                className={`w-7 h-7 rounded-full transition-transform cursor-pointer hover:scale-110 ${
                  accent === a.id ? "ring-2 ring-offset-2 ring-offset-[var(--bg-elevated)]" : ""
                }`}
                style={{ backgroundColor: a.color, ["--tw-ring-color" as string]: a.color }}
              />
            ))}
            <span className="text-[11.5px] text-[var(--text-muted)] ml-1">
              {ACCENTS.find((a) => a.id === accent)?.name ?? "Ember"}
            </span>
          </div>
        );
      case "vote": {
        const voted = Boolean(flags[`vote_${f.id}`]);
        return (
          <button
            type="button"
            onClick={() => flag(`vote_${f.id}`, !voted)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition cursor-pointer ${
              voted
                ? "bg-amber-400/15 border-amber-400/50 text-amber-300"
                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${voted ? "fill-current" : ""}`} />
            {voted ? "Voted — build this" : "Vote to build"}
          </button>
        );
      }
      case "stats":
        return stats ? (
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              { n: stats.chats, l: "chats" },
              { n: stats.messages, l: "messages" },
              { n: stats.images + stats.videos, l: "renders" },
            ].map((s) => (
              <div key={s.l} className="rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] py-1.5">
                <div className="text-[15px] font-bold text-[var(--text-primary)] tabular-nums">{s.n}</div>
                <div className="text-[10px] text-[var(--text-muted)]">{s.l}</div>
              </div>
            ))}
            {stats.topModels[0] && (
              <div className="col-span-3 text-[10.5px] text-[var(--text-muted)] truncate">
                Top engine: <span className="text-[var(--accent)]">{getModelById(stats.topModels[0].modelId).shortName}</span>
                {stats.avgSpeed > 0 && <> · avg {stats.avgSpeed} tok/s</>}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[12px] text-[var(--text-muted)]">Loading your numbers…</div>
        );
      default:
        return f.hint ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <Sparkles className="w-3 h-3 text-[var(--accent)]" />
            {f.hint}
          </span>
        ) : (
          <span className="text-[11.5px] text-emerald-400/80 font-medium">Included · always on</span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-[64] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-anim w-full sm:max-w-5xl h-[94dvh] sm:h-[88vh] rounded-t-3xl sm:rounded-2xl bg-[var(--bg-main)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Masthead */}
        <div className="relative shrink-0 overflow-hidden fl-masthead">
          <div className="relative px-5 sm:px-8 pt-5 sm:pt-7 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.18em] text-white/70">
                  <FlaskConical className="w-3.5 h-3.5" />
                  REVENGE GPT · FEATURE LAB
                </div>
                <h2 className="font-claude-serif text-[26px] sm:text-[34px] leading-tight text-white mt-1.5">
                  Steal the frontier.
                </h2>
                <p className="text-[12.5px] sm:text-[13.5px] text-white/75 mt-1 max-w-xl leading-relaxed">
                  Every feature worth having from ChatGPT, Claude, Gemini, Grok & Perplexity —
                  rebuilt keyless and unchained. Flip what you want; it applies instantly.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Feature Lab"
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              {[
                { n: liveCount, l: "live" },
                { n: newDefs.length, l: "new" },
                { n: FEATURES.filter((f) => f.status === "planned").length, l: "roadmap" },
                { n: 6, l: "brands" },
              ].map((s) => (
                <span key={s.l} className="px-2.5 py-1 rounded-full bg-black/25 border border-white/15 text-[11px] text-white/90 font-medium tabular-nums">
                  {s.n} {s.l}
                </span>
              ))}
              <span className="ml-auto flex items-center gap-2 text-[11px] text-white/80">
                <span className="hidden sm:inline">{enabledNew}/{votable.length} toggles on</span>
                <span className="w-24 h-1.5 rounded-full bg-black/30 overflow-hidden">
                  <span
                    className="block h-full bg-white/90 rounded-full transition-all duration-300"
                    style={{ width: `${votable.length ? (enabledNew / votable.length) * 100 : 0}%` }}
                  />
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] space-y-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search features — temporary chat, share, voice, tasks…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setBrand("All")}
              className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap border transition cursor-pointer ${
                brand === "All"
                  ? "bg-[var(--text-primary)] text-[var(--bg-main)] border-transparent"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              All brands
            </button>
            {BRANDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBrand(brand === b ? "All" : b)}
                className="px-2.5 py-1 rounded-full text-[11.5px] font-semibold whitespace-nowrap border transition cursor-pointer"
                style={
                  brand === b
                    ? { backgroundColor: BRAND_COLORS[b], borderColor: "transparent", color: "#0b0b0a" }
                    : { borderColor: `${BRAND_COLORS[b]}66`, color: BRAND_COLORS[b] }
                }
              >
                {b}
              </button>
            ))}
            <span className="w-px h-4 bg-[var(--border-subtle)] mx-1 shrink-0" />
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-2.5 py-1 rounded-full text-[11.5px] whitespace-nowrap border transition cursor-pointer ${
                  category === c
                    ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] font-semibold"
                    : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-8">
          {sections.map((sec) => {
            const items = matches.filter((f) => f.status === sec.key);
            if (items.length === 0) return null;
            return (
              <section key={sec.key}>
                <div className="flex items-baseline gap-2.5 mb-3">
                  <h3 className="font-claude-serif text-[18px] text-[var(--text-primary)]">{sec.title}</h3>
                  <span className="text-[11.5px] text-[var(--text-muted)]">{items.length} · {sec.sub}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {items.map((f) => {
                    const c = BRAND_COLORS[f.brand];
                    return (
                      <article
                        key={f.id}
                        className="fl-card group relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 flex flex-col gap-2.5 transition-all duration-200 hover:-translate-y-0.5"
                        style={{ ["--fl-brand" as string]: c }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <BrandChip brand={f.brand} />
                            {(f.also ?? []).slice(0, 2).map((a) => (
                              <span key={a} className="text-[10px] text-[var(--text-muted)]">+{a}</span>
                            ))}
                          </div>
                          <StatusPill status={f.status} />
                        </div>
                        <div>
                          <h4 className="text-[14.5px] font-semibold text-[var(--text-primary)] leading-snug">{f.name}</h4>
                          <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed mt-1">{f.blurb}</p>
                        </div>
                        <div className="mt-auto pt-2 border-t border-[var(--border-subtle)]/70">{renderControl(f)}</div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {matches.length === 0 && (
            <div className="text-center py-16 text-sm text-[var(--text-muted)]">
              Nothing matches “{query}”. Try another word or clear the filters.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] min-w-0">
            <span
              className={`inline-flex items-center gap-1.5 transition-opacity duration-300 ${
                savedPulse ? "opacity-100 text-emerald-400" : "opacity-70"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              {savedPulse ? "Saved" : "Changes save instantly"}
            </span>
            {votes > 0 && <span className="hidden sm:inline">· {votes} roadmap vote{votes > 1 ? "s" : ""}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onShowShortcuts}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Shortcuts</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onResetFlags();
                setSavedPulse(true);
                if (pulseTimer.current) clearTimeout(pulseTimer.current);
                pulseTimer.current = setTimeout(() => setSavedPulse(false), 1400);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[12.5px] font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_FLAGS };
