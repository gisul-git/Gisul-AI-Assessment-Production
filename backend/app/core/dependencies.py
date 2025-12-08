from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from bson import ObjectId
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..core.security import TokenError, decode_token
from ..db.mongo import get_db
from ..utils.mongo import serialize_document


def _oauth_scheme(auto_error: bool) -> OAuth2PasswordBearer:
    return OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=auto_error)


oauth2_scheme = _oauth_scheme(auto_error=True)
optional_oauth2_scheme = _oauth_scheme(auto_error=False)


async def _fetch_user(db: AsyncIOMotorDatabase, user_id: str) -> Dict[str, Any]:
    try:
        oid = ObjectId(user_id)
    except Exception as exc:  # pragma: no cover - invalid ObjectId
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user identifier") from exc

    user = await db.users.find_one({"_id": oid})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    serialized = serialize_document(user)
    if not serialized:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return serialized


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Dict[str, Any]:
    try:
        payload = decode_token(token)
    except TokenError as exc:
        raise exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")

    user = await _fetch_user(db, user_id)
    return user


async def get_optional_user(
    token: Optional[str] = Depends(optional_oauth2_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
    except TokenError:
        return None
    if not user_id:
        return None
    try:
        return await _fetch_user(db, user_id)
    except HTTPException:
        return None


def require_roles(*roles: str) -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    async def dependency(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if current_user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(roles)}",
            )
        return current_user

    return dependency


require_super_admin = require_roles("super_admin")
require_org_admin = require_roles("super_admin", "org_admin")
require_editor = require_roles("super_admin", "org_admin", "editor")
require_viewer = require_roles("super_admin", "org_admin", "editor", "viewer")
