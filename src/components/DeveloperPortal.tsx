"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Check, Code2, Copy, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type KeyRow = {
  id: string; name: string; prefix: string; scopes: string[]; requestsPerMinute: number;
  totalRequests: number; requestsLast30Days: number; lastUsedAt: string | null;
  allowedCategories: string[]; expiresAt: string | null; revokedAt: string | null; createdAt: string;
};
type CategoryOption = { id: string; name: string };
const box = "rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]";
const input = "w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

export function DeveloperPortal() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [newSecret, setNewSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"curl" | "javascript" | "python">("curl");

  const fetchKeys = useCallback(async () => {
    const response = await apiFetch("/api/developer/keys", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load keys.");
    return { keys: (data.keys || []) as KeyRow[], categories: (data.categories || []) as CategoryOption[] };
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await fetchKeys();
      setKeys(data.keys); setCategories(data.categories);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load keys."); }
    finally { setLoading(false); }
  }, [fetchKeys]);
  useEffect(() => {
    let alive = true;
    fetchKeys().then(data => { if (alive) { setKeys(data.keys); setCategories(data.categories); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "Could not load keys."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fetchKeys]);
  const [now] = useState(() => Date.now());

  const createKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setNewSecret("");
    try {
      const response = await apiFetch("/api/developer/keys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, expiresInDays, allowedCategories: selectedCategories.length ? selectedCategories : categories.map(category => category.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create key.");
      setNewSecret(data.secret); setName(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create key."); }
    finally { setBusy(false); }
  };

  const revoke = async (key: KeyRow) => {
    if (!window.confirm(`Revoke “${key.name}”? Any scripts using this key will stop working immediately.`)) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/developer/keys", {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: key.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke key.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not revoke key."); }
    finally { setBusy(false); }
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setError("Clipboard access was blocked. Select and copy the text instead."); }
  };

  const example = tab === "curl"
    ? `export REVENGE_API_KEY="your-key"\ncurl -s https://revenge-gpt.vercel.app/api/revenge-tools \\\n  -H "Authorization: Bearer $REVENGE_API_KEY"\n\n# Execute a catalog action\ncurl -s https://revenge-gpt.vercel.app/api/revenge-tools \\\n  -H "Authorization: Bearer $REVENGE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"endpointId":"bible","method":"GET","params":{"q":"John 3:16"}}'`
    : tab === "javascript"
      ? `const key = process.env.REVENGE_API_KEY;\nconst response = await fetch(\n  "https://revenge-gpt.vercel.app/api/revenge-tools",\n  { headers: { Authorization: \`Bearer \${key}\` } }\n);\nconst catalog = await response.json();\n\nconst result = await fetch(\n  "https://revenge-gpt.vercel.app/api/revenge-tools",\n  {\n    method: "POST",\n    headers: { Authorization: \`Bearer \${key}\`, "Content-Type": "application/json" },\n    body: JSON.stringify({ endpointId: "bible", method: "GET", params: { q: "John 3:16" } })\n  }\n).then(r => r.json());`
      : `import os, requests\nkey = os.environ["REVENGE_API_KEY"]\nbase = "https://revenge-gpt.vercel.app/api/revenge-tools"\nheaders = {"Authorization": f"Bearer {key}"}\n\ncatalog = requests.get(base, headers=headers, timeout=30).json()\nresult = requests.post(\n    base, headers={**headers, "Content-Type": "application/json"},\n    json={"endpointId": "bible", "method": "GET", "params": {"q": "John 3:16"}},\n    timeout=150,\n).json()`;

  return (
    <main className="min-h-dvh bg-[var(--bg-main)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/chat" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ArrowLeft size={16} /> Back to REVENGE</Link>
          <span className="inline-flex items-center gap-2 text-sm font-semibold"><Code2 size={17} className="text-[var(--accent)]" /> Developer Portal</span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[var(--accent)]/10 blur-3xl" />
          <div className="relative max-w-3xl">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Build with REVENGE</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your tools. Your keys. Your code.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Create a private credential for your scripts, inspect the supported tool catalog, and track recent usage. Your key is shown once, stored as a one-way hash, and can be revoked at any time.</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
              <span className="rounded-full border border-[var(--border-strong)] px-3 py-1.5">30 requests / minute / key</span>
              <span className="rounded-full border border-[var(--border-strong)] px-3 py-1.5">Maximum 10 active keys</span>
              <span className="rounded-full border border-[var(--border-strong)] px-3 py-1.5">Default expiry: 90 days</span>
            </div>
          </div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {newSecret && <section className={`${box} border-[var(--accent)]/50 p-5 sm:p-6`}>
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-400" size={21} /><div className="min-w-0 flex-1">
            <h2 className="font-semibold">API key created — copy it now</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">For your security, REVENGE cannot show this secret again. Put it in a secret manager or an environment variable, never in browser code or a public repository.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] p-3 text-xs">{newSecret}</code><button onClick={() => void copy(newSecret)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--text-primary)] px-4 py-3 text-sm font-semibold text-[var(--bg-main)]">{copied ? <Check size={16}/> : <Copy size={16}/>} Copy key</button></div>
          </div></div>
        </section>}

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className={`${box} p-5 sm:p-6`}>
            <div className="flex items-center gap-2"><KeyRound className="text-[var(--accent)]" size={19}/><h2 className="text-lg font-semibold">Create an API key</h2></div>
            <p className="mt-2 text-sm leading-5 text-[var(--text-secondary)]">New keys include every REVENGE API area by default. You can uncheck areas to create a deliberately restricted key. Keep secrets out of frontend apps.</p>
            <form onSubmit={createKey} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">Key name<input className={`${input} mt-1.5`} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. my automation server" maxLength={48} required /></label>
              <label className="block text-sm font-medium">Expires after<select className={`${input} mt-1.5`} value={expiresInDays} onChange={e => setExpiresInDays(Number(e.target.value))}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select><span className="mt-1 block text-xs text-[var(--text-muted)]">Rotation is recommended; you can revoke any key immediately.</span></label>
              <fieldset className="rounded-xl border border-[var(--border-subtle)] p-3"><div className="flex items-center justify-between gap-2"><legend className="text-sm font-medium">Allowed tool areas</legend><button type="button" onClick={() => setSelectedCategories([])} className="text-xs text-[var(--accent)]">All areas</button></div><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Choose which capabilities this key can execute. The catalog remains readable.</p><div className="mt-3 grid max-h-44 grid-cols-2 gap-2 overflow-y-auto">{categories.map(category => { const selected = selectedCategories.length === 0 || selectedCategories.includes(category.id); return <label key={category.id} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><input type="checkbox" checked={selected} onChange={event => { const current = selectedCategories.length ? selectedCategories : categories.map(item => item.id); if (!event.target.checked && current.length === 1) return; const next = event.target.checked ? [...new Set([...current, category.id])] : current.filter(id => id !== category.id); setSelectedCategories(next.length === categories.length ? [] : next); }} className="accent-[var(--accent)]"/>{category.name}</label>; })}</div></fieldset>
              <button disabled={busy || categories.length === 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17}/> : <Plus size={17}/>} Generate secret key</button>
            </form>
          </section>
          <section className={`${box} p-5 sm:p-6`}>
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Activity className="text-[var(--accent)]" size={19}/><h2 className="text-lg font-semibold">Your keys</h2></div><button onClick={() => void load()} className="text-xs text-[var(--text-secondary)] underline underline-offset-4">Refresh</button></div>
            <div className="mt-4 space-y-2">
              {loading ? <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-muted)]"><Loader2 className="animate-spin" size={16}/>Loading keys…</div> : keys.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">No keys yet. Generate one to connect a script.</div> : keys.map(key => <article key={key.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3.5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{key.name}</strong><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= now) ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>{key.revokedAt ? "Revoked" : key.expiresAt && Date.parse(key.expiresAt) <= now ? "Expired" : "Active"}</span></div><code className="mt-1 block text-xs text-[var(--text-muted)]">{key.prefix}</code></div>{!key.revokedAt && <button disabled={busy} onClick={() => void revoke(key)} title="Revoke key" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"><Trash2 size={16}/></button>}</div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]"><span>{key.totalRequests.toLocaleString()} total calls</span><span>{key.requestsLast30Days.toLocaleString()} in 30 days</span><span>{key.allowedCategories?.length ? `${key.allowedCategories.length} categories` : "All categories"}</span><span>30/min limit</span></div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : `Created ${new Date(key.createdAt).toLocaleDateString()}`}{key.expiresAt ? ` · Expires ${new Date(key.expiresAt).toLocaleDateString()}` : ""}</div>
              </article>)}
            </div>
          </section>
        </div>

        <section className={`${box} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><div className="flex items-center gap-2"><Code2 className="text-[var(--accent)]" size={19}/><h2 className="text-lg font-semibold">Use the API from a script</h2></div><p className="mt-1 text-sm text-[var(--text-secondary)]">Base URL: <code>https://revenge-gpt.vercel.app/api/revenge-tools</code></p></div><Link href="/tools" className="text-sm font-medium text-[var(--accent)] hover:underline">Open REVENGE apps →</Link></div>
          <div className="flex flex-wrap gap-1 px-5 pt-4 sm:px-6">{(["curl", "javascript", "python"] as const).map(value => <button key={value} onClick={() => setTab(value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${tab === value ? "bg-[var(--bg-elevated-2)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>{value === "curl" ? "cURL" : value}</button>)}</div>
          <div className="relative p-5 sm:px-6"><pre className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[#171716] p-4 pr-16 text-xs leading-6 text-[#e8e7e2]"><code>{example}</code></pre><button onClick={() => void copy(example)} title="Copy example" className="absolute right-8 top-8 rounded-lg border border-white/15 bg-white/5 p-2 text-white/75 hover:text-white">{copied ? <Check size={15}/> : <Copy size={15}/>}</button><p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">Requests use HTTPS and a Bearer token. The API key is rate-limited per key; requests return HTTP 429 with a <code>Retry-After</code> header when you reach the limit. Use the tool catalog response to choose valid action IDs, methods, and parameters.</p></div>
        </section>
        <p className="pb-3 text-center text-xs text-[var(--text-muted)]">REVENGE API credentials are separate from your AI provider keys. Never share them or put them in client-side code.</p>
      </div>
    </main>
  );
}
