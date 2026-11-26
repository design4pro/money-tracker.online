import { authenticate } from "@emdash-cms/cloudflare/auth";
import handler from "@emdash-cms/cloudflare/worker";
import { requiresAccess } from "./access.ts";

interface SiteEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
  SOURCE_SHA?: string;
  DB: D1Database;
}

export default {
  ...handler,
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === "/health") {
      if (request.method !== "GET") {
        return new Response(null, { status: 405, headers: { Allow: "GET" } });
      }
      let ok = false;
      try {
        // Read-only and outside Astro middleware, which can migrate and seed D1.
        const home = await env.DB.prepare(
          "SELECT 1 FROM ec_landing WHERE slug = ? AND status = 'published' AND deleted_at IS NULL",
        )
          .bind("home")
          .first();
        ok = home !== null;
      } catch {
        // A fresh or unavailable database is unready.
      }
      return Response.json(
        { ok, sourceSha: env.SOURCE_SHA ?? "local" },
        {
          status: ok ? 200 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (!import.meta.env.DEV && requiresAccess(request)) {
      if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUDIENCE) {
        return new Response("Access is unavailable", { status: 503 });
      }
      try {
        // Also guard setup and CMS routes that EmDash intentionally treats as public.
        await authenticate(request, {
          teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
          audience: env.CF_ACCESS_AUDIENCE,
        });
      } catch {
        return new Response("Access required", { status: 403 });
      }
    }

    return handler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<SiteEnv>;
