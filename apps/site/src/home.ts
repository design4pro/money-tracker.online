import type { ImageValue } from "emdash";
import type seed from "../seed/seed.json";

type HomeFields = Record<
  keyof (typeof seed.content.landing)[number]["data"],
  string
>;

export interface Home extends HomeFields {
  id: string;
  slug: string | null;
  status: string;
  hero_image?: ImageValue;
  hero_image_alt?: string;
}

export function publishedHome<T extends { status: string }>(result: {
  entry: { data: T } | null;
  error?: Error;
  isPreview: boolean;
}): T | null {
  if (
    result.error ||
    result.isPreview ||
    result.entry?.data.status !== "published"
  ) {
    return null;
  }
  return result.entry.data;
}
