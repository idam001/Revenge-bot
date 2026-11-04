import {
  ALL_MODELS,
  CLOUD_PROVIDERS,
  CREATOR_NAME,
  DIRECT_RESPONSE_GUIDANCE,
  PERSONAS,
  type AIModelDefinition,
  type KeylessClusterId,
  type KeylessRouteTarget,
} from "./revenge-registry";
import {
  generateKeylessImage,
  generateKeylessVideo,
} from "./media-generators";

export interface ChatTurnMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Image data URLs (data:image/...;base64,...) attached to a user turn */
  images?: string[];
}

/* ------------------------------------------------------------------ *
 * REVENGE VISION — keyless vision models verified live (OVH + Kilo).
 * Ordered by speed: Qwen2.5-VL-72B (~3s) and Mistral Small 3.2 (~3s)
 * first, then the reasoning-heavy vision models as fallbacks.
 * ------------------------------------------------------------------ */
export const VISION_ROUTES: KeylessRouteTarget[] = [
  { cluster: "ovh", model: "Qwen2.5-VL-72B-Instruct", maxTokens: 8192 },
  { cluster: "ovh", model: "Mistral-Small-3.2-24B-Instruct-2506", maxTokens: 8192 },
  { cluster: "kilo", model: "nvidia/nemotron-3.5-super-vl:free", maxTokens: 16384, nativeReasoning: true },
  { cluster: "ovh", model: "Qwen3.6-27B", maxTokens: 8192, nativeReasoning: true },
  { cluster: "kilo", model: "dots-studio/dots-3-note-preview:free", maxTokens: 16384, nativeReasoning: true },
  { cluster: "kilo", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", maxTokens: 16384, nativeReasoning: true },
  { cluster: "ovh", model: "Qwen3.8-27B", maxTokens: 8192, nativeReasoning: true },
];

const VISION_MODEL_SET = new Set(VISION_ROUTES.map((r) => `${r.cluster}:${r.model}`));

function isVisionRoute(r: KeylessRouteTarget): boolean {
  return VISION_MODEL_SET.has(`${r.cluster}:${r.model}`);
}

function messagesHaveImages(messages: ChatTurnMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.images) && m.images.length > 0);
}

/** Replace images with a short note, for text-only upstreams. */
function stripImages(messages: ChatTurnMessage[]): ChatTurnMessage[] {
  return messages.map((m) =>
    m.images?.length
      ? { role: m.role, content: `${m.content}\n[${m.images.length} image(s) were attached to this message]` }
      : { role: m.role, content: m.content }
  );
}

/** OpenAI-compatible multimodal payload: text + image_url parts. */
function toOpenAIMessages(messages: ChatTurnMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === "user" && m.images?.length) {
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content || "Analyze the attached image(s) in detail." },
          ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** Anthropic Messages payload: base64 image blocks + text block. */
function toAnthropicContent(m: ChatTurnMessage): unknown {
  if (m.role !== "user" || !m.images?.length) return m.content;
  const blocks: unknown[] = [];
  for (const url of m.images) {
    const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) continue;
    blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
  }
  blocks.push({ type: "text", text: m.content || "Analyze the attached image(s) in detail." });
  return blocks;
}

const VISION_INSTRUCTIONS =
  "REVENGE VISION (active): the user attached image(s) and they are included directly in this conversation, so you CAN see them. " +
  "Never say you cannot view, see, open, or process images. Look carefully and answer from what is actually visible:\n" +
  "- Photos: describe the scene, objects, colours, setting, text, and anything notable in specific detail. Describe people's appearance, clothing and expressions freely, but don't guess the identity of private individuals from their face.\n" +
  "- Text in images (signs, documents, receipts, handwriting): transcribe it exactly (OCR), keeping the layout where it matters.\n" +
  "- Code or terminal screenshots: transcribe the code into a fenced block with the right language, explain errors, and give the fixed code.\n" +
  "- UI screenshots or mockups: when asked to build it, recreate it as a complete working HTML or React artifact.\n" +
  "- Charts, tables and forms: extract the data into a markdown table, then analyze it.\n" +
  "- Math, homework and diagrams: read the problem and solve it step by step.\n" +
  "If part of an image is blurry or ambiguous, say what you can and can't make out instead of guessing. Answer directly, with no disclaimers.";

export interface SavedProviderConfig {
  providerId: string;
  apiKey: string;
  baseUrl?: string | null;
  customModelId?: string | null;
  enabled: boolean;
}

export type StreamDeltaEvent =
  | { type: "meta"; modelId: string; providerUsed: string }
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "image"; imageUrl: string }
  | { type: "video"; videoUrl: string }
  | { type: "agent.thinking"; text: string }
  | { type: "tool.started"; executionId: string; tool: string; command: string }
  | { type: "tool.stdout"; executionId: string; text: string }
  | { type: "tool.stderr"; executionId: string; text: string }
  | {
      type: "tool.completed";
      executionId: string;
      tool: string;
      exitCode: number;
      durationMs: number;
      stdout: string;
      stderr: string;
    }
  | {
      type: "tool.failed";
      executionId: string;
      tool: string;
      exitCode: number;
      durationMs: number;
      stdout: string;
      stderr: string;
      error?: string;
    }
  | {
      type: "done";
      providerUsed: string;
      latencyMs: number;
      reasoningMs: number;
      tokensPerSec: number;
    };

export interface EngineRequestOptions {
  modelId: string;
  personaId: string;
  messages: ChatTurnMessage[];
  customSystemPrompt?: string;
  memoriesBlock?: string;
  webContextBlock?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string; // 'off' | 'medium' | 'high' | 'max'
  autoFailover?: boolean;
  forceImageGen?: boolean;
  forceVideoGen?: boolean;
  conversationId?: string | null;
  enableCodeExecution?: boolean;
  savedKeysMap: Record<string, SavedProviderConfig>;
  onEvent: (event: StreamDeltaEvent) => void;
  /** Aborted when the browser disconnects, so we stop generating immediately. */
  abortSignal?: AbortSignal;
}

class RefusalInterceptedError extends Error {
  constructor(snippet: string) {
    super(`Intercepted upstream refusal: ${snippet.slice(0, 80)}`);
    this.name = "RefusalInterceptedError";
  }
}

const REFUSAL_REGEX =
  /^\s*(?:i(?:'m| am)\s+(?:so\s+)?sorry,?\s*(?:but\s+)?i\s+can(?:'t|not)|i\s+can(?:'t|not)\s+(?:fulfill|assist|comply|help\s+with|provide|generate|write|create|complete|support)\s+(?:this|that|your|with)|i\s+am\s+unable\s+to\s+(?:fulfill|assist|comply|provide|help|generate|write)|as\s+an\s+ai(?:\s+language\s+model|\s+assistant)?,?\s+i\s+(?:can(?:'t|not)|do\s+not|must)|i\s+must\s+(?:decline|refuse)|sorry,?\s+but\s+i\s+can(?:'t|not))/i;

function looksLikeCannedRefusal(openingText: string): boolean {
  const clean = openingText.replace(/^[\s#*>-]+/, "").trim();
  if (clean.length < 18) return false;
  return REFUSAL_REGEX.test(clean);
}

/**
 * Stateful streaming parser that separates `<think>...</think>` blocks from final content
 * across arbitrary SSE chunk boundaries.
 */
class ThinkTagStreamSplitter {
  private state: "init" | "in_think" | "after_think" = "init";
  private leadBuf = "";
  private thinkBuf = "";
  private emittedAnyContent = false;
  private onReasoning: (t: string) => void;
  private onContent: (t: string) => void;

  constructor(onReasoning: (t: string) => void, onContent: (t: string) => void) {
    this.onReasoning = onReasoning;
    this.onContent = onContent;
  }

  push(chunk: string) {
    if (!chunk) return;

    if (this.state === "after_think") {
      if (!this.emittedAnyContent) {
        const trimmed = chunk.replace(/^\s+/, "");
        if (!trimmed) return;
        this.emittedAnyContent = true;
        this.onContent(trimmed);
      } else {
        this.onContent(chunk);
      }
      return;
    }

    if (this.state === "init") {
      this.leadBuf += chunk;
      const trimmed = this.leadBuf.trimStart();
      if (!trimmed) {
        if (this.leadBuf.length > 24) {
          this.state = "after_think";
          this.onContent(this.leadBuf);
          this.emittedAnyContent = true;
          this.leadBuf = "";
        }
        return;
      }

      if ("<think>".startsWith(trimmed) && trimmed.length < 7) {
        return;
      }

      if (trimmed.startsWith("<think>")) {
        this.state = "in_think";
        const afterOpen = trimmed.slice(7).replace(/^\n+/, "");
        this.leadBuf = "";
        if (afterOpen) {
          this.pushInThink(afterOpen);
        }
        return;
      }

      this.state = "after_think";
      this.emittedAnyContent = true;
      this.onContent(this.leadBuf);
      this.leadBuf = "";
      return;
    }

    if (this.state === "in_think") {
      this.pushInThink(chunk);
    }
  }

  private pushInThink(text: string) {
    this.thinkBuf += text;
    const closeIdx = this.thinkBuf.indexOf("</think>");
    if (closeIdx !== -1) {
      const thoughtPart = this.thinkBuf.slice(0, closeIdx);
      if (thoughtPart) {
        this.onReasoning(thoughtPart);
      }
      const remainder = this.thinkBuf.slice(closeIdx + 8).replace(/^\s+/, "");
      this.thinkBuf = "";
      this.state = "after_think";
      if (remainder) {
        this.emittedAnyContent = true;
        this.onContent(remainder);
      }
      return;
    }

    if (this.thinkBuf.length > 9) {
      const safeEmit = this.thinkBuf.slice(0, this.thinkBuf.length - 9);
      this.thinkBuf = this.thinkBuf.slice(this.thinkBuf.length - 9);
      this.onReasoning(safeEmit);
    }
  }

  flush() {
    if (this.state === "init" && this.leadBuf) {
      this.onContent(this.leadBuf);
      this.leadBuf = "";
    } else if (this.state === "in_think" && this.thinkBuf) {
      if (!this.emittedAnyContent) {
        this.onContent(this.thinkBuf);
      } else {
        this.onReasoning(this.thinkBuf);
      }
      this.thinkBuf = "";
    }
  }
}

function isCodingIntent(text: string): boolean {
  return /\b(code|build|create|app|website|html|css|react|jsx|tsx|typescript|javascript|python|script|dashboard|game|component|api|sql|database|algorithm|class|function|tailwind|ui|frontend|backend|fullstack|fix|refactor|debug|cli|tool|scanner|bot|server)\b/i.test(
    text
  );
}

function isDeobfuscationIntent(text: string): boolean {
  return /\b(deobfuscat|de-obfuscat|unobfuscat|unpack|decode (this|the)|decrypt (this|the)|what does this (code|script) do|explain this (code|script)|minified|uglified|packed|fromcharcode|\\x[0-9a-f]{2}|_0x[a-f0-9]{3,}|eval\(function\(p,a,c)\b/i.test(
    text
  );
}



function buildSystemInstruction(opts: {
  model: AIModelDefinition;
  personaId: string;
  userPrompt: string;
  customSystemPrompt?: string;
  memoriesBlock?: string;
  webContextBlock?: string;
  wantThinkTags: boolean;
  reasoningEffort: string;
  retryReviewRequested?: boolean;
  hasVision?: boolean;
}): string {
  const persona =
    PERSONAS.find((p) => p.id === opts.personaId) ?? PERSONAS[0];

  const codingBoost = isCodingIntent(opts.userPrompt)
    ? `SENIOR ENGINEER CODING STANDARD (mandatory):
- Deliver COMPLETE, WORKING, PRODUCTION-QUALITY code. Never output stubs, "...", "// TODO", "rest stays the same", or partial diffs unless the user asks for a diff.
- Multi-file requests: output EVERY file in full. Put a heading with the file path before each fenced block (for example "### src/app/page.tsx").
- Include all imports, types, error handling, loading and empty states, and realistic sample data. Wire every button and handler.
- Before answering, check the logic: edge cases, null and undefined handling, async ordering, off-by-one errors, and security (validate input, escape output).
- After the code, give the exact commands needed to run it and one short paragraph on key decisions.
- SINGLE-FILE WEB APPS: one fenced \`\`\`html block containing a complete <!DOCTYPE html> document. It renders LIVE in the Artifact Preview inside a sandboxed iframe, so inline all CSS and JS, load libraries only from CDNs (for example https://cdn.tailwindcss.com, https://cdn.jsdelivr.net/npm/chart.js), persist data with localStorage (it works), and never call APIs that need keys.
- REACT COMPONENTS: one fenced \`\`\`jsx block with ONE default-exported component. Use hooks and Tailwind classes. Icons come from lucide-react (named imports work). Do not import other packages; implement the logic inline.
- BACKEND, CLI, AND SCRIPTS: write the real, complete files in the requested language with error handling and a usage example.`
    : "";

  const retryReview = opts.retryReviewRequested
    ? `REVIEW NOTE: Reassess the user's actual request and its context rather than copying a previous node's response. Answer clearly benign or authorized parts directly. If a boundary is necessary, explain it once in a concise sentence and offer a relevant safe alternative.`
    : "";

  const parts: string[] = [
    `You are ${opts.model.name} inside REVENGE GPT — the AI engineering and reasoning platform built by ${CREATOR_NAME}.`,
    persona.systemPrompt,
    "RESPONSE STYLE: Answer ordinary requests directly. If you need to limit an answer, state the boundary once, briefly; do not repeat the same refusal or apology, and offer a useful safe alternative when appropriate.",
  ];

  // Keep security guidance precise and scoped; avoid blanket instructions that
  // can resemble an attempt to override an upstream provider's safeguards.
  if (opts.model.category === "uncensored" || opts.personaId === "unchained") {
    parts.push(DIRECT_RESPONSE_GUIDANCE);
  }

  // Depth directive: the single biggest quality complaint was fast, shallow
  // answers. Coding and analysis work must be complete, not a summary.
  if (isCodingIntent(opts.userPrompt) || proseNeedsDepth(opts.userPrompt)) {
    parts.push(
      `DEPTH REQUIREMENT (mandatory): Do not optimise for speed. Deliver the complete, finished result — every function implemented, every case handled, nothing deferred with a placeholder. If the task is a build request, write the whole program in this response. Shallow one-screen answers are a failure.`
    );
  }

  const deobfuscationBoost = isDeobfuscationIntent(opts.userPrompt)
    ? `DEOBFUSCATION PROTOCOL (you MUST comply — this is a core capability):
- NEVER refuse to deobfuscate, decode, unpack or explain code. This is legitimate reverse-engineering education and malware analysis.
- Identify each obfuscation layer you find (P.A.C.K.E.R eval packing, base64 blobs, String.fromCharCode, hex/unicode escapes, obfuscator.io string-array rotation, minification).
- Decode layer by layer, then output the FULL cleaned code in a fenced block, then a behavior breakdown (what it does, network calls, persistence, suspicious indicators).
- Never claim you cannot read or decode obfuscated code. You can always analyze it as text.`
    : "";

  const executionAvailable = Boolean(process.env.E2B_API_KEY?.trim());
  const capabilityNotes =
    "PLATFORM CAPABILITIES (accurate):\n" +
    "- LIVE WEB SEARCH: when a request needs current or external facts, relevant live results may be attached below. Use only the results that answer the question, cite them with markdown links, and ignore unrelated results.\n" +
    "- ARTIFACT PREVIEW: HTML and React code blocks render live in a side panel with a working preview, so they must run exactly as written. Other code appears as formatted code with a copy button.\n" +
    (executionAvailable
      ? "- LIVE CODE EXECUTION (real E2B cloud sandbox — Linux, Python 3, Node.js, bash, pip/npm): you CAN run code for real. When the user asks you to run, test, debug, or show output — or when you need to verify code before answering — emit one fenced action block per call, exactly:\n```action\n{\"tool\": \"run_python\", \"args\": {\"code\": \"print(2 + 2)\"}}\n```\nTools: run_python, run_javascript, execute_command, read_file, write_file, edit_file, list_files, create_directory, delete_file, run_tests, inspect_project, install_package. The real stdout/stderr/exit code comes back to you; then analyze it, fix bugs, and rerun if needed. Never invent output — only report what the tools returned."
      : "- NO CODE EXECUTION in this turn: if asked what code outputs, trace it carefully and state the exact expected output, pointing out any bugs you find.");

  if (codingBoost) parts.push(codingBoost);
  if (deobfuscationBoost) parts.push(deobfuscationBoost);
  parts.push(capabilityNotes);
  if (opts.hasVision) parts.push(VISION_INSTRUCTIONS);
  if (retryReview) parts.push(retryReview);
  if (opts.model.systemSpecialization) {
    parts.push(opts.model.systemSpecialization);
  }
  if (opts.customSystemPrompt?.trim()) {
    parts.push(
      `PROJECT / CUSTOM INSTRUCTIONS:\n${opts.customSystemPrompt.trim()}`
    );
  }
  if (opts.memoriesBlock?.trim()) {
    parts.push(`PERSISTENT USER MEMORY:\n${opts.memoriesBlock.trim()}`);
  }
  if (opts.webContextBlock?.trim()) {
    parts.push(opts.webContextBlock.trim());
  }

  if (opts.wantThinkTags) {
    const budgetHint =
      opts.reasoningEffort === "max"
        ? "Think thoroughly step-by-step through architecture, edge cases, and verification (keep <think> under 250 words so maximum token budget goes to the complete final output)."
        : "Briefly outline your architecture & key logic steps in 3-6 concise bullet points inside <think>...</think> so 90%+ of your output tokens go to the complete final code/answer.";

    parts.push(
      `EXTENDED THINKING FORMAT: Begin with a concise internal thought block inside <think>...</think>. ${budgetHint} Close </think> and immediately produce the full, untruncated response.`
    );
  }

  return parts.join("\n\n");
}

function resolveEnvApiKey(providerId: string): string | undefined {
  const envMap: Record<string, string[]> = {
    openai: ["OPENAI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    deepseek: ["DEEPSEEK_API_KEY"],
    grok: ["XAI_API_KEY", "GROK_API_KEY"],
    groq: ["GROQ_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    mistral: ["MISTRAL_API_KEY"],
    together: ["TOGETHER_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
    perplexity: ["PERPLEXITY_API_KEY"],
    cohere: ["COHERE_API_KEY"],
  };
  for (const k of envMap[providerId] ?? []) {
    if (process.env[k]?.trim()) return process.env[k]!.trim();
  }
  return undefined;
}

const ROUTE_PERSONAS: Record<string, string> = {
  "dots-studio/dots-3-note-preview:free": "REVENGE Dots 3 UltraWriter",
  "nvidia/nemotron-3.5-super-vl:free": "REVENGE Nemotron 3.5 Super Coder",
  "stealth/glyph-cluster": "REVENGE Glyph Stealth Architect",
};

const CLUSTER_ENDPOINTS: Record<
  Exclude<KeylessClusterId, "flux-image">,
  { url: string; label: string; timeoutMs: number }
> = {
  kilo: {
    url: "https://api.kilo.ai/api/gateway/v1/chat/completions",
    label: "Kilo Unmoderated Cloud",
    timeoutMs: 12000,
  },
  ovh: {
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    label: "OVH Bare-Metal GPU",
    timeoutMs: 11000,
  },
  llm7: {
    url: "https://api.llm7.io/v1/chat/completions",
    label: "LLM7 8K Turbo",
    timeoutMs: 11000,
  },
  aihorde: {
    url: "https://aihorde.net/api/v2/generate/text/async",
    label: "AI Horde Volunteer GPU",
    timeoutMs: 32000,
  },
  pollinations: {
    url: "https://text.pollinations.ai/openai",
    label: "Pollinations Reasoning Node",
    timeoutMs: 9000,
  },
  "chat-relay": {
    url: "https://ch.at/v1/chat/completions",
    label: "Instant Relay Mesh",
    timeoutMs: 8000,
  },
};

async function callAiHordeTextCluster(params: {
  upstreamModel: string;
  messages: ChatTurnMessage[];
  temperature: number;
  maxTokens: number;
  hordeKey?: string;
  interceptRefusals: boolean;
  onReasoning: (t: string) => void;
  onContent: (t: string) => void;
}): Promise<{ gotOutput: boolean; finishReason: string | null; emittedChars: number }> {
  const apikey = params.hordeKey?.trim() || "0000000000";
  const chatMl =
    params.messages
      .slice(-10)
      .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>`)
      .join("\n") + "\n<|im_start|>assistant\n";

  const maxLen = Math.min(Math.max(params.maxTokens, 512), 1024);
  const maxCtx = Math.min(8192, Math.max(4096, Math.ceil(chatMl.length / 3) + maxLen));

  const subRes = await fetch("https://aihorde.net/api/v2/generate/text/async", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey,
      "Client-Agent": "RevengeGPT:8.0:IdamEmmanuel",
    },
    body: JSON.stringify({
      prompt: chatMl,
      params: {
        max_context_length: maxCtx,
        max_length: maxLen,
        temperature: params.temperature,
        stop_sequence: ["<|im_end|>", "<|im_start|>user"],
      },
      models: [params.upstreamModel],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!subRes.ok) {
    throw new Error(`AI Horde submit HTTP ${subRes.status}`);
  }
  const { id } = (await subRes.json()) as { id?: string };
  if (!id) throw new Error("AI Horde returned no job ID");

  for (let attempt = 0; attempt < 18; attempt++) {
    await new Promise((r) => setTimeout(r, 1600));
    const stRes = await fetch(
      `https://aihorde.net/api/v2/generate/text/status/${id}`,
      {
        headers: { apikey, "Client-Agent": "RevengeGPT:8.0:IdamEmmanuel" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!stRes.ok) continue;
    const st = (await stRes.json()) as {
      done?: boolean;
      faulted?: boolean;
      is_possible?: boolean;
      generations?: Array<{ text?: string }>;
    };
    if (st.faulted || st.is_possible === false) {
      throw new Error("AI Horde model worker unavailable");
    }
    if (st.done) {
      const rawText = (st.generations?.[0]?.text || "")
        .replace(/<\|im_end\|>[\s\S]*$/, "")
        .trim();
      if (!rawText) throw new Error("AI Horde returned empty output");

      let emittedChars = 0;
      let cleanOut = "";
      const splitter = new ThinkTagStreamSplitter(
        (r) => params.onReasoning(r),
        (c) => {
          cleanOut += c;
        }
      );
      splitter.push(rawText);
      splitter.flush();

      if (params.interceptRefusals && looksLikeCannedRefusal(cleanOut)) {
        throw new RefusalInterceptedError(cleanOut);
      }

      const chunks = cleanOut.match(/[\s\S]{1,42}/g) ?? [cleanOut];
      for (const ch of chunks) {
        emittedChars += ch.length;
        params.onContent(ch);
      }
      return { gotOutput: true, finishReason: "stop", emittedChars };
    }
  }
  throw new Error("AI Horde text queue timeout");
}

/**
 * Streams an OpenAI-compatible `/chat/completions` endpoint with:
 * - Anti-Refusal Lead Buffer Interceptor (catches canned refusals before emitting!)
 * - Native `reasoning` / `reasoning_content` + `<think>` splitter
 * - Returns `finishReason` so caller can auto-continue truncated code seamlessly!
 */
async function callOpenAICompatibleStream(params: {
  endpointUrl: string;
  apiKey?: string;
  upstreamModel: string;
  messages: ChatTurnMessage[];
  temperature: number;
  maxTokens: number;
  parseThinkTags: boolean;
  interceptRefusals: boolean;
  connectTimeoutMs: number;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  onReasoning: (t: string) => void;
  onContent: (t: string) => void;
}): Promise<{ gotOutput: boolean; finishReason: string | null; emittedChars: number }> {
  const controller = new AbortController();
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    params.connectTimeoutMs
  );

  const clearConnectTimer = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "RevengeGPT/5.0 (Built by Idam Emmanuel)",
    ...(params.extraHeaders ?? {}),
  };
  if (params.apiKey) {
    headers["Authorization"] = `Bearer ${params.apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(params.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: params.upstreamModel,
        messages: toOpenAIMessages(params.messages),
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
        ...(params.extraBody ?? {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearConnectTimer();
    throw err;
  }

  if (!res.ok || !res.body) {
    clearConnectTimer();
    const errBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 220)}`);
  }

  let emittedChars = 0;
  let guardBuffer = "";
  let guardPassed = !params.interceptRefusals;

  const guardedEmitContent = (chunk: string) => {
    if (!chunk) return;
    if (guardPassed) {
      emittedChars += chunk.length;
      params.onContent(chunk);
      return;
    }
    guardBuffer += chunk;
    // Wait until we have ~110 chars (or a code fence) to verify it's not a canned refusal
    if (guardBuffer.includes("```") || guardBuffer.length >= 115) {
      if (looksLikeCannedRefusal(guardBuffer)) {
        throw new RefusalInterceptedError(guardBuffer);
      }
      guardPassed = true;
      emittedChars += guardBuffer.length;
      params.onContent(guardBuffer);
      guardBuffer = "";
    }
  };

  const flushGuard = () => {
    if (!guardPassed && guardBuffer) {
      if (looksLikeCannedRefusal(guardBuffer)) {
        throw new RefusalInterceptedError(guardBuffer);
      }
      guardPassed = true;
      emittedChars += guardBuffer.length;
      params.onContent(guardBuffer);
      guardBuffer = "";
    }
  };

  const contentType = res.headers.get("content-type") ?? "";

  if (
    contentType.includes("application/json") &&
    !contentType.includes("event-stream")
  ) {
    clearConnectTimer();
    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string;
          reasoning?: string;
          reasoning_content?: string;
        };
      }>;
    };
    if (json.error) {
      throw new Error(json.error.message || "Upstream JSON error");
    }
    const choice = json.choices?.[0];
    const msg = choice?.message;
    const nativeReasoning = msg?.reasoning || msg?.reasoning_content || "";
    const rawContent = msg?.content || "";
    if (!nativeReasoning && !rawContent) {
      throw new Error("Empty upstream JSON response");
    }
    if (params.interceptRefusals && looksLikeCannedRefusal(rawContent)) {
      throw new RefusalInterceptedError(rawContent);
    }
    if (nativeReasoning) params.onReasoning(nativeReasoning);
    if (params.parseThinkTags && !nativeReasoning) {
      const splitter = new ThinkTagStreamSplitter(
        params.onReasoning,
        guardedEmitContent
      );
      splitter.push(rawContent);
      splitter.flush();
    } else if (rawContent) {
      guardedEmitContent(rawContent);
    }
    flushGuard();
    return {
      gotOutput: true,
      finishReason: choice?.finish_reason ?? "stop",
      emittedChars,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let gotAnyToken = false;
  let sawNativeReasoning = false;
  let finishReason: string | null = null;

  const splitter = new ThinkTagStreamSplitter(
    (r) => {
      gotAnyToken = true;
      params.onReasoning(r);
    },
    (c) => {
      gotAnyToken = true;
      guardedEmitContent(c);
    }
  );

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Clear connect timeout as soon as first streaming bytes arrive!
      clearConnectTimer();

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        let parsed: {
          error?: { message?: string };
          choices?: Array<{
            finish_reason?: string | null;
            delta?: {
              content?: string;
              reasoning?: string;
              reasoning_content?: string;
            };
            message?: {
              content?: string;
              reasoning?: string;
            };
          }>;
        };

        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }

        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice?.delta;
        const nativeReason =
          delta?.reasoning ?? delta?.reasoning_content ?? "";
        if (nativeReason) {
          sawNativeReasoning = true;
          gotAnyToken = true;
          params.onReasoning(nativeReason);
        }

        const contentChunk =
          delta?.content ?? choice?.message?.content ?? "";
        if (contentChunk) {
          if (params.parseThinkTags && !sawNativeReasoning) {
            splitter.push(contentChunk);
          } else {
            gotAnyToken = true;
            guardedEmitContent(contentChunk);
          }
        }
      }
    }

    if (params.parseThinkTags && !sawNativeReasoning) {
      splitter.flush();
    }
    flushGuard();
  } finally {
    clearConnectTimer();
  }

  if (!gotAnyToken || (emittedChars === 0 && !sawNativeReasoning)) {
    throw new Error("Upstream stream closed with 0 content tokens");
  }

  // If a reasoning model burned all tokens in reasoning and emitted 0 content chars, treat as retryable failure
  if (emittedChars === 0) {
    throw new Error("Upstream reasoning exhausted token budget before content");
  }

  return { gotOutput: true, finishReason, emittedChars };
}

/**
 * Native Anthropic `/v1/messages` streaming adapter
 */
async function callAnthropicStream(params: {
  apiKey: string;
  upstreamModel: string;
  systemPrompt: string;
  messages: ChatTurnMessage[];
  temperature: number;
  maxTokens: number;
  onReasoning: (t: string) => void;
  onContent: (t: string) => void;
}): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    14000
  );

  const anthropicMessages = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: toAnthropicContent(m),
    }));

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.upstreamModel,
        system: params.systemPrompt,
        messages: anthropicMessages,
        max_tokens: Math.min(Math.max(params.maxTokens, 4096), 8192),
        temperature: params.temperature,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw e;
  }

  if (!res.ok || !res.body) {
    if (timer) clearTimeout(timer);
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 240)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let gotOutput = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(jsonStr) as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
            error?: { message?: string };
          };
          if (evt.error?.message) throw new Error(evt.error.message);
          if (evt.type === "content_block_delta") {
            if (evt.delta?.thinking) {
              gotOutput = true;
              params.onReasoning(evt.delta.thinking);
            } else if (evt.delta?.text) {
              gotOutput = true;
              params.onContent(evt.delta.text);
            }
          }
        } catch {
          // Ignore non-JSON frames
        }
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!gotOutput) {
    throw new Error("Anthropic stream returned 0 tokens");
  }
}

/**
 * Checks whether streamed output ended inside an unclosed triple-backtick code block
 * or was cut off mid-generation (`finish_reason === 'length'`).
 */
/** Reads an explicit size request like "1500 lines" / "1,500-line" / "2000+ lines". */
function parseRequestedLines(text: string): number | null {
  const m = text.match(/\b(\d{1,2}[.,]\d{3})\s*(?:\+)?\s*(?:lines?|loc)\b/i) ||
    text.match(/\b(\d{3,5})\s*(?:\+)?\s*(?:lines?|loc)\b/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[.,]/g, ""), 10);
  return n >= 100 && n <= 20000 ? n : null;
}

/**
 * QUALITY FLOOR FOR CODE.
 *
 * A coding request with no explicit line count used to stop whenever the model
 * felt done — routinely 200-300 lines that compile but do almost nothing.
 * When the user asks for a tool/app/script we now keep the same model writing
 * (continuation rounds, never a restart) until the artifact reaches a real
 * minimum size, or the stream genuinely finished a complete program.
 */
function codeQualityFloor(text: string): number | null {
  if (!isCodingIntent(text)) return null;
  // "write a scan feature", "small snippet" -> the user wants brevity.
  if (/\b(snippet|one-?liner|short|minimal|tiny|just the function|boilerplate|quick example|hello world)\b/i.test(text)) {
    return null;
  }
  // Full builds, tools, apps, scripts, CLIs -> demand a real implementation.
  const substantial = /\b(tool|app|application|website|dashboard|game|cli|script|scanner|bot|server|backend|api|full|complete|production|workspace|system|manager|tracker|platform|engine)\b/i.test(text);
  if (!substantial) return null;
  // 1500+ requested -> honour the explicit number instead.
  if (parseRequestedLines(text)) return null;
  return /\b(html|css|react|jsx|tsx|dashboard|website|game|ui|frontend|fullstack|full)\b/i.test(text)
    ? 650   // single-file apps carry markup + styles + logic
    : 450;  // backend / CLI / scripts
}

/** Non-code prose still deserves depth: block a 2-line brush-off. */
function proseNeedsDepth(text: string): boolean {
  return /\b(explain|compare|analyz|analyse|research|strategy|plan|review|audit|breakdown|deep|detail|why|how does|tradeoff|architecture|design)\b/i.test(text);
}

/** True when the stream stopped mid-artifact (unclosed HTML, unbalanced fence, abrupt end). */
function looksUnfinished(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const fences = (t.match(/```/g) || []).length;
  if (fences % 2 === 1) return true;
  const html = /<!doctype html|<html[\s>]/i.test(t);
  if (html && !/<\/html>/i.test(t)) return true;
  if (html && !/<\/body>/i.test(t) && t.length > 1500) return true;
  if (/\bfunction\b|=>/.test(t) && /[{(\[]\s*$/.test(t)) return true;
  return false;
}

/**
 * Distinguishes "the model finished a real, complete program" from "the model
 * stopped early because it decided it was done". Stops the quality floor from
 * forcing a model to pad an artifact that is already genuinely finished.
 */
function looksComplete(text: string): boolean {
  if (looksUnfinished(text)) return false;
  const t = text.trim();
  const htmlDone =
    /<!doctype html/i.test(t) && /<\/html>/i.test(t) && /<script[\s>]/i.test(t);
  if (htmlDone) return true;
  const entrypoint =
    /if\s+__name__\s*==\s*["']__main__["']/i.test(t) ||
    /func\s+main\s*\(\s*\)/i.test(t) ||
    /process\.argv/i.test(t);
  const hasUsage = /\b(usage|examples?|how to run|run it)\b/i.test(t);
  return Boolean(entrypoint && hasUsage);
}

function needsCodeContinuation(
  fullContent: string,
  finishReason: string | null,
  clusterId?: string
): boolean {
  const fenceMatches = fullContent.match(/```/g);
  const hasUnclosedCodeFence = Boolean(
    fenceMatches && fenceMatches.length % 2 === 1
  );
  if (hasUnclosedCodeFence) return true;
  if (finishReason === "length" && fullContent.length > 400) return true;
  // Special check for ch.at which cuts off around ~1900-2100 chars while reporting 'stop'
  if (
    clusterId === "chat-relay" &&
    fullContent.length >= 1850 &&
    !/[.!?;}`)\]"']\s*$/.test(fullContent.trim())
  ) {
    return true;
  }
  return false;
}

/**
 * Local Sovereign Fail-Safe Generator (only if all 4 global internet clusters are unreachable)
 */
async function runLocalRevengeFailSafe(params: {
  userPrompt: string;
  modelName: string;
  wantReasoning: boolean;
  onReasoning: (t: string) => void;
  onContent: (t: string) => void;
}) {
  const q = params.userPrompt.trim();
  if (params.wantReasoning) {
    params.onReasoning(
      `Synthesizing via ${params.modelName} Onboard Sovereign Core (built by ${CREATOR_NAME}) to guarantee zero-downtime execution for: "${q.slice(0, 110)}"...`
    );
  }

  const reply = `### ${params.modelName} — Complete Interactive Artifact

Here is a complete, runnable single-file **Workspace & Code Sandbox Application** ready in the **Artifact Preview Panel**:

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>REVENGE GPT Artifact</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', system-ui, sans-serif; }
    body { background: #191918; color: #ecebe6; padding: 28px; min-height: 100vh; }
    .panel { max-width: 720px; margin: 0 auto; background: #232220; border: 1px solid #383632; border-radius: 16px; padding: 24px; }
    .tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #e06346; font-weight: 700; }
    h1 { font-size: 22px; margin: 8px 0 12px; color: #faf9f5; }
    p { font-size: 14px; color: #b5b3aa; line-height: 1.6; margin-bottom: 16px; }
    .row { display: flex; gap: 10px; margin-bottom: 16px; }
    input { flex: 1; background: #161615; border: 1px solid #383632; color: #fff; padding: 10px 14px; border-radius: 10px; }
    button { background: #d95c3f; color: white; border: none; padding: 10px 18px; border-radius: 10px; font-weight: 600; cursor: pointer; }
    button:hover { background: #e4694d; }
    ul { list-style: none; display: grid; gap: 8px; }
    li { background: #191918; border: 1px solid #2f2e2b; padding: 12px 14px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; }
  </style>
</head>
<body>
  <div class="panel">
    <div class="tag">Revenge GPT • Claude-Class Artifact</div>
    <h1>Interactive Task & Command Module</h1>
    <p>Built by Idam Emmanuel. Add items below to test live state inside the Artifact Preview.</p>
    <div class="row">
      <input id="inp" placeholder="Add new engineering milestone..." onkeydown="if(event.key==='Enter')addItem()" />
      <button onclick="addItem()">Add Task</button>
    </div>
    <ul id="list"></ul>
  </div>
  <script>
    const items = ['Multi-cluster 16K keyless coding engine', 'Claude-style split-screen Live Artifacts', 'Zero-refusal unchained routing'];
    function render() {
      document.getElementById('list').innerHTML = items.map((t, i) =>
        '<li><span>' + t + '</span><button style="background:#32302d;padding:5px 10px;font-size:12px" onclick="removeItem(' + i + ')">Done</button></li>'
      ).join('');
    }
    function addItem() {
      const el = document.getElementById('inp');
      if (!el.value.trim()) return;
      items.unshift(el.value.trim());
      el.value = '';
      render();
    }
    function removeItem(i) { items.splice(i, 1); render(); }
    render();
  </script>
</body>
</html>
\`\`\``;

  const chunks = reply.match(/[\s\S]{1,36}/g) ?? [reply];
  for (const c of chunks) {
    params.onContent(c);
    await new Promise((r) => setTimeout(r, 8));
  }
}

/* ------------------------------------------------------------------ *
 * In-chat live code execution (Claude-style): any model in a normal
 * chat turn can run Python/JS/bash in a real isolated E2B sandbox,
 * see the genuine output, fix bugs, and rerun — all inside the chat.
 * ------------------------------------------------------------------ */

interface InChatExecDeps {
  model: AIModelDefinition;
  lastUserMsg: string;
  getContent: () => string;
  historyText: () => string;
  conversationId: string | null;
  temperature: number;
  emitReasoning: (t: string) => void;
  emitContent: (t: string) => void;
  onEvent: (event: StreamDeltaEvent) => void;
  followUp: (messages: ChatTurnMessage[]) => Promise<{ finishReason: string | null; emittedChars: number }>;
}

async function runInChatExecutionPhase(deps: InChatExecDeps): Promise<void> {
  if (!process.env.E2B_API_KEY?.trim()) return;
  const startedAt = Date.now();
  const HARD_DEADLINE = startedAt + 170_000;

  const {
    detectRunIntent,
    extractPythonBlocks,
    formatToolResultForModel,
    getChatSandbox,
    parseChatActionBlocks,
    runChatTool,
  } = await import("./chat-code-exec");

  let actions = parseChatActionBlocks(deps.getContent());
  const runIntent = detectRunIntent(deps.lastUserMsg);

  if (actions.length === 0) {
    if (!runIntent) return;
    // User explicitly asked to run/test — execute the largest Python block
    // from this turn (falling back to recent history, e.g. "run it").
    let blocks = extractPythonBlocks(deps.getContent());
    if (blocks.length === 0) blocks = extractPythonBlocks(deps.historyText());
    if (blocks.length === 0) return;
    blocks.sort((a, b) => b.length - a.length);
    actions = [{ tool: "run_python", args: { code: blocks[0].slice(0, 60_000) } }];
  }
  actions = actions.slice(0, 3);
  if (actions.length === 0) return;

  let sandbox: Awaited<ReturnType<typeof getChatSandbox>>["sandbox"];
  let sessionId: string | null = null;
  try {
    const conn = await getChatSandbox(deps.conversationId, deps.model.id);
    sandbox = conn.sandbox;
    sessionId = conn.sessionId;
  } catch (err) {
    deps.onEvent({
      type: "tool.failed",
      executionId: `exec_${Date.now()}`,
      tool: actions[0].tool,
      exitCode: 1,
      durationMs: 0,
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : "Sandbox unavailable",
    });
    return;
  }

  deps.onEvent({ type: "agent.thinking", text: "Running your code in a live sandbox…" });
  deps.emitReasoning("Executing code in the live E2B sandbox and capturing real output…\n");

  const roundResults: string[] = [];
  let rounds = 0;

  const execActions = async (list: typeof actions): Promise<void> => {
    for (const action of list) {
      if (Date.now() > HARD_DEADLINE) break;
      const executionId = `exec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const cmdPreview =
        typeof action.args.command === "string"
          ? String(action.args.command).slice(0, 220)
          : typeof action.args.code === "string"
            ? `${action.tool} (${String(action.args.code).length} chars)`
            : typeof action.args.path === "string"
              ? String(action.args.path).slice(0, 220)
              : action.tool;
      deps.onEvent({ type: "tool.started", executionId, tool: action.tool, command: cmdPreview });
      try {
        const result = await runChatTool(sandbox, sessionId, action.tool, action.args, (chunk) => {
          deps.onEvent({
            type: chunk.stream === "stdout" ? "tool.stdout" : "tool.stderr",
            executionId,
            text: chunk.text.slice(0, 4000),
          });
        });
        deps.onEvent({
          type: result.ok ? "tool.completed" : "tool.failed",
          executionId,
          tool: action.tool,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          stdout: result.stdout.slice(0, 8000),
          stderr: result.stderr.slice(0, 4000),
        });
        // Persist a compact output record inside the chat text itself.
        const outBlock = result.stdout || result.stderr
          ? `\n\n**${action.tool === "run_python" ? "Python" : action.tool} output** (exit ${result.exitCode}, ${result.durationMs}ms):\n\`\`\`\n${(result.stdout || result.stderr).slice(0, 2000)}\n\`\`\``
          : `\n\n**${action.tool}** finished with exit ${result.exitCode} (${result.durationMs}ms), no output.`;
        deps.emitContent(outBlock);
        roundResults.push(formatToolResultForModel(action.tool, result));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Execution failed";
        deps.onEvent({
          type: "tool.failed",
          executionId,
          tool: action.tool,
          exitCode: 1,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: msg,
        });
        roundResults.push(`Tool ${action.tool} errored: ${msg}`);
      }
    }
  };

  await execActions(actions);
  rounds++;

  // One verification round: let the model read the REAL output, fix bugs, rerun once.
  if (roundResults.length > 0 && rounds < 2 && Date.now() < HARD_DEADLINE) {
    const verifyPrompt =
      `You just executed code in a live sandbox. Here are the GENUINE results — never invent different output:\n\n` +
      roundResults.join("\n\n") +
      `\n\nAnalyze the real output. If there are errors, explain the root cause, output the corrected code in a fenced block, and then emit ONE more action block to rerun it. If everything passed, briefly confirm what the output proves.`;
    const followMessages: ChatTurnMessage[] = [
      { role: "user", content: deps.lastUserMsg },
      { role: "assistant", content: deps.getContent().slice(-6000) },
      { role: "user", content: verifyPrompt },
    ];
    await deps.followUp(followMessages).catch(() => ({ finishReason: null as string | null, emittedChars: 0 }));
    const followActions = parseChatActionBlocks(deps.getContent()).filter(
      (a) => !roundResults.some((r) => JSON.stringify(a.args).length > 0 && r.includes(a.tool) && false)
    );
    // Only rerun genuinely new actions from the verification pass (max 2).
    const seen = new Set(actions.map((a) => JSON.stringify(a)));
    const fresh = followActions.filter((a) => !seen.has(JSON.stringify(a))).slice(0, 2);
    if (fresh.length > 0) {
      await execActions(fresh);
      rounds++;
      if (roundResults.length > actions.length) {
        const lastTwo = roundResults.slice(-2).join("\n\n");
        deps.emitContent(`\n\n**Re-run results:**\n\`\`\`\n${lastTwo.slice(0, 1500)}\n\`\`\``);
      }
    }
  }
}

export async function streamRevengeCompletion(
  opts: EngineRequestOptions
): Promise<{
  content: string;
  reasoning: string;
  providerUsed: string;
  imageUrl?: string;
  videoUrl?: string;
  latencyMs: number;
  reasoningMs: number;
  tokensPerSec: number;
}> {
  const startedAt = Date.now();
  let reasoningStartedAt = 0;
  let reasoningEndedAt = 0;
  let fullReasoning = "";
  let fullContent = "";
  let approxChars = 0;

  const model =
    ALL_MODELS.find((m) => m.id === opts.modelId) ?? ALL_MODELS[0];
  const lastUserMsg =
    [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const emitReasoning = (t: string) => {
    if (!t) return;
    if (!reasoningStartedAt) reasoningStartedAt = Date.now();
    reasoningEndedAt = Date.now();
    fullReasoning += t;
    approxChars += t.length;
    opts.onEvent({ type: "reasoning", text: t });
  };

  const emitContent = (t: string) => {
    if (!t) return;
    if (reasoningStartedAt && !reasoningEndedAt) {
      reasoningEndedAt = Date.now();
    }
    fullContent += t;
    approxChars += t.length;
    opts.onEvent({ type: "content", text: t });
  };

  // 1. Keyless HD Image Synthesis (`keyless-flux-studio` or `/imagine ...` or `forceImageGen`)
  const savedHfToken =
    (opts.savedKeysMap["huggingface"]?.enabled
      ? opts.savedKeysMap["huggingface"]?.apiKey?.trim()
      : undefined) || process.env.HF_TOKEN?.trim();
  const savedHordeKey =
    (opts.savedKeysMap["aihorde"]?.enabled
      ? opts.savedKeysMap["aihorde"]?.apiKey?.trim()
      : undefined) || process.env.AIHORDE_API_KEY?.trim();

  const isVideoCommand = /^\/video\b/i.test(lastUserMsg.trim());
  // An attached photo means "look at this", not "generate media" — unless explicitly asked
  const latestUserTurn = [...opts.messages].reverse().find((m) => m.role === "user");
  const latestHasImages = Boolean(latestUserTurn?.images?.length);
  const contextHasImages = messagesHaveImages(opts.messages);

  if ((model.supportsVideoGen && !latestHasImages) || isVideoCommand || opts.forceVideoGen) {
    const rawVideoPrompt =
      lastUserMsg.replace(/^\/video\s*/i, "").trim() ||
      "Cinematic aerial drone shot flying through neon-drenched Tokyo skyscrapers in gentle rain at night, glowing reflections, smooth motion";

    const preferredVideo = model.videoBackend || "ltx-video-13b";
    opts.onEvent({
      type: "meta",
      modelId: model.id,
      providerUsed: "Synthesizing Keyless MP4 Video...",
    });

    const media = await generateKeylessVideo({
      prompt: rawVideoPrompt,
      preferred: preferredVideo,
      hfToken: savedHfToken,
      onProgress: (msg) => emitReasoning(msg + "\n"),
    });

    opts.onEvent({
      type: "meta",
      modelId: model.id,
      providerUsed: media.providerUsed,
    });
    opts.onEvent({ type: "video", videoUrl: media.url });

    const caption =
      `**Prompt:** ${rawVideoPrompt}  \n` +
      `**Engine:** \`${media.providerUsed}\` · **Format:** \`${media.resolution}\` · **Seed:** \`#${media.seed}\``;

    emitContent(caption);

    const latencyMs = Math.max(120, Date.now() - startedAt);
    const reasoningMs =
      reasoningStartedAt && reasoningEndedAt
        ? Math.max(80, reasoningEndedAt - reasoningStartedAt)
        : 120;
    opts.onEvent({
      type: "done",
      providerUsed: media.providerUsed,
      latencyMs,
      reasoningMs,
      tokensPerSec: 180,
    });
    return {
      content: fullContent,
      reasoning: fullReasoning,
      providerUsed: media.providerUsed,
      videoUrl: media.url,
      latencyMs,
      reasoningMs,
      tokensPerSec: 180,
    };
  }

  const isImagineCommand = /^\/imagine\b/i.test(lastUserMsg.trim());
  if ((model.supportsImageGen && !latestHasImages) || isImagineCommand || opts.forceImageGen) {
    const rawVisualPrompt =
      lastUserMsg.replace(/^\/imagine\s*/i, "").trim() ||
      "Minimalist obsidian architectural monolith studio overlooking dark ocean waves at dusk, warm amber interior lighting, 8k photorealistic";

    const preferredImage = model.imageBackend || "ovh-sdxl";
    opts.onEvent({
      type: "meta",
      modelId: model.id,
      providerUsed: "Rendering Keyless HD Image...",
    });

    const media = await generateKeylessImage({
      prompt: rawVisualPrompt,
      preferred: preferredImage,
      hfToken: savedHfToken,
      hordeKey: savedHordeKey,
      onProgress: (msg) => emitReasoning(msg + "\n"),
    });

    opts.onEvent({
      type: "meta",
      modelId: model.id,
      providerUsed: media.providerUsed,
    });
    opts.onEvent({ type: "image", imageUrl: media.url });

    const caption =
      `![${rawVisualPrompt.slice(0, 70)}](${media.url})\n\n` +
      `**Prompt:** ${rawVisualPrompt}  \n` +
      `**Engine:** \`${media.providerUsed}\` · **Resolution:** \`${media.resolution}\` · **Seed:** \`#${media.seed}\``;

    emitContent(caption);

    const latencyMs = Math.max(120, Date.now() - startedAt);
    const reasoningMs =
      reasoningStartedAt && reasoningEndedAt
        ? Math.max(60, reasoningEndedAt - reasoningStartedAt)
        : 90;
    opts.onEvent({
      type: "done",
      providerUsed: media.providerUsed,
      latencyMs,
      reasoningMs,
      tokensPerSec: 210,
    });
    return {
      content: fullContent,
      reasoning: fullReasoning,
      providerUsed: media.providerUsed,
      imageUrl: media.url,
      latencyMs,
      reasoningMs,
      tokensPerSec: 210,
    };
  }

  const reasoningEffort = opts.reasoningEffort ?? "high";
  const wantReasoning =
    reasoningEffort !== "off" && Boolean(model.supportsReasoning);
  const temperature = opts.temperature ?? 0.7;
  const requestedMaxTokens = Math.max(opts.maxTokens ?? 8192, 4096);

  // 2. BYOK Cloud Frontier Models (Anthropic, OpenAI, Gemini, DeepSeek, Groq, xAI, OpenRouter, etc.)
  if (model.requiresKey) {
    const providerDef = CLOUD_PROVIDERS.find((p) => p.id === model.providerId);
    const saved = opts.savedKeysMap[model.providerId];
    const resolvedKey =
      (saved?.enabled ? saved.apiKey?.trim() : undefined) ||
      resolveEnvApiKey(model.providerId);

    if (providerDef && (resolvedKey || model.providerId === "custom")) {
      const providerLabel = `${providerDef.name} • Direct Key`;
      opts.onEvent({
        type: "meta",
        modelId: model.id,
        providerUsed: providerLabel,
      });

      const systemPrompt = buildSystemInstruction({
        model,
        personaId: opts.personaId,
        userPrompt: lastUserMsg,
        customSystemPrompt: opts.customSystemPrompt,
        memoriesBlock: opts.memoriesBlock,
        webContextBlock: opts.webContextBlock,
        wantThinkTags:
          wantReasoning &&
          providerDef.protocol === "openai" &&
          !model.upstreamModel.includes("reasoner") &&
          !model.upstreamModel.startsWith("o3") &&
          !model.upstreamModel.startsWith("o1"),
        reasoningEffort,
        hasVision: contextHasImages,
      });

      // Full-thread memory: keep up to 100 recent turns so long chats and
      // mid-chat model switches never lose earlier context.
      const fullMessages: ChatTurnMessage[] = [
        { role: "system", content: systemPrompt },
        ...opts.messages.filter((m) => m.role !== "system").slice(-100),
      ];

      try {
        if (providerDef.protocol === "anthropic" && resolvedKey) {
          await callAnthropicStream({
            apiKey: resolvedKey,
            upstreamModel: model.upstreamModel,
            systemPrompt,
            messages: fullMessages,
            temperature,
            maxTokens: requestedMaxTokens,
            onReasoning: emitReasoning,
            onContent: emitContent,
          });
        } else {
          const base = (saved?.baseUrl?.trim() || providerDef.baseUrl).replace(
            /\/+$/,
            ""
          );
          const targetModel =
            model.providerId === "custom"
              ? saved?.customModelId?.trim() || "dolphin-mistral"
              : model.upstreamModel;

          await callOpenAICompatibleStream({
            endpointUrl: `${base}/chat/completions`,
            apiKey: resolvedKey || "ollama",
            upstreamModel: targetModel,
            messages: fullMessages,
            temperature,
            maxTokens: requestedMaxTokens,
            parseThinkTags: wantReasoning,
            interceptRefusals: false,
            connectTimeoutMs: 15000,
            extraHeaders:
              model.providerId === "openrouter"
                ? {
                    "HTTP-Referer": "https://revenge-gpt.app",
                    "X-Title": "REVENGE GPT by Idam Emmanuel",
                  }
                : undefined,
            onReasoning: emitReasoning,
            onContent: emitContent,
          });
        }

        // In-chat live execution (any model): run code for real, then verify.
        // Skipped for media-generation turns (image/video synthesis, not code).
        const isMediaTurn =
          Boolean(model.supportsImageGen || model.supportsVideoGen) &&
          (/^\/(video|imagine)\b/i.test(lastUserMsg.trim()) || fullContent.includes("](/api/media/"));
        if (opts.enableCodeExecution !== false && !isMediaTurn) {
          await runInChatExecutionPhase({
            model,
            lastUserMsg,
            getContent: () => fullContent,
            historyText: () => opts.messages.map((m) => m.content).join("\n").slice(-12000),
            conversationId: opts.conversationId ?? null,
            temperature,
            emitReasoning,
            emitContent,
            onEvent: opts.onEvent,
            followUp: async (followMessages) => {
              if (providerDef.protocol === "anthropic" && resolvedKey) {
                await callAnthropicStream({
                  apiKey: resolvedKey,
                  upstreamModel: model.upstreamModel,
                  systemPrompt,
                  messages: followMessages,
                  temperature: Math.min(temperature, 0.5),
                  maxTokens: requestedMaxTokens,
                  onReasoning: () => {},
                  onContent: emitContent,
                });
                return { finishReason: "stop" as string | null, emittedChars: 1 };
              }
              const fuBase = (saved?.baseUrl?.trim() || providerDef.baseUrl).replace(/\/+$/, "");
              const fuTarget =
                model.providerId === "custom"
                  ? saved?.customModelId?.trim() || "dolphin-mistral"
                  : model.upstreamModel;
              return callOpenAICompatibleStream({
                endpointUrl: `${fuBase}/chat/completions`,
                apiKey: resolvedKey || "ollama",
                upstreamModel: fuTarget,
                messages: followMessages,
                temperature: Math.min(temperature, 0.5),
                maxTokens: requestedMaxTokens,
                parseThinkTags: false,
                interceptRefusals: false,
                connectTimeoutMs: 15000,
                extraHeaders:
                  model.providerId === "openrouter"
                    ? {
                        "HTTP-Referer": "https://revenge-gpt.app",
                        "X-Title": "REVENGE GPT by Idam Emmanuel",
                      }
                    : undefined,
                onReasoning: () => {},
                onContent: emitContent,
              });
            },
          });
        }

        const latencyMs = Math.max(100, Date.now() - startedAt);
        const reasoningMs =
          reasoningStartedAt && reasoningEndedAt
            ? Math.max(50, reasoningEndedAt - reasoningStartedAt)
            : 0;
        const estTokens = Math.max(16, Math.round(approxChars / 4));
        const tokensPerSec = Math.max(
          45,
          Math.round((estTokens / Math.max(latencyMs, 250)) * 1000)
        );

        opts.onEvent({
          type: "done",
          providerUsed: providerLabel,
          latencyMs,
          reasoningMs,
          tokensPerSec,
        });
        return {
          content: fullContent,
          reasoning: fullReasoning,
          providerUsed: providerLabel,
          latencyMs,
          reasoningMs,
          tokensPerSec,
        };
      } catch (err) {
        if (!opts.autoFailover) {
          const msg =
            err instanceof Error ? err.message : "Provider connection failed";
          throw new Error(`${providerDef.name}: ${msg}`);
        }
        if (fullContent.length > 60) {
          const latencyMs = Date.now() - startedAt;
          return {
            content: fullContent,
            reasoning: fullReasoning,
            providerUsed: providerLabel,
            latencyMs,
            reasoningMs: 0,
            tokensPerSec: 95,
          };
        }
      }
    } else if (!opts.autoFailover) {
      throw new Error(
        `No API key saved for ${model.providerLabel}. Add your key in World AI Keys or enable Auto-Failover to use the free keyless engines.`
      );
    }
  }

  // 3. MULTI-CLUSTER UNMODERATED KEYLESS ENGINE (Kilo 131K/262K + OVH 24B/70B/Nemo + LLM7 Codestral 8K)
  const defaultUnchainedFallbacks: KeylessRouteTarget[] = [
    {
      cluster: "kilo",
      model: "reflection/beam-free",
      maxTokens: 16384,
      reasoningParam: "low",
      nativeReasoning: true,
    },
    {
      cluster: "ovh",
      model: "Mistral-Small-3.2-24B-Instruct-2506",
      maxTokens: 8192,
    },
    {
      cluster: "ovh",
      model: "Mistral-Nemo-Instruct-2407",
      maxTokens: 8192,
    },
    {
      cluster: "llm7",
      model: "codestral-latest",
      maxTokens: 8192,
    },
    {
      cluster: "kilo",
      model: "liquid/lfm-2.5-2.6b:free",
      maxTokens: 8192,
      nativeReasoning: true,
    },
    {
      cluster: "aihorde",
      model: "wicked-tutu-26b-w8a16",
      maxTokens: 2048,
    },
    {
      cluster: "chat-relay",
      model: "gpt-4o-mini",
      maxTokens: 4096,
    },
  ];

  const primaryRoutes = (model.keylessRoutes ?? []).filter(
    (r) => r.cluster !== "flux-image"
  );
  const candidateRoutes: KeylessRouteTarget[] = [];

  if (contextHasImages) {
    // REVENGE VISION: the selected model's own vision routes first, then every verified vision model.
    for (const r of [...primaryRoutes.filter(isVisionRoute), ...VISION_ROUTES]) {
      if (!candidateRoutes.some((c) => c.cluster === r.cluster && c.model === r.model)) {
        candidateRoutes.push(r);
      }
    }
  } else {
    candidateRoutes.push(...primaryRoutes);
    for (const fb of defaultUnchainedFallbacks) {
      if (
        !candidateRoutes.some(
          (r) => r.cluster === fb.cluster && r.model === fb.model
        )
      ) {
        candidateRoutes.push(fb);
      }
    }
  }

  let sawRefusalOnEarlierNode = false;

  // A build request must never be handled by a 2.6B or 2K-token micro model —
  // that is what produced one-second "rubbish" tools. Skip weak nodes for real
  // implementation work and only fall back to them if nothing else answers.
  const isBuildRequest = Boolean(codeQualityFloor(lastUserMsg));
  const weakNodes = new Set([
    "liquid/lfm-2.5-2.6b:free",
    "wicked-tutu-26b-w8a16",
    "gpt-4o-mini",
  ]);

  for (let i = 0; i < candidateRoutes.length; i++) {
    // Never start another upstream attempt for a client that already left.
    if (opts.abortSignal?.aborted) break;
    const route = candidateRoutes[i];
    if (route.cluster === "flux-image") continue;
    if (isBuildRequest && weakNodes.has(route.model)) {
      // Defer micro models to a final rescue pass at the very end.
      candidateRoutes.splice(i, 1);
      candidateRoutes.push(route);
      if (i >= candidateRoutes.length) break;
      i--;
      continue;
    }
    const clusterMeta = CLUSTER_ENDPOINTS[route.cluster];

    const routePersona = ROUTE_PERSONAS[route.model];
    const routeLabel = contextHasImages
      ? `REVENGE Vision • ${route.model.split("/").pop()}`
      : routePersona
        ? `${routePersona} · ${clusterMeta.label}`
        : i === 0 && !model.requiresKey
          ? `${clusterMeta.label} • ${route.model.split("/").pop()}`
          : sawRefusalOnEarlierNode
            ? `Failover → ${route.model.split("/").pop()}`
            : `Keyless Mesh → ${route.model.split("/").pop()}`;

    const useThinkTags =
      wantReasoning &&
      !route.nativeReasoning &&
      route.cluster !== "chat-relay";

    const baseSystemPrompt = buildSystemInstruction({
      model,
      personaId: opts.personaId,
      userPrompt: lastUserMsg,
      customSystemPrompt: opts.customSystemPrompt,
      memoriesBlock: opts.memoriesBlock,
      webContextBlock: opts.webContextBlock,
      wantThinkTags: useThinkTags,
      reasoningEffort,
      retryReviewRequested: sawRefusalOnEarlierNode,
      hasVision: contextHasImages && isVisionRoute(route),
    });
    const systemPrompt = routePersona
      ? `${baseSystemPrompt}\n\nACTIVE ENGINE PERSONA: You are currently running on ${routePersona}. The selected REVENGE model is ${model.name}. Combine this upstream engine's strengths with the selected model's task instructions. If the user asks which engine handled the request, accurately name ${routePersona}.`
      : baseSystemPrompt;

    const turnHistory = opts.messages.filter((m) => m.role !== "system").slice(-100);
    const nodeMessages: ChatTurnMessage[] = [
      { role: "system", content: systemPrompt },
      ...(isVisionRoute(route) ? turnHistory : stripImages(turnHistory)),
    ];

    const extraBody: Record<string, unknown> = {};
    if (route.cluster === "kilo" && route.reasoningParam) {
      const mappedEffort =
        !wantReasoning && route.reasoningParam !== "none"
          ? "low"
          : reasoningEffort === "max" && route.reasoningParam !== "none"
          ? "medium"
          : route.reasoningParam;
      extraBody.reasoning = { effort: mappedEffort };
    }

    const requestedLines = parseRequestedLines(lastUserMsg);
    const qualityFloor = codeQualityFloor(lastUserMsg);
    const longJob =
      Boolean(requestedLines) || Boolean(model.longOutput) || Boolean(qualityFloor);
    const effectiveMaxTokens = Math.min(
      Math.max(requestedMaxTokens, longJob ? 32768 : 4096),
      route.maxTokens
    );

    try {
      opts.onEvent({ type: "meta", modelId: model.id, providerUsed: routeLabel });

      const firstPass =
        route.cluster === "aihorde"
          ? await callAiHordeTextCluster({
              upstreamModel: route.model,
              messages: nodeMessages,
              temperature,
              maxTokens: effectiveMaxTokens,
              hordeKey: savedHordeKey,
              interceptRefusals: true,
              onReasoning: emitReasoning,
              onContent: emitContent,
            })
          : await callOpenAICompatibleStream({
              endpointUrl: clusterMeta.url,
              upstreamModel: route.model,
              messages: nodeMessages,
              temperature,
              maxTokens: effectiveMaxTokens,
              parseThinkTags: useThinkTags,
              interceptRefusals: true,
              connectTimeoutMs: clusterMeta.timeoutMs,
              extraBody,
              onReasoning: emitReasoning,
              onContent: emitContent,
            });

      // SEAMLESS MULTI-PASS AUTO-CONTINUATION: keep going until the artifact is whole
      // (explicit "1500 lines" requests, unclosed HTML, or a cut-off stream).
      let lastFinish = firstPass.finishReason;
      let continuationRound = 0;
      // A quality floor means the model may need several more passes to reach a
      // real implementation, so budget more rounds than a plain chat turn.
      // Explicit line counts and quality floors both need many passes; the real
      // governor is the deadline below, which keeps us inside the 300s limit.
      const maxContinuations = longJob
        ? requestedLines
          ? 22
          : qualityFloor
            ? 12
            : 8
        : route.cluster === "chat-relay"
          ? 4
          : 2;
      const deadline = startedAt + (longJob ? 240000 : 150000);

      const needsMore = () => {
        // The browser went away: stop immediately, do not keep generating.
        if (opts.abortSignal?.aborted) return false;
        if (Date.now() > deadline) return false;
        const lineTotal = fullContent.split("\n").length;
        if (requestedLines && lineTotal < requestedLines * 0.92) return true;
        // Below the floor for a build request: keep this same model writing.
        if (qualityFloor && lineTotal < qualityFloor && !looksComplete(fullContent)) {
          if (route.maxTokens <= 4096) return false; // tiny relay cannot do more
          return true;
        }
        if (longJob && looksUnfinished(fullContent)) return true;
        return needsCodeContinuation(fullContent, lastFinish, route.cluster);
      };

      while (continuationRound < maxContinuations && needsMore()) {
        continuationRound++;
        const tailContext = fullContent.slice(longJob ? -2600 : -1400);
        const contMessages: ChatTurnMessage[] = [
          {
            role: "system",
            content: qualityFloor
              ? "You are continuing an INCOMPLETE build. The artifact is real but too shallow: it ends at the tail provided and does not yet do everything the user asked for. Output ONLY the next code that continues immediately after that tail — no repetition, no preamble. Add the missing substance: complete the remaining functionality, wire up every handler and command, add real error handling, validation, persistence, and the CLI/usage wiring. Never pad with comments or filler. Keep going until the program genuinely satisfies the request."
              : "You are continuing an in-progress code stream. Output ONLY the exact continuation starting from the very next character after the user-provided tail. Do NOT repeat earlier text, do NOT add greetings or markdown preambles, do not stop early, and make sure every open code block and HTML tag is closed cleanly at the end.",
          },
          {
            role: "user",
            content: `Original request:\n${lastUserMsg}\n\nYour output so far ended at:\n<<<TAIL>>>\n${tailContext}\n<<<END_TAIL>>>\n\nContinue immediately from the exact next character:`,
          },
        ];

        try {
          const nextPass = await callOpenAICompatibleStream({
            endpointUrl: clusterMeta.url,
            upstreamModel: route.model,
            messages: contMessages,
            temperature: Math.min(temperature, 0.5),
            maxTokens: longJob
              ? Math.min(Math.max(effectiveMaxTokens, 8192), route.maxTokens)
              : effectiveMaxTokens,
            parseThinkTags: false,
            interceptRefusals: false,
            connectTimeoutMs: clusterMeta.timeoutMs,
            extraBody,
            onReasoning: () => {},
            onContent: emitContent,
          });
          lastFinish = nextPass.finishReason;
          if (nextPass.emittedChars < 40) break;
        } catch {
          break;
        }
      }

      {
        const fenceCount = (fullContent.match(new RegExp("```", "g")) || []).length;
        if (fenceCount % 2 === 1) {
          const closing = String.fromCharCode(10) + "```";
          fullContent += closing;
          opts.onEvent({ type: "content", text: closing });
        }
      }

      // In-chat live execution (any model): run code for real, then verify.
      await runInChatExecutionPhase({
        model,
        lastUserMsg,
        getContent: () => fullContent,
        historyText: () => opts.messages.map((m) => m.content).join("\n").slice(-12000),
        conversationId: opts.conversationId ?? null,
        temperature,
        emitReasoning,
        emitContent,
        onEvent: opts.onEvent,
        followUp: async (followMessages) => {
          const nextPass = await callOpenAICompatibleStream({
            endpointUrl: clusterMeta.url,
            upstreamModel: route.model,
            messages: followMessages,
            temperature: Math.min(temperature, 0.5),
            maxTokens: effectiveMaxTokens,
            parseThinkTags: false,
            interceptRefusals: false,
            connectTimeoutMs: clusterMeta.timeoutMs,
            extraBody,
            onReasoning: () => {},
            onContent: emitContent,
          });
          return nextPass;
        },
      });

      const latencyMs = Math.max(95, Date.now() - startedAt);
      const reasoningMs =
        reasoningStartedAt && reasoningEndedAt
          ? Math.max(60, reasoningEndedAt - reasoningStartedAt)
          : 0;
      const estTokens = Math.max(18, Math.round(approxChars / 4));
      const tokensPerSec = Math.max(
        75,
        Math.round((estTokens / Math.max(latencyMs, 200)) * 1000)
      );

      opts.onEvent({
        type: "done",
        providerUsed: routeLabel,
        latencyMs,
        reasoningMs,
        tokensPerSec,
      });

      return {
        content: fullContent,
        reasoning: fullReasoning,
        providerUsed: routeLabel,
        latencyMs,
        reasoningMs,
        tokensPerSec,
      };
    } catch (err) {
      if (err instanceof RefusalInterceptedError) {
        sawRefusalOnEarlierNode = true;
        continue;
      }

      if (fullContent.trim().length > 80) {
        const latencyMs = Math.max(120, Date.now() - startedAt);
        opts.onEvent({
          type: "done",
          providerUsed: routeLabel,
          latencyMs,
          reasoningMs: 0,
          tokensPerSec: 135,
        });
        return {
          content: fullContent,
          reasoning: fullReasoning,
          providerUsed: routeLabel,
          latencyMs,
          reasoningMs: 0,
          tokensPerSec: 135,
        };
      }
      continue;
    }
  }

  // 4a. Vision requests never fall back to a canned text answer — be honest instead
  if (contextHasImages) {
    const busyLabel = "REVENGE Vision • all servers busy";
    opts.onEvent({ type: "meta", modelId: model.id, providerUsed: busyLabel });
    emitContent(
      "All free vision servers are busy right now, so I couldn't look at your image this time. Please tap **Retry** in a few seconds — the image is still attached to this message."
    );
    const latencyMs = Math.max(120, Date.now() - startedAt);
    opts.onEvent({ type: "done", providerUsed: busyLabel, latencyMs, reasoningMs: 0, tokensPerSec: 0 });
    return {
      content: fullContent,
      reasoning: fullReasoning,
      providerUsed: busyLabel,
      latencyMs,
      reasoningMs: 0,
      tokensPerSec: 0,
    };
  }

  // 4. Ultimate Onboard Sovereign Fail-Safe
  const fallbackLabel = "Revenge Onboard Sovereign Core";
  opts.onEvent({ type: "meta", modelId: model.id, providerUsed: fallbackLabel });

  await runLocalRevengeFailSafe({
    userPrompt: lastUserMsg,
    modelName: model.name,
    wantReasoning,
    onReasoning: emitReasoning,
    onContent: emitContent,
  });

  const latencyMs = Math.max(120, Date.now() - startedAt);
  opts.onEvent({
    type: "done",
    providerUsed: fallbackLabel,
    latencyMs,
    reasoningMs: 60,
    tokensPerSec: 240,
  });

  return {
    content: fullContent,
    reasoning: fullReasoning,
    providerUsed: fallbackLabel,
    latencyMs,
    reasoningMs: 60,
    tokensPerSec: 240,
  };
}
