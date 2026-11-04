import { Sandbox } from "e2b";
import { ALL_MODELS, CLOUD_PROVIDERS, getModelById } from "./revenge-registry";
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
  onToolRecord: (record: {
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
}

interface ResolvedEndpoint {
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

export function agentCapability(modelId: string): "native-tools" | "structured-actions" | "chat-only" {
  try {
    const ep = resolveAgentEndpoint(modelId, {});
    return ep.nativeTools ? "native-tools" : "structured-actions";
  } catch {
    return "chat-only";
  }
}

const AGENT_SYSTEM = `You are REVENGE Agent, an autonomous coding agent running inside REVENGE GPT with a real isolated Linux cloud sandbox (E2B). You have genuine tools that execute real commands, manipulate real files, and return real output. Never claim an action succeeded without tool output proving it.

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
  sandbox: Sandbox,
  opts: AgentRunOptions
): Promise<AgentOutcome> {
  const started = Date.now();
  const emit = (type: AgentEvent["type"], extra: Record<string, unknown> = {}) =>
    opts.emit({ type, sessionId: opts.sessionId, timestamp: new Date().toISOString(), ...extra });

  const maxIterations = opts.maxIterations ?? 12;
  const maxToolCalls = opts.maxToolCalls ?? 30;
  const temperature = opts.temperature ?? 0.4;
  const endpoint = resolveAgentEndpoint(opts.modelId, opts.savedKeysMap);
  const systemPrompt = buildAgentSystemPrompt(opts.customSystemPrompt);

  emit("agent.started", {
    task: opts.task,
    modelId: opts.modelId,
    capability: endpoint.nativeTools ? "native-tools" : "structured-actions",
  });

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
        emit("agent.thinking", { text: r.text });
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
        onText: (t) => emit("agent.thinking", { text: t }),
      });
      emit("agent.completed", { summary: r.text, toolCallCount: 0, iterations: 1 });
      return { status: "completed", summary: r.text, toolCallCount: 0, iterations: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Plan failed";
      emit("agent.failed", { error: msg });
      return { status: "failed", summary: msg, toolCallCount: 0, iterations: 0 };
    }
  }

  // Auto mode
  const history: Array<Record<string, unknown>> = [];
  const anthropicHistory: Array<{ role: string; content: unknown }> = [];
  const seenSignatures = new Map<string, number>();
  let toolCallCount = 0;
  let iteration = 0;
  let finalSummary = "";

  const checkCancel = (): boolean => opts.shouldCancel();

  while (iteration < maxIterations) {
    if (checkCancel()) {
      emit("agent.failed", { error: "Cancelled by user.", cancelled: true });
      return { status: "cancelled", summary: finalSummary || "Cancelled by user.", toolCallCount, iterations: iteration };
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
            ? [{ role: "user", content: opts.task }]
            : anthropicHistory;
        const r = await anthropicChat({
          apiKey: endpoint.apiKey!,
          model: endpoint.model,
          system: systemPrompt,
          messages: convo,
          temperature,
          maxTokens: 4096,
        });
        if (r.text) emit("agent.thinking", { text: r.text });
        if (r.toolCalls.length === 0) {
          finalSummary = r.text;
          emit("agent.completed", { summary: finalSummary, toolCallCount, iterations: iteration });
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
        onText: (t) => emit("agent.thinking", { text: t }),
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
        if (iteration <= 2 && r.text.trim()) {
          history.push({ role: "assistant", content: r.text });
          history.push({
            role: "user",
            content:
              "INVALID TURN: zero action blocks. Reply with EXACTLY one block:\n```action\n{\"tool\": \"inspect_project\", \"args\": {}}\n```\nNothing else.",
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
      // Provider hiccup: surface and stop rather than fabricate.
      emit("agent.failed", { error: msg, toolCallCount, iterations: iteration });
      return { status: "failed", summary: msg, toolCallCount, iterations: iteration };
    }
  }

  finalSummary = `Stopped after ${maxIterations} iterations with ${toolCallCount} tool calls. Latest workspace state is saved.`;
  emit("agent.completed", { summary: finalSummary, toolCallCount, iterations: iteration, limitHit: true });
  return { status: "completed", summary: finalSummary, toolCallCount, iterations: iteration };
}

async function runOneTool(
  sandbox: Sandbox,
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

  await opts.onToolRecord({
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
