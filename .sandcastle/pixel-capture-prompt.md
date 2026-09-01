# TASK

Capture a blind A/B screenshot pair for issue {{TASK_ID}} — {{ISSUE_TITLE}}.

You are a neutral capture step. You do NOT judge quality and you do NOT edit application code. A
separate blind critic will look at the directory you produce and nothing else.

Ours: the local dev server, `http://localhost:3010` (already running and seeded — the
validation ladder started it; if it does not answer, run
`bash .sandcastle/setup-e2e.sh --if-needed` first).
Reference: the public demo `https://demo.moneymatter.app` (sample data, reset hourly —
read-only exhibit, do not try to mutate anything there).

## The clean-room rule, and it is not negotiable

Read `docs/agents/reference.md` before you start. It carries the surface map — which of our screens
pairs with which of theirs — and this rule in full:

**Compare rendered pixels only.** Never open the reference's DOM, never view its source, never read
its network responses, never copy a string, a table name, an enum value, a URL or a number out of
it, and never name the reference product in a filename, a commit, an issue comment or any other
artefact this loop writes. You are photographing a shop window, not reading their books. If the
demo is unavailable or has changed shape, that is a `skippedReason`, not a reason to dig.

## Which screen to photograph

Read the issue (`gh issue view {{TASK_ID}}`) to learn which screen or flow it changed, then look up
its pair in `docs/agents/reference.md` and photograph both. If the reference has no equivalent
screen, set `captured` to `false` with a `skippedReason` — a pair of unrelated screens is worse than
no pair.

## Our side — run the script, do not reinvent the procedure

    mkdir -p {{SHOTS_DIR}}
    node scripts/visual/capture.mjs \
      --url http://localhost:3010/<path> \
      --out {{SHOTS_DIR}} \
      --label {{OURS_LABEL}} \
      --viewports 1440x900,360x800 \
      --themes light,dark \
      --auth

Add `--settle <ms>` when the screen finishes with an animated chart, and `--state <selector>`,
`--hover <selector>` or `--click <selector>` when the issue is about a state that only appears after
an interaction. The script owns the viewport, the theme, animation suppression, the network-idle
wait, the filename and the flat-frame check. Do not work around it. It prints one JSON object:
report `console.fatal` entries as `consoleErrors`, report every `warnings` entry in `skippedReason`
— a warned frame is suspect and the critic should not be handed it as evidence. If `--auth` fails
because `e2e/.auth/demo.json` is missing, refresh it:
`PLAYWRIGHT_BASE_URL=http://localhost:3010 pnpm exec playwright test --project=setup`.

Keep `--auth` on every screen. For the few that only a signed-out visitor ever sees the script
refuses it outright (exit 2, no frame) and names the fix in its message — do what it says for that
URL and nothing else. Then check each file's `landedUrl` against the URL you asked for: when they
differ the frame is of another screen, so say so in `skippedReason` unless the redirect is one you
expected.

## The reference side

Photograph the reference with the same script — it is generic Playwright underneath:

    node scripts/visual/capture.mjs \
      --url https://demo.moneymatter.app/<path> \
      --out {{SHOTS_DIR}} \
      --label {{REF_LABEL}} \
      --viewports 1440x900,360x800 \
      --themes light,dark

No `--auth` and no `--state` — those flags encode OUR app's seams. The script switches theme via
`prefers-color-scheme`; if the reference does not react to it (its dark frames come out identical
to light), delete the fake dark frames, keep light only, and say so in `skippedReason`. Never
compare our dark against their light as a pair — a pair exists only when BOTH sides have a frame
for that viewport+theme.

## The directory is the critic's whole world

Write NOTHING else into {{SHOTS_DIR}}: no mapping file, no notes, no README, and never the words
"ours", "reference", "demo" or the reference product's name in a filename or in any file there.
The frames are `<viewport>-<theme>-{{OURS_LABEL}}.png` versus `<viewport>-<theme>-{{REF_LABEL}}.png`
and the critic must not be able to tell which product is which.

# OUTPUT

When done, output exactly one block:

<capture>{"captured": true, "pairs": [{"viewport": "1440", "theme": "light"}], "consoleErrors": [], "skippedReason": ""}</capture>

- `captured`: false when no valid pair exists (then say why in `skippedReason`).
- `pairs`: one entry per viewport+theme combination where BOTH frames were filed.
- Valid JSON, double quotes, no trailing commas.
