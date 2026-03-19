import uuid
from datetime import date as _Date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


class GoalCreate(BaseModel):
    name: str
    target_amount: Decimal
    currency: str = "BRL"
    target_date: Optional[_Date] = None
    account_id: Optional[uuid.UUID] = None
    icon: str = "🎯"
    color: str = "#6366f1"


class GoalUpdate(BaseModel):
    name: Optional[str] = None
    target_amount: Optional[Decimal] = None
    current_amount: Optional[Decimal] = None
    currency: Optional[str] = None
    target_date: Optional[_Date] = None
    account_id: Optional[uuid.UUID] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    is_completed: Optional[bool] = None


class GoalDeposit(BaseModel):
    amount: Decimal


class GoalRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    target_amount: Decimal
    current_amount: Decimal
    currency: str
    target_date: Optional[_Date] = None
    account_id: Optional[uuid.UUID] = None
    icon: str
    color: str
    is_completed: bool
    progress: float = 0.0  # percentage

    model_config = ConfigDict(from_attributes=True)
