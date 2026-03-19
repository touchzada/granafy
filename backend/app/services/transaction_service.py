import uuid
from datetime import date
from typing import Optional

from sqlalchemy import select, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.transaction import Transaction
from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services.rule_service import apply_rules_to_transaction


async def get_transactions(
    session: AsyncSession,
    user_id: uuid.UUID,
    account_id: Optional[uuid.UUID] = None,
    category_id: Optional[uuid.UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    page: int = 1,
    limit: int = 50,
    include_opening_balance: bool = False,
    search: Optional[str] = None,
    uncategorized: bool = False,
    txn_type: Optional[str] = None,
    skip_pagination: bool = False,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    sort_by: str = "date",
    sort_dir: str = "desc",
) -> tuple[list[Transaction], int]:
    # Base query: user's own transactions (manual or via account)
    base_query = (
        select(Transaction)
        .outerjoin(Account)
        .outerjoin(BankConnection)
        .where(
            or_(
                Transaction.user_id == user_id,
                BankConnection.user_id == user_id,
            )
        )
        .options(selectinload(Transaction.category), selectinload(Transaction.account))
    )

    # Exclude opening_balance transactions from the normal list unless explicitly requested
    if not include_opening_balance:
        base_query = base_query.where(Transaction.source != "opening_balance")

    # Apply filters
    if account_id:
        base_query = base_query.where(Transaction.account_id == account_id)
    if category_id:
        base_query = base_query.where(Transaction.category_id == category_id)
    if uncategorized:
        base_query = base_query.where(
            Transaction.category_id == None,
            Transaction.transfer_pair_id.is_(None),
        )
    if txn_type:
        base_query = base_query.where(Transaction.type == txn_type)
    if from_date:
        base_query = base_query.where(Transaction.date >= from_date)
    if to_date:
        base_query = base_query.where(Transaction.date <= to_date)
    if search:
        term = f"%{search}%"
        base_query = base_query.where(
            or_(
                Transaction.description.ilike(term),
                Transaction.payee.ilike(term),
                Transaction.notes.ilike(term),
            )
        )
    if min_amount is not None:
        base_query = base_query.where(Transaction.amount >= min_amount)
    if max_amount is not None:
        base_query = base_query.where(Transaction.amount <= max_amount)

    # Get total count
    count_query = select(func.count()).select_from(base_query.subquery())
    total = await session.scalar(count_query)

    # Apply ordering (and pagination unless skipped)
    sort_col = getattr(Transaction, sort_by, Transaction.date)
    if sort_dir == "asc":
        query = base_query.order_by(sort_col.asc(), Transaction.created_at.asc())
    else:
        query = base_query.order_by(sort_col.desc(), Transaction.created_at.desc())
        
    if not skip_pagination:
        query = query.offset((page - 1) * limit).limit(limit)

    result = await session.execute(query)
    transactions = list(result.scalars().all())

    return transactions, total or 0


async def get_transaction(
    session: AsyncSession, transaction_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[Transaction]:
    result = await session.execute(
        select(Transaction)
        .outerjoin(Account)
        .outerjoin(BankConnection)
        .where(
            Transaction.id == transaction_id,
            or_(
                Transaction.user_id == user_id,
                BankConnection.user_id == user_id,
            ),
        )
        .options(selectinload(Transaction.category))
    )
    return result.scalar_one_or_none()


async def create_transaction(
    session: AsyncSession, user_id: uuid.UUID, data: TransactionCreate
) -> Transaction:
    # Verify account belongs to user
    account_result = await session.execute(
        select(Account)
        .outerjoin(BankConnection)
        .where(
            Account.id == data.account_id,
            or_(
                Account.user_id == user_id,
                BankConnection.user_id == user_id,
            ),
        )
    )
    account = account_result.scalar_one_or_none()
    if not account:
        raise ValueError("Account not found")

    transaction = Transaction(
        user_id=user_id,
        account_id=data.account_id,
        category_id=data.category_id,  # use provided category if given
        description=data.description,
        amount=data.amount,
        currency=data.currency,
        date=data.date,
        type=data.type,
        source="manual",
        notes=data.notes,
    )
    session.add(transaction)
    await session.flush()  # get ID without committing

    # Apply rules only if no explicit category provided
    if not data.category_id:
        await apply_rules_to_transaction(session, user_id, transaction)

    await session.commit()
    await session.refresh(transaction, ["category"])
    return transaction


async def update_transaction(
    session: AsyncSession, transaction_id: uuid.UUID, user_id: uuid.UUID, data: TransactionUpdate
) -> Optional[Transaction]:
    transaction = await get_transaction(session, transaction_id, user_id)
    if not transaction:
        return None

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(transaction, key, value)

    await session.commit()
    await session.refresh(transaction)
    return transaction


async def bulk_update_category(
    session: AsyncSession,
    user_id: uuid.UUID,
    transaction_ids: list[uuid.UUID],
    category_id: Optional[uuid.UUID] = None,
) -> int:
    result = await session.execute(
        update(Transaction)
        .where(
            Transaction.id.in_(transaction_ids),
            Transaction.user_id == user_id,
        )
        .values(category_id=category_id)
    )
    await session.commit()
    return result.rowcount


async def delete_transaction(
    session: AsyncSession, transaction_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    transaction = await get_transaction(session, transaction_id, user_id)
    if not transaction:
        return False

    await session.delete(transaction)
    await session.commit()
    return True
