import { NextResponse } from "next/server";
import { resolveMx } from "node:dns/promises";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SafeField = { label: string; value: string };
type SafeAccount = { platform: string; domain: string; fields: SafeField[] };
type SafeReport = {
  accounts: SafeAccount[];
  registered: string[];
  unregistered: string[];
  dataBreaches: { amount: number; sources: number; results: Array<{ name: string; date: string }> };
  stealerLogs: { count: number; results: Array<{ source: string; date: string }> };
  aiSummary: { headline: string; bullets: string[]; risk: string; riskReason: string } | null;
  meta: { durationMs: number | null; completed: boolean | null; timedOut: boolean | null };
};
type EmailOsintCheck = {
  status: "checked" | "not_configured" | "requires_plan" | "unauthorized" | "rate_limited" | "unavailable";
  message?: string;
  report?: SafeReport;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeText = (value: unknown, max = 300): string => typeof value === "string" || typeof value === "number" ? String(value).slice(0, max) : "";
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function sanitizeEmailOsint(data: unknown): SafeReport {
  const root = record(data);
  const validator = record(root.validator);
  const breach = record(root.data_breaches);
  const stealer = record(root.stealer_logs);
  const summary = record(root.ai_summary);
  const safeFields = (item: unknown): SafeField[] => array(record(record(item).data).fields).slice(0, 20).flatMap(raw => {
    const field = record(raw);
    const label = safeText(field.label || field.key, 80);
    // Never return secrets, passwords, session material or credential values to the browser.
    if (!label || /password|credential|secret|token|cookie|session|auth/i.test(label)) return [];
    const value = safeText(field.value, 500);
    return value ? [{ label, value }] : [];
  });
  const accounts = array(root.accounts).slice(0, 100).map(raw => {
    const item = record(raw);
    const moduleInfo = record(item.module);
    return {
      platform: safeText(moduleInfo.name_formatted || moduleInfo.name || moduleInfo.id, 100) || "Account",
      domain: safeText(moduleInfo.domain, 160),
      fields: safeFields(item),
    };
  });
  const safeBreachResults = array(breach.results).slice(0, 50).map(raw => {
    const item = record(raw);
    const source = record(item.source);
    return { name: safeText(source.name || item.name, 120) || "Breach record", date: safeText(source.date || item.date, 24) };
  });
  const safeStealerResults = array(stealer.results).slice(0, 50).map(raw => {
    const item = record(raw);
    // Do not expose captured credentials or raw log contents; show source and date only.
    return { source: safeText(item.origin_domain || item.domain || item.site, 160) || "Infostealer-log match", date: safeText(item.date || item.captured_at || item.capture_date, 32) };
  });
  const risk = safeText(summary.risk, 24).toLowerCase();
  return {
    accounts,
    registered: array(record(validator.registered)).slice(0, 100).map(item => safeText(record(item).name_formatted || record(item).name, 100)).filter(Boolean),
    unregistered: array(record(validator.unregistered)).slice(0, 100).map(item => safeText(record(item).name_formatted || record(item).name, 100)).filter(Boolean),
    dataBreaches: { amount: Number(breach.amount) || safeBreachResults.length, sources: Number(breach.sources) || 0, results: safeBreachResults },
    stealerLogs: { count: Number(stealer.count) || safeStealerResults.length, results: safeStealerResults },
    aiSummary: summary.headline ? {
      headline: safeText(summary.headline, 1200),
      bullets: array(summary.bullets).slice(0, 12).map(item => safeText(item, 500)).filter(Boolean),
      risk: ["low", "medium", "high"].includes(risk) ? risk : "unknown",
      riskReason: safeText(summary.risk_reason, 800),
    } : null,
    meta: {
      durationMs: Number.isFinite(Number(record(root.meta).duration_ms)) ? Number(record(root.meta).duration_ms) : null,
      completed: typeof record(root.meta).completed === "boolean" ? record(root.meta).completed as boolean : null,
      timedOut: typeof record(root.meta).timed_out === "boolean" ? record(root.meta).timed_out as boolean : null,
    },
  };
}

async function checkEmailOsint(email: string): Promise<EmailOsintCheck> {
  const apiKey = process.env.EMAILOSINT_API_KEY?.trim();
  if (!apiKey) return { status: "not_configured", message: "EmailOSINT API key is not configured." };
  try {
    const response = await fetch("https://api.emailosint.org/v1/lookup/email", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, module_timeout_ms: 15000 }),
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 402) return { status: "requires_plan", message: "This API key’s EmailOSINT plan does not include API lookups. The provider requires an eligible plan." };
    if (response.status === 401) return { status: "unauthorized", message: "EmailOSINT rejected the API key. Check that the key is active and belongs to an API-enabled plan." };
    if (response.status === 429) return { status: "rate_limited", message: "The EmailOSINT plan quota or rate limit has been reached. Try again later." };
    if (!response.ok) return { status: "unavailable", message: safeText(payload.message, 240) || `EmailOSINT could not complete the lookup (HTTP ${response.status}).` };
    return { status: "checked", report: sanitizeEmailOsint(payload) };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { status: "unavailable", message: timedOut ? "EmailOSINT took too long to respond. Try again." : "Could not reach EmailOSINT right now. Try again later." };
  }
}

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  const limit = await rateLimitShared(`app:email-osint:${gate.user.id}`, 5, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Please wait a minute before trying another check." }, { status: 429 });

  let body: { email?: unknown; consent?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (body.consent !== true) return NextResponse.json({ error: "Confirm that this is your email address or that you have permission to check it." }, { status: 403 });
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const domain = email.split("@").pop()!.replace(/\.$/, "");
  const emailOsintPromise = checkEmailOsint(email);
  let mx: string[] = [];
  let mxStatus: "found" | "none" | "unknown" = "unknown";
  try {
    const records = await resolveMx(domain);
    mx = records.sort((a, b) => a.priority - b.priority).slice(0, 10).map(item => item.exchange);
    mxStatus = mx.length ? "found" : "none";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    mxStatus = code === "ENODATA" || code === "ENOTFOUND" ? "none" : "unknown";
  }

  const hibpKey = process.env.HIBP_API_KEY?.trim() || process.env.HAVEIBEENPWNED_API_KEY?.trim();
  let breachCheck: { status: "checked" | "not_configured" | "unavailable"; breaches?: Array<{ name: string; domain: string; date: string | null; dataClasses: string[] }> } = { status: "not_configured" };
  if (hibpKey) {
    try {
      const response = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`, {
        headers: { "hibp-api-key": hibpKey, "user-agent": "REVENGE Email Exposure Self-Check" }, cache: "no-store", signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 404) breachCheck = { status: "checked", breaches: [] };
      else if (response.ok) {
        const rows = await response.json().catch(() => []) as Array<Record<string, unknown>>;
        breachCheck = { status: "checked", breaches: Array.isArray(rows) ? rows.slice(0, 30).map(row => ({ name: safeText(row.Name || "Unknown breach", 120), domain: safeText(row.Domain, 160), date: typeof row.BreachDate === "string" ? row.BreachDate : null, dataClasses: array(row.DataClasses).slice(0, 12).map(item => safeText(item, 80)) })) : [] };
      } else breachCheck = { status: "unavailable" };
    } catch { breachCheck = { status: "unavailable" }; }
  }

  const emailOsint = await emailOsintPromise;
  // REVENGE does not persist or log the address; it is sent to configured lookup providers.
  return NextResponse.json({ domain, mxStatus, mx, emailOsint, breachCheck, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
