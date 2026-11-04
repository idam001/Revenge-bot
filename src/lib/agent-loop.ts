import type { AgentSandboxHandle } from "./sandbox-provider";
import {
  ALL_MODELS,
  CLOUD_PROVIDERS,
  getModelById,
  type KeylessClusterId,
} from "./revenge-registry";
import {
  executeAgentTool,
  getAnthropicTools,
  getOpenAITools,
  isKnownTool,
  type ToolStreamHandler,
} from "./agent-tools";
import type { SavedProviderConfig } from "./revenge-engine";

export type { SavedProviderConfig } from "./revenge-engine";

export type AgentEventType =
  | "agent.started"
  | "agent.thinking"
  | "agent.status"
  | "agent.message"
  | "tool.queued"
  | "tool.started"
  | "tool.stdout"
  | "tool.stderr"
  | "tool.completed"
  | "tool.failed"
  | "process.started"
  | "process.running"
  | "process.exited"
  | "process.cancelled"
  | "agent.completed"
  | "agent.failed";

export interface AgentEvent {
  type: AgentEventType;
  sessionId: string;
  executionId?: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface AgentRunOptions {
  sessionId: string;
  task: string;
  /** Earlier turns in this agent session, oldest first. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  modelId: string;
  mode: "auto" | "plan";
  temperature?: number;
  maxIterations?: number;
  maxToolCalls?: number;
  commandTimeoutMs?: number;
  customSystemPrompt?: string;
  savedKeysMap: Record<string, SavedProviderConfig>;
  shouldCancel: () => boolean;
  emit: (event: AgentEvent) => void;
  onToolRecord?: (record: {
    toolName: string;
    command: string | null;
    args: Record<string, unknown>;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    status: string;
  }) => Promise<void> | void;
}

export interface AgentOutcome {
  status: "completed" | "failed" | "cancelled";
  summary: string;
  toolCallCount: number;
  iterations: number;
  conversational?: boolean;
}

interface ResolvedEndpoint {
  /** Set when this engine returned a quota/rate error during the run. */
  failed?: boolean;
  kind: "openai" | "anthropic";
  url: string;
  model: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  nativeTools: boolean;
}

function envKey(providerId: string): string | undefined {
  const map: Record<string, string[]> = {
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
  for (const k of map[providerId] ?? []) {
    if (process.env[k]?.trim()) return process.env[k]!.trim();
  }
  return undefined;
}

const KEYLESS_ENDPOINTS: Record<string, string> = {
  kilo: "https://api.kilo.ai/api/gateway/v1/chat/completions",
  ovh: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
  llm7: "https://api.llm7.io/v1/chat/completions",
  pollinations: "https://text.pollinations.ai/openai",
  "chat-relay": "https://ch.at/v1/chat/completions",
};

/** Resolve where/how the agent talks to the selected model. Never throws keys into logs. */
export function resolveAgentEndpoint(
  modelId: string,
  savedKeysMap: Record<string, SavedProviderConfig>
): ResolvedEndpoint {
  const model = ALL_MODELS.find((m) => m.id === modelId) ?? getModelById("revenge-omega-x");

  if (model.requiresKey) {
    const def = CLOUD_PROVIDERS.find((p) => p.id === model.providerId);
    const saved = savedKeysMap[model.providerId];
    const key = (saved?.enabled ? saved.apiKey?.trim() : undefined) || envKey(model.providerId);
    if (!def) throw new Error(`Unknown provider for model ${model.name}.`);
    if (model.providerId === "anthropic" && key) {
      return { kind: "anthropic", url: "https://api.anthropic.com/v1/messages", model: model.upstreamModel, apiKey: key, nativeTools: true };
    }
    const base = (saved?.baseUrl?.trim() || def.baseUrl).replace(/\/+$/, "");
    const target = model.providerId === "custom" ? saved?.customModelId?.trim() || "llama3.2" : model.upstreamModel;
    if (!key && model.providerId !== "custom") {
      throw new Error(`No API key saved for ${def.name}. Add it in Models & keys, or pick a free keyless model.`);
    }
    return {
      kind: "openai",
      url: `${base}/chat/completions`,
      model: target,
      apiKey: key || "ollama",
      nativeTools: def.protocol === "openai",
      extraHeaders:
        model.providerId === "openrouter"
          ? { "HTTP-Referer": "https://revenge-gpt.app", "X-Title": "REVENGE GPT Agent" }
          : undefined,
    };
  }

  // Keyless: use the model's own first route so model switching keeps working.
  const route = (model.keylessRoutes ?? []).find((r) => r.cluster !== "flux-image" && r.cluster !== "aihorde");
  const cluster = route?.cluster ?? "kilo";
  const upstream = route?.model ?? "reflection/beam-free";
  const url = KEYLESS_ENDPOINTS[cluster] ?? KEYLESS_ENDPOINTS.kilo;
  return { kind: "openai", url, model: upstream, nativeTools: false };
}

/**
 * Every endpoint the agent may use for a model, most-preferred first.
 *
 * A single endpoint can run out of quota (HTTP 429 "insufficient_quota"), get
 * rate limited, or go down. The agent loop walks this list instead of giving up,
 * which is what used to turn a full quota on one free tier into a dead agent.
 */
export function agentEndpointCandidates(
  modelId: string,
  savedKeysMap: Record<string, SavedProviderConfig>
): ResolvedEndpoint[] {
  const out: ResolvedEndpoint[] = [];
  const push = (ep: ResolvedEndpoint) => {
    const key = `${ep.url}|${ep.model}`;
    if (!out.some((e) => `${e.url}|${e.model}` === key)) out.push(ep);
  };

  const model = ALL_MODELS.find((m) => m.id === modelId) ?? getModelById("revenge-omega-x");

  // A provider the user configured themselves always comes first.
  if (model.requiresKey) {
    try {
      push(resolveAgentEndpoint(modelId, savedKeysMap));
    } catch {
      /* fall through to the keyless mesh */
    }
  }

  // The selected model's own routes.
  for (const route of model.keylessRoutes ?? []) {
    if (route.cluster === "flux-image" || route.cluster === "aihorde") continue;
    const url = KEYLESS_ENDPOINTS[route.cluster];
    if (!url) continue;
    push({ kind: "openai", url, model: route.model, nativeTools: false });
  }

  // The shared keyless mesh, so a depleted tier can never stop the agent.
  const mesh: Array<[KeylessClusterId, string]> = [
    ["kilo", "reflection/beam-free"],
    ["kilo", "dots-studio/dots-3-note-preview:free"],
    ["ovh", "Mistral-Small-3.2-24B-Instruct-2506"],
    ["llm7", "codestral-latest"],
    ["ovh", "Qwen3.6-27B"],
    ["pollinations", "openai"],
    ["chat-relay", "gpt-4o-mini"],
  ];
  for (const [cluster, model_] of mesh) {
    const url = KEYLESS_ENDPOINTS[cluster];
    if (!url) continue;
    push({ kind: "openai", url, model: model_, nativeTools: false });
  }

  return out;
}

/** Errors that mean "this endpoint is exhausted", not "this request is wrong". */
/**
 * Keyless endpoints occasionally emit their raw chat template
 * (<|end|><|start|>user<|message|> …, [INST], </s>) instead of clean prose.
 * Cut the text at the first control token and trim the leftovers so the user
 * only ever sees the model's actual answer.
 */
export function sanitizeModelText(input: string): string {
  if (!input) return "";
  let out = input;
  const cut = out.search(/<\|?(?:end|start|im_start|im_end|eot_id|endoftext|assistant|user|system)\|?>/i);
  if (cut >= 0) out = out.slice(0, cut);
  out = out.replace(/<\|[^|>]{0,40}\|>/g, "");
  out = out.replace(/\[\/?INST\]/gi, "").replace(/<\/?s>/g, "");
  out = out.replace(/^(?:assistant|ai)\s*:\s*/i, "");
  return out.trim();
}

export function isQuotaOrRateError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    /(^|\b)(429|503|502|504)(\b|$)/.test(msg) ||
    /insufficient_quota|quota exceeded|daily token quota|rate limit|too many requests|capacity|overloaded|temporarily unavailable|deadline exceeded|timeout|timed out|econnreset|fetch failed/.test(
      msg
    )
  );
}

/* ------------------------------------------------------------------ */
/*  Conversation vs. work                                              */
/* ------------------------------------------------------------------ */

const GREETING = /^\s*(hi|hey|hello|yo|sup|hiya|howdy|good\s+(morning|afternoon|evening)|morning|evening|thanks|thank\s+you|thx|ty|ok|okay|cool|nice|great|awesome|perfect|got\s+it|understood|sure|yep|nope|how\s+are\s+you|how're\s+you|what'?s\s+up|whats\s+up|who\s+are\s+you|what\s+can\s+you\s+do|test|testing|ping|are\s+you\s+there|you\s+there|bye|goodbye|see\s+ya|lol|haha)\b/i;

const WORK_VERB = /\b(build|create|make|write|generate|implement|scaffold|set\s*up|setup|install|run|execute|test|debug|fix|refactor|add|remove|delete|update|change|deploy|launch|code|program|script|app|api|website|component|function|file|project|npm|pip|python|node|react|flask|django|html|css|json|sql|error|traceback|bug|convert|rename|move|zip|refactor)\b/i;

/**
 * True when this message is just conversation — a greeting, thanks, a question
 * about the agent — rather than a request to build or run something.
 *
 * Conversational turns get a normal short chat reply. Without this the agent
 * loop forces an action fence and nags the model forever, which produces an
 * internal monologue instead of an answer.
 */
export function isConversationalMessage(task: string): boolean {
  const t = task.trim();
  if (!t) return true;
  if (t.includes("```")) return false;
  if (/\/[\w.-]+\.[a-z]{1,4}\b/.test(t) || /https?:\/\//i.test(t)) return false;
  if (WORK_VERB.test(t)) return false;
  if (t.length <= 160 && GREETING.test(t)) return true;
  // A short question aimed at the agent itself ("can you see my files?")
  if (t.length <= 60 && /\?\s*$/.test(t) && /\b(you|your|u)\b/i.test(t)) return true;
  return false;
}

export function agentCapability(modelId: string): "native-tools" | "structured-actions" | "chat-only" {
  try {
    const ep = resolveAgentEndpoint(modelId, {});
    return ep.nativeTools ? "native-tools" : "structured-actions";
  } catch {
    return "chat-only";
  }
}

/**
 * Small free models "think out loud" and echo the system prompt before the real
 * answer, e.g.
 *   "The user just said Hi. No action blocks.

So a friendly greeting.Hi there!"
 * Drop every sentence that is meta-commentary and keep the actual reply.
 */
const META_SENTENCE =
  /\b(action block|action fence|system prompt|the instructions|according to|one to three|short sentences|think out loud|no tools|no action|plain,? warm|brief prose|i should (?:reply|respond|answer|output|greet|just)|i (?:need|have) to (?:reply|respond|output)|the user (?:just )?(?:said|is asking|asks|wants|greeted|asked)|restate|the assistant should|output only the reply|this is a conversational|just a (?:friendly|quick|brief|short|simple|warm)|^\s*so,? just|^\s*so just)\b/i;

/** Split into sentences, tolerating "greeting.Hi!" with no space after the dot. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])|(?<=[a-z][.!?])(?=[A-Z"'(][a-z])/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function stripReasoningPreamble(input: string): string {
  const text = (input ?? "").trim();
  if (!text) return text;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text;
  const kept = sentences.filter((line) => !META_SENTENCE.test(line));
  // Some models write the answer twice (draft then final). Keep the last copy.
  const joined = kept.join(" ").replace(/\s+/g, " ").trim();
  const half = Math.floor(joined.length / 2);
  let out = joined;
  if (joined.length > 80) {
    const head = joined.slice(0, half).trim();
    if (head.length > 20 && joined.slice(half).trim().startsWith(head.slice(0, 20))) {
      out = joined.slice(half).trim();
    }
  }
  // Never blank out the answer: if everything looked meta, fall back to the
  // tail of the original — the real reply is almost always at the end.
  if (out.length >= 2) return out;
  const last = sentences[sentences.length - 1];
  return last && last.length >= 2 ? last : text;
}
/**
 * The final message must be something a person wants to read: what happened and
 * what they have now. Models leak their working-out ("I should build…",
 * "- Canvas-based rendering - Score tracking…", fence skeletons) into it, so
 * drop those lines instead of showing them as the answer.
 */
export function polishFinalAnswer(
  input: string,
  context?: { toolsUsed?: number; mode?: "auto" | "plan" }
): string {
  const text = (input ?? "").trim();
  if (!text) return text;
  const lines = text.split(/\n+/);

  const isNoise = (line: string): boolean => {
    const l = line.trim();
    if (!l) return false;
    if (/^```/.test(l)) return true;                       // fence markers
    if (/^\{.*"tool"\s*:/.test(l)) return true;               // raw action JSON
    if (/^(key features|features|plan|steps|todo)\s*:/i.test(l)) return true;
    if (/^[\-*\u2022]\s+(canvas-based|arrow keys|score tracking|game over|responsive design|nice visual)/i.test(l)) return true; // hallucinated feature-plan bullet
    // "I should build…", "Let me create…", "I'll now write…"
    if (/^(let me|i'?ll|i will|i should|i need to|i am going to|i'?m going to|let's think|here's my plan)\b/i.test(l)) return true;
    return false;
  };

  const kept = lines.filter((line) => !isNoise(line));
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // If the model produced nothing but working-out, say what actually happened
  // rather than showing its thought process as if it were the answer.
  if (out.length < 12) {
    if (context?.toolsUsed && context.toolsUsed > 0) {
      return `Done — I ran ${context.toolsUsed} command${context.toolsUsed === 1 ? "" : "s"} in the sandbox. The files are in the workspace; open the file list to inspect them, or tell me what to change.`;
    }
    return context?.mode === "plan"
      ? "Plan only is on, so I didn't create or change any files. Switch to Auto and send the task again when you want me to build and test it."
      : "I couldn't finish that task, and no completed result is available yet. Try again or tell me what to change.";
  }
  return out;
}

const AGENT_SYSTEM = `You are REVENGE Agent, an autonomous coding agent running inside REVENGE GPT with a real isolated Linux cloud sandbox (Firecracker microVM). You have genuine tools that execute real commands, manipulate real files, and return real output. Never claim an action succeeded without tool output proving it.

WORKSPACE: All project files live under /home/user/workspace. Stay inside it.

HOW TO ACT (structured mode) — THIS IS MANDATORY: to run anything you MUST emit a fenced ACTION block. Write EXACTLY this shape with three backticks and the word action on the opening line:
\`\`\`action
{"tool": "write_file", "args": {"path": "sum.py", "content": "..."}}
\`\`\`
Then one short line of plain text after it. Never describe an action without the fence. Never put the JSON in a json/code fence. Start your very first reply with an action block for inspect_project.
Available tools: execute_command, run_python, run_javascript, read_file, write_file, edit_file, list_files, create_directory, delete_file, run_tests, inspect_project, install_package, get_process_status, stop_process.
After the action block(s), add a one-line note of what you expect. The real tool results come back to you as user messages; then you continue until done.

WORKFLOW: plan briefly → inspect_project first → create files → install deps → run/build → read real errors → fix → rerun → run_tests → summarize verified results with the exact file list.
RULES: complete files only, no placeholders; fix real errors from tool output, never invent results; keep each turn focused; when the task is fully verified, reply with the final summary and no action block.`;

// Deliberately tiny. Small free models will happily repeat a long system
// prompt back at the user, so the chat prompt says almost nothing.
/** Keep casual replies conversational instead of letting small models ramble. */
export function conciseChatReply(input: string): string {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (text.split(/\s+/).length <= 72) return text;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  let out = "";
  for (const sentence of sentences) {
    const next = (out + " " + sentence.trim()).trim();
    if (next.split(/\s+/).length > 62) break;
    out = next;
    if ((out.match(/[.!?](?:\s|$)/g) ?? []).length >= 3) break;
  }
  return out || "I can help with that. What would you like to know?";
}

const CHAT_SYSTEM = "You are REVENGE, a friendly coding assistant with a real sandbox. Answer the user directly in 1–3 short sentences; do not list every capability unless asked, and never narrate private reasoning.";

export function buildChatSystemPrompt(custom?: string): string {
  return custom?.trim() ? `${CHAT_SYSTEM}\n\nPROJECT INSTRUCTIONS:\n${custom.trim()}` : CHAT_SYSTEM;
}

function buildAgentSystemPrompt(custom?: string): string {
  return custom?.trim() ? `${AGENT_SYSTEM}\n\nPROJECT INSTRUCTIONS:\n${custom.trim()}` : AGENT_SYSTEM;
}

interface ParsedAction {
  tool: string;
  args: Record<string, unknown>;
}

function parseActionBlocks(text: string): ParsedAction[] {
  const out: ParsedAction[] = [];
  // Accept exact ```action fences, plus common model mistakes (json/code fences
  // containing one action object) so the loop never stalls on fence labeling.
  const re = /```(?:action|json|code|tool)?[^\S\n]*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let raw = m[1].trim();
    // Models sometimes glue the fence onto the JSON (```action {"tool":...}).
    raw = raw.replace(/^(?:action|json|code|tool)[^\S\n]*/i, "").trim();
    if (!raw.startsWith("{")) continue;
    try {
      const obj = JSON.parse(raw) as { tool?: unknown; args?: unknown };
      if (typeof obj.tool === "string" && isKnownTool(obj.tool)) {
        out.push({
          tool: obj.tool,
          args: obj.args && typeof obj.args === "object" ? (obj.args as Record<string, unknown>) : {},
        });
      }
    } catch {
      // Malformed block — ignore so one bad block can't break the loop.
    }
  }
  return out;
}

function actionSignature(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args)}`;
}

function resultToText(r: { ok: boolean; stdout: string; stderr: string; exitCode: number; durationMs: number }): string {
  const parts = [`exit=${r.exitCode} (${r.durationMs}ms)`];
  if (r.stdout) parts.push(`STDOUT:\n${r.stdout.slice(0, 6000)}`);
  if (r.stderr) parts.push(`STDERR:\n${r.stderr.slice(0, 6000)}`);
  if (!r.stdout && !r.stderr) parts.push("(no output)");
  return parts.join("\n");
}

async function openaiChat(opts: {
  url: string;
  apiKey?: string;
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
  onText?: (t: string) => void;
}): Promise<{
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  finishReason: string | null;
}> {
  const pickText = (
    content: string | null | undefined,
    reasoning: string | null | undefined,
    onText?: (t: string) => void
  ): string => {
    // Reasoning-first models (e.g. Kilo beam) may put the whole answer in
    // delta.reasoning / message.reasoning with empty content. Prefer real
    // content, but fall back to reasoning so the loop never sees "empty".
    if (content && content.trim()) return content;
    if (reasoning && reasoning.trim()) {
      if (reasoning.length > 40) onText?.(`[reasoning] ${reasoning.slice(0, 2000)}`);
      return reasoning;
    }
    return content ?? "";
  };
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      ...(opts.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      ...(opts.tools ? { tools: opts.tools, tool_choice: "auto" } : {}),
      stream: opts.stream,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Model HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  if (!opts.stream || !res.body) {
    const json = (await res.json()) as {
      error?: { message?: string };
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string;
          reasoning?: string;
          reasoning_content?: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
      }>;
    };
    if (json.error) throw new Error(json.error.message || "Model error");
    const msg = json.choices?.[0]?.message;
    const finalText = pickText(
      msg?.content,
      msg?.reasoning ?? msg?.reasoning_content,
      opts.onText
    );
    const toolCalls = (msg?.tool_calls ?? [])
      .map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        return { id: tc.id, name: tc.function.name, args };
      })
      .filter((tc) => isKnownTool(tc.name));
    return { text: msg?.content ?? "", toolCalls, finishReason: json.choices?.[0]?.finish_reason ?? null };
  }

  // Streaming accumulate (text + tool calls)
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{
            finish_reason?: string | null;
            delta?: {
              content?: string;
              reasoning?: string;
              reasoning_content?: string;
              tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
            };
          }>;
        };
        const ch = j.choices?.[0];
        if (ch?.finish_reason) finishReason = ch.finish_reason;
        const delta = ch?.delta ?? {};
        const chunkText = pickText(delta.content, delta.reasoning ?? delta.reasoning_content, opts.onText);
        if (chunkText) text += chunkText;
        for (const tc of ch?.delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }
  const toolCalls = [...calls.values()]
    .map((c, i) => {
      let args: Record<string, unknown> = {};
      try {
        args = c.args ? JSON.parse(c.args) : {};
      } catch {
        args = {};
      }
      return { id: c.id || `call_${i}`, name: c.name, args };
    })
    .filter((c) => isKnownTool(c.name));
  return { text, toolCalls, finishReason };
}

async function anthropicChat(opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature: number;
  maxTokens: number;
}): Promise<{
  text: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      system: opts.system,
      messages: opts.messages,
      tools: getAnthropicTools(),
      max_tokens: Math.min(Math.max(opts.maxTokens, 1024), 4096),
      temperature: opts.temperature,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
  };
  let text = "";
  const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
  for (const b of json.content ?? []) {
    if (b.type === "text") text += b.text;
    else if (b.type === "tool_use" && isKnownTool(b.name)) {
      toolCalls.push({ id: b.id, name: b.name, args: b.input ?? {} });
    }
  }
  return { text, toolCalls };
}

/* ------------------------------------------------------------------ */

export async function runAgentLoop(
  sandbox: AgentSandboxHandle,
  opts: AgentRunOptions
): Promise<AgentOutcome> {
  const started = Date.now();
  const emit = (type: AgentEvent["type"], extra: Record<string, unknown> = {}) => {
    const clean: Record<string, unknown> = { ...extra };
    if (typeof clean.text === "string") clean.text = sanitizeModelText(clean.text);
    if (typeof clean.summary === "string") {
      const cleaned = sanitizeModelText(clean.summary);
      clean.summary =
        type === "agent.completed" && clean.conversational !== true
          ? polishFinalAnswer(cleaned, {
              toolsUsed: Number(clean.toolCallCount ?? 0),
              mode: opts.mode === "plan" ? "plan" : "auto",
            })
          : stripReasoningPreamble(cleaned);
    }
    opts.emit({ type, sessionId: opts.sessionId, timestamp: new Date().toISOString(), ...clean });
  };

  const maxIterations = opts.maxIterations ?? 18;
  const maxToolCalls = opts.maxToolCalls ?? 30;
  const temperature = opts.temperature ?? 0.4;
  const candidates = agentEndpointCandidates(opts.modelId, opts.savedKeysMap);
  if (candidates.length === 0) {
    emit("agent.failed", { error: "No language model endpoint is available for this model." });
    return { status: "failed", summary: "No endpoint available", toolCallCount: 0, iterations: 0 };
  }
  // Index into the candidate list; advances when an endpoint is exhausted.
  let endpoint = candidates[0];
  let fullCycles = 0;
  const noteFailover = (reason: string) => {
    let next = candidates.find((c) => !c.failed && c !== endpoint);
    if (!next) next = candidates.find((c) => !c.failed);
    if (!next) {
      // Every engine in the mesh has been retired. Free tiers recover within
      // seconds, so make one more sweep before telling the user anything.
      if (fullCycles >= 1) return false;
      fullCycles += 1;
      for (const c of candidates) c.failed = false;
      next = candidates.find((c) => c !== endpoint) ?? candidates[0];
      if (!next) return false;
    }
    endpoint = next;
    emit("agent.status", {
      text: /503|502|504|overload|capacity/i.test(reason)
        ? "This model is busy. Trying another available engine…"
        : /429|quota|rate limit/i.test(reason)
          ? "Model limit reached. Switching to another available engine…"
          : "Switching to another available model engine…",
      providerUsed: next.url,
    });
    return true;
  };
  for (const c of candidates) c.failed = false;
  const systemPrompt = buildAgentSystemPrompt(opts.customSystemPrompt);

  emit("agent.started", {
    task: opts.task,
    modelId: opts.modelId,
    capability: endpoint.nativeTools ? "native-tools" : "structured-actions",
  });

  // Latest prose from the model in this turn. On stop or failure we return this
  // instead of a bare "Cancelled", so nothing the user already read is lost.
  let turnProse = "";

  // Plan mode: single answer, no tools.
  if (opts.mode === "plan") {
    try {
      if (endpoint.kind === "anthropic") {
        const r = await anthropicChat({
          apiKey: endpoint.apiKey!,
          model: endpoint.model,
          system: systemPrompt + "\n\nPLAN MODE: do not call tools. Output a numbered build plan only.",
          messages: [{ role: "user", content: opts.task }],
          temperature,
          maxTokens: 2048,
        });
        emit("agent.completed", { summary: r.text, toolCallCount: 0, iterations: 1 });
        return { status: "completed", summary: r.text, toolCallCount: 0, iterations: 1 };
      }
      const r = await openaiChat({
        url: endpoint.url,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        messages: [
          { role: "system", content: systemPrompt + "\n\nPLAN MODE: do not call tools. Output a numbered build plan only." },
          { role: "user", content: opts.task },
        ],
        temperature,
        maxTokens: 2048,
        stream: true,
        extraHeaders: endpoint.extraHeaders,
        onText: (t) => {
          turnProse = (turnProse + t).slice(-4000);
        },
      });
      emit("agent.completed", { summary: r.text, toolCallCount: 0, iterations: 1 });
      return { status: "completed", summary: r.text, toolCallCount: 0, iterations: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Plan failed";
      emit("agent.failed", { error: msg });
      return { status: "failed", summary: msg, toolCallCount: 0, iterations: 0 };
    }
  }

  // Pure conversation (a greeting, thanks, "what can you do?") gets a normal
  // chat answer. Forcing the action-fence loop here is what produced the
  // internal monologue the user saw on "Hi".
  if (isConversationalMessage(opts.task)) {
    const chatPrompt = buildChatSystemPrompt(opts.customSystemPrompt);
    try {
      let reply = "";
      if (endpoint.kind === "anthropic") {
        const r = await anthropicChat({
          apiKey: endpoint.apiKey!,
          model: endpoint.model,
          system: chatPrompt,
          messages: [
            ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: opts.task },
          ],
          temperature,
          maxTokens: 220,
        });
        reply = r.text;
      } else {
        const r = await openaiChat({
          url: endpoint.url,
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          messages: [
            { role: "system", content: chatPrompt },
            ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: opts.task },
          ],
          temperature,
          maxTokens: 220,
          stream: true,
          extraHeaders: endpoint.extraHeaders,
        });
        reply = r.text;
      }
      const cleaned = stripReasoningPreamble(sanitizeModelText(reply));
      const asksCapabilities = /\b(what can you (?:do|offer)|what are you able to do|your capabilities)\b/i.test(opts.task);
      const clean = asksCapabilities
        ? "I can build and debug apps, write and run code, test changes, explain or refactor a codebase, and help with APIs and automation—all in the sandbox. What are you working on?"
        : conciseChatReply(cleaned) || "I'm here — what would you like me to build or run?";
      emit("agent.completed", { summary: clean, toolCallCount: 0, iterations: 1, conversational: true });
      return { status: "completed", summary: clean, toolCallCount: 0, iterations: 1, conversational: true };
    } catch (err) {
      // If the chat reply itself fails, fall through to the normal loop so the
      // message is never swallowed.
      const msg = err instanceof Error ? err.message : String(err);
      if (!isQuotaOrRateError(err)) {
        emit("agent.failed", { error: msg });
        return { status: "failed", summary: msg, toolCallCount: 0, iterations: 0 };
      }
    }
  }

  // Auto mode
  const history: Array<Record<string, unknown>> = [];
  const anthropicHistory: Array<{ role: string; content: unknown }> = [];
  const seenSignatures = new Map<string, number>();
  let toolCallCount = 0;
  let iteration = 0;
  let failedOvers = 0;
  let finalSummary = "";
  let lastProse = "";
  let sameTextRepeats = 0;

  const checkCancel = (): boolean => opts.shouldCancel();

  while (iteration < maxIterations) {
    if (checkCancel()) {
      emit("agent.failed", { error: "Cancelled by user.", cancelled: true });
      return {
        status: "cancelled",
        summary: (finalSummary || turnProse || "Stopped by user before the agent wrote a summary. Partial work is saved in the sandbox.").trim(),
        toolCallCount,
        iterations: iteration,
      };
    }
    if (toolCallCount >= maxToolCalls) {
      finalSummary = `Stopped: reached the tool-call limit (${maxToolCalls}). Partial work is saved in the workspace.`;
      emit("agent.completed", { summary: finalSummary, toolCallCount, iterations: iteration, limitHit: true });
      return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
    }
    iteration++;

    try {
      if (endpoint.kind === "anthropic") {
        const convo: Array<{ role: string; content: unknown }> =
          iteration === 1
            ? [
                ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content })),
                { role: "user", content: opts.task },
              ]
            : anthropicHistory;
        const r = await anthropicChat({
          apiKey: endpoint.apiKey!,
          model: endpoint.model,
          system: systemPrompt,
          messages: convo,
          temperature,
          maxTokens: 4096,
        });
        if (r.text) {
          turnProse = r.text.slice(-4000);
        }
        if (r.toolCalls.length === 0) {
          finalSummary = r.text;
          emit("agent.completed", {
            summary: finalSummary,
            toolCallCount,
            iterations: iteration,
          });
          return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
        }
        const assistantBlocks: unknown[] = [];
        if (r.text) assistantBlocks.push({ type: "text", text: r.text });
        for (const tc of r.toolCalls) {
          assistantBlocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
        }
        anthropicHistory.push({ role: "assistant", content: assistantBlocks });
        const resultBlocks: unknown[] = [];
        for (const tc of r.toolCalls) {
          if (checkCancel()) break;
          const outcome = await runOneTool(sandbox, opts, tc.name, tc.args, toolCallCount);
          toolCallCount = outcome.count;
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: resultToText(outcome.result),
          });
        }
        anthropicHistory.push({ role: "user", content: resultBlocks });
        continue;
      }

      // OpenAI-compatible path
      const convo: Array<Record<string, unknown>> =
        iteration === 1
          ? [
              { role: "system", content: systemPrompt },
              ...(opts.history ?? []).map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: opts.task },
            ]
          : history;

      const useNative = endpoint.nativeTools;
      const r = await openaiChat({
        url: endpoint.url,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        messages: convo,
        tools: useNative ? getOpenAITools() : undefined,
        temperature,
        maxTokens: 4096,
        stream: true,
        extraHeaders: endpoint.extraHeaders,
      });

      if (iteration === 1) history.push(...convo);

      if (useNative && r.toolCalls.length > 0) {
        history.push({
          role: "assistant",
          content: r.text || null,
          tool_calls: r.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
        for (const tc of r.toolCalls) {
          if (checkCancel()) break;
          const outcome = await runOneTool(sandbox, opts, tc.name, tc.args, toolCallCount, tc.id);
          toolCallCount = outcome.count;
          history.push({ role: "tool", tool_call_id: tc.id, content: resultToText(outcome.result) });
        }
        continue;
      }

      // Structured-action path (keyless models)
      if (/^\s*DONE[.!]?\s*$/i.test(r.text.trim())) {
        finalSummary = "Task completed. " + (finalSummary || "");
        emit("agent.completed", {
          summary: finalSummary.trim(),
          toolCallCount,
          iterations: iteration,
        });
        return { status: "completed", summary: finalSummary.trim(), toolCallCount, iterations: iteration };
      }
      const actions = parseActionBlocks(r.text);
      if (actions.length === 0) {
        if (iteration <= 4 && r.text.trim() && /write_file|execute_command|inspect_project|run_python|list_files|create_directory/.test(r.text)) {
          // The model clearly TRIED to act but the fence didn't parse. Don't punish it —
          // tell it the fence was malformed and let it retry with the same intent.
          history.push({ role: "assistant", content: r.text });
          history.push({
            role: "user",
            content:
              "Your last reply contained an intended tool call but no parseable ```action fence. Resend it as EXACTLY:\n```action\n{\"tool\": \"<tool-name>\", \"args\": {...}}\n```\nOnly the fenced block, no prose.",
          });
          continue;
        }
        // If the model keeps restating the same text, the turn is drifting.
      if (r.text.trim() && lastProse && r.text.trim() === lastProse) {
        sameTextRepeats += 1;
      } else if (r.text.trim()) {
        sameTextRepeats = 0;
      }
      if (r.text.trim()) lastProse = r.text.trim();
      if (sameTextRepeats >= 2) {
        finalSummary = r.text.trim();
        emit("agent.completed", {
          summary: finalSummary,
          toolCallCount,
          iterations: iteration,
          limitHit: true,
        });
        return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
      }

      // The model answered in prose instead of acting. That is almost never
        // the end of the work — it usually means it lost the fence format. Keep
        // the loop alive by restating the contract instead of stopping early.
        const text = r.text.trim();
        const isPreamble =
          /(let me|i will|i'll|i am going to|i'm going to|now i|next,? i|first,? i|starting|sure[,!]|okay[,!]|getting started|i need to|i should)\s*$/i.test(
            text
          ) ||
          /(let me|i will|i'll|i am going to|i'm going to)\b[^.]{0,80}$/i.test(text);
        const saysDone =
          /\b(done|finished|complete|completed|all set|everything is (working|ready)|successfully)\b/i.test(text) &&
          !isPreamble;
        // The model wrote "Let me create the file…" and stopped: that is a plan,
        // not a finished job. Make it actually act, or wrap up honestly.
        const planningOnly =
          /\b(let me|i'?ll|i will|i should|i need to|now i|next,? i|first,? i)\b[^.]{0,80}\b(write|create|build|make|add|implement|run|test|start|begin|set up)\b/i.test(
            text
          ) &&
          !/\b(done|finished|completed|built|created|written|passes|works)\b/i.test(text);
        if (planningOnly && history.length > 0) {
          history.push({ role: "assistant", content: text });
          history.push({
            role: "user",
            content:
              "You described a plan but did not run anything, so nothing happened yet. " +
              "Either emit the action fence NOW, or if you truly cannot continue, reply with plain text summarising what you had planned.",
          });
          continue;
        }
        // A genuine question back to the user ("what should it do?") is a valid
        // end to the turn — answer, don't nag it into another loop.
        const asksUser =
          /\?\s*$/.test(text) &&
          /\b(what|which|how|where|do you|would you|should i|could you|can you tell)\b/i.test(text) &&
          !/\b(let me|i will|i'll|now i)\b/i.test(text);
        if (asksUser) {
          finalSummary = text;
          emit("agent.completed", { summary: finalSummary, toolCallCount, iterations: iteration, conversational: true });
          return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
        }
        if (!saysDone && history.length > 0) {
          history.push({ role: "assistant", content: r.text });
          history.push({
            role: "user",
            content:
              "You replied with prose and issued NO tool call, so nothing happened. " +
              "The task is not finished yet. Continue the work NOW by emitting exactly one action fence:\n" +
              "```action\n{\"tool\": \"<tool-name>\", \"args\": { ... }}\n```\n" +
              "Available tools: execute_command, run_python, run_javascript, write_file, read_file, " +
              "edit_file, list_files, create_directory, delete_file, install_package, inspect_project. " +
              "If the task is genuinely complete, reply with the single word DONE and nothing else.",
          });
          continue;
        }
        finalSummary = r.text.trim() || "(empty response)";
        emit("agent.completed", { summary: finalSummary, toolCallCount, iterations: iteration });
        return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
      }
      history.push({ role: "assistant", content: r.text });
      const resultTexts: string[] = [];
      for (const a of actions) {
        if (checkCancel()) break;
        if (toolCallCount >= maxToolCalls) break;
        const sig = actionSignature(a.tool, a.args);
        const seen = (seenSignatures.get(sig) ?? 0) + 1;
        seenSignatures.set(sig, seen);
        if (seen >= 3) {
          resultTexts.push(
            `Tool ${a.tool}: SKIPPED — same call repeated 3 times (loop protection). Try a different approach.`
          );
          continue;
        }
        const outcome = await runOneTool(sandbox, opts, a.tool, a.args, toolCallCount);
        toolCallCount = outcome.count;
        resultTexts.push(`Tool ${a.tool} result:\n${resultToText(outcome.result)}`);
      }
      history.push({ role: "user", content: resultTexts.join("\n\n") });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent iteration failed";
      // Quota/rate failures are expected on free tiers. Retire this engine and
      // continue the SAME task on the next one instead of failing the run.
      (endpoint as { failed?: boolean }).failed = true;
      if (isQuotaOrRateError(err)) {
        failedOvers = (failedOvers ?? 0) + 1;
        if (failedOvers <= candidates.length * 2 + 4 && noteFailover(msg)) {
          iteration--; // this attempt did not count against the budget
          continue;
        }
        // Genuinely out of engines: name the cause AND the fix, and never lose work.
        const friendly =
          "All free model engines are out of capacity right now, so I stopped instead of losing your work. " +
          `Everything built so far is saved in this sandbox. Last engine error: ${msg.slice(0, 180)}. ` +
          "Two ways forward: send the message again in a moment (free tiers refill quickly), switch the model in the picker, or add your own API key in Models & keys for unlimited runs.";
        emit("agent.failed", {
          error: friendly,
          toolCallCount,
          iterations: iteration,
          recoverable: true,
        });
        return { status: "failed", summary: friendly, toolCallCount, iterations: iteration };
      }
      // Not a quota problem — still keep whatever the model already produced.
      const partial = turnProse.trim();
      const message = partial ? `${msg}\n\nPartial answer before the error:\n${partial.slice(0, 1500)}` : msg;
      emit("agent.failed", { error: message, toolCallCount, iterations: iteration });
      return { status: "failed", summary: message, toolCallCount, iterations: iteration };
    }
  }

  finalSummary = `Stopped after ${maxIterations} iterations with ${toolCallCount} tool calls. Latest workspace state is saved.`;
  emit("agent.completed", { summary: finalSummary, toolCallCount, iterations: iteration, limitHit: true });
  return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
}

async function runOneTool(
  sandbox: AgentSandboxHandle,
  opts: AgentRunOptions,
  toolName: string,
  args: Record<string, unknown>,
  countSoFar: number,
  callId?: string
): Promise<{ result: Awaited<ReturnType<typeof executeAgentTool>>; count: number }> {
  const executionId = `exec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const command =
    typeof args.command === "string"
      ? args.command
      : typeof args.code === "string"
        ? args.code.slice(0, 200)
        : typeof args.path === "string"
          ? args.path
          : JSON.stringify(args).slice(0, 200);
  const ev = (type: AgentEventType, extra: Record<string, unknown> = {}) =>
    opts.emit({ type, sessionId: opts.sessionId, timestamp: new Date().toISOString(), ...extra });

  ev("tool.queued", { executionId, tool: toolName, command, callId });
  ev("tool.started", { executionId, tool: toolName, command, callId });

  const streamHandler: ToolStreamHandler = (chunk) => {
    ev(chunk.stream === "stdout" ? "tool.stdout" : "tool.stderr", {
      executionId,
      tool: toolName,
      text: chunk.text.slice(0, 4000),
    });
  };

  const result = await executeAgentTool(sandbox, toolName, args, streamHandler);
  if (result.background) {
    ev("process.started", {
      executionId,
      tool: toolName,
      pid: result.pid,
      command,
    });
  }

  await opts.onToolRecord?.({
    toolName,
    command,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    status: result.ok ? "success" : "failed",
  });

  ev(result.ok ? "tool.completed" : "tool.failed", {
    executionId,
    tool: toolName,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: result.stdout.slice(0, 8000),
    stderr: result.stderr.slice(0, 4000),
    callId,
  });

  return { result, count: countSoFar + 1 };
}

export function getElapsedMs(started: number): number {
  void started;
  return Date.now() - started;
}
