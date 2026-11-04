"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, MessageSquare, Search, Zap } from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  onOpenConversation: (id: string) => void;
}

interface ChatHit {
  id: string;
  title: string;
}
interface MsgHit {
  messageId: string;
  conversationId: string;
  role: string;
  title: string;
  snippet: string;
}

export function CommandPalette({ open, onClose, actions, onOpenConversation }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<ChatHit[]>([]);
  const [hits, setHits] = useState<MsgHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setChats([]);
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setChats([]);
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search-messages?q=${encodeURIComponent(q)}`);
        if (r.ok) {
          const d = (await r.json()) as { chats?: ChatHit[]; hits?: MsgHit[] };
          setChats(d.chats ?? []);
          setHits(d.hits ?? []);
        }
      } catch {
        /* offline: actions still work */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query, open]);

  const filteredActions = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  const flat = useMemo(
    () => [
      ...filteredActions.map((a) => ({ kind: "action" as const, a })),
      ...chats.map((c) => ({ kind: "chat" as const, c })),
      ...hits.map((h) => ({ kind: "hit" as const, h })),
    ],
    [filteredActions, chats, hits]
  );

  useEffect(() => setActive(0), [flat.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const pick = (i: number) => {
    const item = flat[i];
    if (!item) return;
    onClose();
    if (item.kind === "action") item.a.run();
    else if (item.kind === "chat") onOpenConversation(item.c.id);
    else onOpenConversation(item.h.conversationId);
  };

  let idx = -1;

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/60 px-3 pt-[10dvh]" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-anim w-full max-w-xl rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-[var(--border-subtle)]">
          <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(active);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Search all messages, chats and actions…"
            className="flex-1 bg-transparent py-3.5 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <kbd className="hidden sm:block text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-muted)]">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52dvh] overflow-y-auto py-1.5">
          {filteredActions.length > 0 && (
            <div className="px-4 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Actions
            </div>
          )}
          {filteredActions.map((a) => {
            idx++;
            const i = idx;
            return (
              <button
                key={a.id}
                type="button"
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left cursor-pointer ${
                  active === i ? "bg-[var(--bg-elevated-2)]" : ""
                }`}
              >
                <span className="flex items-center gap-2.5 text-[13.5px] text-[var(--text-primary)]">
                  <Zap className="w-3.5 h-3.5 text-[var(--accent)]" />
                  {a.label}
                </span>
                {a.hint && <span className="text-[11px] text-[var(--text-muted)]">{a.hint}</span>}
              </button>
            );
          })}

          {chats.length > 0 && (
            <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Chats
            </div>
          )}
          {chats.map((c) => {
            idx++;
            const i = idx;
            return (
              <button
                key={c.id}
                type="button"
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left cursor-pointer ${
                  active === i ? "bg-[var(--bg-elevated-2)]" : ""
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <span className="text-[13.5px] text-[var(--text-primary)] truncate">{c.title}</span>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] ml-auto shrink-0" />
              </button>
            );
          })}

          {hits.length > 0 && (
            <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Messages
            </div>
          )}
          {hits.map((h) => {
            idx++;
            const i = idx;
            return (
              <button
                key={h.messageId}
                type="button"
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`w-full flex items-start gap-2.5 px-4 py-2.5 text-left cursor-pointer ${
                  active === i ? "bg-[var(--bg-elevated-2)]" : ""
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                    {h.title} <span className="text-[var(--text-muted)] font-normal">· {h.role === "user" ? "you" : "AI"}</span>
                  </span>
                  <span className="block text-[12px] text-[var(--text-secondary)] line-clamp-2 leading-snug">{h.snippet}</span>
                </span>
              </button>
            );
          })}

          {loading && flat.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">Searching…</div>
          )}
          {!loading && query.trim().length >= 2 && flat.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
              No matches for “{query}”.
            </div>
          )}
          {query.trim().length < 2 && filteredActions.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
              Type at least two letters to search your history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
