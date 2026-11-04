"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Flag,
  LoaderCircle,
  Search,
  Sparkles,
} from "lucide-react";
import type { WebSourceItem } from "@/db/schema";

type ResearchWorkspaceProps = {
  messageId: string;
  query: string;
  answer: string;
  sources: WebSourceItem[];
  isSearching?: boolean;
  isStreaming?: boolean;
  attempted?: boolean;
};

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    const octets = host.split(".").map(Number);
    const ipv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
    const privateIpv4 = ipv4 && (
      octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    );
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "[::1]" || privateIpv4) return null;
    return url.href;
  } catch {
    return null;
  }
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function fileSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "research-report";
}

export function ResearchWorkspace({
  messageId,
  query,
  answer,
  sources,
  isSearching = false,
  isStreaming = false,
  attempted = false,
}: ResearchWorkspaceProps) {
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [exported, setExported] = useState(false);

  const validSources = useMemo(
    () =>
      sources
        .map((source, index) => ({ ...source, safeUrl: safeHttpUrl(source.url), index }))
        .filter((source) => source.safeUrl),
    [sources]
  );
  const activeStep = isSearching ? 0 : isStreaming ? (sources.length > 0 ? 2 : 1) : sources.length ? 3 : 1;
  const steps = ["Search sources", "Review evidence", "Draft synthesis"];

  function exportReport() {
    if (!answer.trim() && sources.length === 0) return;
    const references = validSources
      .map((source, i) => `${i + 1}. [${escapeMarkdownLabel(source.title)}](<${source.safeUrl!.replaceAll(")", "%29")}>)\n   ${source.snippet || "No preview excerpt was available."}`)
      .join("\n\n");
    const conflicts = validSources
      .filter((source) => flagged[String(source.index)])
      .map((source) => `- ${source.title} — ${source.safeUrl} — marked by you for comparison; this is not an automated contradiction verdict.`)
      .join("\n");
    const report = [
      `# Research report: ${query || "Web research"}`,
      "",
      `Exported ${new Date().toLocaleString()}`,
      "",
      "## AI synthesis",
      "",
      answer.trim() || "The response is still being drafted.",
      "",
      "## Sources and evidence previews",
      "",
      references || "No source list was returned.",
      ...(conflicts ? ["", "## Sources you flagged for comparison", "", conflicts] : []),
      "",
      "---",
      `Research workspace message: ${messageId}`,
      "Source excerpts are retrieval previews; open the linked page to verify context and original wording.",
    ].join("\n");
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${fileSlug(query)}-research.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setExported(true);
    window.setTimeout(() => setExported(false), 1600);
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 overflow-hidden" aria-label="Web research details">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2 text-left cursor-pointer"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <BookOpen className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-[var(--text-primary)]">Web research</span>
            <span className="block truncate text-[10px] text-[var(--text-muted)]">
              {isSearching ? "Searching…" : sources.length ? `${validSources.length} sources` : attempted ? "No sources found" : "Details"}
            </span>
          </span>
          <ChevronDown className={`ml-1 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${expanded ? "" : "-rotate-90"}`} />
        </button>
        <button
          type="button"
          onClick={exportReport}
          disabled={!answer.trim() && sources.length === 0}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          title="Download the answer, source links, evidence previews, and your comparison flags as Markdown"
        >
          {exported ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Download className="h-3.5 w-3.5" />}
          {exported ? "Exported" : "Export report"}
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <Sparkles className="h-3.5 w-3.5" /> Research plan & progress
            </div>
            <ol className="grid gap-2 sm:grid-cols-3">
              {steps.map((step, index) => {
                const done = index < activeStep;
                const active = index === activeStep && (isSearching || isStreaming);
                return (
                  <li key={step} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${done ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : active ? "border-[var(--accent)]/30 bg-[var(--accent)]/5 text-[var(--text-primary)]" : "border-[var(--border-subtle)] text-[var(--text-muted)]"}`}>
                    {done ? <Check className="h-3.5 w-3.5 shrink-0" /> : active ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current text-center text-[9px] leading-[13px]">{index + 1}</span>}
                    <span>{step}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {isSearching
                ? `Searching for: ${query || "your research question"}`
                : isStreaming && sources.length > 0
                  ? "Sources are gathered. The assistant is drafting the synthesis."
                  : isStreaming && attempted
                    ? "No source previews were returned. The assistant is drafting without retrieved evidence."
                    : sources.length
                      ? "Retrieval is complete. Review the evidence previews below; the assistant's synthesis appears as a separate answer."
                      : attempted
                        ? "Search finished without returning source previews. The answer below may not be web-grounded."
                        : "Research steps are shown as they happen; no source review or conflict verdict is inferred automatically."}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]/50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
              <FileText className="h-3.5 w-3.5 text-[var(--accent)]" />
              AI synthesis
              <span className="font-normal text-[var(--text-muted)]">— assistant response below</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">The answer is model-generated synthesis. Source previews are evidence to inspect, not proof that every claim is correct.</p>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                <Search className="h-3.5 w-3.5 text-emerald-400" /> Source evidence
                {sources.length > 0 && <span className="font-normal text-[var(--text-muted)]">{validSources.length} links</span>}
              </div>
              {Object.values(flagged).some(Boolean) && <span className="text-[10px] text-amber-300">{Object.values(flagged).filter(Boolean).length} marked for comparison</span>}
            </div>
            {validSources.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {validSources.map((source, i) => {
                  const key = String(source.index);
                  const isFlagged = Boolean(flagged[key]);
                  let host = "Source";
                  try { host = new URL(source.safeUrl!).hostname.replace(/^www\./, ""); } catch { /* validated above */ }
                  return (
                    <article key={`${source.safeUrl}-${i}`} className={`rounded-xl border p-3 ${isFlagged ? "border-amber-400/40 bg-amber-400/5" : "border-[var(--border-subtle)] bg-[var(--bg-primary)]/50"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">[{i + 1}] {host}</div>
                          <a href={source.safeUrl!} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-start gap-1 text-[13px] font-medium leading-snug text-[var(--text-primary)] hover:text-[var(--accent)]">
                            <span>{source.title || source.safeUrl}</span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                          </a>
                        </div>
                        <button
                          type="button"
                          aria-pressed={isFlagged}
                          onClick={() => setFlagged((current) => ({ ...current, [key]: !current[key] }))}
                          className={`shrink-0 rounded-lg p-1.5 text-[11px] transition cursor-pointer ${isFlagged ? "text-amber-300 bg-amber-400/10" : "text-[var(--text-muted)] hover:text-amber-300 hover:bg-amber-400/10"}`}
                          title="Manually flag this source to compare it with other evidence"
                        >
                          <Flag className="h-3.5 w-3.5" />
                          <span className="sr-only">{isFlagged ? "Remove comparison flag" : "Flag for comparison"}</span>
                        </button>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{source.snippet || "No preview excerpt is available. Open the source to inspect it."}</p>
                      {isFlagged && <p className="mt-2 text-[10px] text-amber-300">Flagged by you for comparison; this is not an automated conflict finding.</p>}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border-subtle)] p-3 text-xs text-[var(--text-muted)]">{isSearching ? "Finding relevant live sources…" : "No source links were returned for this research run."}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
