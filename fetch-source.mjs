// Vercel install step: download the source snapshot and unpack it into the
// build root, then `npm install` + `next build` run against real sources.
import { writeFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const url = "https://www.dropbox.com/scl/fi/t6655yv1565ku92uifogv/revenge-gpt-release-20261115.tar.gz?rlkey=rkk5mzp3hx1sm73tsjw7x8f03&dl=1";
const res = await fetch(url);
if (!res.ok) throw new Error("source download failed " + res.status);
writeFileSync("/tmp/src.tar.gz", Buffer.from(await res.arrayBuffer()));
console.log("source downloaded", statSync("/tmp/src.tar.gz").size, "bytes");
execSync("tar -xzf /tmp/src.tar.gz -C .", { stdio: "inherit" });
console.log("source unpacked:", execSync("ls package.json src/app/page.tsx 2>/dev/null | tr '\\n' ' '").toString());
