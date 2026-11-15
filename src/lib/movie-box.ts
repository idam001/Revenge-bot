export type ArchiveFile = { name?: unknown; format?: unknown; size?: unknown; source?: unknown };
export type PublicMovie = {
  id: string;
  title: string;
  year: string;
  description: string;
  creator: string;
  license: string;
  licenseUrl: string;
  detailsUrl: string;
  posterUrl: string;
  videoUrl: string;
  downloadUrl: string;
  fileName: string;
  sizeBytes: number | null;
};

export function acceptedLicense(licenseUrl: unknown, rights: unknown): { label: string; url: string } | null {
  const url = typeof licenseUrl === "string" ? licenseUrl.trim() : "";
  const rightsText = typeof rights === "string" ? rights.trim() : "";
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { /* rights statement may still identify public domain */ }
  const host = parsed?.hostname.toLowerCase();
  const path = parsed?.pathname.toLowerCase().replace(/\/+$/, "") || "";
  if (parsed?.protocol === "https:" && host === "creativecommons.org") {
    if (/^\/publicdomain\/(mark|zero)\/1\.0$/.test(path)) return { label: "Public domain / CC0", url };
    if (/^\/licenses\/by-sa\/(2\.0|3\.0|4\.0)$/.test(path)) return { label: "Creative Commons BY-SA", url };
    if (/^\/licenses\/by\/(2\.0|3\.0|4\.0)$/.test(path)) return { label: "Creative Commons BY", url };
  }
  if (!url && /\b(public domain|public-domain|cc0)\b/i.test(rightsText)) return { label: "Public domain (provider rights statement)", url: "https://archive.org/" };
  return null;
}

function normalizedSize(value: unknown): number | null {
  const size = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

export function pickLicensedVideoFile(files: unknown): { name: string; sizeBytes: number | null } | null {
  if (!Array.isArray(files)) return null;
  const candidates = (files as ArchiveFile[]).flatMap((file) => {
    const name = typeof file.name === "string" ? file.name : "";
    const format = typeof file.format === "string" ? file.format.toLowerCase() : "";
    if (!name || name.startsWith("/") || name.includes("..") || name.includes("\\") || !/\.(mp4|m4v|webm|ogv|mov)$/i.test(name)) return [];
    if (/^(metadata|original)$/i.test(String(file.source || "")) && !/\.mp4$/i.test(name)) return [];
    if (/thumbnail|sample|preview|subtitles|\.srt$/i.test(name) || /thumbnail|image|subtitle|metadata/.test(format)) return [];
    return [{ name, sizeBytes: normalizedSize(file.size), rank: /mpeg4|mpeg-4|h\.264|h264|webm|ogg video/.test(format) ? 1 : 0 }];
  });
  candidates.sort((a, b) => b.rank - a.rank || (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
  const chosen = candidates[0];
  return chosen ? { name: chosen.name, sizeBytes: chosen.sizeBytes } : null;
}

function archiveFileUrl(identifier: string, fileName: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;
}
function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function makePublicMovie(identifierValue: unknown, searchDoc: Record<string, unknown>, metadata: Record<string, unknown>): PublicMovie | null {
  const identifier = typeof identifierValue === "string" ? identifierValue : "";
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(identifier)) return null;
  const info = metadata.metadata && typeof metadata.metadata === "object" ? metadata.metadata as Record<string, unknown> : {};
  const license = acceptedLicense(info.licenseurl ?? searchDoc.licenseurl, info.rights ?? searchDoc.rights);
  if (!license) return null;
  const file = pickLicensedVideoFile(metadata.files);
  if (!file) return null;
  const title = cleanText(info.title ?? searchDoc.title, 180) || identifier;
  const year = cleanText(info.year ?? searchDoc.year, 12);
  const description = cleanText(info.description ?? searchDoc.description, 900);
  const creator = cleanText(info.creator ?? searchDoc.creator, 120);
  const videoUrl = archiveFileUrl(identifier, file.name);
  return {
    id: identifier,
    title,
    year,
    description,
    creator,
    license: license.label,
    licenseUrl: license.url,
    detailsUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    posterUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    videoUrl,
    downloadUrl: videoUrl,
    fileName: file.name,
    sizeBytes: file.sizeBytes,
  };
}
