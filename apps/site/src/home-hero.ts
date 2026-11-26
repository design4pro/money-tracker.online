import type { ImageValue } from "emdash";
import { publishedHome } from "./home.ts";

export const homeHeroPath = "/home-hero";
const mediaPrefix = "/_emdash/api/media/file/";
const imageTypes = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jxl",
  "image/png",
  "image/webp",
  "image/x-icon",
]);

export function homeHeroKey(image: ImageValue | undefined): string | null {
  if (!image || (image.provider && image.provider !== "local")) return null;
  let key = image.meta?.storageKey;
  if (typeof key !== "string") {
    if (image.src) {
      const path = URL.parse(image.src, "https://site.invalid")?.pathname;
      if (!path?.startsWith(mediaPrefix)) return null;
      key = path.slice(mediaPrefix.length);
    } else {
      key = image.id;
    }
  }
  if (typeof key !== "string" || /^(backups|transfers)\//i.test(key))
    return null;
  return key
    .split("/")
    .every(
      (part) => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..",
    )
    ? key
    : null;
}

interface HeroObject {
  size: number;
  httpMetadata?: { contentType?: string };
  body?: ReadableStream;
}

export async function serveHomeHero(
  request: Request,
  loadHome: () => Promise<{
    entry: { data: { status: string; hero_image?: ImageValue } } | null;
    error?: Error;
    isPreview: boolean;
  }>,
  media: {
    get(key: string): Promise<HeroObject | null>;
    head(key: string): Promise<HeroObject | null>;
  },
): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD");
    return new Response(null, { status: 405, headers });
  }

  const key = homeHeroKey(publishedHome(await loadHome())?.hero_image);
  if (!key) return new Response(null, { status: 404, headers });

  const object = await (request.method === "HEAD"
    ? media.head(key)
    : media.get(key));
  const contentType = object?.httpMetadata?.contentType;
  if (!object || !contentType || !imageTypes.has(contentType)) {
    await object?.body?.cancel();
    return new Response(null, { status: 404, headers });
  }

  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(object.size));
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body ?? null, { headers });
}
