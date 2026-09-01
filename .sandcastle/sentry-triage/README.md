# sentry-triage

Why the three files beside this one are shaped the way they are.

## `mcp.json`

Copied to `<worktree>/.mcp.json` by a hook rather than committed at the repo root, because a root
`.mcp.json` would attach this server to every Claude session in the project - including the
implementer sandboxes and a developer's own terminal - and none of those has any business holding a
Sentry token. The root path is gitignored (`.gitignore:46`), which is what lets the copy land in a
throwaway worktree without leaving it dirty; an untracked file is what stops sandcastle removing a
worktree afterwards.

`${VAR}` is expanded by Claude Code, so no secret is written to disk.

Three details that are each load-bearing:

- **`--skills=inspect`** makes the whole server read-only. The CLI's default is every active skill,
  which includes `update_issue` and project mutation - a triage routine has no business resolving
  somebody's Sentry issue.
- **`--organization-slug`** constrains every call to our organization.
- **The version is pinned.** `@latest` in a scheduled job is an unpinned dependency in everything
  but name: the server's top-level tool surface has changed inside a minor before now, which would
  silently make `prompt.md` wrong on a Tuesday morning with nobody watching. Same discipline as the
  Playwright tag pin in `.sandcastle/Dockerfile`.

The token needs four read scopes and no more: `org:read`, `project:read`, `team:read`, `event:read`.

## Why the agent is given the data rather than the script fetching it

The agent reads Sentry; the script decides what to file. That split is the point: `policy.ts` holds
the thresholds, the dedup index and the ticket body, so a policy change is a reviewable diff and a
run is reproducible. The agent's own `judgement` field is ANDed with the gate, never ORed - it can
veto a candidate the numbers cannot see through ("a load test is hammering staging") and it cannot
promote one the gate rejected.

## `--force`, and the four things it does not do

`--force <SHORT-ID>` files a ticket the policy rejected. It exists because the thresholds are tuned
for production traffic and staging has one user: a defect that fires once there is invisible to
`minimumSpanMs` and to the event counts, and no amount of waiting will change that.

It overrides `selectionVerdict` and nothing else. The agent's veto, the frame-exists check, the
dedup index and both caps still apply. The split is not squeamishness - the thresholds are the only
_judgement_ in that list, and naming a ticket is how a human makes that judgement instead. The rest
answer questions of fact that naming a ticket does not settle: whether this is a duplicate, whether
the file the agent pointed at exists at HEAD. A human who wants past those is asking for a ticket
that is wrong, not for one that is small.

Two consequences worth knowing:

- **It reaches only into the population the two fixed searches returned.** A short id outside
  `--window`, resolved in Sentry, or below error level is not forceable; the run says so and exits
  non-zero rather than filing nothing quietly.
- **A forced candidate sorts first.** It is small by definition, so `filingOrder` would otherwise
  put it last and `--max` would spend itself before reaching it.

The ticket records the override: a `Policy: FORCED - <reason>` line and a footer naming the flag.
`triage.yml` reproduces the claim at HEAD and decides whether to promote it (ADR 0006), and it has
to know the thresholds were bypassed - a single burst presented as a recurring defect puts that
decision on a false premise.

Without `--file-issues`, `--force` prints the gate's verdict and the ticket it would file, and
writes nothing.

## Why the workflow runs this script rather than `claude-code-action`

`.github/workflows/triage.yml` can use the action because its prompt _is_ the whole routine. Here it
is not: the dedup, the caps and the body live in `policy.ts`. Driving a second copy of that policy
through `claude_args` would give it two owners, which is what `docs/SPEC.md` §8 forbids.
