import test from "node:test";
import assert from "node:assert/strict";
import { extractAdultSourceMedia } from "../../src/lib/adult-source-resolver";

test("extracts only explicit XNXX player MP4/HLS fields and prefers MP4", () => {
  const html = `
    <meta property="og:url" content="https://www.xnxx.com/video-a/watch-title">
    <script>
      html5player.setVideoUrlLow('https:\\/\\/cdn.example.test\\/low.mp4?token=a\\u0026b=2');
      html5player.setVideoUrlHigh("https://cdn.example.test/high.mp4?token=c&amp;x=1");
      html5player.setVideoUrlHLS('https://cdn.example.test/master.m3u8');
    </script>`;
  const result = extractAdultSourceMedia(html, "https://www.xnxx.com/video-a/watch-title", "xnxx");
  assert.equal(result?.format, "mp4");
  assert.equal(result?.playUrl, "https://cdn.example.test/low.mp4?token=a&b=2");
  assert.deepEqual(result?.downloads, [
    "https://cdn.example.test/low.mp4?token=a&b=2",
    "https://cdn.example.test/high.mp4?token=c&x=1",
  ]);
});

test("recognizes HLS only and rejects off-site watch pages or unsafe player URLs", () => {
  assert.equal(extractAdultSourceMedia(
    `html5player.setVideoUrlHLS('https://cdn.example.test/stream.m3u8');`,
    "https://www.xvideos.com/video-1/title", "xnxx"), null);
  const result = extractAdultSourceMedia(
    `html5player.setVideoUrlHLS('https://cdn.example.test/stream.m3u8'); html5player.setVideoUrlHigh('javascript:alert(1)');`,
    "https://www.xvideos.com/video-1/title", "xvideos");
  assert.equal(result?.format, "hls");
  assert.deepEqual(result?.downloads, []);
});
