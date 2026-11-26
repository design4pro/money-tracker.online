import assert from "node:assert/strict";
import { test } from "node:test";
import { homeHeroKey, homeHeroPath, serveHomeHero } from "../src/home-hero.ts";

const request = (method: string, query = "") =>
  new Request(`https://money-tracker.online${homeHeroPath}${query}`, {
    method,
  });
const hero = { id: "media-id", src: "/_emdash/api/media/file/published.webp" };
const published = {
  entry: { data: { status: "published", hero_image: hero } },
  isPreview: false,
};

test("public GET and HEAD read only the published hero, ignoring caller keys", async () => {
  const metadata = { size: 5, httpMetadata: { contentType: "image/webp" } };
  const reads: [string, string][] = [];
  const media = {
    async get(key: string) {
      reads.push(["get", key]);
      return { ...metadata, body: new Blob(["image"]).stream() };
    },
    async head(key: string) {
      reads.push(["head", key]);
      return metadata;
    },
  };

  for (const method of ["GET", "HEAD"]) {
    const response = await serveHomeHero(
      request(method, "?key=draft.webp&preview=true"),
      async () => published,
      media,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/webp");
    assert.equal(response.headers.get("Content-Length"), "5");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(await response.text(), method === "GET" ? "image" : "");
  }
  assert.deepEqual(reads, [
    ["get", "published.webp"],
    ["head", "published.webp"],
  ]);
});

const blockedMedia = {
  get: () => assert.fail("Unexpected R2 read"),
  head: () => assert.fail("Unexpected R2 read"),
};

test("drafts, previews and published Home without a hero return 404 without reading R2", async () => {
  for (const result of [
    { ...published, entry: null },
    { ...published, isPreview: true },
    {
      ...published,
      entry: { data: { status: "draft", hero_image: hero } },
    },
    {
      ...published,
      entry: { data: { status: "published" } },
    },
  ]) {
    const response = await serveHomeHero(
      request("GET", "?key=draft.webp"),
      async () => result,
      blockedMedia,
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});

test("unsupported methods return 405 before looking up Home", async () => {
  const response = await serveHomeHero(
    request("POST"),
    () => assert.fail("Unexpected Home lookup"),
    blockedMedia,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
});

test("local hero references support stored keys and refuse reserved storage prefixes", () => {
  assert.equal(
    homeHeroKey({ ...hero, meta: { storageKey: "media/hero.webp" } }),
    "media/hero.webp",
  );
  assert.equal(
    homeHeroKey({
      ...hero,
      src: "/_emdash/api/media/file/transfers/draft.webp",
    }),
    null,
  );
  assert.equal(
    homeHeroKey({ ...hero, meta: { storageKey: "backups/hero.webp" } }),
    null,
  );
});
