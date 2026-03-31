"""Notification feed API routes."""

from __future__ import annotations

from fastapi import APIRouter

from backend.storage import db

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(limit: int = 50, unread_only: bool = False):
    """Get notifications."""
    notifications = await db.get_notifications(limit, unread_only)
    unread_count = await db.get_unread_count()
    return {
        "notifications": notifications,
        "unread_count": unread_count,
    }


@router.post("/{notification_id}/read")
async def mark_read(notification_id: int):
    """Mark a notification as read."""
    await db.mark_notification_read(notification_id)
    return {"message": "Marked as read"}


@router.post("/read-all")
async def mark_all_read():
    """Mark all notifications as read."""
    await db.mark_all_read()
    return {"message": "All marked as read"}
