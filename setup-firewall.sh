#!/usr/bin/env bash
# Run this script ONCE with sudo to restrict port 8400 to localhost + Tailscale only.
# This blocks direct public internet access to the Flexi Repo Scanner.
#
# Usage: sudo ./setup-firewall.sh

set -euo pipefail

PORT=8400
TAILSCALE_SUBNET="100.64.0.0/10"

echo "Setting up firewall rules for Flexi Repo Scanner on port $PORT..."
echo "Allowing: localhost (127.0.0.1) + Tailscale ($TAILSCALE_SUBNET)"
echo "Blocking: all other external access"
echo ""

# Allow localhost
iptables -A INPUT -p tcp --dport "$PORT" -s 127.0.0.1 -j ACCEPT
# Allow Tailscale CGNAT range
iptables -A INPUT -p tcp --dport "$PORT" -s "$TAILSCALE_SUBNET" -j ACCEPT
# Drop everything else on this port
iptables -A INPUT -p tcp --dport "$PORT" -j DROP

echo ""
echo "Firewall rules applied."
echo "To verify:  sudo iptables -L INPUT -n | grep $PORT"
echo "To remove: sudo iptables -D INPUT -p tcp --dport $PORT -j DROP && sudo iptables -D INPUT -p tcp --dport $PORT -s $TAILSCALE_SUBNET -j ACCEPT && sudo iptables -D INPUT -p tcp --dport $PORT -s 127.0.0.1 -j ACCEPT"
echo ""
echo "To persist across reboots, add these rules to /etc/iptables/rules.v4"
echo "or install iptables-persistent: sudo apt install iptables-persistent"