import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { access, d1, kvCache, r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

const dev = process.argv.includes("dev");
const localState = dev && process.env.SITE_LOCAL_STATE;

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    remoteBindings: false,
    ...(localState ? { persistState: { path: localState } } : {}),
  }),
  integrations: [
    react(),
    emdash({
      database: d1({ binding: "DB" }),
      storage: r2({ binding: "MEDIA" }),
      objectCache: kvCache({ binding: "CACHE" }),
      auth: dev
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
