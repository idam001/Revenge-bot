"use client";
/* eslint @next/next/no-img-element: off -- result artwork is returned by public provider APIs. */
import { useState } from "react";
import { ArrowUpRight, CheckCircle2, ExternalLink, Loader2, Music2, Search, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { APP_EXPERIENCES, type AppAction, type InputField } from "@/lib/app-experiences";

type RecordValue = Record<string, unknown>;
const inputClass = "mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3.5 py-3 text-sm outline-none focus:border-[var(--accent)]";
const asText = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : value && typeof value === "object" ? asText((value as RecordValue).rendered || (value as RecordValue).name || (value as RecordValue).text || (value as RecordValue).value) : "";
const safeUrl = (value: unknown): string => { const raw = asText(value).trim(); try { const u = new URL(raw); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : ""; } catch { return ""; } };
const titleOf = (row: RecordValue) => asText(row.title || row.name || row.track || row.song || row.filename || row.label || row.username || row.full_name || row.artist_name || row.text) || "Result";
const descriptionOf = (row: RecordValue) => asText(row.description || row.snippet || row.summary || row.bio || row.caption || row.content || row.artist || row.author || row.views || row.date || row.type);
const mediaUrlOf = (row: RecordValue) => safeUrl(row.downloadUrl || row.download_url || row.audio_url || row.audioUrl || row.stream_url || row.streamUrl || row.playUrl || row.play_url || row.video_url || row.videoUrl || row.url || row.link || row.href || row.permalink || row.page_url || row.webpage_url);
const playableUrlOf = (row: RecordValue) => safeUrl(row.audio_url || row.audioUrl || row.stream_url || row.streamUrl || row.video_url || row.videoUrl || row.media_url || row.mediaUrl);
const mediaKindOf = (url: string): "audio"|"video"|"" => /\.(mp3|m4a|aac|ogg|opus|wav)(?:$|[?#])/i.test(url) ? "audio" : /\.(mp4|webm|ogv)(?:$|[?#])/i.test(url) ? "video" : "";
function findDirectVideo(value: unknown, depth = 0): string {
  if (depth > 7 || value == null) return "";
  if (Array.isArray(value)) { for (const child of value.slice(0, 30)) { const found = findDirectVideo(child, depth + 1); if (found) return found; } return ""; }
  if (typeof value !== "object") return "";
  const entries = Object.entries(value as RecordValue);
  for (const [key, item] of entries) {
    if (typeof item !== "string" || !/(video|play|stream|download|source|file|url|src)/i.test(key) || /(page|webpage|thumbnail|image|poster)/i.test(key)) continue;
    const candidate = safeUrl(item);
    if (candidate && /\.(mp4|webm|ogv)(?:$|[?#])/i.test(candidate)) return candidate;
  }
  for (const [key, item] of entries) {
    if (typeof item === "string" && /(video|play|stream|download|source|file|url|src)/i.test(key) && !/(page|webpage|thumbnail|image|poster)/i.test(key)) {
      const candidate = safeUrl(item);
      if (candidate) return candidate;
    }
  }
  for (const [, item] of entries) { const found = findDirectVideo(item, depth + 1); if (found) return found; }
  return "";
}
const imageUrlOf = (row: RecordValue) => {
  const sprites = row.sprites && typeof row.sprites === "object" ? row.sprites as RecordValue : {};
  return safeUrl(row.thumbnail || row.thumbnailUrl || row.cover || row.cover_url || row.coverUrl || row.artwork || row.image || row.image_base || row.imageUrl || row.avatar || row.avatar_url || row.sprite || sprites.front_default || sprites.other && (sprites.other as RecordValue).home && ((sprites.other as RecordValue).home as RecordValue).front_default);
};
function findAssistantText(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) { for (const item of value.slice(0, 8)) { const found = findAssistantText(item, depth + 1); if (found) return found; } return ""; }
  if (typeof value !== "object") return "";
  const row = value as RecordValue;
  for (const key of ["answer", "response", "output_text", "completion", "content", "text", "output", "reply"]) {
    const candidate = row[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (Array.isArray(candidate)) { const found = findAssistantText(candidate, depth + 1); if (found) return found; }
    if (candidate && typeof candidate === "object") { const found = findAssistantText(candidate, depth + 1); if (found) return found; }
  }
  for (const key of ["data", "result", "message", "choices", "completion", "response"]) { const found = findAssistantText(row[key], depth + 1); if (found) return found; }
  return "";
}

function isAudiomackTrack(row: RecordValue) { return Boolean(row.url_slug && (row.duration || row.type === "music" || row.type === "song")); }
function audiomackArtistSlug(row: RecordValue): string {
  const uploader = row.uploader && typeof row.uploader === "object" ? row.uploader as RecordValue : {};
  return asText(uploader.url_slug || row.uploader_url_slug || row.artist_slug || row.artist).toLowerCase().trim().replace(/^https?:\/\/(www\.)?audiomack\.com\//, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}
function audiomackPageUrl(row: RecordValue): string {
  const slug = asText(row.url_slug).toLowerCase().replace(/[^a-z0-9-]/g, "");
  const type = asText(row.type).toLowerCase();
  if (type === "artist" && slug) return `https://audiomack.com/${encodeURIComponent(slug)}`;
  const artist = audiomackArtistSlug(row);
  const kind = type === "album" ? "album" : type === "playlist" ? "playlist" : "song";
  return artist && slug ? `https://audiomack.com/${encodeURIComponent(artist)}/${kind}/${encodeURIComponent(slug)}` : "";
}
function audiomackTrackUrl(row: RecordValue): string {
  const artist = audiomackArtistSlug(row);
  const slug = asText(row.url_slug).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!artist || !slug || !isAudiomackTrack(row)) return "";
  return `https://audiomack.com/embed/${encodeURIComponent(artist)}/song/${encodeURIComponent(slug)}`;
}

function factsFor(value: unknown): Array<[string,string]> {
  if(!value || typeof value!=="object" || Array.isArray(value)) return [];
  const row=value as RecordValue;const facts:Array<[string,string]>=[];
  const label=(key:string)=>key.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  const simple=(v:unknown):string=>{
    if(typeof v==="string"||typeof v==="number"||typeof v==="boolean")return String(v);
    if(Array.isArray(v))return v.map(item=>{if(typeof item==="string"||typeof item==="number")return String(item);if(item&&typeof item==="object"){const x=item as RecordValue;const typeName=x.type&&typeof x.type==="object"?asText((x.type as RecordValue).name):"";const abilityName=x.ability&&typeof x.ability==="object"?asText((x.ability as RecordValue).name):"";return asText(x.name||typeName||abilityName);}return "";}).filter(Boolean).slice(0,8).join(" · ");
    return "";
  };
  for(const [key,v] of Object.entries(row)){
    if(/^(id|url|link|sprites|image|sprite|moves|forms|game_indices|held_items|cries)$/i.test(key))continue;
    if(key==="stats"&&Array.isArray(v)){for(const item of v.slice(0,8)){if(item&&typeof item==="object"){const stat=item as RecordValue;const statName=stat.stat&&typeof stat.stat==="object"?asText((stat.stat as RecordValue).name):"Stat";if(statName&&stat.base_stat!==undefined)facts.push([statName,asText(stat.base_stat)]);}}continue;}
    if(v&&typeof v==="object"&&!Array.isArray(v))continue;
    const valueText=simple(v);if(valueText)facts.push([label(key),valueText]);
  }
  return facts.slice(0,12);
}

function flattenRows(value: unknown): RecordValue[] {
  const rows: RecordValue[] = [];
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 5 || rows.length >= 40) return;
    if (Array.isArray(item)) { item.slice(0, 40).forEach(child => visit(child, depth + 1)); return; }
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    const row = item as RecordValue;
    const keys = Object.keys(row);
    if (keys.some(k => /title|name|url|link|snippet|description|track|artist|sprite|ability|species|score|surah/i.test(k))) rows.push(row);
    for (const [key, child] of Object.entries(row)) {
      if (/items|results|tracks|songs|videos|posts|movies|series|teams|events|entries|data|list|pokemon|abilities|sprites|modules|sections|records/i.test(key)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return rows.slice(0, 24);
}
function findImageData(value: unknown): string {
  if (typeof value === "string") {
    if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) return value;
    if (value.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(value)) return `data:image/png;base64,${value.replace(/\s/g, "")}`;
  }
  if (Array.isArray(value)) { for (const child of value.slice(0, 8)) { const hit = findImageData(child); if (hit) return hit; } }
  if (value && typeof value === "object") {
    const row = value as RecordValue;
    const encoded = asText(row.base64 || row.imageBase64 || row.image_base64 || row.result_base64 || row.imageData);
    if (encoded.length > 2000) return encoded.startsWith("data:image/") ? encoded : `data:${asText(row.mimeType || row.mime_type) || "image/png"};base64,${encoded}`;
    for (const [key, child] of Object.entries(row)) if (/image|result|output|data/i.test(key)) { const hit = findImageData(child); if (hit) return hit; }
  }
  return "";
}
function fieldValue(field: InputField, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (field.type === "number") { const n = Number(value); return Number.isFinite(n) ? String(n) : ""; }
  return value;
}

export function RegistryAppWorkspace({ category, displayName }: { category: string; displayName?: string }) {
  const experience = APP_EXPERIENCES[category];
  const [actionId, setActionId] = useState(experience?.actions[0]?.id || "");
  const action = experience?.actions.find(item => item.id === actionId) || experience?.actions[0];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((experience?.actions[0]?.fields || []).map(field => [field.name, String(experience?.actions[0]?.defaults?.[field.name] ?? "")])));
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [audiomackTrack, setAudiomackTrack] = useState<{ url: string; title: string } | null>(null);
  const title = experience?.title || displayName || "REVENGE App";

  const output = result;
  if (!experience || !action) return <div className="mx-auto max-w-4xl p-8 text-sm text-[var(--text-secondary)]">This app is not available yet.</div>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(""); setResult(null);
    if (action.confirmAdult && !adultConfirmed) { setError("Confirm that you are 18 or older before continuing."); return; }
    const params: Record<string, string | number | boolean> = {};
    for (const field of action.fields) {
      const value = fieldValue(field, values[field.name] || "");
      if (field.required && !value) { setError(`Please complete “${field.label}”.`); return; }
      if ((field.type === "text" || field.type === "textarea") && value.length > 12_000) { setError(`“${field.label}” exceeds the 12,000 character limit.`); return; }
      if (!value) continue;
      if (field.type === "url") {
        const checked = safeUrl(value);
        if (!checked) { setError(`Enter a valid public link for “${field.label}”.`); return; }
        params[field.name] = checked;
      } else if (field.type === "number") params[field.name] = Number(value);
      else if (value === "true" || value === "false") params[field.name] = value === "true";
      else params[field.name] = value;
    }
    for (const [key, value] of Object.entries(action.defaults || {})) if (params[key] === undefined && value !== "") params[key] = value;
    setBusy(true);
    try {
      const isGitHubSearch = action.endpointId === "github-repo-search";
      const response = await apiFetch(isGitHubSearch ? "/api/apps/github" : "/api/revenge-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(isGitHubSearch ? { query: params.query, language: params.language } : { endpointId: action.endpointId, method: action.method || "GET", params, ...(action.confirmAdult ? { confirmAdult: true } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That didn’t work. Please try again.");
      if (!isGitHubSearch && data.ok === false) throw new Error(data.data?.message || data.data?.error || "The service couldn’t return a result. Try another search.");
      setResult(data.data ?? data);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  const Icon = category === "audiomack" ? Music2 : category === "textmate" ? WandSparkles : category === "search" ? Search : Sparkles;
  return <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
    <section className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-8"><div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-[var(--accent)]/10 blur-3xl"/><div className="relative"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon size={21}/></span><div className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Inside REVENGE</div><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">{experience.intro}</p>
      {category === "18+" && <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber-300"/><label className="flex items-start gap-2 text-sm leading-5"><input type="checkbox" checked={adultConfirmed} onChange={e=>setAdultConfirmed(e.target.checked)} className="mt-1 accent-amber-400"/><span>I confirm I am 18 or older and want to view adult search results.</span></label></div>}
      {category === "ai-studio" ? <label className="mt-6 block max-w-2xl text-sm font-medium">Model selector<select aria-label="Choose AI model" className={inputClass} value={action.id} onChange={event=>{const next=experience.actions.find(item=>item.id===event.target.value);if(!next)return;setActionId(next.id);setValues(Object.fromEntries(next.fields.map(field=>[field.name,String(next.defaults?.[field.name]??"")])));setResult(null);setError("");}}>{experience.actions.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><span className="mt-2 block text-xs leading-5 text-[var(--text-muted)]">{action.description}</span></label> : <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{experience.actions.map(item=><button type="button" key={item.id} onClick={()=>{setActionId(item.id);setValues(Object.fromEntries(item.fields.map(field=>[field.name,String(item.defaults?.[field.name]??"")])));setAdultConfirmed(false);setResult(null);setAudiomackTrack(null);setError("");}} className={`rounded-xl border p-3 text-left transition ${action.id===item.id?"border-[var(--accent)]/60 bg-[var(--accent-soft)]":"border-[var(--border-subtle)] bg-[var(--bg-main)] hover:border-[var(--border-strong)]"}`}><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{item.description}</span></button>)}</div>}
      <form onSubmit={submit} className="mt-5 max-w-2xl space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-4 sm:p-5"><div className="mb-1 text-sm font-semibold">{action.title}</div><div className="grid gap-3 sm:grid-cols-2">{action.fields.map(field=><label key={field.name} className={`block text-sm font-medium ${action.fields.length===1?"sm:col-span-2":""}`}>{field.label}{field.type==="select"?<select className={inputClass} required={field.required} value={values[field.name]||""} onChange={e=>setValues(prev=>({...prev,[field.name]:e.target.value}))}><option value="">Choose…</option>{(field.options||[]).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==="textarea"?<textarea className={`${inputClass} min-h-40 resize-y leading-6`} rows={7} maxLength={12000} required={field.required} placeholder={field.placeholder} value={values[field.name]||""} onChange={e=>setValues(prev=>({...prev,[field.name]:e.target.value}))}/>:<input className={inputClass} type={field.type==="url"?"url":field.type==="number"?"number":"text"} inputMode={field.type==="url"?"url":undefined} required={field.required} min={field.type==="number"?1:undefined} maxLength={field.type==="text"?500:undefined} placeholder={field.placeholder} value={values[field.name]||""} onChange={e=>setValues(prev=>({...prev,[field.name]:e.target.value}))}/>}
</label>)}</div>{error&&<div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}<button type="submit" disabled={busy||(action.confirmAdult&&!adultConfirmed)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-44">{busy?<><Loader2 size={16} className="animate-spin"/> Getting results…</>:<>{action.title} <ArrowUpRight size={16}/></>}</button></form>
    </div></section>
    {output!==null&&<ResultPanel value={output} actionTitle={action.title} category={category} adultConfirmed={adultConfirmed} audiomackTrack={audiomackTrack} onPlayAudiomack={setAudiomackTrack}/>}
  </div>;
}

function ResultPanel({ value, actionTitle, category, adultConfirmed, audiomackTrack, onPlayAudiomack }: { value: unknown; actionTitle: string; category: string; adultConfirmed: boolean; audiomackTrack: {url:string;title:string}|null; onPlayAudiomack: (track:{url:string;title:string}|null)=>void }) {
  const [adultVideo, setAdultVideo] = useState<{ url: string; title: string } | null>(null);
  const [adultBusy, setAdultBusy] = useState("");
  const [adultError, setAdultError] = useState("");
  const playAdultResult = async (row: RecordValue, pageUrl: string, title: string) => {
    if (!adultConfirmed) { setAdultError("Confirm you are 18 or older before playing adult results."); return; }
    setAdultError("");
    const direct = findDirectVideo(row) || (mediaKindOf(playableUrlOf(row)) === "video" ? playableUrlOf(row) : "");
    if (direct) { setAdultVideo({ url: direct, title }); return; }
    if (!pageUrl) { setAdultError("This result does not contain a video page link to resolve."); return; }
    setAdultBusy(title);
    try {
      const endpointId = /xnxx/i.test(actionTitle) ? "xnxx-details" : "xvideos-details";
      const response = await apiFetch("/api/revenge-tools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpointId, method: "POST", params: { slug: pageUrl }, confirmAdult: true }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.data?.message || data.data?.error || data.error || "The source could not resolve this video.");
      const videoUrl = findDirectVideo(data.data ?? data);
      if (!videoUrl) throw new Error("The source returned details but no direct playable video URL. Open the result on its source site instead.");
      setAdultVideo({ url: videoUrl, title });
    } catch (error) { setAdultError(error instanceof Error ? error.message : "Could not resolve this video."); }
    finally { setAdultBusy(""); }
  };
  const imageData = findImageData(value);
  const rows = flattenRows(value);
  const directText = typeof value === "string" ? value : category === "ai-studio" ? findAssistantText(value) : "";
  const audioUrl = safeUrl((value&&typeof value==="object"?(value as RecordValue).audioUrl||(value as RecordValue).audio_url||(value as RecordValue).streamUrl:"")||"");
  const normalized = rows.filter((row,index)=>rows.findIndex(x=>titleOf(x)===titleOf(row)&&mediaUrlOf(x)===mediaUrlOf(row))===index).slice(0,16);
  const facts = normalized.length <= 1 ? factsFor(value) : [];
  return <section className="mt-4 overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"><div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3"><CheckCircle2 size={17} className="text-emerald-400"/><h2 className="text-sm font-semibold">{actionTitle} · Results</h2></div><div className="p-4 sm:p-5">
    {category === "18+" && adultConfirmed && adultVideo && <div className="mb-4 overflow-hidden rounded-2xl border border-rose-400/25 bg-black"><div className="flex items-center justify-between gap-3 px-4 py-3 text-white"><div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-wide text-rose-300">REVENGE player</div><div className="truncate text-sm">{adultVideo.title}</div></div><button type="button" onClick={()=>setAdultVideo(null)} className="rounded-lg px-2 py-1 text-xs text-white/70 hover:bg-white/10">Close</button></div><video key={adultVideo.url} className="max-h-[70vh] w-full bg-black" controls autoPlay playsInline preload="auto" src={adultVideo.url}>This browser could not play the video format. Open the source result instead.</video></div>}
    {category === "18+" && adultError && <div role="alert" className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-100">{adultError}</div>}
    {imageData&&<div className="rounded-2xl bg-[var(--bg-main)] p-2"><img src={imageData} alt="Generated image result" className="mx-auto max-h-[70vh] w-full rounded-xl object-contain"/><a href={imageData} download="revenge-result.png" className="mt-2 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-[var(--accent)]"><ExternalLink size={14}/> Save image</a></div>}
    {category === "ai-studio" && directText && <div className="mb-4 whitespace-pre-wrap break-words rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-5 text-sm leading-7 text-[var(--text-primary)]">{directText.slice(0,20000)}</div>}
    {audioUrl&&<audio className="mb-4 w-full" controls src={audioUrl}>Audio playback is not supported in this browser.</audio>}
    {category === "audiomack" && audiomackTrack && <div className="mb-4 overflow-hidden rounded-2xl border border-orange-400/25 bg-[var(--bg-main)]"><div className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-wide text-orange-300">Audiomack player</div><div className="truncate text-sm font-medium">{audiomackTrack.title}</div></div><button type="button" onClick={()=>onPlayAudiomack(null)} className="rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]">Close</button></div><iframe title={`Audiomack player: ${audiomackTrack.title}`} src={audiomackTrack.url} loading="lazy" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" className="h-44 w-full border-0"/></div>}
    {normalized.length>0 && !(category === "ai-studio" && directText)?<><div className="grid gap-3 sm:grid-cols-2">{normalized.map((row,index)=>{const image=imageUrlOf(row),link=category === "audiomack" ? audiomackPageUrl(row) : mediaUrlOf(row),title=titleOf(row),desc=descriptionOf(row),playable=playableUrlOf(row),mediaKind=mediaKindOf(playable);return <article key={`${title}-${link}-${index}`} className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] sm:flex">{image&&<img src={image} alt="" loading="lazy" className="h-44 w-full object-cover sm:h-auto sm:w-32"/>}<div className="min-w-0 flex-1 p-4"><h3 className="text-sm font-semibold">{title}</h3>{desc&&<p className="mt-1 line-clamp-4 break-words text-xs leading-5 text-[var(--text-secondary)]">{desc}</p>}{category === "18+" && adultConfirmed && link && <button type="button" disabled={adultBusy===title} onClick={()=>void playAdultResult(row,link,title)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60">{adultBusy===title?<><Loader2 size={14} className="animate-spin"/> Resolving video…</>:<>▶ {mediaKindOf(playableUrlOf(row)) === "video" || findDirectVideo(row) ? "Play video" : "Resolve & play"}</>}</button>}{category === "audiomack" && link && isAudiomackTrack(row) && <button type="button" onClick={()=>onPlayAudiomack({url:audiomackTrackUrl(row),title})} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-200 hover:bg-orange-500/25"><Music2 size={14}/> Play track</button>}{mediaKind === "audio"&&<audio className="mt-3 w-full" controls preload="none" src={playable}>Audio playback is not supported in this browser.</audio>}{mediaKind === "video"&&<video className="mt-3 max-h-72 w-full rounded-lg bg-black" controls playsInline preload="none" src={playable}>Video playback is not supported in this browser.</video>}{link&&<a href={link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline">Open result <ExternalLink size={13}/></a>}</div></article>;})}</div>{facts.length>0&&<div className="mt-3 flex flex-wrap gap-2">{facts.map(([label,value])=><span key={label} className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"><strong className="mr-1 text-[var(--text-primary)]">{label}:</strong>{value}</span>)}</div>}</>:directText&&category!=="ai-studio"?<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--bg-main)] p-4 text-sm leading-6 text-[var(--text-secondary)]">{directText.slice(0,12000)}</pre>:!imageData&&!audioUrl&&!(category==="ai-studio"&&directText)&&<p className="text-sm text-[var(--text-secondary)]">The request completed, but the service didn’t return results to display. Try another search or option.</p>}
  </div></section>;
}
