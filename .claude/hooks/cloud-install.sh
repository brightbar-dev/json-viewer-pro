#!/usr/bin/env bash
# SessionStart hook (matcher "startup|resume": a resumed session may be on a fresh VM): in a Claude cloud session, install dependencies
# frozen to pnpm-lock.yaml. Locally it does nothing — you run `pnpm install --frozen-lockfile` yourself.
#
# Why here and not in the environment's setup script: @brightbar-dev/review-nudge comes
# from GitHub Packages, and the read:packages credential is attached by the cloud
# environment's agent proxy, which only starts after the setup script has run. No token
# lives in this repo, in .npmrc or in an environment variable.
#
# `pnpm install --frozen-lockfile` installs exactly what the lockfile records (versions and
# integrity hashes) and fails rather than resolve anything new; `.npmrc` sends only the
# @brightbar-dev scope to npm.pkg.github.com. Failure never blocks the session: the tail is
# printed so Claude sees it.
[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# The cloud image's preinstalled pnpm (10.x when measured 2026-09-26) is not the version pinned in
# package.json "packageManager", and pnpm does not switch itself: install the pinned one. The version
# is read from package.json so there is one pin, not two.
want=$(node -p "(require('./package.json').packageManager || '').split('@')[1] || ''" 2>/dev/null)
if [ -n "$want" ] && [ "$(pnpm --version 2>/dev/null)" != "$want" ]; then npm install -g "pnpm@$want" >/dev/null 2>&1; fi
if out=$(pnpm install --frozen-lockfile 2>&1 && pnpm exec wxt prepare 2>&1); then
  echo "cloud-install: pnpm install --frozen-lockfile (frozen to pnpm-lock.yaml) + wxt prepare OK"
else
  echo "cloud-install: FAILED — last lines:"; printf '%s\n' "$out" | tail -8
fi
exit 0
