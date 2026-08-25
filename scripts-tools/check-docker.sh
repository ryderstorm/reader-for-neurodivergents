#!/usr/bin/env bash
# Preflight for the container workflow.
#
# The failure this exists to catch: docker-compose v1 (the standalone Python
# tool, EOL since July 2023) cannot talk to Docker Engine 26+. Engine dropped
# the legacy `ContainerConfig` field from image inspect, and v1 reads it
# unconditionally, so every `docker-compose up` dies with
#
#     KeyError: 'ContainerConfig'
#
# regardless of what is in the compose file. Ubuntu's `docker-compose` package
# still installs v1, so this is easy to hit.
set -uo pipefail

fail=0
say()  { printf '  %-12s %s\n' "$1" "$2"; }

echo "Docker preflight"

if ! command -v docker >/dev/null 2>&1; then
  say "docker" "NOT INSTALLED"
  echo
  echo "  Install it:  curl -fsSL https://get.docker.com | sudo sh"
  exit 1
fi
say "docker" "$(docker --version | sed 's/Docker version //')"

if ! docker info >/dev/null 2>&1; then
  say "daemon" "NOT REACHABLE"
  echo
  echo "  Either the daemon is stopped, or your user is not in the docker group:"
  echo "    sudo usermod -aG docker \"\$USER\"   # then log out and back in"
  exit 1
fi
say "daemon" "reachable"

# The one that matters.
if docker compose version >/dev/null 2>&1; then
  say "compose" "v2 plugin — $(docker compose version --short 2>/dev/null)"
  echo
  echo "  Use:  docker compose up -d --build"
else
  say "compose" "V2 PLUGIN MISSING"
  fail=1
  if command -v docker-compose >/dev/null 2>&1; then
    v=$(docker-compose version --short 2>/dev/null || echo unknown)
    say "" "found standalone docker-compose $v"
    case "$v" in
      1.*) say "" "v1 CANNOT work with this Docker Engine — see below" ;;
    esac
  fi
  cat <<'MSG'

  Docker Compose v2 is required. The standalone `docker-compose` v1 fails with
  `KeyError: 'ContainerConfig'` against any recent Docker Engine, whatever the
  compose file contains.

  Install it for your user only (no sudo, nothing else touched):

    mkdir -p ~/.docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
      -o ~/.docker/cli-plugins/docker-compose
    chmod +x ~/.docker/cli-plugins/docker-compose

  Or system-wide on Debian/Ubuntu:

    sudo apt-get install -y docker-compose-plugin

  Then use `docker compose` (a space), not `docker-compose` (a hyphen).
MSG
fi

# Not fatal, but the classic builder is slower and ignores the syntax
# directive at the top of the Dockerfile.
if docker buildx version >/dev/null 2>&1; then
  say "buildx" "present"
else
  say "buildx" "missing — builds use the classic builder (slower, but works)"
fi

exit $fail
