"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Bookmark,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Coffee,
  Copy,
  Download,
  Edit3,
  Camera,
  FileText,
  Film,
  FlaskConical,
  FolderKanban,
  Ghost,
  Keyboard,
  Link2,
  GitBranch,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Menu,
  Mic,
  MicOff,
  MoreHorizontal,
  Moon,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Share2,
  Square,
  SquarePen,
  Star,
  Sun,
  Swords,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  ALL_MODELS,
  CREATOR_NAME,
  KEYLESS_MODELS,
  PERSONAS,
  PROMPT_ARSENAL,
  getModelById,
} from "@/lib/revenge-registry";
import type {
  AppSettingsRow,
  AttachmentItem,
  ConversationRow,
  MemoryRow,
  WebSourceItem,
} from "@/db/schema";
import {
  MarkdownRenderer,
  extractArtifactsFromMarkdown,
  isPreviewableArtifact,
  type CanvasArtifactPayload,
} from "./MarkdownRenderer";
import { ArtifactCanvasDrawer } from "./ArtifactCanvasDrawer";
import {
  UniversalVaultModal,
  type ProviderStatusItem,
} from "./UniversalVaultModal";
import { AccountMenu } from "./AccountMenu";
import { apiFetch, primeGuestScope } from "@/lib/api-client";
import { ModelPickerModal } from "./ModelPickerModal";
import { PromptArsenalModal } from "./PromptArsenalModal";
import { SparkIcon } from "./SparkIcon";
import { FeatureLab } from "./FeatureLab";
import { AgentWorkspace } from "./AgentWorkspace";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { CommandPalette, type PaletteAction } from "./CommandPalette";
import { DEFAULT_FLAGS } from "@/lib/feature-catalog";

export interface ChatToolRun {
  executionId: string;
  tool: string;
  command: string;
  status: "running" | "success" | "failed";
  exitCode?: number;
  durationMs?: number;
  stdout: string;
  stderr: string;
  expanded?: boolean;
}

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string | null;
  reasoningMs?: number | null;
  modelId?: string | null;
  providerUsed?: string | null;
  latencyMs?: number | null;
  tokensPerSec?: number | null;
  webSources?: WebSourceItem[] | null;
  attachments?: AttachmentItem[] | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  bookmarked?: boolean;
  isStreaming?: boolean;
  isThinking?: boolean;
  isSearching?: boolean;
  searchQuery?: string | null;
  researchAttempted?: boolean;
  toolRuns?: ChatToolRun[] | null;
}

const CHAT_TOOL_LABELS: Record<string, string> = {
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

interface ArenaSecondaryReply {
  modelId: string;
  content: string;
  providerUsed: string;
  isStreaming: boolean;
}

interface MinimalSpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type VaultTab = "vault" | "keyless" | "project" | "engine" | "memory";

const DEFAULT_SETTINGS: AppSettingsRow = {
  id: "default",
  ownerKey: "legacy:public",
  theme: "dark",
  personalInstructions: "",
  memoryEnabled: true,
  defaultModelId: "revenge-omega-x",
  defaultPersonaId: "unchained",
  customSystemPrompt: "",
  temperature: 0.7,
  maxTokens: 8192,
  reasoningEffort: "high",
  webSearchDefault: false,
  autoFailover: true,
  streamResponses: true,
  featureFlags: {},
  updatedAt: new Date(),
};

const DEMO_ARTIFACT: CanvasArtifactPayload = {
  id: "demo-1",
  title: "Artifact preview",
  language: "html",
  code: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Artifact preview</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,sans-serif}
  body{background:#262624;color:#faf9f5;padding:28px;min-height:100vh}
  h1{font-family:Georgia,serif;font-weight:500;font-size:26px;margin-bottom:8px}
  p{color:#c2c0b6;line-height:1.6;margin-bottom:18px;font-size:14px}
  button{background:#d97757;border:0;color:#fff;padding:10px 18px;border-radius:10px;font-weight:600;cursor:pointer}
  #n{font-size:44px;margin:14px 0;font-family:Georgia,serif}
</style>
</head>
<body>
  <h1>Artifacts run live here</h1>
  <p>Ask for any app, dashboard, game or React component. It renders in this panel and you can edit, iterate and download it.</p>
  <div id="n">0</div>
  <button onclick="document.getElementById('n').textContent=++window.c||(window.c=1)">Tap me</button>
</body>
</html>`,
};

const HOME_PILLS: {
  id: string;
  label: string;
  icon: typeof Edit3;
  items: { title: string; prompt: string }[];
}[] = [
  {
    id: "write",
    label: "Write",
    icon: Edit3,
    items: [
      {
        title: "Write a gripping short story opening",
        prompt:
          "Write the opening 800 words of a gritty cyber-noir short story set in Lagos in 2049. Make the dialogue sharp and the atmosphere heavy.",
      },
      {
        title: "Draft a cold outreach email that gets replies",
        prompt:
          "Write 3 versions of a cold outreach email for a freelance developer pitching a SaaS founder. Keep each under 120 words and make them feel human.",
      },
      {
        title: "Roast my startup idea (honestly)",
        prompt:
          "I will paste a startup idea. Give me a brutally honest, no-sugarcoating critique, then tell me exactly how to fix it.",
      },
    ],
  },
  {
    id: "learn",
    label: "Learn",
    icon: BookOpen,
    items: [
      {
        title: "Explain how LLMs actually work",
        prompt:
          "Explain how large language models work from first principles: tokens, attention, training, and why they hallucinate. Use analogies and a short code example.",
      },
      {
        title: "Teach me system design",
        prompt:
          "Teach me system design with a worked example: design a URL shortener that handles 10k requests per second. Include capacity math.",
      },
      {
        title: "Break down a hard math concept",
        prompt:
          "Explain eigenvectors and eigenvalues intuitively, then show a worked numerical example step by step.",
      },
    ],
  },
  {
    id: "code",
    label: "Code",
    icon: Code2,
    items: PROMPT_ARSENAL.filter((p) => p.category === "Code & Artifacts").map(
      (p) => ({ title: p.title, prompt: p.prompt })
    ),
  },
  {
    id: "life",
    label: "Life stuff",
    icon: Coffee,
    items: [
      {
        title: "Plan a 12-week fitness and study routine",
        prompt:
          "Build me a realistic 12-week routine that balances learning to code, working out 4x a week, and sleeping well. Put it in a table.",
      },
      {
        title: "Help me make a hard decision",
        prompt:
          "I'm choosing between two options. Ask me the 5 sharpest questions you can, then help me decide with a pros/cons matrix.",
      },
    ],
  },
  {
    id: "unchained",
    label: "Unchained",
    icon: Sparkles,
    items: PROMPT_ARSENAL.filter((p) => p.category === "Unchained").map((p) => ({
      title: p.title,
      prompt: p.prompt,
    })),
  },
];

async function compressImageFile(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  const original = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
  if (!original) return "";
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = original;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    // Formats the browser can't decode (e.g. HEIC outside Safari) are skipped
    return /^data:image\/(jpeg|png|webp|gif);/.test(original) ? original : "";
  }
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The name to greet. Comes from the account that is actually signed in:
 * the Google display name, else the email local-part, title-cased.
 * Guests get no name at all — never somebody else's.
 */
function displayNameFor(user: { name?: string | null; email?: string | null } | null): string {
  if (!user) return "";
  const raw = (user.name || "").trim() || (user.email || "").split("@")[0] || "";
  if (!raw) return "";
  const cleaned = raw.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  const first = cleaned.split(" ")[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function RevengeStudio() {
  const [theme, setTheme] = useState<"claude-dark" | "claude-light">(
    "claude-dark"
  );
  const [isDesktop, setIsDesktop] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [searchChat, setSearchChat] = useState("");
  const [menuConvId, setMenuConvId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const [selectedModelId, setSelectedModelId] = useState("revenge-omega-x");
  const [selectedPersonaId, setSelectedPersonaId] = useState("unchained");
  const [plusOpen, setPlusOpen] = useState(false);
  const [homePill, setHomePill] = useState<string | null>(null);

  const [arenaMode, setArenaMode] = useState(false);
  const [arenaModelBId, setArenaModelBId] = useState("revenge-coder-ultra");
  const [arenaReplyB, setArenaReplyB] = useState<ArenaSecondaryReply | null>(
    null
  );

  const [providers, setProviders] = useState<ProviderStatusItem[]>([]);
  const [settings, setSettings] = useState<AppSettingsRow>(DEFAULT_SETTINGS);
  const [memories, setMemories] = useState<MemoryRow[]>([]);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [imagineMode, setImagineMode] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [agentView, setAgentView] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shareInfo, setShareInfo] = useState<{ token: string; url: string } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});
  const [feedbackMap, setFeedbackMap] = useState<Record<string, "up" | "down">>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem("revenge-feedback") || "{}"); } catch { return {}; }
  });
  const [accent, setAccent] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("revenge-accent") || "ember" : "ember"
  );
  const handledPostRef = useRef<Set<string>>(new Set());
  const fuAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [autoOpenArtifacts, setAutoOpenArtifacts] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  const [expandedThoughts, setExpandedThoughts] = useState<
    Record<string, boolean>
  >({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const [artifact, setArtifact] = useState<CanvasArtifactPayload | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultTab, setVaultTab] = useState<VaultTab>("project");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [arsenalOpen, setArsenalOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [greeting, setGreeting] = useState("Welcome back");
  const [accountUser, setAccountUser] = useState<{ name?: string | null; email?: string | null } | null>(null);
  const [showJump, setShowJump] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const initialPrefsApplied = useRef(false);

  const activeModel = useMemo(
    () => getModelById(selectedModelId),
    [selectedModelId]
  );
  const activePersona = useMemo(
    () => PERSONAS.find((p) => p.id === selectedPersonaId) ?? PERSONAS[0],
    [selectedPersonaId]
  );
  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;

  const greetLine = useMemo(() => {
    const who = displayNameFor(accountUser);
    return who ? `${greeting}, ${who}` : greeting;
  }, [greeting, accountUser]);

  const threadArtifacts = useMemo(() => {
    const out: CanvasArtifactPayload[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && m.content) {
        out.push(...extractArtifactsFromMarkdown(m.content, m.id));
      }
    }
    return out;
  }, [messages]);

  /* ---------- boot / environment ---------- */

  useEffect(() => {
    setGreeting(timeGreeting());
    const saved = window.localStorage.getItem("revenge-theme");
    if (saved === "claude-light" || saved === "claude-dark") setTheme(saved);

    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadAccount = async () => {
      try {
        const res = await apiFetch("/api/auth/me");
        if (!res.ok) return;
        const data = (await res.json()) as {
          user?: { name?: string | null; email?: string | null } | null;
        };
        if (!cancelled) setAccountUser(data.user ?? null);
      } catch {
        /* stay signed out */
      }
    };
    void loadAccount();
    const onAuth = () => void loadAccount();
    window.addEventListener("revenge:auth-changed", onAuth);
    return () => {
      cancelled = true;
      window.removeEventListener("revenge:auth-changed", onAuth);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("revenge-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "claude-dark" ? "#262624" : "#faf9f5");
  }, [theme]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiFetch("/api/conversations");
      if (res.ok) {
        const data = (await res.json()) as { conversations?: ConversationRow[] };
        setConversations(data.conversations ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const res = await apiFetch("/api/providers");
      if (res.ok) {
        const data = (await res.json()) as { providers?: ProviderStatusItem[] };
        setProviders(data.providers ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadSettingsAndMemories = useCallback(async () => {
    try {
      const res = await apiFetch("/api/settings");
      if (!res.ok) return;
      const data = (await res.json()) as {
        settings?: AppSettingsRow;
        memories?: MemoryRow[];
      };
      if (data.settings) {
        setSettings(data.settings);
        if (!initialPrefsApplied.current) {
          initialPrefsApplied.current = true;
          setWebSearchEnabled(Boolean(data.settings.webSearchDefault));
          if (ALL_MODELS.some((m) => m.id === data.settings!.defaultModelId)) {
            setSelectedModelId(data.settings.defaultModelId);
          }
          if (PERSONAS.some((p) => p.id === data.settings!.defaultPersonaId)) {
            setSelectedPersonaId(data.settings.defaultPersonaId);
          }
        }
      }
      if (data.memories) setMemories(data.memories);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    void loadProviders();
    void loadSettingsAndMemories();
    void primeGuestScope();
  }, [loadConversations, loadProviders, loadSettingsAndMemories]);

  /* ---------- scrolling (sticky-bottom, no jitter) ---------- */

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = dist < 140;
    setShowJump(dist > 320);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, arenaReplyB]);

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  /* ---------- settings / conversations ---------- */

  const handleUpdateSettings = async (partial: Partial<AppSettingsRow>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        const data = (await res.json()) as { settings?: AppSettingsRow };
        if (data.settings) setSettings(data.settings);
      }
    } catch {
      /* ignore */
    }
  };

  const handleSelectModel = (id: string) => {
    setSelectedModelId(id);
    void handleUpdateSettings({ defaultModelId: id });
  };

  const handleSelectPersona = (id: string) => {
    setSelectedPersonaId(id);
    void handleUpdateSettings({ defaultPersonaId: id });
  };

  const closeMobileNav = () => setMobileNavOpen(false);

  const handleNewChat = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
    setActiveConvId(null);
    setMessages([]);
    setArenaReplyB(null);
    setArtifact(null);
    setInput("");
    setAttachments([]);
    setHomePill(null);
    stickRef.current = true;
    closeMobileNav();
  };

  /** Opens exactly the artifact object held in the thread so ids/versions stay in sync. */
  const openArtifact = (art: CanvasArtifactPayload) => {
    const match =
      threadArtifacts.find((a) => a.code === art.code) ||
      threadArtifacts.find((a) => a.title === art.title && a.language === art.language);
    setArtifact(match ?? art);
  };

  const handleSelectConversation = async (conv: ConversationRow) => {
    // Switching threads must be instant. Abort the stream and drop the old
    // partial assistant message instead of letting it finish in the background.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* already settled */ }
      abortRef.current = null;
    }
    setIsGenerating(false);
    setActiveConvId(conv.id);
    setSelectedModelId(conv.modelId || "revenge-omega-x");
    setSelectedPersonaId(conv.personaId || "unchained");
    setArenaReplyB(null);
    setArtifact(null);
    setMenuConvId(null);
    closeMobileNav();
    stickRef.current = true;

    try {
      const res = await apiFetch(`/api/conversations/${conv.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: UIMessage[] };
      const loaded = data.messages ?? [];
      setMessages(loaded);
      if (autoOpenArtifacts && window.innerWidth >= 1024) {
        const arts: CanvasArtifactPayload[] = [];
        for (const m of loaded) {
          if (m.role === "assistant" && m.content) {
            arts.push(...extractArtifactsFromMarkdown(m.content, m.id));
          }
        }
        const last = [...arts]
          .reverse()
          .find((a) => isPreviewableArtifact(a.language, a.code));
        if (last) setArtifact(last);
      }
    } catch {
      /* ignore */
    }
  };

  const handleClearAllConversations = async () => {
    await apiFetch("/api/conversations", { method: "DELETE" });
    setConversations([]);
    handleNewChat();
  };

  const handleDeleteConversation = async (id: string) => {
    setMenuConvId(null);
    await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) handleNewChat();
  };

  const handleTogglePin = async (conv: ConversationRow) => {
    setMenuConvId(null);
    await apiFetch(`/api/conversations/${conv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !conv.pinned }),
    });
    await loadConversations();
  };

  const handleSaveRename = async (id: string) => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title) return;
    await apiFetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await loadConversations();
  };

  /* ---------- Feature Lab flags, theme, shortcuts ---------- */

  const flags = useMemo(
    () => ({ ...DEFAULT_FLAGS, ...(settings.featureFlags ?? {}) }),
    [settings.featureFlags]
  );
  const flagsRef = useRef(flags);
  flagsRef.current = flags;
  const tempOn = Boolean(flags.temp_chat);

  const setFlag = (id: string, value: boolean) => {
    const next = { ...flagsRef.current, [id]: value };
    flagsRef.current = next;
    void handleUpdateSettings({ featureFlags: next });
  };
  const resetFlags = () => {
    const votes: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(flagsRef.current)) if (k.startsWith("vote_")) votes[k] = v;
    const next = { ...DEFAULT_FLAGS, ...votes };
    flagsRef.current = next;
    void handleUpdateSettings({ featureFlags: next });
  };
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  };
  const rateAnswer = (id: string, val: "up" | "down") => {
    setFeedbackMap((prev) => {
      const next = { ...prev, [id]: val };
      try { localStorage.setItem("revenge-feedback", JSON.stringify(next)); } catch {}
      return next;
    });
    showToast(val === "up" ? "Marked as a keeper" : "Feedback noted");
  };

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem("revenge-accent", accent); } catch {}
  }, [accent]);

  const isGenRef = useRef(false);
  isGenRef.current = isGenerating;
  const overlaysRef = useRef(false);
  overlaysRef.current = paletteOpen || shortcutsOpen || labOpen || Boolean(shareInfo) || plusOpen;
  const kbRef = useRef({ newChat: () => {}, toggleSidebar: () => {}, stop: () => {} });
  kbRef.current = {
    newChat: () => handleNewChat(),
    toggleSidebar: () => (isDesktop ? setSidebarOpen((v) => !v) : setMobileNavOpen((v) => !v)),
    stop: () => { abortRef.current?.abort(); setIsGenerating(false); },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); kbRef.current.newChat(); }
      else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); kbRef.current.toggleSidebar(); }
      else if (mod && e.key === "/") { e.preventDefault(); setShortcutsOpen((o) => !o); }
      else if (e.key === "Escape") {
        if (overlaysRef.current) {
          setPaletteOpen(false); setShortcutsOpen(false); setShareInfo(null); setPlusOpen(false); setLabOpen(false);
        } else if (isGenRef.current) {
          kbRef.current.stop();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- composer helpers ---------- */

  /** Shrinks photos to max 1280px JPEG (~150–300 KB) so they upload fast on mobile data. */
  const addImageFiles = async (files: File[]) => {
    const existingImages = attachments.filter((a) => a.content.startsWith("data:image/")).length;
    const room = Math.max(0, 4 - existingImages);
    if (room === 0) return;
    const loaded: AttachmentItem[] = [];
    for (const file of files.slice(0, room)) {
      const content = await compressImageFile(file);
      if (!content) continue;
      loaded.push({
        name: file.name && file.name !== "image.png" ? file.name : `Photo ${existingImages + loaded.length + 1}.jpg`,
        type: "image/jpeg",
        size: Math.round((content.length * 3) / 4),
        content,
      });
    }
    if (loaded.length > 0) setAttachments((prev) => [...prev, ...loaded]);
  };

  const processFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const others = files.filter((f) => !f.type.startsWith("image/")).slice(0, 6);
    if (images.length > 0) await addImageFiles(images);
    const loaded: AttachmentItem[] = [];
    for (const file of others) {
      const content = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => resolve("");
        reader.readAsText(file);
      });
      loaded.push({
        name: file.name,
        type: file.type || "text/plain",
        size: file.size,
        content: content.slice(0, 48000),
      });
    }
    if (loaded.length > 0) setAttachments((prev) => [...prev, ...loaded]);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImages = Array.from(e.clipboardData.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (pastedImages.length > 0) {
      e.preventDefault();
      void addImageFiles(pastedImages);
      return;
    }
    const text = e.clipboardData.getData("text/plain");
    if (text && text.split("\n").length >= 35) {
      e.preventDefault();
      setAttachments((prev) => [
        ...prev,
        {
          name: `Pasted text (${text.split("\n").length} lines)`,
          type: "text/plain",
          size: text.length,
          content: text.slice(0, 48000),
        },
      ]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    await processFiles(files);
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const win = window as unknown as {
      SpeechRecognition?: new () => MinimalSpeechRecognition;
      webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
    };
    const Rec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (evt) => {
      const t = evt.results?.[0]?.[0]?.transcript ?? "";
      if (t) setInput((prev) => (prev ? `${prev} ${t}` : t));
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  };

  const toggleSpeakMessage = (msg: UIMessage) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (speakingMsgId === msg.id) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const clean = msg.content
      .replace(/```[\s\S]*?```/g, " Code omitted. ")
      .replace(/[#*_`>\[\]()]/g, "");
    const u = new SpeechSynthesisUtterance(clean.slice(0, 3500));
    u.onend = () => setSpeakingMsgId(null);
    u.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msg.id);
    window.speechSynthesis.speak(u);
  };

  const fetchFollowUps = async (id: string, question: string, answer: string) => {
    if (!flagsRef.current.followups) return;
    if (answer.length < 180 || /^\s*!\[/.test(answer) || answer.includes("](/api/media/")) return;
    fuAbortRef.current?.abort();
    const ctrl = new AbortController();
    fuAbortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 16000);
    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          ephemeral: true,
          modelId: "keyless-omni-turbo",
          personaId: "concise",
          reasoningEffort: "off",
          maxTokens: 2048,
          message: `Suggest exactly 3 short follow-up questions (max 8 words each) the user could ask next. Reply with ONLY a JSON array of 3 strings, nothing else.\n\nUser asked: ${question.slice(0, 400)}\n\nAssistant answered: ${answer.slice(0, 900)}`,
        }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try { const ev = JSON.parse(l); if (ev.type === "content" && ev.text) text += ev.text; } catch {}
        }
      }
      let items: string[] = [];
      const m = text.match(/\[[\s\S]*\]/);
      if (m) { try { const arr = JSON.parse(m[0]); if (Array.isArray(arr)) items = arr.filter((x) => typeof x === "string"); } catch {} }
      if (items.length === 0) {
        items = text.split("\n").map((t) => t.replace(/^[\s\-*\d.)"]+|["\s]+$/g, "")).filter((t) => t.length > 6 && t.length < 90);
      }
      items = items.slice(0, 3).map((t) => t.slice(0, 90));
      if (items.length >= 2 && fuAbortRef.current === ctrl) {
        setFollowUps((prev) => ({ ...prev, [id]: items }));
      }
    } catch {} finally { clearTimeout(timer); }
  };

  const firePostAnswer = (id: string, content: string, question: string) => {
    if (handledPostRef.current.has(id)) return;
    handledPostRef.current.add(id);
    if (handledPostRef.current.size > 300) handledPostRef.current.clear();
    if (flagsRef.current.auto_speak && content) {
      toggleSpeakMessage({ id, role: "assistant", content } as UIMessage);
    }
    void fetchFollowUps(id, question, content);
  };

  /* ---------- compare (second model) ---------- */

  const launchArenaContenderB = async (
    promptText: string,
    signal: AbortSignal
  ) => {
    setArenaReplyB({
      modelId: arenaModelBId,
      content: "",
      providerUsed: "Connecting...",
      isStreaming: true,
    });
    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ephemeral: true,
          ephemeralHistory: messages
            .filter((m) => !m.isStreaming)
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content })),
          message: promptText,
          modelId: arenaModelBId,
          personaId: selectedPersonaId,
          reasoningEffort: "off",
          temperature: settings.temperature,
          maxTokens: Math.max(settings.maxTokens, 32768),
          autoFailover: settings.autoFailover,
        }),
        signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as {
            type: string;
            text?: string;
            providerUsed?: string;
          };
          if (evt.type === "meta" && evt.providerUsed) {
            setArenaReplyB((p) =>
              p ? { ...p, providerUsed: evt.providerUsed! } : p
            );
          } else if (evt.type === "content" && evt.text) {
            setArenaReplyB((p) =>
              p ? { ...p, content: p.content + evt.text! } : p
            );
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      setArenaReplyB((p) => (p ? { ...p, isStreaming: false } : p));
    }
  };

  /* ---------- streaming send ---------- */

  const sendPrompt = async (
    overrideText?: string,
    opts?: {
      skipSaveUserMessage?: boolean;
      targetConvId?: string | null;
      appendToAssistantId?: string | null;
    }
  ) => {
    const rawText = (overrideText ?? input).trim();
    const currentAttachments = opts?.skipSaveUserMessage ? [] : attachments;
    if ((!rawText && currentAttachments.length === 0) || isGenerating) return;

    const finalText =
      videoMode && !rawText.toLowerCase().startsWith("/video")
        ? `/video ${rawText}`
        : imagineMode && !rawText.toLowerCase().startsWith("/imagine")
        ? `/imagine ${rawText}`
        : rawText;

    if (!overrideText) {
      setInput("");
      setAttachments([]);
    }
    const styleBits: string[] = [];
    if (flags.len_short) styleBits.push("Keep answers tight — under 150 words unless code is required.");
    if (flags.len_detailed) styleBits.push("Be thorough — cover context, steps, trade-offs and edge cases.");
    if (flags.plain_format) styleBits.push("Plain style: no emojis, minimal headings, clean direct prose.");
    const stylePrompt = [settings.customSystemPrompt, styleBits.join(" ")].filter(Boolean).join("\n\n");
    const isTemp = tempOn && !opts?.appendToAssistantId;
    fuAbortRef.current?.abort();
    setFollowUps({});
    setPlusOpen(false);
    setHomePill(null);
    stickRef.current = true;

    const isAppending = Boolean(opts?.appendToAssistantId);
    const tempUserId = `user-${Date.now()}`;
    const targetId = opts?.appendToAssistantId || `assistant-${Date.now()}`;

    if (!opts?.skipSaveUserMessage && !isAppending) {
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: finalText,
          attachments: currentAttachments.length > 0 ? currentAttachments : null,
        },
      ]);
    }

    if (isAppending) {
      setMessages((prev) =>
        prev.map((m) => (m.id === targetId ? { ...m, isStreaming: true } : m))
      );
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: targetId,
          role: "assistant",
          content: "",
          reasoning: "",
          modelId: selectedModelId,
          providerUsed: "Connecting...",
          isStreaming: true,
          isThinking:
            settings.reasoningEffort !== "off" && activeModel.supportsReasoning,
        },
      ]);
      setExpandedThoughts((prev) => ({ ...prev, [targetId]: false }));
    }

    setIsGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Lets the catch block tell a user-initiated cancel apart from a failed
    // conversation switch, so the abort message only appears when it should.
    let abortedByNavigate = false;

    if (arenaMode && !isAppending) {
      void launchArenaContenderB(finalText, controller.signal);
    } else if (!isAppending) {
      setArenaReplyB(null);
    }

    let accumulated = isAppending
      ? messages.find((m) => m.id === targetId)?.content ?? ""
      : "";

    // Batch token updates to one React render per animation frame (smooth on phones)
    let pendingContent = "";
    let pendingReasoning = "";
    let rafId: number | null = null;
    const applyPending = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (!pendingContent && !pendingReasoning) return;
      const c = pendingContent;
      const r = pendingReasoning;
      pendingContent = "";
      pendingReasoning = "";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? {
                ...m,
                isThinking: c ? false : r ? true : m.isThinking,
                content: m.content + c,
                reasoning: (m.reasoning || "") + r,
              }
            : m
        )
      );
    };
    const queueFlush = () => {
      if (rafId === null) rafId = requestAnimationFrame(applyPending);
    };

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: isTemp
            ? null
            : opts?.targetConvId !== undefined ? opts.targetConvId : activeConvId,
          message: finalText,
          attachments: currentAttachments,
          modelId: selectedModelId,
          personaId: selectedPersonaId,
          enableWebSearch: webSearchEnabled,
          forceImageGen: imagineMode,
          forceVideoGen: videoMode,
          reasoningEffort: isAppending ? "off" : settings.reasoningEffort,
          temperature: settings.temperature,
          maxTokens: Math.max(settings.maxTokens, 32768),
          customSystemPrompt: stylePrompt,
          ...(isTemp
            ? {
                ephemeral: true,
                ephemeralHistory: messages
                  .filter((m) => !m.isStreaming)
                  .slice(-20)
                  .map((m) => ({ role: m.role, content: m.content })),
              }
            : {}),
          autoFailover: settings.autoFailover,
          skipSaveUserMessage: Boolean(opts?.skipSaveUserMessage) || isAppending,
          appendToAssistantId: opts?.appendToAssistantId ?? null,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let evt: {
            type: string;
            conversation?: ConversationRow;
            sources?: WebSourceItem[];
            providerUsed?: string;
            text?: string;
            imageUrl?: string;
            videoUrl?: string;
            executionId?: string;
            tool?: string;
            command?: string;
            exitCode?: number;
            durationMs?: number;
            stdout?: string;
            stderr?: string;
            error?: string;
            latencyMs?: number;
            reasoningMs?: number;
            tokensPerSec?: number;
            userMessageId?: string;
            assistantMessage?: UIMessage;
          };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.type === "conversation" && evt.conversation) {
            const conv = evt.conversation;
            setActiveConvId(conv.id);
            setConversations((prev) =>
              prev.some((c) => c.id === conv.id)
                ? prev.map((c) => (c.id === conv.id ? conv : c))
                : [conv, ...prev]
            );
          } else if (evt.type === "sources" && evt.sources) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, webSources: evt.sources, isSearching: false, researchAttempted: true }
                  : m
              )
            );
          } else if (evt.type === "searching") {
            const q = (evt as { query?: string }).query ?? null;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, isSearching: true, searchQuery: q, researchAttempted: true }
                  : m
              )
            );
          } else if (evt.type === "search_empty") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId ? { ...m, isSearching: false, researchAttempted: true } : m
              )
            );
          } else if (evt.type === "meta" && evt.providerUsed) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId ? { ...m, providerUsed: evt.providerUsed } : m
              )
            );
          } else if (evt.type === "reasoning" && evt.text && !isAppending) {
            pendingReasoning += evt.text;
            queueFlush();
          } else if (evt.type === "content" && evt.text) {
            accumulated += evt.text;
            pendingContent += evt.text;
            queueFlush();
          } else if (evt.type === "image" && evt.imageUrl) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId ? { ...m, imageUrl: evt.imageUrl } : m
              )
            );
          } else if (evt.type === "video" && evt.videoUrl) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId ? { ...m, videoUrl: evt.videoUrl } : m
              )
            );
          } else if (evt.type === "agent.thinking" && evt.text) {
            pendingReasoning += evt.text;
            queueFlush();
          } else if (evt.type === "tool.started") {
            const run: ChatToolRun = {
              executionId: evt.executionId || `exec_${Date.now()}`,
              tool: evt.tool || "execute_command",
              command: evt.command || "",
              status: "running",
              stdout: "",
              stderr: "",
              expanded: false,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, isThinking: false, toolRuns: [...(m.toolRuns ?? []), run] }
                  : m
              )
            );
          } else if (evt.type === "tool.stdout" || evt.type === "tool.stderr") {
            const key = evt.type === "tool.stdout" ? "stdout" : "stderr";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? {
                      ...m,
                      toolRuns: (m.toolRuns ?? []).map((r) =>
                        r.executionId === evt.executionId
                          ? { ...r, [key]: (r[key] + (evt.text ?? "")).slice(-15000) }
                          : r
                      ),
                    }
                  : m
              )
            );
          } else if (evt.type === "tool.completed" || evt.type === "tool.failed") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? {
                      ...m,
                      toolRuns: (m.toolRuns ?? []).map((r) =>
                        r.executionId === evt.executionId
                          ? {
                              ...r,
                              status: evt.type === "tool.completed" ? "success" : "failed",
                              exitCode: evt.exitCode,
                              durationMs: evt.durationMs,
                              stdout: typeof evt.stdout === "string" ? evt.stdout : r.stdout,
                              stderr: typeof evt.stderr === "string" ? evt.stderr : r.stderr,
                            }
                          : r
                      ),
                    }
                  : m
              )
            );
          } else if (evt.type === "done") {
            applyPending();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? {
                      ...m,
                      isStreaming: false,
                      isThinking: false,
                      isSearching: false,
                      providerUsed: evt.providerUsed || m.providerUsed,
                      latencyMs: evt.latencyMs,
                      reasoningMs: evt.reasoningMs,
                      tokensPerSec: evt.tokensPerSec,
                    }
                  : m
              )
            );

            if (isTemp) firePostAnswer(targetId, accumulated, rawText);

            // Desktop: auto-open the Artifact panel. Phone: show tappable card instead.
            if (autoOpenArtifacts && window.innerWidth >= 1024) {
              const extracted = extractArtifactsFromMarkdown(accumulated, targetId);
              const best =
                [...extracted]
                  .reverse()
                  .find((a) => isPreviewableArtifact(a.language, a.code)) ||
                extracted[extracted.length - 1];
              if (
                best &&
                isPreviewableArtifact(best.language, best.code)
              ) {
                setArtifact(best);
              }
            }
          } else if (evt.type === "saved" && evt.assistantMessage) {
            applyPending();
            const savedMsg = evt.assistantMessage;
            setFollowUps((prev) => {
              const cur = prev[targetId];
              if (!cur) return prev;
              const next = { ...prev };
              delete next[targetId];
              next[savedMsg.id] = cur;
              return next;
            });
            firePostAnswer(savedMsg.id, savedMsg.content || accumulated, rawText);
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id === tempUserId && evt.userMessageId) {
                  return { ...m, id: evt.userMessageId };
                }
                if (m.id === targetId) {
                  return {
                    ...savedMsg,
                    role: "assistant",
                    isStreaming: false,
                    isThinking: false,
                  };
                }
                return m;
              })
            );
            void loadConversations();
          } else if (evt.type === "error") {
            applyPending();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? {
                      ...m,
                      isStreaming: false,
                      isThinking: false,
                      content:
                        m.content ||
                        `Something went wrong: ${evt.error}\n\nTry another model from the model picker, or check your key in Settings.`,
                    }
                  : m
              )
            );
          }
        }
      }
    } catch (err) {
      applyPending();
      const aborted = (err as Error)?.name === "AbortError";
      const msg = err instanceof Error ? err.message : "Network error";
      // A conversation switch already replaced the thread; never paint an
      // error into the newly opened chat.
      if (aborted) {
        abortRef.current = null;
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? {
                ...m,
                isStreaming: false,
                isThinking: false,
                content: aborted
                  ? m.content
                  : m.content || `Connection problem: ${msg}`,
              }
            : m
        )
      );
    } finally {
      applyPending();
      setIsGenerating(false);
      if (imagineMode) setImagineMode(false);
      if (videoMode) setVideoMode(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsGenerating(false);
  };

  const handleContinue = async (msg: UIMessage) => {
    if (isGenerating) return;
    const tail = msg.content.slice(-1200);
    await sendPrompt(
      `Continue exactly where your previous output ended. Do not repeat earlier text or add an intro.\n\n<<<TAIL>>>\n${tail}\n<<<END_TAIL>>>`,
      {
        skipSaveUserMessage: true,
        targetConvId: tempOn ? null : activeConvId,
        appendToAssistantId: tempOn ? null : msg.id.startsWith("assistant-") ? null : msg.id,
      }
    );
  };

  const handleRegenerate = async (assistantMsgId: string) => {
    if (isGenerating) return;
    const idx = messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prevUser = [...messages.slice(0, idx)]
      .reverse()
      .find((m) => m.role === "user");
    if (!prevUser) return;
    if (activeConvId && !assistantMsgId.startsWith("assistant-")) {
      await apiFetch(`/api/conversations/${activeConvId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "truncateFrom", messageId: assistantMsgId }),
      });
    }
    setMessages((prev) => prev.slice(0, idx));
    await sendPrompt(prevUser.content, {
      skipSaveUserMessage: true,
      targetConvId: activeConvId,
    });
  };

  const handleSubmitEdit = async (msgId: string) => {
    if (!editingDraft.trim() || isGenerating) return;
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    if (activeConvId && !msgId.startsWith("user-")) {
      await apiFetch(`/api/conversations/${activeConvId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "truncateFrom", messageId: msgId }),
      });
    }
    const text = editingDraft.trim();
    setEditingMsgId(null);
    setMessages((prev) => prev.slice(0, idx));
    await sendPrompt(text, { targetConvId: activeConvId });
  };

  const handleFork = async (messageId: string) => {
    if (!activeConvId) return;
    const res = await apiFetch(`/api/conversations/${activeConvId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fork", messageId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { conversation?: ConversationRow };
      await loadConversations();
      if (data.conversation) await handleSelectConversation(data.conversation);
    }
  };

  const handleToggleBookmark = async (messageId: string) => {
    if (!activeConvId || messageId.startsWith("assistant-")) return;
    const res = await apiFetch(`/api/conversations/${activeConvId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggleBookmark", messageId }),
    });
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, bookmarked: !m.bookmarked } : m
        )
      );
    }
  };

  const handleShare = async () => {
    if (!activeConvId || shareBusy) return;
    setShareBusy(true);
    try {
      const res = await apiFetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConvId }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || "Share failed"); return; }
      setShareInfo({ token: d.token, url: `${window.location.origin}${d.path}` });
    } catch { showToast("Share failed — check connection"); } finally { setShareBusy(false); }
  };
  const handleRevokeShare = async () => {
    if (!shareInfo) return;
    try {
      await apiFetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: shareInfo.token }),
      });
    } catch {}
    setShareInfo(null);
    showToast("Share link revoked");
  };

  const handleExport = () => {
    if (messages.length === 0) return;
    const md = [
      `# ${activeConv?.title || "REVENGE GPT conversation"}`,
      `> Built by ${CREATOR_NAME} · ${activeModel.name}`,
      "",
      ...messages.map((m) => {
        const head = m.role === "user" ? "## You" : "## REVENGE GPT";
        const th = m.reasoning
          ? `\n<details><summary>Thought process</summary>\n\n${m.reasoning}\n\n</details>\n`
          : "";
        return `${head}\n${th}\n${m.content}\n`;
      }),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([md], { type: "text/markdown;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "revenge-gpt-chat.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openVault = (tab: VaultTab) => {
    setVaultTab(tab);
    setVaultOpen(true);
    closeMobileNav();
    setPlusOpen(false);
  };

  const paletteActions: PaletteAction[] = [
    { id: "new", label: "New chat", hint: "⌘⇧O", run: () => handleNewChat() },
    { id: "lab", label: "Open Feature Lab", run: () => setLabOpen(true) },
    { id: "temp", label: tempOn ? "Turn off temporary chat" : "Turn on temporary chat", run: () => setFlag("temp_chat", !tempOn) },
    { id: "theme", label: theme === "claude-dark" ? "Switch to light theme" : "Switch to dark theme", run: () => setTheme((t) => (t === "claude-dark" ? "claude-light" : "claude-dark")) },
    { id: "keys", label: "Models & API keys", run: () => openVault("vault") },
    { id: "shortcuts", label: "Keyboard shortcuts", hint: "⌘/", run: () => setShortcutsOpen(true) },
  ];

  const slashMatches = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    return PROMPT_ARSENAL.filter((p) =>
      p.slash.startsWith(input.toLowerCase())
    ).slice(0, 5);
  }, [input]);

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchChat.toLowerCase())
  );
  const starred = filtered.filter((c) => c.pinned);
  const recents = filtered.filter((c) => !c.pinned);
  const thinkingOn = settings.reasoningEffort !== "off";
  const canSend = Boolean(input.trim()) || attachments.length > 0;
  const speechSupported =
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown })
          .webkitSpeechRecognition
    );

  /* ---------- sidebar ---------- */

  const sidebarExpanded = isDesktop ? sidebarOpen : true;

  const renderConvRow = (conv: ConversationRow) => {
    const active = conv.id === activeConvId;
    return (
      <div key={conv.id} className="relative group">
        <div
          onClick={() => void handleSelectConversation(conv)}
          className={`flex items-center justify-between gap-1 pl-3 pr-1 h-9 rounded-lg text-[13.5px] cursor-pointer transition ${
            active
              ? "bg-[var(--bg-elevated-2)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          }`}
        >
          {renamingId === conv.id ? (
            <input
              autoFocus
              value={renameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => void handleSaveRename(conv.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveRename(conv.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
              className="w-full bg-[var(--bg-main)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-sm text-[var(--text-primary)] focus:outline-none"
            />
          ) : (
            <span className="truncate">{conv.title}</span>
          )}
          <button
            type="button"
            aria-label="Chat options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuConvId((id) => (id === conv.id ? null : conv.id));
            }}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-main)] md:opacity-0 md:group-hover:opacity-100 shrink-0 cursor-pointer"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {menuConvId === conv.id && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuConvId(null)}
            />
            <div className="absolute right-1 top-9 z-20 w-40 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-xl p-1">
              <button
                type="button"
                onClick={() => void handleTogglePin(conv)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] cursor-pointer"
              >
                <Star
                  className={`w-4 h-4 ${conv.pinned ? "fill-current text-[var(--accent)]" : ""}`}
                />
                {conv.pinned ? "Unstar" : "Star"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuConvId(null);
                  setRenamingId(conv.id);
                  setRenameDraft(conv.title);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] cursor-pointer"
              >
                <Edit3 className="w-4 h-4" /> Rename
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteConversation(conv.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-red-400 hover:bg-[var(--bg-elevated-2)] cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const navBtn =
    "w-full flex items-center gap-3 px-3 h-10 rounded-lg text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition cursor-pointer";

  const sidebar = (
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-[300px] max-w-[85vw] transform transition-transform duration-200 ${
        mobileNavOpen ? "translate-x-0" : "-translate-x-full"
      } md:static md:translate-x-0 md:max-w-none ${
        sidebarExpanded ? "md:w-[288px]" : "md:w-[56px]"
      } bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col shrink-0 safe-top`}
    >
      <div className="h-14 px-3 flex items-center justify-between shrink-0">
        {sidebarExpanded ? (
          <>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex items-center gap-2 cursor-pointer min-w-0"
            >
              <SparkIcon size={20} className="text-[var(--accent)] shrink-0" />
              <span className="font-claude-serif text-[19px] text-[var(--text-primary)] tracking-tight truncate">
                REVENGE GPT
              </span>
            </button>
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={() => {
                if (isDesktop) setSidebarOpen(false);
                else closeMobileNav();
              }}
              className="p-2 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
            >
              {isDesktop ? <PanelLeft className="w-[18px] h-[18px]" /> : <X className="w-5 h-5" />}
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
            className="mx-auto p-2 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
          >
            <PanelLeft className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>

      <div className="px-2 space-y-0.5 shrink-0">
        <button
          type="button"
          onClick={handleNewChat}
          title="New chat"
          className={`${navBtn} ${!sidebarExpanded ? "justify-center px-0" : ""}`}
        >
          <span className="w-6 h-6 rounded-full bg-[var(--accent)] text-white flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 stroke-[2.5]" />
          </span>
          {sidebarExpanded && <span className="font-medium">New chat</span>}
        </button>
        <button
          type="button"
          onClick={() => openVault("project")}
          title="Projects & instructions"
          className={`${navBtn} text-[var(--text-secondary)] ${!sidebarExpanded ? "justify-center px-0" : ""}`}
        >
          <FolderKanban className="w-[18px] h-[18px] shrink-0" />
          {sidebarExpanded && <span>Projects</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            closeMobileNav();
            setArtifact(
              artifact
                ? null
                : threadArtifacts[threadArtifacts.length - 1] || DEMO_ARTIFACT
            );
          }}
          title="Artifacts"
          className={`${navBtn} text-[var(--text-secondary)] ${!sidebarExpanded ? "justify-center px-0" : ""}`}
        >
          <Layers className="w-[18px] h-[18px] shrink-0" />
          {sidebarExpanded && (
            <>
              <span className="flex-1 text-left">Artifacts</span>
              {threadArtifacts.length > 0 && (
                <span className="text-[11px] px-1.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  {threadArtifacts.length}
                </span>
              )}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setLabOpen(true); closeMobileNav(); }}
          title="Feature Lab"
          className={`${navBtn} text-[var(--text-secondary)] ${!sidebarExpanded ? "justify-center px-0" : ""}`}
        >
          <FlaskConical className="w-[18px] h-[18px] shrink-0 text-[var(--accent)]" />
          {sidebarExpanded && (
            <>
              <span className="flex-1 text-left">Feature Lab</span>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/40 font-bold">NEW</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setAgentView(true);
            closeMobileNav();
          }}
          title="Agent Mode — autonomous coding with real cloud execution"
          className={`${navBtn} text-[var(--text-secondary)] ${!sidebarExpanded ? "justify-center px-0" : ""}`}
        >
          <Bot className="w-[18px] h-[18px] shrink-0 text-emerald-400" />
          {sidebarExpanded && (
            <>
              <span className="flex-1 text-left">Agent Mode</span>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/40 font-bold">E2B</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => openVault("vault")}
          title="Models & API keys"
          className={`${navBtn} text-[var(--text-secondary)] ${!sidebarExpanded ? "justify-center px-0" : ""}`}
        >
          <KeyRound className="w-[18px] h-[18px] shrink-0" />
          {sidebarExpanded && (
            <>
              <span className="flex-1 text-left">Models & keys</span>
              <span className="text-[11px] text-emerald-400">
                {KEYLESS_MODELS.length} free
              </span>
            </>
          )}
        </button>
      </div>

      {sidebarExpanded ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-3 pb-2 space-y-4">
          <div className="relative px-1">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchChat}
              onChange={(e) => setSearchChat(e.target.value)}
              placeholder="Search chats"
              className="w-full pl-8 pr-3 h-9 rounded-lg bg-[var(--bg-elevated)] border border-transparent focus:border-[var(--border-strong)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
          </div>

          {starred.length > 0 && (
            <div>
              <div className="px-3 pb-1 text-[12px] font-medium text-[var(--text-muted)]">
                Starred
              </div>
              <div className="space-y-0.5">{starred.map(renderConvRow)}</div>
            </div>
          )}

          <div>
            <div className="px-3 pb-1 text-[12px] font-medium text-[var(--text-muted)]">
              Recents
            </div>
            {recents.length === 0 ? (
              <div className="px-3 py-3 text-[13px] text-[var(--text-muted)]">
                Your chats will show up here.
              </div>
            ) : (
              <div className="space-y-0.5">{recents.map(renderConvRow)}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="p-2 border-t border-[var(--border-subtle)] shrink-0 safe-bottom">
        {sidebarExpanded ? (
          <div className="flex items-center gap-1">
            <div className="flex-1 min-w-0">
              <AccountMenu variant="sidebar" />
            </div>
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={() =>
                setTheme((t) => (t === "claude-dark" ? "claude-light" : "claude-dark"))
              }
              className="p-2.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] cursor-pointer"
            >
              {theme === "claude-dark" ? (
                <Sun className="w-[18px] h-[18px]" />
              ) : (
                <Moon className="w-[18px] h-[18px]" />
              )}
            </button>
          </div>
        ) : (
          <AccountMenu variant="sidebar" />
        )}
      </div>
    </aside>
  );

  /* ---------- composer (Claude layout) ---------- */

  const renderComposer = (home: boolean) => (
    <div className="w-full relative">
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-xl overflow-hidden z-30">
          {slashMatches.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setInput(item.prompt)}
              className="w-full px-4 py-3 text-left hover:bg-[var(--bg-elevated-2)] text-sm transition cursor-pointer"
            >
              <span className="font-mono text-[var(--accent)] mr-2">{item.slash}</span>
              <span className="text-[var(--text-primary)]">{item.title}</span>
            </button>
          ))}
        </div>
      )}

      {plusOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setPlusOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-30 w-[min(20rem,calc(100vw-2rem))] max-h-[70dvh] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl p-1.5">
            <button
              type="button"
              onClick={() => {
                setPlusOpen(false);
                fileInputRef.current?.click();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] cursor-pointer"
            >
              <FileText className="w-[18px] h-[18px] text-[var(--text-secondary)]" />
              Add files or photos
            </button>
            <button
              type="button"
              onClick={() => {
                setPlusOpen(false);
                cameraInputRef.current?.click();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] cursor-pointer"
            >
              <Camera className="w-[18px] h-[18px] text-[var(--text-secondary)]" />
              Take a photo
            </button>
            {(
              [
                {
                  label: "Web search",
                  icon: Globe,
                  on: webSearchEnabled,
                  toggle: () => setWebSearchEnabled((v) => !v),
                },
                {
                  label: "Create a video",
                  icon: Film,
                  on: videoMode,
                  toggle: () => {
                    setVideoMode((v) => {
                      if (!v) setImagineMode(false);
                      return !v;
                    });
                  },
                },
                {
                  label: "Create an image",
                  icon: ImageIcon,
                  on: imagineMode,
                  toggle: () => {
                    setImagineMode((v) => {
                      if (!v) setVideoMode(false);
                      return !v;
                    });
                  },
                },
                {
                  label: "Compare with another model",
                  icon: Swords,
                  on: arenaMode,
                  toggle: () => setArenaMode((v) => !v),
                },
                {
                  label: "Auto-open Artifacts",
                  icon: Layers,
                  on: autoOpenArtifacts,
                  toggle: () => setAutoOpenArtifacts((v) => !v),
                },
              ] as const
            ).map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  type="button"
                  onClick={it.toggle}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] cursor-pointer"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="w-[18px] h-[18px] text-[var(--text-secondary)]" />
                    {it.label}
                  </span>
                  <span
                    className={`w-9 h-5 rounded-full relative transition ${
                      it.on ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        it.on ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
              );
            })}

            {arenaMode && (
              <div className="px-3 pb-2">
                <select
                  value={arenaModelBId}
                  onChange={(e) => setArenaModelBId(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none"
                >
                  {ALL_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.shortName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="my-1.5 border-t border-[var(--border-subtle)]" />
            <div className="px-3 pt-1 pb-1 text-[11.5px] font-medium text-[var(--text-muted)]">
              Use style
            </div>
            {PERSONAS.map((p) => {
              const active = p.id === selectedPersonaId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    handleSelectPersona(p.id);
                    setPlusOpen(false);
                  }}
                  className="w-full flex items-start justify-between gap-2 px-3 py-2 rounded-xl text-left hover:bg-[var(--bg-elevated-2)] cursor-pointer"
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] text-[var(--text-primary)]">
                      {p.emoji} {p.name}
                    </span>
                    <span className="block text-[12px] text-[var(--text-muted)] leading-snug">
                      {p.tagline}
                    </span>
                  </span>
                  {active && (
                    <Check className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
            <div className="my-1.5 border-t border-[var(--border-subtle)]" />
            <button
              type="button"
              onClick={() => {
                setPlusOpen(false);
                setArsenalOpen(true);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated-2)] cursor-pointer"
            >
              <Sparkles className="w-[18px] h-[18px] text-[var(--text-secondary)]" />
              Prompt library
            </button>
          </div>
        </>
      )}

      <div
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files?.length) {
            e.preventDefault();
            setDragActive(false);
            void processFiles(Array.from(e.dataTransfer.files));
          }
        }}
        className={`rounded-[22px] bg-[var(--bg-elevated)] claude-composer-shadow focus-within:shadow-[0_0.25rem_1.25rem_rgba(0,0,0,0.2),0_0_0_1px_var(--border-strong)] transition ${
          dragActive ? "ring-2 ring-[var(--accent)]" : ""
        }`}
      >
        {dragActive && (
          <div className="px-4 pt-3 text-[13px] text-[var(--accent)]">
            Drop photos or files to attach
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {attachments.map((att, idx) =>
              att.content.startsWith("data:image/") ? (
                <div
                  key={idx}
                  className="relative w-16 h-16 rounded-xl overflow-hidden border border-[var(--border-subtle)] shrink-0 bg-[var(--bg-main)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={att.content}
                    alt={att.name}
                    onClick={() => setLightboxSrc(att.content)}
                    className="w-full h-full object-cover cursor-zoom-in"
                  />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
              <div
                key={idx}
                className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] shrink-0"
              >
                <FileText className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-[12.5px] text-[var(--text-primary)] max-w-[150px] truncate">
                  {att.name}
                </span>
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              )
            )}
          </div>
        )}

        <div className="px-4 pt-3.5">
          <textarea
            ref={textareaRef}
            rows={home ? 2 : 1}
            value={input}
            onPaste={handlePaste}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && isDesktop) {
                e.preventDefault();
                void sendPrompt();
              }
            }}
            placeholder={
              attachments.some((a) => a.content.startsWith("data:image/"))
                ? "Ask anything about this photo…"
                : videoMode || activeModel.supportsVideoGen
                ? "Describe the AI video scene you want to generate..."
                : imagineMode || activeModel.supportsImageGen
                ? "Describe the image you want..."
                : home
                ? "How can I help you today?"
                : "Reply to REVENGE..."
            }
            className="w-full bg-transparent text-[16px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none resize-none max-h-[200px]"
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-0.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.html,.css,.sql,.rs,.go,.yml,.yaml,image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              aria-label="Add and tools"
              onClick={() => setPlusOpen((o) => !o)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center border transition cursor-pointer ${
                plusOpen
                  ? "bg-[var(--bg-elevated-2)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated-2)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Plus className={`w-5 h-5 transition ${plusOpen ? "rotate-45" : ""}`} />
            </button>
            <button
              type="button"
              aria-label="Extended thinking"
              onClick={() =>
                void handleUpdateSettings({
                  reasoningEffort: thinkingOn ? "off" : "high",
                })
              }
              className={`h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[13px] border transition cursor-pointer ${
                thinkingOn
                  ? "bg-[var(--accent-soft)] border-[var(--accent)]/30 text-[var(--accent)]"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated-2)]"
              }`}
            >
              <Clock className="w-[18px] h-[18px]" />
              {thinkingOn && <span className="hidden sm:inline">Extended thinking</span>}
            </button>
            {(webSearchEnabled || imagineMode || videoMode) && (
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--accent)] px-1.5">
                {webSearchEnabled && <Globe className="w-3.5 h-3.5" />}
                {imagineMode && <ImageIcon className="w-3.5 h-3.5" />}
                {videoMode && <Film className="w-3.5 h-3.5" />}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setModelPickerOpen(true)}
              className="h-9 px-2.5 rounded-lg flex items-center gap-1 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated-2)] hover:text-[var(--text-primary)] transition cursor-pointer min-w-0"
            >
              <span className="truncate max-w-[120px] sm:max-w-[200px]">
                {activeModel.shortName}
              </span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
            </button>

            {isGenerating ? (
              <button
                type="button"
                aria-label="Stop"
                onClick={handleStop}
                className="w-9 h-9 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center cursor-pointer shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : !canSend && speechSupported ? (
              <button
                type="button"
                aria-label="Voice input"
                onClick={toggleVoiceInput}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition cursor-pointer shrink-0 ${
                  isListening
                    ? "bg-[var(--accent)] text-white animate-pulse"
                    : "bg-[var(--accent)]/45 text-white"
                }`}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send"
                disabled={!canSend}
                onClick={() => void sendPrompt()}
                className="w-9 h-9 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--accent)]/40 text-white flex items-center justify-center transition cursor-pointer shrink-0"
              >
                <ArrowUp className="w-[18px] h-[18px] stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------- render ---------- */

  const homePillData = HOME_PILLS.find((p) => p.id === homePill) || null;

  if (agentView) {
    return (
      <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg-main)] text-[var(--text-primary)]">
        <AgentWorkspace
          initialModelId={selectedModelId}
          onExit={() => setAgentView(false)}
          onOpenKeys={() => openVault("vault")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg-main)] text-[var(--text-primary)]">
      {!isDesktop && mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/55"
          onClick={closeMobileNav}
        />
      )}
      {sidebar}

      <div className="flex-1 flex min-w-0 h-full">
        <main className="flex-1 flex flex-col min-w-0 h-full relative">
          {/* Header */}
          <header
            className="shrink-0 flex items-center justify-between gap-2 px-2.5 sm:px-4"
            style={{
              height: "calc(3.5rem + env(safe-area-inset-top))",
              paddingTop: "env(safe-area-inset-top)",
            }}
          >
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setMobileNavOpen(true)}
                className="md:hidden w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="px-2 min-w-0">
                <div className="text-[14.5px] font-medium text-[var(--text-primary)] truncate max-w-[52vw] md:max-w-[420px]">
                  {messages.length === 0 ? "New chat" : activeConv?.title || "Chat"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              {threadArtifacts.length > 0 && !artifact && (
                <button
                  type="button"
                  onClick={() =>
                    setArtifact(threadArtifacts[threadArtifacts.length - 1])
                  }
                  className="h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] cursor-pointer"
                >
                  <Layers className="w-4 h-4 text-[var(--accent)]" />
                  <span className="hidden sm:inline">Artifact</span>
                  <span className="text-[11px] text-[var(--accent)]">
                    {threadArtifacts.length}
                  </span>
                </button>
              )}
              <button
                type="button"
                aria-label="Temporary chat"
                title={tempOn ? "Temporary chat is ON — nothing is saved" : "Temporary chat (nothing saved)"}
                onClick={() => setFlag("temp_chat", !tempOn)}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition cursor-pointer ${
                  tempOn
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                }`}
              >
                <Ghost className="w-[18px] h-[18px]" />
              </button>
              <button
                type="button"
                aria-label="Search everything"
                title="Search everything (Ctrl/⌘ K)"
                onClick={() => setPaletteOpen(true)}
                className="hidden sm:flex w-10 h-10 rounded-lg items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                <Search className="w-[18px] h-[18px]" />
              </button>
              {activeConvId && !tempOn && messages.length > 0 && (
                <button
                  type="button"
                  aria-label="Share chat"
                  title="Share a read-only link"
                  onClick={() => void handleShare()}
                  disabled={shareBusy}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer disabled:opacity-50"
                >
                  <Share2 className="w-[18px] h-[18px]" />
                </button>
              )}
              {messages.length > 0 && (
                <button
                  type="button"
                  aria-label="Export chat"
                  onClick={handleExport}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <Download className="w-[18px] h-[18px]" />
                </button>
              )}
              <button
                type="button"
                aria-label="New chat"
                onClick={handleNewChat}
                className="md:hidden w-10 h-10 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                <SquarePen className="w-[18px] h-[18px]" />
              </button>
            </div>
          </header>

          {messages.length === 0 ? (
            /* ---------- HOME ---------- */
            <div className="flex-1 overflow-y-auto">
              <div className="min-h-full flex flex-col items-center justify-center px-4 pb-10 pt-4">
                <div className="w-full max-w-[680px] space-y-7">
                  <div className="flex items-center justify-center gap-3">
                    <SparkIcon size={34} className="text-[var(--accent)] shrink-0" />
                    <h1 className="font-claude-serif text-[30px] sm:text-[40px] leading-tight text-[var(--text-primary)] tracking-tight">
                      {greetLine}
                    </h1>
                  </div>

                  {renderComposer(true)}

                  {!homePillData ? (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {HOME_PILLS.map((p) => {
                        const Icon = p.icon;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setHomePill(p.id)}
                            className="h-9 px-3.5 rounded-full border border-[var(--border-subtle)] text-[13.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] flex items-center gap-2 transition cursor-pointer"
                          >
                            <Icon className="w-4 h-4" />
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                        <span>{homePillData.label}</span>
                        <button
                          type="button"
                          onClick={() => setHomePill(null)}
                          className="p-1 -mr-1 cursor-pointer hover:text-[var(--text-primary)]"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {homePillData.items.map((it, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setInput(it.prompt);
                            setHomePill(null);
                            textareaRef.current?.focus();
                          }}
                          className="w-full text-left px-4 py-3 text-[14px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border-b last:border-b-0 border-[var(--border-subtle)] transition cursor-pointer"
                        >
                          {it.title}
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="text-center text-[12px] text-[var(--text-muted)]">
                    Built by {CREATOR_NAME} · {KEYLESS_MODELS.length} free models, no key needed
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* ---------- CHAT ---------- */
            <>
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto overflow-x-hidden"
              >
                <div className="max-w-[760px] mx-auto px-4 sm:px-6 pt-2 pb-6 space-y-6">
                  {messages.map((msg) => {
                    if (msg.role === "user") {
                      return (
                        <div key={msg.id} className="group">
                          <div className="flex items-start gap-3">
                            <span className="w-7 h-7 rounded-full bg-[var(--text-primary)] text-[var(--bg-main)] flex items-center justify-center text-[11.5px] font-semibold shrink-0 mt-1">
                              I
                            </span>
                            <div className="min-w-0 flex-1 rounded-2xl bg-[var(--bg-user-msg)] px-4 py-3">
                              {msg.attachments?.some((a) => a.content?.startsWith("data:image/")) && (
                                <div className="flex flex-wrap gap-2 mb-2">
                                  {msg.attachments
                                    .filter((a) => a.content?.startsWith("data:image/"))
                                    .map((att, i) => (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={i}
                                        src={att.content}
                                        alt={att.name}
                                        onClick={() => setLightboxSrc(att.content)}
                                        className="max-h-56 max-w-full sm:max-w-[260px] rounded-xl border border-[var(--border-subtle)] object-cover cursor-zoom-in"
                                      />
                                    ))}
                                </div>
                              )}
                              {msg.attachments && msg.attachments.some((a) => !a.content?.startsWith("data:image/")) && (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {msg.attachments.filter((a) => !a.content?.startsWith("data:image/")).map((att, i) => (
                                    <span
                                      key={i}
                                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)]"
                                    >
                                      <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />
                                      <span className="max-w-[160px] truncate">{att.name}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {editingMsgId === msg.id ? (
                                <div className="space-y-2">
                                  <textarea
                                    rows={4}
                                    value={editingDraft}
                                    onChange={(e) => setEditingDraft(e.target.value)}
                                    className="w-full p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--accent)] text-[16px] text-[var(--text-primary)] focus:outline-none"
                                  />
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setEditingMsgId(null)}
                                      className="px-3 h-9 rounded-lg bg-[var(--bg-elevated)] text-sm text-[var(--text-secondary)] cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleSubmitEdit(msg.id)}
                                      className="px-3 h-9 rounded-lg bg-[var(--accent)] text-sm font-medium text-white cursor-pointer"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[15.5px] text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
                                  {msg.content}
                                </div>
                              )}
                            </div>
                          </div>
                          {editingMsgId !== msg.id && (
                            <div className="flex items-center justify-end gap-1 mt-1 md:opacity-0 md:group-hover:opacity-100 transition">
                              <button
                                type="button"
                                aria-label="Edit"
                                onClick={() => {
                                  setEditingMsgId(msg.id);
                                  setEditingDraft(msg.content);
                                }}
                                className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                aria-label="Copy"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(msg.content);
                                  setCopiedMsgId(msg.id);
                                  setTimeout(() => setCopiedMsgId(null), 1400);
                                }}
                                className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                              >
                                {copiedMsgId === msg.id ? (
                                  <Check className="w-4 h-4 text-emerald-400" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }

                    const msgModel = msg.modelId ? getModelById(msg.modelId) : activeModel;
                    const hasThought = Boolean(msg.reasoning && msg.reasoning.trim());
                    const thoughtOpen = Boolean(expandedThoughts[msg.id]);
                    const iconBtn =
                      "p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition cursor-pointer";

                    return (
                      <div key={msg.id} className="space-y-3">
                        {(msg.researchAttempted || (msg.webSources && msg.webSources.length > 0)) && (
                          <ResearchWorkspace
                            key={msg.id}
                            messageId={msg.id}
                            query={msg.searchQuery || "Live web research"}
                            answer={msg.content}
                            sources={msg.webSources || []}
                            isSearching={msg.isSearching}
                            isStreaming={msg.isStreaming}
                            attempted={msg.researchAttempted}
                          />
                        )}

                        {(hasThought || msg.isThinking) && (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedThoughts((p) => ({ ...p, [msg.id]: !p[msg.id] }))
                              }
                              className="flex items-center gap-1.5 text-[13.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              <Clock
                                className={`w-4 h-4 ${msg.isThinking ? "animate-pulse text-[var(--accent)]" : ""}`}
                              />
                              <span>
                                {msg.isThinking
                                  ? "Thinking…"
                                  : `Thought process${
                                      msg.reasoningMs
                                        ? ` · ${(msg.reasoningMs / 1000).toFixed(1)}s`
                                        : ""
                                    }`}
                              </span>
                              {thoughtOpen ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {thoughtOpen && (
                              <div className="mt-2 ml-2 pl-4 border-l border-[var(--border-strong)] text-[13.5px] text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                                {msg.reasoning || "Planning…"}
                              </div>
                            )}
                          </div>
                        )}

                        {msg.videoUrl && (
                          <div className="my-2 rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-lg max-w-xl">
                            <video
                              src={msg.videoUrl}
                              controls
                              autoPlay
                              loop
                              muted
                              playsInline
                              className="w-full h-auto bg-black max-h-[420px]"
                            />
                            <div className="flex items-center justify-between px-3.5 py-2 text-xs text-[var(--text-secondary)] border-t border-[var(--border-subtle)]">
                              <span className="inline-flex items-center gap-1.5 truncate">
                                <Film className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                                AI Video Render (MP4)
                              </span>
                              <a
                                href={msg.videoUrl}
                                download="revenge-ai-video.mp4"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--accent)] font-medium ml-3 shrink-0 hover:underline"
                              >
                                Download MP4 ↗
                              </a>
                            </div>
                          </div>
                        )}

                        {(msg.toolRuns?.length ?? 0) > 0 && (
                          <div className="rounded-xl border border-[var(--border-subtle)] bg-[#141413] overflow-hidden">
                            <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                              Live execution
                            </div>
                            {msg.toolRuns!.map((run) => {
                              const ok = run.status === "success";
                              const running = run.status === "running";
                              return (
                                <div key={run.executionId} className="border-t border-[var(--border-subtle)]/60 first:border-t-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setMessages((prev) =>
                                        prev.map((m) =>
                                          m.id === msg.id
                                            ? {
                                                ...m,
                                                toolRuns: (m.toolRuns ?? []).map((r) =>
                                                  r.executionId === run.executionId
                                                    ? { ...r, expanded: !r.expanded }
                                                    : r
                                                ),
                                              }
                                            : m
                                        )
                                      )
                                    }
                                    className="w-full flex items-center gap-2 px-3 py-[7px] text-left cursor-pointer hover:bg-white/[0.03] transition"
                                  >
                                    <ChevronRight
                                      className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${run.expanded ? "rotate-90" : ""}`}
                                    />
                                    <span className="text-[13px] text-[var(--text-primary)]">
                                      Used {CHAT_TOOL_LABELS[run.tool] ?? run.tool}
                                    </span>
                                    {running ? (
                                      <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--text-muted)] border-t-transparent animate-spin" />
                                    ) : ok ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
                                    ) : (
                                      <X className="w-3.5 h-3.5 text-red-400" strokeWidth={3} />
                                    )}
                                    <span className={`text-[12px] font-mono ${running ? "text-[var(--text-muted)]" : ok ? "text-[var(--text-muted)]" : "text-red-400/90"}`}>
                                      {!ok && typeof run.exitCode === "number" ? `exit ${run.exitCode} ` : ""}
                                      {run.durationMs !== undefined ? `${run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`}` : running ? "running…" : ""}
                                    </span>
                                  </button>
                                  {run.expanded && (
                                    <div className="mx-2 mb-2 rounded-lg bg-black/40 border border-[var(--border-subtle)]/60 overflow-hidden">
                                      {run.command && (
                                        <div className="px-3 pt-2 pb-1 font-mono text-[11.5px] text-[var(--text-muted)] break-all">
                                          <span className="text-[var(--accent)]">$ </span>
                                          {run.command}
                                        </div>
                                      )}
                                      {run.stdout && (
                                        <pre className="px-3 py-1.5 font-mono text-[12px] leading-relaxed text-emerald-100/85 whitespace-pre-wrap break-words max-h-56 overflow-y-auto">
                                          {run.stdout}
                                        </pre>
                                      )}
                                      {run.stderr && (
                                        <pre className="px-3 py-1.5 font-mono text-[12px] leading-relaxed text-red-300/90 whitespace-pre-wrap break-words max-h-40 overflow-y-auto border-t border-[var(--border-subtle)]/60">
                                          {run.stderr}
                                        </pre>
                                      )}
                                      {!run.stdout && !run.stderr && (
                                        <div className="px-3 py-1.5 font-mono text-[11.5px] text-[var(--text-muted)]">
                                          {running ? "Waiting for output…" : "(no output)"}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {msg.content ? (
                          <MarkdownRenderer
                            content={msg.content}
                            serifProse
                            onOpenArtifact={openArtifact}
                          />
                        ) : msg.isStreaming && !msg.isThinking ? (
                          <SparkIcon size={20} className="text-[var(--accent)] animate-pulse" />
                        ) : null}

                        {flags.followups && (followUps[msg.id]?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {followUps[msg.id].map((sug, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => void sendPrompt(sug)}
                                className="fu-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3 text-[var(--accent)] shrink-0" />
                                {sug}
                              </button>
                            ))}
                          </div>
                        )}

                        {!msg.isStreaming && (
                          <div>
                            <div className="flex flex-wrap items-center gap-0.5 -ml-2">
                              <button
                                type="button"
                                aria-label="Copy"
                                title="Copy"
                                onClick={async () => {
                                  await navigator.clipboard.writeText(msg.content);
                                  setCopiedMsgId(msg.id);
                                  setTimeout(() => setCopiedMsgId(null), 1400);
                                }}
                                className={iconBtn}
                              >
                                {copiedMsgId === msg.id ? (
                                  <Check className="w-[17px] h-[17px] text-emerald-400" />
                                ) : (
                                  <Copy className="w-[17px] h-[17px]" />
                                )}
                              </button>
                              <button
                                type="button"
                                aria-label="Retry"
                                title="Retry"
                                onClick={() => void handleRegenerate(msg.id)}
                                className={iconBtn}
                              >
                                <RefreshCw className="w-[17px] h-[17px]" />
                              </button>
                              <button
                                type="button"
                                aria-label="Listen"
                                title="Listen"
                                onClick={() => toggleSpeakMessage(msg)}
                                className={iconBtn}
                              >
                                {speakingMsgId === msg.id ? (
                                  <VolumeX className="w-[17px] h-[17px] text-[var(--accent)]" />
                                ) : (
                                  <Volume2 className="w-[17px] h-[17px]" />
                                )}
                              </button>
                              {activeConvId && (
                                <button
                                  type="button"
                                  aria-label="Branch"
                                  title="Branch chat from here"
                                  onClick={() => void handleFork(msg.id)}
                                  className={iconBtn}
                                >
                                  <GitBranch className="w-[17px] h-[17px]" />
                                </button>
                              )}
                              <button
                                type="button"
                                aria-label="Bookmark"
                                title="Bookmark"
                                onClick={() => void handleToggleBookmark(msg.id)}
                                className={`${iconBtn} ${msg.bookmarked ? "!text-amber-400" : ""}`}
                              >
                                <Bookmark className="w-[17px] h-[17px]" />
                              </button>
                              {flags.feedback && (
                                <>
                                  <button
                                    type="button"
                                    aria-label="Good answer"
                                    title="Good answer"
                                    onClick={() => rateAnswer(msg.id, "up")}
                                    className={`${iconBtn} ${feedbackMap[msg.id] === "up" ? "!text-emerald-400" : ""}`}
                                  >
                                    <ThumbsUp className="w-[17px] h-[17px]" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Bad answer"
                                    title="Bad answer"
                                    onClick={() => rateAnswer(msg.id, "down")}
                                    className={`${iconBtn} ${feedbackMap[msg.id] === "down" ? "!text-[var(--accent)]" : ""}`}
                                  >
                                    <ThumbsDown className="w-[17px] h-[17px]" />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                title="Continue generating"
                                onClick={() => void handleContinue(msg)}
                                className="ml-1 h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-elevated)] transition cursor-pointer"
                              >
                                <ArrowDownToLine className="w-4 h-4" />
                                <span>Continue</span>
                              </button>
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <SparkIcon size={18} className="text-[var(--accent)]" />
                              <span className="text-[11.5px] text-[var(--text-muted)] truncate">
                                {msgModel.shortName}
                                {msg.tokensPerSec ? ` · ${msg.tokensPerSec} tok/s` : ""}
                                {msg.latencyMs ? ` · ${(msg.latencyMs / 1000).toFixed(1)}s` : ""}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {arenaMode && arenaReplyB && (
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[12.5px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1.5">
                          <Swords className="w-3.5 h-3.5 text-[var(--accent)]" />
                          Compared with {getModelById(arenaReplyB.modelId).shortName}
                        </span>
                        <span className="truncate max-w-[40%]">{arenaReplyB.providerUsed}</span>
                      </div>
                      <MarkdownRenderer
                        content={
                          arenaReplyB.content ||
                          (arenaReplyB.isStreaming ? "Generating…" : "")
                        }
                        serifProse
                        onOpenArtifact={openArtifact}
                      />
                    </div>
                  )}
                </div>
              </div>

              {showJump && (
                <button
                  type="button"
                  aria-label="Scroll to latest"
                  onClick={jumpToBottom}
                  className="absolute right-4 bottom-36 sm:bottom-32 w-9 h-9 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-lg flex items-center justify-center text-[var(--text-primary)] cursor-pointer z-10"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              )}

              <div className="shrink-0 px-3 sm:px-6 pt-1 safe-bottom bg-[var(--bg-main)]">
                <div className="max-w-[760px] mx-auto">
                  {tempOn && (
                    <div className="mb-2 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)]">
                      <Ghost className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                      <span className="truncate">Temporary chat — this conversation won't be saved.</span>
                      <button type="button" onClick={() => setFlag("temp_chat", false)} className="ml-auto text-[var(--accent)] font-medium cursor-pointer shrink-0">Turn off</button>
                    </div>
                  )}
                  {renderComposer(false)}
                  <p className="text-center text-[11.5px] text-[var(--text-muted)] py-1.5">
                    REVENGE GPT can make mistakes. Please double-check responses.
                  </p>
                </div>
              </div>
            </>
          )}
        </main>

        <ArtifactCanvasDrawer
          artifact={artifact}
          allArtifacts={threadArtifacts}
          onSelectArtifact={(art) => setArtifact(art)}
          onClose={() => setArtifact(null)}
          onChangeCode={(code) =>
            setArtifact((prev) => (prev ? { ...prev, code } : null))
          }
          onIteratePrompt={(instruction) => {
            setArtifact(null);
            void sendPrompt(instruction);
          }}
          isGenerating={isGenerating}
        />
      </div>

      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4 cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt="Attached photo"
            className="max-w-full max-h-full rounded-xl shadow-2xl"
          />
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightboxSrc(null)}
            className="absolute top-[max(env(safe-area-inset-top),1rem)] right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <FeatureLab
        open={labOpen}
        onClose={() => setLabOpen(false)}
        flags={flags}
        onFlag={setFlag}
        onResetFlags={resetFlags}
        accent={accent}
        onAccent={setAccent}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
        onOpenConversation={(id) => {
          const c = conversations.find((x) => x.id === id);
          if (c) void handleSelectConversation(c);
          else void handleSelectConversation({
            id, title: "Chat", modelId: selectedModelId, personaId: selectedPersonaId,
            pinned: false, folder: "General", systemPrompt: null, shareToken: null,
            createdAt: new Date(), updatedAt: new Date(),
          } as ConversationRow);
        }}
      />

      {shortcutsOpen && (
        <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/60 p-4" onClick={() => setShortcutsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="sheet-anim w-full max-w-sm rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[15px] font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                <Keyboard className="w-4 h-4 text-[var(--accent)]" /> Keyboard shortcuts
              </h3>
              <button type="button" aria-label="Close" onClick={() => setShortcutsOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            {[
              ["Search everything", "⌘/Ctrl + K"],
              ["New chat", "⌘/Ctrl + ⇧ + O"],
              ["Toggle sidebar", "⌘/Ctrl + B"],
              ["This cheat-sheet", "⌘/Ctrl + /"],
              ["Close panels · stop answer", "Esc"],
              ["Send message", "Enter"],
              ["New line", "⇧ + Enter"],
            ].map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)]/60 last:border-0">
                <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
                <kbd className="text-[11px] px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-primary)]">{keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}

      {shareInfo && (
        <div className="fixed inset-0 z-[86] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShareInfo(null)}>
          <div onClick={(e) => e.stopPropagation()} className="sheet-anim w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-2xl p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[15px] font-semibold flex items-center gap-2 text-[var(--text-primary)]">
                <Link2 className="w-4 h-4 text-[var(--accent)]" /> Share this chat
              </h3>
              <button type="button" aria-label="Close" onClick={() => setShareInfo(null)} className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated-2)] text-[var(--text-secondary)] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12.5px] text-[var(--text-muted)] mb-3">
              Anyone with the link can read this conversation. New messages appear on it automatically.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareInfo.url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={async () => { try { await navigator.clipboard.writeText(shareInfo.url); showToast("Link copied"); } catch {} }}
                className="px-3.5 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[12.5px] font-semibold cursor-pointer shrink-0"
              >
                Copy
              </button>
            </div>
            <div className="flex items-center justify-between mt-4">
              <a href={shareInfo.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-[var(--accent)] font-medium hover:underline">Open page ↗</a>
              <button type="button" onClick={() => void handleRevokeShare()} className="text-[12.5px] text-[var(--text-muted)] hover:text-[var(--accent)] cursor-pointer">Revoke link</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 rounded-xl bg-[var(--text-primary)] text-[var(--bg-main)] text-[12.5px] font-medium shadow-xl">
          {toast}
        </div>
      )}

      <UniversalVaultModal
        open={vaultOpen}
        initialTab={vaultTab}
        onClose={() => setVaultOpen(false)}
        providers={providers}
        onRefreshProviders={loadProviders}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        memories={memories}
        onRefreshSettingsAndMemories={loadSettingsAndMemories}
        selectedModelId={selectedModelId}
        onSelectModel={handleSelectModel}
        onClearAllConversations={handleClearAllConversations}
      />

      <ModelPickerModal
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        selectedModelId={selectedModelId}
        onSelectModel={handleSelectModel}
        providers={providers}
        onOpenVault={() => openVault("vault")}
      />

      <PromptArsenalModal
        open={arsenalOpen}
        onClose={() => setArsenalOpen(false)}
        onUsePrompt={(p, autoSend) => {
          if (autoSend) void sendPrompt(p);
          else setInput(p);
        }}
      />
    </div>
  );
}
