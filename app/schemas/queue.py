"""Queue slot contracts for Buffer-style posting schedules."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QueueSlotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    platform: str
    weekday: int
    time_local: str
    timezone: str


class QueueSlotInput(BaseModel):
    weekday: int = Field(ge=0, le=6)
    time_local: str

    @field_validator("time_local")
    @classmethod
    def validate_time(cls, value: str) -> str:
        text = str(value or "").strip()
        parts = text.split(":")
        if len(parts) != 2:
            raise ValueError("time_local must be HH:MM")
        hour, minute = int(parts[0]), int(parts[1])
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError("time_local must be a valid 24h time")
        return f"{hour:02d}:{minute:02d}"


class QueueSlotsReplace(BaseModel):
    platform: str = Field(min_length=1, max_length=40)
    timezone: str = Field(default="UTC", min_length=1, max_length=64)
    slots: list[QueueSlotInput] = Field(default_factory=list, max_length=70)


class QueueNextRequest(BaseModel):
    connected_account_id: UUID


class QueueNextRead(BaseModel):
    connected_account_id: UUID
    platform: str
    scheduled_at: datetime
    weekday: int
    time_local: str
    timezone: str
    using_defaults: bool = False


class QueueAllocateRequest(BaseModel):
    connected_account_ids: list[UUID] = Field(min_length=1, max_length=40)


class QueueAllocateResponse(BaseModel):
    allocations: list[QueueNextRead]


class QueueUpcomingItem(BaseModel):
    scheduled_at: datetime
    platform: str
    weekday: int
    time_local: str
    timezone: str
    connected_account_id: UUID | None = None
    account_name: str | None = None
    post_id: UUID | None = None
    post_status: str | None = None
    post_excerpt: str | None = None
    filled: bool = False
