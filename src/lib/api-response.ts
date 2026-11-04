import { NextResponse } from "next/server";

/**
 * Shared helpers for API route handlers.
 *
 * Details of a database error (SQL text, column names, constraint names) must
 * never reach the browser: it leaks schema internals and looks like a crash.
 * Log the real error server-side, return something neutral to the client.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 404 for malformed ids so callers cannot tell "bad id" from "not yours". */
export function badId(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function serverError(err: unknown, fallback = "Request failed"): NextResponse {
  const raw = err instanceof Error ? err.message : String(err);
  console.error("[api] " + raw);
  // Never surface SQL/ORM internals or connection details.
  const safe =
    /invalid input syntax|invalid uuid|syntax error|constraint|relation .* does not exist|column .* does not exist|ECONNREFUSED|password authentication|getaddrinfo/i.test(
      raw
    )
      ? fallback
      : raw.length > 300
        ? fallback
        : raw;
  return NextResponse.json({ error: safe }, { status: 500 });
}
