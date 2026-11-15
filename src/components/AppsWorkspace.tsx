"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, AudioLines, BookOpen, Bot, Brain, Clapperboard, Compass, Download, Gamepad2, Image, ImagePlus, Mail, Search, ShieldAlert, Sparkles, Trophy, Type, UsersRound, Wrench } from "lucide-react";
import { DownloaderWorkspace } from "@/components/DownloaderWorkspace";
import { NativeAppWorkspace } from "@/components/NativeAppWorkspace";
import { TemporaryEmailWorkspace } from "@/components/TemporaryEmailWorkspace";
import { RegistryAppWorkspace } from "@/components/RegistryAppWorkspace";
import { EmailOsintWorkspace } from "@/components/EmailOsintWorkspace";
import { CanvasStudioWorkspace } from "@/components/CanvasStudioWorkspace";
import { MovieBoxWorkspace } from "@/components/MovieBoxWorkspace";

const apps = [
  { id: "chat", title: "REVENGE AI", description: "Chat, research, create, and work with your AI assistant.", icon: Bot, label: "Your AI workspace", tint: "from-orange-500/20 to-rose-500/5", color: "text-orange-300", featured: true, group: "Create" },
  { id: "ai-studio", title: "AI Studio", description: "Choose hosted Gemini, Qwen, Ministral, or a community GPT adapter; connect paid API models in REVENGE AI.", icon: Brain, label: "Explore AI models", tint: "from-violet-500/20 to-blue-500/5", color: "text-violet-300", group: "Create" },
  { id: "canvas-studio", title: "Canvas Studio", description: "Design social posts, stories, thumbnails, and posters; export PNGs.", icon: ImagePlus, label: "Design & export", tint: "from-pink-500/20 to-purple-500/5", color: "text-pink-300", group: "Create" },
  { id: "image", title: "Image Studio", description: "Turn a prompt into a new image, then save it.", icon: Image, label: "Create images", tint: "from-fuchsia-500/20 to-violet-500/5", color: "text-fuchsia-300", group: "Create" },
  { id: "image-editing", title: "Image Editing", description: "Remove backgrounds, restyle pictures, upscale, and read image text.", icon: Image, label: "Edit & transform", tint: "from-teal-500/20 to-cyan-500/5", color: "text-teal-300", group: "Create" },
  { id: "textmate", title: "TextMate", description: "Create 18 styles of text graphics from a name or phrase.", icon: Type, label: "Make text art", tint: "from-rose-500/20 to-pink-500/5", color: "text-rose-300", group: "Create" },
  { id: "search", title: "Search Engine", description: "Search the web, videos, music, lyrics, and reference topics.", icon: Search, label: "Explore the web", tint: "from-emerald-500/20 to-teal-500/5", color: "text-emerald-300", group: "Discover" },
  { id: "espn-sports", title: "ESPN Sports", description: "Scores, schedules, teams, news, and standings.", icon: Trophy, label: "Follow the game", tint: "from-red-500/20 to-orange-500/5", color: "text-red-300", group: "Discover" },
  { id: "naijaprey", title: "Naija Prey", description: "Browse public posts, movies, series, and categories.", icon: Compass, label: "Made for discovery", tint: "from-green-500/20 to-yellow-500/5", color: "text-green-300", group: "Discover" },
  { id: "anime", title: "Anime Finder", description: "Search titles and browse covers, episode counts, scores, and details.", icon: Clapperboard, label: "Find your next series", tint: "from-fuchsia-500/20 to-violet-500/5", color: "text-fuchsia-300", group: "Discover" },
  { id: "movie-box", title: "Movie Box", description: "Discover and stream source-licensed classic films, save a watchlist, resume playback, and open downloads at the archive.", icon: Clapperboard, label: "Licensed film discovery", tint: "from-orange-500/20 to-amber-500/5", color: "text-orange-300", group: "Discover" },
  { id: "bilibili-tv", title: "Bilibili TV", description: "Search public videos, creators, and search suggestions.", icon: AudioLines, label: "Videos & creators", tint: "from-sky-500/20 to-cyan-500/5", color: "text-sky-300", group: "Discover" },
  { id: "audiomack", title: "Audiomack", description: "Find artists and songs, browse trending tracks and charts.", icon: AudioLines, label: "Music discovery", tint: "from-orange-500/20 to-amber-500/5", color: "text-orange-300", group: "Discover" },
  { id: "pokemon", title: "Pokémon Explorer", description: "Look up Pokédex data, types, abilities, and Pokémon lists.", icon: Gamepad2, label: "Gotta explore", tint: "from-yellow-500/20 to-red-500/5", color: "text-yellow-300", group: "Discover" },
  { id: "religion", title: "Religion", description: "Look up scripture and find Quran recitations.", icon: BookOpen, label: "Read & reflect", tint: "from-indigo-500/20 to-blue-500/5", color: "text-indigo-300", group: "Discover" },
  { id: "downloader", title: "Downloader", description: "Get download options for public video, audio, and file links.", icon: Download, label: "Media & files", tint: "from-sky-500/20 to-cyan-500/5", color: "text-sky-300", group: "Utilities" },
  { id: "tools", title: "Everyday Tools", description: "Translate, shorten links, capture websites, convert files, and more.", icon: Wrench, label: "Get things done", tint: "from-amber-500/20 to-orange-500/5", color: "text-amber-300", group: "Utilities" },
  { id: "api-tools", title: "30+ More API Tools", description: "31 extra tasks across music, video, web utilities, sports, Pokémon, GitHub, and public data.", icon: Wrench, label: "31 new actions", tint: "from-blue-500/20 to-cyan-500/5", color: "text-blue-300", group: "Utilities" },
  { id: "temporary-email", title: "Get Email", description: "Create unlimited daily inboxes, choose an alias format, or use a custom name on a clearly labeled public mailbox.", icon: Mail, label: "Temporary inbox", tint: "from-cyan-500/20 to-sky-500/5", color: "text-cyan-300", group: "Utilities" },
  { id: "email-osint", title: "Email OSINT", description: "View linked accounts, breach exposure, infostealer indicators, and a risk summary for an authorized email check.", icon: Mail, label: "Authorized self-check", tint: "from-violet-500/20 to-indigo-500/5", color: "text-violet-300", group: "Utilities" },
  { id: "stalk", title: "STALK · Public Profiles", description: "Look up public profiles only—never private accounts or messages.", icon: UsersRound, label: "Public info only", tint: "from-cyan-500/20 to-blue-500/5", color: "text-cyan-300", group: "Utilities" },
  { id: "18+", title: "18+", description: "Age-gated adult search. Third-party results are not hosted by REVENGE.", icon: ShieldAlert, label: "Adults only · 18+", tint: "from-red-500/20 to-rose-500/5", color: "text-red-300", group: "Utilities" },
];
const groups = ["All apps", "Create", "Discover", "Utilities"];
const registryApps = new Set(["ai-studio", "18+", "espn-sports", "naijaprey", "religion", "search", "stalk", "image-editing", "tools", "api-tools", "textmate", "pokemon", "bilibili-tv", "audiomack"]);

export function AppsWorkspace({ onOpenChat, initialApp = null }: { onOpenChat: () => void; initialApp?: string | null }) {
  const [selected, setSelected] = useState<string | null>(() => apps.some(item => item.id === initialApp) ? initialApp : null);
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState("All apps");
  const current = apps.find(item => item.id === selected);
  const visibleApps = useMemo(() => apps.filter(item => (group === "All apps" || item.group === group) && `${item.title} ${item.description} ${item.label}`.toLowerCase().includes(filter.trim().toLowerCase())), [filter, group]);
  if (selected && current) {
    if (selected === "chat") { onOpenChat(); return null; }
    const Icon = current.icon;
    let page;
    if (selected === "downloader") page = <DownloaderWorkspace embedded/>;
    else if (selected === "temporary-email") page = <TemporaryEmailWorkspace/>;
    else if (selected === "email-osint") page = <EmailOsintWorkspace/>;
    else if (selected === "canvas-studio") page = <CanvasStudioWorkspace/>;
    else if (selected === "movie-box") page = <MovieBoxWorkspace/>;
    else if (registryApps.has(selected)) page = <RegistryAppWorkspace key={selected} category={selected} displayName={current.title}/>;
    else page = <NativeAppWorkspace app={selected} embedded/>;
    return <div className="flex h-full min-h-0 flex-col bg-[var(--bg-main)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-6"><button onClick={() => setSelected(null)} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"><ArrowLeft size={16}/> Apps</button><span className="h-5 w-px bg-[var(--border-subtle)]"/><span className={`flex items-center gap-2 text-sm font-semibold ${current.color}`}><Icon size={16}/>{current.title}</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto">{page}</div>
    </div>;
  }
  return <div className="h-full min-h-0 overflow-y-auto bg-[var(--bg-main)]"><div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8"><section className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-8"><div className="pointer-events-none absolute -right-8 -top-16 h-64 w-64 rounded-full bg-[var(--accent)]/10 blur-3xl"/><div className="relative"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]"><Compass size={14}/> REVENGE APP SPACE · {apps.length} EXPERIENCES</div><h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">All your tools, already inside REVENGE.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Choose a task, get a useful result, and keep moving. Find apps by name or browse a collection.</p><label className="mt-5 flex max-w-xl items-center gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-4"><Search size={17} className="shrink-0 text-[var(--text-muted)]"/><input aria-label="Search REVENGE apps" className="min-h-12 w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]" placeholder="Search apps and tasks…" value={filter} onChange={e=>setFilter(e.target.value)}/></label></div></section>
    <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="App collections">{groups.map(item=><button key={item} type="button" onClick={()=>setGroup(item)} className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${group===item?"border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]":"border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"}`}>{item}</button>)}</div>
    <div className="mt-5 flex items-end justify-between"><div><h2 className="text-lg font-semibold">{group}</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{visibleApps.length} {visibleApps.length===1?"app":"apps"} · Tap to open.</p></div><Sparkles className="mb-1 text-[var(--accent)]" size={18}/></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{visibleApps.map(app=>{const Icon=app.icon;return <button type="button" key={app.id} onClick={()=>app.id==="chat"?onOpenChat():setSelected(app.id)} className={`group relative flex min-h-44 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-xl ${app.featured?"sm:col-span-2":""}`}><div className={`pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-gradient-to-br ${app.tint} blur-2xl`}/><div className="relative flex items-start justify-between"><span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${app.tint} ${app.color}`}><Icon size={20}/></span><ArrowRight className="mt-1 text-[var(--text-muted)] transition group-hover:translate-x-1 group-hover:text-[var(--accent)]" size={16}/></div><div className="relative mt-auto pt-6"><div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">{app.label}</div><h3 className="mt-1 text-base font-semibold">{app.title}</h3><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{app.description}</p></div></button>})}</div>
    {visibleApps.length===0&&<div className="mt-4 rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center text-sm text-[var(--text-secondary)]">No apps match “{filter}”. Try another search.</div>}
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-medium">Build with the full REVENGE API</div><p className="mt-1 text-xs text-[var(--text-secondary)]">New API keys are set up for all REVENGE tool areas by default. Manage or limit access in the Developer Portal.</p></div><a href="/developers" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] px-4 py-2 text-xs font-medium hover:border-[var(--accent)]">Developer Portal <ArrowRight size={14}/></a></div>
    </div></div>;
}
