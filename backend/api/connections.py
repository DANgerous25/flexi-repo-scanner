"""GitHub connection management API routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import GitHubConnection
from backend.scanner.github import GitHubClient
from backend.storage import config_loader

router = APIRouter(prefix="/api/connections", tags=["connections"])


class ConnectionRequest(BaseModel):
    id: str
    name: str
    owner: str
    repo: str
    token: str = ""
    default_branch: str = "main"


@router.get("")
async def list_connections():
    """List all GitHub connections."""
    connections = config_loader.load_connections()
    # Mask tokens in response
    return [
        {**c.model_dump(), "token": "***" + c.token[-4:] if len(c.token) > 4 else "***"}
        for c in connections
    ]


@router.post("")
async def create_connection(req: ConnectionRequest):
    """Add a new GitHub connection."""
    connections = config_loader.load_connections()
    # Check for duplicate ID
    if any(c.id == req.id for c in connections):
        raise HTTPException(400, f"Connection '{req.id}' already exists")

    conn = GitHubConnection(**req.model_dump())
    connections.append(conn)
    config_loader.save_connections(connections)
    return {"id": conn.id, "message": "Connection created"}


@router.put("/{conn_id}")
async def update_connection(conn_id: str, req: ConnectionRequest):
    """Update an existing connection."""
    connections = config_loader.load_connections()
    found = False
    for i, c in enumerate(connections):
        if c.id == conn_id:
            connections[i] = GitHubConnection(**{**req.model_dump(), "id": conn_id})
            found = True
            break
    if not found:
        raise HTTPException(404, "Connection not found")
    config_loader.save_connections(connections)
    return {"id": conn_id, "message": "Connection updated"}


@router.delete("/{conn_id}")
async def delete_connection(conn_id: str):
    """Delete a connection."""
    connections = config_loader.load_connections()
    new_conns = [c for c in connections if c.id != conn_id]
    if len(new_conns) == len(connections):
        raise HTTPException(404, "Connection not found")
    config_loader.save_connections(new_conns)
    return {"message": "Connection deleted"}


@router.get("/{conn_id}/file")
async def get_file_content(conn_id: str, path: str, ref: str = "main"):
    """Fetch a file's content from GitHub via the connection."""
    conn = config_loader.get_connection(conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")

    # Use connection's default branch if ref is the generic "main"
    if ref == "main":
        ref = conn.default_branch or "main"

    client = GitHubClient(owner=conn.owner, repo=conn.repo, token=conn.token)
    try:
        resp = await client.client.get(
            f"{client.repo_path}/contents/{path}",
            params={"ref": ref},
        )
        if resp.status_code == 404:
            raise HTTPException(404, "File not found")
        resp.raise_for_status()
        data = resp.json()

        import base64
        content = ""
        size = data.get("size", 0)
        sha = data.get("sha", "")

        if data.get("encoding") == "base64" and data.get("content"):
            raw = base64.b64decode(data["content"])
            content = raw.decode("utf-8", errors="ignore")
        elif data.get("sha"):
            blob_content = await client._get_blob_content(data["sha"])
            content = blob_content or ""

        return {
            "path": path,
            "content": content,
            "encoding": "utf-8",
            "size": size,
            "sha": sha,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch file: {str(e)}")
    finally:
        await client.close()


@router.post("/{conn_id}/test")
async def test_connection(conn_id: str):
    """Test a GitHub connection."""
    conn = config_loader.get_connection(conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")

    client = GitHubClient(owner=conn.owner, repo=conn.repo, token=conn.token)
    try:
        result = await client.test_connection()
        return result
    finally:
        await client.close()
