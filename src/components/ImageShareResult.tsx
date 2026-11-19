"use client";
/* eslint @next/next/no-img-element: off -- public storage image URL is user-specific. */
import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export function ImageShareResult({ value }: { value: Record<string, unknown> }) {
  const url = typeof value.url === "string" ? value.url : "";
  const path = typeof value.path === "string" ? value.path : "";
  const filename = typeof value.filename === "string" ? value.filename : "Uploaded image";
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleted, setDeleted] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setMessage("Public image URL copied."); setTimeout(() => setCopied(false), 1800); }
    catch { setMessage("Copy was blocked. Select the URL field and copy it manually."); }
  };
  const remove = async () => {
    if (!path || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch("/api/tools/image-url", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete the image.");
      setDeleted(true); setMessage("Image deleted. Its public link should no longer work.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete the image."); }
    finally { setBusy(false); }
  };

  return <section className="mb-4 rounded-2xl border border-emerald-400/20 bg-[var(--bg-main)] p-4" aria-label="Uploaded image link">
    <h3 className="text-sm font-semibold">{deleted ? "Image removed" : "Your public image URL"}</h3>
    {!deleted && <>
      <img src={url} alt={`Uploaded image: ${filename}`} className="mt-3 max-h-72 max-w-full rounded-xl object-contain"/>
      <label className="mt-3 block text-xs font-medium">Share URL<input aria-label="Public image URL" readOnly value={url} onFocus={event => event.currentTarget.select()} className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-3 text-xs"/></label>
      <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Anyone with this URL can view the image. It stays available until you delete it or the storage project removes it.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white">{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? "Copied" : "Copy URL"}</button><a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs"><ExternalLink size={14}/> Open image</a><button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-200 disabled:opacity-60">{busy ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>} Delete image</button></div>
    </>}
    {message && <p role="status" aria-live="polite" className="mt-3 text-xs text-[var(--text-secondary)]">{message}</p>}
  </section>;
}
