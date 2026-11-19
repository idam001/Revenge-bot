export type ProviderOutcome = { ok: boolean; providerStatus?: number; error?: string };

/** Detects JSON APIs that encode failure in a 200 response body. */
export function interpretProviderOutcome(httpOk: boolean, body: unknown): ProviderOutcome {
  const row = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const status = Number(row?.status);
  const bodyFailure = Boolean(row && (
    row.success === false || row.ok === false || (Number.isFinite(status) && status >= 400)
  ));
  const ok = httpOk && !bodyFailure;
  const error = bodyFailure
    ? [row?.message, row?.error, row?.detail, row?.description].find(value => typeof value === "string" && value.trim()) as string | undefined
    : undefined;
  return {
    ok,
    ...(bodyFailure && Number.isFinite(status) && status >= 400 ? { providerStatus: status } : {}),
    ...(error ? { error: error.slice(0, 500) } : {}),
  };
}
