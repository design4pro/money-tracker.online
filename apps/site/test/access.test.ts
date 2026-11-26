import assert from "node:assert/strict";
import { test } from "node:test";
import { requiresAccess } from "../src/access.ts";

const request = (path: string, method = "GET") =>
  new Request(new URL(path, "https://money-tracker.online"), { method });

test("all CMS routes except raw media reads require Access", () => {
  for (const path of [
    "/_emdash",
    "/_emdash/admin",
    "/_emdash/admin/setup",
    "/_emdash/api/setup",
    "/_emdash/api/setup/dev-bypass",
    "/_emdash/api/health",
    "/_emdash/api/search",
    "/_emdash/api/media",
    "/_emdash/api/media/file",
    "/_emdash/api/media/file/%2e%2e%2fsetup",
    "/_emdash/api/media/filed/example",
    "/_emdash//admin",
    "/%5Femdash/admin",
    "/_emdash%2fadmin",
  ]) {
    assert.equal(requiresAccess(request(path)), true, path);
  }
  assert.equal(
    requiresAccess(request("/_emdash/api/media/file/photo.webp", "POST")),
    true,
  );
  assert.equal(
    requiresAccess(request("/_emdash/api/media/file/photo.webp", "HEAD")),
    false,
  );
  assert.equal(
    requiresAccess(request("/_emdash/api/media/file/photo.webp")),
    false,
  );
  assert.equal(requiresAccess(request("/")), false);
  assert.equal(requiresAccess(request("/health")), false);
});
