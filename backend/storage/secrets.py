"""Encrypted secrets vault using Fernet (AES-256-CBC)."""

from __future__ import annotations

import json
import logging
import os
import stat
from pathlib import Path
from typing import Optional

from backend.config import DATA_DIR

logger = logging.getLogger(__name__)

_vault_instance: Optional["SecretsVault"] = None


class SecretsVault:
    """Encrypt/decrypt secrets stored in a local file.

    - Key file: ``data/secret.key`` (chmod 600)
    - Vault file: ``data/secrets.enc`` (Fernet-encrypted JSON blob)
    """

    def __init__(self, data_dir: Optional[Path] = None) -> None:
        self._dir = Path(data_dir) if data_dir else DATA_DIR
        self._dir.mkdir(parents=True, exist_ok=True)
        self._key_path = self._dir / "secret.key"
        self._vault_path = self._dir / "secrets.enc"
        self._secrets: dict[str, str] = {}
        self._fernet = self._load_or_create_key()
        self._load()

    # ── Key management ────────────────────────────────────────────────

    def _load_or_create_key(self):
        from cryptography.fernet import Fernet

        if self._key_path.exists():
            key = self._key_path.read_bytes().strip()
        else:
            key = Fernet.generate_key()
            self._key_path.write_bytes(key)
            try:
                self._key_path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 600
            except OSError:
                pass  # Windows or restricted fs
            logger.info("Generated new encryption key: %s", self._key_path)
        return Fernet(key)

    # ── Persistence ───────────────────────────────────────────────────

    def _load(self) -> None:
        if not self._vault_path.exists():
            self._secrets = {}
            return
        try:
            encrypted = self._vault_path.read_bytes()
            decrypted = self._fernet.decrypt(encrypted)
            self._secrets = json.loads(decrypted)
        except Exception:
            logger.warning("Could not decrypt vault — starting empty")
            self._secrets = {}

    def save(self) -> None:
        """Persist current secrets to the encrypted vault file."""
        raw = json.dumps(self._secrets).encode()
        self._vault_path.write_bytes(self._fernet.encrypt(raw))

    # ── Public API ────────────────────────────────────────────────────

    def get(self, key: str) -> Optional[str]:
        return self._secrets.get(key)

    def set(self, key: str, value: str) -> None:
        self._secrets[key] = value

    def delete(self, key: str) -> bool:
        return self._secrets.pop(key, None) is not None

    def list_keys(self) -> list[str]:
        return sorted(self._secrets.keys())

    def export_to_env(self) -> None:
        """Copy all vault secrets into ``os.environ`` as a fallback."""
        for k, v in self._secrets.items():
            os.environ.setdefault(k, v)


def get_vault(data_dir: Optional[Path] = None) -> SecretsVault:
    """Return the module-level singleton vault (lazy-init)."""
    global _vault_instance
    if _vault_instance is None:
        _vault_instance = SecretsVault(data_dir=data_dir)
    return _vault_instance
