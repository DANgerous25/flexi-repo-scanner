"""CLI helper for the setup wizard to store secrets in the encrypted vault.

Usage::

    python3 -m backend.storage.setup_vault \
        --data-dir data \
        --set GITHUB_TOKEN=ghp_example \
        --set ANTHROPIC_API_KEY=sk-ant-example
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Store secrets in the encrypted vault")
    parser.add_argument("--data-dir", default="data", help="Path to the data directory")
    parser.add_argument("--set", dest="pairs", action="append", default=[], metavar="KEY=VALUE",
                        help="Secret key=value pair (can be repeated)")
    args = parser.parse_args()

    if not args.pairs:
        print("No secrets provided. Use --set KEY=VALUE", file=sys.stderr)
        sys.exit(1)

    data_dir = Path(args.data_dir)

    # Import here so the module-level DATA_DIR isn't required at parse time
    from backend.storage.secrets import SecretsVault

    vault = SecretsVault(data_dir=data_dir)

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
