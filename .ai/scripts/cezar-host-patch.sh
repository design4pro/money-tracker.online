#!/usr/bin/env bash
# Host workarounds for the pinned @open-mercato/cezar@0.10.1, applied to the copy in the npx cache
# that the cockpit service runs (a `.orig` is kept beside each patched file). Idempotent; rerun
# after the npx cache is cleared. Drop each patch when the pinned version carries the fix.
#
# 1. open-mercato/cezar#914 (fix in upstream PR #916, unreleased): the automations poller validates
#    every /timeline row against a labeled|unlabeled schema, so one comment or cross-reference on
#    any recently updated issue fails the whole `issue.labeled` poll; `issue-regroom`,
#    `issue-autofix` and `issue-spec` never fire without this.
# 2. Skills auto-update: `skillsAutoUpdate: false` gates only `skills update`; the coordinator still
#    runs `npx skills check <names> -p` in every project root at service start, and that command
#    re-adds the skills from upstream HEAD, replacing the vendored `.claude/skills/om-*` with
#    symlinks into an untracked `.agents/skills/`. The patch makes `CEZ_SKILLS_AUTO_UPDATE=0`
#    short-circuit the check as well, and the service plist gets that variable.
# 3. GH_CONFIG_DIR: the cockpit acts as design4pro-agent (docs/agents/cezar.md, Host identity); the
#    plist carries the path to that account's gh config directory and cezar forwards it to every run.
# 4. Label events on pull requests: the poller scopes its label source to `is:issue` and then skips
#    any search hit carrying `pull_request`, so `issue.labeled` can never fire on a PR and the only
#    PR trigger cezar has is `pull_request.opened` - the wrong moment for anything a review job
#    posts minutes later. The patch makes both gates honour a `filters.includePullRequests` flag,
#    which survives validation because `automationFiltersSchema` is `.passthrough()`. Opt-in per
#    automation: without the flag the behaviour is byte-for-byte what it was, so `issue-regroom`,
#    `issue-autofix` and `issue-spec` cannot start firing on PRs that happen to carry their label.
#    Used by `pr-review-threads` (docs/agents/cezar-automations.json).
#
# The cockpit is one per host and shared with planned.travel, whose .ai/scripts/cezar-host-patch.sh
# is identical apart from this paragraph. Both are idempotent and check their own markers, so
# running either one is enough; this copy exists so a host that only carries this checkout is
# still self-sufficient.
set -euo pipefail

VERSION="${CEZ_VERSION:-0.10.1}"
PLIST="$HOME/Library/LaunchAgents/dev.cezar.cockpit.plist"
# `|| true`: under pipefail a missing install makes grep exit non-zero and `set -e` would abort
# here, before the message below.
DIST=$(grep -lx "  \"version\": \"$VERSION\"," "$HOME"/.npm/_npx/*/node_modules/@open-mercato/cezar/package.json 2>/dev/null \
  | head -1 | xargs -I{} dirname {} | sed 's|$|/dist|' || true)
[ -n "$DIST" ] && [ -d "$DIST" ] || { echo "cezar $VERSION not found in the npx cache; start the cockpit once first" >&2; exit 1; }

# patch FILE MARKER FROM TO [COUNT]: replace exactly COUNT (default 1) occurrences unless MARKER is present.
patch() {
  local file="$1" marker="$2" from="$3" to="$4" count="${5:-1}"
  if grep -qF "$marker" "$file"; then echo "already patched: $file"; return; fi
  [ -f "$file.orig" ] || cp "$file" "$file.orig"
  FROM="$from" TO="$to" COUNT="$count" node - "$file" <<'JS'
const fs = require('node:fs')
const [file] = process.argv.slice(2)
const { FROM, TO, COUNT } = process.env
const src = fs.readFileSync(file, 'utf8')
const hits = src.split(FROM).length - 1
if (hits !== Number(COUNT)) throw new Error(`expected ${COUNT} patch site(s) in ${file}, found ${hits}`)
fs.writeFileSync(file, src.split(FROM).join(TO))
JS
  echo "patched: $file"
}

patch "$DIST/automations/github-poller.js" 'cezar#914' \
  '        return z.array(timelineEventSchema).parse(JSON.parse(raw));' \
  "        // host patch, open-mercato/cezar#914: validate only the label rows of the timeline.
        const rows = JSON.parse(raw).filter((entry) => entry?.event === 'labeled' || entry?.event === 'unlabeled');
        return z.array(timelineEventSchema).parse(rows);"

patch "$DIST/automations/github-poller.js" 'host patch: includePullRequests (search scope)' \
  "            sources.push({ family: 'issues', activity: 'updated', opened: false, labels: true });" \
  "            // host patch: includePullRequests widens the label source to PRs ('mixed' emits no is: qualifier).
            sources.push({ family: definition.filters.includePullRequests ? 'mixed' : 'issues', activity: 'updated', opened: false, labels: true });"

patch "$DIST/automations/github-poller.js" 'host patch: includePullRequests (hit filter)' \
  "                if (source.labels && !item.pull_request) {" \
  "                if (source.labels && (definition.filters.includePullRequests || !item.pull_request)) { // host patch: includePullRequests"

patch "$DIST/skills-update.js" 'host patch: CEZ_SKILLS_AUTO_UPDATE' \
  "        if (process.env.CEZ_DRY_RUN === '1') {" \
  "        if (process.env.CEZ_DRY_RUN === '1' || process.env.CEZ_SKILLS_AUTO_UPDATE === '0') { // host patch: CEZ_SKILLS_AUTO_UPDATE=0 skips check and update" 2

if [ -f "$PLIST" ]; then
  if plutil -extract EnvironmentVariables.CEZ_SKILLS_AUTO_UPDATE raw "$PLIST" >/dev/null 2>&1; then
    echo "plist already carries CEZ_SKILLS_AUTO_UPDATE"
  else
    plutil -insert EnvironmentVariables.CEZ_SKILLS_AUTO_UPDATE -string 0 "$PLIST" && echo "plist: CEZ_SKILLS_AUTO_UPDATE=0"
  fi
  if plutil -extract EnvironmentVariables.GH_CONFIG_DIR raw "$PLIST" >/dev/null 2>&1; then
    echo "plist already carries GH_CONFIG_DIR"
  else
    # The gh config directory holding the design4pro-agent login (a path, not a token; docs/agents/cezar.md,
    # Host identity). Cezar forwards it, so gh and git push in a run act as the bot.
    plutil -insert EnvironmentVariables.GH_CONFIG_DIR -string "$HOME/.config/gh-agent" "$PLIST" && echo "plist: GH_CONFIG_DIR"
  fi
  # bootout + bootstrap so the new environment is read; kickstart alone keeps the old one.
  launchctl bootout "gui/$(id -u)/dev.cezar.cockpit" 2>/dev/null || true
  # bootstrap right after bootout can fail with "Input/output error" while the old job unloads.
  for attempt in 1 2 3 4 5; do
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && { echo "cockpit restarted"; break; }
    [ "$attempt" -lt 5 ] && sleep 2 || { echo "bootstrap failed 5 times: launchctl bootstrap gui/$(id -u) $PLIST" >&2; exit 1; }
  done
else
  echo "no $PLIST; export CEZ_SKILLS_AUTO_UPDATE=0 wherever the cockpit is started" >&2
fi
