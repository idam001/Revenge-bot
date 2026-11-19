export type InputField = {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "url" | "number" | "select" | "textarea" | "file" | "checkbox";
  accept?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
};
export type AppAction = {
  id: string;
  title: string;
  description: string;
  endpointId: string;
  method?: "GET" | "POST";
  fields: InputField[];
  defaults?: Record<string, string | number>;
  confirmAdult?: boolean;
};
export type AppExperience = { title: string; intro: string; actions: AppAction[] };

const q = (label: string, placeholder: string, name = "q"): InputField => ({ name, label, placeholder, required: true });
const url = (label = "Public link", name = "url"): InputField => ({ name, label, placeholder: "https://…", type: "url", required: true });
const prompt = (label: string, placeholder: string, name = "prompt"): InputField => ({ name, label, placeholder, type: "textarea", required: true });

export const APP_EXPERIENCES: Record<string, AppExperience> = {
  "ai-studio": {
    title: "AI Studio",
    intro: "Choose a tested model from the selector and send it a prompt. Available hosted models can change; ChatGPT and Claude official APIs require your own provider key and can be connected in REVENGE AI.",
    actions: [
      { id: "ministral", title: "Ministral 8B · General", description: "Fast, compact general-purpose model. Hosted access availability may change.", endpointId: "mistralai-ministral-8b-2512", fields: [prompt("Your prompt", "Ask a question…")] },
      { id: "gemini", title: "Gemini 3.1 Flash Lite", description: "Google Gemini hosted adapter; supports fast responses and images.", endpointId: "google-gemini-3.1-flash-lite", fields: [prompt("Your prompt", "Ask Gemini…")] },
      { id: "qwen-coder", title: "Qwen3 Coder Flash", description: "Coding-focused model for explanations, debugging, and drafts.", endpointId: "qwen-qwen3-coder-flash", fields: [prompt("Coding prompt", "Describe the code task…")] },
      { id: "gpt5-luna", title: "GPT-5 Luna · Community adapter", description: "Third-party model adapter; not the official ChatGPT API or OpenAI product.", endpointId: "gpt5-luna", fields: [prompt("Your prompt", "Ask GPT-5 Luna…", "q")] },
    ],
  },
  "18+": {
    title: "18+",
    intro: "Adult-only search. You must be 18 or older to continue. Results link out to third-party sites; REVENGE does not host the media.",
    actions: [
      { id: "adult-search-xnxx", title: "Search XNXX", description: "Search public listings.", endpointId: "xnxx-search", fields: [q("Search terms", "Enter search terms"), { name: "limit", label: "Results", type: "select", options: [{ label: "10", value: "10" }, { label: "20", value: "20" }, { label: "30", value: "30" }] }], defaults: { limit: 10 }, confirmAdult: true },
      { id: "adult-search-xvideos", title: "Search XVideos", description: "Search public listings.", endpointId: "xvideos-search", fields: [q("Search terms", "Enter search terms"), { name: "limit", label: "Results", type: "select", options: [{ label: "10", value: "10" }, { label: "20", value: "20" }, { label: "30", value: "30" }] }], defaults: { limit: 10 }, confirmAdult: true },
    ],
  },
  "espn-sports": {
    title: "ESPN Sports",
    intro: "Scores, teams, news, and standings. Pick a league and jump straight into the matchday.",
    actions: [
      { id: "scores", title: "Scores & schedule", description: "Today's and upcoming games.", endpointId: "espn-scoreboard", fields: [{ name: "league", label: "League", type: "select", options: ["epl","laliga","ucl","mls","nba","wnba","nfl","mlb","nhl","ufc","f1","atp"].map(value=>({label:value.toUpperCase(),value})) }, { name: "date", label: "Date (optional)", type: "text", placeholder: "YYYYMMDD" }], defaults: { league: "epl" } },
      { id: "teams", title: "Teams", description: "Browse teams in a league.", endpointId: "espn-teams", fields: [{ name: "league", label: "League", type: "select", options: ["epl","laliga","ucl","nba","nfl","mlb","nhl","wnba"].map(value=>({label:value.toUpperCase(),value})) }], defaults: { league: "epl" } },
      { id: "standings", title: "Standings", description: "See the current league table.", endpointId: "espn-standings", fields: [{ name: "league", label: "League", type: "select", options: ["epl","laliga","ucl","nba","nfl","mlb","nhl","wnba"].map(value=>({label:value.toUpperCase(),value})) }], defaults: { league: "epl" } },
      { id: "sports-news", title: "Latest sports news", description: "Catch up on the latest headlines.", endpointId: "espn-news", fields: [{ name: "league", label: "League", type: "select", options: ["epl","laliga","ucl","nba","nfl","mlb","nhl"].map(value=>({label:value.toUpperCase(),value})) }], defaults: { league: "epl" } },
    ],
  },
  naijaprey: {
    title: "Naija Prey",
    intro: "Browse public posts, film listings, and search results from Naija Prey. Open an item to continue on its public source page.",
    actions: [
      { id: "naija-search", title: "Search posts", description: "Find public posts by title or topic.", endpointId: "naijaprey-search", fields: [q("What are you looking for?", "Search Naija Prey…"), { name: "per_page", label: "Results", type: "select", options: [10,20,40].map(x=>({label:String(x),value:String(x)})) }], defaults: { per_page: 20 } },
      { id: "naija-latest", title: "Latest posts", description: "See recently published posts.", endpointId: "naijaprey-home", fields: [{ name: "page", label: "Page", type: "number" }, { name: "per_page", label: "Results", type: "select", options: [10,20,40].map(x=>({label:String(x),value:String(x)})) }], defaults: { page: 1, per_page: 20 } },
      { id: "naija-movies", title: "Movies", description: "Browse movie listings.", endpointId: "naijaprey-movies", fields: [{ name: "page", label: "Page", type: "number" }, { name: "per_page", label: "Results", type: "select", options: [10,20,40].map(x=>({label:String(x),value:String(x)})) }], defaults: { page: 1, per_page: 20 } },
      { id: "naija-series", title: "Series", description: "Browse TV and series listings.", endpointId: "naijaprey-series", fields: [{ name: "page", label: "Page", type: "number" }, { name: "per_page", label: "Results", type: "select", options: [10,20,40].map(x=>({label:String(x),value:String(x)})) }], defaults: { page: 1, per_page: 20 } },
      { id: "naija-categories", title: "Categories", description: "Explore available topics.", endpointId: "naijaprey-categories", fields: [{ name: "per_page", label: "Results", type: "select", options: [20,40,60].map(x=>({label:String(x),value:String(x)})) }], defaults: { per_page: 40 } },
    ],
  },
  religion: {
    title: "Religion",
    intro: "A quiet place to look up Bible verses or listen to Quran recitations.",
    actions: [
      { id: "bible-verse", title: "Bible verse", description: "Look up a verse or passage.", endpointId: "bible", fields: [q("Passage reference", "John 3:16 or Psalm 23:1")] },
      { id: "quran-audio", title: "Quran recitation", description: "Find a surah recitation.", endpointId: "murotal", fields: [{ name: "surah", label: "Surah number or name", placeholder: "1 or Al-Fatihah", required: true }, { name: "murotal", label: "Reciter (optional)", placeholder: "Reciter name or ID" }] },
      { id: "bible-ai", title: "Bible study helper", description: "Explore a Bible topic with an AI study response.", endpointId: "bibleai", fields: [q("Topic or passage", "What would you like to study?", "q")] },
    ],
  },
  search: {
    title: "Search Engine",
    intro: "Search the web, videos, music, lyrics, and reference topics from one place.",
    actions: [
      { id: "web-search", title: "Web search", description: "Find web pages and useful sources.", endpointId: "bing-search", fields: [q("Search the web", "Search anything…"), { name: "type", label: "Search type", type: "select", options: [{label:"Web",value:"web"},{label:"Images",value:"image"}] }, { name: "limit", label: "Results", type: "select", options: [5,10,20].map(x=>({label:String(x),value:String(x)})) }], defaults: { type: "web", limit: 10 } },
      { id: "video-search", title: "Find videos", description: "Search YouTube videos.", endpointId: "youtube-search", fields: [q("Video or channel", "Search YouTube…")] },
      { id: "wiki-search", title: "Quick encyclopedia", description: "Look up a topic on Wikipedia.", endpointId: "wikipedia", fields: [q("Topic", "Search a topic…")] },
      { id: "music-search", title: "Find music", description: "Search songs and artists.", endpointId: "spotify-search", fields: [q("Song or artist", "Search music…"), { name: "limit", label: "Results", type: "select", options: [5,10,20].map(x=>({label:String(x),value:String(x)})) }], defaults: { limit: 10 } },
      { id: "lyrics-search", title: "Find lyrics", description: "Search for song lyrics.", endpointId: "lyrics-search", fields: [q("Song title", "Song name"), { name: "artist", label: "Artist (optional)", placeholder: "Artist name" }] },
      { id: "duckduckgo", title: "Private web search", description: "Search with DuckDuckGo.", endpointId: "duckduckgo-search", fields: [q("Search", "Search the web…"), { name: "region", label: "Region", placeholder: "wt-wt" }, { name: "maxResults", label: "Results", type: "select", options: [5,10,20].map(x=>({label:String(x),value:String(x)})) }], defaults: { region: "wt-wt", maxResults: 10 } },
    ],
  },
  stalk: {
    title: "STALK · Public Profiles",
    intro: "Look up information a profile has made public. Use public handles only—this does not access private accounts, messages, or hidden data.",
    actions: [
      { id: "tiktok-profile", title: "TikTok public profile", description: "Look up a public username.", endpointId: "tiktok-stalk", fields: [{ name: "username", label: "Public username", placeholder: "username (no @ needed)", required: true }] },
      { id: "threads-profile", title: "Threads public profile", description: "Look up a public username.", endpointId: "threads-stalk", fields: [{ name: "username", label: "Public username", placeholder: "username", required: true }] },
      { id: "pinterest-profile", title: "Pinterest public profile", description: "Look up a public username.", endpointId: "pinterest-stalk", fields: [{ name: "username", label: "Public username", placeholder: "username", required: true }] },
      { id: "roblox-profile", title: "Roblox public profile", description: "Look up a public username.", endpointId: "roblox-stalk", fields: [{ name: "username", label: "Public username", placeholder: "username", required: true }] },
      { id: "freefire-profile", title: "Free Fire public profile", description: "Look up a public player ID.", endpointId: "ff-stalk", fields: [{ name: "uid", label: "Player ID", placeholder: "Free Fire UID", required: true }] },
    ],
  },
  "image-editing": {
    title: "Image Editing Studio",
    intro: "Transform public images with REVENGE. Use an image link you own or have permission to edit.",
    actions: [
      { id: "remove-background", title: "Remove background", description: "Create a transparent-background result.", endpointId: "remove-background", fields: [url("Image link", "image")] },
      { id: "image-to-anime", title: "Anime style", description: "Give an image an anime-inspired look.", endpointId: "to-anime", fields: [{ name: "image_url", label: "Image link", type: "url", placeholder: "https://…", required: true }] },
      { id: "ghibli-style", title: "Storybook style", description: "Transform an image into a soft illustrated look.", endpointId: "ghibli-image", fields: [{ name: "image_url", label: "Image link", type: "url", placeholder: "https://…", required: true }] },
      { id: "image-text", title: "Read text from image", description: "Extract visible text from a picture.", endpointId: "ocr", fields: [{ name: "image", label: "Image link", type: "url", placeholder: "https://…", required: true }] },
      { id: "upscale", title: "Enhance image", description: "Upscale and improve a photo.", endpointId: "remini", fields: [{ name: "image", label: "Image link", type: "url", placeholder: "https://…", required: true }, { name: "style", label: "Enhancement", type: "select", options: [{label:"Photo",value:"enhance"},{label:"Portrait",value:"portrait"}] }], defaults: { style: "enhance" } },
      { id: "zombie", title: "Zombie effect", description: "Create a playful horror transformation.", endpointId: "to-zombie", fields: [{ name: "image_url", label: "Image link", type: "url", placeholder: "https://…", required: true }] },
    ],
  },
  textmate: {
    title: "TextMate Studio",
    intro: "Turn a name, phrase, or short message into a ready-to-save text graphic.",
    actions: [
      ...["textmate-neon","textmate-fire","textmate-ice","textmate-glitch","textmate-metallic","textmate-matrix","textmate-blackpink","textmate-effect1917","textmate-hacker","textmate-arena","textmate-impressive","textmate-light","textmate-leaves","textmate-devil","textmate-purple","textmate-sand","textmate-snow","textmate-thunder"].map((endpointId)=>({ id:endpointId, title: endpointId.replace("textmate-","").replace(/\b\w/g, c=>c.toUpperCase()), description:"Create a stylized graphic with your words.", endpointId, fields:[{name:"text",label:"Your text",placeholder:"Type a name or short phrase",required:true}] })),
    ],
  },
  pokemon: {
    title: "Pokémon Explorer",
    intro: "Explore Pokédex details, types, abilities, and browse the Pokémon list.",
    actions: [
      { id: "pokemon-lookup", title: "Pokédex lookup", description: "See type, abilities, stats, and artwork.", endpointId: "pokemon-details", fields: [{ name: "name", label: "Name or Pokédex number", placeholder: "Pikachu or 25", required: true }] },
      { id: "pokemon-type", title: "Type explorer", description: "Discover Pokémon associated with a type.", endpointId: "pokemon-type", fields: [{ name: "name", label: "Type", type: "select", options: ["normal","fire","water","electric","grass","ice","fighting","poison","ground","flying","psychic","bug","rock","ghost","dragon","dark","steel","fairy"].map(x=>({label:x,value:x})) }] },
      { id: "pokemon-ability", title: "Ability explorer", description: "Read about an ability and associated Pokémon.", endpointId: "pokemon-ability", fields: [{ name: "name", label: "Ability", placeholder: "static, levitate…", required: true }] },
      { id: "pokemon-list", title: "Browse Pokédex", description: "Show a page of Pokémon names.", endpointId: "pokemon-list", fields: [{ name: "limit", label: "How many?", type: "select", options: [20,50,100].map(x=>({label:String(x),value:String(x)})) }], defaults: { limit: 50 } },
    ],
  },
  "bilibili-tv": {
    title: "Bilibili TV",
    intro: "Search public Bilibili TV videos and creators. Video playback and availability depend on region and the source service.",
    actions: [
      { id: "bili-video-search", title: "Find videos", description: "Search Bilibili TV videos.", endpointId: "bilibili-search", fields: [{ name: "keyword", label: "Video or topic", placeholder: "Search Bilibili…", required: true }] },
      { id: "bili-creator-search", title: "Find creators", description: "Search public creator profiles.", endpointId: "bilibili-creator-search", fields: [{ name: "keyword", label: "Creator name", placeholder: "Search creators…", required: true }] },
      { id: "bili-suggestions", title: "Search suggestions", description: "Get suggestions for a search.", endpointId: "bilibili-suggest", fields: [{ name: "keyword", label: "Start typing", placeholder: "Search suggestions…", required: true }] },
    ],
  },
  audiomack: {
    title: "Audiomack",
    intro: "Discover songs and artists, browse trending music, and open tracks on their public source page.",
    actions: [
      { id: "audiomack-search", title: "Search music", description: "Find songs, artists, albums, and playlists.", endpointId: "audiomack-search", fields: [q("Song or artist", "Search Audiomack…"), { name: "limit", label: "Results", type: "select", options: [10,20,30].map(x=>({label:String(x),value:String(x)})) }], defaults: { limit: 10 } },
      { id: "audiomack-trending", title: "Trending now", description: "Explore popular tracks.", endpointId: "audiomack-trending", fields: [{ name: "limit", label: "Results", type: "select", options: [10,20,30].map(x=>({label:String(x),value:String(x)})) }], defaults: { limit: 20 } },
      { id: "audiomack-recent", title: "Recently added", description: "Find the latest music added.", endpointId: "audiomack-recent", fields: [{ name: "limit", label: "Results", type: "select", options: [10,20,30].map(x=>({label:String(x),value:String(x)})) }], defaults: { limit: 20 } },
      { id: "audiomack-chart", title: "Music charts", description: "Browse popular chart tracks.", endpointId: "audiomack-chart", fields: [{ name: "kind", label: "Chart", type: "select", options: [{label:"Songs",value:"songs"},{label:"Albums",value:"albums"},{label:"Playlists",value:"playlists"}] }, { name: "period", label: "Period", type: "select", options: [{label:"Weekly",value:"weekly"},{label:"Monthly",value:"monthly"},{label:"All time",value:"total"}] }], defaults: { kind: "songs", period: "weekly", limit: 20 } },
    ],
  },
  tools: {
    title: "Everyday Tools",
    intro: "A pocket toolkit for common web tasks—translation, links, screenshots, PDFs, and more.",
    actions: [
      { id: "translate", title: "Translate text", description: "Translate a message into another language.", endpointId: "translate", fields: [{ name: "text", label: "Text to translate", placeholder: "Write or paste text…", required: true }, { name: "lang", label: "Target language", placeholder: "English, French, Yoruba…", required: true }] },
      { id: "short-link", title: "Shorten a link", description: "Create a compact shareable URL.", endpointId: "tinyurl", fields: [url("Link to shorten")] },
      { id: "web-screenshot", title: "Website screenshot", description: "Capture a public web page.", endpointId: "webscreenshot", fields: [url("Website address"), { name: "device", label: "Screen size", type: "select", options: [{label:"Desktop",value:"desktop"},{label:"Mobile",value:"mobile"}] }], defaults: { device: "desktop" } },
      { id: "website-pdf", title: "Web page to PDF", description: "Create a PDF from a public page.", endpointId: "web2pdf", fields: [url("Website address")] },
      { id: "convert-file", title: "Convert a file", description: "Convert a publicly accessible file.", endpointId: "freeconvert", fields: [url("File link"), { name: "format", label: "Convert to", type: "select", options: ["pdf","docx","txt","jpg","png","webp","mp3","mp4"].map(x=>({label:x.toUpperCase(),value:x})) }] },
    ],
  },
  "api-tools": {
    title: "40+ More Tools",
    intro: "48 tools in one place: 31 provider-backed discovery actions plus 16 built-in browser utilities and an authenticated image-to-public-link uploader. Provider-backed results still depend on upstream availability.",
    actions: [
      { id: "local-image-url", title: "Image to public URL", description: "Upload a supported image to REVENGE Storage and copy its public link. Anyone with the link can view it.", endpointId: "local-image-public-url", fields: [{ name: "file", label: "Choose image (PNG, JPEG, WebP, or GIF · up to 4 MB)", type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", required: true }, { name: "consent", label: "I own or have permission to share this image, and understand anyone with the link can view it.", type: "checkbox", required: true }] },
      { id: "local-json-pretty", title: "Format JSON", description: "Validate JSON and format it for reading.", endpointId: "local-json-pretty", fields: [prompt("JSON input", "Paste JSON…", "text")] },
      { id: "local-json-minify", title: "Minify JSON", description: "Validate JSON and remove unnecessary whitespace.", endpointId: "local-json-minify", fields: [prompt("JSON input", "Paste JSON…", "text")] },
      { id: "local-csv-json", title: "CSV to JSON", description: "Convert a quoted CSV table into an array of objects.", endpointId: "local-csv-to-json", fields: [prompt("CSV input", "name,city\nAda,Lagos", "text")] },
      { id: "local-json-csv", title: "JSON to CSV", description: "Turn a JSON array of objects into a downloadable-friendly CSV string.", endpointId: "local-json-to-csv", fields: [prompt("JSON array", "[{\"name\":\"Ada\",\"city\":\"Lagos\"}]", "text")] },
      { id: "local-url-encode", title: "URL encode", description: "Encode text safely for use in a URL component.", endpointId: "local-url-encode", fields: [prompt("Text to encode", "Text or URL value…", "text")] },
      { id: "local-url-decode", title: "URL decode", description: "Decode URL-encoded text.", endpointId: "local-url-decode", fields: [prompt("Text to decode", "Paste encoded text…", "text")] },
      { id: "local-base64-encode", title: "Base64 encode", description: "Encode UTF-8 text, including non-English characters.", endpointId: "local-base64-encode", fields: [prompt("Text to encode", "Write or paste text…", "text")] },
      { id: "local-base64-decode", title: "Base64 decode", description: "Decode UTF-8 Base64 text.", endpointId: "local-base64-decode", fields: [prompt("Base64 input", "Paste Base64…", "text")] },
      { id: "local-uuid", title: "Generate UUID", description: "Create a cryptographically random UUID v4.", endpointId: "local-uuid-generate", fields: [] },
      { id: "local-password", title: "Generate password", description: "Create a random password locally in your browser.", endpointId: "local-password-generate", fields: [{ name: "length", label: "Length", type: "select", options: [16, 20, 32, 48, 64].map(x => ({ label: String(x), value: String(x) })) }], defaults: { length: 20 } },
      { id: "local-timestamp", title: "Timestamp converter", description: "Convert a Unix timestamp to a date, or a date to Unix seconds and milliseconds.", endpointId: "local-timestamp-convert", fields: [q("Timestamp or date", "1740000000 or 2025-02-19T10:00:00Z", "value"), { name: "mode", label: "Convert", type: "select", options: [{ label: "Unix timestamp to date", value: "timestamp-to-date" }, { label: "Date to Unix timestamp", value: "date-to-unix" }] }], defaults: { mode: "timestamp-to-date" } },
      { id: "local-color", title: "HEX color converter", description: "Convert HEX colors to RGB and HSL values.", endpointId: "local-color-convert", fields: [q("HEX color", "#37A8E8", "hex")] },
      { id: "local-contrast", title: "Contrast checker", description: "Check foreground/background contrast against WCAG AA and AAA text targets.", endpointId: "local-contrast-check", fields: [q("Foreground HEX", "#111827", "foreground"), q("Background HEX", "#FFFFFF", "background")] },
      { id: "local-text-stats", title: "Word & character counter", description: "Count words, characters, lines, and UTF-8 bytes locally.", endpointId: "local-text-stats", fields: [prompt("Text", "Write or paste text…", "text")] },
      { id: "local-html-escape", title: "Escape HTML", description: "Escape text characters that have special meaning in HTML.", endpointId: "local-html-escape", fields: [prompt("Text to escape", "Paste text…", "text")] },
      { id: "local-html-unescape", title: "Unescape HTML", description: "Decode common named and numeric HTML entities.", endpointId: "local-html-unescape", fields: [prompt("HTML entities", "&lt;hello&gt;", "text")] },

      { id: "extra-github-repo-search", title: "GitHub repository search", description: "Search public GitHub repositories, sorted by stars. Uses GitHub’s public REST API.", endpointId: "github-repo-search", fields: [q("Repository, topic, or developer tool", "Search GitHub repositories", "query"), { name: "language", label: "Language filter (optional)", placeholder: "TypeScript, Python…" }] },
      { id: "extra-apple-music-search", title: "Apple Music search", description: "Search Apple Music catalogs.", endpointId: "apple-music-search", fields: [q("Artist, album, or track", "Search Apple Music"), { name: "country", label: "Storefront", placeholder: "us", required: true }], defaults: { country: "us", limit: 10 } },
      { id: "extra-apple-music-details", title: "Apple Music details", description: "Look up a song, album, artist, or playlist.", endpointId: "apple-music-details", fields: [q("Music URL or resource ID", "Paste a music.apple.com link or ID", "id"), { name: "type", label: "Resource type", type: "select", options: ["song", "album", "artist", "playlist"].map(x => ({ label: x, value: x })) }, { name: "country", label: "Storefront", placeholder: "us" }], defaults: { country: "us" } },
      { id: "extra-shazam", title: "Identify a song clip", description: "Identify music from a direct public audio file.", endpointId: "shazam-search", fields: [url("Audio file URL"), { name: "duration", label: "Listen window (seconds)", type: "select", options: ["5", "12", "20", "30"].map(x => ({ label: x, value: x })) }], defaults: { duration: 12, country: "US", language: "en-US" } },
      { id: "extra-wallpaper", title: "4K wallpaper search", description: "Search high-resolution wallpapers.", endpointId: "4kwallpaper", fields: [q("Wallpaper topic", "Cars, anime, nature…")] },
      { id: "extra-stickers", title: "Sticker pack search", description: "Find public sticker packs.", endpointId: "stickersearch", fields: [q("Sticker topic", "Search sticker packs"), { name: "limit", label: "Packs", type: "select", options: ["5", "10", "20"].map(x => ({ label: x, value: x })) }], defaults: { limit: 10 } },
      { id: "extra-pinterest", title: "Pinterest search", description: "Search public Pins by keyword.", endpointId: "pinterest-search", fields: [q("Search Pins", "Search images or videos"), { name: "type", label: "Media", type: "select", options: [{ label: "Images", value: "image" }, { label: "Video", value: "video" }, { label: "All", value: "all" }] }], defaults: { type: "image", limit: 10 } },
      { id: "extra-tiktok-search", title: "TikTok search", description: "Search public TikTok listings.", endpointId: "tiktok-search", fields: [q("Search videos", "Topic or keyword")], defaults: { count: 10 } },
      { id: "extra-netshort-search", title: "Short-drama search", description: "Search NetShort drama titles.", endpointId: "netshort-search", fields: [q("Drama title", "Search short dramas")], defaults: { limit: 20 } },
      { id: "extra-netshort-detail", title: "Short-drama details", description: "Look up public drama or episode details.", endpointId: "netshort-detail", fields: [url("Drama or episode URL")] },
      { id: "extra-netshort-download", title: "Short-drama options", description: "Check provider-returned episode links.", endpointId: "netshort-download", fields: [url("Episode URL or drama slug")] },
      { id: "extra-naijaprey-resolve", title: "Resolve a public post link", description: "Inspect a public Naija Prey post/download page.", endpointId: "naijaprey-resolve", fields: [url("Public post or download URL")] },
      { id: "extra-naijaprey-id", title: "Naija Prey post by ID", description: "Look up a public post ID.", endpointId: "naijaprey-post-by-id", fields: [{ name: "id", label: "Post ID", type: "number", placeholder: "123", required: true }] },
      { id: "extra-naijaprey-slug", title: "Naija Prey post by slug", description: "Look up a public post slug.", endpointId: "naijaprey-post-by-slug", fields: [q("Post slug", "movie-post-slug", "slug")] },
      { id: "extra-naijaprey-tags", title: "Browse public tags", description: "List available public post tags.", endpointId: "naijaprey-tags", fields: [{ name: "per_page", label: "Tags per page", type: "select", options: ["20", "40", "60"].map(x => ({ label: x, value: x })) }], defaults: { page: 1, per_page: 40 } },
      { id: "extra-naijaprey-tag-posts", title: "Posts by tag", description: "Find public posts under a tag slug.", endpointId: "naijaprey-tag-posts", fields: [q("Tag slug", "tag-slug", "slug")], defaults: { page: 1, per_page: 20 } },
      { id: "extra-screen-record", title: "Record a web page", description: "Request a short screen recording of a public page.", endpointId: "webscreenrecord", fields: [url("Public webpage"), { name: "device", label: "Viewport", type: "select", options: [{ label: "Desktop", value: "desktop" }, { label: "Mobile", value: "mobile" }, { label: "Tablet", value: "tablet" }] }], defaults: { device: "desktop", duration: 8000 } },
      { id: "extra-web-zip", title: "Website to ZIP", description: "Package a public website where the provider allows it.", endpointId: "web2zip", fields: [url("Website URL")] },
      { id: "extra-web-apk", title: "Website to Android package", description: "Request an Android wrapper for a website.", endpointId: "web2apk", method: "POST", fields: [url("Website URL"), { name: "appName", label: "App name", placeholder: "My web app", required: true }, { name: "icon", label: "Public PNG icon URL", type: "url", placeholder: "https://example.com/icon.png", required: true }] },
      { id: "extra-link-resolver", title: "Resolve SFL short link", description: "Resolve a supported SFL short URL.", endpointId: "sfl-link-bypasser", fields: [url("SFL short URL")] },
      { id: "extra-pokemon-list", title: "Browse Pokémon list", description: "Get a page of Pokédex names.", endpointId: "pokemon-list", fields: [{ name: "limit", label: "Number of results", type: "select", options: ["20", "50", "100"].map(x => ({ label: x, value: x })) }], defaults: { limit: 50 } },
      { id: "extra-pokemon-type", title: "Pokémon by type", description: "Explore species of a chosen type.", endpointId: "pokemon-type", fields: [{ name: "name", label: "Type", type: "select", options: ["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"].map(x => ({ label: x, value: x })) }] },
      { id: "extra-pokemon-ability", title: "Pokémon ability guide", description: "Look up a Pokédex ability.", endpointId: "pokemon-ability", fields: [q("Ability", "Static, levitate…", "name")] },
      { id: "extra-espn-news", title: "Sports news", description: "Get headlines for a league.", endpointId: "espn-news", fields: [{ name: "league", label: "League", type: "select", options: ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab", "wnba", "epl", "laliga", "ucl", "mls", "ufc", "pga", "atp", "f1"].map(x => ({ label: x.toUpperCase(), value: x })) }], defaults: { league: "epl" } },
      { id: "extra-espn-standings", title: "League standings", description: "View provider-returned table standings.", endpointId: "espn-standings", fields: [{ name: "league", label: "League", type: "select", options: ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab", "wnba", "epl", "laliga", "ucl", "mls", "ufc", "pga", "atp", "f1"].map(x => ({ label: x.toUpperCase(), value: x })) }], defaults: { league: "epl" } },
      { id: "extra-espn-teams", title: "Teams directory", description: "Browse teams in a league.", endpointId: "espn-teams", fields: [{ name: "league", label: "League", type: "select", options: ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab", "wnba", "epl", "laliga", "ucl", "mls", "ufc", "pga", "atp", "f1"].map(x => ({ label: x.toUpperCase(), value: x })) }], defaults: { league: "epl" } },
      { id: "extra-bili-anime", title: "Bilibili anime search", description: "Search public Bilibili anime listings.", endpointId: "bilibili-anime-search", fields: [q("Anime title", "Search anime", "keyword")] },
      { id: "extra-bili-playurl", title: "Bilibili play URL", description: "Request stream metadata; playback may be region or login restricted.", endpointId: "bilibili-playurl", fields: [q("Video aid", "Bilibili aid", "aid"), { name: "qn", label: "Quality code", type: "select", options: [{ label: "360p", value: "16" }, { label: "480p", value: "32" }, { label: "720p", value: "64" }, { label: "1080p", value: "80" }] }], defaults: { qn: "64", type: "0", device: "wap" } },
      { id: "extra-bili-subtitle", title: "Bilibili subtitles", description: "Look up public subtitle metadata for a video aid.", endpointId: "bilibili-subtitle", fields: [q("Video aid", "Bilibili aid", "aid")] },
      { id: "extra-audiomack-song", title: "Audiomack song details", description: "Look up a track by numeric ID.", endpointId: "audiomack-song", fields: [{ name: "id", label: "Track ID", type: "number", placeholder: "106590250", required: true }] },
      { id: "extra-audiomack-play", title: "Audiomack stream resolver", description: "Resolve a short-lived stream URL for a track ID.", endpointId: "audiomack-play", fields: [{ name: "id", label: "Track ID", type: "number", placeholder: "106590250", required: true }] },
    ],
  },
};
