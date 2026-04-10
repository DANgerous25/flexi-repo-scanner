#!/usr/bin/env bash
# Remove the Flexi Repo Scanner firewall rules.
# Usage: sudo ./remove-firewall.sh

set -euo pipefail

PORT=8400
TAILSCALE_SUBNET="100.64.0.0/10"

echo "Removing firewall rules for port $PORT..."

iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
iptables -D INPUT -p tcp --dport "$PORT" -s "$TAILSCALE_SUBNET" -j ACCEPT 2>/dev/null || true
iptables -D INPUT -p tcp --dport "$PORT" -s 127.0.0.1 -j ACCEPT 2>/dev/null || true

if dpkg -l iptables-persistent 2>/dev/null | grep -q "^ii"; then
    iptables-save > /etc/iptables/rules.v4
    echo "Persisted updated rules."
fi

echo "Done. Port $PORT is now unrestricted."
