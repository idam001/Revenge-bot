import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  const userLimit = await rateLimitShared(`app:github-search:${gate.user.id}`, 5, 60_000);
  const sharedLimit = await rateLimitShared("app:github-search:shared", 8, 60_000);
  if (!userLimit.ok || !sharedLimit.ok) return NextResponse.json({ error: "GitHub search limit reached. Please try again shortly." }, { status: 429 });

  let body: { query?: unknown; language?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 120) : "";
  const language = typeof body.language === "string" ? body.language.trim().replace(/[^a-zA-Z0-9+#.-]/g, "").slice(0, 30) : "";
  if (query.length < 2) return NextResponse.json({ error: "Enter at least two characters to search GitHub repositories." }, { status: 400 });
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${query}${language ? ` language:${language}` : ""}`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "15");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "REVENGE-App-GitHub-Explorer" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 403 || response.status === 429) return NextResponse.json({ error: "GitHub’s public API rate limit was reached. Wait a little and retry." }, { status: 429 });
    if (!response.ok) return NextResponse.json({ error: "GitHub could not complete the repository search." }, { status: 502 });
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 15) : [];
    return NextResponse.json({ results: items.map(item => {
      const repo = item as Record<string, unknown>;
      const owner = repo.owner && typeof repo.owner === "object" ? repo.owner as Record<string, unknown> : {};
      const license = repo.license && typeof repo.license === "object" ? repo.license as Record<string, unknown> : {};
      return {
        name: typeof repo.full_name === "string" ? repo.full_name : repo.name,
        description: typeof repo.description === "string" ? repo.description : "No description provided.",
        url: repo.html_url,
        stars: repo.stargazers_count,
        language: repo.language,
        updated_at: repo.updated_at,
        license: license.spdx_id || license.name || null,
        owner: owner.login,
      };
    }), total: Number(payload.total_count) || 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not reach GitHub right now. Try again." }, { status: 502 });
  }
}
