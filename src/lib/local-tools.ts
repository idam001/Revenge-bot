export const LOCAL_TOOL_IDS = [
  "json-pretty",
  "json-minify",
  "csv-to-json",
  "json-to-csv",
  "url-encode",
  "url-decode",
  "base64-encode",
  "base64-decode",
  "uuid-generate",
  "password-generate",
  "timestamp-convert",
  "color-convert",
  "contrast-check",
  "text-stats",
  "html-escape",
  "html-unescape",
] as const;

export type LocalToolId = (typeof LOCAL_TOOL_IDS)[number];
export type ToolParams = Record<string, string | number | boolean>;

function requiredText(params: ToolParams, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell.length || row.length || source.endsWith(",")) { row.push(cell); rows.push(row); }
  return rows.filter((current, index) => !(index === rows.length - 1 && current.length === 1 && current[0] === ""));
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function b64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function b64Decode(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function randomPassword(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_";
  if (!Number.isInteger(length) || length < 8 || length > 128) throw new Error("Choose a password length from 8 to 128.");
  const ceiling = Math.floor(256 / alphabet.length) * alphabet.length;
  let password = "";
  while (password.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.max(16, length - password.length)));
    for (const byte of bytes) {
      if (byte >= ceiling) continue;
      password += alphabet[byte % alphabet.length];
      if (password.length === length) break;
    }
  }
  return password;
}

function hslFromRgb(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return [hue, Math.round(saturation * 100), Math.round(lightness * 100)];
}

function rgbFromHex(value: string): [number, number, number] {
  let hex = value.trim().replace(/^#/, "");
  if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map(char => char + char).join("");
  if (!/^[\da-f]{6}$/i.test(hex)) throw new Error("Enter a 3- or 6-digit HEX color, such as #37A8E8.");
  const int = Number.parseInt(hex, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ENTITIES[char]); }
function unescapeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
      return String.fromCodePoint(code);
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" } as Record<string, string>)[name.toLowerCase()] ?? entity;
  });
}

export function runLocalTool(id: string, params: ToolParams): string {
  switch (id) {
    case "json-pretty": return JSON.stringify(JSON.parse(requiredText(params, "text")), null, 2);
    case "json-minify": return JSON.stringify(JSON.parse(requiredText(params, "text")));
    case "csv-to-json": {
      const rows = parseCsv(requiredText(params, "text"));
      if (!rows.length) throw new Error("Add a CSV header row and at least one data row.");
      const [headers, ...data] = rows;
      if (!headers.length || headers.some(header => !header.trim())) throw new Error("Every CSV column needs a non-empty header.");
      return JSON.stringify(data.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))), null, 2);
    }
    case "json-to-csv": {
      const value: unknown = JSON.parse(requiredText(params, "text"));
      if (!Array.isArray(value) || !value.length || !value.every(row => row && typeof row === "object" && !Array.isArray(row))) throw new Error("Provide a non-empty JSON array of objects.");
      const headers = [...new Set(value.flatMap(row => Object.keys(row as Record<string, unknown>)))];
      if (!headers.length) throw new Error("The JSON objects have no columns.");
      return [headers.map(csvCell).join(","), ...value.map(row => headers.map(header => csvCell((row as Record<string, unknown>)[header])).join(","))].join("\n");
    }
    case "url-encode": return encodeURIComponent(requiredText(params, "text"));
    case "url-decode": {
      try { return decodeURIComponent(requiredText(params, "text").replace(/\+/g, "%20")); }
      catch { throw new Error("That is not valid URL-encoded text."); }
    }
    case "base64-encode": return b64Encode(requiredText(params, "text"));
    case "base64-decode": {
      try { return b64Decode(requiredText(params, "text")); }
      catch { throw new Error("That is not valid UTF-8 Base64 text."); }
    }
    case "uuid-generate": return crypto.randomUUID();
    case "password-generate": return randomPassword(Number(params.length ?? 20));
    case "timestamp-convert": {
      const value = requiredText(params, "value").trim();
      if (params.mode === "date-to-unix") {
        const milliseconds = Date.parse(value);
        if (!Number.isFinite(milliseconds)) throw new Error("Enter a valid date and time.");
        return `Unix seconds: ${Math.floor(milliseconds / 1000)}\nUnix milliseconds: ${milliseconds}`;
      }
      if (!/^\d{1,16}$/.test(value)) throw new Error("Enter a Unix timestamp using digits only.");
      const number = Number(value);
      const milliseconds = value.length <= 10 ? number * 1000 : number;
      const date = new Date(milliseconds);
      if (!Number.isFinite(date.getTime())) throw new Error("That timestamp is outside the supported date range.");
      return `UTC: ${date.toISOString()}\nLocal: ${date.toString()}`;
    }
    case "color-convert": {
      const rgb = rgbFromHex(requiredText(params, "hex"));
      const [h, s, l] = hslFromRgb(...rgb);
      const hex = `#${rgb.map(part => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
      return `HEX: ${hex}\nRGB: rgb(${rgb.join(", ")})\nHSL: hsl(${h}, ${s}%, ${l}%)`;
    }
    case "contrast-check": {
      const foreground = rgbFromHex(requiredText(params, "foreground"));
      const background = rgbFromHex(requiredText(params, "background"));
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      const ratio = (values[0] + 0.05) / (values[1] + 0.05);
      return `Contrast ratio: ${ratio.toFixed(2)}:1\nWCAG AA normal text: ${ratio >= 4.5 ? "PASS" : "FAIL"}\nWCAG AA large text: ${ratio >= 3 ? "PASS" : "FAIL"}\nWCAG AAA normal text: ${ratio >= 7 ? "PASS" : "FAIL"}`;
    }
    case "text-stats": {
      const text = requiredText(params, "text");
      const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
      const chars = [...text].length;
      const lines = text.length ? text.split(/\r\n|\r|\n/).length : 0;
      return `Words: ${words}\nCharacters: ${chars}\nCharacters (excluding whitespace): ${[...text].filter(char => !/\s/u.test(char)).length}\nLines: ${lines}\nUTF-8 size: ${new TextEncoder().encode(text).length} bytes`;
    }
    case "html-escape": return escapeHtml(requiredText(params, "text"));
    case "html-unescape": return unescapeHtml(requiredText(params, "text"));
    default: throw new Error("Unknown built-in tool.");
  }
}
