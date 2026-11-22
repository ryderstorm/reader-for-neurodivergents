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

mapfile -t DNS_SERVERS < <(
  awk '/^[[:space:]]*nameserver[[:space:]]+/ { print $2 }' /etc/resolv.conf \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true
)
if [ "${#DNS_SERVERS[@]}" -eq 0 ]; then
  echo "No IPv4 DNS resolvers found in /etc/resolv.conf; aborting firewall setup" >&2
  exit 1
fi

iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
for ns in "${DNS_SERVERS[@]}"; do
  iptables -A OUTPUT -d "$ns" -p udp --dport 53 -j ACCEPT
  iptables -A OUTPUT -d "$ns" -p tcp --dport 53 -j ACCEPT
done

for domain in "${ALLOWED_DOMAINS[@]}"; do
  while read -r ip; do
    [ -n "$ip" ] && iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
  done < <(dig +short A "$domain" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)
done

iptables -P OUTPUT DROP
echo "Devcontainer egress firewall active (${#ALLOWED_DOMAINS[@]} allowed domains)."
