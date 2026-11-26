import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSeed } from "emdash";
import seed from "../seed/seed.json" with { type: "json" };
import { publishedHome } from "../src/home.ts";

test("the native seed defines one published Home entry", () => {
  const validation = validateSeed(seed as Parameters<typeof validateSeed>[0]);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const [home] = seed.content.landing;
  assert.equal(seed.content.landing.length, 1);
  assert.equal(home.slug, "home");
  assert.equal(home.status, "published");
});

test("homepage only accepts a successful published lookup", () => {
  const data = { status: "published", title: "Home" };
  const result = { entry: { data }, isPreview: false };
  assert.equal(publishedHome(result), data);
  assert.equal(publishedHome({ ...result, isPreview: true }), null);
  assert.equal(publishedHome({ ...result, error: new Error() }), null);
  assert.equal(publishedHome({ ...result, entry: null }), null);
  for (const status of ["draft", "scheduled", "archived"]) {
    assert.equal(
      publishedHome({ ...result, entry: { data: { ...data, status } } }),
      null,
    );
  }
});
