FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git iptables ipset dnsutils nodejs npm shellcheck sudo make \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir uv

RUN useradd --create-home --shell /bin/bash vscode \
 && echo "vscode ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/vscode-firewall \
 && chmod 0440 /etc/sudoers.d/vscode-firewall

COPY init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh

USER vscode
WORKDIR /workspaces/reader-for-neurodivergents
