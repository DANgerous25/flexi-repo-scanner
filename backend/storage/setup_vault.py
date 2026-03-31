"""CLI helper for managing the encrypted secrets vault.

Usage::

    # Store secrets
    python3 -m backend.storage.setup_vault \
        --data-dir data \
        --set GITHUB_TOKEN=ghp_example \
        --set ANTHROPIC_API_KEY=sk-ant-example

    # List stored secret names
    python3 -m backend.storage.setup_vault --data-dir data --list

    # Delete a secret
    python3 -m backend.storage.setup_vault --data-dir data --delete GITHUB_TOKEN
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the encrypted secrets vault")
    parser.add_argument("--data-dir", default="data", help="Path to the data directory")
    parser.add_argument("--set", dest="pairs", action="append", default=[], metavar="KEY=VALUE",
                        help="Secret key=value pair (can be repeated)")
    parser.add_argument("--list", dest="list_keys", action="store_true",
                        help="List stored secret names (not values)")
    parser.add_argument("--delete", dest="delete_keys", action="append", default=[], metavar="KEY",
                        help="Delete a secret by name (can be repeated)")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)

    # Import here so the module-level DATA_DIR isn't required at parse time
    from backend.storage.secrets import SecretsVault

    vault = SecretsVault(data_dir=data_dir)

    # List mode
    if args.list_keys:
        keys = vault.list_keys()
        if keys:
            print(f"{len(keys)} secret(s) in {data_dir / 'secrets.enc'}:")
            for k in keys:
                print(f"  - {k}")
        else:
            print("No secrets stored.")
        return

    # Delete mode
    if args.delete_keys:
        deleted = []
        for key in args.delete_keys:
            if vault.delete(key):
                deleted.append(key)
            else:
                print(f"  Key not found: {key}")
        if deleted:
            vault.save()
            print(f"Deleted {len(deleted)} secret(s):")
            for k in deleted:
                print(f"  - {k}")
        return

    # Set mode
    if not args.pairs:
        print("No action specified. Use --set KEY=VALUE, --list, or --delete KEY", file=sys.stderr)
        sys.exit(1)

    stored = []
    for pair in args.pairs:
        if "=" not in pair:
            print(f"Invalid format (expected KEY=VALUE): {pair}", file=sys.stderr)
            sys.exit(1)
        key, value = pair.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if not value:
            continue
        vault.set(key, value)
        stored.append(key)

    vault.save()

    if stored:
        print(f"Encrypted {len(stored)} secret(s) in {data_dir / 'secrets.enc'}:")
        for k in stored:
            print(f"  - {k}")
    else:
        print("No non-empty secrets to store.")


if __name__ == "__main__":
    main()
