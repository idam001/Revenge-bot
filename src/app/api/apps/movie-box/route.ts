import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";
import { licensedMovieFilterQuery, makePublicMovie } from "@/lib/movie-box";

export const dynamic = "force-dynamic";
export const maxDuration = 35;

const ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php";
const ARCHIVE_METADATA = "https://archive.org/metadata/";
const MAX_RESULTS = 8;
const MAX_CANDIDATES = 24;
const METADATA_BATCH_SIZE = 8;

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if (gate.response) return gate.response;
  const userLimit = await rateLimitShared(`app:movie-box:${gate.user.id}`, 4, 60_000);
  const providerLimit = await rateLimitShared("app:movie-box:archive", 20, 60_000);
  const waitFor = Math.max(userLimit.retryAfterSec, providerLimit.retryAfterSec);
  if (!userLimit.ok || !providerLimit.ok) {
    return NextResponse.json({ error: "Movie search is busy. Please wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(waitFor || 60) } });
  }

  let body: { query?: unknown; year?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return NextResponse.json({ error: "Search request is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Enter a movie title to search." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid search request." }, { status: 400 });
  const query = typeof body.query === "string" ? body.query.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100) : "";
  const year = typeof body.year === "string" || typeof body.year === "number" ? String(body.year).trim() : "";
  if (query.length === 1) return NextResponse.json({ error: "Use at least two characters, or leave the search empty to browse." }, { status: 400 });
  if (year && !/^(18|19|20)\d{2}$/.test(year)) return NextResponse.json({ error: "Choose a valid year." }, { status: 400 });

  // Search only the Internet Archive's public feature-film collection. User
  // input is encoded as a quoted Solr phrase; it never controls the host/URL.
  const escapedQuery = query.replace(/[\\"]/g, "\\$&");
  const terms = ["collection:feature_films", "mediatype:movies", licensedMovieFilterQuery()];
  if (query) terms.push(`title:\"${escapedQuery}\"`);
  if (year) terms.push(`year:${year}`);
  const searchUrl = new URL(ARCHIVE_SEARCH);
  searchUrl.searchParams.set("q", terms.join(" AND "));
  for (const field of ["identifier", "title", "description", "year", "creator", "licenseurl", "rights"]) searchUrl.searchParams.append("fl[]", field);
  searchUrl.searchParams.set("rows", String(MAX_CANDIDATES));
  searchUrl.searchParams.set("page", "1");
  searchUrl.searchParams.set("output", "json");
  searchUrl.searchParams.set("sort[]", "downloads desc");

  try {
    const response = await fetch(searchUrl, {
      headers: { Accept: "application/json", "User-Agent": "REVENGE-Movie-Box/1.0 (licensed-film discovery)" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (response.status === 429) return NextResponse.json({ error: "The film catalog is rate-limited. Please try again shortly." }, { status: 429, headers: { "Retry-After": response.headers.get("retry-after") || "60" } });
    if (!response.ok) return NextResponse.json({ error: "The public film catalog is temporarily unavailable." }, { status: 502 });
    const payload = await response.json() as { response?: { numFound?: number; docs?: Array<Record<string, unknown>> } };
    const docs = Array.isArray(payload.response?.docs) ? payload.response.docs : [];
    const items: NonNullable<ReturnType<typeof makePublicMovie>>[] = [];
    // Walk licensed candidates in small bounded batches until playable items are found.
    for (let offset = 0; offset < docs.length && items.length < MAX_RESULTS; offset += METADATA_BATCH_SIZE) {
      const batch = docs.slice(offset, offset + METADATA_BATCH_SIZE);
      const results = await Promise.all(batch.map(async (doc) => {
        const id = typeof doc.identifier === "string" ? doc.identifier : "";
        if (!/^[A-Za-z0-9._-]{1,200}$/.test(id)) return null;
        try {
          const itemResponse = await fetch(`${ARCHIVE_METADATA}${encodeURIComponent(id)}`, {
            headers: { Accept: "application/json", "User-Agent": "REVENGE-Movie-Box/1.0 (licensed-film discovery)" },
            signal: AbortSignal.timeout(5_500),
            cache: "no-store",
          });
          if (!itemResponse.ok) return null;
          const metadata = await itemResponse.json() as Record<string, unknown>;
          return makePublicMovie(id, doc, metadata);
        } catch { return null; }
      }));
      items.push(...results.filter((item): item is NonNullable<typeof item> => Boolean(item)));
    }
    items.splice(MAX_RESULTS);
    return NextResponse.json({
      items,
      count: items.length,
      source: "Internet Archive feature_films",
      filteredTo: "Explicit Public Domain, CC0, or Creative Commons BY/BY-SA metadata",
      note: "Catalog rights metadata is provided by the source. Review the item page and license terms before reusing or downloading a film.",
      queriedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({ error: timedOut ? "The public film catalog took too long to respond. Try again." : "Could not reach the public film catalog." }, { status: timedOut ? 504 : 502 });
  }
}
