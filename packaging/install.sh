#!/usr/bin/env bash
# IJmond 360 Portal installer for Debian 13.
#   curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/ijmond360-portal/production/packaging/install.sh | sudo bash
# Options: [--channel production|test] [--repo owner/name] [--token <GitHub token, for a private repository>]
#          [--file /path/to/ijmond360-portal_<version>_<arch>.deb]  install a package you already downloaded
set -euo pipefail
CHANNEL=production
REPO=rhisijmuiden/ijmond360-portal
TOKEN="${GITHUB_TOKEN:-}"
FILE=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
case "$CHANNEL" in production|test) ;; *) echo "--channel must be production or test" >&2; exit 1 ;; esac
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
. /etc/os-release
[[ "${VERSION_ID:-}" == "13" ]] || echo "warning: tested on Debian 13, this is $PRETTY_NAME" >&2
ARCH=$(dpkg --print-architecture)

apt-get update -qq
apt-get install -y -qq curl ca-certificates jq >/dev/null

if [[ -n "$FILE" ]]; then
  apt-get install -y "$(realpath "$FILE")"
  exit 0
fi

AUTH=()
[[ -n "$TOKEN" ]] && AUTH=(-H "Authorization: Bearer $TOKEN")
PAT="^ijmond360-portal_.*_$ARCH\\\\.deb$"
FILTER='.[] | select(.draft == false)'
[[ "$CHANNEL" == production ]] && FILTER="$FILTER | select(.prerelease == false)"
LIST=$(curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases?per_page=50")
REL=$(jq -c "[$FILTER | select(any(.assets[]; .name | test(\"$PAT\")))][0]" <<<"$LIST")
[[ -n "$REL" && "$REL" != null ]] || { echo "no $CHANNEL release found for $ARCH (private repository? pass --token)" >&2; exit 1; }
NAME=$(jq -r "[.assets[] | select(.name | test(\"$PAT\"))][0].name" <<<"$REL")
DEB_API=$(jq -r "[.assets[] | select(.name | test(\"$PAT\"))][0].url" <<<"$REL")
SUMS_API=$(jq -r '[.assets[] | select(.name == "SHA256SUMS")][0].url' <<<"$REL")

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
echo "Downloading $NAME ($(jq -r .tag_name <<<"$REL"))"
# The asset API URL works for public and private repositories.
curl -fsSL "${AUTH[@]}" -H "Accept: application/octet-stream" "$DEB_API" -o "$TMP/$NAME"
curl -fsSL "${AUTH[@]}" -H "Accept: application/octet-stream" "$SUMS_API" -o "$TMP/SHA256SUMS"
(cd "$TMP" && grep " $NAME\$" SHA256SUMS | sha256sum -c -)
chmod 0644 "$TMP/$NAME"; chmod 0755 "$TMP"
apt-get install -y "$TMP/$NAME"
echo "Open the portal, sign in as admin, then set up Microsoft sign-in under System > Single sign-on (see docs/install.md)."
