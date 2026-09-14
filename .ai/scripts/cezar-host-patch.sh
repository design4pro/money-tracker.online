#!/usr/bin/env bash
# Host workarounds for the pinned @open-mercato/cezar@0.10.1, applied to the copy the cockpit
# service runs (a `.orig` is kept beside each patched file). Idempotent; rerun after an upgrade.
# Drop each patch when the pinned version carries the fix.
#
# The global install is preferred over the npx cache, and that preference is the point rather than
# a detail: `npx` resolves from a content-hashed cache npm may collect at any time, and a collected
# cache takes these patches with it. Nothing reports that. Patch 4 is the one `pr-review-threads`
# needs, so its loss shows up as pull requests sitting with unresolved threads and no error
# anywhere. `npm i -g @open-mercato/cezar@0.10.1` removes the hazard; the npx path stays below as
# a fallback for a host that has not cut over.
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
#    posts minutes later. The patch makes both gates honour a `filters.includePullRequests` flag -
#    a second search source scoped to `is:pr`, and a widened pull_request check -
#    which survives validation because `automationFiltersSchema` is `.passthrough()`. Opt-in per
#    automation: without the flag the behaviour is byte-for-byte what it was, so `issue-regroom`,
#    `issue-autofix` and `issue-spec` cannot start firing on PRs that happen to carry their label.
#    Used by `pr-review-threads` (docs/agents/cezar-automations.json).
# 5. Concurrent worktree creation (not reported upstream yet): `git worktree add -b` writes the
#    new branch's upstream into the shared `.git/config`, and git's config lock has no retry, so
#    two runs forking in the same moment leave one of them dead with "could not lock config file
#    .git/config: File exists". `maxParallel` does not order them - cezar creates the worktree
#    before it takes the repository-root lease - so a burst of automations loses all but one run.
#    The patch retries, and because the branch is created before that config write fails, the
#    retry lands on cezar's own reattach path, which writes no shared config at all.
# 6. planned.travel#351 (not reported upstream yet): the label poll pins its cursor and the
#    automation stops firing. `poll()` collects at most `min(maxRecords, 100)` observations, keeps
#    the first `maxRecords` of them and returns the last one it kept; the scheduler re-reads a 120s
#    overlap band on every poll and never moves its cursor backwards. Once that band alone holds
#    `maxRecords` label events - `om-auto-manage-issues` writes three per issue within the same
#    second, so two groomed issues saturate a five-record window - every poll spends its whole
#    budget on events it has already seen, returns the cursor it was handed, and the `updated:>=`
#    window is a fixed timestamp that never shrinks. The automation polls forever, reports
#    `no-match`, and `frozenHighWatermark` is the only trace anywhere that something is wrong.
#    The patch widens the budget, doubling to the 100-record search ceiling, and only for a poll
#    that failed to advance - so a saturated band is cleared once rather than re-read every
#    interval. It cannot step over an event: `poll()` evaluates a contiguous prefix of what it
#    observed and takes its cursor from the last evaluated observation, so a wider budget only
#    ever reaches further into the same ordered run. A band still saturated at 100 stays pinned;
#    that is the search API's own ceiling, and `frozenHighWatermark` still reports it - but it
#    stays pinned cheaply. The ladder is paid once per pinned cursor, not once per interval: the
#    cursor it failed at is recorded as `widenExhaustedAt`, and a poll whose stored cursor still
#    matches reads its window once instead of climbing. That is a cost decision, not a proof - the
#    search window never shrinks, but `poll()` keeps the first `maxRecords` observations of a
#    `sort=updated&order=asc` search, so an item inside that prefix leaves it when touched again
#    and a later climb can land differently. Repeating it is simply not worth what it costs: a
#    permanently pinned automation spends 175-255 timeline reads per poll - 10 500/h for
#    `issue-autofix` at its 60s interval, against the 5 000/h REST budget of a token every agent
#    run on this host shares. Trading a silent stall for a rate-limited pipeline is not a trade
#    worth making. The cursor moving is the recovery path, and it clears the marker.
#
# The cockpit is one per host and shared with planned.travel. That repository's copy of
# .ai/scripts/cezar-host-patch.sh is identical apart from this paragraph; both are idempotent and
# check their own markers, so running either one is enough. This copy exists so a host that only
# carries this checkout is still self-sufficient.
#
# "Either one is enough" holds only while the two copies are in step, and the order matters when
# they are not. A copy older than this one aborts on the patch 4 site rather than reverting it -
# that is deliberate, and the note above that patch says how.
set -euo pipefail

VERSION="${CEZ_VERSION:-0.10.1}"
PLIST="$HOME/Library/LaunchAgents/dev.cezar.cockpit.plist"

# Candidates, most stable first. The version is checked rather than assumed: the npx cache holds
# several releases side by side, and patching the wrong one leaves the cockpit unpatched with every
# patch reporting success.
DIST=""
for candidate in "$(npm root -g 2>/dev/null)/@open-mercato/cezar" \
                 "$HOME"/.npm/_npx/*/node_modules/@open-mercato/cezar; do
  [ -f "$candidate/package.json" ] || continue
  grep -qx "  \"version\": \"$VERSION\"," "$candidate/package.json" || continue
  DIST="$candidate/dist"
  break
done
[ -n "$DIST" ] && [ -d "$DIST" ] || {
  echo "cezar $VERSION not found. Install it: npm i -g @open-mercato/cezar@$VERSION" >&2
  exit 1
}
echo "patching $DIST"

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
  # Restore before failing. The write above has already landed, so a file that is patched but
  # unmarked sends the operator's natural next move - rerun the idempotent script - back into
  # patch(), where FROM is gone and the count assertion dies with "expected N patch site(s) in
  # ..., found 0". That names the patch site; the fault is the marker. Putting .orig back makes
  # every rerun reproduce the message below instead.
  grep -qF "$marker" "$file" || {
    cp "$file.orig" "$file"
    echo "marker absent after patching $file: $marker" >&2
    exit 1
  }
  echo "patched: $file"
}

# Supersedes the first form of patch 2, which asked for the 'mixed' family and so produced a
# query /search/issues answers with HTTP 422. A host carrying it would otherwise be skipped by the
# new marker and keep the broken line. Restoring the stock file is enough: every patch below
# checks its own marker and re-applies.
if grep -qF "includePullRequests ? 'mixed' : 'issues'" "$DIST/automations/github-poller.js"; then
  cp "$DIST/automations/github-poller.js.orig" "$DIST/automations/github-poller.js"
  echo "reverted the superseded 'mixed' label source"
fi

# Supersedes the first form of patch 4, whose re-emitted `family: 'issues'` push kept the stock key
# order. That form writes patch 4's own marker, so a host carrying it is skipped by the marker check
# in `patch` before FROM is ever looked at, and keeps the old order - which is the line a stale
# sibling copy still matches and rewrites back to 'mixed'. The reorder below is worthless without
# this. The trigger is the old-ordered 'prs' push: stock has no 'prs' push at all and the new form
# emits it reordered, so it names that one form exactly, and `.orig` is guaranteed to exist because
# only `patch` writes the line and it takes the copy first.
if grep -qF "sources.push({ family: 'prs', activity: 'updated', opened: false, labels: true });" \
  "$DIST/automations/github-poller.js"; then
  cp "$DIST/automations/github-poller.js.orig" "$DIST/automations/github-poller.js"
  echo "reverted the superseded patch 4 key order"
fi

patch "$DIST/automations/github-poller.js" 'cezar#914' \
  '        return z.array(timelineEventSchema).parse(JSON.parse(raw));' \
  "        // host patch, open-mercato/cezar#914: validate only the label rows of the timeline.
        const rows = JSON.parse(raw).filter((entry) => entry?.event === 'labeled' || entry?.event === 'unlabeled');
        return z.array(timelineEventSchema).parse(rows);"

# The two markers below are fragments of the replacement code, not of its comment: both sites patch
# the same file and the natural comment marker ("host patch: includePullRequests") is a prefix of
# the other's, so a marker taken from a comment would either be absent after patching or match the
# wrong site. Keep each marker a string the patched file holds exactly once and the stock file not
# at all - `grep -c` on both is the check.
#
# The replacement below also reorders the keys of the re-emitted `family: 'issues'` push, and that
# is load-bearing. The superseded form of this patch took the stock line as its FROM, so re-emitting
# it byte-for-byte would leave a stale copy of this script - the sibling repository's, on the shared
# host - a file whose own marker is absent and whose FROM still matches exactly once: it would
# rewrite the line back to the 'mixed' form, silently restoring the HTTP 422 and leaving the 'prs'
# push dangling beside it. With the keys reordered the stale script finds zero sites and its count
# assertion aborts the run loudly instead. Key order is inert in JavaScript; this is the whole cost.
patch "$DIST/automations/github-poller.js" 'if (definition.filters.includePullRequests)' \
  "            sources.push({ family: 'issues', activity: 'updated', opened: false, labels: true });" \
  "            // host patch: includePullRequests adds a second label source covering pull requests.
            // Deliberately two sources rather than the 'mixed' family: 'mixed' emits no is:
            // qualifier, and /search/issues rejects a query without one (HTTP 422, 'Query must
            // include is:issue or is:pull-request'). That is not a narrower poll, it is no poll
            // at all - every attempt errors and the automation backs off until it never runs.
            // The key order differs from the stock line on purpose - see the note above this patch.
            sources.push({ family: 'issues', labels: true, activity: 'updated', opened: false });
            if (definition.filters.includePullRequests)
                sources.push({ family: 'prs', labels: true, activity: 'updated', opened: false });"

patch "$DIST/automations/github-poller.js" 'definition.filters.includePullRequests || !item.pull_request' \
  "                if (source.labels && !item.pull_request) {" \
  "                if (source.labels && (definition.filters.includePullRequests || !item.pull_request)) { // host patch: includePullRequests"

patch "$DIST/skills-update.js" 'host patch: CEZ_SKILLS_AUTO_UPDATE' \
  "        if (process.env.CEZ_DRY_RUN === '1') {" \
  "        if (process.env.CEZ_DRY_RUN === '1' || process.env.CEZ_SKILLS_AUTO_UPDATE === '0') { // host patch: CEZ_SKILLS_AUTO_UPDATE=0 skips check and update" 2

# The retry is deliberately not conditioned on the error text: the cockpit inherits the developer's
# locale, and the message this host actually produced was Polish ("nie mozna zablokowac pliku
# konfiguracyjnego"). Matching it would be a patch that silently stops working the day the host
# changes language. Retrying every failure costs at most four attempts and about a second before
# the original throw, and an unrecoverable cause still ends as an error.
patch "$DIST/git-worktree.js" 'host patch: retry the config-lock race' \
  "    const create = await git(repoRoot, ['worktree', 'add', '-b', branch, absolutePath, base]);" \
  "    // host patch: retry the config-lock race between two runs forking at the same moment.
    // 'worktree add -b' writes branch.<name>.remote/merge into the shared .git/config, and git's
    // config lock has no retry. The branch is created before that write, so the retry reaches the
    // reattach form, which writes no shared config. Not conditioned on the message - see above.
    let create = await git(repoRoot, ['worktree', 'add', '-b', branch, absolutePath, base]);
    for (let attempt = 1; !create.ok && attempt <= 4; attempt++) {
        await new Promise((done) => setTimeout(done, 150 * attempt + Math.floor(Math.random() * 150)));
        const forked = await git(repoRoot, ['show-ref', '--verify', '--quiet', branchRef]);
        create = forked.ok
            ? await git(repoRoot, ['worktree', 'add', absolutePath, branch])
            : await git(repoRoot, ['worktree', 'add', '-b', branch, absolutePath, base]);
    }"

# The widening is the scheduler's to do, not the poller's: only the scheduler holds the stored
# cursor, so only it can tell a poll that made no progress from one that simply found nothing new.
# `laterCursor` returns its first argument unchanged when the observation is not later, so the
# reference comparison below is exactly "this poll did not move the cursor" - no new helper, and no
# second way of ordering cursors that could drift from the one the state file is written with.
#
# Guarded by `result.truncated` so a quiet repository never pays for a second poll, and by
# `mode === 'execute'` so a preview - which writes no state - does not either. Note that `mode` is
# already rewritten to 'preview' above when the handle cannot launch, so detection-only polls are
# covered by the same test.
# Supersedes both earlier forms of patch 6, which fail in opposite directions:
#
#   - kit 30 named its marker `planned.travel#351` with no suffix, so this version's guard does not
#     recognise it. The call is not skipped, reaches a FROM that form already rewrote from
#     `const result` to `let result`, and dies on the count assertion with `set -e` taking every
#     later patch down with it - the give-up patch included.
#   - kit 31 already used *these* markers, so a host carrying it is skipped before FROM is ever
#     looked at and silently keeps kit 31's give-up line, which stamps the marker onto a cursor the
#     ladder never climbed. That state is terminal: every rerun skips it again, so the documented
#     "rerun after an upgrade" cannot clear it.
#
# Each form is named by its own exact text, the way the patch-2 and patch-4 blocks above are. The
# tempting shortcut - grepping the bare `planned.travel#351` prefix - would match this version's
# own output too, so every rerun would revert and re-apply instead of reporting `already patched`,
# trading the script's idempotency and the signal an operator reads for a shorter condition.
# `.orig` is guaranteed to exist because whichever form is present created it, the same guarantee
# the patch-4 block relies on.
if grep -qF 'host patch: planned.travel#351 - a truncated poll' "$DIST/automations/scheduler.js" \
  || grep -qF 'widenExhaustedAt: widenExhausted && cursor?.tieBreaker' "$DIST/automations/scheduler.js"; then
  cp "$DIST/automations/scheduler.js.orig" "$DIST/automations/scheduler.js"
  echo "reverted a superseded patch 6 form"
fi

patch "$DIST/automations/scheduler.js" 'host patch: planned.travel#351 widen' \
  '            const result = await githubRequests.run(() => this.handle.poller.poll(this.handle.owner, this.handle.repo, definition, { since: overlapSince }));' \
  "            // host patch: planned.travel#351 widen - a truncated poll whose observations all sit in
            // the 120s overlap band returns the cursor it was handed, and the search window is a
            // fixed timestamp, so the automation re-reads one window forever. Widen the budget
            // for a poll that failed to advance, doubling to the 100-record search ceiling.
            // Safe by construction: poll() evaluates a contiguous prefix of what it observed and
            // takes its cursor from the last evaluated observation, so a wider budget can only
            // reach further into that same run - it never steps over anything.
            let result = await githubRequests.run(() => this.handle.poller.poll(this.handle.owner, this.handle.repo, definition, { since: overlapSince }));
            // The ladder already ran to the ceiling at this exact cursor and did not clear the
            // band. Nothing that leaves the window can make it clearable - an item's updated only
            // moves forward, so the search window never shrinks - but a retry is not provably
            // pointless either: the search is sort=updated&order=asc and poll() keeps the first
            // maxRecords observations, so an item inside that prefix leaves it when it is touched
            // again, and a later climb can land differently. This is a cost decision, not a proof.
            // Repeating the climb costs up to 255 timeline reads a poll - 10 500/h for a 60s
            // automation, against the 5 000/h budget of a token every agent run on this host
            // shares - and that is not worth paying on the chance that a prefix reshuffled. Give
            // up until the cursor moves; the cursor moving is the recovery path, and the marker
            // written below is cleared the moment it does.
            let widenExhausted = !!state.widenExhaustedAt
                && !!state.cursor
                && state.widenExhaustedAt.timestamp === state.cursor.timestamp
                && state.widenExhaustedAt.tieBreaker === state.cursor.tieBreaker;
            for (let budget = definition.filters.maxRecords; !widenExhausted
                && mode === 'execute'
                && state.cursor
                && result.truncated
                && laterCursor(state.cursor, result.cursor) === state.cursor;) {
                // The loop ends when the budget stops growing, not when it reaches a particular
                // number. Spelling the ceiling twice - once in the step and once in the condition -
                // makes termination depend on two literals agreeing, and a poll loop that spins
                // forever holds the polling lease and takes every other automation with it.
                const next = Math.min(budget * 2, 100);
                if (next <= budget) {
                    widenExhausted = true;
                    break;
                }
                budget = next;
                const widened = { ...definition, filters: { ...definition.filters, maxRecords: budget } };
                result = await githubRequests.run(() => this.handle.poller.poll(this.handle.owner, this.handle.repo, widened, { since: overlapSince }));
            }"

# The give-up marker is its own field rather than a reuse of `frozenHighWatermark`, which is
# written on any truncated poll - including one that advanced. Reusing it would make a healthy
# poll's own watermark equal the stored cursor on the next interval and suppress the first
# legitimate widening, which is the one that matters. `automationRuntimeStateSchema` is
# `.passthrough()`, so a field the contract does not name survives the state file's round trip.
#
# `widenExhausted` is in scope here: it is declared in the same `try` block as this `setState`,
# by the patch above. The two hunks are one change and neither stands alone.
patch "$DIST/automations/scheduler.js" 'host patch: planned.travel#351 give-up' \
  '                    frozenHighWatermark: result.truncated && cursor?.tieBreaker
                        ? { timestamp: cursor.timestamp, tieBreaker: cursor.tieBreaker }
                        : undefined,' \
  "                    frozenHighWatermark: result.truncated && cursor?.tieBreaker
                        ? { timestamp: cursor.timestamp, tieBreaker: cursor.tieBreaker }
                        : undefined,
                    // host patch: planned.travel#351 give-up - the cursor the doubling ladder ran
                    // to the ceiling at without clearing the band, so the next interval reads its
                    // window once instead of climbing 5,10,20,40,80,100 again.
                    //
                    // \`cursor === state.cursor\` is not redundant with \`widenExhausted\`. The flag is
                    // initialised from the stored marker and never reset, so on the poll that finally
                    // escapes a pin it is still true while the cursor has moved - and writing the
                    // marker onto the cursor just reached would disable the ladder at a cursor it
                    // never climbed, permanently, since every later advance re-poisons the new one.
                    // The cursor moving is this marker's only escape hatch; this is what keeps it open.
                    widenExhaustedAt: widenExhausted && cursor === state.cursor && cursor?.tieBreaker
                        ? { timestamp: cursor.timestamp, tieBreaker: cursor.tieBreaker }
                        : undefined,"

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
