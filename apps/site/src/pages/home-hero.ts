import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { serveHomeHero } from "../home-hero.ts";
import { loadPublishedHome } from "../home-query.ts";

export const ALL: APIRoute = ({ request }) =>
  serveHomeHero(request, loadPublishedHome, env.MEDIA);
