#!/usr/bin/env bash
# Restrict outbound container egress to loopback and package/git allowlist.
set -euo pipefail

ALLOWED_DOMAINS=(
  "github.com"
  "api.github.com"
  "pypi.org"
  "files.pythonhosted.org"
  "registry.npmjs.org"
)

if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables not available; skipping firewall setup" >&2
  exit 1
fi

iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

for domain in "${ALLOWED_DOMAINS[@]}"; do
  while read -r ip; do
    [ -n "$ip" ] && iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
  done < <(dig +short A "$domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
done

iptables -P OUTPUT DROP
echo "Devcontainer egress firewall active (${#ALLOWED_DOMAINS[@]} allowed domains)."
