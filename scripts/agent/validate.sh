#!/usr/bin/env bash
# The deterministic validation ladder for one agent run - no LLM on the green
# path. Driven by scripts/agent/cez-ladder.sh, which runs it once per pass and
# turns the verdict below into a digest the run reads.
#
#   TARGET_BRANCH=<integration branch> bash scripts/agent/validate.sh --json-out <path> \
#     [--force-e2e] [--skip-e2e] [--build] [--update-snapshots] [--e2e-projects <csv>]
#     [--e2e-grep <regex>]
#
# Always: route-tree freshness gate, migration-drift gate, typecheck, lint, vitest.
# --build adds `pnpm build` after vitest (the cezar ladder turns it on; SPEC §7.1).
# When the diff since TARGET_BRANCH touches UI paths (glob heuristic below):
# setup-e2e.sh --if-needed, then the Playwright suite against the -linux
# baselines recorded for this platform.
#
# --e2e-grep narrows it further, to the specs whose full title matches the regex
# (Playwright's `-g`). The step is then named `<step> (narrowed)`, because a
# verdict that ran three specs must not read like one that ran the suite. The
# fix loop uses it to re-run what it just failed before re-running everything;
# main.ts owns the rule that a narrowed run may never decide green.
#
# --e2e-projects narrows that suite to named playwright.config.ts projects
# ("chromium", "mobile-safari"). Both declare `dependencies: ['setup']`, so the
# sign-in project comes along either way. With the flag the step is named
# `e2e:<csv>` rather than `e2e`, so a verdict says which browsers it covers and
# the report can keep the rows apart.
#
# Verdict JSON: {uiTouched, e2eProjects, steps: [{name, ok, durationMs}], e2e: {failed: []},
#                infra, ok}
#
# `infra` is null on every ordinary run. It carries a sentence when the ladder found that the
# thing under test was not running — today that means a dev server that died mid-suite — and a
# verdict carrying it says nothing about the branch, so main.ts must not spend a fix attempt on it.
set -uo pipefail

JSON_OUT=""
FORCE_E2E=0
SKIP_E2E=0
UPDATE_SNAPSHOTS=0
E2E_PROJECTS=""
BUILD=0
E2E_GREP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json-out) JSON_OUT="$2"; shift 2 ;;
    --force-e2e) FORCE_E2E=1; shift ;;
    --skip-e2e) SKIP_E2E=1; shift ;;
    --build) BUILD=1; shift ;;
    --update-snapshots) UPDATE_SNAPSHOTS=1; shift ;;
    --e2e-projects) E2E_PROJECTS="$2"; shift 2 ;;
    --e2e-grep) E2E_GREP="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

STEPS_JSON="[]"
OVERALL_OK=1

record_step() { # name ok durationMs
  STEPS_JSON=$(jq -c --arg name "$1" --argjson ok "$2" --argjson ms "$3" \
    '. + [{name: $name, ok: ($ok == 1), durationMs: $ms}]' <<<"$STEPS_JSON")
  [ "$2" -eq 1 ] || OVERALL_OK=0
}

# How many lines of a failed step's log reach stderr. Overridden per call with an assignment
# prefix (`STEP_TAIL_LINES=60 run_step ...`), which bash scopes to that one invocation.
STEP_TAIL_LINES=40

# Milliseconds since the epoch, on GNU date and on BSD date.
#
# The fallback is chosen from the *value* and not from the exit status, because BSD `date` has no
# `%N`: it prints the format's literal tail ("17881169293N") and succeeds, so a `||` fallback never
# fires. The bogus value then reached `$((end - start))`, which errored, which left `record_step`
# with two arguments, which `set -u` turned into an exit - the whole ladder reporting `steps: []`
# on macOS. Second resolution there is fine; the ladder's home is the Linux container.
now_ms() {
  local stamp
  stamp=$(date +%s%3N 2>/dev/null)
  case "$stamp" in
    '' | *[!0-9]*) date +%s000 ;;
    *) printf '%s\n' "$stamp" ;;
  esac
}

run_step() { # name command...
  local name="$1"; shift
  local start end ok log
  log="${TMPDIR:-/tmp}/validate-${name//[^a-zA-Z0-9]/-}.log"
  start=$(now_ms)
  if "$@" > >(tail -c 200000 >"$log") 2>&1; then ok=1; else ok=0; fi
  end=$(now_ms)
  record_step "$name" "$ok" $((end - start))
  if [ "$ok" -eq 0 ]; then
    echo "==> STEP FAILED: $name (log tail follows)" >&2
    tail -n "$STEP_TAIL_LINES" "$log" >&2
  else
    echo "==> $name OK" >&2
  fi
  # The step's own verdict, so a caller that has more to say about a red step can branch on it.
  [ "$ok" -eq 1 ]
}

route_tree_gate() { pnpm generate-routes && git diff --exit-code -- src/routeTree.gen.ts; }

# A schema edit with no committed migration, caught here rather than at deploy time.
#
# `drizzle-kit generate` is a pure function of the schema and the existing journal, so re-running
# it on a clean tree writes nothing. Anything it does write is a migration the branch owed and did
# not pay: the Worker would deploy against a database whose shape it no longer matches, and D1
# gives no second chance to notice.
#
# Two checks, because the interesting case is invisible to the first: a NEW migration is an
# untracked file, and `git diff` never mentions untracked files. `--exit-code` catches an edited
# journal or a rewritten `.sql`; the porcelain scan catches the freshly generated pair.
db_drift_gate() {
  pnpm db:generate || return 1
  git diff --exit-code -- drizzle/ || return 1
  local untracked
  untracked=$(git ls-files --others --exclude-standard -- drizzle/)
  if [ -n "$untracked" ]; then
    echo "drizzle-kit generated migrations this branch never committed:" >&2
    printf '%s\n' "$untracked" >&2
    echo "Run \`pnpm db:generate\` and commit drizzle/ with the schema change." >&2
    return 1
  fi
}

run_step "route-tree" route_tree_gate
run_step "db-drift" db_drift_gate
run_step "typecheck" pnpm typecheck
run_step "lint" pnpm lint
run_step "vitest" pnpm test
# SPEC §7.1 asks for a production build before a PR; opt-in because it costs minutes, and the
# cezar ladder is what turns it on (`cez-ladder.sh` passes --build unless told not to).
[ "$BUILD" -eq 1 ] && run_step "build" pnpm build

# ---------------------------------------------------------------------------
# UI-touched heuristic. Deliberately excludes src/server/** — server-only
# issues get vitest here and the full e2e once per iteration from the Auditor;
# billing every issue 5-10 min of e2e buys little marginal signal. money,
# format, charts, theme and fonts drive rendered pixels - a money formatter is
# as visual as a stylesheet here, because every screen in this product is a
# table of numbers; scripts/seed is what the screenshots photograph.
# ---------------------------------------------------------------------------
UI_TOUCHED=0
BASE=$(git merge-base "${TARGET_BRANCH:?TARGET_BRANCH must be set}" HEAD 2>/dev/null || true)
if [ -n "$BASE" ]; then
  if git diff --name-only "$BASE"...HEAD | grep -qE \
    '^(src/components/|src/routes/|src/styles/|src/router\.tsx|src/routeTree\.gen\.ts|src/lib/(i18n|charts|money)/|src/lib/(theme|fonts|cn|format|money)\.ts|e2e/|playwright\.config\.ts|vite\.config|package\.json|pnpm-lock\.yaml|scripts/seed/)'; then
    UI_TOUCHED=1
  fi
else
  echo "==> WARN: cannot resolve merge-base with ${TARGET_BRANCH}; treating as UI-touched" >&2
  UI_TOUCHED=1
fi
[ "$FORCE_E2E" -eq 1 ] && UI_TOUCHED=1
[ "$SKIP_E2E" -eq 1 ] && UI_TOUCHED=0

E2E_FAILED_JSON="[]"
# Set only when the ladder finds that the thing under test was not running. Empty means the
# verdict is about the branch; anything else means the branch was never tested. See the probe
# after the e2e rung.
INFRA=""
# The origin the suite is pointed at, and the one the probe below asks about — the same server,
# named once so the two can never drift into disagreeing about what "up" means.
E2E_BASE_URL="http://127.0.0.1:${E2E_PORT:-3010}"
if [ "$UI_TOUCHED" -eq 1 ] && [ "$OVERALL_OK" -eq 1 ]; then
  run_step "e2e-env" bash "$(dirname "$0")/setup-e2e.sh" --if-needed
  # setup-e2e.sh returns only once the dev server answers, and starting it runs
  # the vite plugin's route generator over the same file `tsr generate` wrote in
  # the gate above. The two agree because tsr.config.json carries the plugin's
  # Start footer; if they ever drift apart again, the rewrite lands here as a
  # named step failure rather than as a mid-suite module reload that fails two
  # unrelated specs on `[vite] Failed to reload`.
  run_step "route-tree-after-dev" git diff --exit-code -- src/routeTree.gen.ts
  if [ "$OVERALL_OK" -eq 1 ]; then
    # Four workers per container by default: two containers run this rung at
    # once (MAX_PARALLEL_E2E in main.ts, which is deliberately smaller than the
    # number of pipelines it lets run), and 8 browsers + 2 Vite servers is well
    # inside what one VM sustains without the machine-load TIMEOUT flakes.
    # Override with E2E_WORKERS to measure a different knee.
    #
    # One `--reporter`, comma-separated: Playwright declares the option as
    # `--reporter <reporter>` ("Reporter to use, comma-separated"), so a
    # repeated flag is not a list — the last occurrence wins and the rest are
    # dropped. Written as three flags this run kept only `html`, never wrote
    # results.json, and reported `failed: []` for every red suite.
    #
    # One retry, and on the command line rather than by exporting CI=1. The config keys
    # `retries: isCI ? 2 : 0` off CI, but three other things hang from that same flag and two of
    # them are load-bearing here: the port guard is `if (!isCI && …)`, which its own comment calls
    # "a hard stop rather than a warning" after four automated rounds photographed the wrong
    # server — and this rung is exactly such a round — while `globalTimeout: isCI ? 10 * 60_000 :
    # undefined` is sized, per its comment, for one of ci.yml's twelve shards, where this runs the
    # whole unsharded suite. (CI would also flip `workers` and `reporter`, which the flags on the
    # line below happen to override today and would stop overriding the day either one moves.) A
    # retry flag buys the tolerance and nothing else.
    #
    # 1 rather than 2 keeps this gate no more tolerant than CI. Override with E2E_RETRIES; 0 for a
    # deliberately intolerant run. The measurement behind it: a dev server that dropped four
    # connections reddened a whole iteration and pointed the reviewer at unrelated issues, and over
    # the runs recorded then, 101 of 108 failing specs were infrastructure (ECONNREFUSED, timeouts, `Target
    # crashed`) and 7 were pixel diffs, and each red rung costs a fix session plus a re-run - for a
    # spec that passes when asked again. The JSON reporter marks a spec `ok` when its last attempt
    # passed, so a retried-green spec never reaches `e2e.failed` below, and a spec red twice in a
    # row still does. Real regressions pay one extra attempt; flakes stop spending the fix budget.
    #
    # One assignment. A merge once kept both branches' lines, and the second - a hard-coded
    # `--retries=1` - silently overrode the E2E_RETRIES override above. validate-sh.test.ts pins
    # the override, so a second line here goes red.
    PW_ARGS=(--workers="${E2E_WORKERS:-4}" --retries="${E2E_RETRIES:-1}" --reporter=line,json,html)
    [ "$UPDATE_SNAPSHOTS" -eq 1 ] && PW_ARGS+=(--update-snapshots)
    # Repeated `--project` IS a list, unlike `--reporter` above: playwright declares it as
    # `--project <project-name...>`. Narrowing to chromium is what lets the fix loop re-validate
    # for roughly half the time — mobile-safari is the larger half of the suite — while the caller
    # still gates on the full matrix once, before the issue is called green.
    E2E_STEP="e2e"
    if [ -n "$E2E_PROJECTS" ]; then
      E2E_STEP="e2e:${E2E_PROJECTS}"
      IFS=',' read -ra REQUESTED_PROJECTS <<<"$E2E_PROJECTS"
      for project in "${REQUESTED_PROJECTS[@]}"; do
        PW_ARGS+=(--project="$project")
      done
    fi
    # `-g` after the projects, so a narrowed run is still one project's worth of specs. The step
    # name says so too: the report table keeps narrowed rows apart from full ones, and nobody reads
    # a three-spec verdict as a suite that passed.
    if [ -n "$E2E_GREP" ]; then
      PW_ARGS+=(-g "$E2E_GREP")
      E2E_STEP="${E2E_STEP} (narrowed)"
    fi
    # Named once, because that whole incident was the writer and the reader of
    # this file disagreeing without saying so: the reporter is pointed at it,
    # the jq walk below reads it, and the warning names it.
    E2E_RESULTS_FILE=test-results/results.json
    # The JSON reporter writes at the end of a run, so a suite that dies before
    # it fires would otherwise leave the previous iteration's failures standing
    # in for this one's — and hide the absence the warning below reports.
    rm -f "$E2E_RESULTS_FILE"
    # Through run_step like every other rung — same timing, same /tmp/validate-e2e.log, same
    # record_step, same failure header. Only the tail is deeper: the line reporter's failure
    # summary runs longer than a compiler's. `env` carries the two variables Playwright reads,
    # since run_step forwards "$@" as a command rather than evaluating a prefix.
    STEP_TAIL_LINES=60 run_step "$E2E_STEP" \
      env PLAYWRIGHT_BASE_URL="$E2E_BASE_URL" PLAYWRIGHT_JSON_OUTPUT_NAME="$E2E_RESULTS_FILE" \
      pnpm exec playwright test "${PW_ARGS[@]}"
    E2E_OK=$? # read before the `-f` test below overwrites $?
    # A red rung is a verdict about the branch only if the thing under test was still running.
    # `setup-e2e.sh --if-needed` checks that once, before the suite; nothing checked it after, and
    # a dev server that ran out of heap mid-suite therefore reddened the ladder with specs that
    # never reached it. The shape of it: 33 of 40 failures were `ECONNREFUSED`, `dev-server.log`
    # ended in `JavaScript heap out of memory`, the fix budget went on a phantom and the ticket
    # was handed back blocked for a suite it had passed.
    #
    # So ask. A server that no longer answers turns this into the same category as an unknown flag
    # — an operator problem, reported rather than blamed on the branch — and `main.ts` decides what
    # to do with it. Only asked when the rung is red: a green suite proves the server was there.
    if [ "$E2E_OK" -ne 0 ] &&
      ! curl --silent --fail --output /dev/null "${E2E_BASE_URL}/"; then
      INFRA="the dev server on ${E2E_BASE_URL} stopped answering during ${E2E_STEP}"
      echo "==> INFRA: ${INFRA} — the branch was not tested by this run" >&2
    fi
    if [ -f "$E2E_RESULTS_FILE" ]; then
      # Failed test titles + first error line + snapshot-diff flag, capped at
      # 40. Playwright nests suites recursively — walk the whole tree.
      #
      # `results[-1]`, not `results[0]`: with the retry above, `results` holds one entry per
      # attempt, oldest first, and it is the *last* attempt that decided `ok == false`. Reading the
      # first would describe a spec that blipped on `Connection refused` and then failed for real
      # on a pixel diff as a connection error with `snapshotDiff: false` — handing the fix agent
      # the flake this rung was taught to tolerate instead of the regression it caught.
      E2E_FAILED_JSON=$(jq -c '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | (.tests[0].results[-1].error.message // "") as $msg | {title: .title, error: ($msg | split("\n")[0] | .[0:300]), snapshotDiff: ($msg | test("toHaveScreenshot|screenshot comparison"))}] | .[0:40]' "$E2E_RESULTS_FILE" 2>/dev/null || echo '[]')
    elif [ "$E2E_OK" -ne 0 ]; then
      # Not a step of its own: the ladder is already red and run_step has just
      # printed the tail, which still carries the line reporter. What this says
      # is that the *verdict* will name no specs, so nobody reads `failed: []`
      # as "no spec failed".
      echo "==> WARN: e2e is red but $E2E_RESULTS_FILE was not written — the verdict will name no failing specs, so read the log tail above rather than the verdict. Check that PW_ARGS still declares one --reporter list including json." >&2
    fi
  fi
fi

VERDICT=$(jq -n -c \
  --argjson uiTouched "$UI_TOUCHED" \
  --arg projects "$E2E_PROJECTS" \
  --argjson steps "$STEPS_JSON" \
  --argjson failed "$E2E_FAILED_JSON" \
  --arg infra "$INFRA" \
  --argjson ok "$OVERALL_OK" \
  '{uiTouched: ($uiTouched == 1),
    e2eProjects: (if $projects == "" then [] else ($projects | split(",")) end),
    steps: $steps, e2e: {failed: $failed},
    infra: (if $infra == "" then null else $infra end),
    ok: ($ok == 1)}')

echo "$VERDICT"
[ -n "$JSON_OUT" ] && printf '%s\n' "$VERDICT" > "$JSON_OUT"

[ "$OVERALL_OK" -eq 1 ]
