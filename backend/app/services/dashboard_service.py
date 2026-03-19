import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select, func, case, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.models.transaction import Transaction
from app.models.category import Category
from app.models.recurring_transaction import RecurringTransaction
from app.schemas.dashboard import DashboardSummary, SpendingByCategory, MonthlyTrend, ProjectedTransaction, DailyBalance, BalanceHistory, FinancialScore, HeatmapDay
from app.services.recurring_transaction_service import get_occurrences_in_range
from app.services.asset_service import get_total_asset_value


def _month_range(month: date) -> tuple[date, date]:
    """Return (month_start, month_end) for a given date."""
    month_start = month.replace(day=1)
    if month.month == 12:
        month_end = month.replace(year=month.year + 1, month=1, day=1)
    else:
        month_end = month.replace(month=month.month + 1, day=1)
    return month_start, month_end


async def _get_recurring_projections(
    session: AsyncSession, user_id: uuid.UUID, month_start: date, month_end: date
) -> list[dict]:
    """Compute virtual recurring transaction projections for a month.
    Pure read — no DB writes. Returns list of dicts with category_id, amount, type, currency."""
    result = await session.execute(
        select(RecurringTransaction)
        .where(
            RecurringTransaction.user_id == user_id,
            RecurringTransaction.is_active == True,
            RecurringTransaction.start_date < month_end,
        )
    )
    recurring_list = list(result.scalars().all())

    projections = []
    for rec in recurring_list:
        # Compute occurrences starting from next_occurrence (skips already-created transactions)
        occurrences = get_occurrences_in_range(
            start=rec.next_occurrence,
            frequency=rec.frequency,
            end_date=rec.end_date,
            range_start=month_start,
            range_end=month_end,
        )
        for occ_date in occurrences:
            projections.append({
                "category_id": rec.category_id,
                "amount": float(rec.amount),
                "type": rec.type,
                "currency": rec.currency,
                "date": occ_date,
            })
    return projections


async def get_summary(
    session: AsyncSession, user_id: uuid.UUID, month: Optional[date] = None,
    balance_date: Optional[date] = None, account_id: Optional[uuid.UUID] = None,
) -> DashboardSummary:
    if not month:
        month = date.today().replace(day=1)

    month_start, month_end = _month_range(month)
    today = date.today()

    # Compute the effective cutoff date for balance calculation
    if balance_date:
        cutoff = balance_date
    elif month_end <= today:
        # Past month: last day of that month
        cutoff = month_end - timedelta(days=1)
    else:
        # Current or future month: today
        cutoff = today

    total_balance, cash_balance, credit_balance = await _total_balance_by_currency(session, user_id, cutoff, account_id=account_id)

    # For current/future months, project the total balance by adding recurring
    # projections from cutoff+1 through month_end. (Assuming all projections go to cash)
    if month_end > cutoff:
        projection_start = cutoff + timedelta(days=1)
        balance_projections = await _get_recurring_projections(
            session, user_id, projection_start, month_end
        )
        for proj in balance_projections:
            signed = proj["amount"] if proj["type"] == "credit" else -proj["amount"]
            total_balance[proj["currency"]] = total_balance.get(proj["currency"], 0.0) + signed
            cash_balance[proj["currency"]] = cash_balance.get(proj["currency"], 0.0) + signed

    # Monthly income and expenses — exclude opening_balance so initial deposits
    # don't inflate the month's income figure. Also exclude transfer pairs.
    monthly_filters = [
        Transaction.user_id == user_id,
        Account.is_closed == False,
        Account.type != "credit_card",  # Exclude credit card expenses
        Transaction.date >= month_start,
        Transaction.date < month_end,
        Transaction.source != "opening_balance",
    ]
    if not account_id:
        monthly_filters.append(Transaction.transfer_pair_id.is_(None))
    if account_id:
        monthly_filters.append(Transaction.account_id == account_id)
    monthly_result = await session.execute(
        select(
            func.sum(case((Transaction.type == "credit", Transaction.amount), else_=0)),
            func.sum(case((Transaction.type == "debit", Transaction.amount), else_=0)),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(*monthly_filters)
    )
    monthly_row = monthly_result.one()
    monthly_income = float(monthly_row[0] or 0)
    monthly_expenses = float(monthly_row[1] or 0)

    # Add virtual recurring projections
    projections = await _get_recurring_projections(session, user_id, month_start, month_end)
    for proj in projections:
        if proj["type"] == "credit":
            monthly_income += proj["amount"]
        else:
            monthly_expenses += proj["amount"]

    # Account count — all accounts belonging to the user (manual + bank-connected)
    accounts_count = await session.scalar(
        select(func.count())
        .select_from(Account)
        .where(Account.user_id == user_id)
    ) or 0

    # Pending categorization — exclude opening_balance and transfer pairs
    pending_cat_filters = [
        Transaction.user_id == user_id,
        Transaction.category_id.is_(None),
        Transaction.source != "opening_balance",
        Transaction.transfer_pair_id.is_(None),
    ]
    pending_categorization = await session.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(*pending_cat_filters)
    ) or 0

    pending_categorization_amount = abs(float(await session.scalar(
        select(func.coalesce(func.sum(func.abs(Transaction.amount)), 0))
        .select_from(Transaction)
        .where(*pending_cat_filters)
    ) or 0))

    # Asset values
    assets_value = await get_total_asset_value(session, user_id)

    # Add asset values to total balance and cash balance
    for currency, amount in assets_value.items():
        total_balance[currency] = total_balance.get(currency, 0.0) + amount
        cash_balance[currency] = cash_balance.get(currency, 0.0) + amount

    return DashboardSummary(
        total_balance=total_balance,
        cash_balance=cash_balance,
        credit_balance=credit_balance,
        balance_date=cutoff.isoformat(),
        monthly_income=monthly_income,
        monthly_expenses=abs(monthly_expenses),
        accounts_count=accounts_count,
        pending_categorization=pending_categorization,
        pending_categorization_amount=pending_categorization_amount,
        assets_value=assets_value,
    )


async def get_spending_by_category(
    session: AsyncSession, user_id: uuid.UUID, month: Optional[date] = None,
    account_id: Optional[uuid.UUID] = None,
) -> list[SpendingByCategory]:
    if not month:
        month = date.today().replace(day=1)

    month_start, month_end = _month_range(month)

    spending_filters = [
        Transaction.user_id == user_id,
        Account.is_closed == False,
        Transaction.type == "debit",
        Transaction.date >= month_start,
        Transaction.date < month_end,
    ]
    if not account_id:
        spending_filters.append(Transaction.transfer_pair_id.is_(None))
    if account_id:
        spending_filters.append(Transaction.account_id == account_id)
    result = await session.execute(
        select(
            Category.id,
            Category.name,
            Category.icon,
            Category.color,
            func.sum(Transaction.amount),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(*spending_filters)
        .group_by(Category.id, Category.name, Category.icon, Category.color)
        .order_by(func.sum(Transaction.amount).desc())
    )

    # Build a dict of category_id -> {name, icon, color, total}
    spending_map: dict[str | None, dict] = {}
    for row in result.all():
        cat_id = str(row[0]) if row[0] else None
        spending_map[cat_id] = {
            "name": row[1] or "Sem categoria",
            "icon": row[2] or "circle-help",
            "color": row[3] or "#6B7280",
            "total": abs(float(row[4] or 0)),
        }

    # Add virtual recurring projections (debit only)
    projections = await _get_recurring_projections(session, user_id, month_start, month_end)
    # We need category info for recurring projections — fetch categories
    cat_cache: dict[str, dict] = {}
    for proj in projections:
        if proj["type"] != "debit":
            continue
        cat_id = str(proj["category_id"]) if proj["category_id"] else None
        if cat_id and cat_id not in cat_cache:
            # Fetch category info
            cat_result = await session.execute(
                select(Category.name, Category.icon, Category.color)
                .where(Category.id == proj["category_id"])
            )
            cat_row = cat_result.one_or_none()
            if cat_row:
                cat_cache[cat_id] = {"name": cat_row[0], "icon": cat_row[1], "color": cat_row[2]}
            else:
                cat_cache[cat_id] = {"name": "Sem categoria", "icon": "circle-help", "color": "#6B7280"}

        if cat_id in spending_map:
            spending_map[cat_id]["total"] += proj["amount"]
        else:
            info = cat_cache.get(cat_id, {"name": "Sem categoria", "icon": "circle-help", "color": "#6B7280"})
            spending_map[cat_id] = {
                "name": info["name"],
                "icon": info["icon"],
                "color": info["color"],
                "total": proj["amount"],
            }

    # Convert to list and compute percentages
    grand_total = sum(entry["total"] for entry in spending_map.values())
    spending = []
    for cat_id, entry in sorted(spending_map.items(), key=lambda x: x[1]["total"], reverse=True):
        spending.append(SpendingByCategory(
            category_id=cat_id,
            category_name=entry["name"],
            category_icon=entry["icon"],
            category_color=entry["color"],
            total=entry["total"],
            percentage=(entry["total"] / grand_total * 100) if grand_total else 0,
        ))

    return spending


async def get_monthly_trend(
    session: AsyncSession, user_id: uuid.UUID, months: int = 6
) -> list[MonthlyTrend]:
    month_label = func.to_char(Transaction.date, 'YYYY-MM').label('month')
    result = await session.execute(
        select(
            month_label,
            func.sum(case((Transaction.type == "credit", Transaction.amount), else_=0)),
            func.sum(case((Transaction.type == "debit", Transaction.amount), else_=0)),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.source != "opening_balance",
            Transaction.transfer_pair_id.is_(None),
        )
        .group_by(month_label)
        .order_by(month_label.desc())
        .limit(months)
    )

    trends = []
    for row in result.all():
        trends.append(MonthlyTrend(
            month=row[0],
            income=float(row[1] or 0),
            expenses=abs(float(row[2] or 0)),
        ))

    return list(reversed(trends))


async def get_projected_transactions(
    session: AsyncSession, user_id: uuid.UUID, month: Optional[date] = None
) -> list[ProjectedTransaction]:
    """Return virtual recurring transaction projections for a month,
    enriched with description and category info for display."""
    if not month:
        month = date.today().replace(day=1)

    month_start, month_end = _month_range(month)

    result = await session.execute(
        select(RecurringTransaction)
        .where(
            RecurringTransaction.user_id == user_id,
            RecurringTransaction.is_active == True,
            RecurringTransaction.start_date < month_end,
        )
    )
    recurring_list = list(result.scalars().all())

    # Pre-fetch categories for all recurring templates that have one
    cat_ids = {r.category_id for r in recurring_list if r.category_id}
    cat_map: dict[uuid.UUID, tuple[str, str, str]] = {}
    if cat_ids:
        cat_result = await session.execute(
            select(Category.id, Category.name, Category.icon, Category.color)
            .where(Category.id.in_(cat_ids))
        )
        for row in cat_result.all():
            cat_map[row[0]] = (row[1], row[2], row[3])

    projections: list[ProjectedTransaction] = []
    for rec in recurring_list:
        occurrences = get_occurrences_in_range(
            start=rec.next_occurrence,
            frequency=rec.frequency,
            end_date=rec.end_date,
            range_start=month_start,
            range_end=month_end,
        )
        cat_name, cat_icon, cat_color = cat_map.get(rec.category_id, (None, None, None)) if rec.category_id else (None, None, None)
        for occ_date in occurrences:
            projections.append(ProjectedTransaction(
                recurring_id=str(rec.id),
                description=rec.description,
                amount=float(rec.amount),
                currency=rec.currency,
                type=rec.type,
                date=occ_date.isoformat(),
                category_id=str(rec.category_id) if rec.category_id else None,
                category_name=cat_name,
                category_icon=cat_icon,
                category_color=cat_color,
            ))

    return projections


def _signed_balance_expr():
    """Reusable SQL expression: credit → +amount, debit → −amount."""
    return case(
        (Transaction.type == "credit", Transaction.amount),
        else_=-Transaction.amount,
    )


async def _get_open_accounts(
    session: AsyncSession, user_id: uuid.UUID
) -> list[Account]:
    """Get all non-closed accounts for a user."""
    result = await session.execute(
        select(Account)
        .outerjoin(BankConnection)
        .where(
            or_(Account.user_id == user_id, BankConnection.user_id == user_id),
            Account.is_closed == False,
        )
    )
    return [row[0] for row in result.all()]


async def _account_balance_at(
    session: AsyncSession, account: Account, cutoff: date
) -> float:
    """Get balance for a single account at a specific date.

    For bank-connected accounts, backtrack from the provider's current balance
    by subtracting transaction deltas that occurred after the cutoff.
    For manual accounts, sum transactions up to the cutoff date.
    """
    if account.connection_id:
        # Start from the provider's authoritative current balance
        current_bal = float(account.balance)
        if account.type == "credit_card":
            current_bal = -current_bal
        # Subtract activity after cutoff to get the balance AT cutoff
        delta_after = await session.scalar(
            select(func.coalesce(func.sum(_signed_balance_expr()), 0))
            .where(
                Transaction.account_id == account.id,
                Transaction.date > cutoff,
            )
        )
        return current_bal - float(delta_after or 0)
    else:
        result = await session.scalar(
            select(func.coalesce(func.sum(_signed_balance_expr()), 0))
            .where(
                Transaction.account_id == account.id,
                Transaction.date <= cutoff,
            )
        )
        return float(result or 0)


async def _total_balance_by_currency(
    session: AsyncSession, user_id: uuid.UUID, cutoff: date,
    account_id: Optional[uuid.UUID] = None,
) -> tuple[dict[str, float], dict[str, float], dict[str, dict]]:
    """Get total balance across all open accounts at a date, grouped by currency.
    Returns (total_balance, cash_balance, credit_balance)."""
    accounts = await _get_open_accounts(session, user_id)
    totals: dict[str, float] = {}
    cash: dict[str, float] = {}
    credit: dict[str, dict] = {}
    
    target_connection_id = None
    if account_id:
        # Resolve connection_id for the selected account
        acc_result = await session.execute(select(Account.connection_id).where(Account.id == account_id))
        target_connection_id = acc_result.scalar_one_or_none()

    for account in accounts:
        # If filtering by account, we actually want to show data for the whole 'Bank' (connection)
        # so that credit cards from the same bank aren't hidden when the checking account is selected.
        if account_id and account.id != account_id:
            if not target_connection_id or account.connection_id != target_connection_id:
                continue

        bal = await _account_balance_at(session, account, cutoff)

        totals[account.currency] = totals.get(account.currency, 0.0) + bal
        if account.type == "credit_card":
            if account.currency not in credit:
                credit[account.currency] = {"total_used": 0.0, "current_bill": 0.0, "available_limit": 0.0}
            
            credit[account.currency]["total_used"] += bal
            
            if account.credit_data:
                # Pluggy's availableCreditLimit
                limit = account.credit_data.get("availableCreditLimit", 0.0)
                if limit is None:
                    limit = 0.0
                credit[account.currency]["available_limit"] += float(limit)
                
                # We can try tracking current_bill from other fields if possible, or leave 0 to compute in frontend
                # For now, we will add whatever is in balance or minimumPayment just as placeholder, 
                # but the user requested fatura atual. If there is no exact current bill returned by pluggy API, 
                # we'll approximate or use total_used if needed later on the frontend.
                
        else:
            cash[account.currency] = cash.get(account.currency, 0.0) + bal

    return totals, cash, credit


async def _balance_at(
    session: AsyncSession, user_id: uuid.UUID, cutoff: date
) -> float:
    """Get total balance across all open accounts at a specific date (single currency sum)."""
    totals, _, _ = await _total_balance_by_currency(session, user_id, cutoff)
    return sum(totals.values())


async def _daily_deltas(
    session: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> dict[int, float]:
    """Get daily balance deltas for a date range [start, end)."""
    result = await session.execute(
        select(
            func.extract("day", Transaction.date).label("day"),
            func.sum(_signed_balance_expr()),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.date >= start,
            Transaction.date < end,
        )
        .group_by("day")
    )
    return {int(row[0]): float(row[1] or 0) for row in result.all()}


async def get_balance_history(
    session: AsyncSession, user_id: uuid.UUID, month: Optional[date] = None
) -> BalanceHistory:
    if not month:
        month = date.today().replace(day=1)

    month_start, month_end = _month_range(month)
    prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
    prev_month_end = month_start

    today = date.today()
    is_current = month_start.year == today.year and month_start.month == today.month
    days_in_month = (month_end - month_start).days
    cutoff_day = today.day if is_current else days_in_month

    prev_days_in_month = (prev_month_end - prev_month_start).days

    # Starting balances
    current_start = await _balance_at(session, user_id, month_start - timedelta(days=1))
    prev_start = await _balance_at(session, user_id, prev_month_start - timedelta(days=1))

    # Daily deltas from real transactions
    current_deltas = await _daily_deltas(session, user_id, month_start, month_end)
    prev_deltas = await _daily_deltas(session, user_id, prev_month_start, prev_month_end)

    # Recurring projections for future days of current month
    proj_deltas: dict[int, float] = {}
    if month_end > today:
        proj_start = max(month_start, today + timedelta(days=1))
        projections = await _get_recurring_projections(session, user_id, proj_start, month_end)
        for proj in projections:
            day = proj["date"].day
            signed = proj["amount"] if proj["type"] == "credit" else -proj["amount"]
            proj_deltas[day] = proj_deltas.get(day, 0) + signed

    # Build current month daily balances
    current_daily = []
    balance = current_start
    for day in range(1, days_in_month + 1):
        balance += current_deltas.get(day, 0) + proj_deltas.get(day, 0)
        
        if day < cutoff_day:
            current_daily.append(DailyBalance(day=day, balance=round(balance, 2), projected_balance=None))
        elif day == cutoff_day:
            current_daily.append(DailyBalance(day=day, balance=round(balance, 2), projected_balance=round(balance, 2)))
        else:
            current_daily.append(DailyBalance(day=day, balance=None, projected_balance=round(balance, 2)))

    # Build previous month daily balances
    prev_daily = []
    balance = prev_start
    for day in range(1, prev_days_in_month + 1):
        balance += prev_deltas.get(day, 0)
        prev_daily.append(DailyBalance(day=day, balance=round(balance, 2)))

    return BalanceHistory(current=current_daily, previous=prev_daily)


async def get_financial_score(
    session: AsyncSession, user_id: uuid.UUID, month: Optional[date] = None
) -> FinancialScore:
    if not month:
        month = date.today().replace(day=1)
        
    summary = await get_summary(session, user_id, month)
    
    # TP (Taxa de Poupança)
    income = summary.monthly_income
    expenses = summary.monthly_expenses
    tp = ((income - expenses) / income * 100) if income > 0 else 0.0
    
    # IC (Índice de Comprometimento com custos fixos)
    projected = await get_projected_transactions(session, user_id, month)
    fixed_expenses = sum(p.amount for p in projected if p.type == "debit")
    ic = (fixed_expenses / income * 100) if income > 0 else 0.0
    
    # Trend (Tendência comparando o mês atual/ultimo relatorio com o anterior)
    trend_data = await get_monthly_trend(session, user_id, 3)
    trend_score = 50
    if len(trend_data) >= 2:
        if trend_data[0].expenses <= trend_data[1].expenses:
            trend_score = 80 # Doing better
        else:
            trend_score = 30 # Spending more
            
    # Calculate Final Score (0-100)
    # 30% TP, 25% IC, 20% Trend, 25% Base/Diversification
    tp_points = max(min(tp, 30), 0)
    ic_points = max(25 - (ic / 100 * 25), 0) if ic <= 100 else 0
    trend_points = (trend_score / 100) * 20
    
    uncat_penalty = 10 if summary.pending_categorization > 10 else 0
    
    final_score = int(tp_points + ic_points + trend_points + 25 - uncat_penalty)
    final_score = max(min(final_score, 100), 0)
    
    if final_score >= 80:
        level = "Excelente"
    elif final_score >= 65:
        level = "Boa"
    elif final_score >= 50:
        level = "Atenção"
    else:
        level = "Crítica"
        
    return FinancialScore(
        score=final_score,
        health_level=level,
        savings_rate=round(float(tp), 1),
        commitment_index=round(float(ic), 1)
    )

async def get_spending_heatmap(
    session: AsyncSession, user_id: uuid.UUID, months: int = 6
) -> list[HeatmapDay]:
    from datetime import date, timedelta
    today = date.today()
    
    # Calculate start date ~6 months ago, first day of that month
    start_date = (today.replace(day=1) - timedelta(days=months * 30)).replace(day=1)
    
    result = await session.execute(
        select(
            func.date(Transaction.date),
            func.sum(Transaction.amount)
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.type == "debit",
            Transaction.date >= start_date,
            Transaction.date <= today,
            Transaction.source != "opening_balance",
            Transaction.transfer_pair_id.is_(None),
        )
        .group_by(func.date(Transaction.date))
        .order_by(func.date(Transaction.date))
    )
    
    daily_totals: dict[date, float] = {row[0]: float(row[1] or 0) for row in result.all()}
    
    # Fill in all dates with 0
    all_days = []
    current_date = start_date
    while current_date <= today:
        amt = daily_totals.get(current_date, 0.0)
        all_days.append({"date": current_date.isoformat(), "amount": amt})
        current_date += timedelta(days=1)
        
    # Calculate levels. We want to exclude 0 from calculating percentiles/quartiles
    non_zero_amounts = [d["amount"] for d in all_days if d["amount"] > 0]
    
    if not non_zero_amounts:
        return [HeatmapDay(date=d["date"], amount=d["amount"], level=0) for d in all_days]
        
    non_zero_amounts.sort()
    
    def get_percentile(data, percentile):
        k = (len(data) - 1) * percentile
        f = int(k)
        c = int(k) + 1 if k > int(k) else int(k)
        if f == c:
            return data[f]
        d0 = data[f] * (c - k)
        d1 = data[c] * (k - f)
        return d0 + d1

    q1 = get_percentile(non_zero_amounts, 0.25)
    q2 = get_percentile(non_zero_amounts, 0.50)
    q3 = get_percentile(non_zero_amounts, 0.75)
    
    heatmap_res = []
    for d in all_days:
        amt = d["amount"]
        if amt == 0:
            lvl = 0
        elif amt <= q1:
            lvl = 1
        elif amt <= q2:
            lvl = 2
        elif amt <= q3:
            lvl = 3
        else:
            lvl = 4
        heatmap_res.append(HeatmapDay(date=d["date"], amount=amt, level=lvl))
        
    return heatmap_res
