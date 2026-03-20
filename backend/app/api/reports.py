from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_active_user
from app.core.database import get_async_session
from app.models.user import User
from app.schemas.report import ReportResponse, InstallmentsResponse
from app.services import report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _get_currency(user: User) -> str:
    currency = getattr(user, "preferences", None)
    if currency and isinstance(currency, dict):
        return currency.get("currency_display", "BRL")
    return "BRL"


@router.get("/net-worth", response_model=ReportResponse)
async def get_net_worth(
    months: int = Query(12, ge=1, le=24),
    interval: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    account_id: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    import uuid as _uuid
    aid = _uuid.UUID(account_id) if account_id else None
    return await report_service.get_net_worth_report(
        session, user.id, months, interval, _get_currency(user), account_id=aid
    )


@router.get("/income-expenses", response_model=ReportResponse)
async def get_income_expenses(
    months: int = Query(12, ge=1, le=24),
    interval: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    account_id: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    import uuid as _uuid
    aid = _uuid.UUID(account_id) if account_id else None
    return await report_service.get_income_expenses_report(
        session, user.id, months, interval, _get_currency(user), account_id=aid
    )


@router.get("/credit-card", response_model=ReportResponse)
async def get_credit_card(
    months: int = Query(12, ge=1, le=24),
    interval: str = Query("monthly", pattern="^(daily|weekly|monthly|yearly)$"),
    account_id: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    import uuid as _uuid
    aid = _uuid.UUID(account_id) if account_id else None
    return await report_service.get_credit_card_report(
        session, user.id, months, interval, _get_currency(user), account_id=aid
    )


@router.get("/installments", response_model=InstallmentsResponse)
async def get_installments(
    account_id: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    import uuid as _uuid
    aid = _uuid.UUID(account_id) if account_id else None
    return await report_service.get_installments_report(
        session, user.id, account_id=aid
    )


@router.get("/heatmap")
async def get_reports_heatmap(
    months: int = Query(6, ge=1, le=12),
    type: str = Query("all", pattern="^(all|credit_card)$"),
    account_id: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    import uuid as _uuid
    aid = _uuid.UUID(account_id) if account_id else None
    return await report_service.get_reports_heatmap(
        session, user.id, months, type, account_id=aid
    )
