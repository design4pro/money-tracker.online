# Money Tracker public site

Astro renders the published **Landing pages → Home** entry from EmDash 1.6 and D1. Editors control the homepage copy, navigation and button labels, optional hero image and alt text, and the entry's SEO panel. The app serves registration, sign-in and billing at `/register`, `/login` and `/billing`. The app and Polar own plan prices and payment data.

## Local development

Use Node.js 24 or newer. Run these commands from `apps/site`.

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

Open `http://localhost:4321/_emdash/admin` and complete the native passkey setup with seed content enabled. For a disposable local database, EmDash's development-only shortcut at `/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` imports the seed and signs in a synthetic development admin. Astro uses local D1, R2 and KV emulators and persists data under `.wrangler/state`.

`APP_ORIGIN` in Wrangler controls CTA destinations. The local default is `http://localhost:5173`. The staging site and app origins `https://staging.money-tracker.online` and `https://app-staging.money-tracker.online` are configurable examples. Production uses `https://money-tracker.online` and `https://app.money-tracker.online`.

`GET /health` returns `{ "ok": true, "sourceSha": "…" }` with HTTP 200 when D1 contains the published Home entry and `ok: false` with HTTP 503 otherwise. It reads D1 directly and causes no migrations or seed writes. The local source label is `local`. Deployment uses the full `SOURCE_SHA` override or the checked-out Git commit and links the footer to that GitHub tree.

## Worker configuration

An operator needs two separate Workers with the names in `wrangler.json`, a private R2 bucket per Worker (`MEDIA`), a D1 database per Worker (`DB`), and two KV namespaces per Worker (`CACHE` and `SESSION`). Pass the assigned bindings as `SITE_D1_DATABASE_ID`, `SITE_CACHE_KV_ID`, `SITE_SESSION_KV_ID`, and `SITE_MEDIA_BUCKET` when deploying. Cloudflare documents a 64 MiB uncompressed Worker limit for both Free and Paid. Wrangler reports gzip size for reference.

Set each environment’s site and app origins with `SITE_URL` and `APP_ORIGIN` at deploy time. The deploy script supplies the site origin as `EMDASH_SITE_URL`. Keep the workers.dev and preview URLs disabled. Attach only the intended hostname to each Worker and set up the following Access applications for that hostname before exposing setup.

1. Protect `/_emdash` and `/_emdash/*` with one Allow policy. During initial setup, allow only the designated first editor's verified identity from the site's Access policy. The first identity to sign in after the wizard completes becomes EmDash Admin. Keep the bootstrap policy in place until that account is confirmed. Afterward, allow the approved editors through the policy and assign their local EmDash roles. Newly provisioned users otherwise start at Subscriber.
2. Keep the entire CMS prefix under Access, including setup, the CMS API, media files used in editor previews, and the built-in CMS health route. Remove any existing media Bypass policy. The R2 bucket remains private. Public requests use `/home-hero` for the current published Home image and `/health` for site readiness.
3. Use the protected application's **Application Audience (AUD) Tag** as the `CF_ACCESS_AUDIENCE` Worker secret for that environment. Provide `CF_ACCESS_TEAM_DOMAIN` to the deployment command as the team hostname, for example `pilot-example.cloudflareaccess.com`. The build gives that hostname to EmDash's Access adapter and the deployment command supplies it as a Worker var for the route guard.

With the required bindings and Access settings in place, an authorized operator can deploy with the locked Wrangler binary using a Wrangler login or CI credentials supplied via `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. These commands build for the selected Cloudflare environment before uploading that artifact.

```sh
npm run deploy:staging
npm run deploy:production
```

Visit `/_emdash/admin` as the allowed first editor, complete the EmDash wizard with seed content enabled, and confirm the first admin session. EmDash applies its core D1 migrations automatically on first application use and after upgrades. The wizard imports `seed/seed.json` with skip-on-conflict semantics. Subsequent deploys keep existing Home content, and publication is managed in EmDash. Keep staging hidden from search engines through its EmDash settings and switch production out of staging when ready to index.

After deploy, check the homepage and all three CTA destinations, the footer and `/health` SHA, unauthenticated denial on admin and CMS API routes, editor sign-in, and retrieval of an uploaded hero image while signed out.

[EmDash Cloudflare deployment](https://docs.emdashcms.com/deployment/cloudflare/) · [Access authentication](https://docs.emdashcms.com/guides/authentication/#cloudflare-access) · [Core migrations](https://docs.emdashcms.com/deployment/core-migrations/) · [Cloudflare Worker size limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size)
