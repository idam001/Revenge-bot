/**
 * Full regression suite for REVENGE GPT.
 * Usage: BASE=https://... node regression.mjs
 * Requires .env.local (DATABASE_URL, NEXT_PUBLIC_SUPABASE_*).
 */
import { readFileSync } from "node:fs";
import WS from "ws";
globalThis.WebSocket = WS;

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const BASE = process.env.BASE || "http://127.0.0.1:3600";
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error("SUPABASE_SERVICE_KEY env var required");

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Supabase helpers (Node 20: use REST directly) ---------------- */
async function sbAdmin(path, init = {}) {
  const res = await fetch(`${SB}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const stamp = Date.now().toString(36);
const PASSWORD = "TestPass!" + Math.random().toString(36).slice(2, 12);

async function createUser(tag) {
  const email = `rgpt.reg.${tag}.${stamp}@example.com`;
  const { status, json } = await sbAdmin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  if (status >= 300) throw new Error(`createUser ${status} ${JSON.stringify(json)}`);
  return { email, id: json.id };
}

/** Build the sb-…-auth-token cookie value that @supabase/ssr would set. */
async function sessionCookieFor(email) {
  const res = await fetch(
    `${SB}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }
  );
  const session = await res.json();
  if (!session.access_token) throw new Error("no session: " + JSON.stringify(session).slice(0, 300));

  const { createServerClient } = await import("@supabase/ssr");
  const jar = [];
  const client = createServerClient(SB, ANON, {
    cookies: { getAll: () => [], setAll: (list) => list.forEach((c) => jar.push(c)) },
  });
  await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return jar.map((c) => `${c.name}=${c.value}`).join("; ");
}

/* ---------------- HTTP helpers ---------------- */
function guestCookieFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const m = /(?:^|;\s*)revenge_guest=([a-f0-9]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

async function api(path, { method = "GET", cookie, guest, body, origin = BASE } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  if (guest) headers["x-revenge-guest"] = guest;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json, res };
}

const createdConvIds = [];
const createdUserIds = [];
const createdGuestScopes = [];

/* =========================== 1. health =========================== */
{
  const { status, json } = await api("/api/health");
  check("health 200 + app name", status === 200 && json?.app === "REVENGE GPT", JSON.stringify(json).slice(0, 80));
}

/* =========================== 2. guest identity =========================== */
let guestA = null;
{
  const { status, json, res } = await api("/api/auth/me");
  guestA = guestCookieFrom(res) || json?.guest?.scopeId || null;
  createdGuestScopes.push(json?.guest?.scopeId);
  check("guest /api/auth/me scoped", status === 200 && json?.authenticated === false && Boolean(json?.guest?.scopeId), `scope=${String(json?.guest?.scopeId).slice(0, 12)}…`);
  check("guest cookie set as httpOnly", (res.headers.getSetCookie?.() ?? []).some((c) => /revenge_guest=/.test(c) && /HttpOnly/i.test(c)));
}

/* =========================== 3. header-only guest data path =========================== */
{
  const scope = createdGuestScopes[0];
  // create conversation WITHOUT any cookie, only the scope header
  const c = await api("/api/conversations", { method: "POST", guest: scope, body: { title: "REG header-only" } });
  const convId = c.json?.conversation?.id;
  if (convId) createdConvIds.push(convId);
  check("POST /api/conversations with header only → 201", c.status === 201 && Boolean(convId), `status=${c.status}`);

  const got = await api(`/api/conversations/${convId}`, { guest: scope });
  check("GET /api/conversations/[id] with header only → 200", got.status === 200 && got.json?.conversation?.id === convId, `status=${got.status}`);

  const patched = await api(`/api/conversations/${convId}`, { method: "PATCH", guest: scope, body: { title: "REG renamed" } });
  check("PATCH conversation with header only → 200", patched.status === 200 && patched.json?.conversation?.title === "REG renamed", `status=${patched.status}`);

  // share needs at least one message in the thread
  await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-revenge-guest": scope, origin: BASE },
    body: JSON.stringify({ conversationId: convId, message: "REGSEARCHTOKEN say hi", modelId: "keyless-glm-5-3" }),
  }).then((r) => r.text());

  const shared = await api("/api/share", { method: "POST", guest: scope, body: { conversationId: convId } });
  check("POST /api/share with header only", shared.status === 200 && Boolean(shared.json?.token), JSON.stringify(shared.json).slice(0, 90));

  const search = await api("/api/search-messages?q=REGSEARCHTOKEN", { guest: scope });
  check("GET /api/search-messages with header only", search.status === 200 && Array.isArray(search.json?.hits) && search.json.hits.length > 0, `hits=${search.json?.hits?.length}`);

  const bad = await api(`/api/conversations/not-a-uuid`, { guest: scope });
  check("malformed conversation id → 404 (no SQL leak)", bad.status === 404 && !/select |invalid input|syntax/i.test(JSON.stringify(bad.json)), `status=${bad.status}`);

  const prov = await api("/api/providers", { guest: scope });
  check("GET /api/providers with header only → 200", prov.status === 200, `status=${prov.status}`);

  const agentList = await api("/api/agent?list=1", { guest: scope });
  check("GET /api/agent?list with header only → 200", agentList.status === 200, `status=${agentList.status}`);

  const stats = await api("/api/stats", { guest: scope });
  check("GET /api/stats with header only → 200", stats.status === 200, `status=${stats.status}`);

  // a DIFFERENT scope must not see it
  const other = await api(`/api/conversations/${convId}`, { guest: "deadbeef".repeat(8) });
  check("other guest scope cannot read conversation → 404", other.status === 404, `status=${other.status}`);

  const del = await api(`/api/conversations/${convId}`, { method: "DELETE", guest: scope });
  check("DELETE conversation with header only → 200", del.status === 200);
}

/* =========================== 4. guest chat + persistence =========================== */
{
  const scope = createdGuestScopes[0];
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-revenge-guest": scope, origin: BASE },
    body: JSON.stringify({ message: "Reply with exactly: REGGEM", modelId: "keyless-glm-5-3" }),
  });
  let text = "";
  if (res.body) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
  }
  const types = [...text.matchAll(/"type":"([a-z]+)"/g)].map((m) => m[1]);
  const convId = /"conversationId":"([^"]+)"/.exec(text)?.[1];
  if (convId) createdConvIds.push(convId);
  check("chat streams content + done", types.includes("content") && types.includes("done"), `events=${[...new Set(types)].join(",")}`);

  // reopen it with ONLY the header (no cookie) — this is the fixed path
  const reopen = await api(`/api/conversations/${convId}`, { guest: scope });
  check("chat history reopen with header only", reopen.status === 200 && reopen.json?.messages?.length >= 2, `msgs=${reopen.json?.messages?.length}`);

  const provider = /"providerUsed":"([^"]+)"/.exec(text)?.[1];
  console.log(`      provider used: ${provider}`);
}

/* =========================== 5. rate limit =========================== */
{
  const scope = createdGuestScopes[0];
  let limited = false;
  for (let i = 0; i < 70; i++) {
    const r = await api("/api/conversations", { method: "POST", guest: scope, body: { title: `RL ${i}` } });
    if (r.status === 429) { limited = true; break; }
    if (r.json?.conversation?.id) createdConvIds.push(r.json.conversation.id);
  }
  check("create-conversation rate limit returns 429", limited);
}

/* =========================== 6. authenticated identity =========================== */
const userA = await createUser("a");
createdUserIds.push(userA.id);
const cookieA = await sessionCookieFor(userA.email);
{
  const me = await api("/api/auth/me", { cookie: cookieA });
  check("signed-in /api/auth/me authenticated", me.status === 200 && me.json?.authenticated === true && me.json?.user?.id === userA.id, `email=${me.json?.user?.email}`);
}

/* =========================== 7. per-user isolation =========================== */
const userB = await createUser("b");
createdUserIds.push(userB.id);
const cookieB = await sessionCookieFor(userB.email);
{
  const me = await api("/api/auth/me", { cookie: cookieB });
  check("user B authenticated", me.json?.authenticated === true && me.json?.user?.id === userB.id);

  const c = await api("/api/conversations", { method: "POST", cookie: cookieA, body: { title: "A private" } });
  const convId = c.json?.conversation?.id;
  if (convId) createdConvIds.push(convId);
  check("user A creates conversation", c.status === 201 && Boolean(convId));

  const listB = await api("/api/conversations", { cookie: cookieB });
  check("user B list excludes A's conversation", !(listB.json?.conversations ?? []).some((x) => x.id === convId));

  const attempts = [
    ["GET", `/api/conversations/${convId}`, undefined],
    ["PATCH", `/api/conversations/${convId}`, { title: "hijacked" }],
    ["DELETE", `/api/conversations/${convId}`, undefined],
  ];
  for (const [m, p, b] of attempts) {
    const r = await api(p, { method: m, cookie: cookieB, body: b });
    check(`user B ${m} A's conversation → 404`, r.status === 404, `status=${r.status}`);
  }

  const fork = await api(`/api/conversations/${convId}`, { method: "POST", cookie: cookieB, body: { action: "fork" } });
  check("user B fork A's conversation → 404", fork.status === 404, `status=${fork.status}`);

  const share = await api("/api/share", { method: "POST", cookie: cookieB, body: { conversationId: convId } });
  check("user B share A's conversation → 404", share.status === 404, `status=${share.status}`);

  const search = await api("/api/search-messages?q=A%20private", { cookie: cookieB });
  const bHits = [...(search.json?.hits ?? []), ...(search.json?.chats ?? [])];
  check("user B search finds nothing of A's", bHits.length === 0, `hits=${bHits.length}`);

  const owned = await api(`/api/conversations/${convId}`, { cookie: cookieA });
  check("A's title intact after B's attempts", owned.json?.conversation?.title === "A private", `title=${owned.json?.conversation?.title}`);
  check("A still sees own conversation", owned.status === 200);
}

/* =========================== 8. guest → account merge =========================== */
{
  const scope = createdGuestScopes[0];
  // guest accumulates a conversation + memory
  const c = await api("/api/conversations", { method: "POST", guest: scope, body: { title: "REG merge me" } });
  const convId = c.json?.conversation?.id;
  if (convId) createdConvIds.push(convId);
  await api("/api/settings", { method: "PATCH", guest: scope, body: { personalInstructions: "REG memory row" } }).catch(() => {});

  const before = await api("/api/conversations", { guest: scope });
  const beforeCount = (before.json?.conversations ?? []).length;

  // now the visitor signs in — guest cookie still present, session cookie added
  const userC = await createUser("c");
  createdUserIds.push(userC.id);
  const cookieC = await sessionCookieFor(userC.email);
  const merged = await api("/api/auth/me", {
    method: "POST",
    cookie: `${cookieC}; revenge_guest=${scope}`,
    body: { action: "merge-guest" },
  });
  check("merge-guest succeeds", merged.status === 200 && merged.json?.ok === true, JSON.stringify(merged.json).slice(0, 140));

  const again = await api("/api/auth/me", {
    method: "POST",
    cookie: `${cookieC}; revenge_guest=${scope}`,
    body: { action: "merge-guest" },
  });
  const idempotent = again.status === 200 && (again.json?.merged === false || again.json?.reason === "already_merged");
  check("merge is idempotent (2nd call)", idempotent, JSON.stringify(again.json).slice(0, 120));

  const afterList = await api("/api/conversations", { cookie: cookieC });
  const afterCount = (afterList.json?.conversations ?? []).length;
  check("merged conversations now belong to the account", afterCount > 0 && afterCount >= Math.min(beforeCount, 1), `guest=${beforeCount} → account=${afterCount}`);

  // guest scope must no longer serve those rows
  const guestAfter = await api(`/api/conversations/${convId}`, { guest: scope });
  check("guest scope no longer resolves merged conversation", guestAfter.status === 404, `status=${guestAfter.status}`);
  const guestList = await api("/api/conversations", { guest: scope });
  check("guest list is empty after merge", (guestList.json?.conversations ?? []).length === 0, `left=${(guestList.json?.conversations ?? []).length}`);

  // another account is unaffected
  const other = await api("/api/conversations", { cookie: cookieB });
  const leaked = (other.json?.conversations ?? []).some((x) => x.id === convId);
  check("merge did not leak into another account", !leaked);
}

/* =========================== 9. sign-out =========================== */
{
  const out = await api("/api/auth/signout", { method: "POST", cookie: cookieA });
  check("sign-out returns ok", out.status === 200 && out.json?.ok === true);
  const cleared = (out.res.headers.getSetCookie?.() ?? []).filter((c) => /sb-.*-auth-token=/.test(c));
  check("sign-out clears session cookie", cleared.length > 0 && cleared.every((c) => /Max-Age=0|max-age=0|Expires=Thu, 01 Jan 1970/i.test(c)), `set-cookie=${cleared.length}`);
  // replaying the old cookie must no longer authenticate
  const stale = await api("/api/auth/me", { cookie: cookieA });
  check("stale cookie no longer authenticates", stale.json?.authenticated === false, `authenticated=${stale.json?.authenticated}`);
}

/* =========================== 10. data integrity =========================== */
{
  const { json } = await sbAdmin(`/rest/v1/conversations?ownerKey=eq.legacy:public&select=id`, {
    headers: { Prefer: "count=exact" },
  });
  const legacyConvs = Array.isArray(json) ? json.length : null;
  const msgs = await sbAdmin(`/rest/v1/messages?ownerKey=eq.legacy:public&select=id`, {
    headers: { Prefer: "count=exact" },
  });
  const legacyMsgs = Array.isArray(msgs.json) ? msgs.json.length : null;
  check("legacy conversations preserved (3)", legacyConvs === 3, `found=${legacyConvs}`);
  check("legacy messages preserved (10)", legacyMsgs === 10, `found=${legacyMsgs}`);
}

/* =========================== cleanup =========================== */
console.log("\n--- cleanup ---");
for (const id of createdConvIds) {
  await sbAdmin(`/rest/v1/messages?conversationId=eq.${id}`, { method: "DELETE" });
  await sbAdmin(`/rest/v1/conversations?id=eq.${id}`, { method: "DELETE" });
}
for (const id of createdUserIds) {
  await sbAdmin(`/rest/v1/guest_merges?userId=eq.${id}`, { method: "DELETE" });
  const r = await sbAdmin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
  console.log(`  deleted user ${id.slice(0, 8)}… → ${r.status}`);
}
for (const scope of createdGuestScopes.filter(Boolean)) {
  const { json } = await sbAdmin(`/rest/v1/conversations?ownerKey=eq.guest:${scope}&select=id`);
  for (const row of json ?? []) {
    await sbAdmin(`/rest/v1/messages?conversationId=eq.${row.id}`, { method: "DELETE" });
    await sbAdmin(`/rest/v1/conversations?id=eq.${row.id}`, { method: "DELETE" });
  }
  await sbAdmin(`/rest/v1/memories?ownerKey=eq.guest:${scope}`, { method: "DELETE" });
  await sbAdmin(`/rest/v1/app_settings?ownerKey=eq.guest:${scope}`, { method: "DELETE" });
}
for (const id of createdUserIds) {
  for (const t of ["conversations", "messages", "memories", "app_settings", "provider_keys", "agent_sessions"]) {
    await sbAdmin(`/rest/v1/${t}?ownerKey=eq.user:${id}`, { method: "DELETE" });
  }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} passed =====`);
if (pass !== results.length) {
  console.log("FAILED:");
  for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name} ${r.extra}`);
  process.exitCode = 1;
}
