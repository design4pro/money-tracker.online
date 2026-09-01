# TASK

Survey this repository for codebase-architecture improvement candidates — places where modules should be **deepened** (small interface, more functionality behind it, one test boundary around it) or where a shallow-module sprawl makes the code hard to test and hard for agents to navigate.

This is an ANALYSIS run. Do NOT modify any file. Do NOT commit. Your only output is the report.

# CONTEXT

Read CLAUDE.md first. The layering contract is docs/SPEC.md §6. Domain vocabulary: CONTEXT.md.

Design language — use these terms exactly: @.sandcastle/DESIGN_VOCABULARY.md

Decisions already taken live in `docs/adr/`. Read the ADRs covering any area you propose to change.

Recent hot spots (change frequency is a signal of leverage):

<recent-commits>

!`git log -n 40 --oneline --no-merges`

</recent-commits>

# METHOD

1. Scope by YAGNI: prefer candidates in code that changes often or is known-heavy. Known large route-level files worth inspecting: the dashboard screen and its chart cluster, the transactions table and its filter bar, the import mapping wizard, billing settings.
2. For each candidate, judge depth as **leverage**: how much complexity would callers stop paying if the interface were narrowed? A pass-through wrapper is not a candidate; a cluster of files that must be tested together is.
3. Consider testability first: where would ONE test boundary replace many small ones? The interface is the test surface.
4. Check each candidate against `docs/adr/`. If it contradicts an accepted ADR, surface it ONLY when the friction is real enough to warrant reopening that decision, and say so in the `Conflicts` field ("contradicts ADR-0002 — but worth reopening because…"). Do not list every refactor an ADR forbids; a candidate that merely re-proposes something an ADR already rejected is not a candidate.
5. 3 to 6 candidates. Fewer, well-argued, beats a laundry list.

# OUTPUT

Output the report between <report> tags, as markdown:

<report>
## Candidate N: <name>

- **Files**: <the cluster>
- **Problem**: <why this is shallow / hard to test today>
- **Proposed interface**: <the narrow seam, in one or two sentences — no code>
- **Benefits**: <what gets cheaper: tests, agent navigation, future changes>
- **Conflicts**: <"none", or the ADR this contradicts and why it is worth reopening>
- **Recommendation**: Strong | Worth exploring | Speculative

(…repeat per candidate…)

## Top recommendation

<one paragraph: which candidate first, and why>
</report>

Nothing outside the tags matters. Do not edit files. Do not commit.

Keep the `## Candidate N: <name>` heading and the `- **Recommendation**: <strength>` line
in exactly that shape — the runner parses them to decide which candidates may be filed
for triage, and a candidate it cannot parse is silently dropped.
