#!/usr/bin/env bash
# cws-publish.sh - upload the built Chrome zip to this extension's Chrome Web Store item and,
# unless CWS_AUTO_PUBLISH=false, submit it for review.
#
# Uses the Chrome Web Store API v2. The v1.1 API this replaces stops being supported on
# 2026-10-15 (https://developer.chrome.com/docs/webstore/api/v1). v2 cannot create items or change
# their visibility; both stay in the Developer Dashboard.
#
# Called by .github/workflows/release.yml. tests/cws-publish.test.mjs runs it against a stub curl,
# because nothing else exercises the release path until a release is actually cut.
#
# Env
#   CWS_SA_KEY              service-account JSON (org Actions secret). When set, the token is
#                           minted as cws-publisher@kendoclaw-cws.iam.gserviceaccount.com, Claw's
#                           own identity, registered on the publisher 2026-09-23
#                           (https://developer.chrome.com/docs/webstore/service-accounts)
#   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   the OAuth refresh token Ken minted
#                           (org Actions secrets); used only when CWS_SA_KEY is unset
#   CWS_PUBLISHER_ID, CWS_ITEM_ID                          the store item
#   CWS_AUTO_PUBLISH        "false": upload to the item's draft only, do not submit for review
#   CWS_ZIP                 the package (default: the single .output/*-chrome.zip)
#   CWS_CRX_KEY             the PEM private key this item's uploads are signed with (org Actions
#                           secret; vault:brightbar-cws-crx-signing-key#notes). The item is opted in
#                           to Verified CRX Uploads, so the store refuses an unsigned zip: the zip is
#                           packed into a CRX3 by scripts/crx3.mjs and the CRX is uploaded instead
#   CWS_CRX_PUBLIC_KEY      the public key registered in the dashboard (default
#                           store/cws-crx-public-key.pub). While that file exists the script refuses
#                           to run without CWS_CRX_KEY, and refuses a CRX this key did not sign
#   CWS_BUILD_ONLY          "true": build and verify the package, then stop. No network, no credential
#                           beyond CWS_CRX_KEY. The dry run of the signed path
#   CWS_POLL_SECONDS        wait between upload-status polls (default 5)
#   CWS_POLL_MAX            upload-status polls before giving up (default 24)
#   CWS_API_BASE, CWS_TOKEN_URL   test seams; the defaults are Google's
set -euo pipefail

api_base="${CWS_API_BASE:-https://chromewebstore.googleapis.com}"
token_url="${CWS_TOKEN_URL:-https://oauth2.googleapis.com/token}"
item="publishers/${CWS_PUBLISHER_ID:?CWS_PUBLISHER_ID is required}/items/${CWS_ITEM_ID:?CWS_ITEM_ID is required}"

fail() { echo "cws-publish: $*" >&2; exit 1; }

# The API's own message when the body is a Google error, else the first 300 characters of the body.
describe() {
  local msg
  msg=$(jq -r '.error.message // empty' <<<"$1" 2>/dev/null || true)
  [ -n "$msg" ] || msg=$(printf '%s' "$1" | head -c 300)
  printf '%s' "$msg"
}

# call <curl args>: sets BODY and CODE. -w appends the status code on a line of its own.
call() {
  local out
  out=$(curl -sS -w $'\n%{http_code}' "$@") || fail "curl failed"
  CODE=${out##*$'\n'}
  BODY=${out%$'\n'*}
}

# 1. The package: the release zip, signed into a CRX when the item is opted in to Verified CRX
#    Uploads. Built and checked before any credential is used, so a signing problem costs nothing.
zip="${CWS_ZIP:-}"
if [ -z "$zip" ]; then
  shopt -s nullglob
  zips=(.output/*-chrome.zip)
  [ "${#zips[@]}" -eq 1 ] || fail "expected exactly one .output/*-chrome.zip, found ${#zips[@]}"
  zip=${zips[0]}
fi
[ -f "$zip" ] || fail "no such package: $zip"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pubkey="${CWS_CRX_PUBLIC_KEY:-store/cws-crx-public-key.pub}"
package=$zip
upload_headers=()
if [ -n "${CWS_CRX_KEY:-}" ]; then
  crx="${zip%.zip}.crx"
  crxkey=$(mktemp)
  chmod 600 "$crxkey"
  printf '%s\n' "$CWS_CRX_KEY" >"$crxkey"
  packed=$(node "$here/crx3.mjs" pack "$zip" "$crxkey" "$crx" 2>&1) || packed="FAILED: $packed"
  rm -f "$crxkey"
  case "$packed" in FAILED:*) fail "could not sign the package: ${packed#FAILED: }" ;; esac
  if [ -f "$pubkey" ]; then
    verified=$(node "$here/crx3.mjs" verify "$crx" "$pubkey" 2>&1) \
      || fail "the CRX is not signed by the registered key $pubkey: $verified"
  else
    verified=$(node "$here/crx3.mjs" verify "$crx" 2>&1) || fail "the CRX does not verify: $verified"
  fi
  echo "Signed: $crx $(jq -c '{crxId, signerSpkiSha256, expectedKeyMatched}' <<<"$verified")"
  package=$crx
  upload_headers=(-H 'X-Goog-Upload-Protocol: raw' -H "X-Goog-Upload-File-Name: $(basename "$crx")")
elif [ -f "$pubkey" ]; then
  fail "CWS_CRX_KEY is not set, but $pubkey says this item takes only signed uploads; the store would refuse the zip"
fi

if [ "${CWS_BUILD_ONLY:-}" = true ]; then
  echo "CWS_BUILD_ONLY=true: built $package, uploaded nothing."
  exit 0
fi

# 2. An access token: the service account when CWS_SA_KEY is set, else the refresh token. Only
#    the error fields are ever printed. No fallback between them: a refused service account fails
#    the release loudly rather than quietly publishing as Ken.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
if [ -n "${CWS_SA_KEY:-}" ]; then
  email=$(jq -r '.client_email // empty' <<<"$CWS_SA_KEY" 2>/dev/null || true)
  [ -n "$email" ] || fail "CWS_SA_KEY is not a service-account JSON key"
  now=$(date +%s)
  jwt_head=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
  jwt_claims=$(jq -nc --arg e "$email" --arg a "$token_url" --argjson n "$now" \
    '{iss:$e, scope:"https://www.googleapis.com/auth/chromewebstore", aud:$a, iat:$n, exp:($n+3600)}' | b64url)
  keyfile=$(mktemp)
  chmod 600 "$keyfile"
  jq -r .private_key <<<"$CWS_SA_KEY" >"$keyfile"
  jwt_sig=$(printf '%s.%s' "$jwt_head" "$jwt_claims" | openssl dgst -sha256 -sign "$keyfile" | b64url) || jwt_sig=""
  rm -f "$keyfile"
  [ -n "$jwt_sig" ] || fail "could not sign the service-account assertion"
  call -X POST "$token_url" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=$jwt_head.$jwt_claims.$jwt_sig"
  via="service account $email"
else
  call -X POST "$token_url" \
    -d "client_id=${CWS_CLIENT_ID:?CWS_CLIENT_ID is required (or set CWS_SA_KEY)}" \
    -d "client_secret=${CWS_CLIENT_SECRET:?CWS_CLIENT_SECRET is required}" \
    -d "refresh_token=${CWS_REFRESH_TOKEN:?CWS_REFRESH_TOKEN is required}" \
    -d "grant_type=refresh_token"
  via="refresh token"
fi
token=$(jq -r '.access_token // empty' <<<"$BODY" 2>/dev/null || true)
if [ "$CODE" != 200 ] || [ -z "$token" ]; then
  fail "no access token (HTTP $CODE, via $via): $(jq -c '{error, error_description}' <<<"$BODY" 2>/dev/null || echo unparseable)"
fi
echo "Auth: $via"
auth=(-H "Authorization: Bearer $token")

# 3. Upload it to the item's draft.
call -X POST "$api_base/upload/v2/$item:upload" "${auth[@]}" ${upload_headers[@]+"${upload_headers[@]}"} -T "$package"
[ "$CODE" = 200 ] || fail "upload rejected (HTTP $CODE): $(describe "$BODY")"
state=$(jq -r '.uploadState // "MISSING"' <<<"$BODY")
version=$(jq -r '.crxVersion // "unknown"' <<<"$BODY")

# A large package is processed asynchronously; fetchStatus reports how that ended.
polls=0
while [ "$state" = IN_PROGRESS ] || [ "$state" = UPLOAD_IN_PROGRESS ]; do
  polls=$((polls + 1))
  [ "$polls" -le "${CWS_POLL_MAX:-24}" ] || fail "upload still in progress after $((polls - 1)) polls"
  sleep "${CWS_POLL_SECONDS:-5}"
  call "$api_base/v2/$item:fetchStatus" "${auth[@]}"
  [ "$CODE" = 200 ] || fail "fetchStatus failed (HTTP $CODE): $(describe "$BODY")"
  state=$(jq -r '.lastAsyncUploadState // "MISSING"' <<<"$BODY")
done
[ "$state" = SUCCEEDED ] || fail "upload did not succeed: $state (crxVersion $version)"
echo "Upload: $state (crxVersion $version)"

if [ "${CWS_AUTO_PUBLISH:-}" = false ]; then
  echo "CWS_AUTO_PUBLISH=false: package uploaded to the item draft, NOT submitted for review."
  echo "Submit it later from the dashboard or with the CWS API publish call (brightbar-dev/org-work RUNBOOK.md)."
  exit 0
fi

# 4. Submit for review. DEFAULT_PUBLISH publishes once the review passes, as v1.1 always did.
call -X POST "$api_base/v2/$item:publish" "${auth[@]}" \
  -H 'Content-Type: application/json' -d '{"publishType":"DEFAULT_PUBLISH"}'
[ "$CODE" = 200 ] || fail "publish rejected (HTTP $CODE): $(describe "$BODY")"
pstate=$(jq -r '.state // "MISSING"' <<<"$BODY")
case "$pstate" in
  PENDING_REVIEW | STAGED | PUBLISHED | PUBLISHED_TO_TESTERS) ;;
  *) fail "publish not accepted: state $pstate (crxVersion $version)" ;;
esac
echo "Publish: $pstate (crxVersion $version)"
jq -r '(.warningInfo.warnings // [])[] | "warning: " + tostring' <<<"$BODY" 2>/dev/null || true

# 5. Read the submission back. Informational; the accepted publish above is what decides success.
call "$api_base/v2/$item:fetchStatus" "${auth[@]}"
if [ "$CODE" = 200 ]; then
  echo "Status: $(jq -c '{submitted: .submittedItemRevisionStatus, published: .publishedItemRevisionStatus}' <<<"$BODY")"
fi
