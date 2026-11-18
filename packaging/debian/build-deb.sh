#!/usr/bin/env bash
# Builds ijmond360-portal_<version>_<arch>.deb from apps/portal/dist.
# Usage: packaging/debian/build-deb.sh <version> [outdir]
# The package bundles its own Node.js runtime so it only depends on base Debian 13 packages.
set -euo pipefail

VERSION="${1:?version, e.g. 1.0.0 or 1.1.0-test.5}"
OUT="${2:-build}"
NODE_VERSION="${NODE_VERSION:-24.11.0}"
ARCH="${ARCH:-amd64}"
PKG=ijmond360-portal

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/apps/portal/dist"
[[ -f "$DIST/server.mjs" ]] || { echo "Build the portal first (pnpm --filter @portal/app build)" >&2; exit 1; }

case "$ARCH" in amd64) NODE_ARCH=x64 ;; arm64) NODE_ARCH=arm64 ;; *) echo "unsupported arch $ARCH" >&2; exit 1 ;; esac
DEB_VERSION="${VERSION/-/\~}"   # 1.1.0-test.5 -> 1.1.0~test.5 (sorts before 1.1.0)
STAGE="$(mktemp -d)"
chmod 0755 "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

# Node.js runtime (cached, checksum verified).
CACHE="$ROOT/build/.cache"
mkdir -p "$CACHE"
NODE_TGZ="$CACHE/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
if [[ ! -f "$NODE_TGZ" ]]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz" -o "$NODE_TGZ.tmp"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz\$" | sed "s#node-v.*#$NODE_TGZ.tmp#" | sha256sum -c -
  mv "$NODE_TGZ.tmp" "$NODE_TGZ"
fi

LIB="$STAGE/usr/lib/$PKG"
DOC="$STAGE/usr/share/doc/$PKG"
mkdir -p "$LIB" "$STAGE/DEBIAN" "$STAGE/lib/systemd/system" "$DOC" "$STAGE/etc/sudoers.d"
tar -xJf "$NODE_TGZ" -C "$STAGE" --strip-components=2 "node-v$NODE_VERSION-linux-$NODE_ARCH/bin/node"
mv "$STAGE/node" "$LIB/node"
chmod 0755 "$LIB/node"
cp "$DIST/server.mjs" "$LIB/server.mjs"
cp -r "$DIST/web" "$LIB/web"
echo "$VERSION" > "$LIB/VERSION"
cp "$ROOT/branding/$(tr -d '[:space:]' < "$ROOT/branding/active-brand")/BRAND.md" "$DOC/BRAND.md"
cp "$ROOT/LICENSE" "$DOC/LICENSE"
cat > "$DOC/copyright" <<COPYRIGHT
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: IJmond 360 Portal

Files: *
Copyright: 2026 Reinder Halewijn. All rights reserved.
License: LicenseRef-Proprietary
 See /usr/share/doc/$PKG/LICENSE.

Files: usr/lib/$PKG/node
Copyright: Node.js contributors
License: MIT
 See https://github.com/nodejs/node/blob/main/LICENSE
COPYRIGHT

install -m 0755 "$ROOT/packaging/debian/apply-update" "$LIB/apply-update"
cp "$ROOT/packaging/debian/$PKG.service" "$STAGE/lib/systemd/system/$PKG.service"
cat > "$STAGE/etc/sudoers.d/$PKG" <<SUDO
# Allows the $PKG service to install a downloaded update package (validated by apply-update).
portal ALL=(root) NOPASSWD: /usr/lib/$PKG/apply-update /var/lib/$PKG/updates/*.deb
SUDO
chmod 0440 "$STAGE/etc/sudoers.d/$PKG"
for s in postinst prerm postrm; do install -m 0755 "$ROOT/packaging/debian/$s" "$STAGE/DEBIAN/$s"; done
echo "/etc/sudoers.d/$PKG" > "$STAGE/DEBIAN/conffiles"

SIZE_KB=$(du -sk "$STAGE" | cut -f1)
cat > "$STAGE/DEBIAN/control" <<CONTROL
Package: $PKG
Version: $DEB_VERSION
Architecture: $ARCH
Maintainer: IJmond 360 <noreply@users.noreply.github.com>
Installed-Size: $SIZE_KB
Depends: adduser, sudo, systemd, ca-certificates, openssh-client, smbclient
Section: web
Priority: optional
Homepage: https://github.com/rhisijmuiden/ijmond360-portal
Description: IJmond 360 Portal - employee start page
 All internal apps of IJmond 360 behind Microsoft sign-in, with mail and calendar
 from Microsoft 365. Web interface on port 8080 (PORTAL_PORT in /etc/$PKG/env).
CONTROL

mkdir -p "$OUT"
# GitHub release assets cannot contain "~", so the file name uses "." (the package version inside keeps "~").
FILE="$OUT/${PKG}_${VERSION//[-~]/.}_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$STAGE" "$FILE" >/dev/null
echo "$FILE"
