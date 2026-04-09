"""Optional API key authentication middleware."""

from __future__ import annotations

import os

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

_API_KEY_ENV = "FRS_API_KEY"


class APIKeyMiddleware(BaseHTTPMiddleware):
    """If FRS_API_KEY is set, require it as X-API-Key header or ?api_key query param."""

    async def dispatch(self, request: Request, call_next):
        api_key = os.environ.get(_API_KEY_ENV, "")
        if not api_key:
            return await call_next(request)

        if request.url.path.startswith(("/api/health", "/docs", "/openapi.json", "/redoc")):
            return await call_next(request)

        provided = request.headers.get("X-API-Key") or request.query_params.get("api_key", "")
        if provided != api_key:
            return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})

        return await call_next(request)
