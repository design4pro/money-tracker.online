# Working a checkout somebody else is working

**What this is.** The protocol for when more than one agent has this repository open at once. It is
not about etiquette; every rule here exists because a specific measurement in this repository was
silently wrong and cost a full end-to-end run to discover.

**One dev server serves the whole checkout.** `pnpm dev` binds 3010 with `strictPort`, and a
`playwright` run attaches to it rather than starting its own (`reuseExistingServer` is on outside
CI). Saving any file under `src/` hot-reloads the running application - including the copy a browser
is driving at that moment. Nobody has to be doing anything wrong for this to break: an edit and a
suite are both correct in isolation.

## The editor announces; the measurer cannot ask

**Whoever writes to the tree announces it. Whoever measures is not expected to check.** The
obligation sits on the editor because only the editor has the information: a file save is invisible
to the process being disrupted, while the person saving knows perfectly well that a run is in
flight. Reversing it - "ask before you measure" - puts the duty on the party who cannot discharge
it, and a rule that cannot be followed is not a rule.

In practice: say so before you start editing if a run is going, and say so when you finish. A run
takes minutes and a suite that has to be thrown away costs more than the wait.

## Recognising it after the fact

The signature is **broad, cross-file redness in tests that were green minutes earlier**, made of
timeouts and missing elements rather than failed assertions. Before recording any run whose shape
surprises you:

```
git status --porcelain
```

A tree with modifications that were not there when the run started means the run photographed a
moving target. Its numbers are not about the commit and must not be reported as if they were.

## Stage paths, never everything

`git add -A` and `git commit -a` are unsafe here for the same reason a run on a moving tree is: they
take in things you did not know were there. On a shared checkout they will pick up another agent's
work in progress and carry it under your commit message and your authorship. This is not
hypothetical - it has happened, and it was caught by chance rather than by the command.

Name the paths, every time:

```
git add -- docs/agents/shared-checkout.md CLAUDE.md
git commit -m "..." -- docs/agents/shared-checkout.md CLAUDE.md
```

The message has to come **before** the `--`; everything after it is a pathspec, so
`git commit -- <paths> -m "..."` makes git look for a file named after your commit message and fail.
`git commit --only <paths>` needs those paths already tracked, so a new file has to be `git add`-ed
first. Read `git status --porcelain` immediately before committing and confirm that everything you
are about to include is yours.

## Check the route, not the root

A dev server can serve `/` and nothing else. This has happened here: `200` on `/`, `404` on every
route under `_app`. Playwright's `webServer.url` check asks only for the root, so such a server
passes the health check and the suite reports a full run against an application that was never
served. Probe a real route before trusting a run:

```
curl -o /dev/null -w '%{http_code}\n' http://localhost:3010/transactions/new
```

`307` is healthy - it is the sign-in redirect. `404` is a poisoned server; restart it.

## Timing-sensitive measurement needs a quiet machine

Test timeouts are claims about the machine until proven otherwise. Check `uptime` against
`sysctl -n hw.ncpu` before trusting any run that failed on time; this repository's unit suite takes
10-17 seconds normally and has been observed at 84 under load, with individual synchronous renders
exceeding the 5-second limit.

Two consequences worth knowing:

- **Starvation is one-way.** It turns passing tests red and never failing tests green, so passes
  measured under load stand and only failures need re-running.
- **The error text says which side a failure is on.** A resolved locator reporting a concrete
  computed state (`Received: hidden`) is about the code, because a slow machine computes the same
  style. A wait that expired (`element(s) not found`, `Received: ""` where an interaction should
  have set a value) may be about the machine. Both render as one `1 failed` line in a summary, so
  read the log, not the count.

Do not raise a timeout or pass `--no-verify` to get a commit through a hook that is failing this
way. That trades an environment fault for an unverified commit.
