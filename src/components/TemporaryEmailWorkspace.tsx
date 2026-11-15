"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCircle2, Clipboard, Inbox, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type Message = Record<string, unknown>;
type Address = { email: string; createdAt: string; expiresAt: string; provider?: string; shareEmail?: string|null };
function plainText(value: unknown) { if(typeof value!=="string")return "";return value.replace(/<br\s*\/?\s*>/gi,"\n").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim(); }
function senderText(value: unknown): string { if(typeof value==="string")return value;if(value&&typeof value==="object"){const data=value as Record<string,unknown>;return String(data.address||data.email||data.name||"Unknown sender");}return "Unknown sender"; }

export function TemporaryEmailWorkspace() {
  const [email,setEmail]=useState("");
  const [addresses,setAddresses]=useState<Address[]>([]);
  const [quota,setQuota]=useState({used:0,remaining:null as number|null,limit:null as number|null});
  const [aliasStyle,setAliasStyle]=useState("auto");
  const [provider,setProvider]=useState("all");
  const [mailService,setMailService]=useState("temp.tf");
  const [customUsername,setCustomUsername]=useState("");
  const [customDomain,setCustomDomain]=useState("grabmail.io");
  const [publicRiskAccepted,setPublicRiskAccepted]=useState(false);
  const [messageBodies,setMessageBodies]=useState<Record<string,string>>({});
  const [loadingMessageId,setLoadingMessageId]=useState("");
  const [messages,setMessages]=useState<Message[]>([]);
  const [createdAt,setCreatedAt]=useState("");
  const [checkedAt,setCheckedAt]=useState("");
  const [selected,setSelected]=useState<number|null>(null);
  const [creating,setCreating]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  const refreshInbox=useCallback(async(currentEmail=email,quiet=false)=>{
    if(!currentEmail)return;
    if(!quiet)setRefreshing(true);
    try{
      const response=await apiFetch("/api/apps/temporary-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"inbox",email:currentEmail})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not refresh the inbox.");
      setMessages(Array.isArray(data.messages)?data.messages:[]);setCheckedAt(data.checkedAt||new Date().toISOString());setError("");
    }catch(e){if(!quiet)setError(e instanceof Error?e.message:"Could not refresh the inbox.");}
    finally{if(!quiet)setRefreshing(false);}
  },[email]);

  const loadAddresses=useCallback(async()=>{
    try{
      const response=await apiFetch("/api/apps/temporary-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"list"}),cache:"no-store"});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load your inboxes.");
      const next:Address[]=Array.isArray(data.addresses)?data.addresses:[];setAddresses(next);if(data.quota)setQuota(data.quota);
      if(next.length){const current=next.find(a=>a.email===email)||next[0];setEmail(existing=>existing||current.email);setCreatedAt(current.createdAt);if(!email)await refreshInbox(current.email,true);}
    }catch(e){setError(e instanceof Error?e.message:"Could not load your inboxes.");}
  },[email,refreshInbox]);
  useEffect(()=>{const timer=window.setTimeout(()=>{void loadAddresses();},0);return()=>window.clearTimeout(timer);},[loadAddresses]);
  useEffect(()=>{if(!email)return;const timer=window.setInterval(()=>{void refreshInbox(email,true);},20000);return()=>window.clearInterval(timer);},[email,refreshInbox]);

  const createAddress=async()=>{
    setCreating(true);setError("");setNotice("");setSelected(null);
    try{
      const response=await apiFetch("/api/apps/temporary-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create",mailService,aliasStyle,provider,username:customUsername,domain:customDomain,publicRiskAccepted})});
      const data=await response.json();if(!response.ok||typeof data.email!=="string")throw new Error(data.error||"Could not create an address.");
      setEmail(data.email);setCreatedAt(data.createdAt||new Date().toISOString());setMessages([]);setMessageBodies({});if(data.quota)setQuota(data.quota);setNotice(data.publicInbox?"Custom public inbox created. Use its masked alias when signing up; anyone who knows the main address can read that inbox.":"Your inbox is ready. New messages will appear here.");
      await loadAddresses();await refreshInbox(data.email,true);
    }catch(e){setError(e instanceof Error?e.message:"Temporary email is unavailable right now.");}
    finally{setCreating(false);}
  };
  const chooseAddress=(next:Address)=>{setEmail(next.email);setCreatedAt(next.createdAt);setMessages([]);setMessageBodies({});setSelected(null);setCheckedAt("");setError("");setNotice("");void refreshInbox(next.email);};
  const currentAddress=addresses.find(item=>item.email===email);
  const copyAddress=async()=>{try{await navigator.clipboard.writeText(currentAddress?.shareEmail||email);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{setError("Clipboard access was blocked. Select the address and copy it.");}};
  const loadMessage=async(messageId:string)=>{
    if(!email||!messageId)return;setLoadingMessageId(messageId);
    try{const response=await apiFetch("/api/apps/temporary-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"message",email,messageId})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not open this message.");setMessageBodies(previous=>({...previous,[messageId]:String(data.text||data.html||"")}));}
    catch(e){setError(e instanceof Error?e.message:"Could not open this message.");}
    finally{setLoadingMessageId("");}
  };

  return <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
    <section className="relative overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-8"><div className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-sky-500/10 blur-3xl"/><div className="relative max-w-3xl"><span className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/10 text-sky-300"><Mail size={22}/></span><div className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-sky-300">Disposable inbox</div><h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Get a temporary email</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Create multiple disposable inboxes without a five-inbox daily cap. Choose a provider and alias format; your addresses stay in your REVENGE account for 24 hours and refresh here automatically.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2"><span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">{quota.used} inboxes created in the last 24 hours</span>{addresses.length>1&&<label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">Switch inbox<select className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-main)] px-2 py-1.5 text-xs text-[var(--text-primary)]" value={email} onChange={e=>{const next=addresses.find(item=>item.email===e.target.value);if(next)chooseAddress(next);}}>{addresses.map(item=><option key={item.email} value={item.email}>{item.email}</option>)}</select></label>}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-[var(--text-secondary)]">Inbox provider<select className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-2.5 text-sm text-[var(--text-primary)]" value={mailService} onChange={e=>setMailService(e.target.value)}><option value="temp.tf">temp.tf · generated address</option><option value="grabmail">GrabMail · custom address</option></select></label>
        {mailService==="temp.tf" ? <><label className="text-xs font-medium text-[var(--text-secondary)]">Address style<select className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-2.5 text-sm text-[var(--text-primary)]" value={aliasStyle} onChange={e=>setAliasStyle(e.target.value)}><option value="auto">Automatic alias</option><option value="plus">Plus alias (name+tag)</option><option value="dot">Dotted Gmail alias</option></select></label><label className="text-xs font-medium text-[var(--text-secondary)]">Domain provider<select className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-2.5 text-sm text-[var(--text-primary)]" value={provider} onChange={e=>{setProvider(e.target.value);if(e.target.value!=="gmail"&&aliasStyle==="dot")setAliasStyle("auto");}}><option value="all">Any available</option><option value="gmail">Gmail</option><option value="outlook">Outlook</option><option value="hotmail">Hotmail</option></select></label></> : <><label className="text-xs font-medium text-[var(--text-secondary)]">Custom address name<input className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" value={customUsername} onChange={e=>setCustomUsername(e.target.value)} minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]" placeholder="your-alias" /></label><label className="text-xs font-medium text-[var(--text-secondary)]">Public domain<select className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-main)] px-3 py-2.5 text-sm text-[var(--text-primary)]" value={customDomain} onChange={e=>setCustomDomain(e.target.value)}><option value="grabmail.io">@grabmail.io</option><option value="mixozia.com">@mixozia.com</option><option value="linqmail.com">@linqmail.com</option></select></label><label className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100 sm:col-span-2"><input className="mt-1 accent-amber-400" type="checkbox" checked={publicRiskAccepted} onChange={e=>setPublicRiskAccepted(e.target.checked)}/><span>I understand this is a public mailbox: anyone who knows its main address can read the messages. I will use the masked alias for low-risk sign-ups and will not use the main inbox for private or sensitive mail.</span></label></>}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" onClick={()=>void createAddress()} disabled={creating||(mailService==="grabmail"&&(!publicRiskAccepted||customUsername.trim().length<3))} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-60">{creating?<><Loader2 size={17} className="animate-spin"/> Creating your inbox…</>:<><Mail size={17}/>{email?"Create another inbox":"Get Email"}</>}</button>{email&&<button type="button" onClick={()=>void copyAddress()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] px-4 py-3 text-sm font-medium hover:border-sky-300">{copied?<Check size={16}/>:<Clipboard size={16}/>} {copied?"Copied":currentAddress?.shareEmail?"Copy masked alias":"Copy address"}</button>}</div>
      {email&&<div className="mt-4 rounded-2xl border border-sky-400/20 bg-[var(--bg-main)] p-4 sm:p-5"><div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Your email address</div><div className="mt-1 break-all font-mono text-lg font-semibold text-[var(--text-primary)] sm:text-xl">{email}</div>{currentAddress?.shareEmail&&<div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3"><div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Masked address to use on sign-up forms</div><div className="mt-1 break-all font-mono text-sm text-[var(--text-primary)]">{currentAddress.shareEmail}</div><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">Give this generated alias to sign-up forms and check the main inbox here. Never share the main custom address; it is a public mailbox.</p></div>}<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3"><span className="text-xs text-[var(--text-muted)]">Created {createdAt?new Date(createdAt).toLocaleString():"just now"}{currentAddress?` · Expires ${new Date(currentAddress.expiresAt).toLocaleTimeString()}`:""}</span><button type="button" onClick={()=>void refreshInbox()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-60">{refreshing?<Loader2 size={14} className="animate-spin"/>:<RefreshCw size={14}/>} Refresh inbox</button></div></div>}
      {error&&<div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}{notice&&email&&<p className="mt-3 text-sm text-emerald-300">{notice}</p>}
      <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-400"/>Generated aliases use temp.tf. Custom names use GrabMail public domains; anyone who knows the main address can read that inbox. Use its masked relay address for low-risk sign-ups. Public disposable domains are often blocked; never use temporary inboxes for banking, account recovery, or sensitive mail.</div>
    </div></section>
    {email&&<section className="mt-4 overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"><div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5"><div className="flex items-center gap-2"><Inbox size={17} className="text-sky-300"/><h2 className="font-semibold">Inbox <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">{messages.length}</span></h2></div><span className="text-[11px] text-[var(--text-muted)]">{checkedAt?`Checked ${new Date(checkedAt).toLocaleTimeString()}`:"Checking for mail…"}</span></div>{messages.length===0?<div className="px-5 py-10 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--bg-main)] text-[var(--text-muted)]"><Mail size={20}/></div><p className="mt-3 text-sm font-medium">Waiting for your first message</p><p className="mt-1 text-xs text-[var(--text-muted)]">This inbox refreshes automatically every 20 seconds.</p></div>:<div className="divide-y divide-[var(--border-subtle)]">{messages.map((message,index)=>{const from=senderText(message.from||message.sender||message.email);const subject=String(message.subject||message.title||"(no subject)");const messageId=String(message.id||message._id||index);const body=plainText(messageBodies[messageId]||message.text||message.body||message.content||message.html||message.message);const date=String(message.date||message.receivedAt||message.createdAt||"");const isOpen=selected===index;return <article key={messageId}><button type="button" onClick={()=>{if(isOpen)setSelected(null);else{setSelected(index);if(currentAddress?.provider==="grabmail"&&!messageBodies[messageId])void loadMessage(messageId);}}} className="w-full px-4 py-3 text-left hover:bg-[var(--bg-main)] sm:px-5"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{subject}</span><span className="shrink-0 text-[11px] text-[var(--text-muted)]">{date?new Date(date).toLocaleString():"New"}</span></div><div className="mt-1 truncate text-xs text-[var(--text-secondary)]">From {from}</div>{body&&!isOpen&&<div className="mt-1 truncate text-xs text-[var(--text-muted)]">{body}</div>}</button>{isOpen&&<div className="border-t border-[var(--border-subtle)] bg-[var(--bg-main)] px-4 py-4 sm:px-5"><div className="text-xs text-[var(--text-muted)]">From: {from}</div><h3 className="mt-1 font-semibold">{subject}</h3><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--text-secondary)]">{loadingMessageId===messageId?"Loading message…":(body||(currentAddress?.provider==="grabmail"?"This message has no readable text preview yet.":"This message has no readable text preview."))}</pre></div>}</article>;})}</div>}</section>}
  </div>;
}
