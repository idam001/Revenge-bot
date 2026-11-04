/**
 * Extra keyless retrieval engines for deeper search.
 *
 * Added because two of the general engines are unreliable on server IPs:
 * Bing RSS frequently returns nothing useful and DuckDuckGo's Instant Answer
 * API only covers encyclopedia-style lookups. These four cover the gap without
 * requiring any API key:
 *
 *   - Brave Search (HTML)  general web results, parsed from the results page
 *   - OpenAlex             scholarly works, authors, venues, citation counts
 *   - arXiv                preprints with abstracts
 *   - Crossref             DOI metadata for papers and books
 *
 * Every function resolves to [] on failure (timeout, rate limit, layout change)
 * so a single broken engine can never break a chat turn.
 */

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ");
}

/* ------------------------------------------------------------------ */
/* Brave Search — general web                                          */
/* ------------------------------------------------------------------ */

export async function searchBrave(query: string, limit = 6): Promise<ResearchSource[]> {
  return withTimeout(
    (async () => {
      const res = await fetch(
        `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
        {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(7000),
        }
      );
      if (!res.ok) return [];
      const html = await res.text();

      // Each organic result is a <div class="snippet" data-type="web"> block.
      // Parse block by block: the destination URL is the first anchor, the
      // title is its text, and the snippet text follows the title element.
      const out: ResearchSource[] = [];
      const seen = new Set<string>();
      const blocks = html.split(/<div class="snippet[^"]*"[^>]*data-type="web"/i).slice(1);

      for (const block of blocks) {
        if (out.length >= limit) break;
        const href = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i)?.[1];
        if (!href) continue;
        const url = decodeEntities(href);
        if (/brave\.com|search\.brave|cdn\.|imgs\.search/i.test(url)) continue;
        const key = url.replace(/[?#].*$/, "").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        // Title lives in a div whose class starts with "title" (after the
        // site-name/favicon block). Fall back to the page <title> fragment.
        const title =
          stripHtml(block.match(/<div[^>]+class="title[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/i)?.[1] ?? "") ||
          stripHtml(block.match(/<a[^>]+href="https?:\/\/[^"]+"[^>]*>([\s\S]{0,300}?)<\/a>/i)?.[1] ?? "");

        // Snippet: the descriptive paragraph inside the block.
        const snippet = stripHtml(
          block.match(/class="snippet-description[^"]*"[^>]*>([\s\S]{0,600}?)<\/div>/i)?.[1] ??
            block.match(/class="snippet-content[^"]*"[^>]*>([\s\S]{0,600}?)<\/div>/i)?.[1] ??
            block.match(/<p[^>]*>([\s\S]{0,500}?)<\/p>/i)?.[1] ??
            ""
        ).slice(0, 280);

        if (title.length < 5) continue;
        out.push({ title, url, snippet });
      }

      return out;
    })(),
    8000,
    []
  );
}

/* ------------------------------------------------------------------ */
/* OpenAlex — scholarly works                                          */
/* ------------------------------------------------------------------ */

interface OpenAlexWork {
  display_name?: string;
  doi?: string;
  publication_year?: number;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string; source?: { display_name?: string } } | null;
}

/** Rebuild an abstract from OpenAlex's inverted index representation. */
function rebuildAbstract(inv: Record<string, number[]> | null | undefined): string {
  if (!inv) return "";
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) slots[p] = word;
  }
  const words = slots.filter(Boolean);
  return words.length > 60 ? words.slice(0, 60).join(" ") + " …" : words.join(" ");
}

export async function searchOpenAlex(query: string, limit = 4): Promise<ResearchSource[]> {
  return withTimeout(
    (async () => {
      const res = await fetch(
        `https://api.openalex.org/works?search=${encodeURIComponent(
          query
        )}&per-page=${limit}&sort=relevance_score:desc&mailto=research@revenge-gpt.app`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: OpenAlexWork[] };
      return (data.results ?? []).map((w) => {
        const year = w.publication_year ? ` (${w.publication_year})` : "";
        const cites = w.cited_by_count ? ` · ${w.cited_by_count} citations` : "";
        const venue = w.primary_location?.source?.display_name
          ? ` · ${w.primary_location.source.display_name}`
          : "";
        return {
          title: `${w.display_name ?? "Untitled work"}${year}`,
          url:
            w.doi?.replace(/^https?:\/\/doi\.org\//, "https://doi.org/") ??
            w.primary_location?.landing_page_url ??
            "https://openalex.org",
          snippet: `${rebuildAbstract(w.abstract_inverted_index)}${venue}${cites}`.trim(),
          publishedAt: w.publication_year ? String(w.publication_year) : undefined,
        };
      });
    })(),
    8000,
    []
  );
}

/* ------------------------------------------------------------------ */
/* arXiv — preprints                                                   */
/* ------------------------------------------------------------------ */

export async function searchArxiv(query: string, limit = 3): Promise<ResearchSource[]> {
  return withTimeout(
    (async () => {
      const res = await fetch(
        `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(
          query
        )}&max_results=${limit}&sortBy=relevance`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return [];
      const xml = await res.text();
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
      return entries.map((e) => {
        const title = stripHtml(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
        const link = (e.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "").trim();
        const summary = stripHtml(e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "");
        const published = (e.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? "").slice(0, 10);
        return {
          title,
          url: link || "https://arxiv.org",
          snippet: summary.slice(0, 300),
          publishedAt: published || undefined,
        };
      });
    })(),
    9000,
    []
  );
}

/* ------------------------------------------------------------------ */
/* Crossref — DOI metadata                                             */
/* ------------------------------------------------------------------ */

interface CrossrefItem {
  title?: string[];
  DOI?: string;
  URL?: string;
  abstract?: string;
  issued?: { "date-parts"?: number[][] };
  "is-referenced-by-count"?: number;
}

export async function searchCrossref(query: string, limit = 3): Promise<ResearchSource[]> {
  return withTimeout(
    (async () => {
      const res = await fetch(
        `https://api.crossref.org/works?query=${encodeURIComponent(
          query
        )}&rows=${limit}&select=title,DOI,URL,abstract,issued,is-referenced-by-count&mailto=research@revenge-gpt.app`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { message?: { items?: CrossrefItem[] } };
      return (data.message?.items ?? []).map((it) => {
        const year = it.issued?.["date-parts"]?.[0]?.[0];
        const cites = it["is-referenced-by-count"]
          ? ` · ${it["is-referenced-by-count"]} citations`
          : "";
        return {
          title: `${it.title?.[0] ?? "Untitled"}${year ? ` (${year})` : ""}`,
          url: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : "https://crossref.org"),
          snippet: `${stripHtml(it.abstract ?? "").slice(0, 280)}${cites}`.trim(),
          publishedAt: year ? String(year) : undefined,
        };
      });
    })(),
    8000,
    []
  );
}

/** True when the query looks like it wants research-grade sources. */
export function isResearchQuery(text: string): boolean {
  return /\b(paper|papers|study|studies|research|journal|arxiv|doi|citation|cited|peer[- ]reviewed|literature|preprint|thesis|academic|scholar|scientific|meta[- ]analysis|survey of)\b/i.test(
    text
  );
}
