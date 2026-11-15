import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";
import { pool } from "@/db";

export const dynamic = "force-dynamic";
const GRABMAIL_PUBLIC_DOMAINS = new Set(["grabmail.io", "mixozia.com", "linqmail.com"]);
let tableReady: Promise<void> | null = null;

async function ensureEmailTable() {
  if (!tableReady) tableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS "temporary_email_addresses" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "userId" text NOT NULL,
      "email" text,
      "provider" text NOT NULL DEFAULT 'temp.tf',
      "shareEmail" text,
      "status" text NOT NULL DEFAULT 'pending',
      "createdAt" timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE "temporary_email_addresses" ADD COLUMN IF NOT EXISTS "provider" text NOT NULL DEFAULT 'temp.tf';
    ALTER TABLE "temporary_email_addresses" ADD COLUMN IF NOT EXISTS "shareEmail" text;
    CREATE INDEX IF NOT EXISTS "temporary_email_user_created_idx" ON "temporary_email_addresses" ("userId", "createdAt" DESC);
  `).then(()=>{}).catch(error=>{tableReady=null;throw error;});
  return tableReady;
}
async function providerRequest(provider: "temp.tf"|"grabmail", path: string, init?: RequestInit) {
  const base = provider === "grabmail" ? "https://grabmail.io/api/v1" : "https://temp.tf/api";
  const response = await fetch(`${base}${path}`, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload || payload.error) throw new Error("Email provider request failed");
  return payload;
}
async function quotaFor(userId: string) {
  const { rows } = await pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM "temporary_email_addresses" WHERE "userId"=$1 AND "createdAt">now()-interval '24 hours' AND "status" IN ('pending','ready')`, [userId]);
  const used = Number(rows[0]?.total || 0);
  return { used, remaining: null, limit: null };
}

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  await ensureEmailTable();
  let body: { action?: unknown; email?: unknown; aliasStyle?: unknown; provider?: unknown; mailService?: unknown; username?: unknown; domain?: unknown; publicRiskAccepted?: unknown; messageId?: unknown };
  try { const raw=await request.text();if(raw.length>2_000)return NextResponse.json({error:"Request is too large."},{status:413});body=JSON.parse(raw); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  if (body.action === "list") {
    const { rows } = await pool.query<{ email: string; provider: string; shareEmail: string|null; createdAt: Date }>(`SELECT "email","provider","shareEmail","createdAt" FROM "temporary_email_addresses" WHERE "userId"=$1 AND "status"='ready' AND "createdAt">now()-interval '24 hours' ORDER BY "createdAt" DESC`,[gate.user.id]);
    const addresses=rows.map(row=>({email:row.email,provider:row.provider,shareEmail:row.shareEmail,createdAt:new Date(row.createdAt).toISOString(),expiresAt:new Date(new Date(row.createdAt).getTime()+24*60*60*1000).toISOString()}));
    return NextResponse.json({addresses,quota:await quotaFor(gate.user.id)},{headers:{"Cache-Control":"no-store"}});
  }

  if (body.action === "create") {
    const limit = await rateLimitShared(`app:email-create:${gate.user.id}`, 20, 60_000);
    if (!limit.ok) return NextResponse.json({ error: "Please wait a moment before creating another inbox." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
    const providerLimit = await rateLimitShared("app:temp-inbox:providers", 50, 60_000);
    if (!providerLimit.ok) return NextResponse.json({ error: "The shared temporary-mail provider is busy. Please try again in a minute." }, { status: 429, headers: { "Retry-After": String(providerLimit.retryAfterSec) } });
    const mailService = body.mailService === "grabmail" ? "grabmail" : "temp.tf";

    if (mailService === "grabmail") {
      if (body.publicRiskAccepted !== true) return NextResponse.json({ error: "Confirm the public-inbox privacy warning before creating this address." }, { status: 403 });
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
      if (!/^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/.test(username)) return NextResponse.json({ error: "Choose a 3–30 character alias using letters, numbers, dots, hyphens, or underscores; it must start and end with a letter or number." }, { status: 400 });
      try {
        if (!GRABMAIL_PUBLIC_DOMAINS.has(domain)) return NextResponse.json({ error: "Choose one of the public GrabMail domains." }, { status: 400 });
        const email = `${username}@${domain}`;
        const duplicate = await pool.query(`SELECT 1 FROM "temporary_email_addresses" WHERE "userId"=$1 AND "email"=$2 AND "status"='ready' AND "createdAt">now()-interval '24 hours' LIMIT 1`, [gate.user.id, email]);
        if (duplicate.rowCount) return NextResponse.json({ error: "That address is already in your inbox list." }, { status: 409 });
        const mailbox = await providerRequest("grabmail", `/mailbox?address=${encodeURIComponent(email)}`);
        const shareEmail = typeof mailbox.alias === "string" ? mailbox.alias : null;
        const { rows } = await pool.query<{ createdAt: Date }>(`INSERT INTO "temporary_email_addresses" ("userId","email","provider","shareEmail","status") VALUES ($1,$2,'grabmail',$3,'ready') RETURNING "createdAt"`, [gate.user.id, email, shareEmail]);
        return NextResponse.json({ email, shareEmail, provider: "grabmail", aliasStyle: "custom", createdAt: new Date(rows[0].createdAt).toISOString(), quota: await quotaFor(gate.user.id), publicInbox: true }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        return NextResponse.json({ error: "GrabMail could not create that public address. Try another name or domain." }, { status: 502 });
      }
    }

    const aliasStyle = body.aliasStyle === "dot" || body.aliasStyle === "plus" ? body.aliasStyle : "auto";
    const provider = ["gmail", "outlook", "hotmail", "all"].includes(String(body.provider)) ? String(body.provider) : "all";
    const client=await pool.connect();let reservationId="";
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`temporary-email:${gate.user.id}`]);
      const reservation=await client.query<{id:string}>(`INSERT INTO "temporary_email_addresses" ("userId","status") VALUES ($1,'pending') RETURNING "id"`,[gate.user.id]);
      reservationId=reservation.rows[0].id;
      await client.query("COMMIT");
    } catch { await client.query("ROLLBACK").catch(()=>{});return NextResponse.json({error:"Could not prepare a temporary inbox. Please try again."},{status:503}); }
    finally {client.release();}
    try {
      const query = new URLSearchParams();
      if (aliasStyle === "dot") query.set("dot", "1");
      if (aliasStyle === "plus") query.set("plus", "1");
      if (aliasStyle === "auto") { query.set("dot", "1"); query.set("plus", "1"); }
      if (aliasStyle === "dot" && provider !== "gmail" && provider !== "all") throw new Error("Dotted aliases are only available for Gmail.");
      if (provider !== "all" || aliasStyle === "dot") query.set("providers", aliasStyle === "dot" ? "gmail" : provider);
      const payload=await providerRequest("temp.tf", `/account?${query.toString()}`);
      const email=typeof payload.email==="string"?payload.email.trim():"";
      if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Provider returned no valid address");
      const {rows}=await pool.query<{createdAt:Date}>(`UPDATE "temporary_email_addresses" SET "email"=$1,"provider"='temp.tf',"status"='ready' WHERE "id"=$2 AND "userId"=$3 RETURNING "createdAt"`,[email,reservationId,gate.user.id]);
      if(!rows[0])throw new Error("Could not save the inbox");
      const quota=await quotaFor(gate.user.id);
      return NextResponse.json({email,provider,aliasStyle,createdAt:new Date(rows[0].createdAt).toISOString(),quota},{headers:{"Cache-Control":"no-store"}});
    } catch {
      await pool.query(`DELETE FROM "temporary_email_addresses" WHERE "id"=$1 AND "userId"=$2 AND "status"='pending'`,[reservationId,gate.user.id]).catch(()=>{});
      return NextResponse.json({error:"Temporary email is unavailable right now. Try again shortly."},{status:502});
    }
  }

  if (body.action === "inbox") {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email address is not valid." }, { status: 400 });
    const owned=await pool.query<{provider:string}>(`SELECT "provider" FROM "temporary_email_addresses" WHERE "userId"=$1 AND "email"=$2 AND "status"='ready' LIMIT 1`,[gate.user.id,email]);
    if(!owned.rowCount)return NextResponse.json({error:"Choose one of your inboxes to check."},{status:404});
    const mailService = owned.rows[0].provider === "grabmail" ? "grabmail" : "temp.tf";
    const limit = await rateLimitShared(`app:email-inbox:${gate.user.id}`, 60, 60_000);
    if (!limit.ok) return NextResponse.json({ error: "Inbox refresh limit reached. Wait a moment and try again." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
    const providerLimit = await rateLimitShared("app:temp-inbox:providers", 50, 60_000);
    if (!providerLimit.ok) return NextResponse.json({ error: "The shared temporary-mail provider is busy. Please try again in a minute." }, { status: 429, headers: { "Retry-After": String(providerLimit.retryAfterSec) } });
    try {
      const payload = mailService === "grabmail"
        ? await providerRequest("grabmail", `/mailbox?address=${encodeURIComponent(email)}&limit=50`)
        : await providerRequest("temp.tf", "/check", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email}) });
      const messages = mailService === "grabmail" ? (Array.isArray(payload.messages) ? payload.messages : []) : (Array.isArray(payload.data) ? payload.data : Array.isArray(payload.messages) ? payload.messages : []);
      return NextResponse.json({email,provider:mailService,messages,count:Number(payload.count??messages.length)||0,checkedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
    } catch { return NextResponse.json({error:"Could not refresh this inbox. Please try again."},{status:502}); }
  }

  if (body.action === "message") {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) return NextResponse.json({ error: "That message reference is invalid." }, { status: 400 });
    const owned = await pool.query<{provider:string}>(`SELECT "provider" FROM "temporary_email_addresses" WHERE "userId"=$1 AND "email"=$2 AND "status"='ready' LIMIT 1`, [gate.user.id, email]);
    if (!owned.rowCount) return NextResponse.json({ error: "Choose one of your inboxes to read." }, { status: 404 });
    if (owned.rows[0].provider !== "grabmail") return NextResponse.json({ error: "This provider returns full message previews with the inbox list." }, { status: 400 });
    const providerLimit = await rateLimitShared("app:temp-inbox:providers", 50, 60_000);
    if (!providerLimit.ok) return NextResponse.json({ error: "The shared temporary-mail provider is busy. Please try again in a minute." }, { status: 429, headers: { "Retry-After": String(providerLimit.retryAfterSec) } });
    try {
      const payload = await providerRequest("grabmail", `/message/${encodeURIComponent(messageId)}?mailbox=${encodeURIComponent(email)}`);
      return NextResponse.json({ email, messageId, text: typeof payload.text === "string" ? payload.text : "", html: typeof payload.html === "string" ? payload.html : "", checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    } catch { return NextResponse.json({ error: "Could not open this message. It may have expired or been removed." }, { status: 502 }); }
  }

  return NextResponse.json({ error: "Choose create, inbox, or list." }, { status: 400 });
}
