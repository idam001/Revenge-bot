"use client";

import React, { useState } from "react";
import { PROMPT_ARSENAL, type PromptTemplate } from "@/lib/revenge-registry";
import { ArrowUpRight, Sparkles, X } from "lucide-react";

interface PromptArsenalModalProps {
  open: boolean;
  onClose: () => void;
  onUsePrompt: (prompt: string, autoSend?: boolean) => void;
}

export function PromptArsenalModal({
  open,
  onClose,
  onUsePrompt,
}: PromptArsenalModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  if (!open) return null;

  const categories = [
    "All",
    "Code & Artifacts",
    "Web Search",
    "Unchained",
    "Deep Architecture",
    "Video Studio",
    "Image Studio",
    "Creative",
  ];

  const items = PROMPT_ARSENAL.filter(
    (p) => selectedCategory === "All" || p.category === selectedCategory
  );

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/55 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-anim w-full max-w-3xl h-[88dvh] sm:h-auto sm:max-h-[84vh] rounded-t-3xl sm:rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          <div>
            <h3 className="font-claude-serif text-base font-semibold text-[var(--text-primary)]">
              Prompt Library & Coding Blueprints
            </h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Launch full-application Artifact builds, unchained research tasks, or deep systems code
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-[var(--border-subtle)] overflow-x-auto bg-[var(--bg-sidebar)]">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                selectedCategory === cat
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((item: PromptTemplate) => (
            <div
              key={item.id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] p-4 flex flex-col justify-between transition"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-mono font-semibold text-[var(--accent)] bg-[var(--accent-soft)] px-2 py-0.5 rounded">
                    {item.slash}
                  </span>
                  <span className="text-[10.5px] text-[var(--text-muted)]">
                    {item.category}
                  </span>
                </div>
                <h4 className="text-[13.5px] font-semibold text-[var(--text-primary)] mt-1.5">
                  {item.title}
                </h4>
                <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="flex items-center gap-2 mt-3.5 pt-2.5 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => {
                    onUsePrompt(item.prompt, false);
                    onClose();
                  }}
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] hover:bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-medium transition cursor-pointer"
                >
                  Edit Prompt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUsePrompt(item.prompt, true);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  Run
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
