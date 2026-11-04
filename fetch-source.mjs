// Vercel install step: download the source snapshot and unpack it into the
// build root, then `npm install` + `next build` run against real sources.
import { writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const url = "https://fszewuewdsjloiwwggvy.supabase.co/storage/v1/object/public/deploy/source-agent-review-checkpoints-20261104.tar.gz";
const res = await fetch(url);
if (!res.ok) throw new Error("source download failed " + res.status);
writeFileSync("/tmp/src.tar.gz", Buffer.from(await res.arrayBuffer()));
console.log("source downloaded", statSync("/tmp/src.tar.gz").size, "bytes");
execSync("tar -xzf /tmp/src.tar.gz -C .", { stdio: "inherit" });
console.log("source unpacked:", execSync("ls package.json src/app/page.tsx 2>/dev/null | tr '\\n' ' '").toString());
