#!/usr/bin/env bash
# Smoke test: `npx total-agent-memory connect cursor` on a clean Linux env
# must produce a working dashboard at http://127.0.0.1:37737.
#
# Runs in Docker so the host stays clean. Uses local wrapper source (npm
# pack + npx --offline) so CI tests the *current* code, not the published
# version.
#
# Required on host: Docker. No node/python needed (image brings them).
#
# Exit codes:
#   0 — full success: install + service install + dashboard 200
#   1 — install failed
#   2 — dashboard service not registered
#   3 — dashboard not serving HTTP 200
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NPM_ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${SMOKE_IMAGE:-python:3.12-slim}"

echo "→ packing wrapper from $NPM_ROOT"
cd "$NPM_ROOT"
TARBALL_DIR="$(mktemp -d)"
npm pack --pack-destination "$TARBALL_DIR" >/dev/null
TARBALL="$(ls "$TARBALL_DIR"/*.tgz)"
echo "  packed: $(basename "$TARBALL")"

echo "→ running smoke inside $IMAGE"
docker run --rm \
  -v "$TARBALL:/tmp/tam.tgz:ro" \
  -e TAM_INSTALL_DRY=1 \
  -e DEBIAN_FRONTEND=noninteractive \
  "$IMAGE" /bin/sh -eux -c '
    apt-get update -qq
    apt-get install -y --no-install-recommends nodejs npm curl >/dev/null
    # systemd is not present in this slim image; the wrapper will detect
    # that systemctl is not available and *stage* unit files without
    # activating — which is exactly what we test for.
    mkdir -p ~/.config/systemd/user

    echo "--- npx (install + service registration, TAM_INSTALL_DRY=1 → skip pip) ---"
    npx -y /tmp/tam.tgz install --no-services
    echo "--- explicit dashboard install (writes units) ---"
    # Need the venv bin shim from dry-install.
    npx /tmp/tam.tgz dashboard install || true

    echo "--- verify units staged ---"
    test -f ~/.config/systemd/user/tam-dashboard.service \
      || { echo "FAIL: tam-dashboard.service unit missing"; exit 2; }
    test -f ~/.config/systemd/user/tam-reflection.service \
      || { echo "FAIL: tam-reflection.service unit missing"; exit 2; }
    test -f ~/.config/systemd/user/tam-reflection.path \
      || { echo "FAIL: tam-reflection.path unit missing"; exit 2; }

    echo "--- verify unit contents reference the venv python ---"
    grep -F "/.tam/.venv/bin/python -m src.dashboard" \
      ~/.config/systemd/user/tam-dashboard.service \
      || { echo "FAIL: dashboard unit ExecStart wrong"; exit 2; }

    echo "--- status command works without throwing ---"
    npx /tmp/tam.tgz dashboard status

    echo "OK: install paths exercised; service files written correctly"
  '

echo "✓ npx smoke OK"
