"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, ExternalLink, Globe2, LoaderCircle, Rocket, Upload, X } from "lucide-react";
import { startGoogleSignIn } from "@/lib/supabase-browser";

type Site = { site_url: string; title: string; updated_at: string };
const panel = "rounded-2xl border border-white/[0.09] bg-white/[0.035]";

export function HostSiteWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("My website");
  const [site, setSite] = useState<Site | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [apkUrl, setApkUrl] = useState("");
  const [apkName, setApkName] = useState("My website");
  const [apkPackage, setApkPackage] = useState("com.example.myapp");
  const [apkBusy, setApkBusy] = useState(false);
  const [apkNotice, setApkNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/host-site", { cache: "no-store" });
      if (response.status === 401) {
        const result = await startGoogleSignIn("/host");
        if (result.error) setNotice(result.error);
        return;
      }
      const data = await response.json();
      setConfigured(Boolean(data.configured));
      if (data.site) { setSite(data.site); setTitle(data.site.title || "My website"); }
    } catch { setNotice("Could not load your hosting status."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function deploy(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setNotice("Choose a ZIP file first."); return; }
    setBusy(true); setNotice("");
    const form = new FormData(); form.set("site", file); form.set("title", title);
    try {
      const response = await fetch("/api/host-site", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed.");
      setSite(result.site); setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setNotice(`Published ${result.files} files successfully.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Deployment failed. Try again."); }
    finally { setBusy(false); }
  }

  async function makeApkStarter(event: React.FormEvent) {
    event.preventDefault(); setApkBusy(true); setApkNotice("");
    try {
      const response = await fetch("/api/apk-starter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: apkUrl, appName: apkName, packageId: apkPackage }) });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || "Could not prepare the Android starter."); }
      const blob = await response.blob(); const downloadUrl = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = downloadUrl; anchor.download = `${apkPackage.replaceAll(".", "-")}-android-starter.zip`; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(downloadUrl);
      setApkNotice("Android TWA starter downloaded. Follow its README to build and sign the APK.");
    } catch (error) { setApkNotice(error instanceof Error ? error.message : "Could not prepare the Android starter."); }
    finally { setApkBusy(false); }
  }

  async function copyLink() {
    if (!site?.site_url) return;
    try { await navigator.clipboard.writeText(site.site_url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setNotice("Could not access clipboard. Open the site link to copy it manually."); }
  }

  return (
    <main className="min-h-screen bg-[#151513] px-4 pb-12 pt-8 text-[#eeeae3] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-white"><ArrowLeft size={16} /> Back to REVENGE</Link>
        <div className="mb-7 flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#d97757]/15 text-[#e89475]"><Globe2 size={22} /></div>
          <div><p className="text-xs font-semibold uppercase tracking-[.19em] text-[#df967a]">Publish</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Host a website</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/55">Upload a static site ZIP and publish it on a free HTTPS link. One hosted site per account; upload again to replace it.</p></div>
        </div>

        {site?.site_url && <section className={`${panel} mb-5 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="flex items-center gap-2 text-sm font-medium"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Live website</div><p className="mt-1 text-xs text-white/45">Last published {new Date(site.updated_at).toLocaleString()}</p></div>
            <span className="max-w-full truncate rounded-full bg-white/[.06] px-3 py-1 text-xs text-white/60">{site.title || "My website"}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={site.site_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#d97757] px-4 py-2.5 text-sm font-medium text-[#171411] hover:bg-[#e79072]">Open site <ExternalLink size={15} /></a>
            <button onClick={() => void copyLink()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm hover:bg-white/[.05]">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
          </div>
        </section>}

        <form onSubmit={deploy} className={`${panel} p-5 sm:p-6`}>
          <div className="mb-5 flex items-center gap-2"><Upload size={17} className="text-[#e89475]"/><h2 className="font-medium">{site ? "Update your site" : "Upload your website"}</h2></div>
          <label className="mb-2 block text-xs font-medium text-white/65" htmlFor="site-title">Site name</label>
          <input id="site-title" value={title} maxLength={70} onChange={(event) => setTitle(event.target.value)} className="mb-5 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm outline-none transition placeholder:text-white/30 focus:border-[#d97757]/70" placeholder="My portfolio" />
          <input ref={inputRef} type="file" accept=".zip,application/zip" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] || null); setNotice(""); }} />
          <button type="button" onClick={() => inputRef.current?.click()} className="group flex min-h-40 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/10 px-5 text-center transition hover:border-[#d97757]/60 hover:bg-white/[.025]">
            <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-white/[.06] text-white/70 group-hover:text-[#e89475]"><Upload size={19}/></span>
            <span className="text-sm font-medium">{file ? file.name : "Choose your static-site ZIP"}</span>
            <span className="mt-1.5 text-xs text-white/45">Up to 20 MB ZIP · HTML, CSS, JavaScript, images and fonts</span>
          </button>
          <div className="mt-4 rounded-xl bg-white/[.035] px-4 py-3 text-xs leading-5 text-white/55"><span className="font-medium text-white/75">ZIP must contain <code className="rounded bg-white/10 px-1 py-0.5">index.html</code> at its root.</span> For example, zip the files themselves—not an outer folder containing them. No server-side PHP, database, or build step.</div>
          {!configured && <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.07] p-3 text-xs leading-5 text-amber-100/80">Hosting is not configured on this deployment yet. The administrator must finish Cloudflare Pages credentials before publishing.</p>}
          {notice && <p role="status" className="mt-4 rounded-xl border border-white/10 bg-white/[.04] p-3 text-sm leading-5 text-white/75">{notice}</p>}
          <button disabled={busy || loading || !configured || !file} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#d97757] px-4 py-3 text-sm font-semibold text-[#171411] transition hover:bg-[#e79072] disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? <><LoaderCircle size={17} className="animate-spin"/> Publishing your site…</> : <><Rocket size={16}/>{site ? "Publish site update" : "Publish my site"}</>}
          </button>
          <p className="mt-3 text-center text-[11px] leading-5 text-white/40">Limit: 500 files · 40 MB uncompressed total · 5 MB per file. Re-publishing replaces your existing hosted site.</p>
        </form>
        <section className={`${panel} mt-5 p-5 sm:p-6`}>
          <div className="mb-2 flex items-center gap-2"><Rocket size={16} className="text-[#e89475]"/><h2 className="text-sm font-medium">Website URL to Android app starter</h2></div>
          <p className="mb-4 text-xs leading-5 text-white/50">Create a downloadable Android TWA setup project for a public HTTPS website. It includes tailored Bubblewrap instructions; you’ll build and sign the APK on your computer, then verify your domain. This tool does not pretend an unsigned source ZIP is an installable APK.</p>
          <form onSubmit={(event) => void makeApkStarter(event)} className="space-y-3">
            <label className="block"><span className="mb-1.5 block text-xs text-white/65">Public HTTPS website URL</span><input type="url" required value={apkUrl} onChange={(event) => setApkUrl(event.target.value)} placeholder="https://example.com" className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm outline-none focus:border-[#d97757]/70" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1.5 block text-xs text-white/65">App name</span><input value={apkName} maxLength={50} onChange={(event) => setApkName(event.target.value)} placeholder="My website" className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm outline-none focus:border-[#d97757]/70" /></label>
              <label><span className="mb-1.5 block text-xs text-white/65">Android package ID</span><input value={apkPackage} maxLength={180} onChange={(event) => setApkPackage(event.target.value)} placeholder="com.example.myapp" className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm outline-none focus:border-[#d97757]/70" /></label>
            </div>
            {apkNotice && <p role="status" className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-xs leading-5 text-white/70">{apkNotice}</p>}
            <button disabled={apkBusy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium transition hover:bg-white/[.05] disabled:opacity-50">{apkBusy ? <><LoaderCircle size={16} className="animate-spin"/>Preparing…</> : <><Rocket size={15}/>Download Android starter project</>}</button>
          </form>
          <p className="mt-3 text-[11px] leading-5 text-white/40">An installable, signed APK needs Android build tools, your signing key, a valid web manifest and domain ownership proof (Digital Asset Links).</p>
        </section>
        {loading && <p className="mt-4 flex items-center justify-center gap-2 text-xs text-white/45"><LoaderCircle className="animate-spin" size={14}/> Checking your hosting slot…</p>}
      </div>
    </main>
  );
}
