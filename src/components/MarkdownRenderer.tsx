"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Play,
} from "lucide-react";

export interface CanvasArtifactPayload {
  id?: string;
  title: string;
  language: string;
  code: string;
}

interface MarkdownRendererProps {
  content: string;
  serifProse?: boolean;
  onOpenArtifact?: (artifact: CanvasArtifactPayload) => void;
}

const EXTENSIONS: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  react: "jsx",
  python: "py",
  py: "py",
  html: "html",
  css: "css",
  sql: "sql",
  json: "json",
  rust: "rs",
  go: "go",
  bash: "sh",
  sh: "sh",
  svg: "svg",
  markdown: "md",
  yaml: "yml",
  yml: "yml",
};

export function getFileExtension(lang: string): string {
  return EXTENSIONS[lang.toLowerCase()] || "txt";
}

/** Only real UI code (HTML pages, SVG, React components) gets a live preview. */
export function isPreviewableArtifact(lang: string, code: string): boolean {
  const l = lang.toLowerCase();
  if (["html", "svg", "jsx", "tsx", "react"].includes(l)) return true;
  if (/<!doctype html|<html[\s>]/i.test(code)) return true;
  if (
    ["", "js", "javascript", "ts", "typescript"].includes(l) &&
    /export\s+default\s+function\s+[A-Z]/.test(code) &&
    /return\s*\(/.test(code) &&
    /<[A-Za-z]/.test(code)
  ) {
    return true;
  }
  return false;
}

export function inferArtifactTitle(lang: string, code: string): string {
  const htmlTitle = code.match(/<title>([^<]{2,60})<\/title>/i);
  if (htmlTitle?.[1]) return htmlTitle[1].trim();

  const h1Match = code.match(/<h1[^>]*>([^<]{2,55})<\/h1>/i);
  if (h1Match?.[1]) return h1Match[1].trim();

  const fnMatch = code.match(
    /(?:export\s+default\s+function|function|class)\s+([A-Z][A-Za-z0-9_]*)/
  );
  if (fnMatch?.[1]) return `${fnMatch[1]}`;

  const pyMatch = code.match(/(?:class|def)\s+([A-Za-z0-9_]+)/);
  if (pyMatch?.[1]) return `${pyMatch[1]}.${getFileExtension(lang)}`;

  return `${(lang || "code").toUpperCase()} code`;
}

/** Collects code blocks worth showing in the Artifacts list (long code or previewable UI). */
export function extractArtifactsFromMarkdown(
  markdown: string,
  msgId?: string
): CanvasArtifactPayload[] {
  const regex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  const list: CanvasArtifactPayload[] = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(markdown)) !== null) {
    const language = (match[1] || "html").trim();
    const code = (match[2] || "").trim();
    if (code.split("\n").length >= 12 || isPreviewableArtifact(language, code)) {
      idx++;
      list.push({
        id: `${msgId || "art"}-${idx}`,
        title: inferArtifactTitle(language, code),
        language,
        code,
      });
    }
  }
  return list;
}

/* ------------------------------------------------------------------ *
 * Lightweight syntax highlighter — real colors like other AI chats.
 * Tokenizes per language family; no extra dependencies.
 * ------------------------------------------------------------------ */

type HlTok = { t: string; c: string };

const HL_COLORS: Record<string, string> = {
  com: "#7d8590",
  str: "#a5e075",
  num: "#f78c6c",
  key: "#ff7edb",
  fn: "#82aaff",
  bi: "#7dcfff",
  tag: "#ff8a80",
  attr: "#ffcb6b",
  dec: "#e2b93d",
};

const HL_FONT_WEIGHT: Record<string, number> = {
  key: 600,
  dec: 600,
};

const HL_KEYWORDS: Record<string, string> = {
  python:
    "def return if elif else for while import from as class try except finally raise with lambda None True False and or not in is pass break continue global yield async await assert del nonlocal print len range str int float bool list dict set tuple open super self cls",
  js: "const let var function return if else for while await async import from export default new class extends try catch finally throw typeof instanceof null undefined true false this of in break continue switch case do void delete yield static get set console window document",
  bash: "if then else elif fi for while do done in case esac function echo cd ls mkdir rm cp mv export return exit local readonly declare trap source eval exec shift set unset alias unalias true false test",
  sql: "SELECT FROM WHERE AND OR NOT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET AS DISTINCT COUNT SUM AVG MIN MAX UNION ALL CASE WHEN THEN ELSE END LIKE IN IS NULL TRUE FALSE PRIMARY KEY REFERENCES",
  css: "",
  html: "",
  json: "true false null",
  yaml: "true false null yes no on off",
};

function hlFamily(lang: string): string {
  const l = lang.toLowerCase();
  if (["python", "py"].includes(l)) return "python";
  if (["javascript", "js", "jsx", "typescript", "ts", "tsx", "react", "json"].includes(l)) return l === "json" ? "json" : "js";
  if (["bash", "sh", "shell", "zsh"].includes(l)) return "bash";
  if (["sql"].includes(l)) return "sql";
  if (["html", "xml", "svg", "vue"].includes(l)) return "html";
  if (["css", "scss", "less"].includes(l)) return "css";
  if (["yaml", "yml"].includes(l)) return "yaml";
  return "generic";
}

function hlBuiltins(fam: string): Set<string> {
  if (fam === "python")
    return new Set("print len range str int float bool list dict set tuple open super enumerate zip map filter sorted reversed sum min max abs round isinstance hasattr getattr setattr callable input format repr type id dir vars help".split(" "));
  if (fam === "js")
    return new Set("console window document require module exports process fetch setTimeout setInterval clearTimeout Promise Array Object String Number Boolean Math JSON RegExp Error Map Set WeakMap Symbol parseInt parseFloat isNaN encodeURIComponent decodeURIComponent".split(" "));
  return new Set();
}

function tokenizeHl(code: string, lang: string): HlTok[] {
  const fam = hlFamily(lang);
  const toks: HlTok[] = [];
  const push = (t: string, c: string) => {
    if (c) toks.push({ t, c });
  };

  if (fam === "html") {
    const re = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:.-]*|\/?>)|([\w:.-]+)(?=\s*=)|("[^"\n]*"|'[^'\n]*')/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (m.index > last) push("plain", code.slice(last, m.index));
      if (m[1]) push("com", m[1]);
      else if (m[2]) push("tag", m[2]);
      else if (m[3]) push("attr", m[3]);
      else if (m[4]) push("str", m[4]);
      last = m.index + m[0].length;
    }
    if (last < code.length) push("plain", code.slice(last));
    return toks;
  }

  if (fam === "css") {
    const re = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|([#.]?[A-Za-z_-][\w-]*)(?=\s*[{,])|([A-Za-z-]+)(?=\s*:)|(\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b)|(#[0-9a-fA-F]{3,8}\b)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (m.index > last) push("plain", code.slice(last, m.index));
      if (m[1]) push("com", m[1]);
      else if (m[2]) push("str", m[2]);
      else if (m[3]) push("tag", m[3]);
      else if (m[4]) push("attr", m[4]);
      else if (m[5] || m[6]) push("num", m[5] || m[6]);
      last = m.index + m[0].length;
    }
    if (last < code.length) push("plain", code.slice(last));
    return toks;
  }

  const kw = new Set((HL_KEYWORDS[fam] || HL_KEYWORDS.js).split(" ").filter(Boolean));
  const bi = hlBuiltins(fam);
  const commentRe =
    fam === "python" || fam === "bash" || fam === "yaml"
      ? "#[^\\n]*"
      : fam === "sql"
        ? "--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/"
        : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const strRe =
    fam === "python"
      ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\''
      : fam === "bash"
        ? '"(?:\\\\.|[^"\\\\])*"|\'(?:[^\'])*\'|\\$\\{[^}]+\\}|\\$[A-Za-z_][\\w]*'
        : '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`';
  const re = new RegExp(
    `(${commentRe})|(${strRe})|(\\b\\d+(?:\\.\\d+)?\\b)|(@[A-Za-z_][\\w.]*)|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$][\\w$]*)`,
    "g"
  );
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) push("plain", code.slice(last, m.index));
    if (m[1]) push("com", m[1]);
    else if (m[2]) push(fam === "bash" && m[2].startsWith("$") ? "attr" : "str", m[2]);
    else if (m[3]) push("num", m[3]);
    else if (m[4]) push("dec", m[4]);
    else if (m[5]) push(bi.has(m[5]) ? "bi" : "fn", m[5]);
    else if (m[6]) {
      if (kw.has(m[6])) push("key", m[6]);
      else if (bi.has(m[6])) push("bi", m[6]);
      else push("plain", m[6]);
    }
    last = m.index + m[0].length;
  }
  if (last < code.length) push("plain", code.slice(last));
  return toks;
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const nodes = useMemo(() => {
    const toks = tokenizeHl(code, language);
    return toks.map((t, i) =>
      t.t === "plain" ? (
        <span key={i}>{t.c}</span>
      ) : (
        <span
          key={i}
          style={{
            color: HL_COLORS[t.t],
            ...(t.t === "com" ? { fontStyle: "italic" as const } : {}),
            ...(HL_FONT_WEIGHT[t.t] ? { fontWeight: HL_FONT_WEIGHT[t.t] } : {}),
          }}
        >
          {t.c}
        </span>
      )
    );
  }, [code, language]);
  return <>{nodes}</>;
}

/**
 * Blocks a user has expanded stay expanded — even across streaming remounts.
 * The key is STABLE (language + hash of the first 300 chars only) so it does
 * not change as streaming appends more code. Once expanded, a block never
 * auto-collapses again; only an explicit Fold click closes it.
 */
const pinnedOpenBlocks = new Set<string>();

function stableBlockKey(language: string, code: string): string {
  let h = 0;
  const head = code.slice(0, 300);
  for (let i = 0; i < head.length; i++) h = (h * 31 + head.charCodeAt(i)) >>> 0;
  return `${language.toLowerCase()}:${h.toString(36)}`;
}

// Kept for backwards compatibility with any previously pinned keys.
function blockKey(language: string, code: string): string {
  return stableBlockKey(language, code);
}

function CodeBlockCard({
  language,
  code,
  onOpenArtifact,
}: {
  language: string;
  code: string;
  onOpenArtifact?: (artifact: CanvasArtifactPayload) => void;
}) {
  const [copied, setCopied] = useState(false);
  const lineCount = code.split("\n").length;
  const stableKey = stableBlockKey(language, code);
  // Once the user expands a block it stays open forever (streaming growth
  // must never re-collapse it). Manual Fold still works via the button.
  const [userOpened, setUserOpened] = useState(() => pinnedOpenBlocks.has(stableKey));
  // Expanded once => stays expanded no matter how much streaming appends.
  // Only an explicit Fold click can close it again.
  const collapsed = lineCount > 28 && !userOpened;

  useEffect(() => {
    if (pinnedOpenBlocks.has(stableBlockKey(language, code))) {
      setUserOpened(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language]);
  const canPreview = isPreviewableArtifact(language, code);
  const title = inferArtifactTitle(language, code);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const ext = getFileExtension(language);
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 space-y-2">
      {/* Live preview card: only for UI code (HTML, React, SVG) */}
      {canPreview && onOpenArtifact && (
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            onOpenArtifact({ title, language: language || "html", code })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter")
              onOpenArtifact({ title, language: language || "html", code });
          }}
          className="group flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--border-subtle)] hover:border-[var(--accent)] bg-[var(--bg-elevated)] transition cursor-pointer shadow-sm"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/30 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition">
                {title}
              </div>
              <div className="text-[11.5px] text-[var(--text-secondary)] flex items-center gap-2">
                <span>Live preview</span>
                <span>•</span>
                <span className="uppercase font-mono text-[10.5px]">
                  {language || "html"}
                </span>
                <span>•</span>
                <span>{lineCount} lines</span>
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium shrink-0 shadow-sm">
            <Play className="w-3 h-3 fill-current" />
            Open preview
          </span>
        </div>
      )}

      {/* Code frame: copy, download, fold. No run or execute actions. */}
      <div className="rounded-xl border border-[#2e2d29] bg-[#141412] overflow-hidden shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-[#1d1c19] border-b border-[#2e2d29] text-xs">
          <div className="flex items-center gap-2 text-[#b8b5ab] min-w-0">
            <Code2 className="w-3.5 h-3.5 text-[#d97757] shrink-0" />
            <span className="font-mono font-medium lowercase truncate">
              {language || "plaintext"}
            </span>
            <span className="text-[#78756d] font-mono whitespace-nowrap">
              • {lineCount} lines
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {lineCount > 28 && (
              <button
                type="button"
                onClick={() => {
                  if (collapsed) {
                    pinnedOpenBlocks.add(stableBlockKey(language, code));
                    setUserOpened(true);
                  } else {
                    pinnedOpenBlocks.delete(stableBlockKey(language, code));
                    setUserOpened(false);
                  }
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#2c2b27] text-[#a8a59b] transition cursor-pointer"
              >
                {collapsed ? (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    <span>Expand</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    <span>Fold</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              title="Download file"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[#2c2b27] text-[#b8b5ab] transition cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-[#2c2b27] text-[#e5e3dc] transition cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {!collapsed ? (
          <pre className="p-4 overflow-x-auto text-[13px] leading-[1.6] font-mono text-[#eae8e1]">
            <code>
              <HighlightedCode code={code} language={language} />
            </code>
          </pre>
        ) : (
          <div
            onClick={() => {
              pinnedOpenBlocks.add(stableBlockKey(language, code));
              setUserOpened(true);
            }}
            className="px-4 py-2.5 text-xs font-mono text-[#8f8c82] cursor-pointer hover:text-[#d97757]"
          >
            ⋯ {lineCount} lines folded — click to expand
          </div>
        )}
      </div>
    </div>
  );
}

export function MarkdownRenderer({
  content,
  serifProse = false,
  onOpenArtifact,
}: MarkdownRendererProps) {
  return (
    <div
      className={`max-w-none text-[15px] leading-[1.72] text-[var(--text-primary)] break-words ${
        serifProse ? "font-claude-serif text-[15.5px]" : ""
      }`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="font-claude-serif text-[22px] font-semibold text-[var(--text-primary)] mt-5 mb-2.5 tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-claude-serif text-[18.5px] font-semibold text-[var(--text-primary)] mt-5 mb-2 tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[16px] font-semibold text-[var(--text-primary)] mt-4 mb-1.5">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="mb-3.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3.5 space-y-1.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3.5 space-y-1.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-[1.68]">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--accent)] pl-4 py-1 my-3.5 text-[var(--text-secondary)] italic">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline underline-offset-4 inline-flex items-center gap-0.5 break-all"
            >
              {children}
              <ExternalLink className="w-3 h-3 inline ml-0.5 shrink-0" />
            </a>
          ),
          img: ({ src, alt }) => {
            const imgSrc = typeof src === "string" ? src : "";
            if (!imgSrc) return null;
            return (
              <span className="block my-4 rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-lg max-w-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={alt || "Generated image"}
                  className="w-full h-auto object-cover min-h-[220px]"
                  loading="lazy"
                />
                <span className="flex items-center justify-between px-3.5 py-2 text-xs text-[var(--text-secondary)] border-t border-[var(--border-subtle)]">
                  <span className="truncate">{alt || "Generated image"}</span>
                  <a
                    href={imgSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] font-medium ml-3 shrink-0 hover:underline"
                  >
                    Open full size ↗
                  </a>
                </span>
              </span>
            );
          },
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-left border-collapse text-xs sm:text-sm font-sans">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[var(--bg-elevated)] text-[var(--text-primary)] border-b border-[var(--border-subtle)]">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 border-t border-[var(--border-subtle)] text-[var(--text-secondary)]">
              {children}
            </td>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-([a-zA-Z0-9_+-]+)/.exec(className || "");
            const rawText = String(children).replace(/\n$/, "");
            const isBlock = Boolean(match) || rawText.includes("\n");

            if (!isBlock) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] text-[var(--accent)] font-mono text-[13px]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlockCard
                language={match?.[1] || ""}
                code={rawText}
                onOpenArtifact={onOpenArtifact}
              />
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
