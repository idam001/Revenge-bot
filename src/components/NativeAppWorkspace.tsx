"use client";
/* eslint @next/next/no-img-element: off -- user-generated media comes from dynamic third-party URLs. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Clapperboard, Download, ExternalLink, FileCog, Image as ImageIcon, Loader2, Search, Sparkles, Trophy, WandSparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type AppId = "search" | "anime" | "image" | "creator" | "converter" | "sports" | "scripture";
type AppConfig = { title: string; eyebrow: string; description: string; icon: typeof Search; color: string; bg: string; action: string };
const config: Record<AppId, AppConfig> = {
  search: { title: "Web Search", eyebrow: "Find what you need", description: "Search the web and open the sources that look useful.", icon: Search, color: "text-emerald-300", bg: "bg-emerald-500/10", action: "Search the web" },
  anime: { title: "Anime Finder", eyebrow: "Find your next series", description: "Search by title and browse covers, episode counts, scores, genres, and show details.", icon: Clapperboard, color: "text-fuchsia-300", bg: "bg-fuchsia-500/10", action: "Find anime" },
  image: { title: "Image Studio", eyebrow: "Make something visual", description: "Describe the image you want. REVENGE will create it for you.", icon: ImageIcon, color: "text-violet-300", bg: "bg-violet-500/10", action: "Create image" },
  creator: { title: "Text Art Studio", eyebrow: "Turn words into art", description: "Choose a design style, enter your words, and create a graphic.", icon: WandSparkles, color: "text-pink-300", bg: "bg-pink-500/10", action: "Create my design" },
  converter: { title: "File Converter", eyebrow: "Change a file format", description: "Add a shareable file link, choose the format you need, and convert.", icon: FileCog, color: "text-amber-300", bg: "bg-amber-500/10", action: "Convert file" },
  sports: { title: "Sports Center", eyebrow: "Follow the game", description: "See current and upcoming matchups from the league you follow.", icon: Trophy, color: "text-red-300", bg: "bg-red-500/10", action: "Show games" },
  scripture: { title: "Scripture Reader", eyebrow: "Find a passage", description: "Enter a Bible reference and read the verse in a calm, focused view.", icon: BookOpen, color: "text-indigo-300", bg: "bg-indigo-500/10", action: "Read passage" },
};
const creatorStyles = [
  { name: "Cinematic 1917", id: "textmate-effect1917" },
  { name: "Arena game cover", id: "textmate-arena" },
  { name: "Hacker avatar", id: "textmate-hacker" },
  { name: "Neon wordmark", id: "textmate-neon" },
];
const leagues = ["epl", "ucl", "mls", "nba", "nfl", "mlb", "nhl", "wnba", "ufc", "f1", "pga", "atp"];
const formats = ["pdf", "docx", "txt", "jpg", "png", "webp", "mp3", "mp4"];

function normalizeText(value: unknown) { return typeof value === "string" ? value : typeof value === "number" ? String(value) : ""; }
function collectRecords(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (item: unknown) => {
    if (Array.isArray(item)) item.forEach(walk);
    else if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      if (Object.keys(row).some(k => /title|name|url|link|reference|text|home|away/i.test(k))) found.push(row);
      Object.values(row).forEach(walk);
    }
  };
  walk(value); return found;
}
function findLinks(value: unknown): { url: string; label: string }[] {
  const links = new Map<string, string>();
  const walk = (item: unknown, key = "") => {
    if (typeof item === "string") {
      const matches = item.match(/https?:\/\/[^\s"<>\]]+/gi) || [];
      for (const raw of matches) {
        const url = raw.replace(/[),.]+$/, "");
        if (/url|link|download|file|media|image|video|audio/i.test(key) || /download|file/i.test(url)) links.set(url, key.replace(/[_-]/g, " ") || "Open file");
      }
    } else if (Array.isArray(item)) item.forEach(v => walk(v, key));
    else if (item && typeof item === "object") Object.entries(item as Record<string, unknown>).forEach(([k, v]) => walk(v, k));
  };
  walk(value); return [...links].map(([url, label]) => ({ url, label: label.replace(/\b\w/g, c => c.toUpperCase()) })).slice(0, 12);
}
function findImage(value: unknown): string {
  return findLinks(value).find(x => /image|photo|picture|preview|result/i.test(x.label))?.url || "";
}

export function NativeAppWorkspace({ app, embedded = false }: { app: string; embedded?: boolean }) {
  const appId = app as AppId;
  const details = config[appId];
  const Icon = details.icon;
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("web");
  const [style, setStyle] = useState(creatorStyles[0].id);
  const [format, setFormat] = useState("pdf");
  const [league, setLeague] = useState("epl");
  const [dataDate, setDataDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [imageUrl, setImageUrl] = useState("");

  const requestPayload = useMemo(() => {
    if (appId === "search") return { endpointId: "bing-search", method: "GET", params: { q: query.trim(), type: mode, limit: 10 } };
    if (appId === "creator") return { endpointId: style, method: "POST", params: { text: query.trim() } };
    if (appId === "converter") return { endpointId: "freeconvert", method: "POST", params: { url: query.trim(), format } };
    if (appId === "sports") return { endpointId: "espn-scoreboard", method: "GET", params: { league, ...(dataDate ? { date: dataDate.replaceAll("-", "") } : {}) } };
    return { endpointId: "bible", method: "GET", params: { q: query.trim() } };
  }, [appId, query, mode, style, format, league, dataDate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    if (appId !== "sports" && !query.trim()) { setError(appId === "converter" ? "Add the file link first." : "Enter something to get started."); return; }
    if (appId === "converter") {
      try { const url = new URL(query.trim()); if (!/^https?:$/.test(url.protocol)) throw new Error(); }
      catch { setError("Enter a valid public file link beginning with https://."); return; }
    }
    setBusy(true); setError(""); setResult(null); setImageUrl("");
    try {
      if (appId === "image") {
        const response = await apiFetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: query.trim(), conversationId: null, modelId: "revenge-omega-x", personaId: "unchained", forceImageGen: true, ephemeral: true }) });
        if (!response.ok || !response.body) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Image request failed (${response.status}).`); }
        const text = await response.text();
        const events = text.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } });
        const imageEvent = [...events].reverse().find(event => event.type === "image" && typeof event.imageUrl === "string");
        if (imageEvent) setImageUrl(String(imageEvent.imageUrl));
        const failed = events.find(event => event.type === "error");
        if (!imageEvent) throw new Error(typeof failed?.error === "string" ? failed.error : "No image came back. Please try again with a different prompt.");
        return;
      }
      if (appId === "anime") {
        const response = await apiFetch("/api/apps/anime", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: query.trim() }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Anime search is unavailable.");
        setResult(Array.isArray(data.items) ? data.items : []);
        return;
      }
      const response = await apiFetch("/api/revenge-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestPayload) });
      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.error || "Could not complete that task.");
      if (responseData.ok === false) throw new Error(responseData.data?.message || responseData.data?.error || "The service could not complete that task. Try again in a moment.");
      setResult(responseData.data);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  return <section className={`${embedded ? "min-h-full" : "min-h-dvh"} bg-[var(--bg-main)] text-[var(--text-primary)]`}>
    {!embedded && <header className="border-b border-[var(--border-subtle)]"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6"><Link href="/tools" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ArrowLeft size={16}/> All apps</Link><Link href="/developers" className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)]">Developer Portal</Link></div></header>}
    <div className={`mx-auto max-w-5xl px-4 ${embedded ? "py-4 sm:py-6" : "py-8 sm:px-6 sm:py-12"}`}><section className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-9"><div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full bg-[var(--accent)]/10 blur-3xl"/><div className="relative max-w-3xl"><span className={`grid h-12 w-12 place-items-center rounded-2xl ${details.bg} ${details.color}`}><Icon size={24}/></span><p className={`mt-5 text-xs font-bold uppercase tracking-[0.18em] ${details.color}`}>{details.eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{details.title}</h1><p className="mt-3 text-sm leading-6 text-[var(--text-secondary)] sm:text-base">{details.description}</p>
      <form onSubmit={submit} className="mt-7 max-w-2xl space-y-4">
        {appId === "sports" ? <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">League<select className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" value={league} onChange={e => setLeague(e.target.value)}>{leagues.map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label><label className="block text-sm font-medium">Date <span className="font-normal text-[var(--text-muted)]">(optional)</span><input className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" type="date" value={dataDate} onChange={e => setDataDate(e.target.value)}/></label></div> : appId === "creator" ? <><label className="block text-sm font-medium">Design style<select className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" value={style} onChange={e => setStyle(e.target.value)}>{creatorStyles.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="block text-sm font-medium">Your words<input className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} placeholder="Type a name, phrase or short message" required/></label></> : appId === "converter" ? <><label className="block text-sm font-medium">Link to your file<input className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" type="url" inputMode="url" value={query} onChange={e => setQuery(e.target.value)} placeholder="https://example.com/my-file" required/></label><label className="block text-sm font-medium">Convert to<select className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" value={format} onChange={e => setFormat(e.target.value)}>{formats.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select><span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">The source file must be publicly accessible.</span></label></>  : appId === "search" || appId === "anime" ? <><label className="block text-sm font-medium">{appId === "anime" ? "Anime title" : "Search for"}<input autoFocus className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" value={query} onChange={e => setQuery(e.target.value)} placeholder={appId === "anime" ? "Try Naruto, One Piece, or Frieren" : "Ask a question or search a topic"} required/></label>{appId === "search" && <div className="flex gap-2">{[{id:"web",label:"Web"},{id:"image",label:"Images"}].map(item=><button key={item.id} type="button" onClick={()=>setMode(item.id)} className={`rounded-full border px-4 py-2 text-xs font-medium ${mode===item.id?"border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]":"border-[var(--border-subtle)] text-[var(--text-secondary)]"}`}>{item.label}</button>)}</div>}</>: appId === "image" ? <label className="block text-sm font-medium">Describe your image<textarea className="mt-2 min-h-28 w-full resize-y rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" maxLength={1200} value={query} onChange={e => setQuery(e.target.value)} placeholder="A tiny house beside a quiet lake at sunrise, soft watercolor…" required/></label> : <label className="block text-sm font-medium">Passage reference<input className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]" value={query} onChange={e => setQuery(e.target.value)} placeholder="John 3:16 or Psalm 23:1" required/></label>}
        {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        <button disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 sm:w-auto sm:min-w-48">{busy ? <><Loader2 size={17} className="animate-spin"/> Working…</> : <>{details.action} <ArrowRight size={16}/></>}</button>
      </form></div></section>
      {imageUrl && <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:p-6"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="text-emerald-400" size={18}/> Your image is ready</div><div className="overflow-hidden rounded-2xl bg-[var(--bg-main)]"><img src={imageUrl} alt={query} className="mx-auto max-h-[70vh] w-full object-contain"/></div><a href={imageUrl} download="revenge-image.png" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] px-4 py-2.5 text-sm hover:border-[var(--accent)]"><Download size={16}/> Save image</a></section>}
      {result !== null && <AppResult app={appId} value={result}/>}
    </div></section>;
}

function AppResult({ app, value }: { app: AppId; value: unknown }) {
  const records = collectRecords(value);
  const links = findLinks(value);
  const image = findImage(value);
  if (app === "anime") {
    const items = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
    return <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7"><div className="flex items-center gap-2"><CheckCircle2 className="text-emerald-400" size={18}/><h2 className="font-semibold">Anime matches</h2><span className="text-xs text-[var(--text-muted)]">{items.length}</span></div>{items.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{items.map((item,index)=><article key={String(item.id||index)} className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] sm:flex">{typeof item.cover === "string" && item.cover.startsWith("https://") && <img src={item.cover} alt="" className="h-56 w-full object-cover sm:h-auto sm:w-36"/>}<div className="min-w-0 p-4"><h3 className="font-semibold">{normalizeText(item.title)}</h3>{normalizeText(item.nativeTitle) && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{normalizeText(item.nativeTitle)}</div>}<div className="mt-2 flex flex-wrap gap-1.5">{normalizeText(item.episodes) && <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{normalizeText(item.episodes)} episodes</span>}{normalizeText(item.score) && <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">Score {normalizeText(item.score)}%</span>}{normalizeText(item.status) && <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-[10px] capitalize text-[var(--text-secondary)]">{normalizeText(item.status)}</span>}</div>{Array.isArray(item.genres)&&item.genres.length>0&&<div className="mt-2 text-[11px] text-[var(--accent)]">{(item.genres as string[]).slice(0,4).join(" · ")}</div>}{normalizeText(item.description)&&<p className="mt-2 line-clamp-4 text-xs leading-5 text-[var(--text-secondary)]">{normalizeText(item.description)}</p>}{typeof item.url === "string" && item.url.startsWith("https://") && <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">View anime <ExternalLink size={13}/></a>}</div></article>)}</div> : <p className="mt-3 text-sm text-[var(--text-secondary)]">No titles found. Try another name or spelling.</p>}</section>;
  }
  if (app === "search") {
    const entries = records.map(row => ({ title: normalizeText(row.title || row.name || row.text), url: normalizeText(row.url || row.link || row.href || row.image), excerpt: normalizeText(row.snippet || row.description || row.caption || row.content), image: normalizeText(row.thumbnail || row.thumbnailUrl || row.imageUrl) })).filter(x => x.title || x.url).slice(0, 15);
    return <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7"><div className="flex items-center gap-2"><CheckCircle2 className="text-emerald-400" size={18}/><h2 className="font-semibold">Search results</h2></div>{entries.length ? <div className="mt-4 grid gap-3">{entries.map((entry,i)=><article key={`${entry.url}-${i}`} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-4">{entry.image && <img src={entry.image} alt="" className="mb-3 max-h-64 w-full rounded-xl object-cover"/>}<h3 className="font-medium">{entry.title || entry.url}</h3>{entry.excerpt && <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{entry.excerpt}</p>}{entry.url && <a href={entry.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">Open result <ExternalLink size={13}/></a>}</article>)}</div> : <p className="mt-3 text-sm text-[var(--text-secondary)]">The search provider returned no displayable results for that query. Try a different phrase.</p>}</section>;
  }
  if (app === "creator" || app === "converter") return <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7"><div className="flex items-center gap-2"><CheckCircle2 className="text-emerald-400" size={18}/><h2 className="font-semibold">{app === "creator" ? "Your design" : "Your converted file"}</h2></div>{image && <img src={image} alt="Created text design" className="mt-4 max-h-[70vh] w-full rounded-2xl object-contain"/>}{links.length ? <div className="mt-4 flex flex-wrap gap-2">{links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white"><Download size={16}/>{app === "converter" ? "Download converted file" : "Save design"}</a>)}</div> : !image && <p className="mt-3 text-sm text-[var(--text-secondary)]">The task completed, but no downloadable file was included. Try again or choose another style.</p>}</section>;
  if (app === "scripture") {
    const verse = records.map(row=>normalizeText(row.text || row.verse || row.content)).find(Boolean) || "";
    const reference = records.map(row=>normalizeText(row.reference || row.ref || row.book)).find(Boolean) || "";
    const fallback = typeof value === "string" ? value : "";
    return <section className="mt-5 rounded-3xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/10 to-[var(--bg-elevated)] p-6 sm:p-9"><div className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">{reference || "Scripture"}</div><blockquote className="mt-4 font-claude-serif text-2xl leading-relaxed">{verse || fallback || "No passage was found for that reference. Check the book and verse, then try again."}</blockquote></section>;
  }
  if (app === "sports") {
    const events = records.filter(row=>row.name || row.competitions || row.homeTeam || row.awayTeam || row.status || row.shortName).slice(0,20);
    return <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7"><div className="flex items-center gap-2"><CheckCircle2 className="text-emerald-400" size={18}/><h2 className="font-semibold">Games & schedules</h2></div>{events.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{events.map((event,i)=><article key={i} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-4"><h3 className="font-semibold">{normalizeText(event.name || event.shortName || event.competitions) || "Matchup"}</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">{normalizeText(event.status || event.date || event.note || event.competitor)}</p></article>)}</div> : <p className="mt-3 text-sm text-[var(--text-secondary)]">No games were returned for that league and date. Try another league or date.</p>}</section>;
  }
  if (app === "image") return null;
  return <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5"><h2 className="font-semibold">Result</h2>{links.length ? links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="mt-3 block text-sm text-[var(--accent)]">{link.label}</a>) : <p className="mt-2 text-sm text-[var(--text-secondary)]">No results found.</p>}</section>;
}
