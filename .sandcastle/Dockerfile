# Sandbox image for the sandcastle loop.
#
# Based on the SAME Playwright image the CI e2e gate runs in
# (.github/workflows/ci.yml → mcr.microsoft.com/playwright:v1.62.1-noble).
# That identity is the point: font rasterisation differs between distros, so
# visual specs run in this container compare against the committed `-linux`
# baselines exactly as CI does. Keep the tag in lockstep with @playwright/test
# in package.json — bump both together.
#
# Ships: node 24 + all Playwright browsers (from the base image), git, curl,
# jq, gh, pnpm (corepack), and the Claude Code CLI. wrangler comes from the
# repo's devDependencies (`pnpm exec wrangler`) after the install hook runs —
# it is deliberately not baked in globally, so the version is always the
# repo-pinned one.

FROM mcr.microsoft.com/playwright:v1.62.1-noble

# System dependencies beyond what the Playwright image carries
RUN apt-get update && apt-get install -y \
  jq \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI (the issue tracker lives on GitHub)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# pnpm (this repo's package manager); prepare the pinned version at build time
# so first container start does not need the network for corepack.
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Create (or rename) the "agent" user at the host UID/GID. The noble base
# already has `ubuntu` (1000) and the Playwright image adds `pwuser`; whichever
# holds the target UID gets renamed, otherwise a fresh user is created.
RUN set -eux; \
  existing_group="$(getent group "$AGENT_GID" | cut -d: -f1 || true)"; \
  if [ -n "$existing_group" ]; then \
    groupmod -n agent "$existing_group"; \
  else \
    groupadd -o -g "$AGENT_GID" agent; \
  fi; \
  existing_user="$(getent passwd "$AGENT_UID" | cut -d: -f1 || true)"; \
  if [ -n "$existing_user" ]; then \
    usermod -l agent -g "$AGENT_GID" -d /home/agent -m "$existing_user"; \
  else \
    useradd -o -u "$AGENT_UID" -g "$AGENT_GID" -d /home/agent -m agent; \
  fi
USER ${AGENT_UID}:${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Corepack caches per user — prepare the pinned pnpm for the agent user too,
# so a fresh container does not need the network before its first pnpm call.
RUN corepack prepare pnpm@10.15.0 --activate

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree and
# overrides the working directory at container start.
ENTRYPOINT ["sleep", "infinity"]
