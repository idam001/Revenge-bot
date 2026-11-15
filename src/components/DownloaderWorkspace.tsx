"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, Link2, Loader2, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

const downloaders = [
  { id: "aio", label: "Automatic — recommended" },
  { id: "omdown-all-in-one-downloader", label: "All-in-one (V1)" },
  { id: "all-in-one-v2", label: "All-in-one (V2)" },
  { id: "all-in-one-v3", label: "All-in-one (V3)" },
  { id: "youtube-video-download", label: "YouTube video" },
  { id: "youtube-mp3", label: "YouTube audio / MP3" },
  { id: "youtube-download", label: "YouTube download" },
  { id: "youtube-download-v2", label: "YouTube download (V2)" },
  { id: "ssstik-tiktok-downloader", label: "TikTok" },
  { id: "tiktok-downloader", label: "TikTok (alternate)" },
  { id: "tiktok-mp3", label: "TikTok audio / MP3" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "facebook-v2", label: "Facebook (alternate)" },
  { id: "dailymotion-downloader", label: "Dailymotion" },
  { id: "soundcloud-downloader", label: "SoundCloud" },
  { id: "spotify-downloader", label: "Spotify" },
  { id: "mediafire", label: "MediaFire" },
  { id: "pinterest-download", label: "Pinterest" },
  { id: "pinterest-downloader-v2", label: "Pinterest (alternate)" },
  { id: "threads", label: "Threads" },
  { id: "github-downloader", label: "GitHub repository" },
];
type LinkResult = { url: string; label: string };
function findDownloads(value: unknown): LinkResult[] {
  const found = new Map<string, string>();
  const visit = (item: unknown, label = "") => {
    if (typeof item === "string") {
      const matches = item.match(/https?:\/\/[^\s"<>\]]+/gi) || [];
      for (const raw of matches) {
        const url = raw.replace(/[),.]+$/, "");
        if (/url|link|download|file|media|video|audio|quality|format/i.test(label) || /download|media|video|audio|file/i.test(url)) {
          found.set(url, label.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase()) || "Download file");
        }
      }
    } else if (Array.isArray(item)) item.forEach((v, index) => visit(v, label || `Option ${index + 1}`));
    else if (item && typeof item === "object") Object.entries(item as Record<string, unknown>).forEach(([key, v]) => visit(v, [label, key].filter(Boolean).join(" ")));
  };
  visit(value);
  return [...found].map(([url, label]) => ({ url, label })).slice(0, 12);
}
function resolutionOf(label: string): "4k"|"1080p"|"720p"|"other" { if (/4k|2160p?/i.test(label)) return "4k"; if (/1080p?/i.test(label)) return "1080p"; if (/720p?/i.test(label)) return "720p"; return "other"; }
const input = "w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

export function DownloaderWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [source, setSource] = useState("aio");
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp4");
  const [downloads, setDownloads] = useState<LinkResult[]>([]);
  const [resolution, setResolution] = useState("all");
  const availableResolutions = Array.from(new Set(downloads.map(item => resolutionOf(item.label)).filter(value => value !== "other")));
  const filteredDownloads = resolution === "all" ? downloads : downloads.filter(item => resolutionOf(item.label) === resolution);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    let parsed: URL;
    try { parsed = new URL(url.trim()); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); }
    catch { setError("Enter a full web link beginning with https:// or http://."); return; }
    setBusy(true); setError(""); setMessage(""); setDownloads([]); setResolution("all");
    try {
      const response = await apiFetch("/api/revenge-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpointId: source, method: "POST", params: { url: parsed.toString(), ...(["youtube-download", "youtube-download-v2"].includes(source) ? { format } : {}) } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The downloader could not process that link.");
      if (data.ok === false) throw new Error(data.data?.message || data.data?.error || "This service could not process that link. Try Automatic or check that the post is public.");
      const files = findDownloads(data.data);
      if (!files.length) setMessage("The link was checked, but this source did not return a downloadable file. Try Automatic or another supported source.");
      setDownloads(files);
    } catch (e) { setError(e instanceof Error ? e.message : "Download request failed."); }
    finally { setBusy(false); }
  };

  return <section className={`${embedded ? "min-h-full" : "min-h-dvh"} bg-[var(--bg-main)] text-[var(--text-primary)]`}>
    {!embedded && <header className="border-b border-[var(--border-subtle)]"><div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6"><Link href="/tools" className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ArrowLeft size={16}/> All apps</Link><Link href="/developers" className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)]">Developer Portal</Link></div></header>}
    <div className={`mx-auto max-w-4xl px-4 ${embedded ? "py-4 sm:py-6" : "py-9 sm:py-16"}`}><section className="overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"><div className="relative px-5 py-8 sm:px-10 sm:py-12"><div className="pointer-events-none absolute -right-14 -top-20 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"/><div className="relative mx-auto max-w-2xl"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/10 text-sky-300"><Download size={23}/></div><p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-sky-300">REVENGE DOWNLOADER</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Bring your media link.</h1><p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Paste a supported video, audio, or file link. REVENGE will find available downloads for you.</p>
      <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-sm font-medium"><span className="mb-2 inline-flex items-center gap-2"><Link2 size={15} className="text-sky-300"/> Media URL</span><input className={input} type="url" inputMode="url" autoComplete="url" placeholder="https://…" required value={url} onChange={e => setUrl(e.target.value)}/></label><label className="block text-sm font-medium">Source<select className={`${input} mt-2`} value={source} onChange={e => setSource(e.target.value)}>{downloaders.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{["youtube-download", "youtube-download-v2"].includes(source) && <label className="block text-sm font-medium">Output type<select className={`${input} mt-2`} value={format} onChange={e => setFormat(e.target.value)}><option value="mp4">Video (MP4)</option><option value="mp3">Audio (MP3)</option></select></label>}{error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}<button disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-60">{busy ? <><Loader2 size={17} className="animate-spin"/> Finding your download…</> : <><Download size={17}/> Get download options</>}</button></form>
      <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-400" size={15}/>Only download media you have the right to access. Link support depends on the source service.</div></div></div></section>
      {downloads.length > 0 && <section className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7"><div className="flex items-center gap-2"><CheckCircle2 className="text-emerald-400" size={19}/><h2 className="text-lg font-semibold">Your downloads are ready</h2></div><p className="mt-1 text-sm text-[var(--text-secondary)]">Available formats and resolutions depend on the source. 4K or 1080p appears only when the source returns it.</p>{availableResolutions.length>0&&<label className="mt-4 block max-w-xs text-sm font-medium">Resolution<select className={`${input} mt-2`} value={resolution} onChange={event=>setResolution(event.target.value)}><option value="all">Show all available</option>{availableResolutions.sort((a,b)=>["4k","1080p","720p"].indexOf(a)-["4k","1080p","720p"].indexOf(b)).map(value=><option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>}{filteredDownloads.length===0?<p className="mt-4 text-sm text-amber-200">This source did not return a file at that resolution. Select “Show all available” or try another source.</p>:<div className="mt-4 grid gap-2 sm:grid-cols-2">{filteredDownloads.map((item,i)=><a key={`${item.url}-${i}`} href={item.url} target="_blank" rel="noreferrer" download className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-4 transition hover:border-emerald-400/60"><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.label}</span><span className="mt-1 block truncate text-xs text-[var(--text-muted)]">{item.url}</span></span><Download size={17} className="shrink-0 text-emerald-300"/></a>)}</div>}</section>}
      {message && <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm leading-6 text-[var(--text-secondary)]">{message}</div>}
      <p className="mt-6 text-center text-xs text-[var(--text-muted)]">Need another app? <Link href="/tools" className="text-[var(--accent)] hover:underline">Explore REVENGE</Link></p>
    </div></section>;
}
