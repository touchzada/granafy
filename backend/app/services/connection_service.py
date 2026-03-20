import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.models.bank_connection import BankConnection
from app.models.account import Account
from app.models.category import Category
from app.models.transaction import Transaction
from app.providers import get_provider
from app.services.rule_service import apply_rules_to_transaction, PLUGGY_CATEGORY_MAP
from app.services.transfer_detection_service import detect_transfer_pairs


CNPJ_CATEGORY_MAP = {
    "18033952000161": "Transporte",  # 99 Taxis / 99 Pop
    "17895646000187": "Transporte",  # Uber do Brasil
    "14380200000121": "Alimentação", # iFood
    "13590585000199": "Assinaturas", # Netflix
    "19033817000145": "Assinaturas", # Spotify
    "15436940000103": "Compras",     # Amazon
    "03007331000141": "Compras",     # Mercado Livre
    "33000118000179": "Moradia",     # Telemar Norte Leste / Oi
    "02558157000162": "Moradia",     # Vivo / Telefonica
    "40432544000147": "Moradia",     # Claro
    "02449992000164": "Moradia",     # TIM
    "00000000000191": "Salário",     # Banco do Brasil (Ex)
}

async def _match_cnpj_category(
    session: AsyncSession, user_id: uuid.UUID, cnpj: Optional[str]
) -> Optional[uuid.UUID]:
    if not cnpj:
        return None
    # Remove all non-numeric chars
    clean_cnpj = "".join(filter(str.isdigit, cnpj))
    if not clean_cnpj:
        return None

    app_name = CNPJ_CATEGORY_MAP.get(clean_cnpj)
    if not app_name:
        for k, v in CNPJ_CATEGORY_MAP.items():
            if clean_cnpj.startswith("".join(filter(str.isdigit, k))):
                app_name = v
                break
                
    if not app_name:
        return None

    result = await session.execute(
        select(Category.id).where(Category.user_id == user_id, Category.name == app_name)
    )
    return result.scalar_one_or_none()


async def _match_pluggy_category(
    session: AsyncSession, user_id: uuid.UUID, pluggy_category: Optional[str]
) -> Optional[uuid.UUID]:
    if not pluggy_category:
        return None
    # Try exact match first, then prefix before " - " (e.g. "Transfer - PIX" → "Transfer")
    app_name = PLUGGY_CATEGORY_MAP.get(pluggy_category)
    if not app_name and " - " in pluggy_category:
        app_name = PLUGGY_CATEGORY_MAP.get(pluggy_category.split(" - ")[0])
    if not app_name:
        return None
    result = await session.execute(
        select(Category.id).where(Category.user_id == user_id, Category.name == app_name)
    )
    return result.scalar_one_or_none()


async def get_connections(session: AsyncSession, user_id: uuid.UUID) -> list[BankConnection]:
    result = await session.execute(
        select(BankConnection)
        .where(BankConnection.user_id == user_id)
        .options(selectinload(BankConnection.accounts))
        .order_by(BankConnection.created_at.desc())
    )
    return list(result.scalars().all())


async def get_connection(
    session: AsyncSession, connection_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[BankConnection]:
    result = await session.execute(
        select(BankConnection)
        .where(BankConnection.id == connection_id, BankConnection.user_id == user_id)
        .options(selectinload(BankConnection.accounts))
    )
    return result.scalar_one_or_none()


def get_oauth_url(provider_name: str, user_id: uuid.UUID) -> str:
    provider = get_provider(provider_name)
    state = str(user_id)
    return provider.get_oauth_url(settings.pluggy_oauth_redirect_uri, state)


async def create_connect_token(
    provider_name: str, user_id: uuid.UUID, item_id: str | None = None
) -> dict:
    provider = get_provider(provider_name)
    token_data = await provider.create_connect_token(str(user_id), item_id=item_id)
    return {"access_token": token_data.access_token}


async def update_connection_settings(
    session: AsyncSession,
    connection_id: uuid.UUID,
    user_id: uuid.UUID,
    settings_update: dict,
) -> Optional[BankConnection]:
    connection = await get_connection(session, connection_id, user_id)
    if not connection:
        return None

    current = dict(connection.settings or {})
    for key, value in settings_update.items():
        if value is not None:
            current[key] = value
    connection.settings = current

    await session.commit()
    await session.refresh(connection)
    return connection


async def handle_oauth_callback(
    session: AsyncSession, user_id: uuid.UUID, code: str, provider_name: str
) -> BankConnection:
    provider = get_provider(provider_name)
    connection_data = await provider.handle_oauth_callback(code)

    connection = BankConnection(
        user_id=user_id,
        provider=provider_name,
        external_id=connection_data.external_id,
        institution_name=connection_data.institution_name,
        credentials=connection_data.credentials,
        status="active",
    )
    session.add(connection)
    await session.flush()

    new_tx_ids: list[uuid.UUID] = []

    for acc_data in connection_data.accounts:
        close_date = None
        due_date = None
        credit_level = None
        if acc_data.credit_data:
            c_str = acc_data.credit_data.get("balanceCloseDate")
            d_str = acc_data.credit_data.get("balanceDueDate")
            if c_str:
                close_date = datetime.fromisoformat(c_str.replace("Z", "+00:00")).date()
            if d_str:
                due_date = datetime.fromisoformat(d_str.replace("Z", "+00:00")).date()
            credit_level = acc_data.credit_data.get("level")

        account = Account(
            user_id=user_id,
            connection_id=connection.id,
            external_id=acc_data.external_id,
            name=acc_data.name,
            type=acc_data.type,
            balance=acc_data.balance,
            currency=acc_data.currency,
            credit_data=acc_data.credit_data,
            balance_close_date=close_date,
            balance_due_date=due_date,
            credit_level=credit_level,
        )
        session.add(account)
        await session.flush()

        # Fetch initial transactions (since=None fetches all available history)
        transactions_data = await provider.get_transactions(
            connection_data.credentials, acc_data.external_id, None
        )
        for txn_data in transactions_data:
            merchant = txn_data.raw_data.get("merchant") or {}
            merchant_cnpj = merchant.get("cnpj")
            merchant_name = merchant.get("businessName") or merchant.get("name")

            category_id = await _match_cnpj_category(session, user_id, merchant_cnpj)
            if not category_id:
                category_id = await _match_pluggy_category(
                    session, user_id, txn_data.pluggy_category
                )

            transaction = Transaction(
                user_id=user_id,
                account_id=account.id,
                external_id=txn_data.external_id,
                description=txn_data.description,
                amount=txn_data.amount,
                date=txn_data.date,
                type=txn_data.type,
                source="sync",
                status=txn_data.status,
                payee=txn_data.payee,
                raw_data=txn_data.raw_data,
                merchant_cnpj=merchant_cnpj,
                merchant_name=merchant_name,
                category_id=category_id,
            )
            session.add(transaction)
            await session.flush()
            new_tx_ids.append(transaction.id)
            if not category_id:
                await apply_rules_to_transaction(session, user_id, transaction)

    # Detect transfer pairs among newly synced transactions
    await detect_transfer_pairs(session, user_id, candidate_ids=new_tx_ids)

    connection.last_sync_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(connection)
    return connection


def _description_similarity(a: str | None, b: str | None) -> float:
    """Token overlap ratio between two descriptions."""
    if not a or not b:
        return 0.0
    tokens_a = set(a.lower().split())
    tokens_b = set(b.lower().split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    return len(intersection) / max(len(tokens_a), len(tokens_b))


async def _fuzzy_match_manual(
    session: AsyncSession,
    account_id: uuid.UUID,
    txn_data,
) -> Optional[Transaction]:
    """Try to find a manual transaction that matches the incoming synced one."""
    date_lo = txn_data.date - timedelta(days=3)
    date_hi = txn_data.date + timedelta(days=3)

    result = await session.execute(
        select(Transaction).where(
            Transaction.account_id == account_id,
            Transaction.external_id.is_(None),
            Transaction.source == "manual",
            Transaction.amount == txn_data.amount,
            Transaction.type == txn_data.type,
            Transaction.date >= date_lo,
            Transaction.date <= date_hi,
        )
    )
    candidates = result.scalars().all()
    if not candidates:
        return None

    best_match = None
    best_score = 0.0
    for candidate in candidates:
        score = _description_similarity(candidate.description, txn_data.description)
        if score > best_score:
            best_score = score
            best_match = candidate

    if best_match and best_score >= 0.6:
        return best_match
    return None


async def sync_connection(
    session: AsyncSession, connection_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[BankConnection, int]:
    connection = await get_connection(session, connection_id, user_id)
    if not connection:
        raise ValueError("Connection not found")

    conn_settings = connection.settings or {}
    payee_source = conn_settings.get("payee_source", "auto")
    import_pending = conn_settings.get("import_pending", True)

    try:
        provider = get_provider(connection.provider)

        # Refresh credentials if needed
        credentials = await provider.refresh_credentials(connection.credentials)
        connection.credentials = credentials

        # Update accounts
        new_tx_ids: list[uuid.UUID] = []
        merged_count = 0
        accounts_data = await provider.get_accounts(credentials)
        for acc_data in accounts_data:
            result = await session.execute(
                select(Account).where(
                    Account.connection_id == connection.id,
                    Account.external_id == acc_data.external_id,
                )
            )
            account = result.scalar_one_or_none()

            close_date = None
            due_date = None
            credit_level = None
            if acc_data.credit_data:
                c_str = acc_data.credit_data.get("balanceCloseDate")
                d_str = acc_data.credit_data.get("balanceDueDate")
                if c_str:
                    close_date = datetime.fromisoformat(c_str.replace("Z", "+00:00")).date()
                if d_str:
                    due_date = datetime.fromisoformat(d_str.replace("Z", "+00:00")).date()
                credit_level = acc_data.credit_data.get("level")

            if account:
                account.balance = acc_data.balance
                account.name = acc_data.name
                account.credit_data = acc_data.credit_data
                account.balance_close_date = close_date
                account.balance_due_date = due_date
                account.credit_level = credit_level
                if acc_data.account_number:
                    account.account_number = acc_data.account_number
            else:
                account = Account(
                    user_id=user_id,
                    connection_id=connection.id,
                    external_id=acc_data.external_id,
                    name=acc_data.name,
                    type=acc_data.type,
                    balance=acc_data.balance,
                    currency=acc_data.currency,
                    credit_data=acc_data.credit_data,
                    balance_close_date=close_date,
                    balance_due_date=due_date,
                    credit_level=credit_level,
                    account_number=acc_data.account_number,
                )
                session.add(account)
                await session.flush()

            if account and account.is_closed:
                continue

            # Fetch and sync transactions
            since = connection.last_sync_at.date() if connection.last_sync_at else None
            transactions_data = await provider.get_transactions(
                credentials, acc_data.external_id, since, payee_source=payee_source
            )

            if not import_pending:
                transactions_data = [t for t in transactions_data if t.status != "pending"]

            for txn_data in transactions_data:
                existing = await session.execute(
                    select(Transaction).where(
                        Transaction.account_id == account.id,
                        Transaction.external_id == txn_data.external_id,
                    )
                )
                existing_tx = existing.scalar_one_or_none()
                if existing_tx:
                    if existing_tx.status == "pending" and txn_data.status == "posted":
                        existing_tx.status = "posted"
                    continue

                # Pass 2: Fuzzy match against manual transactions
                fuzzy_match = await _fuzzy_match_manual(session, account.id, txn_data)
                if fuzzy_match:
                    fuzzy_match.external_id = txn_data.external_id
                    fuzzy_match.source = "sync"
                    fuzzy_match.raw_data = txn_data.raw_data
                    if not fuzzy_match.payee and txn_data.payee:
                        fuzzy_match.payee = txn_data.payee
                    merged_count += 1
                    continue

                merchant = txn_data.raw_data.get("merchant") or {}
                merchant_cnpj = merchant.get("cnpj")
                merchant_name = merchant.get("businessName") or merchant.get("name")

                category_id = await _match_cnpj_category(session, user_id, merchant_cnpj)
                if not category_id:
                    category_id = await _match_pluggy_category(
                        session, user_id, txn_data.pluggy_category
                    )

                transaction = Transaction(
                    user_id=user_id,
                    account_id=account.id,
                    external_id=txn_data.external_id,
                    description=txn_data.description,
                    amount=txn_data.amount,
                    date=txn_data.date,
                    type=txn_data.type,
                    source="sync",
                    status=txn_data.status,
                    payee=txn_data.payee,
                    raw_data=txn_data.raw_data,
                    merchant_cnpj=merchant_cnpj,
                    merchant_name=merchant_name,
                    category_id=category_id,
                )
                session.add(transaction)
                await session.flush()
                new_tx_ids.append(transaction.id)
                if not category_id:
                    await apply_rules_to_transaction(session, user_id, transaction)

        # Detect transfer pairs among newly synced transactions
        if new_tx_ids:
            await detect_transfer_pairs(session, user_id, candidate_ids=new_tx_ids)

        connection.last_sync_at = datetime.now(timezone.utc)
        connection.status = "active"
        await session.commit()
        await session.refresh(connection)
        return connection, merged_count

    except Exception:
        # Mark connection as errored so UI shows reconnect banner
        await session.rollback()
        async with session.begin():
            conn = await session.get(BankConnection, connection_id)
            if conn:
                conn.status = "error"
        raise


async def sync_all_connections(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[str, int]:
    """Sync all active connections for the user and return results."""
    connections = await get_connections(session, user_id)
    results = {}
    for conn in connections:
        if conn.status == "active":
            try:
                _, merged_count = await sync_connection(session, conn.id, user_id)
                results[str(conn.id)] = merged_count
            except Exception:
                results[str(conn.id)] = -1
    return results


async def delete_connection(
    session: AsyncSession, connection_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    connection = await get_connection(session, connection_id, user_id)
    if not connection:
        return False

    await session.delete(connection)
    await session.commit()
    return True
