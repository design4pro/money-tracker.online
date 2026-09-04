#!/usr/bin/env bash
# The post-deploy smoke check both deploy workflows run against /api/health.
#
#   bash scripts/smoke-check.sh <url>
#
# It exists as a script rather than as two copies of a `run:` block because the
# interesting part is not the request - it is telling apart the two ways this
# check fails, which look identical from inside a `curl` loop and mean opposite
# things:
#
#   - The Worker answered and is unhealthy. That is a deploy problem, and the
#     retry loop is right to give it a minute: a new version takes a few seconds
#     to become globally routable.
#   - Cloudflare's edge answered *instead of* the Worker. The deploy may be
#     perfectly healthy; nobody asked it. This is a *configuration* state, not a
#     transient one, so retrying it ten times burns a minute to reach the same
#     verdict. The check stops on the first such answer and names the knob.
#
# Two edge products can do that, and this zone has met both:
#
#   Cloudflare Access, on money-tracker.online. An unauthenticated request is
#   redirected to the team login (302 to <team>.cloudflareaccess.com); one that
#   reaches an application whose only policy is Service Auth - which is the case
#   for /api/health - is refused outright with a 403 Access error page, because
#   there is no identity provider for it to send a human to. CF_ACCESS_CLIENT_ID
#   and CF_ACCESS_CLIENT_SECRET below are the service token that satisfies it.
#
#   Bot Fight Mode, zone-wide. It answers 403 with a managed-challenge
#   interstitial. On the Free plan it cannot be skipped by any rule - it does not
#   run on the Ruleset Engine, so Skip, Bypass and Allow have no effect on it -
#   so there is no credential this script could send to get through. It was
#   turned off for this zone on 2026-09-04 for exactly that reason.
#
# Order matters in the detection below: an Access error page embeds Cloudflare's
# JavaScript-detections script from /cdn-cgi/challenge-platform/, so a check for
# that path alone reports an Access refusal as a bot challenge and sends whoever
# reads it to the wrong settings page. Access is therefore identified first, and
# the challenge test keys on `_cf_chl_opt` - the challenge bootstrap object,
# which an Access page does not carry.
set -euo pipefail

url=${1:?usage: smoke-check.sh <url>}

# Built as an array so a secret containing spaces survives, and expanded with
# the `${a[@]+...}` guard because an empty array is an unbound variable under
# `set -u` in bash 3.2, which is what a macOS shell still runs.
request=(--silent --show-error --max-time 20)
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  request+=(--header "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}")
  request+=(--header "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
fi

body=$(mktemp)
trap 'rm -f "$body"' EXIT

# `curl` is asked for the status and the redirect target on one line rather than
# followed with -L, because where a 302 points is half the diagnosis here.
for attempt in $(seq 1 10); do
  read -r code location <<<"$(
    curl "${request[@]+"${request[@]}"}" --output "$body" \
      --write-out '%{http_code} %{redirect_url}' "$url" || echo '000 -'
  )"
  echo "attempt $attempt: $code"

  if [ "$code" = 200 ]; then
    cat "$body"
    echo
    exit 0
  fi

  # Access, in both of its shapes: the redirect to the team login, and the error
  # page it serves when the matching application has no policy a human can pass.
  if [ "${location#*cloudflareaccess.com}" != "$location" ] ||
     grep -qE 'Cloudflare Access|/cdn-cgi/access/' "$body" 2>/dev/null; then
    echo "::error title=Smoke check blocked by Cloudflare Access::$url was answered by Access ($code), so the request never reached the Worker and the deploy's health is unknown. The service token is missing, wrong, or no longer admitted: check that CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are set for this environment and that the Access application covering this path still has a Service Auth policy naming that token."
    exit 1
  fi

  if grep -q '_cf_chl_opt' "$body" 2>/dev/null; then
    echo "::error title=Smoke check blocked by a Cloudflare challenge::$url answered $code with a managed challenge, so the request never reached the Worker and the deploy's health is unknown. Look up the ray id below in Security -> Events to find the product that issued it. If it is Bot Fight Mode, no rule can exempt this check on the Free plan - turn it off for the zone, or move to a plan with Super Bot Fight Mode, which a WAF Skip rule can bypass."
    grep -oE "cRay: '[^']+'" "$body" || true
    exit 1
  fi

  sleep 6
done

echo "::error title=Smoke check failed::$url answered $code, expected 200. The Worker is reachable and unhealthy."
cat "$body" || true
exit 1
