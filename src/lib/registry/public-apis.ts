export type PublicApiCandidate = {
  id: string;
  name: string;
  description: string;
  sourceCategory: string;
  auth: string;
  https: "Yes" | "No" | "Unknown";
  cors: "Yes" | "No" | "Unknown";
  url: string;
  sourceUrl: string;
  license: "MIT";
  status: "unverified";
};

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function markdownLink(cell: string): { label: string; url: string } {
  const match = cell.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i);
  if (match) return { label: match[1].trim(), url: match[2].trim() };
  const raw = cell.match(/https?:\/\/[^\s|)]+/i)?.[0] || "";
  return { label: cell.replace(/\[[^\]]*\]\([^)]*\)/g, "").trim(), url: raw };
}
function boolish(value: string): "Yes" | "No" | "Unknown" {
  const normalized = value.replace(/[`*_]/g, "").trim().toLowerCase();
  return normalized === "yes" ? "Yes" : normalized === "no" ? "No" : "Unknown";
}
function slug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "api";
}

/** Parse all Public APIs README category tables without treating links as callable endpoints. */
export function parsePublicApisReadme(markdown: string, sourceUrl = "https://github.com/public-apis/public-apis") {
  const lines = markdown.split(/\r?\n/);
  const output: PublicApiCandidate[] = [];
  let category = "Uncategorized";
  let headers: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*#*$/);
    if (heading) { category = heading[1].replace(/[`*_]/g, "").trim(); headers = []; continue; }
    if (!line.trim().startsWith("|")) continue;
    const row = cells(line);
    if (row.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    const lower = row.map((cell) => cell.replace(/[`*_]/g, "").trim().toLowerCase());
    if (lower.some((cell) => ["api", "name"].includes(cell)) && lower.some((cell) => cell.includes("description"))) {
      headers = lower; continue;
    }
    if (!headers.length || row.length < 3) continue;
    const apiIndex = headers.findIndex((cell) => cell === "api" || cell === "name");
    const descriptionIndex = headers.findIndex((cell) => cell.includes("description"));
    const authIndex = headers.findIndex((cell) => cell === "auth" || cell.includes("authentication"));
    const httpsIndex = headers.findIndex((cell) => cell === "https");
    const corsIndex = headers.findIndex((cell) => cell === "cors");
    const api = markdownLink(row[apiIndex] || "");
    const description = (row[descriptionIndex] || "").replace(/<[^>]*>/g, " ").replace(/[`*_]/g, "").trim();
    if (!api.label || !/^https:\/\//i.test(api.url) || !description) continue;
    const name = api.label.slice(0, 120);
    const id = `public-apis-${slug(category)}-${slug(name)}`;
    output.push({
      id, name, description: description.slice(0, 500), sourceCategory: category,
      auth: (row[authIndex] || "Unknown").replace(/[`*_]/g, "").trim().slice(0, 80) || "Unknown",
      https: boolish(row[httpsIndex] || ""), cors: boolish(row[corsIndex] || ""),
      url: api.url, sourceUrl, license: "MIT", status: "unverified",
    });
  }
  const seen = new Set<string>();
  return output.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
}
