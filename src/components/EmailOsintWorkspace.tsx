"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MailSearch, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type SafeReport = {
  accounts: Array<{ platform: string; domain: string; fields: Array<{ label: string; value: string }> }>;
  registered: string[];
  unregistered: string[];
  dataBreaches: { amount: number; sources: number; results: Array<{ name: string; date: string }> };
  stealerLogs: { count: number; results: Array<{ source: string; date: string }> };
  aiSummary: { headline: string; bullets: string[]; risk: string; riskReason: string } | null;
  meta: { durationMs: number | null; completed: boolean | null; timedOut: boolean | null };
};
type Result = {
  domain: string;
  mxStatus: "found" | "none" | "unknown";
  mx: string[];
  emailOsint: { status: "checked" | "not_configured" | "requires_plan" | "unauthorized" | "rate_limited" | "unavailable"; message?: string; report?: SafeReport };
  breachCheck: { status: "checked" | "not_configured" | "unavailable"; breaches?: Array<{ name: string; domain: string; date: string | null; dataClasses: string[] }> };
  checkedAt: string;
};
const input = "mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3.5 py-3 text-sm outline-none focus:border-[var(--accent)]";
const panel = "rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-4";
const tags = "mt-2 flex flex-wrap gap-1.5";

export function EmailOsintWorkspace() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setResult(null);
    if (!consent) { setError("Confirm that you own this address or have permission to check it."); return; }
    setBusy(true);
    try {
      const response = await apiFetch("/api/apps/email-osint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, consent }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check this address.");
      setResult(data as Result);
    } catch (e) { setError(e instanceof Error ? e.message : "The check failed. Please try again."); }
    finally { setBusy(false); }
  };

  const report = result?.emailOsint.report;
  const riskTone = report?.aiSummary?.risk === "high" ? "text-red-300 border-red-500/30 bg-red-500/10" : report?.aiSummary?.risk === "medium" ? "text-amber-200 border-amber-500/30 bg-amber-500/10" : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
  return <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-8">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/10 text-violet-300"><MailSearch size={22}/></span>
      <div className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-violet-300">EmailOSINT · Authorized checks</div>
      <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Email OSINT</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">Run a full EmailOSINT report: linked public accounts, breach sources, infostealer exposure indicators, and an AI risk summary. We also check the address domain’s mail routing. The address is sent to EmailOSINT for lookup; REVENGE does not store it or display captured passwords. The provider may retain lookup history under its own account and privacy settings.</p>
      <form onSubmit={submit} className="mt-6 max-w-2xl space-y-4">
        <label className="block text-sm font-medium">Email address<input className={input} type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label className="flex items-start gap-2 text-sm leading-5 text-[var(--text-secondary)]"><input className="mt-1 accent-violet-400" type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I own this address or have explicit permission from its owner to check it.</span></label>
        {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        <button type="submit" disabled={busy || !consent} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50">{busy ? <><Loader2 size={16} className="animate-spin"/> Checking EmailOSINT…</> : <><MailSearch size={16}/> Run full report</>}</button>
      </form>
      <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-400"/>The API key stays server-side. Provider quotas and paid-plan access may apply; secrets or captured passwords are never shown.</div>
    </section>
    {result && <section className="mt-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-400"/><h2 className="font-semibold">Report for {result.domain}</h2></div><span className="text-xs text-[var(--text-muted)]">Checked {new Date(result.checkedAt).toLocaleString()}</span></div>
      <section className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-violet-200">EmailOSINT full report</h3>{report?.aiSummary && <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase ${riskTone}`}>{report.aiSummary.risk} risk</span>}</div>
        {result.emailOsint.status !== "checked" ? <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{result.emailOsint.message || "EmailOSINT did not return a report."}</p> : report && <>
          {report.aiSummary && <div className="mt-3"><p className="text-sm font-medium leading-6">{report.aiSummary.headline}</p>{report.aiSummary.riskReason && <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{report.aiSummary.riskReason}</p>}{report.aiSummary.bullets.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-5 text-[var(--text-secondary)]">{report.aiSummary.bullets.map((item, i) => <li key={`${i}-${item}`}>{item}</li>)}</ul>}</div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><article className={panel}><h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Linked accounts</h4><p className="mt-1 text-2xl font-semibold">{report.accounts.length}</p><p className="text-xs text-[var(--text-muted)]">public account matches</p></article><article className={panel}><h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Data breaches</h4><p className="mt-1 text-2xl font-semibold">{report.dataBreaches.amount}</p><p className="text-xs text-[var(--text-muted)]">records across {report.dataBreaches.sources} sources</p></article><article className={panel}><h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Infostealer logs</h4><p className="mt-1 text-2xl font-semibold">{report.stealerLogs.count}</p><p className="text-xs text-[var(--text-muted)]">matches · credentials hidden</p></article></div>
          {report.accounts.length > 0 && <div className="mt-4"><h4 className="text-sm font-semibold">Accounts found</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">{report.accounts.map((account, i) => <article key={`${account.platform}-${i}`} className={panel}><div className="flex items-center justify-between gap-2"><span className="font-semibold text-sm">{account.platform}</span>{account.domain && <span className="truncate text-xs text-[var(--text-muted)]">{account.domain}</span>}</div>{account.fields.map((field,j)=><p key={`${field.label}-${j}`} className="mt-1 break-words text-xs text-[var(--text-secondary)]"><span className="text-[var(--text-muted)]">{field.label}: </span>{field.value}</p>)}</article>)}</div></div>}
          {report.dataBreaches.results.length > 0 && <div className="mt-4"><h4 className="text-sm font-semibold">Breach sources</h4><div className={tags}>{report.dataBreaches.results.map((item,i)=><span key={`${item.name}-${i}`} className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">{item.name}{item.date ? ` · ${item.date}` : ""}</span>)}</div></div>}
          {report.stealerLogs.results.length > 0 && <div className="mt-4"><h4 className="text-sm font-semibold">Infostealer exposure indicators</h4><div className={tags}>{report.stealerLogs.results.map((item,i)=><span key={`${item.source}-${i}`} className="rounded-full border border-amber-500/25 bg-amber-500/5 px-2.5 py-1 text-xs text-amber-100">{item.source}{item.date ? ` · ${item.date}` : ""}</span>)}</div></div>}
          {(report.registered.length > 0 || report.unregistered.length > 0) && <details className="mt-4 rounded-xl border border-[var(--border-subtle)] p-3"><summary className="cursor-pointer text-sm font-medium">Platform checks ({report.registered.length} found · {report.unregistered.length} not found)</summary>{report.registered.length > 0 && <p className="mt-2 text-xs leading-5 text-emerald-200">Found: {report.registered.join(", ")}</p>}{report.unregistered.length > 0 && <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Not found: {report.unregistered.join(", ")}</p>}</details>}
          <p className="mt-3 text-xs text-[var(--text-muted)]">{report.meta.durationMs != null ? `Provider lookup: ${(report.meta.durationMs / 1000).toFixed(1)} seconds.` : ""}{report.meta.timedOut ? " Some provider checks timed out; the report may be incomplete." : ""}</p>
        </>}
      </section>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><article className={panel}><h3 className="text-sm font-semibold">Mail-server DNS (MX)</h3><p className="mt-1 text-sm text-[var(--text-secondary)]">{result.mxStatus === "found" ? "Mail servers are published for this domain." : result.mxStatus === "none" ? "No MX records were found." : "The DNS lookup could not be completed."}</p>{result.mx.map(host => <div key={host} className="mt-2 break-all font-mono text-xs text-[var(--text-muted)]">{host}</div>)}</article>
        <article className={panel}><h3 className="text-sm font-semibold">Additional HIBP check</h3>{result.breachCheck.status === "not_configured" ? <p className="mt-1 text-sm text-[var(--text-secondary)]">Not configured. EmailOSINT breach results are shown above when the API returns them.</p> : result.breachCheck.status === "unavailable" ? <p className="mt-1 text-sm text-[var(--text-secondary)]">The optional HIBP check could not complete.</p> : result.breachCheck.breaches?.length ? <><p className="mt-1 text-sm text-amber-200">{result.breachCheck.breaches.length} matching record{result.breachCheck.breaches.length === 1 ? "" : "s"} returned.</p>{result.breachCheck.breaches.map(breach => <div key={`${breach.name}-${breach.date}`} className="mt-3 border-t border-[var(--border-subtle)] pt-3"><p className="text-sm font-medium">{breach.name}{breach.date ? ` · ${breach.date}` : ""}</p>{breach.dataClasses.length > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">Reported data types: {breach.dataClasses.join(", ")}</p>}</div>)}</> : <p className="mt-1 text-sm text-emerald-300">No matching HIBP breach records were returned.</p>}</article></div>
      <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]"><AlertTriangle size={14} className="mt-0.5 shrink-0"/>Results may be incomplete or outdated and should not be treated as proof of identity, compromise, or account existence. Do not use this tool to harass, dox, or access accounts.</div>
    </section>}
  </div>;
}
