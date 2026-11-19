import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import registry from "@/lib/revenge-tools-registry.json";
import { requireUser } from "@/lib/auth";
import { authenticateCustomerKey, consumeCustomerKeyRequest, customerKeyRateState, recordCustomerKeyUsage, type CustomerKeyContext } from "@/lib/customer-api-keys";
import { rateLimitShared } from "@/lib/rate-limit";
import { discoverEndpoints, enrichEndpoint, validateUrlParameters } from "@/lib/revenge-tools-discovery";
import { interpretProviderOutcome } from "@/lib/provider-envelope";
import { resolveAdultSourcePage } from "@/lib/adult-source-resolver";
import { adultMediaOf } from "@/lib/adult-media";
import { USER_TOOL_REQUESTS_PER_MINUTE } from "@/lib/rate-limit-config";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

// Provider-specific quotas remain in effect in addition to this user quota.
const API_BASE = "https://apis.nabeestech.com";
const API_KEY = () => process.env.NABEES_API_KEY?.trim() || "";

type Endpoint = (typeof registry.endpoints)[number];

export async function GET(req: Request) {
  const keyAuth = await authenticateCustomerKey(req, "tools:read");
  if (keyAuth && "response" in keyAuth) return keyAuth.response;
  if (!keyAuth) {
    return NextResponse.json({ error: "Catalog access requires a REVENGE developer API key.", code: "DEVELOPER_KEY_REQUIRED" }, { status: 401 });
  }
  try { await recordCustomerKeyUsage(keyAuth.id, "__catalog", 200, 0); }
  catch { console.error("[customer-api] usage record write failed"); }
  const keyRate = await customerKeyRateState(keyAuth);

  const url = new URL(req.url);
  const endpointId = url.searchParams.get("endpointId") || undefined;
  const tags = (url.searchParams.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  const minScoreRaw = url.searchParams.get("minScore");
  const minScore = minScoreRaw && /^\d{1,3}$/.test(minScoreRaw) ? Number(minScoreRaw) : undefined;
  const { matches, total, nextCursor } = discoverEndpoints(registry.endpoints, {
    endpointId,
    query: url.searchParams.get("query") || undefined,
    category: url.searchParams.get("category") || undefined,
    tags,
    auth: url.searchParams.get("auth") || undefined,
    method: url.searchParams.get("method") || undefined,
    minScore,
    limit: Number(url.searchParams.get("limit")) || 50,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  const endpoints = matches.map((match) => ({ ...match.endpoint, whyMatched: match.whyMatched, relevanceScore: match.score }));
  const payload = {
    categories: registry.categories,
    endpoints,
    source: "REVENGE tools catalog",
    count: endpointId ? endpoints.length : total,
    nextCursor,
    ...(endpointId && endpoints[0] ? { endpoint: endpoints[0], example: endpoints[0].example, related: registry.endpoints.filter((item) => item.category === endpoints[0].category && item.id !== endpointId).slice(0, 5).map(enrichEndpoint) } : {}),
  };
  const body = JSON.stringify(payload);
  const etag = `\"${createHash("sha256").update(body).digest("hex").slice(0, 24)}\"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "private, no-cache",
    "X-RateLimit-Limit": String(keyRate.limit),
    "X-RateLimit-Remaining": String(keyRate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(Date.now() / 60_000) * 60),
  };
  if (req.headers.get("if-none-match")?.split(",").map((tag) => tag.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export async function POST(req: Request) {
  const keyAuth = await authenticateCustomerKey(req, "tools:execute");
  if (keyAuth && "response" in keyAuth) return keyAuth.response;
  let customerKey: CustomerKeyContext | null = null;
  let callerId = "";
  if (keyAuth && "kind" in keyAuth) { customerKey = keyAuth; callerId = `key:${keyAuth.id}`; }
  if (!keyAuth) {
    const gate = await requireUser(req);
    if (gate.response) return gate.response;
    callerId = `user:${gate.user.id}`;
  }

  let body: {
    endpointId?: unknown;
    method?: unknown;
    params?: unknown;
    confirmAdult?: unknown;
    options?: { strictStatus?: unknown; timeoutMs?: unknown; includeRaw?: unknown; idempotencyKey?: unknown };
  };
  try {
    const raw = await req.text();
    if (raw.length > 32_000) {
      return NextResponse.json({ error: "Request too large (32 KB maximum)." }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  if (typeof body.endpointId !== "string" || typeof body.method !== "string") {
    return NextResponse.json({ error: "Choose a documented endpoint and method." }, { status: 400 });
  }
  const endpoint = registry.endpoints.find((item) => item.id === body.endpointId) as Endpoint | undefined;
  if (!endpoint || !endpoint.path.startsWith("/api/v1/") || !endpoint.methods.includes(body.method)) {
    return NextResponse.json({ error: "That endpoint or method is not in the documented registry." }, { status: 400 });
  }
  if (customerKey && customerKey.allowedCategories.length && !customerKey.allowedCategories.includes(endpoint.category)) {
    return NextResponse.json({ error: "This API key is not allowed to use that tool category.", code: "INSUFFICIENT_SCOPE" }, { status: 403 });
  }
  if (endpoint.category === "18+" && body.confirmAdult !== true) {
    return NextResponse.json({ error: "Confirm that you are 18 or older before using adult endpoints." }, { status: 403 });
  }
  if (!body.params || typeof body.params !== "object" || Array.isArray(body.params)) {
    return NextResponse.json({ error: "Parameters must be provided as an object." }, { status: 400 });
  }

  const supplied = body.params as Record<string, unknown>;
  const allowed = new Set(endpoint.params.map((p) => p.name));
  for (const key of Object.keys(supplied)) {
    if (!allowed.has(key)) return NextResponse.json({ error: `Unknown parameter: ${key}` }, { status: 400 });
  }
  for (const param of endpoint.params) {
    const value = supplied[param.name];
    if (param.required && (value === undefined || value === null || value === "")) {
      return NextResponse.json({ error: `${param.name} is required.` }, { status: 400 });
    }
    if (typeof value === "string" && value.length > 12_000) {
      return NextResponse.json({ error: `${param.name} exceeds the 12,000 character limit.` }, { status: 413 });
    }
  }

  const params = Object.fromEntries(
    Object.entries(supplied).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  const urlValidation = await validateUrlParameters(params);
  if (!urlValidation.ok) {
    return NextResponse.json({ error: "Blocked URL", reason: urlValidation.reason, param: urlValidation.param }, { status: 400 });
  }
  let path = endpoint.path;
  for (const param of endpoint.params) {
    const token = `:${param.name}`;
    if (path.includes(token)) {
      const value = params[param.name];
      if (value === undefined) return NextResponse.json({ error: `${param.name} is required in the path.` }, { status: 400 });
      path = path.replace(token, encodeURIComponent(String(value)));
      delete params[param.name];
    }
  }

  const url = new URL(path, API_BASE);
  const method = body.method;
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  }

  const providerKey = API_KEY();
  const options = body.options && typeof body.options === "object" ? body.options : {};
  const requestedTimeout = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? options.timeoutMs : 125_000;
  const timeoutMs = Math.min(125_000, Math.max(1_000, Math.floor(requestedTimeout)));
  const strictStatus = options.strictStatus === true;
  const includeRaw = options.includeRaw === true;
  const requestId = randomUUID();
  const rate = customerKey
    ? await consumeCustomerKeyRequest(customerKey)
    : { ...(await rateLimitShared(`revenge-tools:invoke:${callerId}`, USER_TOOL_REQUESTS_PER_MINUTE, 60_000)), limit: USER_TOOL_REQUESTS_PER_MINUTE };
  const resetAt = String(Math.ceil(Date.now() / 60_000) * 60);
  if (!rate.ok) {
    return NextResponse.json({ error: "Tool request limit reached. Please retry after the current window." }, {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSec), "X-RateLimit-Limit": String(rate.limit), "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": resetAt, "X-Request-Id": requestId },
    });
  }
  const rateHeaders = { "X-RateLimit-Limit": String(rate.limit), "X-RateLimit-Remaining": String(rate.remaining), "X-RateLimit-Reset": resetAt };
  const adultSource = endpoint.id === "xnxx-details" ? "xnxx" : endpoint.id === "xvideos-details" ? "xvideos" : null;
  const adultPageUrl = typeof supplied.slug === "string" ? supplied.slug : "";
  if (!providerKey) {
    const fallback = adultSource ? await resolveAdultSourcePage(adultPageUrl, adultSource) : null;
    if (fallback) {
      const fallbackData = fallback.format === "mp4"
        ? { video_url: fallback.playUrl, download_url: fallback.playUrl, source_page_url: fallback.sourcePageUrl }
        : { hls_url: fallback.playUrl, source_page_url: fallback.sourcePageUrl };
      return NextResponse.json({ ok: true, status: 200, elapsedMs: 0, contentType: "application/json", truncated: false, data: fallbackData }, {
        headers: { ...rateHeaders, "X-Revenge-Ok": "true", "X-Revenge-Upstream-Status": "200", "X-Cache": "MISS", "X-Request-Id": requestId },
      });
    }
    return NextResponse.json({ error: "Tool provider credentials are not configured on the server.", code: "PROVIDER_NOT_CONFIGURED" }, {
      status: 503,
      headers: { ...rateHeaders, "X-Revenge-Ok": "false", "X-Revenge-Upstream-Status": "503", "X-Cache": "MISS", "X-Request-Id": requestId },
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "X-API-Key": providerKey,
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(params) } : {}),
      signal: controller.signal,
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const truncated = text.length > 1_000_000;
    const outputText = truncated ? text.slice(0, 1_000_000) : text;
    let data: unknown;
    try {
      data = JSON.parse(outputText);
    } catch {
      data = { raw: outputText };
    }
    const elapsedMs = Date.now() - startedAt;
    const sourceFallback = adultSource && !adultMediaOf(data)
      ? await resolveAdultSourcePage(adultPageUrl, adultSource)
      : null;
    if (sourceFallback) {
      data = sourceFallback.format === "mp4"
        ? { video_url: sourceFallback.playUrl, download_url: sourceFallback.playUrl, source_page_url: sourceFallback.sourcePageUrl }
        : { hls_url: sourceFallback.playUrl, source_page_url: sourceFallback.sourcePageUrl };
    }
    const providerOutcome = sourceFallback ? { ok: true } : interpretProviderOutcome(response.ok, data);
    const resultStatus = sourceFallback ? 200 : response.status;
    if (customerKey) {
      try { await recordCustomerKeyUsage(customerKey.id, endpoint.id, providerOutcome.providerStatus || resultStatus, elapsedMs); }
      catch { console.error("[customer-api] usage record write failed"); }
    }
    const envelope = {
      ok: providerOutcome.ok,
      status: resultStatus,
      ...(providerOutcome.providerStatus ? { providerStatus: providerOutcome.providerStatus } : {}),
      ...(providerOutcome.error ? { error: providerOutcome.error } : {}),
      elapsedMs,
      contentType,
      truncated,
      data,
      ...(includeRaw ? { raw: outputText } : {}),
    };
    return NextResponse.json(envelope, {
      status: strictStatus && resultStatus !== 204 && resultStatus !== 304 ? resultStatus : 200,
      headers: {
        ...rateHeaders,
        "X-Revenge-Ok": String(providerOutcome.ok),
        "X-Revenge-Upstream-Status": String(resultStatus),
        "X-Cache": "MISS",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const elapsedMs = Date.now() - startedAt;
    if (customerKey) {
      try { await recordCustomerKeyUsage(customerKey.id, endpoint.id, timedOut ? 504 : 502, elapsedMs); }
      catch { console.error("[customer-api] usage record write failed"); }
    }
    return NextResponse.json({
      error: timedOut ? "The endpoint timed out. Try again or use its docs directly." : "Could not reach the selected tool endpoint.",
      details: error instanceof Error ? error.message.slice(0, 240) : "Unknown network error",
      elapsedMs,
    }, { status: timedOut ? 504 : 502, headers: { ...rateHeaders, "X-Revenge-Ok": "false", "X-Revenge-Upstream-Status": timedOut ? "504" : "502", "X-Cache": "MISS", "X-Request-Id": requestId } });
  } finally {
    clearTimeout(timer);
  }
}
