"use client";

import React, { useState } from "react";
import { Check, KeyRound, Search, X } from "lucide-react";
import {
  CLOUD_BYOK_MODELS,
  KEYLESS_MODELS,
  type AIModelDefinition,
} from "@/lib/revenge-registry";
import type { ProviderStatusItem } from "./UniversalVaultModal";

interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  providers: ProviderStatusItem[];
  onOpenVault: () => void;
}

type FilterTab = "all" | "coding" | "long" | "uncensored" | "vision" | "video" | "image" | "byok";

export function ModelPickerModal({
  open,
  onClose,
  selectedModelId,
  onSelectModel,
  providers,
  onOpenVault,
}: ModelPickerModalProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");

  if (!open) return null;

  const configured = new Set(
    providers.filter((p) => p.configured).map((p) => p.id)
  );

  const match = (m: AIModelDefinition) => {
    const q = query.toLowerCase().trim();
    if (
      q &&
      !m.name.toLowerCase().includes(q) &&
      !m.description.toLowerCase().includes(q) &&
      !m.providerLabel.toLowerCase().includes(q) &&
      !m.badge.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (filter === "long") return Boolean(m.longOutput);
    if (filter === "vision") return Boolean(m.supportsVision);
    if (filter === "video") return Boolean(m.supportsVideoGen);
    if (filter === "image") return Boolean(m.supportsImageGen);
    if (filter === "coding")
      return (
        !m.requiresKey &&
        !m.supportsVideoGen &&
        !m.supportsImageGen &&
        (m.category === "coding" ||
          m.category === "reasoning" ||
          m.category === "flagship")
      );
    if (filter === "uncensored")
      return (
        !m.requiresKey &&
        (m.category === "uncensored" ||
          m.category === "creative" ||
          m.id === "revenge-omega-x")
      );
    if (filter === "byok") return m.requiresKey;
    return true;
  };

  const free = KEYLESS_MODELS.filter(match);
  const cloud = CLOUD_BYOK_MODELS.filter(match);

  const Row = ({ m, locked }: { m: AIModelDefinition; locked?: boolean }) => {
    const active = m.id === selectedModelId;
    return (
      <button
        type="button"
        onClick={() => {
          onSelectModel(m.id);
          onClose();
        }}
        className={`w-full text-left px-3.5 py-3 rounded-xl flex items-start justify-between gap-3 transition cursor-pointer ${
          active
            ? "bg-[var(--bg-elevated-2)]"
            : "hover:bg-[var(--bg-elevated-2)]/70"
        }`}
      >
        <div className="min-w-0">
          <div className="text-[14.5px] font-medium text-[var(--text-primary)] flex items-center gap-2">
            <span className="truncate">{m.name}</span>
            {m.longOutput && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-medium shrink-0">
                LONG CODE
              </span>
            )}
            {m.supportsVision && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 font-medium shrink-0">
                VISION
              </span>
            )}
            {m.supportsVideoGen && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-soft)] text-[var(--accent)] font-medium shrink-0">
                VIDEO
              </span>
            )}
            {m.supportsImageGen && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium shrink-0">
                IMAGE
              </span>
            )}
            {locked && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-main)] text-[var(--text-muted)] font-normal shrink-0">
                needs key
              </span>
            )}
          </div>
          <div className="text-[12.5px] text-[var(--text-muted)] mt-0.5 line-clamp-2 leading-snug">
            {m.description}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1 font-mono">
            {m.providerLabel} · {m.maxOutputLabel}
            {m.supportsReasoning ? " · thinking" : ""}
          </div>
        </div>
        {active && (
          <Check className="w-4 h-4 text-[var(--accent)] shrink-0 mt-1" />
        )}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/55 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-anim w-full sm:max-w-lg h-[84dvh] sm:h-auto sm:max-h-[82vh] rounded-t-3xl sm:rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="sm:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--border-strong)]" />
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
            Choose a model ({KEYLESS_MODELS.length} free)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-2 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search text, coding, video, image, or red-team models"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)]"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {(
              [
                { id: "all", label: "All" },
                { id: "coding", label: "Code & Think" },
                { id: "long", label: "Long Output" },
                { id: "uncensored", label: "Unchained & Red-Team" },
                { id: "vision", label: "Vision (sees photos)" },
                { id: "video", label: "Free Video" },
                { id: "image", label: "Free Image" },
                { id: "byok", label: "Your Keys" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  filter === t.id
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--bg-main)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 safe-bottom">
          {free.length > 0 && (
            <>
              <div className="px-3.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Free · no API key ({free.length})
              </div>
              {free.map((m) => (
                <Row key={m.id} m={m} />
              ))}
            </>
          )}

          {cloud.length > 0 && (
            <>
              <div className="px-3.5 pt-4 pb-1 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Bring your own key ({cloud.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenVault();
                  }}
                  className="text-xs text-[var(--accent)] inline-flex items-center gap-1 cursor-pointer"
                >
                  <KeyRound className="w-3 h-3" /> Manage keys
                </button>
              </div>
              {cloud.map((m) => (
                <Row key={m.id} m={m} locked={!configured.has(m.providerId)} />
              ))}
            </>
          )}

          {free.length === 0 && cloud.length === 0 && (
            <div className="text-center py-10 text-sm text-[var(--text-muted)]">
              No models match “{query}”.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
