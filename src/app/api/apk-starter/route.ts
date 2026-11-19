import JSZip from "jszip";
import { isIP } from "node:net";
import { requireUser } from "@/lib/auth";
import { rateLimitShared } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await requireUser(req);
  if (gate.response) return gate.response;
  const rate = await rateLimitShared(`apk-starter:${gate.user.id}`, 10, 60 * 60_000);
  if (!rate.ok) return Response.json({ error: `Starter limit reached. Try again in about ${Math.ceil(rate.retryAfterSec / 60)} minutes.` }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } });
  const body = await req.json().catch(() => null) as { url?: unknown; packageId?: unknown; appName?: unknown } | null;
  if (!body || typeof body.url !== "string") return Response.json({ error: "Enter an HTTPS website URL." }, { status: 400 });
  let url: URL;
  try { url = new URL(body.url.trim()); } catch { return Response.json({ error: "Enter a valid website URL." }, { status: 400 }); }
  const hostname = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
  const ipVersion = isIP(hostname);
  const privateV4 = ipVersion === 4 && (/^(10\\.|127\\.|0\\.|192\\.168\\.|169\\.254\\.)/.test(hostname) || /^172\\.(1[6-9]|2[0-9]|3[01])\\./.test(hostname));
  if (url.protocol !== "https:" || url.username || url.password || !hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || privateV4 || (ipVersion === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:")))) {
    return Response.json({ error: "Use a public HTTPS website address (not a local or private URL)." }, { status: 400 });
  }
  url.hash = "";
  const packageId = typeof body.packageId === "string" ? body.packageId.trim() : "com.example.myapp";
  if (packageId.length > 180 || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,6}$/.test(packageId)) {
    return Response.json({ error: "Package ID must look like com.example.myapp and use lowercase letters, numbers, and underscores." }, { status: 400 });
  }
  const appName = (typeof body.appName === "string" ? body.appName.trim() : "My website").replace(/[<>\r\n]/g, "").slice(0, 50) || "My website";
  const origin = url.origin;
  const manifestUrl = new URL("/manifest.json", origin).toString();
  const zip = new JSZip();
  const readme = `# ${appName} — Android app starter

This starter configures a Trusted Web Activity (TWA) for ${url.toString()}. It is a source project, not a compiled or signed APK.

## Requirements

- The website must be publicly reachable over HTTPS.
- Serve a valid web app manifest at ${manifestUrl}, with an app name, start URL, display mode and icons.
- You must control the website domain. Android verifies ownership using /.well-known/assetlinks.json.
- An Android signing key is required for a release APK. Keep the keystore and passwords private; never commit them.
- Build requires Node.js, Java 17+ and the Android SDK (Bubblewrap can prompt to install it).

## Build the Android project

1. Install Node.js 20+ and Java 17 or newer.
2. Install Bubblewrap: npm install --global @bubblewrap/cli
3. Run: bubblewrap init --manifest ${manifestUrl}
4. Follow the prompts and use application ID ${packageId}.
5. Run: bubblewrap build. Bubblewrap creates the APK after you supply or confirm signing credentials.
6. Publish the generated Digital Asset Links file at ${origin}/.well-known/assetlinks.json. The package name and SHA-256 signing certificate fingerprint must match your app.
7. Install the APK on a device and verify the TWA opens without browser chrome.

## Important

This wrapper opens your hosted website; it does not bundle the website for offline use. For offline HTML/ZIP apps, use a WebView-based Android project instead. A site URL alone cannot safely produce a trusted, signed APK without domain ownership verification and signing.

Google TWA guide: https://developer.chrome.com/docs/android/trusted-web-activity/quick-start/
`;
  zip.file("README.md", readme);
  zip.file("twa-app-details.json", JSON.stringify({ appName, packageId, startUrl: url.toString(), webManifestUrl: manifestUrl, appType: "trusted-web-activity", minSdkVersion: 21 }, null, 2));
  zip.file(".gitignore", "node_modules/\n.gradle/\nbuild/\n*.jks\n*.keystore\nlocal.properties\n");
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const safeFile = packageId.replaceAll(".", "-");
  return new Response(new Uint8Array(buffer), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename=\"${safeFile}-android-starter.zip\"`,
    "Cache-Control": "private, no-store",
  } });
}
