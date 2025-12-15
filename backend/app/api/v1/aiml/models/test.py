from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class TestCreate(BaseModel):
    title: str
    description: Optional[str] = None
    question_ids: List[str]
    duration_minutes: int
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

class Test(BaseModel):
    id: Optional[str] = None
    title: str
    description: Optional[str] = None
    question_ids: List[str]
    duration_minutes: int
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    is_active: bool = True
    is_published: bool = False
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

class AddCandidateRequest(BaseModel):
    test_id: Optional[str] = None  # Optional since it's in the path
    name: str
    email: str

