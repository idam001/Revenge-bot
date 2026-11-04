"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  KeyRound,
  FileText,
  Folder,
  FolderPlus,
  FolderOpen,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  Copy,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { ALL_MODELS, getModelById } from "@/lib/revenge-registry";
import { apiFetch } from "@/lib/api-client";
import { MarkdownRenderer } from "./MarkdownRenderer";

/* ------------------------------------------------------------------ */

const TOOL_LABELS: Record<string, string> = {
  execute_command: "Bash",
  run_python: "Python",
  run_javascript: "Node.js",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_files: "List files",
  create_directory: "New folder",
  delete_file: "Delete",
  run_tests: "Run tests",
  inspect_project: "Inspect",
  install_package: "Install",
  get_process_status: "Process",
  stop_process: "Stop",
};

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

function fmtDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

interface FeedTool {
  id: string;
  kind: "tool";
  tool: string;
  command: string;
  status: "running" | "success" | "failed";
  exitCode?: number;
  durationMs?: number;
  stdout: string;
  stderr: string;
  timestamp: string;
  expanded: boolean;
}

interface FeedText {
  id: string;
  kind: "thinking" | "summary" | "status";
  text: string;
  status?: string;
  timestamp: string;
}

type FeedEntry = FeedTool | FeedText;

interface AgentSessionInfo {
  id: string;
  title: string;
  modelId: string;
  mode: string;
  status: string;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FileEntry {
  name: string;
  type: string;
  path: string;
  size: number;
}

function loadTokens(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("revenge-agent-tokens") || "{}");
  } catch {
    return {};
  }
}

function saveToken(sessionId: string, token: string) {
  try {
    const all = loadTokens();
    all[sessionId] = token;
    localStorage.setItem("revenge-agent-tokens", JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */

export function AgentWorkspace({
  initialModelId,
  onExit,
  onOpenKeys,
}: {
  initialModelId?: string;
  onExit: () => void;
  onOpenKeys?: () => void;
}) {
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [e2bReady, setE2bReady] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("New agent task");
  const [status, setStatus] = useState<string>("idle");
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [summary, setSummary] = useState<string>("");
  // Visible conversation: every prompt you send and every answer the agent gives.
  // Tool activity for the current turn is nested under the assistant turn, so the
  // transcript reads like a normal chat instead of a bare event log.
  const [turns, setTurns] = useState<
    Array<{
      id: string;
      role: "user" | "assistant";
      /** The answer the user reads. */
      text: string;
      status: "streaming" | "done" | "failed";
      events: FeedEntry[];
      startedAt: string;
      prompt?: string;
    }>
  >([]);

  const [modelId, setModelId] = useState(initialModelId || "revenge-omega-x");
  const [mode, setMode] = useState<"auto" | "plan">("auto");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);

  const [filesOpen, setFilesOpen] = useState(false);
  const [cwd, setCwd] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [openFile, setOpenFile] = useState<{ path: string; content: string; dirty: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const readerAbort = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeModel = useMemo(() => getModelById(modelId), [modelId]);
  const capability = activeModel.requiresKey ? "Native tool-calling" : "Structured actions · real execution";

  const refreshSessions = useCallback(async () => {
    try {
      const res = await apiFetch("/api/agent?list=1");
      if (!res.ok) return;
      const data = (await res.json()) as {
        sessions?: AgentSessionInfo[];
        sandboxConfigured?: boolean;
        e2bConfigured?: boolean;
      };
      setSessions(data.sessions ?? []);
      // Read the new key, falling back for older deployments.
      setE2bReady(data.sandboxConfigured ?? data.e2bConfigured ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  /* ------------------------------ SSE ------------------------------ */

  const upsertTool = useCallback((id: string, patch: Partial<FeedTool> & { tool?: string; command?: string }) => {
    setFeed((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx === -1) {
        return [
          ...prev,
          {
            id,
            kind: "tool",
            tool: patch.tool ?? "execute_command",
            command: patch.command ?? "",
            status: "running",
            stdout: "",
            stderr: "",
            timestamp: new Date().toISOString(),
            expanded: false,
            ...patch,
          } as FeedTool,
        ];
      }
      const next = [...prev];
      next[idx] = { ...(next[idx] as FeedTool), ...patch };
      return next;
    });
  }, []);

  const pushToTurn = useCallback((entry: FeedEntry) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      if (last.role !== "assistant") return prev;
      next[next.length - 1] = { ...last, events: [...last.events, entry] };
      return next;
    });
  }, []);

  const handleEvent = useCallback(
    (evt: Record<string, unknown>) => {
      const type = String(evt.type ?? "");
      if (type === "agent.thinking") {
        // Model working-out stays private; the UI shows a neutral progress state.
      } else if (type === "tool.queued" || type === "tool.started") {
        upsertTool(String(evt.executionId ?? ""), {
          tool: String(evt.tool ?? "execute_command"),
          command: String(evt.command ?? ""),
          status: "running",
          timestamp: String(evt.timestamp ?? new Date().toISOString()),
        });
      } else if (type === "tool.stdout" || type === "tool.stderr") {
        const id = String(evt.executionId ?? "");
        const key = type === "tool.stdout" ? "stdout" : "stderr";
        setFeed((prev) =>
          prev.map((e) =>
            e.id === id && e.kind === "tool"
              ? { ...e, [key]: (e[key] + String(evt.text ?? "")).slice(-15000) }
              : e
          )
        );
      } else if (type === "tool.completed" || type === "tool.failed") {
        upsertTool(String(evt.executionId ?? ""), {
          status: type === "tool.completed" ? "success" : "failed",
          exitCode: typeof evt.exitCode === "number" ? evt.exitCode : undefined,
          durationMs: typeof evt.durationMs === "number" ? evt.durationMs : undefined,
          stdout: typeof evt.stdout === "string" ? evt.stdout : undefined,
          stderr: typeof evt.stderr === "string" ? evt.stderr : undefined,
        } as Partial<FeedTool>);
      } else if (type === "process.started") {
        upsertTool(String(evt.executionId ?? ""), {
          stdout: `Background process started (pid ${String(evt.pid ?? "?")}).`,
        } as Partial<FeedTool>);
      } else if (type === "agent.status") {
        const txt = String(evt.text ?? "");
        if (txt) {
          const entry: FeedEntry = {
            id: `st_${Date.now()}`,
            kind: "status",
            text: txt,
            timestamp: String(evt.timestamp ?? new Date().toISOString()),
          };
          setFeed((prev) => [...prev, entry]);
          pushToTurn(entry);
        }
      } else if (type === "agent.completed" || type === "agent.failed") {
        const cancelled = Boolean((evt as { cancelled?: boolean }).cancelled);
        setStatus(type === "agent.completed" ? (cancelled ? "cancelled" : "completed") : "failed");
        const text = String((evt as { summary?: unknown }).summary ?? (evt as { error?: unknown }).error ?? "");
        setTurns((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = {
                ...next[i],
                status: type === "agent.completed" ? "done" : "failed",
                text: text || next[i].text,
              };
              break;
            }
          }
          return next;
        });
        if (text) {
          setSummary(text);
          setFeed((prev) => [
            ...prev,
            {
              id: `sum_${Date.now()}`,
              kind: "summary",
              text,
              status: type === "agent.completed" ? "completed" : "failed",
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        setRunning(false);
        void refreshSessions();
      }
    },
    [upsertTool, refreshSessions]
  );

  const startTask = useCallback(
    async (taskText: string) => {
      const task = taskText.trim();
      if (!task || running) return;

      // Follow-up if we already own a session; brand new run otherwise.
      const continuing = Boolean(sessionId && token);

      const now = new Date().toISOString();
      const userTurnId = `u_${Date.now()}`;
      const assistantTurnId = `a_${Date.now()}`;

      // Optimistic: your message appears the instant you hit send.
      setTurns((prev) => [
        ...prev,
        { id: userTurnId, role: "user", text: task, status: "done", events: [], startedAt: now },
        {
          id: assistantTurnId,
          role: "assistant",
          text: "",
          status: "streaming",
          events: [],
          startedAt: now,
          prompt: task,
        },
      ]);
      setFeed([]);
      setInput("");
      setStatus("running");
      setRunning(true);
      if (!continuing) {
        setSummary("");
        setSessionId(null);
        setToken(null);
        setTaskTitle(task.length > 60 ? `${task.slice(0, 60)}…` : task);
      }

      const ctrl = new AbortController();
      readerAbort.current = ctrl;

      try {
        const res = await apiFetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            continuing
              ? { action: "start", sessionId, token, task, modelId, mode }
              : { action: "start", task, title: task.slice(0, 80), modelId, mode }
          ),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            for (const line of part.split("\n")) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              try {
                const evt = JSON.parse(t.slice(5).trim()) as Record<string, unknown>;
                if (evt.type === "agent.started" && typeof evt.sessionId === "string") {
                  setSessionId(evt.sessionId);
                  if (typeof evt.token === "string") {
                    setToken(evt.token);
                    saveToken(evt.sessionId, evt.token);
                  }
                }
                handleEvent(evt);
              } catch {
                // Skip malformed frames
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          const msg = err instanceof Error ? err.message : "Agent run failed";
          setStatus("failed");
          const entry: FeedEntry = {
            id: `err_${Date.now()}`,
            kind: "status",
            text: msg,
            timestamp: new Date().toISOString(),
          };
          setFeed((prev) => [...prev, entry]);
          setTurns((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "assistant") {
                next[i] = { ...next[i], status: "failed", text: msg };
                break;
              }
            }
            return next;
          });
        }
      } finally {
        setRunning(false);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurnId && t.status === "streaming"
              ? { ...t, status: "done", text: t.text || summary || "Finished." }
              : t
          )
        );
        void refreshSessions();
      }
    },
    [running, modelId, mode, handleEvent, refreshSessions, sessionId, token, summary]
  );

  const stopTask = useCallback(async () => {
    readerAbort.current?.abort();
    if (sessionId && token) {
      try {
        await apiFetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel", sessionId, token }),
        });
      } catch {
        /* stream already closing */
      }
    }
    setRunning(false);
    setStatus("cancelled");
    setFeed((prev) => [
      ...prev,
      { id: `cancel_${Date.now()}`, kind: "status", text: "Stopped by user. Running processes were terminated.", timestamp: new Date().toISOString() },
    ]);
  }, [sessionId, token]);

  const openSession = useCallback(async (id: string) => {
    const tokens = loadTokens();
    const tok = tokens[id];
    if (!tok) return;
    try {
      const res = await apiFetch(`/api/agent?sessionId=${id}&token=${tok}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        session?: { id: string; title: string; modelId: string; mode: string; status: string; summary?: string };
        executions?: Array<{
          id: string;
          toolName: string;
          command?: string | null;
          stdout: string;
          stderr: string;
          exitCode: number;
          durationMs: number;
          status: string;
          startedAt: string;
        }>;
        messages?: Array<{ id: string; role: string; content: string; createdAt: string }>;
      };
      if (!data.session) return;
      setSessionId(data.session.id);
      setToken(tok);
      setTaskTitle(data.session.title);
      setStatus(data.session.status);
      setModelId(data.session.modelId);
      setSummary(data.session.summary ?? "");
      const rebuilt: Array<{
        id: string;
        role: "user" | "assistant";
        text: string;
        status: "streaming" | "done" | "failed";
        events: FeedEntry[];
        startedAt: string;
      }> = (data.messages ?? [])
        .filter((m) => m.content && m.content.trim())
        .map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          text: m.content,
          status: (m.role === "assistant" && data.session?.status === "failed" ? "failed" : "done") as
            | "streaming"
            | "done"
            | "failed",
          events: [],
          startedAt: m.createdAt,
        }));
      // Older sessions predate message history — fall back to the last summary.
      if (rebuilt.length === 0 && data.session.summary) {
        rebuilt.push({
          id: `legacy_${data.session.id}`,
          role: "assistant",
          text: data.session.summary,
          status: data.session.status === "failed" ? "failed" : "done",
          events: [],
          startedAt: new Date().toISOString(),
        });
      }
      setTurns(rebuilt);
      setFeed(
        (data.executions ?? []).map((e) => ({
          id: e.id,
          kind: "tool",
          tool: e.toolName,
          command: e.command ?? "",
          status: e.status === "success" ? "success" : "failed",
          exitCode: e.exitCode,
          durationMs: e.durationMs,
          stdout: e.stdout,
          stderr: e.stderr,
          timestamp: e.startedAt,
          expanded: false,
        })) as FeedEntry[]
      );
      if (data.session.summary) {
        setFeed((prev) => [
          ...prev,
          { id: `sum_${Date.now()}`, kind: "summary", text: data.session!.summary!, status: data.session!.status, timestamp: new Date().toISOString() },
        ]);
      }
      setHistoryOpen(false);
    } catch {
      /* ignore */
    }
  }, []);

  /* ------------------------------ files ------------------------------ */

  const filesApi = useCallback(
    async (op: string, extra: Record<string, unknown> = {}) => {
      if (!sessionId || !token) throw new Error("No active session.");
      const res = await apiFetch("/api/agent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, token, op, path: cwd === "." ? undefined : cwd, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "File operation failed");
      return data as { entries?: FileEntry[]; content?: string; path?: string };
    },
    [sessionId, token, cwd]
  );

  const refreshFiles = useCallback(async () => {
    if (!sessionId) return;
    setFilesLoading(true);
    try {
      const data = await filesApi("list");
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    } finally {
      setFilesLoading(false);
    }
  }, [filesApi, sessionId]);

  useEffect(() => {
    if (filesOpen && sessionId) void refreshFiles();
  }, [filesOpen, sessionId, cwd, refreshFiles]);

  const openFileAtPath = useCallback(
    async (entry: FileEntry) => {
      try {
        const data = await filesApi("read", { path: entry.path });
        setOpenFile({ path: entry.path, content: data.content ?? "", dirty: false });
      } catch {
        /* ignore */
      }
    },
    [filesApi]
  );

  const saveFile = useCallback(async () => {
    if (!openFile) return;
    try {
      await filesApi("write", { path: openFile.path, content: openFile.content });
      setOpenFile({ ...openFile, dirty: false });
      void refreshFiles();
    } catch {
      /* ignore */
    }
  }, [openFile, filesApi, refreshFiles]);

  const downloadZip = useCallback(async () => {
    if (!sessionId || !token) return;
    const res = await apiFetch("/api/agent/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, token }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "revenge-agent-project"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sessionId, token, taskTitle]);

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!sessionId) return;
      const text = await file.text();
      try {
        await filesApi("write", { path: file.name, content: text.slice(0, 500_000) });
        void refreshFiles();
      } catch {
        /* ignore */
      }
    },
    [sessionId, filesApi, refreshFiles]
  );

  /* ------------------------------ render ------------------------------ */

  const statusColor =
    status === "running" ? "bg-emerald-400" : status === "failed" ? "bg-red-400" : status === "completed" ? "bg-sky-400" : "bg-[var(--text-muted)]";

  return (
    <div className="flex h-full w-full min-h-0 bg-[#141413] text-[#ecebe6]">
      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top nav */}
        <header className="shrink-0 flex items-center gap-2 px-3 sm:px-4 h-14 border-b border-white/[0.07] bg-[#191918]">
          <button
            type="button"
            onClick={onExit}
            aria-label="Back to chat"
            className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </button>
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#d97757] to-[#8b5cf6] flex items-center justify-center text-[13px] shrink-0">
            😈
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-white truncate">{taskTitle}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-white/45">
              <span className={`w-1.5 h-1.5 rounded-full ${statusColor} ${status === "running" ? "animate-pulse" : ""}`} />
              Agent mode · {status}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            title="Session history"
            aria-label="Session history"
            className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
          >
            <History className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => setFilesOpen((o) => !o)}
            title="File explorer"
            aria-label="File explorer"
            className={`p-2 rounded-lg cursor-pointer ${filesOpen ? "bg-[#d97757]/20 text-[#d97757]" : "hover:bg-white/[0.06] text-white/60 hover:text-white"}`}
          >
            <FolderOpen className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={() => {
              readerAbort.current?.abort();
              setSessionId(null);
              setToken(null);
              setFeed([]);
              setSummary("");
              setStatus("idle");
              setTaskTitle("New agent task");
              setRunning(false);
            }}
            title="New agent task"
            aria-label="New agent task"
            className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
          >
            <Plus className="w-[18px] h-[18px]" />
          </button>
        </header>

        {e2bReady === false && (
          <div className="shrink-0 mx-3 sm:mx-5 mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[12.5px] leading-relaxed text-amber-200">
            <strong>No sandbox backend is configured.</strong> Agent Mode is available but cannot execute code yet.
            On a Vercel deployment this is automatic; on other hosts, set <code>E2B_API_KEY</code> server-side and restart.
          </div>
        )}

        {/* Conversation transcript: your messages and the agent's replies, in order */}
        <div ref={feedRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4" aria-live="polite" aria-atomic="false">
          {turns.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
              <span className="w-12 h-12 rounded-2xl bg-[#d97757]/12 border border-[#d97757]/25 flex items-center justify-center">
                <Bot className="w-6 h-6 text-[#d97757]" />
              </span>
              <h2 className="mt-4 font-claude-serif text-[22px] text-white">Talk to me, or give me a job</h2>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-white/50">
                Say hello and I will just answer you like a normal chat. Ask me to build, fix or run something
                and I switch into agent mode — writing real files in an isolated cloud sandbox, running
                commands, reading the actual errors, debugging and delivering a ZIP.
              </p>
              <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-white/35">
                Follow-ups stay in this same session with the same files and history.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {[
                  "Hi — what can you do?",
                  "Build a Flask notes API with tests",
                  "Create a React dashboard and run its build",
                  "Debug this traceback: IndexError list out of range",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void startTask(s)}
                    className="px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-[12.5px] text-white/60 hover:text-white hover:border-[#d97757]/50 transition cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-5 pb-2">
              {turns.map((turn) =>
                turn.role === "user" ? (
                  <div key={turn.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#2f2d2a] border border-white/10 px-3.5 py-2.5 text-[14.5px] leading-relaxed text-white/95 whitespace-pre-wrap break-words">
                      {turn.text}
                      <div className="mt-1 text-right text-[10px] font-mono text-white/25">{fmtTime(turn.startedAt)}</div>
                    </div>
                  </div>
                ) : (
                  <div key={turn.id} className="flex gap-2.5">
                    <span className="mt-0.5 shrink-0 w-6 h-6 rounded-md bg-[#d97757]/15 border border-[#d97757]/25 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 text-[#d97757]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* Tool step ledger: collapsed by default, one line per action */}
                      {turn.events.length > 0 && (
                        <div className="mb-2 space-y-0.5">
                          {turn.events.map((entry) => {
                            if (entry.kind === "status") {
                              return (
                                <div key={entry.id} className="py-0.5 text-[12px] text-[#d97757]/80 italic">
                                  {entry.text}
                                </div>
                              );
                            }
                            const t = entry as FeedTool;
                            const ok = t.status === "success";
                            const runningRow = t.status === "running";
                            return (
                              <div key={t.id} className="rounded-lg hover:bg-white/[0.03] transition">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFeed((prev) =>
                                      prev.map((e) =>
                                        e.id === t.id && e.kind === "tool" ? { ...e, expanded: !e.expanded } : e
                                      )
                                    )
                                  }
                                  className="w-full flex items-center gap-2 px-1.5 py-[5px] text-left cursor-pointer"
                                >
                                  <ChevronRight
                                    className={`w-3 h-3 text-white/30 transition-transform ${t.expanded ? "rotate-90" : ""}`}
                                  />
                                  <span className="text-[12.5px] text-white/70">Used {toolLabel(t.tool)}</span>
                                  {runningRow ? (
                                    <Loader2 className="w-3 h-3 text-white/50 animate-spin" />
                                  ) : ok ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
                                  ) : (
                                    <X className="w-3.5 h-3.5 text-red-400" strokeWidth={3} />
                                  )}
                                  <span
                                    className={`text-[11px] font-mono ${runningRow ? "text-white/35" : ok ? "text-white/35" : "text-red-400/90"}`}
                                  >
                                    {!ok && typeof t.exitCode === "number" ? `exit ${t.exitCode} ` : ""}
                                    {t.durationMs !== undefined ? fmtDuration(t.durationMs) : runningRow ? "running…" : ""}
                                  </span>
                                </button>
                                {(t.command || t.stdout || t.stderr) && (
                                  <div className={`overflow-hidden transition-all duration-200 ${t.expanded ? "max-h-[480px]" : "max-h-0"}`}>
                                    <div className="ml-6 mr-1 mb-1.5 rounded-lg bg-black/40 border border-white/[0.06] overflow-hidden">
                                      {t.command && (
                                        <div className="px-3 pt-2 pb-1 font-mono text-[11px] text-white/45 break-all">
                                          <span className="text-[#d97757]">$ </span>
                                          {t.command}
                                        </div>
                                      )}
                                      {t.stdout && (
                                        <pre className="px-3 py-1.5 font-mono text-[11.5px] leading-relaxed text-emerald-100/80 whitespace-pre-wrap break-words max-h-56 overflow-y-auto">
                                          {t.stdout}
                                        </pre>
                                      )}
                                      {t.stderr && (
                                        <pre className="px-3 py-1.5 font-mono text-[11.5px] leading-relaxed text-red-300/85 whitespace-pre-wrap break-words max-h-40 overflow-y-auto border-t border-white/[0.06]">
                                          {t.stderr}
                                        </pre>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* The agent answer, rendered as real markdown */}
                      {turn.text ? (
                        <div
                          className={`agent-answer text-[14.5px] leading-[1.75] break-words ${
                            turn.status === "failed" ? "text-red-200/90" : "text-white/90"
                          }`}
                        >
                          <MarkdownRenderer content={turn.text} />
                          {turn.status === "streaming" && (
                            <span className="inline-block w-[2px] h-[15px] ml-0.5 align-middle bg-[#d97757] animate-pulse" />
                          )}
                        </div>
                      ) : turn.status === "streaming" ? (
                        <div className="flex items-center gap-2 text-[13px] text-white/45">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Thinking through your request…
                        </div>
                      ) : null}

                      {turn.status !== "streaming" && turn.text && (
                        <div className="mt-1.5 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard?.writeText(turn.text)}
                            className="text-[11px] text-white/30 hover:text-white/70 cursor-pointer inline-flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" /> Copy
                          </button>
                          {turn.status === "failed" && (
                            <button
                              type="button"
                              onClick={() => void startTask(turn.prompt || "Continue where you left off.")}
                              className="text-[11px] text-[#d97757] hover:text-[#e8896b] cursor-pointer inline-flex items-center gap-1 font-medium"
                            >
                              <RotateCw className="w-3 h-3" /> Try again
                            </button>
                          )}
                          {turn.status === "done" && sessionId && token && (
                            <button
                              type="button"
                              onClick={() => void downloadZip()}
                              className="text-[11px] text-white/30 hover:text-white/70 cursor-pointer inline-flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" /> Download ZIP
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 px-3 sm:px-5 pb-3 safe-bottom">
          <div className="max-w-3xl mx-auto rounded-2xl border border-white/10 bg-[#1d1c1a] shadow-2xl">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void startTask(input);
                }
              }}
              placeholder={
                running
                  ? "Agent is working… press stop to interrupt"
                  : turns.length > 0
                    ? "Reply to the agent — it keeps this session and its files"
                    : "What would you like to do?"
              }
              className="w-full bg-transparent px-4 pt-3.5 text-[15px] text-white placeholder:text-white/30 focus:outline-none resize-none max-h-40"
              style={{ minHeight: "52px" }}
            />
            <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadAttachment(f);
                }}
              />
              <button
                type="button"
                title="Upload a file into the workspace"
                onClick={() => fileInputRef.current?.click()}
                disabled={!sessionId || running}
                className="p-2 rounded-lg text-white/45 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 cursor-pointer"
              >
                <FilePlus2 className="w-[18px] h-[18px]" />
              </button>
              {onOpenKeys && (
                <button
                  type="button"
                  title="Add your own API key — unlocks stronger models for the agent"
                  aria-label="Add API key"
                  onClick={onOpenKeys}
                  className="p-2 rounded-lg text-white/45 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <KeyRound className="w-[18px] h-[18px]" />
                </button>
              )}
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={running}
                title="Agent model"
                className="max-w-[150px] sm:max-w-[210px] px-2 h-9 rounded-lg bg-transparent border border-transparent hover:border-white/10 text-[12.5px] text-white/60 focus:outline-none cursor-pointer disabled:opacity-50 truncate"
              >
                {ALL_MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#1d1c1a]">
                    {m.shortName}
                  </option>
                ))}
              </select>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "auto" | "plan")}
                disabled={running}
                title={mode === "plan" ? "Plan only: no files are created or commands run" : "Agent mode: can build and run tasks"}
                className="px-2 h-9 rounded-lg bg-transparent border border-transparent hover:border-white/10 text-[12.5px] text-white/60 focus:outline-none cursor-pointer disabled:opacity-50"
              >
                <option value="auto" className="bg-[#1d1c1a]">Agent</option>
                <option value="plan" className="bg-[#1d1c1a]">Plan only (no build)</option>
              </select>
              <span className="hidden md:inline text-[11px] text-white/30 ml-1">{capability}</span>
              <div className="ml-auto">
                {running ? (
                  <button
                    type="button"
                    onClick={() => void stopTask()}
                    aria-label="Stop agent"
                    title="Stop — cancels the task and kills running processes"
                    className="w-9 h-9 rounded-lg bg-white text-black flex items-center justify-center hover:bg-white/85 cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startTask(input)}
                    disabled={!input.trim()}
                    aria-label="Send task"
                    className="w-9 h-9 rounded-lg bg-white text-black flex items-center justify-center hover:bg-white/85 disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="text-center text-[11px] text-white/30 mt-1.5">
            Real isolated E2B sandbox · every command above actually ran
          </p>
        </div>
      </div>

      {/* File explorer drawer */}
      {filesOpen && (
        <aside className="fixed inset-y-0 right-0 z-40 w-[320px] max-w-[88vw] bg-[#191918] border-l border-white/[0.08] flex flex-col md:static md:w-[340px] shrink-0">
          <div className="h-14 shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.07]">
            <Folder className="w-4 h-4 text-[#d97757]" />
            <span className="text-[13.5px] font-semibold text-white flex-1 truncate">Workspace files</span>
            <button
              type="button"
              onClick={downloadZip}
              disabled={!sessionId}
              title="Download project ZIP"
              className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white disabled:opacity-30 cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void refreshFiles()}
              title="Refresh"
              className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setFilesOpen(false)}
              aria-label="Close files"
              className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {!sessionId ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-[12.5px] text-white/40">
              Start a task to open its isolated workspace.
            </div>
          ) : (
            <>
              <div className="shrink-0 px-3 py-2 border-b border-white/[0.07] flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCwd(".");
                    setOpenFile(null);
                  }}
                  className="text-[11.5px] font-mono text-white/50 hover:text-white cursor-pointer truncate"
                >
                  /workspace{cwd !== "." ? `/${cwd}` : ""}
                </button>
                {cwd !== "." && (
                  <button
                    type="button"
                    onClick={() => {
                      const parts = cwd.split("/").filter(Boolean);
                      parts.pop();
                      setCwd(parts.join("/") || ".");
                      setOpenFile(null);
                    }}
                    className="text-[11.5px] text-[#d97757] hover:underline cursor-pointer shrink-0"
                  >
                    ↑ up
                  </button>
                )}
              </div>

              <div className="shrink-0 px-3 py-2 border-b border-white/[0.07] flex items-center gap-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="new-file.py"
                  className="flex-1 min-w-0 px-2.5 h-8 rounded-lg bg-black/30 border border-white/10 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-[#d97757]/60"
                />
                <button
                  type="button"
                  title="Create file"
                  onClick={async () => {
                    if (!newName.trim()) return;
                    try {
                      await filesApi("write", { path: newName.trim(), content: "" });
                      setNewName("");
                      void refreshFiles();
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
                >
                  <FilePlus2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Create folder"
                  onClick={async () => {
                    if (!newName.trim()) return;
                    try {
                      await filesApi("mkdir", { path: newName.trim() });
                      setNewName("");
                      void refreshFiles();
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="p-2 rounded-lg hover:bg-white/[0.06] text-white/60 hover:text-white cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 min-h-0">
                {filesLoading ? (
                  <div className="p-4 text-center text-[12px] text-white/40">Loading…</div>
                ) : entries.length === 0 ? (
                  <div className="p-4 text-center text-[12px] text-white/40">
                    Empty folder. The agent&apos;s files appear here.
                  </div>
                ) : (
                  entries.map((e) => {
                    const isDir = e.type === "dir";
                    const full = cwd === "." ? e.name : `${cwd}/${e.name}`;
                    return (
                      <div
                        key={full}
                        className="group flex items-center gap-2 px-2 py-[7px] rounded-lg hover:bg-white/[0.05] text-[13px]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isDir) {
                              setCwd(full);
                              setOpenFile(null);
                            } else {
                              void openFileAtPath({ ...e, path: full });
                            }
                          }}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                        >
                          {isDir ? (
                            <Folder className="w-4 h-4 text-[#d97757]/80 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-white/40 shrink-0" />
                          )}
                          <span className="truncate text-white/80">{e.name}</span>
                        </button>
                        <button
                          type="button"
                          title={`Delete ${e.name}`}
                          onClick={async () => {
                            try {
                              await filesApi("delete", { path: full, recursive: isDir });
                              if (openFile?.path === full) setOpenFile(null);
                              void refreshFiles();
                            } catch {
                              /* ignore */
                            }
                          }}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/40 hover:text-red-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {openFile && (
                <div className="shrink-0 h-[42%] border-t border-white/[0.08] flex flex-col min-h-0 bg-black/20">
                  <div className="flex items-center gap-2 px-3 h-10 border-b border-white/[0.07]">
                    <span className="text-[12px] font-mono text-white/70 truncate flex-1">{openFile.path}</span>
                    {openFile.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                    <button
                      type="button"
                      onClick={() => void saveFile()}
                      className="px-2.5 h-7 rounded-lg bg-[#d97757] hover:bg-[#d97757]/85 text-white text-[12px] font-medium cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenFile(null)}
                      aria-label="Close file"
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/50 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={openFile.content}
                    onChange={(e) => setOpenFile({ ...openFile, content: e.target.value, dirty: true })}
                    spellCheck={false}
                    className="flex-1 min-h-0 w-full p-3 bg-transparent font-mono text-[12px] leading-relaxed text-white/85 focus:outline-none resize-none"
                  />
                </div>
              )}
            </>
          )}
        </aside>
      )}

      {/* Session history */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 pt-[10dvh]" onClick={() => setHistoryOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-[#1d1c1a] border border-white/10 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 h-12 border-b border-white/[0.07]">
              <span className="text-[14px] font-semibold text-white">Agent sessions</span>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/60 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[50dvh] overflow-y-auto p-1.5">
              {sessions.length === 0 ? (
                <div className="p-5 text-center text-[12.5px] text-white/40">No agent sessions yet.</div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void openSession(s.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] text-left cursor-pointer"
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        s.status === "running" ? "bg-emerald-400 animate-pulse" : s.status === "failed" ? "bg-red-400" : "bg-white/25"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-white truncate">{s.title}</span>
                      <span className="block text-[11px] text-white/40">
                        {getModelById(s.modelId).shortName} · {s.toolCallCount} tools · {s.status}
                      </span>
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-white/30 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
