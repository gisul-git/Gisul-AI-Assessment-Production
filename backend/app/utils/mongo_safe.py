"""Safe MongoDB operations with NoSQL injection protection."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from motor.motor_asyncio import AsyncIOMotorCollection, AsyncIOMotorCursor
from pymongo.results import DeleteResult, UpdateResult

from .nosql_injection import sanitize_filter_dict, sanitize_query, sanitize_update_dict


async def safe_find_one(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> Optional[Dict[str, Any]]:
    """
    Safely find one document with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        allow_regex: Allow $regex operator (default: False)
        allow_text: Allow $text operator (default: False)
        **kwargs: Additional arguments for find_one
    
    Returns:
        Document or None
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    return await collection.find_one(sanitized_filter, **kwargs)


async def safe_find(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> AsyncIOMotorCursor:
    """
    Safely find documents with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        allow_regex: Allow $regex operator (default: False)
        allow_text: Allow $text operator (default: False)
        **kwargs: Additional arguments for find
    
    Returns:
        Cursor
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    return collection.find(sanitized_filter, **kwargs)


async def safe_update_one(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    update: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> UpdateResult:
    """
    Safely update one document with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        update: Update operations (will be sanitized)
        allow_regex: Allow $regex in filter (default: False)
        allow_text: Allow $text in filter (default: False)
        **kwargs: Additional arguments for update_one
    
    Returns:
        UpdateResult
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    sanitized_update = sanitize_update_dict(update)
    return await collection.update_one(sanitized_filter, sanitized_update, **kwargs)


async def safe_update_many(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    update: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> UpdateResult:
    """
    Safely update many documents with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        update: Update operations (will be sanitized)
        allow_regex: Allow $regex in filter (default: False)
        allow_text: Allow $text in filter (default: False)
        **kwargs: Additional arguments for update_many
    
    Returns:
        UpdateResult
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    sanitized_update = sanitize_update_dict(update)
    return await collection.update_many(sanitized_filter, sanitized_update, **kwargs)


async def safe_delete_one(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> DeleteResult:
    """
    Safely delete one document with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        allow_regex: Allow $regex operator (default: False)
        allow_text: Allow $text operator (default: False)
        **kwargs: Additional arguments for delete_one
    
    Returns:
        DeleteResult
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    return await collection.delete_one(sanitized_filter, **kwargs)


async def safe_delete_many(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> DeleteResult:
    """
    Safely delete many documents with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        allow_regex: Allow $regex operator (default: False)
        allow_text: Allow $text operator (default: False)
        **kwargs: Additional arguments for delete_many
    
    Returns:
        DeleteResult
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    return await collection.delete_many(sanitized_filter, **kwargs)


async def safe_replace_one(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    replacement: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> UpdateResult:
    """
    Safely replace one document with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        replacement: Replacement document
        allow_regex: Allow $regex operator (default: False)
        allow_text: Allow $text operator (default: False)
        **kwargs: Additional arguments for replace_one
    
    Returns:
        UpdateResult
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    # Replacement document doesn't need sanitization (it's a full document, not a query)
    return await collection.replace_one(sanitized_filter, replacement, **kwargs)


async def safe_count_documents(
    collection: AsyncIOMotorCollection,
    filter: Dict[str, Any],
    allow_regex: bool = False,
    allow_text: bool = False,
    **kwargs
) -> int:
    """
    Safely count documents with NoSQL injection protection.
    
    Args:
        collection: MongoDB collection
        filter: Query filter (will be sanitized)
        allow_regex: Allow $regex operator (default: False)
        allow_text: Allow $text operator (default: False)
        **kwargs: Additional arguments for count_documents
    
    Returns:
        Document count
    """
    sanitized_filter = sanitize_filter_dict(filter, allow_regex=allow_regex, allow_text=allow_text)
    return await collection.count_documents(sanitized_filter, **kwargs)


