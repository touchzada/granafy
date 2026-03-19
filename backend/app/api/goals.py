import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.auth import current_active_user
from app.models.goal import Goal
from app.models.user import User
from app.schemas.goal import GoalCreate, GoalUpdate, GoalDeposit, GoalRead

router = APIRouter(prefix="/api/goals", tags=["goals"])


def _to_read(goal: Goal) -> GoalRead:
    progress = 0.0
    if goal.target_amount and goal.target_amount > 0:
        progress = round(float(goal.current_amount / goal.target_amount) * 100, 1)
    return GoalRead(
        id=goal.id,
        user_id=goal.user_id,
        name=goal.name,
        target_amount=goal.target_amount,
        current_amount=goal.current_amount,
        currency=goal.currency,
        target_date=goal.target_date,
        account_id=goal.account_id,
        icon=goal.icon,
        color=goal.color,
        is_completed=goal.is_completed,
        progress=progress,
    )


@router.get("", response_model=list[GoalRead])
async def list_goals(
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    result = await session.execute(
        select(Goal).where(Goal.user_id == user.id).order_by(Goal.created_at.desc())
    )
    return [_to_read(g) for g in result.scalars().all()]


@router.post("", response_model=GoalRead, status_code=status.HTTP_201_CREATED)
async def create_goal(
    data: GoalCreate,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    goal = Goal(
        user_id=user.id,
        name=data.name,
        target_amount=data.target_amount,
        currency=data.currency,
        target_date=data.target_date,
        account_id=data.account_id,
        icon=data.icon,
        color=data.color,
    )
    session.add(goal)
    await session.commit()
    await session.refresh(goal)
    return _to_read(goal)


@router.patch("/{goal_id}", response_model=GoalRead)
async def update_goal(
    goal_id: uuid.UUID,
    data: GoalUpdate,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    result = await session.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Meta não encontrada")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    # Auto-complete when current >= target
    if goal.current_amount >= goal.target_amount:
        goal.is_completed = True

    await session.commit()
    await session.refresh(goal)
    return _to_read(goal)


@router.patch("/{goal_id}/deposit", response_model=GoalRead)
async def deposit_to_goal(
    goal_id: uuid.UUID,
    data: GoalDeposit,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    result = await session.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Meta não encontrada")

    goal.current_amount = goal.current_amount + data.amount
    if goal.current_amount >= goal.target_amount:
        goal.is_completed = True

    await session.commit()
    await session.refresh(goal)
    return _to_read(goal)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_goal(
    goal_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    result = await session.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(status_code=404, detail="Meta não encontrada")
    await session.delete(goal)
    await session.commit()
