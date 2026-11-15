import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type AnimeResult = {
  id: number;
  title: string;
  nativeTitle: string;
  cover: string;
  episodes: number | null;
  score: number | null;
  status: string;
  genres: string[];
  description: string;
  url: string;
};

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  const limit = await rateLimitShared(`app:anime:${gate.user.id}`, 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "Search is busy. Try again in a moment." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });

  let body: { query?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return NextResponse.json({ error: "Search is too long." }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ error: "Enter an anime title to search." }, { status: 400 }); }
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 100) return NextResponse.json({ error: "Enter 2–100 characters for the title." }, { status: 400 });

  const graphQuery = `query ($search: String!) { Page(page: 1, perPage: 12) { media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { id title { romaji english native } coverImage { large } episodes averageScore description(asHtml: false) genres status siteUrl } } }`;
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: graphQuery, variables: { search: query } }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "Anime search is temporarily unavailable. Try again shortly." }, { status: 502 });
    const payload = await response.json() as { data?: { Page?: { media?: Array<Record<string, unknown>> } }; errors?: unknown[] };
    const media = payload.data?.Page?.media || [];
    const items: AnimeResult[] = media.map((item) => {
      const titles = item.title && typeof item.title === "object" ? item.title as Record<string, unknown> : {};
      const cover = item.coverImage && typeof item.coverImage === "object" ? (item.coverImage as Record<string, unknown>).large : "";
      const description = typeof item.description === "string" ? item.description.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : "";
      const id = Number(item.id);
      return {
        id,
        title: String(titles.english || titles.romaji || "Untitled"),
        nativeTitle: String(titles.native || ""),
        cover: typeof cover === "string" && cover.startsWith("https://") ? cover : "",
        episodes: typeof item.episodes === "number" ? item.episodes : null,
        score: typeof item.averageScore === "number" ? item.averageScore : null,
        status: typeof item.status === "string" ? item.status.replaceAll("_", " ").toLowerCase() : "",
        genres: Array.isArray(item.genres) ? item.genres.filter((g): g is string => typeof g === "string").slice(0, 6) : [],
        description: description.slice(0, 900),
        url: typeof item.siteUrl === "string" && item.siteUrl.startsWith("https://") ? item.siteUrl : `https://anilist.co/anime/${id}`,
      };
    }).filter(item => item.id > 0);
    return NextResponse.json({ items, count: items.length }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Anime search timed out. Please try again." }, { status: 504 });
  }
}
