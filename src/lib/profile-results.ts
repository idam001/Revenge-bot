type Row = Record<string, unknown>;
const PROFILE_KEYS = new Set([
  "username", "uniqueid", "displayname", "nickname", "handle", "userid", "user_id",
  "followercount", "followers", "followingcount", "following", "heartcount", "likecount",
  "videocount", "verified", "signature", "bio", "description", "avatar", "avatarurl",
]);
const PROFILE_CONTAINERS = /^(result|results|data|user|profile|account|userinfo|user_info|stats|statistics|items|profiles)$/i;
const keyNorm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

function looksLikeProfile(row: Row): boolean {
  const keys = Object.keys(row).map(keyNorm);
  const hasIdentity = keys.some(key => ["username", "uniqueid", "displayname", "nickname", "handle", "userid"].includes(key));
  const hasAvatarAndBio = keys.some(key => ["avatar", "avatarurl"].includes(key)) && keys.some(key => ["signature", "bio", "description"].includes(key));
  return hasIdentity || hasAvatarAndBio;
}

/** Normalize common public-profile API envelopes (e.g. result.user + result.stats) for the UI. */
export function extractPublicProfileRows(value: unknown): Row[] {
  const output: Row[] = [];
  const seen = new Set<string>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 7 || output.length >= 20 || item == null) return;
    if (Array.isArray(item)) { for (const child of item.slice(0, 20)) visit(child, depth + 1); return; }
    if (typeof item !== "object") return;
    const row = item as Row;
    const entries = Object.entries(row);
    const userEntry = entries.find(([key, child]) => /^(user|profile|account|userinfo|user_info)$/i.test(key) && child && typeof child === "object" && !Array.isArray(child));
    const statsEntry = entries.find(([key, child]) => /^(stats|statistics)$/i.test(key) && child && typeof child === "object" && !Array.isArray(child));
    const candidate = userEntry
      ? { ...(userEntry[1] as Row), ...(statsEntry ? statsEntry[1] as Row : {}) }
      : row;
    if (looksLikeProfile(candidate)) {
      const identifier = String(candidate.userId ?? candidate.user_id ?? candidate.uniqueId ?? candidate.unique_id ?? candidate.username ?? candidate.handle ?? candidate.nickname ?? "").toLowerCase();
      const key = identifier || JSON.stringify(candidate).slice(0, 300);
      if (!seen.has(key)) { seen.add(key); output.push(candidate); }
    }
    for (const [key, child] of entries) {
      if (PROFILE_CONTAINERS.test(key) || Array.isArray(child)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return output;
}
