#!/usr/bin/env bash
# SessionStart hook (matcher "startup|resume": a resumed session may be on a fresh VM): in a Claude cloud session, install dependencies
# frozen to package-lock.json. Locally it does nothing — you run `npm ci` yourself.
#
# Why here and not in the environment's setup script: @brightbar-dev/review-nudge comes
# from GitHub Packages, and the read:packages credential is attached by the cloud
# environment's agent proxy, which only starts after the setup script has run. No token
# lives in this repo, in .npmrc or in an environment variable.
#
# `npm ci` installs exactly what the lockfile records (versions and integrity hashes) and
# fails rather than resolve anything new; `.npmrc` sends only the @brightbar-dev scope to
# npm.pkg.github.com. Failure never blocks the session: the tail is printed so Claude sees it.
[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if out=$(npm ci --no-audit --no-fund 2>&1 && npx wxt prepare 2>&1); then
  echo "cloud-install: npm ci (frozen to package-lock.json) + wxt prepare OK"
else
  echo "cloud-install: FAILED — last lines:"; printf '%s\n' "$out" | tail -8
fi
exit 0
