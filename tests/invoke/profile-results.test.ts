import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicProfileRows } from "../../src/lib/profile-results";

test("merges nested public TikTok user and statistics into a visible profile row", () => {
  const rows = extractPublicProfileRows({
    status: "success",
    result: {
      user: { username: "sample_user", nickname: "Sample User", avatar: "https://cdn.example.test/avatar.jpg", signature: "Public bio", verified: true },
      stats: { followerCount: 1200, followingCount: 42, heartCount: 9300, videoCount: 18 },
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "sample_user");
  assert.equal(rows[0].followerCount, 1200);
  assert.equal(rows[0].avatar, "https://cdn.example.test/avatar.jpg");
});

test("handles profile objects nested under data and arrays without exposing unrelated status", () => {
  const rows = extractPublicProfileRows({ data: { profiles: [
    { unique_id: "first", display_name: "First", followers_count: 3 },
    { unique_id: "second", nickname: "Second", following_count: 8 },
  ] } });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.unique_id), ["first", "second"]);
});

test("returns no profiles for an error envelope", () => {
  assert.deepEqual(extractPublicProfileRows({ status: "error", message: "Private profile" }), []);
});
