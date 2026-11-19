import test from "node:test";
import assert from "node:assert/strict";
import { adultMediaOf, sourcePageUrlOf } from "../../src/lib/adult-media";

test("uses the watch-page link rather than a returned media URL as the details slug", () => {
  const row = {
    downloadUrl: "https://cdn.example.test/file.mp4",
    page_url: "https://www.xnxx.com/video-abc/watch-title",
  };
  assert.equal(sourcePageUrlOf(row, "xnxx"), "https://www.xnxx.com/video-abc/watch-title");
});

test("does not accept off-site pages as an XNXX details slug", () => {
  assert.equal(sourcePageUrlOf({ url: "https://attacker.example/video.mp4" }, "xnxx"), "");
});

test("prefers a provider direct MP4 and exposes it as the downloadable option", () => {
  const media = adultMediaOf({
    m3u8_base_url: "https://cdn.example.test/master.m3u8?token=x",
    downloadUrl: "https://cdn.example.test/video-720.mp4?token=y",
    webpage_url: "https://www.xnxx.com/video-abc/title",
    thumbnail: "https://cdn.example.test/cover.jpg",
  });
  assert.deepEqual(media, {
    playUrl: "https://cdn.example.test/video-720.mp4?token=y",
    format: "mp4",
    downloads: ["https://cdn.example.test/video-720.mp4?token=y"],
  });
});

test("recognizes HLS stream fields for playback but does not mislabel them as MP4 downloads", () => {
  const media = adultMediaOf({ m3u8_base_url: "https://cdn.example.test/master.m3u8" });
  assert.deepEqual(media, {
    playUrl: "https://cdn.example.test/master.m3u8",
    format: "hls",
    downloads: [],
  });
});

test("ignores arbitrary URLs, page metadata, and unsafe protocols", () => {
  assert.equal(adultMediaOf({ url: "https://xnxx.com/watch/title", thumbnail: "https://cdn.test/cover.jpg" }), null);
  assert.equal(adultMediaOf({ videoUrl: "javascript:alert(1).mp4" }), null);
});
