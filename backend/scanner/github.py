"""Async GitHub API client — read-only access via REST API."""

from __future__ import annotations

import base64
import fnmatch
from dataclasses import dataclass, field
from typing import Optional

import httpx


@dataclass
class GitHubFile:
    path: str
    sha: str
    size: int


@dataclass
class GitHubClient:
    owner: str
    repo: str
    token: str
    base_url: str = "https://api.github.com"
    _client: Optional[httpx.AsyncClient] = field(default=None, repr=False)

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            headers = {
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            if self.token:
                headers["Authorization"] = f"Bearer {self.token}"
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=headers,
                timeout=30.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    @property
    def repo_path(self) -> str:
        return f"/repos/{self.owner}/{self.repo}"

    async def get_default_branch(self) -> str:
        resp = await self.client.get(self.repo_path)
        resp.raise_for_status()
        return resp.json().get("default_branch", "main")

    async def get_rate_limit(self) -> dict:
        resp = await self.client.get("/rate_limit")
        resp.raise_for_status()
        data = resp.json()
        core = data.get("resources", {}).get("core", {})
        return {
            "remaining": core.get("remaining", 0),
            "limit": core.get("limit", 0),
            "reset": core.get("reset", 0),
        }

    async def list_files(self, branch: str = "main") -> list[GitHubFile]:
        """List all files in repo using recursive tree API."""
        resp = await self.client.get(
            f"{self.repo_path}/git/trees/{branch}",
            params={"recursive": "1"},
        )
        resp.raise_for_status()
        tree = resp.json().get("tree", [])
        return [
            GitHubFile(path=item["path"], sha=item["sha"], size=item.get("size", 0))
            for item in tree
            if item["type"] == "blob"
        ]

    async def get_file_content(self, path: str, ref: str = "main") -> Optional[str]:
        """Fetch file content. Uses Contents API, falls back to Blobs for large files."""
        try:
            resp = await self.client.get(
                f"{self.repo_path}/contents/{path}",
                params={"ref": ref},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            if data.get("encoding") == "base64" and data.get("content"):
                raw = base64.b64decode(data["content"])
                return raw.decode("utf-8", errors="ignore")
            # For files > 1MB, content may not be returned
            if data.get("sha"):
                return await self._get_blob_content(data["sha"])
        except (httpx.HTTPStatusError, Exception):
            pass
        return None

    async def _get_blob_content(self, sha: str) -> Optional[str]:
        """Fetch file content via Blobs API for large files."""
        try:
            resp = await self.client.get(f"{self.repo_path}/git/blobs/{sha}")
            resp.raise_for_status()
            data = resp.json()
            if data.get("encoding") == "base64":
                raw = base64.b64decode(data["content"])
                return raw.decode("utf-8", errors="ignore")
        except Exception:
            pass
        return None

    async def get_compare(self, base: str, head: str) -> list[dict]:
        """Get changed files between two commits."""
        resp = await self.client.get(f"{self.repo_path}/compare/{base}...{head}")
        resp.raise_for_status()
        data = resp.json()
        return [
            {
                "filename": f["filename"],
                "status": f["status"],  # added, modified, removed, renamed
                "sha": f.get("sha", ""),
            }
            for f in data.get("files", [])
        ]

    async def get_latest_commit_sha(self, branch: str = "main") -> str:
        """Get SHA of latest commit on branch."""
        resp = await self.client.get(
            f"{self.repo_path}/commits/{branch}",
            headers={"Accept": "application/vnd.github.sha"},
        )
        resp.raise_for_status()
        return resp.text.strip()

    async def test_connection(self) -> dict:
        """Test if connection works. Returns repo info or error."""
        try:
            resp = await self.client.get(self.repo_path)
            resp.raise_for_status()
            data = resp.json()
            rate = await self.get_rate_limit()
            return {
                "ok": True,
                "name": data.get("full_name", ""),
                "private": data.get("private", False),
                "default_branch": data.get("default_branch", "main"),
                "rate_limit": rate,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}


def filter_files(files: list[GitHubFile], include: list[str], exclude: list[str]) -> list[GitHubFile]:
    """Filter file list by include/exclude glob patterns."""
    result = []
    for f in files:
        # Check excludes first
        excluded = False
        for pattern in exclude:
            if pattern.endswith("/"):
                if f.path.startswith(pattern) or f"/{pattern}" in f"/{f.path}":
                    excluded = True
                    break
            elif fnmatch.fnmatch(f.path, pattern) or fnmatch.fnmatch(f.path.split("/")[-1], pattern):
                excluded = True
                break
        if excluded:
            continue

        # Check includes
        if not include or any(
            fnmatch.fnmatch(f.path, p) or fnmatch.fnmatch(f.path.split("/")[-1], p)
            for p in include
        ):
            result.append(f)
    return result
