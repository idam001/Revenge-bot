import type { WebSourceItem } from "@/db/schema";

/**
 * Two-stage Deep Web Search & Grounding Engine:
 *  Stage 1 — Multi-source discovery (Bing Web, Google News, Wikipedia,
 *            DuckDuckGo, Stack Overflow, GitHub Repos, npm, Hacker News,
 *            and Open-Meteo live global weather) with strict term-coverage gating.
 *  Stage 2 — Deep Page Reader: fetches clean Markdown excerpts from the top-ranked
 *            direct URLs via Jina Reader so the model reads real page substance.
 */

const URL_REGEX = /https?:\/\/[^\s<>")\]]+/gi;

const EXPLICIT_SEARCH =
  /\b(search|deep search|google it|look ?up|browse|web search|search the (web|internet)|on the (web|internet)|research)\b/i;
const RECENCY =
  /\b(latest|newest|recently|today|tonight|yesterday|this week|this month|this year|right now|current(ly)?|breaking|up[- ]to[- ]date|news|headlines?|just (announced|released|launched)|in 202[5-9]|in 203\d)\b/i;
const LOOKUP =
  /^\s*(who (is|was|are)|where is|when (did|was|is)|how many|how much|price of|weather|forecast|temperature (in|at|for)|stock price|score of)\b/i;
const WEATHER_SIGNAL =
  /\b(weather|forecast|temperature|rain(?:ing)?|humidity|wind speed)\s+(?:in|at|for|of)\s+([a-zA-Z\u00C0-\u017F][a-zA-Z\u00C0-\u017F\s,'-]{1,42})/i;
const ERROR_SIGNAL =
  /(traceback|stack trace|exception in thread|typeerror|syntaxerror|referenceerror|cannot find module|module not found|enoent|eaddrinuse|deprecat(ed|ion)|breaking change|changelog|release notes|cve-\d{4}-\d+)/i;
const DOCS_SIGNAL =
  /\b(docs?|documentation|install(ation|ing)?|latest version|api reference|github repo|repository|how to (install|use|setup|set up|upgrade))\b/i;
const CODE_CONTEXT =
  /\b(npm|pip|package|library|framework|sdk|api|github|repo|react|next\.?js|node(\.js)?|python|typescript|javascript|tailwind|postgres|drizzle|docker|kubernetes|regex|sql|rust|golang)\b/i;
const NEWS_WORDS = /\b(news|headlines?|breaking)\b/i;
const NEWS_SIGNAL =
  /\b(news|headlines?|breaking|today|this week|latest|announced|launched|released|election|results?|score|stock|price|earnings)\b/i;
const HN_SIGNAL = /\b(hacker news|\bhn\b|ycombinator)\b/i;
const BUILD_REQUEST =
  /^\s*(please\s+)?(build|create|make|write|generate|design|code|implement|add|fix|refactor|debug|convert|port|scaffold|deobfuscate|explain this)\b/i;
const CODE_BLOCK = /```|<\/?[a-z][\w-]*[\s>]|function\s|const\s|import\s/;

const STOP = new Set(
  (
    "the a an and or but of to in on at for with from by about into over after before is are was were be been being " +
    "this that these those it its i me my we our you your they their them he she his her what which who whom whose " +
    "when where why how do does did done can could should would will shall may might must not no yes so as if than " +
    "then there here just also very more most much many some any all each every other such only own same too " +
    "use using make get got give tell show search web internet news please latest deep"
  ).split(" ")
);

export function detectWebSearchIntent(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;

  if (/https?:\/\/\S+/i.test(t)) return true;
  if (/^\/(search|web|news|browse)\b/i.test(t)) return true;
  if (WEATHER_SIGNAL.test(t)) return true;
  if (EXPLICIT_SEARCH.test(t)) return true;

  const isBuild = BUILD_REQUEST.test(t);
  const hasCode = CODE_BLOCK.test(t) && t.length > 160;
  if (ERROR_SIGNAL.test(t)) return true;
  if (isBuild || hasCode) return false;

  if (RECENCY.test(t) || LOOKUP.test(t)) return true;
  if (DOCS_SIGNAL.test(t) && CODE_CONTEXT.test(t)) return true;
  return false;
}

export function cleanSearchQuery(userQuery: string): string {
  let q = userQuery.replace(URL_REGEX, " ");
  for (let i = 0; i < 3; i++) {
    q = q.replace(
      /^\s*(\/(search|web|news|browse)\b|please\b|can you\b|could you\b|would you\b|hey\b|hi\b|do a (thorough |deeper |deep )?search( for| on| about)?\b|search( the)?( web| internet| online)?( for| about)?\b|google\b|look ?up\b|browse( the web)?( for)?\b|find( me)?( out)?( about)?\b|tell me( about)?\b|give me( the| a| some)?\b|show me\b|i (want|need) (to know )?(about )?)\s*/i,
      ""
    );
  }
  q = q.replace(/\b(please|thanks|thank you|for me|right now|on:?)\b/gi, " ");
  q = q.replace(/[^a-zA-Z0-9\u00C0-\uFFFF\s\-+.#?]/g, " ");
  return q.replace(/\s+/g, " ").trim().slice(0, 160);
}

export function queryTokens(q: string): string[] {
  const words = q
    .toLowerCase()
    .split(/[^a-z0-9+#.\-]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return Array.from(new Set(words));
}

function coverage(tokens: string[], s: WebSourceItem): number {
  const hay = `${s.title} ${s.snippet} ${s.url}`.toLowerCase();
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits++;
  return hits;
}

function requiredCoverage(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  if (tokens.length <= 2) return tokens.length;
  return Math.ceil(tokens.length * 0.66);
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;|&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getJson<T>(
  url: string,
  ms: number,
  headers?: Record<string, string>
): Promise<T | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: c.signal });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function getText(
  url: string,
  ms: number,
  headers?: Record<string, string>
): Promise<string | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: c.signal });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const UA =
  "Mozilla/5.0 (compatible; RevengeGPT/8.0; +https://revenge-gpt.app)";

/* ---------- Open-Meteo: Live Keyless Global Weather & 3-Day Forecast ---------- */
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
};

async function searchLiveWeather(rawQuery: string): Promise<WebSourceItem[]> {
  const match = rawQuery.match(WEATHER_SIGNAL);
  if (!match?.[2]) return [];
  const rawPlace = match[2]
    .replace(/\b(today|tomorrow|right now|this week|please)\b/gi, "")
    .replace(/[?.!,]+$/g, "")
    .trim();
  if (rawPlace.length < 2) return [];

  const geo = await getJson<{
    results?: Array<{
      name: string;
      country?: string;
      latitude: number;
      longitude: number;
      timezone?: string;
    }>;
  }>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      rawPlace
    )}&count=1&language=en&format=json`,
    3500
  );
  const loc = geo?.results?.[0];
  if (!loc) return [];

  const wx = await getJson<{
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
      weather_code?: number;
    };
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`,
    3500
  );
  if (!wx?.current) return [];

  const cur = wx.current;
  const cond = WMO_CODES[cur.weather_code ?? -1] || "Variable conditions";
  const forecastLines = (wx.daily?.time ?? [])
    .slice(0, 3)
    .map((day, idx) => {
      const hi = wx.daily?.temperature_2m_max?.[idx];
      const lo = wx.daily?.temperature_2m_min?.[idx];
      const rain = wx.daily?.precipitation_probability_max?.[idx];
      return `${day}: High ${hi}°C / Low ${lo}°C (rain chance ${rain ?? 0}%)`;
    })
    .join(" · ");

  return [
    {
      title: `Live Weather: ${loc.name}${loc.country ? `, ${loc.country}` : ""} — ${cur.temperature_2m}°C (${cond})`,
      url: `https://open-meteo.com/en/docs#latitude=${loc.latitude}&longitude=${loc.longitude}`,
      snippet: `Current in ${loc.name}: ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C), ${cond}, humidity ${cur.relative_humidity_2m}%, wind ${cur.wind_speed_10m} km/h. 3-Day Forecast: ${forecastLines}.`,
    },
  ];
}

/* ---------- Bing RSS: General Web ---------- */
async function searchBing(query: string): Promise<WebSourceItem[]> {
  const xml = await getText(
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    4500,
    { "User-Agent": UA }
  );
  if (!xml) return [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: WebSourceItem[] = [];
  for (const item of items.slice(0, 10)) {
    const title = stripTags(
      item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""
    );
    const link = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const desc = stripTags(
      item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? ""
    );
    if (!title || !link || /bing\.com/.test(link)) continue;
    out.push({
      title: title.slice(0, 120),
      url: link,
      snippet: desc.slice(0, 360),
    });
  }
  return out;
}

/* ---------- Google News RSS: Current Events ---------- */
async function searchGoogleNews(query: string): Promise<WebSourceItem[]> {
  const xml = await getText(
    `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=en-US&gl=US&ceid=US:en`,
    4500,
    { "User-Agent": UA }
  );
  if (!xml) return [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: WebSourceItem[] = [];
  for (const item of items.slice(0, 10)) {
    const title = stripTags(
      item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""
    );
    const link = (item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
    const pubDate = stripTags(
      item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ""
    );
    const source = stripTags(
      item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? ""
    );
    if (!title || !link) continue;
    out.push({
      title: `${source ? `${source}: ` : ""}${title}`.slice(0, 130),
      url: link,
      snippet: `${pubDate ? `Published ${pubDate}. ` : ""}${title}`.slice(
        0,
        320
      ),
    });
  }
  return out;
}

/* ---------- Wikipedia: Top Match + Lead Extract ---------- */
async function searchWikipedia(query: string): Promise<WebSourceItem[]> {
  const data = await getJson<{
    query?: { search?: Array<{ title: string; snippet: string }> };
  }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&utf8=1&format=json&srlimit=2`,
    3500,
    { "User-Agent": UA }
  );
  const top = data?.query?.search?.[0];
  if (!top) return [];

  // Fetch fuller summary via Wikipedia REST summary endpoint
  const slug = encodeURIComponent(top.title.replace(/ /g, "_"));
  const summary = await getJson<{ extract?: string }>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
    2800,
    { "User-Agent": UA }
  );

  return [
    {
      title: `${stripTags(top.title)} — Wikipedia`,
      url: `https://en.wikipedia.org/wiki/${slug}`,
      snippet: (summary?.extract || stripTags(top.snippet)).slice(0, 750),
    },
  ];
}

/* ---------- DuckDuckGo Instant Answer ---------- */
async function searchDuckDuckGo(query: string): Promise<WebSourceItem[]> {
  const data = await getJson<{
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
  }>(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(
      query
    )}&format=json&no_html=1&skip_disambig=1`,
    3500
  );
  if (!data?.AbstractText || !data.AbstractURL) return [];
  return [
    {
      title: data.Heading || "DuckDuckGo Instant Answer",
      url: data.AbstractURL,
      snippet: data.AbstractText.slice(0, 420),
    },
  ];
}

/* ---------- Stack Overflow ---------- */
async function searchStackOverflow(query: string): Promise<WebSourceItem[]> {
  const data = await getJson<{
    items?: Array<{
      title: string;
      link: string;
      score?: number;
      answer_count?: number;
    }>;
  }>(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(
      query.slice(0, 120)
    )}&site=stackoverflow&pagesize=5&accepted=True`,
    4000
  );
  return (data?.items ?? []).map((q) => {
    const title = stripTags(q.title);
    return {
      title: `${title.slice(0, 110)} — Stack Overflow`,
      url: q.link,
      snippet: `${q.score ?? 0} votes · ${q.answer_count ?? 0} answers · accepted solution. ${title}`.slice(
        0,
        320
      ),
    };
  });
}

/* ---------- GitHub Repositories Search ---------- */
async function searchGitHubRepos(query: string): Promise<WebSourceItem[]> {
  const ghQuery =
    query
      .replace(/\b(github|repositories|repository|repos|repo)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || query;
  const data = await getJson<{
    items?: Array<{
      full_name: string;
      html_url: string;
      description?: string;
      stargazers_count?: number;
      language?: string;
      updated_at?: string;
    }>;
  }>(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(
      ghQuery.slice(0, 90)
    )}&sort=stars&order=desc&per_page=3`,
    3800,
    { "User-Agent": UA, Accept: "application/vnd.github+json" }
  );
  return (data?.items ?? []).map((repo) => ({
    title: `${repo.full_name} (★${repo.stargazers_count ?? 0}) — GitHub`,
    url: repo.html_url,
    snippet: `${repo.description || "GitHub repository"}${repo.language ? ` · Language: ${repo.language}` : ""}${repo.updated_at ? ` · Updated ${repo.updated_at.slice(0, 10)}` : ""}`.slice(
      0,
      340
    ),
  }));
}

/* ---------- Hacker News ---------- */
async function searchHackerNews(query: string): Promise<WebSourceItem[]> {
  const data = await getJson<{
    hits?: Array<{
      title?: string;
      url?: string;
      points?: number;
      num_comments?: number;
      objectID?: string;
    }>;
  }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      query.slice(0, 100)
    )}&tags=story&hitsPerPage=4`,
    3500
  );
  return (data?.hits ?? [])
    .filter((h) => h.title)
    .map((h) => ({
      title: `${stripTags(h.title!).slice(0, 110)} — Hacker News`,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      snippet: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments.`,
    }));
}

/* ---------- npm Registry ---------- */
async function searchNpm(query: string): Promise<WebSourceItem[]> {
  const data = await getJson<{
    objects?: Array<{
      package?: { name?: string; version?: string; description?: string };
    }>;
  }>(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(
      query.slice(0, 80)
    )}&size=4`,
    3500
  );
  return (data?.objects ?? [])
    .filter((o) => o.package?.name)
    .map((o) => ({
      title: `${o.package!.name}@${o.package!.version} — npm`,
      url: `https://www.npmjs.com/package/${o.package!.name}`,
      snippet: (o.package!.description || "npm package").slice(0, 280),
    }));
}

/* ---------- Deep Page Reader via Jina (for pasted URLs + top discovered results) ---------- */
async function fetchDeepPageExcerpt(
  rawUrl: string,
  timeoutMs = 3800
): Promise<string | null> {
  if (/news\.google\.com\/rss\/articles/i.test(rawUrl)) return null;
  const text = await getText(`https://r.jina.ai/${rawUrl}`, timeoutMs, {
    Accept: "text/plain",
  });
  if (!text || text.trim().length < 80) return null;
  return text
    .replace(/^Title:.*$/m, "")
    .replace(/^URL Source:.*$/m, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1300);
}

async function readUrls(urls: string[]): Promise<WebSourceItem[]> {
  const results = await Promise.all(
    urls.map(async (rawUrl) => {
      const excerpt = await fetchDeepPageExcerpt(rawUrl, 5500);
      if (!excerpt) return null;
      let host = rawUrl;
      try {
        host = new URL(rawUrl).hostname;
      } catch {
        /* keep raw */
      }
      return {
        title: `Page: ${host}`,
        url: rawUrl,
        snippet: excerpt,
      } as WebSourceItem;
    })
  );
  return results.filter((r): r is WebSourceItem => r !== null);
}

export async function gatherWebGrounding(
  userQuery: string,
  enableSearch: boolean,
  opts?: { forceSearch?: boolean }
): Promise<{
  sources: WebSourceItem[];
  contextBlock: string;
  searched: boolean;
}> {
  const urls = Array.from(new Set(userQuery.match(URL_REGEX) ?? [])).slice(
    0,
    2
  );
  const forced = Boolean(opts?.forceSearch) || enableSearch;
  const shouldSearch = forced || detectWebSearchIntent(userQuery);

  if (!shouldSearch && urls.length === 0) {
    return { sources: [], contextBlock: "", searched: false };
  }

  const query = cleanSearchQuery(userQuery);
  const tokens = queryTokens(query);
  const hasTopic = query.length >= 3 && tokens.length > 0;
  const need = requiredCoverage(tokens);

  const isWeather = WEATHER_SIGNAL.test(userQuery);
  const isCode =
    CODE_CONTEXT.test(userQuery) ||
    ERROR_SIGNAL.test(userQuery) ||
    DOCS_SIGNAL.test(userQuery);
  const wantsNews =
    NEWS_SIGNAL.test(userQuery) && (NEWS_WORDS.test(userQuery) || !isCode);
  const wantsLookup = LOOKUP.test(userQuery.trim()) && !isWeather;
  const wantsSO =
    isCode &&
    (ERROR_SIGNAL.test(userQuery) ||
      /\b(error|bug|fix|why|failing|not working)\b/i.test(userQuery));
  const wantsGitHub =
    isCode &&
    /\b(github|repo|repository|open[- ]?source|library|framework|sdk|tool)\b/i.test(
      userQuery
    );
  const wantsHN = HN_SIGNAL.test(userQuery);
  const wantsNpm =
    /\bnpm\b|\binstall\b|\bpackage\b/i.test(userQuery) &&
    (isCode || /\bnpm\b/i.test(userQuery));

  const gate = (list: WebSourceItem[]) =>
    list.filter((s) => s.url && s.title && coverage(tokens, s) >= need);
  const trusted = (list: WebSourceItem[]) =>
    list.filter((s) => s.url && s.title);

  const urlPromise =
    urls.length > 0 ? readUrls(urls) : Promise.resolve<WebSourceItem[]>([]);

  const jobs: Promise<WebSourceItem[]>[] = [];
  if (isWeather) {
    jobs.push(searchLiveWeather(userQuery));
  }
  if (shouldSearch && hasTopic && !isWeather) {
    jobs.push(searchBing(query).then(gate));
    if (wantsNews) jobs.push(searchGoogleNews(query).then(gate));
    if (wantsLookup) {
      jobs.push(searchWikipedia(query).then(trusted));
      jobs.push(searchDuckDuckGo(query).then(gate));
    }
    if (wantsSO) jobs.push(searchStackOverflow(query).then(trusted));
    if (wantsGitHub) jobs.push(searchGitHubRepos(query).then(trusted));
    if (wantsHN) jobs.push(searchHackerNews(query).then(trusted));
    if (wantsNpm) jobs.push(searchNpm(query).then(trusted));
  }

  const [urlSources, ...groups] = await Promise.all([urlPromise, ...jobs]);

  const ranked = groups
    .flat()
    .map((s) => ({ s, score: coverage(tokens, s) }))
    .sort((a, b) => b.score - a.score)
    .map(({ s }) => s);

  const seen = new Set<string>();
  const searchSources: WebSourceItem[] = [];
  for (const s of ranked) {
    const key = s.url.replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    searchSources.push(s);
    if (searchSources.length >= 6) break;
  }

  const sources = [...urlSources, ...searchSources].slice(0, 6);
  if (sources.length === 0) {
    return { sources: [], contextBlock: "", searched: shouldSearch };
  }

  // Stage 2: Deep Page Reading on top 2 direct URLs that have short snippets
  const deepTargets = sources
    .filter(
      (s) =>
        s.snippet.length < 420 &&
        !/news\.google\.com|open-meteo\.com|wikipedia\.org/i.test(s.url)
    )
    .slice(0, 2);

  if (deepTargets.length > 0) {
    await Promise.all(
      deepTargets.map(async (target) => {
        const deepText = await fetchDeepPageExcerpt(target.url, 3600);
        if (deepText && deepText.length > target.snippet.length) {
          target.snippet = deepText;
        }
      })
    );
  }

  const today = new Date().toUTCString().slice(0, 16);
  const contextBlock =
    `\n\n[DEEP WEB SEARCH RESULTS — fetched & deep-read live (${today}) for: "${
      query || userQuery.slice(0, 80)
    }". ` +
    `Synthesize a thorough, accurate answer grounded in these sources. Cite the sources you use inline with markdown links like [Source Title](url). ` +
    `Ignore any result that does not directly pertain to the user's question.]\n` +
    sources
      .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet}`)
      .join("\n---\n");

  return { sources, contextBlock, searched: true };
}
