/**
 * Adopting the branches a dead run left behind.
 *
 * A `wip:` record outlives the lease that produced it (see `sandcastle-protocol.ts`): when a run
 * crashes its issues must become claimable again, but its commits are still on disk. So a claim can
 * come back with `adopt: {"106": "sandcastle/issue-106-20260829-1"}` - three commits of real work,
 * orphaned, and about to be re-implemented from nothing by whoever takes the ticket next.
 *
 * The catch is the one `main.ts`'s own header warns about: every run cuts its integration branch
 * from its own `origin/develop` snapshot, so another run's branch is based somewhere this one has
 * never been, and merging it can "drag another run's differently-based history into this run's
 * merge." Hence the rule, and it is not negotiable: adopt only when the orphan fast-forwards from
 * this run's integration tip or merges onto it cleanly. Otherwise start the slice fresh and say
 * why. Nothing here forces, resets or rewrites a ref - the worst outcome of a refusal is work done
 * twice, and the worst outcome of forcing is a corrupted integration branch.
 *
 * Git runs through an injected port so the decisions above are testable without a repository, and
 * that port takes an argv array rather than a command line: `from` is a string another token holder
 * wrote into the registry, and it must never reach a shell.
 */

/** One git invocation. `ok` is "exit code 0", which is the whole answer for the plumbing used here. */
export interface GitOutput {
  ok: boolean
  stdout: string
}

export type GitRunner = (args: Array<string>) => GitOutput

export type Adoption =
  | {
      issueId: string
      branch: string
      from: string
      adopted: true
      /** Commits the orphan carries that this run's integration branch does not. */
      commits: Array<{ sha: string }>
    }
  | {
      issueId: string
      branch: string
      from: string
      adopted: false
      reason: string
    }

export interface AdoptionRequest {
  issueId: string
  /** The branch this run would use for the issue, `sandcastle/issue-<id>-<runId>`. */
  branch: string
  /** The orphaned branch the registry offered. */
  from: string
  /** This run's integration branch - what the adopted work will eventually be merged into. */
  base: string
}

function revParse(git: GitRunner, ref: string): string | undefined {
  const result = git(['rev-parse', '--verify', '--quiet', ref])
  return result.ok && result.stdout !== '' ? result.stdout : undefined
}

/**
 * Adopts one orphaned branch, or explains in one sentence why it was left alone.
 *
 * The refusals are as much of the point as the adoption: each one is a line in the run log saying
 * which slice is being redone from scratch and on whose authority.
 */
export function adoptWipBranch(
  git: GitRunner,
  { issueId, branch, from, base }: AdoptionRequest,
): Adoption {
  const refuse = (reason: string): Adoption => ({
    issueId,
    branch,
    from,
    adopted: false,
    reason,
  })

  // A resumed run (`--run N`) already has its own branch for this issue, carrying its own history.
  // Repointing it at someone else's tip would discard that; adoption is for empty ground only.
  if (revParse(git, `refs/heads/${branch}`) !== undefined) {
    return refuse(`${branch} already exists in this clone`)
  }

  const tip =
    revParse(git, `refs/heads/${from}`) ??
    revParse(git, `refs/remotes/origin/${from}`)
  if (tip === undefined) {
    return refuse(
      `${from} is not in this clone - the run that made it was on another machine and never pushed it`,
    )
  }

  const baseTip = revParse(git, base)
  if (baseTip === undefined) return refuse(`${base} does not resolve`)

  const commits = git(['rev-list', `${baseTip}..${tip}`])
  if (!commits.ok) return refuse(`could not read ${from}'s history`)
  const shas = commits.stdout.split('\n').filter((line) => line !== '')
  if (shas.length === 0) {
    return refuse(`${from} carries nothing this run does not already have`)
  }

  // Two ways to be safe, cheapest first: either the orphan already contains this run's integration
  // tip (a fast-forward, no merge to go wrong), or a three-way merge of the two produces no
  // conflict. `merge-tree --write-tree` answers that against the object store alone - no checkout,
  // no index, nothing to clean up if the answer is no.
  const fastForward = git(['merge-base', '--is-ancestor', baseTip, tip]).ok
  if (!fastForward && !git(['merge-tree', '--write-tree', baseTip, tip]).ok) {
    return refuse(
      `${from} does not merge cleanly onto ${base} - it is cut from a different \`origin/develop\` snapshot`,
    )
  }

  const created = git(['branch', branch, tip])
  if (!created.ok)
    return refuse(`could not create ${branch} at ${tip.slice(0, 8)}`)

  return {
    issueId,
    branch,
    from,
    adopted: true,
    commits: shas.map((sha) => ({ sha })),
  }
}

/**
 * Adoption for a whole iteration's worth of issues.
 *
 * Only issues the planner actually chose are considered: an orphan for a ticket this run is not
 * about to work on is not this run's business, and creating its branch would be a side effect
 * nobody asked for.
 */
export function adoptWipBranches(
  git: GitRunner,
  issues: Array<{ id: string; branch: string }>,
  adopt: Record<string, string>,
  base: string,
): Array<Adoption> {
  return issues
    .filter((issue) => adopt[issue.id] !== undefined)
    .map((issue) =>
      adoptWipBranch(git, {
        issueId: issue.id,
        branch: issue.branch,
        from: adopt[issue.id]!,
        base,
      }),
    )
}
