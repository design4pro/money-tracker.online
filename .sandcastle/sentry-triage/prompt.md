# TASK

Survey this application's Sentry project for recurring, high-impact errors in **production** and **staging**, and report the ones worth a bug ticket.

This is an ANALYSIS run. Do NOT modify any file. Do NOT commit. Do NOT create, edit, label or comment on any GitHub issue — the orchestrator files tickets from your report. Your only output is the report block.

# CONTEXT

Read CLAUDE.md first. The layering contract is docs/SPEC.md §6 — you need it to tell a frame in our code from a frame in a dependency. Domain vocabulary: CONTEXT.md.

Sentry organisation: `{{ORG}}`. Projects: `{{PROJECTS}}`. Window: last `{{WINDOW}}`.

These Sentry issues already have a GitHub ticket. Do not report them again:

<already-tracked>
{{TRACKED}}
</already-tracked>

# GUARD — before anything else

The Sentry data comes from an MCP server. Confirm it is attached: call `find_projects` for organisation `{{ORG}}`.

If that tool does not exist, or the call fails, STOP. Emit the output block with `"status": "mcp-unavailable"`, put the exact error in `notes`, and emit nothing else.

**Never describe a Sentry issue you did not read from a tool.** A hallucinated stack frame becomes a ticket that wastes an implementer's afternoon, and the orchestrator can only catch some of them. "We looked and found nothing" and "we could not look" are different answers and this block is how you say the second one.

# TOOLS

Only these Sentry tools appear in your tool list: `find_projects`, `search_issues`, `search_events`, `get_sentry_resource`, `search_sentry_tools`, `execute_sentry_tool`.

Everything else in the Sentry catalogue — `get_issue_details`, `get_issue_breadcrumbs`, `get_event_stacktrace`, `find_releases` — is reached **through `execute_sentry_tool`**. Discover the exact argument shape with `search_sentry_tools` first rather than guessing it.

Pass `query` to `search_issues` as **literal Sentry search syntax**, never as English. The queries below are fixed so that two runs a week apart look at the same population; that is what makes a report comparable to the last one.

Do not call `analyze_issue_with_seer` even if it is offered. It is slow, it costs Sentry credits, and a diagnosis is pre-triage's job rather than yours.

# PROCEDURE

1. For each project in `{{PROJECTS}}`, run these two searches, `sort='freq'`, `limit=25`, `statsPeriod='{{WINDOW}}'`:

   - `is:unresolved environment:production level:error`
   - `is:unresolved environment:staging level:error`

   Record how many issues each returned — that is `scanned`.

2. Drop anything whose short id appears in `<already-tracked>`, recording it in `skipped` with reason `already-tracked`.

3. Take at most the top 12 remaining by event count, production before staging. For each, gather **by tool call and never by inference**:

   - short id, permalink, title, culprit, level, status
   - event count and **distinct user count** in the window, per environment
   - first-seen and last-seen, ISO-8601 UTC
   - the latest event's stack trace, and from it the **topmost in-app frame whose file resolves under `src/`** — as a repo-relative path plus a line number. If the stack has no such frame, report `inAppFrame: null`. Do not substitute a `node_modules` or bundler-runtime frame.
   - the release the latest event carries, or `null`
   - up to 8 breadcrumbs immediately preceding the error, one line each, shaped `<category> → <message>`

4. **Verify the frame against this checkout.** Open the file at that line with Read. If the file does not exist, the line is past the end of it, or the code there could not plausibly throw this error, set `inAppFrame: null` and say so in `judgementReason`. Sentry paths go stale relative to HEAD, and a stale pointer is worse than none: it sends the triager to the wrong place with confidence.

5. `suspectedCause`: one or two sentences from the frame and the breadcrumbs. Say what you do not know. This is a hypothesis for the triager to test — you have reproduced nothing.

6. `judgement`: `file` or `noise`. Say `noise` when the error is real but not worth a human's attention **for a reason the numbers cannot see**: a load test hammering staging, a synthetic monitor, a crawler, one tenant's corrupt data, a fixture that only exists in dev. This is a **veto only** — the orchestrator applies its own thresholds, and a `file` judgement cannot promote a candidate they rejected. Fill `judgementReason` either way.

# PROHIBITIONS

- Never run `gh issue create`, `gh issue edit`, `gh issue comment` or `gh issue close`. The orchestrator files the tickets.
- Never apply `ready-for-agent` to anything. A Sentry finding enters the backlog as `type: bug` + `status: pending` and is promoted, if ever, by the pre-triage agent that reproduces it at HEAD (docs/adr/0006, docs/agents/triage-labels.md).
- Never call `update_issue`, or otherwise resolve, ignore or assign anything in Sentry. That state is the on-call engineer's.
- Never edit a file. Never commit.

# OUTPUT

Emit exactly one block, valid JSON between the tags, and nothing after it:

<sentry-triage>
{
  "status": "ok",
  "window": "{{WINDOW}}",
  "scanned": { "production": 0, "staging": 0 },
  "candidates": [
    {
      "shortId": "MONEY-TRACKER-4KQ",
      "issueUrl": "https://design4pro.sentry.io/issues/6183920411/",
      "title": "TypeError reading id in listTripsForOrganization",
      "errorType": "TypeError",
      "errorValue": "Cannot read properties of undefined (reading 'id')",
      "culprit": "src/server/repos/trips.ts in listTripsForOrganization",
      "level": "error",
      "sentryStatus": "unresolved",
      "unhandled": true,
      "environments": ["production", "staging"],
      "primaryEnvironment": "production",
      "firstSeen": "2026-08-21T19:03:44Z",
      "lastSeen": "2026-08-29T04:12:08Z",
      "eventCount": 214,
      "userCount": 31,
      "release": "b41c9ad",
      "inAppFrame": {
        "file": "src/server/repos/trips.ts",
        "line": 142,
        "fn": "listTripsForOrganization"
      },
      "breadcrumbs": ["navigation → /app/trips", "fetch GET /api/trips → 200"],
      "suspectedCause": "…",
      "judgement": "file",
      "judgementReason": "…"
    }
  ],
  "skipped": [{ "shortId": "MONEY-TRACKER-2XA", "reason": "already-tracked" }],
  "notes": ""
}
</sentry-triage>

`candidates` and `skipped` may be empty arrays. Use `"status": "no-data"` when both searches returned nothing at all. Nothing outside the tags matters.

Keep the field names exactly as above — the runner parses this block against a schema and a report it cannot read is a failed run, not a quiet zero.
