#!/usr/bin/env bash
# Run this script ONCE with sudo to restrict port 8400 to localhost + Tailscale only.
# This blocks direct public internet access to the Flexi Repo Scanner.
# Rules are persisted across reboots via iptables-persistent.
#
# Usage: sudo ./setup-firewall.sh

set -euo pipefail

PORT=8400
TAILSCALE_SUBNET="100.64.0.0/10"

echo "Setting up firewall rules for Flexi Repo Scanner on port $PORT..."
echo "Allowing: localhost (127.0.0.1) + Tailscale ($TAILSCALE_SUBNET)"
echo "Blocking: all other external access"
echo ""

# Remove any existing rules for this port first (idempotent)
iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
iptables -D INPUT -p tcp --dport "$PORT" -s "$TAILSCALE_SUBNET" -j ACCEPT 2>/dev/null || true
iptables -D INPUT -p tcp --dport "$PORT" -s 127.0.0.1 -j ACCEPT 2>/dev/null || true

# Allow localhost
iptables -A INPUT -p tcp --dport "$PORT" -s 127.0.0.1 -j ACCEPT
# Allow Tailscale CGNAT range
iptables -A INPUT -p tcp --dport "$PORT" -s "$TAILSCALE_SUBNET" -j ACCEPT
# Drop everything else on this port
iptables -A INPUT -p tcp --dport "$PORT" -j DROP

echo "Firewall rules applied."

# Persist across reboots
if dpkg -l iptables-persistent 2>/dev/null | grep -q "^ii"; then
    echo "Saving rules (iptables-persistent already installed)..."
    iptables-save > /etc/iptables/rules.v4
else
    echo "Installing iptables-persistent to survive reboots..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
    iptables-save > /etc/iptables/rules.v4
fi

echo ""
echo "Done. Rules are persisted in /etc/iptables/rules.v4"
echo "To verify:  sudo iptables -L INPUT -n | grep $PORT"
echo "To remove:  sudo ./remove-firewall.sh"
