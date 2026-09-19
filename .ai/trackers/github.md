# Tracker provider: GitHub

This file is the GitHub implementation of the tracker operations contract (see `TEMPLATE.md` for the contract itself). Skills perform issue/PR state management through **named tracker operations** — `**get-issue**`, `**comment-pr**`, and so on — and this file defines what each operation means for GitHub, using the `gh` CLI.

At runtime: `om-setup-agent-pipeline` copies this file into the repository at `.ai/trackers/github.md`, and the config's `tracker` field selects it. When a skill says "tracker operation **get-pr**", execute the command documented under that operation heading in the repo's copy. The repo's copy is authoritative: teams extend or override any operation by editing it, and every skill picks the change up on its next run. An operation not covered by an edit keeps its behavior from this file's text as copied.

## Prerequisites

- `gh` CLI installed and authenticated, and `jq` available (the label guards and several operations parse JSON with it). Verify with the **auth-check** operation before a batch run; fail fast when unauthenticated.
- **Minimum `gh` version: 2.82.1** (released 2025-10-22). Older clients abort every label, assignee, and title/body edit on the retired Projects (classic) API — see the next section. **auth-check** warns when the installed client is older.
- **`gh` >= 2.99.0 for image evidence.** `--attach` — native attachment upload on `issue`/`pr` `create`, `edit` and `comment` — landed in [v2.99.0](https://github.com/cli/cli/releases/tag/v2.99.0); it is what makes **attach-image-evidence** render inline. Below that version only that one operation degrades (to links), so **auth-check** warns rather than failing.
- All operations accept an optional `{repo}` (`owner/name`); when omitted, `gh` infers it from the current checkout's git remote. Pass `--repo {owner}/{repo}` explicitly whenever a skill operates on a repository other than the current one.

### Projects (classic) deprecation — the failure that silently leaves a PR unlabeled

GitHub [sunset Projects (classic)](https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/), and its GraphQL fields (`repository.pullRequest.projectCards`, `repository.issue.projectCards`, `organization.projects`) now answer with an error instead of data. `gh pr edit` and `gh issue edit` reach the API through GraphQL and, on clients older than 2.82.1, request those retired fields **unconditionally** — no `--add-project` flag involved. `gh` treats the error as fatal, so the command exits non-zero **before applying the edit**, printing only:

```text
GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience, see: https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/. (repository.pullRequest.projectCards)
```

That text reads like a deprecation warning, but the label was never applied and the PR keeps its previous state.

**Diagnose it correctly.** Any operation failing with `Projects (classic) is being deprecated` is reporting a **stale `gh` client**, not a repository or organization misconfiguration: no classic project has to be attached to anything for it to fire, and it is not specific to one repo, one owner, or one token.

**Why this descriptor does not hit it.** Every label, assignee, and title/body mutation below is written against the REST API (`gh api`), which never touches the GraphQL project fields and therefore behaves identically on every client version. That is deliberate — do not "simplify" the guards back to `gh pr edit --add-label`.

**Upgrade the client anyway.** Read paths keep the coupling: `gh issue view` / `gh pr view` without `--json` render the classic project column, and `projectCards` is still offered as a fetchable `--json` field (cli/cli#11769), so a field list that names it errors on any version. Distribution packages lag years behind — Debian bookworm ships 2.23, Ubuntu 2.45, Alpine stable 2.72, all affected — so install from [GitHub's own package repositories](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#recommended-official) or Homebrew rather than the distro's:

```bash
gh --version                                   # must report >= 2.82.1
brew upgrade gh                                # macOS / Linuxbrew
sudo apt update && sudo apt install --only-upgrade gh   # after adding GitHub's apt repo
```

Upstream references: cli/cli#11983 (`gh pr edit` aborts without any project flag), cli/cli#11986 → fixed in [v2.82.1](https://github.com/cli/cli/releases/tag/v2.82.1) ("Fix `gh pr edit` not detecting classic projects feature deprecation"), cli/cli#11992 / #12476 / #12640 (the same error from `gh issue view`; the maintainers' answer is to upgrade), cli/cli#11769 (open: drop `projectCards` as a fetchable field).

## Conventions

- Issue and PR identifiers are numbers; in text they are written `#123`.
- A `--json` field list must never include `projectCards`: it is a Projects (classic) relic that errors on every client version (see above). Request only the fields the calling skill names.
- A PR is linked to the issue it resolves with `Fixes #{issueId}` (or `Closes #{issueId}`) in the PR body; GitHub then closes the issue on merge. To reference without auto-closing, use a plain issue link.
- PRs open as **drafts** when a skill says so; a human (or **mark-pr-ready**) promotes them.
- Claim/lock signals on an issue or PR are: assignee set to the automation user, the `in-progress` label, and a `🤖`-prefixed claim comment. All three are set on claim; the label is guarded (below). The `ci-monitoring` label is **not** a claim signal — it marks work that is finished and reported while its CI-result follow-up is still owed, and never makes another skill back off.
- Long, multi-line comment bodies are posted with `--body-file` (or a heredoc via process substitution) so formatting is preserved.
- CI status truth comes from **get-pr-checks**; the set of *required* checks comes from **get-required-checks** (the branch's ruleset rules, plus classic branch protection where it is readable). Only when neither is readable does it fall back to treating every reported check as required — a guess, and reported as one.

## Label guards

Every label mutation goes through an existence guard so a missing label degrades to a logged skip instead of a failure, and `labels.enabled: false` in the config skips label operations entirely.

The guards mutate through the **REST API**, not `gh pr edit` / `gh issue edit`. Those two route through GraphQL, which requests the retired Projects (classic) fields on clients older than 2.82.1 and aborts the whole edit before the label lands (see Prerequisites). REST never touches those fields, so labels apply on any client version. Keep it that way.

```bash
# Target repository: $REPO when a skill addresses another repository (set by repo-info),
# otherwise the current checkout's.
tracker_repo() {
  if [ -n "${REPO:-}" ]; then printf '%s' "$REPO"
  else gh repo view --json nameWithOwner --jq .nameWithOwner; fi
}

label_exists() {
  gh api --paginate "repos/$(tracker_repo)/labels" --jq '.[].name' | grep -Fxq "$1"
}

# PR labels. $1 = label, $2 = PR number.
apply_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  if label_exists "$1"; then
    gh api -X POST "repos/$(tracker_repo)/issues/$2/labels" -f "labels[]=$1" >/dev/null
  else
    echo "Skipping label '$1' (not defined in this repo). Create it with: gh label create '$1'"
  fi
}

# Issue labels. GitHub labels issues and PRs through the same /issues/ endpoint, so this
# delegates; it keeps its own name because skills call the guards by name. $1 = label,
# $2 = issue id.
apply_issue_label() { apply_label "$1" "$2"; }

# Removal. $1 = label, $2 = PR or issue number. A label that is not currently applied
# answers 404 — a no-op, not a failure, so removal needs no existence check.
remove_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  gh api -X DELETE \
    "repos/$(tracker_repo)/issues/$2/labels/$(printf '%s' "$1" | jq -sRr @uri)" \
    >/dev/null 2>&1 || true
}
remove_issue_label() { remove_label "$1" "$2"; }

# Pipeline labels are mutually exclusive: setting one removes the others first.
# Note the argument order, unchanged: $1 = PR number, $2 = label.
#
# $PIPELINE_LABELS is a space-separated string, and `for label in $PIPELINE_LABELS`
# iterates it once as a single word under zsh, which does not word-split an unquoted
# parameter expansion (setting IFS does not change that; only the non-default
# SH_WORD_SPLIT option does). The competing labels are then never removed and the
# mutual exclusion silently does not hold. Splitting on newlines through `read` behaves
# identically in sh, bash and zsh; the trailing newline from `printf` matters, because
# `read` returns non-zero on an unterminated last line and drops it.
set_pipeline_label() {
  if [ "$LABELS_ENABLED" != "true" ]; then return 0; fi
  printf '%s\n' "$PIPELINE_LABELS" | tr ' ' '\n' | while IFS= read -r label; do
    [ -z "$label" ] && continue
    [ "$label" = "$2" ] && continue
    remove_label "$label" "$1"
  done
  apply_label "$2" "$1"
}
```

Cross-repository targets need no extra flags: `tracker_repo` resolves `$REPO` when a skill set it, and every guard interpolates the result, so the existence check and the mutation always address the same repository.

Read the labels back (`gh pr view {prNumber} --json labels`) whenever the label state gates a later decision — a mutation the guard logged as skipped is a normal outcome, and a run that assumes it landed will branch wrongly.

## Operations

### Identity and repository

#### auth-check
Verify the CLI is authenticated and new enough. → exit status (non-zero when unauthenticated), plus a warning on stdout when the client predates the Projects (classic) fix (2.82.1) or native attachment upload (2.99.0).
```bash
gh auth status || exit 1

# Clients older than 2.82.1 abort `gh pr edit` / `gh issue edit` on the retired Projects
# (classic) GraphQL fields (see Prerequisites). The guards mutate through REST, so a run
# still works — but read paths stay affected, so warn instead of failing silently.
GH_VERSION=$(gh --version | sed -n '1s/.*gh version \([0-9][0-9.]*\).*/\1/p')
MIN_GH_VERSION=2.82.1
if [ "$(printf '%s\n%s\n' "$MIN_GH_VERSION" "$GH_VERSION" | sort -V | head -n1)" != "$MIN_GH_VERSION" ]; then
  echo "WARNING: gh $GH_VERSION predates $MIN_GH_VERSION — 'gh pr edit'/'gh issue edit' fail on the Projects (classic) deprecation. Upgrade: https://github.com/cli/cli/blob/trunk/docs/install_linux.md#recommended-official"
fi

ATTACH_GH_VERSION=2.99.0
if [ "$(printf '%s\n%s\n' "$ATTACH_GH_VERSION" "$GH_VERSION" | sort -V | head -n1)" != "$ATTACH_GH_VERSION" ]; then
  echo "WARNING: gh $GH_VERSION predates $ATTACH_GH_VERSION — 'gh ... --attach' is unavailable, so attach-image-evidence posts links instead of inline images."
fi
```
`sort -V` exists on GNU and BSD/macOS `sort`; where it does not, compare `gh --version` against 2.82.1 and 2.99.0 by inspection and report the same warnings.

#### current-user
→ the automation user's login.
```bash
CURRENT_USER=$(gh api user --jq '.login')
```

#### repo-info
→ `owner/name` handle and default branch of the current repository.
```bash
gh repo view --json nameWithOwner,defaultBranchRef
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

#### default-branch
→ the repository's default branch name (used when the config's `baseBranch` is `"auto"`).
```bash
BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null || true)
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"
```

### Issues

#### get-issue
`{issueId}`, field list → issue data. Request only the fields the calling skill names.
```bash
gh issue view {issueId} --repo {owner}/{repo} --json number,title,body,state,author,url,labels,assignees,comments
```

#### search-issues
Query (text, `in:title,body`, state) → matching issues.
```bash
gh issue list --repo {owner}/{repo} --state open --search "<query> in:title,body" --json number,title,url
```

#### create-issue
Title, body, assignee, labels → created issue URL.
```bash
gh issue create --repo {owner}/{repo} --title "<title>" --assignee <login> --label <labels> --body "<body>"
```

#### close-issue
`{issueId}`, reason, closing comment.
```bash
gh issue close {issueId} --repo {owner}/{repo} --reason completed --comment "<comment>"
```

#### comment-issue
`{issueId}`, body (use a heredoc/body-file for multi-line bodies).
```bash
gh issue comment {issueId} --repo {owner}/{repo} --body "<body>"
```

#### update-issue
`{issueId}`, new title and/or body. Edits the issue's own fields; does not touch labels or assignees (those have their own operations). Pass only what changed; read the body from a file so multi-line content survives.
```bash
gh api -X PATCH repos/{owner}/{repo}/issues/{issueId} -f title="<title>"
gh api -X PATCH repos/{owner}/{repo}/issues/{issueId} -F body=@<file>
```
`gh issue edit {issueId} --title "<title>" --body-file <file>` does the same on `gh` >= 2.82.1 and is fine interactively; older clients fail before writing anything (see Prerequisites), so script the REST form.

#### assign-issue / unassign-issue
```bash
gh api -X POST   repos/{owner}/{repo}/issues/{issueId}/assignees -f "assignees[]=<login>"
gh api -X DELETE repos/{owner}/{repo}/issues/{issueId}/assignees -f "assignees[]=<login>"
```

#### label-issue / unlabel-issue
Always through the guards: `apply_issue_label "<label>" {issueId}` / `remove_issue_label "<label>" {issueId}`.

#### get-issue-comment
Comment id → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

#### list-issue-comments
`{issueId or prNumber}` → conversation comments (PR conversation comments are issue comments on GitHub).
```bash
gh api repos/{owner}/{repo}/issues/{number}/comments --jq '.[] | {id,user:.user.login,body}'
```

#### update-comment
`{commentId}`, new body → rewrite an existing conversation comment in place (works for issue and PR conversation comments alike). This is how marker-idempotent comments (label rationale, verification, claim take-overs) are updated on re-runs: find your `🤖 …` marker via **list-issue-comments**, then update that comment instead of posting a new one. Use a body file so multi-line bodies survive.
```bash
gh api -X PATCH repos/{owner}/{repo}/issues/comments/{commentId} -F body=@<path>
```

### Pull requests

#### get-pr
`{prNumber}`, field list → PR data. Request only the fields the calling skill names; the full field set skills use:
```bash
gh pr view {prNumber} --json number,title,url,body,state,author,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,labels,latestReviews,reviews,commits,files,assignees,comments,mergedAt,mergeCommit,closingIssuesReferences,createdAt,closedAt,additions,changedFiles
```

#### list-prs
State/search filters, field list, limit → PRs.
```bash
gh pr list --state open --json number,title,url,author,labels,reviewDecision,mergeable,mergeStateStatus,headRefName,baseRefName,updatedAt,isDraft,assignees --limit 100
gh pr list --state merged --search "merged:>=${SINCE_DATE}" --json number,title,url,body,author,createdAt,mergedAt,mergeCommit,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
gh pr list --state closed --search "closed:>=${SINCE_DATE} is:unmerged" --json number,createdAt,title,url,body,author,closedAt,baseRefName,headRefName,closingIssuesReferences,labels --limit {limit}
```

#### search-prs
Free-text query (for example an issue reference) and state → matching PRs.
```bash
gh search prs --repo {owner}/{repo} "#{issueId}" --state open --json number,title,url,state
```

#### create-pr
Base branch, draft flag, title, body → PR.
```bash
gh pr create --repo {owner}/{repo} --base "$BASE_BRANCH" --draft --title "<title>" --body "<body>"
PR_URL=$(gh pr view --json url --jq .url)
PR_NUMBER=$(gh pr view --json number --jq .number)
```

#### update-pr
`{prNumber}`, new title and/or new body → the PR's own title/body rewritten in place (not a comment), e.g. describing what a PR actually ships once its scope changed. Pass whichever of title / body changed; omit the other. Read the body from a file so multi-line content survives.
```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/{prNumber} -f title="<title>"
gh api -X PATCH repos/{owner}/{repo}/pulls/{prNumber} -F body=@<path>
```
`gh pr edit {prNumber} --title … --body-file …` does the same on `gh` >= 2.82.1. On older clients it exits non-zero with the Projects (classic) error and writes nothing (see Prerequisites) — which reads like a no-op, so script the REST form above.

#### comment-pr
`{prNumber}`, body. For long structured comments:
```bash
gh pr comment {prNumber} --body-file <path-or-process-substitution>
```

#### attach-image-evidence
`{prNumber}` (or `{issueId}`), a markdown comment body (without the images), a `{slug}` (e.g. `pr-{prNumber}`), and a list of local PNG paths → post one comment with the images embedded **inline**, and return the comment URL.

`gh` uploads each file to GitHub's own attachment store and rewrites the markdown to the returned `https://github.com/user-attachments/assets/…` URL. Those render inline for every viewer who can read the repository, **private repositories included**, and nothing is committed to any branch:

```bash
# `--attach '<path>#<alt text>'` — the text after `#` becomes the alt text; without it
# `gh` uses the filename. Up to 50 files per command. A path the body already references
# as `![alt](./after.png)` is rewritten in place and keeps the body's alt text; every
# other attachment is appended to the end of the comment, in flag order.
gh pr comment {prNumber} --body-file <body-file> \
  --attach '<artifacts-dir>/base-light-1440.png#Base, light, 1440x900' \
  --attach '<artifacts-dir>/head-light-1440.png#Head, light, 1440x900'

gh pr view {prNumber} --json url --jq .url
```

`gh issue comment {issueId}`, `gh issue create` and `gh pr create` take the same flag, which is how an issue carries evidence from the moment it is filed. `gh pr review` does **not** — attach the images to a comment and reference it from the review body.

A caller that needs the asset URLs themselves rather than a posted comment (**om-prepare-issue** embeds them in a `## 📸 Evidence` section of the issue body) posts first and reads the rewritten markdown back:

```bash
gh issue view {issueId} --json body --jq .body        # now carries the user-attachments URLs
```

Requires **`gh` >= 2.99.0**, which **auth-check** warns about. Fallbacks, in order: on an older client, post through **comment-pr** / **comment-issue** with the local artifact paths listed and say that inline rendering needs a newer `gh`; when an upload itself fails, do the same rather than failing the caller. Never store evidence on the change's own branch — and do not resurrect the pre-2.99.0 workaround of pushing a `qa-evidence-*` branch and linking `raw.githubusercontent.com`, which cannot render at all on a private repository because those URLs require auth.

#### assign-pr / unassign-pr
Assignees live on the shared `/issues/` endpoint for PRs too — `{prNumber}` is the path segment.
```bash
gh api -X POST   repos/{owner}/{repo}/issues/{prNumber}/assignees -f "assignees[]=<login>"
gh api -X DELETE repos/{owner}/{repo}/issues/{prNumber}/assignees -f "assignees[]=<login>"
```

#### label-pr / unlabel-pr
Always through the guards: `apply_label "<label>" {prNumber}` / `set_pipeline_label {prNumber} "<label>"` for the mutually exclusive pipeline group; direct removal: `remove_label "<label>" {prNumber}`.

#### get-pr-diff
`{prNumber}` → full diff, or the changed-file list with `--name-only`.
```bash
gh pr diff {prNumber}
gh pr diff {prNumber} --name-only
```

#### get-pr-files
`{prNumber}` → changed files with per-file status (added/modified/removed), paginated.
```bash
gh api "repos/{owner}/{repo}/pulls/{prNumber}/files" --paginate --jq '.[] | {path: .filename, status: .status}'
```

#### checkout-pr
`{prNumber}` → the PR's head available locally (needed for cross-repository fork PRs where the head branch cannot be fetched from `origin`).
```bash
gh pr checkout {prNumber}
```

#### review-pr
`{prNumber}`, verdict (approve / request changes), body.
```bash
gh pr review {prNumber} --approve --body "<body>"
gh pr review {prNumber} --request-changes --body "<body>"
```
GitHub rejects self-approval (reviewing your own PR); surface that instead of working around it.

#### merge-pr
`{prNumber}`; squash is the default merge strategy. `--auto` merges when checks pass; `--delete-branch` only when asked.
```bash
gh pr merge {prNumber} --squash
```
**When the base branch has a merge queue** — `gh api "repos/{owner}/{repo}/rules/branches/{baseBranch}" --jq '.[].type'` lists `merge_queue` — drop the strategy and run `gh pr merge {prNumber}`. That enqueues the PR (enabling auto-merge while checks are still pending); the queue's own method decides, so `--squash` / `--merge` / `--rebase` are ignored with a warning and `--delete-branch` is refused outright. The command means **queued**, not merged: report it that way, and expect the merge minutes later, once the queue has run the suite on the commit it built. Removing an entry is `gh api graphql -f query='mutation { dequeuePullRequest(input: {id: "<node id>"}) { clientMutationId } }'` — `gh pr merge --disable-auto` does not do it.

The hard blocks `SDLC.md` declares — `do-not-merge`, `blocked`, `qa-failed`, and `needs-qa` without `qa-approved` — are enforced by the **`merge-gate`** check (`.github/workflows/merge-gate.yml`, deciding in `scripts/ci/merge-gate.mjs`), not by this command and not by the skill that calls it. Read the check, not the labels: it re-runs on every label change, so a red `merge-gate` is the current answer. Never reach for `--admin` to get past it — that bypass is a human's deliberate act, never a skill's.

#### mark-pr-ready
Promote a draft PR.
```bash
gh pr ready {prNumber}
```

#### get-pr-checks
`{prNumber}` → CI check runs with name, state, and link.
```bash
gh pr checks {prNumber} --json name,state,link
```
Unreadable to a fine-grained PAT: the rollup expands to `CheckRun` nodes, fine-grained tokens have
no `Checks` permission to grant, and `gh` exits non-zero with `Resource not accessible by personal
access token`. The REST `commits/{ref}/check-runs` endpoint answers 403 for the same reason. Fall
back to the Actions API, which asks only for `Actions: Read`:
```bash
sha=$(gh pr view {prNumber} --json headRefOid --jq .headRefOid)
gh api --paginate --slurp "repos/{owner}/{repo}/actions/runs?head_sha=$sha&event=pull_request" \
  | jq -r '[.[].workflow_runs[]] | group_by(.name) | map(max_by(.run_started_at))
           | .[] | "\(.id) \(.name)"' \
  | while read -r run workflow; do
      gh api --paginate "repos/{owner}/{repo}/actions/runs/$run/jobs" \
        | jq -c --arg w "$workflow" '.jobs[]
            | {name: "\($w) · \(.name)", state: ((.conclusion // .status) | ascii_upcase), link: .html_url}'
    done
```
Three details are load-bearing, because the rows feed consumers written against `gh pr checks`:

- **`state` is the verdict, not the lifecycle.** The Jobs API keeps pass/fail in `.conclusion` and
  only `queued` / `in_progress` / `completed` in `.status`. `(.conclusion // .status) | ascii_upcase`
  maps `failure → FAILURE`, `timed_out → TIMED_OUT`, `success → SUCCESS`, `skipped → SKIPPED` onto
  the upper-cased vocabulary this operation publishes, and leaves an unfinished job as
  `IN_PROGRESS`, which falls through to non-failing the way `PENDING` does. Reading `.status`
  alone reports a hard-failed job as `completed` — a value no failure list contains, so a red PR
  reads green.
- **The row set is per *job* across *workflows*, not the PR's check rollup.** `head_sha` alone
  returns every run recorded against the commit: the deploy workflows that ran on `push` once the
  SHA also landed on the base branch, and one bot run per review comment. `event=pull_request`
  drops those, and `group_by(.name) | max_by(.run_started_at)` keeps the newest run per workflow so
  a superseded attempt cannot outlive the one that replaced it. Job names repeat across workflows,
  so the workflow name is prefixed and every row stays self-describing.
- **Both calls paginate.** A sharded matrix already puts ten jobs in a single run. `--slurp` is
  what lets the dedup see all pages at once, and `gh api` refuses it together with `--jq` — hence
  the pipe into `jq`.

The fallback sees GitHub Actions jobs only — check runs published by other GitHub Apps
(GitGuardian, Sentry, and the like) are invisible to it. Report what it returns as the Actions
jobs it is, and say that the App-published checks were out of reach, the same way
**list-review-comments** states its own gap.

#### get-required-checks
Base branch → the set of required status checks, one context per line. Two sources, in order:

1. **The branch's effective ruleset rules.** `rules/branches/{branch}` needs only `Metadata: read`,
   which every token has. When it answers, the `required_status_checks` rules it lists are
   authoritative: a ruleset with no such rule means *no* ruleset requires a check, not "unknown".
2. **Classic branch protection**, read as well, because the rules endpoint does not see it: a
   repository protected only the classic way answers step 1 with an empty list. A fine-grained PAT
   gets a 403 here even with `Administration: Read` granted; alongside a readable step 1 that is
   ignored.

The set is the union of whichever reads succeeded. Only when **both** fail (the command exits
non-zero) fall back to treating every reported check as required, and say in the report that the
required set was a guess. `gh api` prints an error's body on stdout, so each read is captured and
discarded on failure — piping it straight through would put `{"message":…}` into the set.
```bash
rules=$(gh api --paginate "repos/{owner}/{repo}/rules/branches/{baseRefName}" \
  --jq '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context' 2>/dev/null) \
  && rules_ok=1 || rules=
classic=$(gh api "repos/{owner}/{repo}/branches/{baseRefName}/protection/required_status_checks" \
  --jq '.contexts[]' 2>/dev/null) && classic_ok=1 || classic=
if [ -n "$rules_ok$classic_ok" ]; then printf '%s\n%s\n' "$rules" "$classic" | sed '/^$/d' | sort -u
else echo "required checks unreadable: treat every reported check as required" >&2; false; fi
```

#### get-pr-comment / get-review-comment
Conversation comment id (`issuecomment-<id>` links) vs inline review comment id (`discussion_r<id>` links) → body, author, URL.
```bash
gh api repos/{owner}/{repo}/issues/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
gh api repos/{owner}/{repo}/pulls/comments/{commentId} --jq '{body,user:.user.login,url:.html_url}'
```

#### list-review-comments
`{prNumber}` → every inline review comment on the diff (the conversation comments come from **list-issue-comments**; these are the ones anchored to a file and line).
```bash
gh api --paginate repos/{owner}/{repo}/pulls/{prNumber}/comments \
  --jq '.[] | {id,user:.user.login,path,line:(.line // .original_line),body,url:.html_url,reply_to:.in_reply_to_id}'
```
REST does not expose a thread's resolved state; **list-review-threads** does (GraphQL), so take the open set from there and use this operation for the comment bodies alone. Without it, treat every returned comment as potentially open and judge it against the current diff. `reply_to` is non-null on replies, which is what lets you reconstruct a thread. Consumers treat an unavailable operation as "inline feedback out of reach", not as a failure: they fall back to review bodies plus conversation comments and state the gap in their report.

#### list-review-threads
`{prNumber}` → every inline review thread with its resolution and outdated state (the two things **list-review-comments** cannot see), the file it anchors to and its comments oldest first. `id` is the GraphQL thread id that **resolve-review-thread** takes; each comment's `id` is the REST id that **reply-review-comment** takes. Consumers count a thread as open only when it is unresolved *and* not outdated.
```bash
gh api graphql --paginate -F owner={owner} -F name={repo} -F number={prNumber} -f query='
  query($owner:String!,$name:String!,$number:Int!,$endCursor:String){
    repository(owner:$owner,name:$name){ pullRequest(number:$number){
      reviewThreads(first:100,after:$endCursor){
        pageInfo{hasNextPage endCursor}
        nodes{ id isResolved isOutdated path line
          comments(first:50){ nodes{ databaseId author{login} body url } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[]
        | {id,isResolved,isOutdated,path,line,comments:[.comments.nodes[]|{id:.databaseId,user:.author.login,body,url}]}'
```

#### reply-review-comment
`{prNumber}`, the REST id of the thread's first comment, body → a reply inside that thread (the reply stays attached to the file and line; a conversation comment would not).
```bash
gh api -X POST repos/{owner}/{repo}/pulls/{prNumber}/comments/{commentId}/replies -f body="<body>"
```

#### resolve-review-thread
Thread id from **list-review-threads** → the thread is marked resolved. Resolution is a claim that the ask was handled: a consumer resolves a thread only after it has answered in it (**reply-review-comment**) with what was done, and never one whose ask it neither fixed nor declined with a reason. Any collaborator with write access may resolve, the thread's author included; the mutation is idempotent on an already-resolved thread.
```bash
gh api graphql -F threadId={threadId} -f query='
  mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread{ id isResolved } } }' \
  --jq '.data.resolveReviewThread.thread'
```

### CI runs

CI status for a *PR* comes from **get-pr-checks** / **get-required-checks** above. The operations here address CI runs directly — needed when working from a bare branch, or when a failure diagnosis needs the actual logs.

#### list-runs
Branch (or head SHA) → recent workflow runs with id, workflow name, status, and conclusion.
```bash
gh run list --branch {branch} --limit 20 --json databaseId,workflowName,name,status,conclusion,headSha,url,createdAt
```

#### get-run
Run id → status, conclusion, and per-job breakdown.
```bash
gh run view {runId} --json status,conclusion,workflowName,headSha,url,jobs
```

#### get-run-failed-logs
Run id → the log output of failed steps only. This is the primary diagnosis input for CI failures.
```bash
gh run view {runId} --log-failed
```

#### rerun-failed
Run id → re-execute only the failed jobs of that run. Use to disambiguate flaky failures before changing any code.
```bash
gh run rerun {runId} --failed
```

#### watch-run
Run id → block until the run completes, exiting non-zero on failure. Prefer this over sleep-polling; fall back to periodic **get-run** when watching is unavailable.
```bash
gh run watch {runId} --exit-status
```

### Labels

#### list-labels
→ all label names defined in the repo. Paginated, so repositories with large taxonomies are not truncated the way a fixed `gh label list --limit` is.
```bash
gh api --paginate repos/{owner}/{repo}/labels --jq '.[].name'
```

#### create-label
Name, color, description. Never delete, rename, or recolor existing labels.
```bash
gh label create <name> --color <hex> --description "<description>"
```

#### ensure-label-taxonomy
Create every label from the config's taxonomy that does not exist yet (used by `om-setup-agent-pipeline`; skip ones that already exist per **list-labels**):
```bash
gh label create review            --color 0366d6 --description "Ready for code review"
gh label create changes-requested --color b60205 --description "Reviewer requested changes"
gh label create qa                --color fbca04 --description "Manual QA in progress"
gh label create qa-failed         --color b60205 --description "Manual QA failed"
gh label create merge-queue       --color 0e8a16 --description "Approved, ready to merge"
gh label create blocked           --color b60205 --description "Blocked by a dependency"
gh label create do-not-merge      --color b60205 --description "Hard merge block"
gh label create bug               --color d73a4a --description "Bug fix"
gh label create feature           --color a2eeef --description "New capability"
gh label create refactor          --color cfd3d7 --description "No behavior change"
gh label create security          --color b60205 --description "Security-relevant change"
gh label create dependencies      --color 0366d6 --description "Dependency update"
gh label create documentation     --color 0075ca --description "Docs only"
gh label create needs-qa          --color fbca04 --description "Requires manual QA before merge"
gh label create skip-qa           --color 0e8a16 --description "Low risk, QA not required"
gh label create qa-approved       --color 0e8a16 --description "Manual QA passed"
gh label create qa-self-verified  --color c5def5 --description "Self-QA exception used"
gh label create in-progress       --color c5def5 --description "An automated skill is working on this"
gh label create ci-monitoring     --color d4c5f9 --description "Work complete and reported; agent is watching CI results"
gh label create do-not-close      --color c5def5 --description "Humans only: never auto-close this issue"
gh label create priority-low      --color e4e669 --description "Cosmetic or follow-up work"
gh label create priority-medium   --color fbca04 --description "Ordinary bug or feature"
gh label create priority-high     --color d93f0b --description "Release-blocking"
gh label create priority-extreme  --color b60205 --description "Outage or security incident"
gh label create risk-low          --color 0e8a16 --description "Isolated, low blast radius"
gh label create risk-medium       --color fbca04 --description "Ordinary change with tests"
gh label create risk-high         --color b60205 --description "Wide blast radius, review deeply"
```

Four of those are load-bearing on a pull request rather than descriptive. `do-not-merge`, `blocked` and `qa-failed` block a merge on their own, and `needs-qa` blocks until `qa-approved` joins it; the `merge-gate` check reads them out of the event payload and fails the pull request, so applying one of them is the act that stops the merge — there is no second step, and removing it is what starts it again.

The four command labels that start a Cezar automation (`docs/agents/cezar-automations.json`). A
human sets three of them. `review-threads` is the exception: the `claude-review` job applies it
from `scripts/ci/review-threads-label.mjs`, once per head SHA, when the review leaves threads open.
Only a collaborator or an Actions token can set a label, which is what gates the `issue.labeled`
triggers; the skill that reacts removes its own label as its first mutation, so
a label still present means nobody picked the item up. No skill ever adds one.

`spec` is the exception to that last diagnosis. **Write a spec for feature issues** filters on `allLabels: ["feature"]`,
alone among the four, so on an issue that is not labelled `feature` the label sits there because no
run was ever going to start - not because one stalled, which is where the sentence above would
otherwise send you looking. The first three go on an issue, `review-threads` on a pull request:

```bash
gh label create groom          --color 5319e7 --description "Human trigger: re-run om-auto-manage-issues on this issue (Cezar automation)"
gh label create autofix        --color 5319e7 --description "Human trigger: start om-auto-fix-issue on this issue (Cezar automation)"
gh label create spec           --color 5319e7 --description "Human trigger: write a spec PR with om-auto-write-spec (Cezar automation)"
gh label create review-threads --color 5319e7 --description "Automated trigger: the review job left unresolved threads; starts om-auto-fix-pr (Cezar automation)"
```
