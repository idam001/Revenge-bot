"use client";
/* eslint @next/next/no-img-element: off -- Archive.org thumbnails are dynamic source URLs. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, Clapperboard, Download, ExternalLink, Film, Loader2, Play, Search, Share2, ShieldCheck, Star, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type Movie = { id: string; title: string; year: string; description: string; creator: string; license: string; licenseUrl: string; detailsUrl: string; posterUrl: string; videoUrl: string; downloadUrl: string; fileName: string; sizeBytes: number | null };
type Playback = { movie: Movie; at: number; duration: number };
const WATCHLIST_KEY = "revenge.movie-box.watchlist.v1";
const PROGRESS_KEY = "revenge.movie-box.progress.v1";
function prettySize(bytes: number | null) {
  if (!bytes || bytes <= 0) return "Size varies";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}
function safeMovie(value: unknown): value is Movie {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Movie>;
  return typeof item.id === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(item.id) &&
    typeof item.title === "string" && item.title.length <= 180 &&
    typeof item.videoUrl === "string" && item.videoUrl.startsWith("https://archive.org/download/") &&
    typeof item.downloadUrl === "string" && item.downloadUrl.startsWith("https://archive.org/download/") &&
    typeof item.detailsUrl === "string" && item.detailsUrl.startsWith("https://archive.org/details/") &&
    typeof item.posterUrl === "string" && item.posterUrl.startsWith("https://archive.org/services/img/") &&
    typeof item.licenseUrl === "string" && /^https:\/\/(creativecommons\.org|archive\.org)\//.test(item.licenseUrl);
}
function readMovies(key: string): Movie[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter(safeMovie).slice(0, 100) : []; }
  catch { return []; }
}
function readProgress(): Playback[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is Playback => Boolean(entry && typeof entry === "object" && safeMovie((entry as Playback).movie) && Number.isFinite((entry as Playback).at) && Number.isFinite((entry as Playback).duration))).slice(0, 20);
  } catch { return []; }
}

export function MovieBoxWorkspace() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [items, setItems] = useState<Movie[]>([]);
  const [watchlist, setWatchlist] = useState<Movie[]>([]);
  const [progress, setProgress] = useState<Playback[]>([]);
  const [tab, setTab] = useState<"discover" | "watchlist">("discover");
  const [sortBy, setSortBy] = useState<"relevance" | "title" | "year">("relevance");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playbackError, setPlaybackError] = useState("");
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [active, setActive] = useState<Movie | null>(null);
  const [resumeAt, setResumeAt] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setWatchlist(readMovies(WATCHLIST_KEY));
      setProgress(readProgress());
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [hydrated, watchlist]);
  useEffect(() => { if (hydrated) localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress.slice(0, 20))); }, [hydrated, progress]);
  useEffect(() => {
    if (!active || !resumeAt || !videoRef.current) return;
    const video = videoRef.current;
    const restore = () => { video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 2)); };
    if (video.readyState >= 1) restore(); else video.addEventListener("loadedmetadata", restore, { once: true });
    return () => video.removeEventListener("loadedmetadata", restore);
  }, [active, resumeAt]);

  const visibleItems = useMemo(() => {
    const source = tab === "watchlist" ? watchlist : items;
    if (sortBy === "title") return [...source].sort((a, b) => a.title.localeCompare(b.title));
    if (sortBy === "year") return [...source].sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || a.title.localeCompare(b.title));
    return source;
  }, [tab, watchlist, items, sortBy]);
  const search = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNote(""); setItems([]); setSearched(false);
    try {
      const response = await apiFetch("/api/apps/movie-box", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: query.trim(), year }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Movie search failed (${response.status}).`);
      setItems(Array.isArray(data.items) ? data.items : []);
      setNote(typeof data.note === "string" ? data.note : "");
      setSearched(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not search the movie catalog."); }
    finally { setBusy(false); }
  };
  const toggleWatchlist = (movie: Movie) => setWatchlist(current => current.some(item => item.id === movie.id) ? current.filter(item => item.id !== movie.id) : [movie, ...current].slice(0, 100));
  const play = (movie: Movie, at = 0) => { setResumeAt(at); setPlaybackError(""); setPlaybackSpeed(1); setActive(movie); };
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = playbackSpeed; }, [active, playbackSpeed]);
  const seekBy = (seconds: number) => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + seconds); };
  const pictureInPicture = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled || !video.requestPictureInPicture) { setPlaybackError("Picture-in-picture is not supported by this browser."); return; }
    try { await video.requestPictureInPicture(); }
    catch { setPlaybackError("The browser could not start picture-in-picture mode."); }
  };
  const recordProgress = () => {
    const video = videoRef.current;
    if (!active || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const entry = { movie: active, at: video.currentTime, duration: video.duration };
    if (video.currentTime >= video.duration - 8) entry.at = 0;
    setProgress(current => [entry, ...current.filter(item => item.movie.id !== active.id)].slice(0, 20));
  };
  const share = async (movie: Movie) => {
    try { await navigator.clipboard.writeText(movie.detailsUrl); setNote("Archive item link copied."); }
    catch { setNote("Open the Archive item page to share this title."); }
  };

  return <main className="mx-auto max-w-7xl px-4 py-5 text-[var(--text-primary)] sm:px-6 sm:py-8">
    <section className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-8">
      <div className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full bg-orange-500/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><span className="inline-flex items-center gap-2 rounded-full bg-orange-500/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-orange-300"><Clapperboard size={14}/> Public-domain cinema</span><h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Movie Box</h1><p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Discover, stream, save, and download films with source-reported public-domain or Creative Commons metadata. New commercial releases are not included.</p></div><div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200"><ShieldCheck size={15}/> Licensed-source results only</div></div>
      <form onSubmit={search} className="relative mt-6 grid gap-2 sm:grid-cols-[1fr_130px_auto]"><label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4"><Search size={17} className="shrink-0 text-[var(--text-muted)]"/><input aria-label="Movie title search" className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]" placeholder="Search classic film titles… (or leave blank to browse)" maxLength={100} value={query} onChange={e=>setQuery(e.target.value)}/></label><input aria-label="Filter by year" inputMode="numeric" maxLength={4} placeholder="Year (optional)" value={year} onChange={e=>setYear(e.target.value)} className="min-h-12 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4 text-sm outline-none placeholder:text-[var(--text-muted)]"/><button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:opacity-60">{busy?<><Loader2 size={16} className="animate-spin"/>Searching</>:<><Search size={16}/>Find films</>}</button></form>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={()=>{setQuery("");setYear("");void search();}} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:border-orange-400/40 hover:text-orange-200">Browse licensed classics</button>{["Charlie Chaplin", "Buster Keaton", "Horror classics"].map(value=><button key={value} type="button" onClick={()=>{setQuery(value);setTab("discover");void (async()=>{setBusy(true);setError("");try{const response=await apiFetch("/api/apps/movie-box",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:value,year:""})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Search failed");setItems(Array.isArray(data.items)?data.items:[]);setSearched(true);setNote(data.note||"");}catch(e){setError(e instanceof Error?e.message:"Search failed.");}finally{setBusy(false);}})();}} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)]">{value}</button>)}</div>
    </section>

    {active && <section className="mt-5 overflow-hidden rounded-3xl border border-orange-400/20 bg-black"><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-white sm:px-5"><div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-orange-300">Now playing · {active.license}</div><h2 className="truncate text-sm font-semibold">{active.title}{active.year?` (${active.year})`:""}</h2></div><button type="button" onClick={()=>{recordProgress();setActive(null);}} className="rounded-lg px-3 py-2 text-xs text-white/75 hover:bg-white/10">Close player</button></div><video ref={videoRef} key={active.id} className="max-h-[75vh] w-full bg-black" controls autoPlay playsInline preload="metadata" src={active.videoUrl} onTimeUpdate={recordProgress} onEnded={recordProgress} onError={()=>setPlaybackError("The source stream could not be played. Try the download or open the source page.")}>This browser cannot play this video format. Use the download or Archive item link.</video><div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-white/80" role="group" aria-label="Video playback controls"><button type="button" aria-label="Back 10 seconds" onClick={()=>seekBy(-10)} className="rounded-lg border border-white/15 px-3 py-2 hover:bg-white/10">−10s</button><button type="button" aria-label="Forward 10 seconds" onClick={()=>seekBy(10)} className="rounded-lg border border-white/15 px-3 py-2 hover:bg-white/10">+10s</button><label className="flex items-center gap-2">Speed<select aria-label="Playback speed" value={playbackSpeed} onChange={e=>setPlaybackSpeed(Number(e.target.value))} className="rounded-lg border border-white/15 bg-black px-2 py-2 text-white">{[0.75,1,1.25,1.5,2].map(speed=><option key={speed} value={speed}>{speed}×</option>)}</select></label><button type="button" onClick={()=>void pictureInPicture()} className="rounded-lg border border-white/15 px-3 py-2 hover:bg-white/10">Picture in picture</button></div>{playbackError&&<div role="alert" className="px-4 pb-2 text-xs text-amber-200">{playbackError} <a className="underline" href={active.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a></div>}<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-white/70"><span>Hosted by Internet Archive; playback depends on your browser and source availability.</span><a href={active.detailsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-orange-200 hover:underline">Source page <ExternalLink size={13}/></a></div></section>}

    <div className="mt-6 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">{tab === "watchlist" ? "Your watchlist" : searched ? "Search results" : "Start exploring"}</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{tab === "watchlist" ? `${watchlist.length} saved title${watchlist.length===1?"":"s"}` : searched ? `${items.length} license-checked title${items.length===1?"":"s"} · filtered results only` : "Search a title or browse source-licensed classics."}</p></div><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="movie-sort">Sort titles</label><select id="movie-sort" aria-label="Sort movie titles" value={sortBy} onChange={e=>setSortBy(e.target.value as "relevance"|"title"|"year")} className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-main)] px-2 py-2 text-xs"><option value="relevance">Recommended order</option><option value="title">Title A–Z</option><option value="year">Newest year</option></select><button type="button" onClick={()=>setTab("discover")} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab==="discover"?"bg-[var(--accent-soft)] text-[var(--accent)]":"text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}><Film size={14} className="mr-1.5 inline"/>Discover</button><button type="button" onClick={()=>setTab("watchlist")} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab==="watchlist"?"bg-[var(--accent-soft)] text-[var(--accent)]":"text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}><Bookmark size={14} className="mr-1.5 inline"/>Watchlist</button></div></div>

    {error && <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-sm text-rose-200">{error}</div>}{note && <p aria-live="polite" className="mt-3 text-xs text-[var(--text-muted)]">{note}</p>}
    {tab === "discover" && searched && !busy && !items.length && !error && <div className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-[var(--text-secondary)]">No matching titles with explicit compatible license metadata were found. Try another title or browse the Archive catalog directly.</div>}
    {tab === "watchlist" && !watchlist.length && <div className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-[var(--text-secondary)]">Your saved titles will appear here.</div>}
    {visibleItems.length > 0 && <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleItems.map(movie=>{const saved=watchlist.some(item=>item.id===movie.id);const resume=progress.find(item=>item.movie.id===movie.id);return <article key={movie.id} className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"><div className="relative aspect-[16/9] bg-[var(--bg-main)]"><img src={movie.posterUrl} alt={`${movie.title}${movie.year?` (${movie.year})`:""} poster`} loading="lazy" className="h-full w-full object-cover opacity-85"/><span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-semibold text-emerald-200"><Check size={12}/> {movie.license}</span>{movie.year&&<span className="absolute bottom-3 left-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white">{movie.year}</span>}</div><div className="p-4"><h3 className="line-clamp-2 text-base font-semibold">{movie.title}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Internet Archive · direct {movie.fileName.split(".").pop()?.toUpperCase() || "video"} file · {prettySize(movie.sizeBytes)}{movie.creator?` · By ${movie.creator}`:""}</p>{movie.description&&<p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--text-secondary)]">{movie.description}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>play(movie,resume?.at||0)} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-black hover:bg-orange-400"><Play size={14} fill="currentColor"/>{resume?.at?"Resume":"Watch"}</button><a href={movie.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs font-medium hover:border-orange-400/40"><Download size={14}/>Download</a><button type="button" aria-label={saved?"Remove from watchlist":"Save to watchlist"} title={saved?"Remove from watchlist":"Save to watchlist"} onClick={()=>toggleWatchlist(movie)} className={`rounded-lg border px-3 py-2 ${saved?"border-amber-400/30 text-amber-200":"border-[var(--border-strong)] text-[var(--text-secondary)]"}`}><Star size={14} fill={saved?"currentColor":"none"}/></button><button type="button" aria-label="Copy Archive source link" onClick={()=>void share(movie)} className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-[var(--text-secondary)]"><Share2 size={14}/></button><a href={movie.detailsUrl} target="_blank" rel="noopener noreferrer" aria-label="Open Archive source details" className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-[var(--text-secondary)]"><ExternalLink size={14}/></a></div><a href={movie.licenseUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[10px] text-[var(--text-muted)] underline decoration-dotted">Review license at source</a></div></article>})}</div>}
    {tab === "watchlist" && progress.length > 0 && <section className="mt-7 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Continue watching</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Playback position is stored on this device only.</p></div><button type="button" onClick={()=>setProgress([])} className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-rose-300"><Trash2 size={13}/>Clear history</button></div><div className="mt-3 space-y-2">{progress.map(entry=><button key={entry.movie.id} type="button" onClick={()=>play(entry.movie,entry.at)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-[var(--bg-main)] p-3 text-left hover:bg-[var(--bg-main)]/80"><span className="min-w-0"><span className="block truncate text-xs font-medium">{entry.movie.title}</span><span className="mt-1 block text-[10px] text-[var(--text-muted)]">{Math.floor(entry.at/60)}:{String(Math.floor(entry.at%60)).padStart(2,"0")} watched</span></span><Play size={15} className="shrink-0 text-orange-300"/></button>)}</div></section>}
    <p className="mt-7 text-[10px] leading-5 text-[var(--text-muted)]">Movie Box is a discovery/player interface, not a movie host. It shows films only when the Internet Archive metadata reports a public-domain or supported Creative Commons license; rights data may be user-supplied, so review the item’s license page before reusing content. Commercial titles and DRM/paywall circumvention are not supported.</p>
  </main>;
}
