"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Layers,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import {
  getFileExtension,
  isPreviewableArtifact,
  type CanvasArtifactPayload,
} from "./MarkdownRenderer";

interface ArtifactCanvasDrawerProps {
  artifact: CanvasArtifactPayload | null;
  allArtifacts?: CanvasArtifactPayload[];
  onSelectArtifact?: (art: CanvasArtifactPayload) => void;
  onClose: () => void;
  onChangeCode: (nextCode: string) => void;
  onIteratePrompt?: (instruction: string) => void;
  isGenerating?: boolean;
}

/* ------------------------------------------------------------------ *
 * Preview runtime injected into every artifact iframe.
 *  - Sandboxed iframes have no localStorage, so an in-memory fallback
 *    keeps apps that save data working instead of crashing.
 *  - Runtime errors are shown in the preview and sent to the chat so
 *    the user can ask the AI to fix them in one click.
 * ------------------------------------------------------------------ */
const RUNTIME_SHIM = `<script>
(function () {
  function mem() {
    var s = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(s, String(k)) ? s[String(k)] : null; },
      setItem: function (k, v) { s[String(k)] = String(v); },
      removeItem: function (k) { delete s[String(k)]; },
      clear: function () { s = {}; },
      key: function (i) { return Object.keys(s)[i] || null; },
      get length() { return Object.keys(s).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (n) {
    var ok = true;
    try { var t = window[n]; t.setItem('__rg', '1'); t.removeItem('__rg'); } catch (e) { ok = false; }
    if (!ok) {
      var m = mem();
      try { Object.defineProperty(window, n, { configurable: true, get: function () { return m; } }); } catch (e) {}
    }
  });
  function show(msg) {
    var d = document.getElementById('__rg_err');
    if (!d) {
      d = document.createElement('pre');
      d.id = '__rg_err';
      d.setAttribute('style', 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;margin:0;padding:10px 12px;border-radius:10px;background:#2c1215;color:#fecdd3;border:1px solid #d97757;font:12px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;max-height:45%;overflow:auto');
      (document.body || document.documentElement).appendChild(d);
    }
    d.textContent = 'Runtime error: ' + msg;
    try { window.parent.postMessage({ __rgError: String(msg) }, '*'); } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    show((e.error && e.error.stack) || e.message || 'Unknown error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    show((r && r.stack) || (r && r.message) || String(r));
  });
})();
</script>`;

const TAILWIND_TAG = `<script src="https://cdn.tailwindcss.com"></script>`;

/* Lucide icons rendered as inline SVG from the official lucide UMD build */
const ICON_RUNTIME = `<script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>
<script>
window.__rgIcon = function (name) {
  return function RgIcon(props) {
    props = props || {};
    var lib = window.lucide && window.lucide.icons;
    var node = lib && lib[name];
    var size = props.size || 24;
    var sw = props.strokeWidth || 2;
    var style = Object.assign(
      { display: 'inline-flex', flexShrink: 0, lineHeight: 0 },
      props.className ? {} : { width: size + 'px', height: size + 'px' },
      props.style || {}
    );
    if (!node) return React.createElement('span', { className: props.className, style: style }, '•');
    var esc = function (v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); };
    var attrStr = function (o) { return Object.keys(o).map(function (k) { return k + '="' + esc(o[k]) + '"'; }).join(' '); };
    var kids = (node[2] || []).map(function (k) { return '<' + k[0] + ' ' + attrStr(k[1] || {}) + '/>'; }).join('');
    var svgAttrs = Object.assign({}, node[1] || {}, { width: '100%', height: '100%', 'stroke-width': sw });
    var svg = '<svg ' + attrStr(svgAttrs) + '>' + kids + '</svg>';
    return React.createElement('span', {
      className: props.className,
      style: style,
      onClick: props.onClick,
      title: props.title,
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: svg }
    });
  };
};
</script>`;

const HTML_HINT = /\b(bg-|text-(xs|sm|base|lg|xl|2xl|3xl)|rounded(-\w+)?|shadow(-\w+)?|items-center|justify-(center|between|start|end)|flex-col|grid-cols-\d|gap-\d+|space-y-\d+|px-\d+|py-\d+|mx-auto|w-full|h-screen|min-h-screen)\b/;

function headTags(code: string): string {
  const needsTailwind = /class(Name)?=["'][^"']*/.test(code) && HTML_HINT.test(code) && !/tailwindcss/.test(code);
  return RUNTIME_SHIM + (needsTailwind ? TAILWIND_TAG : "") + '<base target="_blank">';
}

/** Inserts tags into an existing <head>, or builds a full document around a fragment. */
function injectIntoHead(html: string, tags: string): string {
  if (/<head[\s>]/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tags);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + `<head>${tags}</head>`);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${tags}</head><body>${html}</body></html>`;
}

function buildReactDoc(raw: string): string {
  let src = raw;
  const icons: { imported: string; local: string }[] = [];

  // Named lucide-react imports become real icon components
  src = src.replace(
    /^\s*import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]lucide-react['"];?\s*$/gm,
    (_m, list: string) => {
      list
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((part) => {
          const m = part.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
          if (m) icons.push({ imported: m[1], local: m[2] || m[1] });
        });
      return "";
    }
  );
  // Remaining imports (react, other packages) are replaced by the globals below
  src = src.replace(/^\s*import\s+[^;'"]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, "");
  src = src.replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, "");

  let root = "";
  const fnDefault = src.match(/export\s+default\s+function\s+([A-Za-z_$][\w$]*)/);
  const idDefault = src.match(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m);
  if (fnDefault) {
    root = fnDefault[1];
    src = src.replace(/export\s+default\s+function\s+/, "function ");
  } else if (idDefault) {
    root = idDefault[1];
    src = src.replace(idDefault[0], "");
  } else if (/export\s+default\s+/.test(src)) {
    src = src.replace(/export\s+default\s+/, "const __RevengeRoot = ");
    root = "__RevengeRoot";
  }
  src = src.replace(/^\s*export\s+(async\s+function|const|function|class|let|var)\s+/gm, "$1 ");
  src = src.replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, "");
  if (!root) {
    const f = src.match(/function\s+([A-Z][\w$]*)\s*\(/);
    root = f ? f[1] : "App";
  }

  const iconDecl = icons
    .map((i) => `const ${i.local} = window.__rgIcon(${JSON.stringify(i.imported)});`)
    .join("\n");

  const mount = `
const __RevengeMount = (typeof ${root} !== "undefined") ? ${root} : null;
if (__RevengeMount) {
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__RevengeMount));
} else {
  throw new Error("No default-exported React component was found in this artifact.");
}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${RUNTIME_SHIM}
${TAILWIND_TAG}
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
${ICON_RUNTIME}
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<style>html,body{margin:0;min-height:100%}body{background:#262624;color:#faf9f5;font-family:Inter,system-ui,-apple-system,sans-serif}#root{min-height:100vh}</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="typescript,react" data-filename="artifact.tsx">
const { useState, useEffect, useMemo, useCallback, useRef, useReducer, useContext, createContext, Fragment, memo, forwardRef, useId, useLayoutEffect } = React;
${iconDecl}
${src}
${mount}
</script>
</body>
</html>`;
}

function buildSvgDoc(code: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${RUNTIME_SHIM}<style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#191918;min-height:100vh}svg{max-width:92vw;max-height:92vh;height:auto}</style></head><body>${code}</body></html>`;
}

function buildSrcDoc(language: string, code: string): string {
  const lang = language.toLowerCase();
  const isFullHtml = /<!doctype html|<html[\s>]/i.test(code);
  if (isFullHtml) return injectIntoHead(code, headTags(code));

  const reactLike =
    ["jsx", "tsx", "react"].includes(lang) ||
    (/export\s+default\s+(function|class|[A-Za-z_])/.test(code) && /<[A-Za-z]/.test(code)) ||
    /\bfrom\s+['"]react['"]/.test(code) ||
    /\buse(State|Effect|Reducer|Memo|Ref|Callback)\s*\(/.test(code);
  if (reactLike) return buildReactDoc(code);

  if (lang === "svg" || /^\s*<svg[\s>]/i.test(code)) return buildSvgDoc(code);

  return injectIntoHead(code, headTags(code));
}

export function ArtifactCanvasDrawer({
  artifact,
  allArtifacts = [],
  onSelectArtifact,
  onClose,
  onChangeCode,
  onIteratePrompt,
  isGenerating = false,
}: ArtifactCanvasDrawerProps) {
  const canPreview = artifact
    ? isPreviewableArtifact(artifact.language, artifact.code)
    : false;

  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [expanded, setExpanded] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [copied, setCopied] = useState(false);
  const [iterateInput, setIterateInput] = useState("");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const currentIndex = (() => {
    if (!artifact) return 0;
    const byId = allArtifacts.findIndex((a) => a.id && a.id === artifact.id);
    if (byId !== -1) return byId;
    const byCode = allArtifacts.findIndex((a) => a.code === artifact.code);
    return byCode === -1 ? 0 : byCode;
  })();
  const total = allArtifacts.length;
  const cycleArtifact = (dir: 1 | -1) => {
    if (!onSelectArtifact || total < 2) return;
    const next = (currentIndex + dir + total) % total;
    onSelectArtifact(allArtifacts[next]);
    setPickerOpen(false);
  };

  useEffect(() => {
    if (!artifact) return;
    const timer = window.setTimeout(() => setTab(canPreview ? "preview" : "code"), 0);
    return () => window.clearTimeout(timer);
    // Only re-pick the tab when a different artifact is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact?.id, artifact?.language]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __rgError?: unknown } | null;
      if (d && typeof d === "object" && typeof d.__rgError === "string") {
        setRuntimeError(d.__rgError.slice(0, 1500));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const srcDoc = useMemo(() => {
    if (!artifact || !canPreview) return "";
    return buildSrcDoc(artifact.language, artifact.code);
  }, [artifact, canPreview]);

  useEffect(() => {
    const timer = window.setTimeout(() => setRuntimeError(null), 0);
    return () => window.clearTimeout(timer);
  }, [srcDoc, refreshNonce]);

  useEffect(() => {
    if (!artifact) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); cycleArtifact(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); cycleArtifact(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!artifact) return null;

  const lineCount = artifact.code.split("\n").length;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleDownload = () => {
    const ext = getFileExtension(artifact.language);
    const blob = new Blob([artifact.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInTab = () => {
    if (!srcDoc) return;
    const url = URL.createObjectURL(new Blob([srcDoc], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const handleIterateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!iterateInput.trim() || !onIteratePrompt || isGenerating) return;
    onIteratePrompt(
      `Update and upgrade the "${artifact.title}" (${artifact.language}) artifact with these changes. Output the COMPLETE updated code, keeping every existing feature working:\n\n${iterateInput.trim()}`
    );
    setIterateInput("");
  };

  const handleFixWithAI = () => {
    if (!runtimeError || !onIteratePrompt || isGenerating) return;
    onIteratePrompt(
      `The live preview of "${artifact.title}" (${artifact.language}) threw this runtime error:\n\n${runtimeError}\n\nFix the bug so the app works fully. Output the COMPLETE corrected code.`
    );
    setRuntimeError(null);
  };

  const iconBtn =
    "p-1.5 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer";

  return (
    <aside
      className={`${
        expanded
          ? "fixed inset-2 sm:inset-4 z-50 rounded-2xl border border-[var(--border-strong)]"
          : "fixed inset-0 z-[55] lg:z-auto lg:static lg:w-[49%] xl:w-[51%] border-l border-[var(--border-subtle)]"
      } bg-[var(--bg-sidebar)] flex flex-col h-full shadow-2xl transition-all`}
    >
      {/* Header */}
      <div className="relative border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/30 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5 text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate max-w-[34vw] sm:max-w-[240px]">
                  {artifact.title}
                </span>
                {total > 1 && (
                  <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                    {currentIndex + 1}/{total}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5">
                <span className="uppercase font-mono text-[10px]">{artifact.language || "html"}</span>
                <span>•</span>
                <span>{lineCount} lines</span>
                {canPreview && (
                  <>
                    <span>•</span>
                    <span className="text-emerald-400/90">live</span>
                  </>
                )}
              </div>
            </div>

            {total > 1 && onSelectArtifact && (
              <div className="hidden sm:flex items-center gap-0.5 ml-1 shrink-0">
                <button
                  type="button"
                  onClick={() => cycleArtifact(-1)}
                  title="Previous artifact (Alt+←)"
                  aria-label="Previous artifact"
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => cycleArtifact(1)}
                  title="Next artifact (Alt+→)"
                  aria-label="Next artifact"
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              title="Fullscreen"
              className={`hidden lg:block ${iconBtn}`}
            >
              {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button type="button" onClick={onClose} title="Close" className={iconBtn}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Controls row: Preview/Code + artifact switcher + actions */}
        <div className="flex items-center gap-1.5 px-3 sm:px-4 pb-2.5 pt-2 overflow-x-auto">
          <div className="flex rounded-lg bg-[var(--bg-main)] p-0.5 border border-[var(--border-subtle)] shrink-0">
            {canPreview && (
              <button
                type="button"
                onClick={() => setTab("preview")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  tab === "preview"
                    ? "bg-[var(--bg-elevated-2)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("code")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                tab === "code" || !canPreview
                  ? "bg-[var(--bg-elevated-2)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Code
            </button>
          </div>

          {total > 1 && onSelectArtifact && (
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              aria-expanded={pickerOpen}
              className={`h-7 pl-2 pr-1.5 rounded-lg border text-[11.5px] font-medium inline-flex items-center gap-1 shrink-0 transition cursor-pointer ${
                pickerOpen
                  ? "bg-[var(--accent-soft)] border-[var(--accent)]/50 text-[var(--accent)]"
                  : "bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Layers className="w-3 h-3" />
              v{currentIndex + 1}
              <ChevronDown className={`w-3 h-3 transition ${pickerOpen ? "rotate-180" : ""}`} />
            </button>
          )}

          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            {tab === "preview" && canPreview && (
              <>
                <button
                  type="button"
                  onClick={() => setViewport((v) => (v === "desktop" ? "mobile" : "desktop"))}
                  title="Desktop / mobile width"
                  className={`hidden sm:block ${iconBtn}`}
                >
                  {viewport === "desktop" ? (
                    <Monitor className="w-3.5 h-3.5" />
                  ) : (
                    <Smartphone className="w-3.5 h-3.5 text-[var(--accent)]" />
                  )}
                </button>
                <button type="button" onClick={() => setRefreshNonce((n) => n + 1)} title="Reload preview" className={iconBtn}>
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={handleOpenInTab} title="Open full-page in a new tab" className={`hidden sm:block ${iconBtn}`}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button type="button" onClick={handleCopy} title="Copy code" className={iconBtn}>
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button type="button" onClick={handleDownload} title="Download file" className={`hidden sm:block ${iconBtn}`}>
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Artifact switcher list */}
        {pickerOpen && total > 1 && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setPickerOpen(false)} />
            <div className="absolute left-2 right-2 sm:left-auto sm:right-3 top-full mt-1 z-[61] sm:w-[22rem] max-h-[52vh] overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl p-1.5">
              <div className="px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
                <span>All artifacts in this chat</span>
                <span>{total}</span>
              </div>
              {allArtifacts.map((a, i) => {
                const active = i === currentIndex;
                const previewable = isPreviewableArtifact(a.language, a.code);
                return (
                  <button
                    key={a.id || i}
                    type="button"
                    onClick={() => {
                      onSelectArtifact?.(a);
                      setPickerOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition cursor-pointer ${
                      active
                        ? "bg-[var(--accent-soft)] border border-[var(--accent)]/40"
                        : "hover:bg-[var(--bg-elevated-2)] border border-transparent"
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-md flex items-center justify-center text-[10.5px] font-bold shrink-0 ${
                        active
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                        {a.title || `Artifact ${i + 1}`}
                      </span>
                      <span className="block text-[10.5px] font-mono text-[var(--text-muted)] truncate">
                        {(a.language || "code").toUpperCase()} · {a.code.split("\n").length} lines
                        {previewable ? " · live preview" : ""}
                      </span>
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />}
                  </button>
                );
              })}
              <div className="px-2.5 py-1.5 mt-1 border-t border-[var(--border-subtle)] text-[10.5px] text-[var(--text-muted)]">
                Switch with Alt + ← / →
              </div>
            </div>
          </>
        )}
      </div>

      {/* Runtime error banner (from inside the preview) */}
      {runtimeError && tab === "preview" && (
        <div className="mx-2 mt-2 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-3 py-2 flex items-start justify-between gap-2">
          <pre className="flex-1 min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-primary)] max-h-20 overflow-auto">
            {runtimeError}
          </pre>
          <div className="flex flex-col gap-1 shrink-0">
            {onIteratePrompt && (
              <button
                type="button"
                onClick={handleFixWithAI}
                disabled={isGenerating}
                className="px-2.5 py-1 rounded-md bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white text-[11px] font-medium cursor-pointer"
              >
                Fix with AI
              </button>
            )}
            <button
              type="button"
              onClick={() => setRuntimeError(null)}
              className="px-2.5 py-1 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Stage */}
      <div className="flex-1 min-h-0 overflow-hidden bg-[#121210] flex items-center justify-center p-2">
        {tab === "preview" && canPreview ? (
          <div
            className={`h-full transition-all rounded-xl overflow-hidden border border-[#2d2c28] bg-[#141413] shadow-inner ${
              viewport === "mobile" ? "w-[390px] max-w-full" : "w-full"
            }`}
          >
            <iframe
              key={`${artifact.id || "art"}-${refreshNonce}-${srcDoc.length}`}
              title="Live artifact preview"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
              className="w-full h-full border-0 bg-[#141413]"
            />
          </div>
        ) : (
          <textarea
            value={artifact.code}
            onChange={(e) => onChangeCode(e.target.value)}
            spellCheck={false}
            className="w-full h-full p-4 rounded-xl bg-[#141412] border border-[#2d2c28] text-[#eceae3] font-mono text-[12.5px] leading-[1.6] focus:outline-none focus:border-[var(--accent)] resize-none"
          />
        )}
      </div>

      {/* Iterate bar */}
      {onIteratePrompt && (
        <form
          onSubmit={handleIterateSubmit}
          className="px-3 py-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center gap-2"
        >
          <input
            type="text"
            value={iterateInput}
            onChange={(e) => setIterateInput(e.target.value)}
            placeholder={`Ask for changes to "${artifact.title}"…`}
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={!iterateInput.trim() || isGenerating}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white text-xs font-medium transition cursor-pointer shrink-0"
          >
            <span>Update</span>
            <Send className="w-3 h-3" />
          </button>
        </form>
      )}
    </aside>
  );
}
