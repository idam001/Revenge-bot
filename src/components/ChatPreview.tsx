"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, Globe, Sparkles } from "lucide-react";

/* ------------------------------------------------------------------ *
 * Tiny dependency-free syntax highlighter for the landing preview.
 * (The real chat uses its own renderer; this is marketing-only.)
 * ------------------------------------------------------------------ */

const JS_KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|await|async|import|from|export|default|new|class|extends|try|catch|throw|typeof|instanceof|null|undefined|true|false|this|of|in|break|continue|switch|case|do|void|delete|yield|static|get|set)\b/g;

const PY_KEYWORDS =
  /\b(def|return|if|elif|else|for|while|import|from|as|class|try|except|finally|raise|with|lambda|None|True|False|and|or|not|in|is|pass|break|continue|global|yield|async|await|assert|del)\b/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Splits source into highlighted spans. Order matters: comments and strings win. */
function highlight(code: string, lang: string): string {
  const isPy = lang === "python";
  const tokens: Array<{ type: string; value: string }> = [];
  let rest = code;

  const pattern = isPy
    ? /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rest)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "plain", value: rest.slice(lastIndex, match.index) });
    }
    if (match[1]) tokens.push({ type: "com", value: match[1] });
    else if (match[2]) tokens.push({ type: "str", value: match[2] });
    else if (match[3]) tokens.push({ type: "num", value: match[3] });
    else if (match[4]) tokens.push({ type: "fn", value: match[4] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < rest.length) {
    tokens.push({ type: "plain", value: rest.slice(lastIndex) });
  }

  return tokens
    .map((t) => {
      const esc = escapeHtml(t.value);
      if (t.type !== "plain") return `<span class="tok-${t.type}">${esc}</span>`;
      const kw = isPy ? PY_KEYWORDS : JS_KEYWORDS;
      return esc.replace(kw, (m) => `<span class="tok-key">${m}</span>`);
    })
    .join("");
}

/* ------------------------------------------------------------------ *
 * Scripted demo conversation (real product capabilities only)
 * ------------------------------------------------------------------ */

const DEMO_CODE = `app.post("/api/comments", async (req, res) => {
  const { postId, body } = req.body;

  // 1. Validate input before it touches the database
  if (!body || body.length > 2000) {
    return res.status(400).json({ error: "Invalid body" });
  }

  // 2. Parameterised query - blocks SQL injection
  const saved = await db.insert(comments)
    .values({ postId, body, authorId: req.user.id })
    .returning();

  // 3. Escape on output - blocks stored XSS
  res.json({ comment: escapeHtml(saved.body) });
});`;

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: string[];
  code?: { lang: string; value: string };
}

const SCRIPT: Turn[] = [
  {
    role: "user",
    text: "I built a profile page that saves comments.\nHow do I test it for stored XSS?",
  },
  {
    role: "assistant",
    text: "Two things to check, in this order:",
  },
  {
    role: "assistant",
    text: "1. Is output escaped? If you render comments with innerHTML, a payload like <img src=x onerror=alert(1)> executes on load.\n\n2. Is input validated? Cap the length and reject HTML tags before you store anything.",
  },
  {
    role: "assistant",
    text: "Here is the hardened handler:",
    code: { lang: "javascript", value: DEMO_CODE },
  },
  {
    role: "assistant",
    text: "Escaping on output kills the stored variant; the parameterised insert removes the SQL injection path at the same time. Want me to add a CSP header next?",
    sources: ["OWASP XSS Prevention Cheat Sheet", "PortSwigger Web Security Academy"],
  },
];

const SUGGESTIONS = [
  "Add a Content-Security-Policy header",
  "Write a test for the stored XSS case",
  "Show the CSP report-only rollout plan",
];

/* ------------------------------------------------------------------ */

export function ChatPreview() {
  const [turnIndex, setTurnIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = SCRIPT[turnIndex];
  const isCode = Boolean(current?.code);
  const done = typed.length >= (current?.text.length ?? 0);

  // Typewriter streaming for the current turn, then advance.
  useEffect(() => {
    if (!current) return;
    if (isCode) {
      // Code blocks appear instantly (no fake typing of code)
      const t = setTimeout(() => setTurnIndex((i) => i + 1), 900);
      return () => clearTimeout(t);
    }
    if (done) {
      const t = setTimeout(() => {
        setTyped("");
        setTurnIndex((i) => (i + 1 < SCRIPT.length ? i + 1 : 0));
      }, 1250);
      return () => clearTimeout(t);
    }
    timerRef.current = setTimeout(() => {
      setTyped(current.text.slice(0, typed.length + (current.text.length > 90 ? 3 : 2)));
    }, 16);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [typed, current, done, isCode]);

  // Keep the newest turn in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turnIndex, typed]);

  const codeHtml = useMemo(
    () => (current?.code ? highlight(current.code.value, current.code.lang) : ""),
    [current]
  );

  const handleCopy = async () => {
    if (!current?.code) return;
    await navigator.clipboard.writeText(current.code.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const restart = () => {
    setTyped("");
    setTurnIndex(0);
  };

  return (
    <div className="lp-card overflow-hidden">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 h-11 border-b border-[var(--lp-line)] bg-[#0c0c10]">
        <span className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
        </span>
        <span className="ml-2 text-[12px] text-white/45 font-mono truncate">
          revenge — chat · no account needed
        </span>
        <button
          type="button"
          onClick={restart}
          className="ml-auto text-[12px] text-white/45 hover:text-white transition cursor-pointer"
        >
          Replay
        </button>
      </div>

      {/* Turns */}
      <div
        ref={scrollRef}
        className="px-4 sm:px-6 py-6 space-y-5 min-h-[300px] max-h-[420px] overflow-y-auto"
      >
        {SCRIPT.slice(0, turnIndex + 1).map((turn, i) => {
          const isCurrent = i === turnIndex;
          const visibleText = isCurrent ? typed : turn.text;

          if (turn.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] border border-white/10 px-4 py-3">
                  <p className="text-[14.5px] leading-relaxed text-white/90 whitespace-pre-line">
                    {visibleText}
                    {isCurrent && !done && <span className="lp-caret" />}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div key={i} className="flex gap-3">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-[#d97757]/15 border border-[#d97757]/30 flex items-center justify-center mt-0.5">
                <Sparkles className="w-3.5 h-3.5 text-[#d97757]" />
              </span>
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-[14.5px] leading-relaxed text-white/80 whitespace-pre-line">
                  {visibleText}
                  {isCurrent && !done && <span className="lp-caret" />}
                </p>

                {isCurrent && turn.code && (
                  <div className="rounded-xl border border-white/10 bg-[#0a0a0c] overflow-hidden">
                    <div className="flex items-center justify-between px-3.5 h-9 border-b border-white/[0.07] bg-white/[0.03]">
                      <span className="text-[11.5px] font-mono text-white/45">
                        {turn.code.lang}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1.5 text-[11.5px] text-white/55 hover:text-white transition cursor-pointer"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-4 overflow-x-auto text-[12.5px] leading-[1.65] font-mono text-white/85">
                      <code dangerouslySetInnerHTML={{ __html: codeHtml }} />
                    </pre>
                  </div>
                )}

                {isCurrent && turn.sources && done && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {turn.sources.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 text-[11.5px] text-white/55"
                      >
                        <Globe className="w-3 h-3 text-emerald-400" />
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {turnIndex === SCRIPT.length - 1 && (
          <div className="flex flex-wrap gap-2 pl-10">
            {SUGGESTIONS.map((s) => (
              <span
                key={s}
                className="px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-[12.5px] text-white/55"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Fake composer to mirror the real product */}
      <div className="border-t border-[var(--lp-line)] p-3">
        <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/10 px-3.5 h-11">
          <span className="flex-1 text-[13.5px] text-white/35 truncate">
            Ask about security, labs, or CTFs…
          </span>
          <span className="w-7 h-7 rounded-lg bg-[#d97757] flex items-center justify-center shrink-0">
            <ArrowUp className="w-3.5 h-3.5 text-white stroke-[2.5]" />
          </span>
        </div>
      </div>
    </div>
  );
}
