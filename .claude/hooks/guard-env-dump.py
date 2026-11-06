#!/usr/bin/env python3
"""PreToolUse(Bash) guard: refuse environment dumps.

`printenv` and a bare `env` print every variable, including secrets in the
agent environment. An absolute or relative path whose basename is `printenv`
or `env` is the same command as the bare word. Matching is in command
position only, so `ls config/env` is not a dump.

Named non-secret `printenv NAME` stays allowed. `env VAR=value cmd`,
`env -i …`, and `env bash -c …` stay allowed. `env -0` still dumps.

Its own errors never block a tool call.
"""
import json
import re
import sys

HINT = "The environment holds secrets. Read a named non-secret variable with `printenv NAME`."
SEPARATORS = re.compile(r"[;&|()`\n]")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=\S+$")
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SECRET_HINT = re.compile(
    r"TOKEN|SECRET|KEY|PASS|AUTH|CREDENTIAL|COOKIE|SESSION|PRIVATE|DSN",
    re.IGNORECASE,
)
KEYWORDS = frozenset({
    "if", "then", "else", "elif", "do", "while", "until", "time", "!", "{",
})


def deny(label):
    reason = "Blocked by guard-env-dump: '%s'. %s" % (label, HINT)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))


def unquote(token):
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "'\"":
        return token[1:-1]
    return token


def basename(head):
    return head.rsplit("/", 1)[-1]


def secret_looking(name):
    # AUTHOR is a name (GIT_AUTHOR_NAME); AUTHORIZATION still carries AUTH.
    cleaned = re.sub(r"AUTHOR([^I]|$)", r"\1", name.upper())
    return bool(SECRET_HINT.search(cleaned))


def head_and_args(piece):
    words = piece.split()
    i = 0
    while i < len(words):
        word = unquote(words[i])
        if word in KEYWORDS or ASSIGNMENT.match(word):
            i += 1
            continue
        break
    if i >= len(words):
        return None, []
    head = basename(unquote(words[i]))
    args = [unquote(w) for w in words[i + 1:]]
    return head, args


def judge(command):
    for piece in SEPARATORS.split(command):
        head, args = head_and_args(piece)
        if head == "printenv":
            if not args:
                return "printenv"
            for arg in args:
                if not IDENT.match(arg):
                    return "printenv"
                if secret_looking(arg):
                    return "printenv of a secret-looking name"
        elif head == "env":
            if not args or args[0].startswith("-0"):
                return "env dump"
    return None


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if (payload.get("tool_name") or "") != "Bash":
            return
        command = (payload.get("tool_input") or {}).get("command") or ""
        label = judge(command)
        if label:
            deny(label)
    except Exception:
        pass  # fail open rather than block every call in the project


if __name__ == "__main__":
    main()
