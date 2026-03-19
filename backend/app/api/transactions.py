import csv
import io
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_active_user
from app.core.database import get_async_session
from app.models.user import User
from app.schemas.transaction import BulkCategorizeRequest, TransactionCreate, TransactionRead, TransactionUpdate
from app.services import transaction_service
from app.services.transfer_detection_service import detect_transfer_pairs

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


class PaginatedTransactions(BaseModel):
    items: list[TransactionRead]
    total: int
    page: int
    limit: int


@router.get("", response_model=PaginatedTransactions)
async def list_transactions(
    account_id: Optional[uuid.UUID] = Query(None),
    category_id: Optional[uuid.UUID] = Query(None),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    sort_by: Optional[str] = Query("date"),
    sort_dir: Optional[str] = Query("desc"),
    q: Optional[str] = Query(None),
    uncategorized: bool = Query(False),
    type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    include_opening_balance: bool = Query(False),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    transactions, total = await transaction_service.get_transactions(
        session, user.id, account_id, category_id, from_date, to_date, page, limit,
        include_opening_balance, search=q, uncategorized=uncategorized, txn_type=type,
        min_amount=min_amount, max_amount=max_amount, sort_by=sort_by, sort_dir=sort_dir,
    )
    return PaginatedTransactions(items=transactions, total=total, page=page, limit=limit)


@router.get("/export")
async def export_transactions(
    account_id: Optional[uuid.UUID] = Query(None),
    category_id: Optional[uuid.UUID] = Query(None),
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    min_amount: Optional[float] = Query(None),
    max_amount: Optional[float] = Query(None),
    sort_by: Optional[str] = Query("date"),
    sort_dir: Optional[str] = Query("desc"),
    q: Optional[str] = Query(None),
    uncategorized: bool = Query(False),
    type: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    transactions, _ = await transaction_service.get_transactions(
        session, user.id, account_id, category_id, from_date, to_date,
        search=q, uncategorized=uncategorized, txn_type=type, skip_pagination=True,
        min_amount=min_amount, max_amount=max_amount, sort_by=sort_by, sort_dir=sort_dir,
    )

    output = io.StringIO()
    output.write("\ufeff")  # UTF-8 BOM for Excel
    writer = csv.writer(output)
    writer.writerow(["date", "description", "amount", "type", "currency", "category", "account", "payee", "notes", "status", "source"])
    for tx in transactions:
        writer.writerow([
            tx.date.isoformat(),
            tx.description,
            str(tx.amount),
            tx.type,
            tx.currency,
            tx.category.name if tx.category else "",
            tx.account.name if tx.account else "",
            tx.payee or "",
            tx.notes or "",
            tx.status,
            tx.source,
        ])

    output.seek(0)
    today = date.today().isoformat()
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="transactions-{today}.csv"'},
    )


@router.patch("/bulk-categorize")
async def bulk_categorize(
    data: BulkCategorizeRequest,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    count = await transaction_service.bulk_update_category(
        session, user.id, data.transaction_ids, data.category_id
    )
    return {"updated": count}


@router.post("/detect-transfers")
async def detect_transfers(
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    count = await detect_transfer_pairs(session, user.id)
    await session.commit()
    return {"paired_count": count}


@router.get("/{transaction_id}", response_model=TransactionRead)
async def get_transaction(
    transaction_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    transaction = await transaction_service.get_transaction(session, transaction_id, user.id)
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return transaction


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: TransactionCreate,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    try:
        transaction = await transaction_service.create_transaction(session, user.id, data)
        return await transaction_service.get_transaction(session, transaction.id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{transaction_id}", response_model=TransactionRead)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: TransactionUpdate,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    transaction = await transaction_service.update_transaction(session, transaction_id, user.id, data)
    if not transaction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
    return transaction


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
):
    deleted = await transaction_service.delete_transaction(session, transaction_id, user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")
