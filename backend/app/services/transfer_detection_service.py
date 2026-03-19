import uuid
from collections import defaultdict
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account
from app.models.transaction import Transaction

# Descriptions that Pluggy uses for bill payments on the credit card side
_BILL_PAYMENT_DESCRIPTIONS = {"pagamento recebido", "pagamento efetuado", "pagamento"}


async def detect_transfer_pairs(
    session: AsyncSession,
    user_id: uuid.UUID,
    candidate_ids: Optional[list[uuid.UUID]] = None,
    date_tolerance_days: int = 2,
) -> int:
    """Detect inter-account transfer pairs and link them with a shared UUID.

    Algorithm:
    1. Load unpaired debit transactions (optionally filtered to candidate_ids)
    2. For each debit, find an unpaired credit with: same user, different account,
       same absolute amount, date within ±tolerance days
    3. Greedy closest-date-first matching; each tx can only pair once
    4. If a credit lands on a credit_card account, rename generic descriptions
       to "Pagamento de fatura" for correct display.

    Returns the number of pairs created.
    """
    # Load candidate debits (with account info for type checking)
    debit_query = (
        select(Transaction)
        .options(selectinload(Transaction.account))
        .where(
            Transaction.user_id == user_id,
            Transaction.type == "debit",
            Transaction.transfer_pair_id.is_(None),
            Transaction.source != "opening_balance",
        )
    )
    if candidate_ids:
        debit_query = debit_query.where(Transaction.id.in_(candidate_ids))

    debit_result = await session.execute(debit_query)
    debits = list(debit_result.scalars().all())

    if not debits:
        return 0

    # Load all unpaired credits for the user (with account info)
    credit_query = (
        select(Transaction)
        .options(selectinload(Transaction.account))
        .where(
            Transaction.user_id == user_id,
            Transaction.type == "credit",
            Transaction.transfer_pair_id.is_(None),
            Transaction.source != "opening_balance",
        )
    )
    credit_result = await session.execute(credit_query)
    credits = list(credit_result.scalars().all())

    if not credits:
        return 0

    # Build a lookup: amount -> list of credits
    credit_by_amount: dict[float, list[Transaction]] = defaultdict(list)
    for c in credits:
        credit_by_amount[abs(float(c.amount))].append(c)

    paired_credit_ids: set[uuid.UUID] = set()
    pairs_created = 0

    for debit in debits:
        debit_amount = abs(float(debit.amount))
        candidates = credit_by_amount.get(debit_amount, [])

        # Find closest-date match in a different account
        best_match: Optional[Transaction] = None
        best_delta: Optional[int] = None

        for credit in candidates:
            if credit.id in paired_credit_ids:
                continue
            if credit.account_id == debit.account_id:
                continue

            delta = abs((credit.date - debit.date).days)
            if delta > date_tolerance_days:
                continue

            if best_delta is None or delta < best_delta:
                best_match = credit
                best_delta = delta

        if best_match:
            pair_id = uuid.uuid4()
            debit.transfer_pair_id = pair_id
            best_match.transfer_pair_id = pair_id
            paired_credit_ids.add(best_match.id)
            pairs_created += 1

            # If the credit lands on a credit_card, relabel as bill payment
            _relabel_bill_payment(debit, best_match)

    return pairs_created


def _relabel_bill_payment(debit: Transaction, credit: Transaction) -> None:
    """If one side of the pair is a credit_card account, rename generic
    descriptions to 'Pagamento de fatura' for correct display."""
    if credit.account and credit.account.type == "credit_card":
        if credit.description.strip().lower() in _BILL_PAYMENT_DESCRIPTIONS:
            credit.description = "Pagamento de fatura"
    elif debit.account and debit.account.type == "credit_card":
        if debit.description.strip().lower() in _BILL_PAYMENT_DESCRIPTIONS:
            debit.description = "Pagamento de fatura"


async def unlink_transfer_pair(
    session: AsyncSession,
    user_id: uuid.UUID,
    pair_id: uuid.UUID,
) -> int:
    """Remove a transfer pair link. Returns number of transactions unlinked."""
    result = await session.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.transfer_pair_id == pair_id,
        )
    )
    transactions = list(result.scalars().all())

    for tx in transactions:
        tx.transfer_pair_id = None

    return len(transactions)
