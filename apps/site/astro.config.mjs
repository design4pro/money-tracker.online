import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { access, d1, kvCache, r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough", remoteBindings: false }),
  integrations: [
    react(),
    emdash({
      database: d1({ binding: "DB" }),
      storage: r2({ binding: "MEDIA" }),
      objectCache: kvCache({ binding: "CACHE" }),
      auth: process.argv.includes("dev")
        ? undefined
        : access({
            teamDomain:
              process.env.CF_ACCESS_TEAM_DOMAIN ??
              "example.cloudflareaccess.com",
            audienceEnvVar: "CF_ACCESS_AUDIENCE",
            defaultRole: 10,
          }),
    }),
  ],
  devToolbar: { enabled: false },
});
