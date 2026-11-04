/**
 * AI feature matrix — exercises every model family on a deployed build.
 * Usage: BASE=https://... node ai-features.mjs
 */
const BASE = process.env.BASE || "http://127.0.0.1:3600";
const GUEST = Math.random().toString(16).slice(2).padEnd(48, "0");

const rows = [];
function rec(feature, ok, note) {
  rows.push({ feature, ok, note });
  console.log(`${ok === "ok" ? "PASS" : ok === "skip" ? "SKIP" : "FAIL"}  ${feature}${note ? "  — " + note : ""}`);
}

async function chat(payload, { timeoutMs = 120_000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-revenge-guest": GUEST, origin: BASE },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, status: res.status, raw: t.slice(0, 300), events: [] };
    }
    const text = await res.text();
    // The endpoint streams newline-delimited JSON (optionally `data: ` prefixed).
    const events = text
      .split("\n")
      .map((l) => l.trim().replace(/^data:\s*/, ""))
      .filter((l) => l.startsWith("{"))
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    return { ok: true, status: res.status, events, raw: text };
  } catch (e) {
    return { ok: false, status: 0, raw: String(e).slice(0, 200), events: [] };
  } finally {
    clearTimeout(t);
  }
}

const byType = (events, type) => events.filter((e) => e.type === type);
const textOf = (events) => byType(events, "content").map((e) => e.delta ?? e.text ?? e.content ?? "").join("");
const providerOf = (events) => byType(events, "done")[0]?.providerUsed ?? byType(events, "meta").map((m) => m.providerUsed).filter(Boolean).pop();

/* 1. streaming chat, multiple model families */
const chatModels = [
  ["revenge-omega-x", "flagship"],
  ["revenge-coder-ultra", "coding"],
  ["keyless-glm-5-3", "reasoning"],
  ["keyless-llama-3-3-70b", "uncensored/OVH"],
];
let firstConvId = null;
for (const [modelId, kind] of chatModels) {
  const r = await chat({ message: "Reply with exactly: AITEST", modelId });
  const text = textOf(r.events);
  const ok = r.ok && /AITEST/i.test(text);
  if (!ok && r.ok) rec(`chat ${modelId} (${kind})`, "fail", `no AITEST in ${text.slice(0, 80)}`);
  else rec(`chat ${modelId} (${kind})`, ok ? "ok" : "fail", ok ? providerOf(r.events) ?? "" : `${r.status} ${r.raw}`);
  if (r.ok && !firstConvId) firstConvId = byType(r.events, "conversation")[0]?.conversationId ?? null;
}

/* 2. conversation continuation (context retained) */
{
  // Free keyless models occasionally ignore history; retry once before failing.
  let passed = false;
  let note = "";
  let convId = null;
  for (let attempt = 0; attempt < 2 && !passed; attempt++) {
    const c = await chat({ message: "Remember the word ZEBRA42. Just say OK." });
    convId = byType(c.events, "conversation")[0]?.conversationId ?? convId;
    const d = await chat({ conversationId: convId, message: "What was the word I asked you to remember? Reply with just the word." });
    const text = textOf(d.events);
    passed = /ZEBRA42/i.test(text);
    note = text.trim().slice(0, 60);
  }
  rec("multi-turn continuation keeps context", passed ? "ok" : "fail", note);
  firstConvId = convId;
}

/* 3. reasoning events */
{
  const r = await chat({ message: "Briefly reason about: is 17 prime? Then answer.", modelId: "keyless-glm-5-3" });
  const reasoning = byType(r.events, "reasoning");
  const content = textOf(r.events);
  rec("reasoning stream + content", reasoning.length > 0 && content.length > 0 ? "ok" : "skip", `${reasoning.length} reasoning deltas`);
}

/* 4. web search grounding */
{
  const r = await chat({ message: "What is the latest news about NASA Artemis today? Search the web.", modelId: "keyless-glm-5-3", webSearch: true });
  const sources = byType(r.events, "sources")[0]?.sources ?? [];
  const searching = byType(r.events, "searching").length;
  rec("web search returns real source URLs", sources.length > 0 && sources.every((s) => /^https?:\/\//.test(s.url)) ? "ok" : "fail", `${sources.length} sources, ${searching} search events`);
  rec("answer cites search context", textOf(r.events).length > 40 ? "ok" : "fail", `${textOf(r.events).length} chars`);
}

/* 5. /api/websearch standalone */
{
  const res = await fetch(`${BASE}/api/websearch`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-revenge-guest": GUEST, origin: BASE },
    body: JSON.stringify({ query: "weather in Port Harcourt" }),
  });
  const j = await res.json();
  rec("POST /api/websearch", res.ok && Array.isArray(j.sources) && j.sources.length > 0 ? "ok" : "fail", `${j.sources?.length ?? 0} sources`);
}

/* 6. vision (image understanding) */
{
  // 1x1 transparent PNG — proves the multimodal plumbing without a big payload
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const r = await chat({
    message: "What colour is this image? One word.",
    modelId: "keyless-nemotron-super-vl",
    attachments: [{ name: "dot.png", type: "image/png", content: png }],
  });
  const text = textOf(r.events);
  rec("vision model accepts attachment", r.ok && text.length > 0 ? "ok" : "fail", `${text.slice(0, 50)} ${r.ok ? "" : r.status + " " + r.raw}`);
}

/* 7. image generation */
for (const modelId of ["keyless-sdxl-ovh", "keyless-bfl-flux-schnell", "keyless-flux-studio"]) {
  const r = await chat({ message: "A red cube on a black background", modelId, imageGen: true }, { timeoutMs: 150_000 });
  const ev = r.events;
  const img = ev.map((e) => e.imageUrl ?? e.url ?? e.image).filter(Boolean)[0];
  const failed = ev.filter((e) => e.type === "error").map((e) => e.error ?? e.message).join(" | ");
  rec(`image gen ${modelId}`, img ? "ok" : "fail", img ? String(img).slice(0, 60) : failed || `${r.status} ${r.raw.slice(0, 120)}`);
}

/* 8. video generation */
for (const modelId of ["keyless-ltx-video-13b"]) {
  const r = await chat({ message: "A paper plane flying over a beach", modelId, videoGen: true }, { timeoutMs: 180_000 });
  const vid = r.events.map((e) => e.videoUrl ?? e.url).filter(Boolean)[0];
  const failed = r.events.filter((e) => e.type === "error").map((e) => e.error ?? e.message).join(" | ");
  rec(`video gen ${modelId}`, vid ? "ok" : "fail", vid ? String(vid).slice(0, 60) : failed || `${r.status} ${r.raw.slice(0, 120)}`);
}

/* 9. code execution / artifact model */
{
  const r = await chat({ message: "Write a JS one-liner that sums [1,2,3] and print the result.", modelId: "revenge-coder-ultra" });
  rec("coding model produces code", /```|=>|\bconst\b|\blet\b/.test(textOf(r.events)) ? "ok" : "fail", `${textOf(r.events).length} chars`);
}

/* 10. providers endpoint */
{
  const res = await fetch(`${BASE}/api/providers`, { headers: { "x-revenge-guest": GUEST, origin: BASE } });
  const j = await res.json();
  const providers = j.providers ?? [];
  const configured = providers.filter((p) => p.hasKey || p.configured).length;
  rec("/api/providers lists providers", res.ok && providers.length > 0 ? "ok" : "fail", `${providers.length} providers, ${configured} configured`);
}

/* 11. persistence of the AI answer */
if (firstConvId) {
  const res = await fetch(`${BASE}/api/conversations/${firstConvId}`, { headers: { "x-revenge-guest": GUEST } });
  const j = await res.json();
  const msgs = j.messages ?? [];
  const hasProvider = msgs.some((m) => m.providerUsed);
  rec("assistant reply persisted with provider metadata", msgs.length >= 2 && hasProvider ? "ok" : "fail", `${msgs.length} messages`);
}

/* 12. rate limiting on chat */
{
  let limited = false;
  for (let i = 0; i < 45; i++) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-revenge-guest": GUEST, origin: BASE },
      body: JSON.stringify({ message: "hi" }),
    });
    if (res.status === 429) { limited = true; break; }
    await res.body?.cancel();
  }
  rec("chat rate limit (40/min)", limited ? "ok" : "fail");
}

const pass = rows.filter((r) => r.ok === "ok").length;
const skip = rows.filter((r) => r.ok === "skip").length;
const fail = rows.filter((r) => r.ok === "fail");
console.log(`\n===== ${pass} pass / ${skip} skip / ${fail.length} fail =====`);
if (fail.length) for (const f of fail) console.log(` FAIL ${f.feature}: ${f.note}`);
