import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import String, select, desc, func, case, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.asset import Asset
from app.models.asset_value import AssetValue
from app.models.transaction import Transaction
from app.models.category import Category
from app.schemas.report import (
    CategoryTrendItem,
    InstallmentItem,
    InstallmentsResponse,
    ReportBreakdown,
    ReportCompositionItem,
    ReportDataPoint,
    ReportMeta,
    ReportResponse,
    ReportSummary,
)
from app.services.dashboard_service import _get_open_accounts, _account_balance_at


async def _asset_value_at(
    session: AsyncSession, user_id: uuid.UUID, cutoff: date
) -> float:
    """Sum of all active (non-archived, non-sold) asset values at a given date.

    For each asset, finds the most recent AssetValue with date <= cutoff.
    Falls back to purchase_price if no value entries exist before the cutoff
    (but only if purchase_date <= cutoff or purchase_date is None).
    """
    result = await session.execute(
        select(Asset).where(
            Asset.user_id == user_id,
            Asset.is_archived == False,
            Asset.sell_date.is_(None),
        )
    )
    assets = list(result.scalars().all())

    total = 0.0
    for asset in assets:
        # Find most recent value entry at or before the cutoff
        val_result = await session.execute(
            select(AssetValue.amount)
            .where(
                AssetValue.asset_id == asset.id,
                AssetValue.date <= cutoff,
            )
            .order_by(desc(AssetValue.date), desc(AssetValue.id))
            .limit(1)
        )
        row = val_result.scalar_one_or_none()
        if row is not None:
            total += float(row)
        elif asset.purchase_price is not None:
            # Fall back to purchase_price if the asset existed by cutoff
            if asset.purchase_date is None or asset.purchase_date <= cutoff:
                total += float(asset.purchase_price)

    return total


async def _net_worth_at(
    session: AsyncSession, user_id: uuid.UUID, cutoff: date
) -> ReportDataPoint:
    """Compute a single net worth snapshot at a given date."""
    accounts = await _get_open_accounts(session, user_id)

    accounts_total = 0.0
    liabilities_total = 0.0

    for account in accounts:
        bal = await _account_balance_at(session, account, cutoff)
        if account.type == "credit_card":
            # _account_balance_at already negates credit_card; show as positive liability
            liabilities_total += abs(bal)
        else:
            accounts_total += bal

    assets_total = await _asset_value_at(session, user_id, cutoff)
    net_worth = accounts_total + assets_total - liabilities_total

    return ReportDataPoint(
        date=cutoff.isoformat(),
        value=round(net_worth, 2),
        breakdowns={
            "accounts": round(accounts_total, 2),
            "assets": round(assets_total, 2),
            "liabilities": round(liabilities_total, 2),
        },
    )


def _format_date_label(d: date, interval: str) -> str:
    """Format a date point based on interval granularity."""
    if interval == "daily":
        return d.isoformat()
    elif interval == "weekly":
        iso_year, iso_week, _ = d.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    elif interval == "monthly":
        return f"{d.year}-{d.month:02d}"
    elif interval == "yearly":
        return str(d.year)
    return d.isoformat()


def _date_points(
    start: date, end: date, interval: str
) -> list[date]:
    """Generate date points between start and end for the given interval."""
    points: list[date] = []
    current = start

    if interval == "daily":
        while current <= end:
            points.append(current)
            current += timedelta(days=1)
    elif interval == "weekly":
        while current <= end:
            points.append(current)
            current += timedelta(weeks=1)
    elif interval == "monthly":
        while current <= end:
            points.append(current)
            # Advance by one month
            month = current.month + 1
            year = current.year
            if month > 12:
                month = 1
                year += 1
            day = min(current.day, 28)
            current = date(year, month, day)
    elif interval == "yearly":
        while current <= end:
            points.append(current)
            current = date(current.year + 1, current.month, current.day)
    else:
        # Default to monthly
        return _date_points(start, end, "monthly")

    # Ensure the last point uses `end` so the final snapshot reflects today's data.
    # If the last generated point is in the same period as `end`, replace it;
    # otherwise append `end` as a new point.
    if points and points[-1] < end:
        if _format_date_label(points[-1], interval) == _format_date_label(end, interval):
            points[-1] = end  # same label, use today's cutoff
        else:
            points.append(end)

    return points


async def get_net_worth_report(
    session: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
    interval: str = "monthly",
    currency: str = "BRL",
    account_id: Optional[uuid.UUID] = None,
) -> ReportResponse:
    """Build a full ReportResponse for net worth over time."""
    today = date.today()
    start = date(today.year, today.month, 1) - timedelta(days=months * 30)
    start = start.replace(day=1)  # Align to month start

    points = _date_points(start, today, interval)

    # Compute snapshot at each date point
    trend: list[ReportDataPoint] = []
    for point in points:
        dp = await _net_worth_at(session, user_id, point)
        dp.date = _format_date_label(point, interval)
        trend.append(dp)

    # Current snapshot (last point) and previous (first point) for summary
    current = trend[-1] if trend else ReportDataPoint(
        date="", value=0, breakdowns={"accounts": 0, "assets": 0, "liabilities": 0}
    )
    previous = trend[0] if len(trend) > 1 else current

    change_amount = current.value - previous.value
    change_percent = (
        (change_amount / abs(previous.value) * 100)
        if previous.value != 0
        else None
    )

    summary = ReportSummary(
        primary_value=current.value,
        change_amount=round(change_amount, 2),
        change_percent=round(change_percent, 2) if change_percent is not None else None,
        breakdowns=[
            ReportBreakdown(
                key="accounts",
                label="Accounts",
                value=current.breakdowns.get("accounts", 0),
                color="#6366F1",
            ),
            ReportBreakdown(
                key="assets",
                label="Assets",
                value=current.breakdowns.get("assets", 0),
                color="#F59E0B",
            ),
            ReportBreakdown(
                key="liabilities",
                label="Liabilities",
                value=current.breakdowns.get("liabilities", 0),
                color="#F43F5E",
            ),
        ],
    )

    meta = ReportMeta(
        type="net_worth",
        series_keys=["accounts", "assets", "liabilities"],
        currency=currency,
        interval=interval,
    )

    # Build per-item composition from current snapshot
    account_type_colors = {
        "checking": "#6366F1",
        "savings": "#3B82F6",
        "credit_card": "#F43F5E",
        "investment": "#8B5CF6",
        "wallet": "#F59E0B",
    }
    asset_type_colors = {
        "real_estate": "#0EA5E9",
        "vehicle": "#14B8A6",
        "valuable": "#F59E0B",
        "investment": "#8B5CF6",
        "other": "#6B7280",
    }
    composition: list[ReportCompositionItem] = []
    accounts = await _get_open_accounts(session, user_id)
    for account in accounts:
        bal = await _account_balance_at(session, account, today)
        if account.type == "credit_card":
            composition.append(ReportCompositionItem(
                key=str(account.id),
                label=account.name,
                value=round(abs(bal), 2),
                color=account_type_colors.get(account.type, "#6B7280"),
                group="liabilities",
            ))
        else:
            if bal > 0:
                composition.append(ReportCompositionItem(
                    key=str(account.id),
                    label=account.name,
                    value=round(bal, 2),
                    color=account_type_colors.get(account.type, "#6B7280"),
                    group="accounts",
                ))

    # Assets
    asset_result = await session.execute(
        select(Asset).where(
            Asset.user_id == user_id,
            Asset.is_archived == False,
            Asset.sell_date.is_(None),
        )
    )
    for asset in asset_result.scalars().all():
        val_result = await session.execute(
            select(AssetValue.amount)
            .where(AssetValue.asset_id == asset.id, AssetValue.date <= today)
            .order_by(desc(AssetValue.date), desc(AssetValue.id))
            .limit(1)
        )
        val = val_result.scalar_one_or_none()
        if val is not None:
            amount = float(val)
        elif asset.purchase_price is not None and (
            asset.purchase_date is None or asset.purchase_date <= today
        ):
            amount = float(asset.purchase_price)
        else:
            amount = 0.0
        if amount > 0:
            composition.append(ReportCompositionItem(
                key=str(asset.id),
                label=asset.name,
                value=round(amount, 2),
                color=asset_type_colors.get(asset.type, "#6B7280"),
                group="assets",
            ))

    return ReportResponse(summary=summary, trend=trend, meta=meta, composition=composition)


def _interval_label_expr(interval: str):
    """SQL expression that groups transaction dates into interval buckets."""
    if interval == "daily":
        return func.to_char(Transaction.date, 'YYYY-MM-DD')
    elif interval == "weekly":
        return func.concat(
            func.extract('isoyear', Transaction.date).cast(String),
            '-W',
            func.lpad(func.extract('week', Transaction.date).cast(String), 2, '0'),
        )
    elif interval == "yearly":
        return func.to_char(Transaction.date, 'YYYY')
    else:  # monthly (default)
        return func.to_char(Transaction.date, 'YYYY-MM')


async def get_income_expenses_report(
    session: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
    interval: str = "monthly",
    currency: str = "BRL",
    account_id: Optional[uuid.UUID] = None,
) -> ReportResponse:
    """Build a ReportResponse for income vs expenses over time."""
    today = date.today()
    start = date(today.year, today.month, 1) - timedelta(days=months * 30)
    start = start.replace(day=1)

    label_expr = _interval_label_expr(interval).label('period')

    result = await session.execute(
        select(
            label_expr,
            func.sum(case((Transaction.type == "credit", Transaction.amount), else_=0)),
            func.sum(case((Transaction.type == "debit", Transaction.amount), else_=0)),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.date >= start,
            Transaction.date <= today,
            Transaction.source != "opening_balance",
            Transaction.transfer_pair_id.is_(None),
            *([Transaction.account_id == account_id] if account_id else []),
        )
        .group_by(label_expr)
        .order_by(label_expr)
    )

    # Build data map from query results
    data_map: dict[str, tuple[float, float]] = {}
    for row in result.all():
        income = float(row[1] or 0)
        expenses = abs(float(row[2] or 0))
        data_map[row[0]] = (income, expenses)

    # Generate all expected date points and map to results
    points = _date_points(start, today, interval)
    trend: list[ReportDataPoint] = []
    total_income = 0.0
    total_expenses = 0.0

    for point in points:
        label = _format_date_label(point, interval)
        income, expenses = data_map.get(label, (0.0, 0.0))
        net = round(income - expenses, 2)
        total_income += income
        total_expenses += expenses
        trend.append(ReportDataPoint(
            date=label,
            value=net,
            breakdowns={
                "income": round(income, 2),
                "expenses": round(expenses, 2),
            },
        ))

    total_net = round(total_income - total_expenses, 2)

    # Compare last point vs first point net income
    current_net = trend[-1].value if trend else 0.0
    previous_net = trend[0].value if len(trend) > 1 else 0.0
    change_amount = current_net - previous_net
    change_percent = (
        (change_amount / abs(previous_net) * 100)
        if previous_net != 0
        else None
    )

    summary = ReportSummary(
        primary_value=total_net,
        change_amount=round(change_amount, 2),
        change_percent=round(change_percent, 2) if change_percent is not None else None,
        breakdowns=[
            ReportBreakdown(
                key="income",
                label="Income",
                value=round(total_income, 2),
                color="#10B981",
            ),
            ReportBreakdown(
                key="expenses",
                label="Expenses",
                value=round(total_expenses, 2),
                color="#F43F5E",
            ),
            ReportBreakdown(
                key="netIncome",
                label="Net Income",
                value=total_net,
                color="#6366F1",
            ),
        ],
    )

    meta = ReportMeta(
        type="income_expenses",
        series_keys=["income", "expenses"],
        currency=currency,
        interval=interval,
    )

    # Build per-category composition for the full date range
    cat_result = await session.execute(
        select(
            Category.id,
            Category.name,
            Category.color,
            Transaction.type,
            func.sum(Transaction.amount),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.date >= start,
            Transaction.date <= today,
            Transaction.source != "opening_balance",
            Transaction.transfer_pair_id.is_(None),
            *([Transaction.account_id == account_id] if account_id else []),
        )
        .group_by(Category.id, Category.name, Category.color, Transaction.type)
    )
    composition: list[ReportCompositionItem] = []
    for row in cat_result.all():
        cat_id, cat_name, cat_color, txn_type, total_amount = row
        amount = abs(float(total_amount or 0))
        if amount <= 0:
            continue
        composition.append(ReportCompositionItem(
            key=str(cat_id) if cat_id else "uncategorized",
            label=cat_name if cat_name else "Uncategorized",
            value=round(amount, 2),
            color=cat_color if cat_color else "#6B7280",
            group="income" if txn_type == "credit" else "expenses",
        ))

    # Build per-category trend (sparklines) for the full date range
    cat_trend_result = await session.execute(
        select(
            label_expr,
            Category.id,
            Category.name,
            Category.color,
            Transaction.type,
            func.sum(Transaction.amount),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.date >= start,
            Transaction.date <= today,
            Transaction.source != "opening_balance",
            Transaction.transfer_pair_id.is_(None),
            *([Transaction.account_id == account_id] if account_id else []),
        )
        .group_by(label_expr, Category.id, Category.name, Category.color, Transaction.type)
    )

    # Collect into dict[(cat_key, group)] -> {label, color, total, periods}
    cat_trend_map: dict[tuple[str, str], dict] = {}
    for row in cat_trend_result.all():
        period_label, cat_id, cat_name, cat_color, txn_type, total_amount = row
        amount = abs(float(total_amount or 0))
        if amount <= 0:
            continue
        cat_key = str(cat_id) if cat_id else "uncategorized"
        group = "income" if txn_type == "credit" else "expenses"
        map_key = (cat_key, group)
        if map_key not in cat_trend_map:
            cat_trend_map[map_key] = {
                "label": cat_name if cat_name else "Uncategorized",
                "color": cat_color if cat_color else "#6B7280",
                "total": 0.0,
                "periods": {},
            }
        cat_trend_map[map_key]["total"] += amount
        cat_trend_map[map_key]["periods"][period_label] = (
            cat_trend_map[map_key]["periods"].get(period_label, 0.0) + amount
        )

    # Build period labels from the same points used by the trend
    period_labels = [_format_date_label(p, interval) for p in points]

    # Top 6 + Other per group
    category_trend: list[CategoryTrendItem] = []
    for group in ("expenses", "income"):
        group_items = [
            (k, v) for (k, g), v in cat_trend_map.items() if g == group
        ]
        group_items.sort(key=lambda x: x[1]["total"], reverse=True)
        top = group_items[:6]
        rest = group_items[6:]

        for cat_key, info in top:
            series = [
                ReportDataPoint(
                    date=pl,
                    value=round(info["periods"].get(pl, 0.0), 2),
                    breakdowns={},
                )
                for pl in period_labels
            ]
            category_trend.append(CategoryTrendItem(
                key=cat_key,
                label=info["label"],
                color=info["color"],
                total=round(info["total"], 2),
                group=group,
                series=series,
            ))

        if rest:
            other_total = sum(v["total"] for _, v in rest)
            other_periods: dict[str, float] = {}
            for _, v in rest:
                for pl, amt in v["periods"].items():
                    other_periods[pl] = other_periods.get(pl, 0.0) + amt
            series = [
                ReportDataPoint(
                    date=pl,
                    value=round(other_periods.get(pl, 0.0), 2),
                    breakdowns={},
                )
                for pl in period_labels
            ]
            category_trend.append(CategoryTrendItem(
                key="other",
                label="Other",
                color="#6B7280",
                total=round(other_total, 2),
                group=group,
                series=series,
            ))

    return ReportResponse(
        summary=summary, trend=trend, meta=meta,
        composition=composition, category_trend=category_trend,
    )


async def get_credit_card_report(
    session: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
    interval: str = "monthly",
    currency: str = "BRL",
    account_id: Optional[uuid.UUID] = None,
) -> ReportResponse:
    """Credit card spending report — similar to income/expenses but filtered to credit_card accounts."""
    today = date.today()
    start = date(today.year, today.month, 1) - timedelta(days=months * 30)
    start = start.replace(day=1)

    label_expr = _interval_label_expr(interval).label("period")

    filters = [
        Transaction.user_id == user_id,
        Account.is_closed == False,
        Account.type == "credit_card",
        Transaction.date >= start,
        Transaction.date <= today,
        Transaction.source != "opening_balance",
        Transaction.transfer_pair_id.is_(None),
    ]
    if account_id:
        filters.append(Transaction.account_id == account_id)

    result = await session.execute(
        select(
            label_expr,
            func.sum(case((Transaction.type == "debit", Transaction.amount), else_=0)),
            func.sum(case((Transaction.type == "credit", Transaction.amount), else_=0)),
        )
        .join(Account, Transaction.account_id == Account.id)
        .where(*filters)
        .group_by(label_expr)
        .order_by(label_expr)
    )

    data_map: dict[str, tuple[float, float]] = {}
    for row in result.all():
        spending = abs(float(row[1] or 0))
        payments = float(row[2] or 0)
        data_map[row[0]] = (spending, payments)

    points = _date_points(start, today, interval)
    trend: list[ReportDataPoint] = []
    total_spending = 0.0
    total_payments = 0.0

    for point in points:
        label = _format_date_label(point, interval)
        spending, payments = data_map.get(label, (0.0, 0.0))
        total_spending += spending
        total_payments += payments
        trend.append(ReportDataPoint(
            date=label,
            value=round(spending, 2),
            breakdowns={
                "spending": round(spending, 2),
                "payments": round(payments, 2),
            },
        ))

    # Summary
    current_val = trend[-1].value if trend else 0.0
    previous_val = trend[0].value if len(trend) > 1 else 0.0
    change = current_val - previous_val
    change_pct = (change / abs(previous_val) * 100) if previous_val != 0 else None

    summary = ReportSummary(
        primary_value=round(total_spending, 2),
        change_amount=round(change, 2),
        change_percent=round(change_pct, 2) if change_pct is not None else None,
        breakdowns=[
            ReportBreakdown(key="spending", label="Spending", value=round(total_spending, 2), color="#F43F5E"),
            ReportBreakdown(key="payments", label="Payments", value=round(total_payments, 2), color="#10B981"),
        ],
    )

    meta = ReportMeta(
        type="credit_card",
        series_keys=["spending", "payments"],
        currency=currency,
        interval=interval,
    )

    # Category composition
    cat_result = await session.execute(
        select(
            Category.id, Category.name, Category.color,
            func.sum(Transaction.amount),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            *filters,
            Transaction.type == "debit",
        )
        .group_by(Category.id, Category.name, Category.color)
    )
    composition: list[ReportCompositionItem] = []
    for row in cat_result.all():
        cat_id, cat_name, cat_color, total_amount = row
        amount = abs(float(total_amount or 0))
        if amount <= 0:
            continue
        composition.append(ReportCompositionItem(
            key=str(cat_id) if cat_id else "uncategorized",
            label=cat_name if cat_name else "Uncategorized",
            value=round(amount, 2),
            color=cat_color if cat_color else "#6B7280",
            group="expenses",
        ))
    # Build per-category trend (sparklines)
    cat_trend_result = await session.execute(
        select(
            label_expr,
            Category.id,
            Category.name,
            Category.color,
            func.sum(Transaction.amount),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(
            *filters,
            Transaction.type == "debit",
        )
        .group_by(label_expr, Category.id, Category.name, Category.color)
    )

    cat_trend_map: dict[str, dict] = {}
    for row in cat_trend_result.all():
        period_label, cat_id, cat_name, cat_color, total_amount = row
        amount = abs(float(total_amount or 0))
        if amount <= 0:
            continue
        cat_key = str(cat_id) if cat_id else "uncategorized"
        if cat_key not in cat_trend_map:
            cat_trend_map[cat_key] = {
                "label": cat_name if cat_name else "Uncategorized",
                "color": cat_color if cat_color else "#6B7280",
                "total": 0.0,
                "periods": {},
            }
        cat_trend_map[cat_key]["total"] += amount
        cat_trend_map[cat_key]["periods"][period_label] = (
            cat_trend_map[cat_key]["periods"].get(period_label, 0.0) + amount
        )

    period_labels = [_format_date_label(p, interval) for p in points]

    category_trend: list[CategoryTrendItem] = []
    group_items = sorted(cat_trend_map.items(), key=lambda x: x[1]["total"], reverse=True)
    top = group_items[:6]
    rest = group_items[6:]

    for cat_key, info in top:
        series = [
            ReportDataPoint(
                date=pl, value=round(info["periods"].get(pl, 0.0), 2), breakdowns={},
            )
            for pl in period_labels
        ]
        category_trend.append(CategoryTrendItem(
            key=cat_key, label=info["label"], color=info["color"],
            total=round(info["total"], 2), group="expenses", series=series,
        ))

    if rest:
        other_total = sum(v["total"] for _, v in rest)
        other_periods: dict[str, float] = {}
        for _, v in rest:
            for pl, amt in v["periods"].items():
                other_periods[pl] = other_periods.get(pl, 0.0) + amt
        series = [
            ReportDataPoint(
                date=pl, value=round(other_periods.get(pl, 0.0), 2), breakdowns={},
            )
            for pl in period_labels
        ]
        category_trend.append(CategoryTrendItem(
            key="other", label="Other", color="#6B7280",
            total=round(other_total, 2), group="expenses", series=series,
        ))

    return ReportResponse(
        summary=summary, trend=trend, meta=meta,
        composition=composition, category_trend=category_trend,
    )


async def get_installments_report(
    session: AsyncSession,
    user_id: uuid.UUID,
    account_id: Optional[uuid.UUID] = None,
) -> InstallmentsResponse:
    """List active installment purchases from credit card transactions."""
    filters = [
        Transaction.user_id == user_id,
        Account.type == "credit_card",
        Account.is_closed == False,
        Transaction.type == "debit",
        Transaction.raw_data.isnot(None),
    ]
    if account_id:
        filters.append(Transaction.account_id == account_id)

    result = await session.execute(
        select(Transaction, Account.name.label("account_name"), Category.name.label("cat_name"), Category.color.label("cat_color"))
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(*filters)
        .order_by(desc(Transaction.date))
    )

    # Group by description + total installments to find unique installment series
    installment_map: dict[str, dict] = {}
    for row in result.all():
        txn = row[0]
        acc_name = row.account_name
        cat_name = row.cat_name
        cat_color = row.cat_color

        if not txn.raw_data:
            continue
        cc_meta = txn.raw_data.get("creditCardMetadata")
        if not cc_meta:
            continue
        total_inst = cc_meta.get("totalInstallments")
        current_inst = cc_meta.get("installmentNumber")
        if not total_inst or not current_inst or int(total_inst) <= 1:
            continue

        total_inst = int(total_inst)
        current_inst = int(current_inst)
        inst_amount = abs(float(txn.amount))

        # Normalize description: remove " 1/12", " 01/12" from the end
        import re
        norm_desc = re.sub(r'\s*\d{1,2}/\d{1,2}\s*$', '', txn.description).strip()

        # Use description + total as group key
        group_key = f"{norm_desc}|{total_inst}|{acc_name}"

        if group_key not in installment_map:
            installment_map[group_key] = {
                "description": norm_desc,
                "account_name": acc_name,
                "installment_amount": inst_amount,
                "total_installments": total_inst,
                "max_current": current_inst,
                "total_amount": inst_amount * total_inst,
                "category_name": cat_name,
                "category_color": cat_color,
                "date": txn.date.isoformat() if txn.date else "",
            }
        else:
            entry = installment_map[group_key]
            if current_inst > entry["max_current"]:
                entry["max_current"] = current_inst
                entry["date"] = txn.date.isoformat() if txn.date else ""

    items: list[InstallmentItem] = []
    total_remaining = 0.0
    total_monthly = 0.0

    # Clean stale installments
    from datetime import timedelta

    for info in installment_map.values():
        remaining_installments = info["total_installments"] - info["max_current"]
        if remaining_installments <= 0:
            continue  # Fully paid

        if info["date"]:
            last_dt = date.fromisoformat(info["date"])
            expected_end = last_dt + timedelta(days=remaining_installments * 30)
            if expected_end < date.today() - timedelta(days=30):
                continue  # Stale, expected end date was >30 days ago

        remaining_amount = info["installment_amount"] * remaining_installments
        total_remaining += remaining_amount
        total_monthly += info["installment_amount"]

        items.append(InstallmentItem(
            description=info["description"],
            account_name=info["account_name"],
            total_amount=round(info["total_amount"], 2),
            installment_amount=round(info["installment_amount"], 2),
            current_installment=info["max_current"],
            total_installments=info["total_installments"],
            remaining_amount=round(remaining_amount, 2),
            category_name=info["category_name"],
            category_color=info["category_color"],
            date=info["date"],
        ))

    # Sort by remaining amount descending
    items.sort(key=lambda x: x.remaining_amount, reverse=True)

    return InstallmentsResponse(
        items=items,
        total_remaining=round(total_remaining, 2),
        total_monthly=round(total_monthly, 2),
        count=len(items),
    )


async def get_reports_heatmap(
    session: AsyncSession,
    user_id: uuid.UUID,
    months: int = 6,
    heatmap_type: str = "all",
    account_id: Optional[uuid.UUID] = None,
) -> list[dict]:
    """Generate heatmap data for reports page. type=credit_card or all."""
    from datetime import timedelta
    from app.schemas.dashboard import HeatmapDay

    today = date.today()
    start_date = (today.replace(day=1) - timedelta(days=months * 30)).replace(day=1)

    exclude_categories = ["Salário", "Investimentos"]

    filters = [
        Transaction.user_id == user_id,
        # Only filter is_closed if a specific account_id is provided
        # or if heatmap_type is specific. But let's allow "historical" views normally.
        Transaction.date >= start_date,
        Transaction.date <= today,
        Transaction.source != "opening_balance",
        Transaction.transfer_pair_id.is_(None),
    ]
    if heatmap_type == "credit_card":
        filters.append(Account.type == "credit_card")
        filters.append(Account.is_closed == False) # For specific cards, only show active ones?
    if account_id:
        filters.append(Transaction.account_id == account_id)
        # If user explicitly selected an account, we don't need to force is_closed=False 
        # because they chose that specific ID.

    # Exclude income/transfers
    filters.append(
        or_(
            Category.id.is_(None),
            ~Category.name.in_(exclude_categories)
        )
    )

    result = await session.execute(
        select(
            func.date(Transaction.date),
            Transaction.amount,
            Transaction.description,
            Category.name.label("category_name"),
            Transaction.type
        )
        .join(Account, Transaction.account_id == Account.id)
        .outerjoin(Category, Transaction.category_id == Category.id)
        .where(*filters)
    )

    daily_totals: dict[date, float] = {}
    daily_items: dict[date, dict[str, float]] = {}

    for row in result.all():
        dt = row[0]
        # Calculate signed amount: debits are positive spending, credits are negative spending
        raw_amt = float(row[1] or 0)
        if row.type == "credit":
            amt = -raw_amt
        else:
            amt = raw_amt
            
        desc = row.category_name or row.description or "Outros"

        if dt not in daily_totals:
            daily_totals[dt] = 0.0
            daily_items[dt] = {}

        daily_totals[dt] += amt
        # Individual items in tooltip should probably show absolute values but identify signed context?
        # For now, let's keep them absolute for the 'top items' list but ensure the total is net.
        abs_amt = abs(amt)
        daily_items[dt][desc] = daily_items[dt].get(desc, 0.0) + abs_amt

    all_days = []
    current_date = start_date
    while current_date <= today:
        amt = daily_totals.get(current_date, 0.0)
        items = daily_items.get(current_date, {})
        top_item = max(items.items(), key=lambda x: x[1])[0] if items else None

        all_days.append({
            "date": current_date.isoformat(), 
            "amount": amt,
            "top_item": top_item
        })
        current_date += timedelta(days=1)

    non_zero_amounts = [d["amount"] for d in all_days if d["amount"] > 0]
    if not non_zero_amounts:
        return [{"date": d["date"], "amount": d["amount"], "level": 0} for d in all_days]

    non_zero_amounts.sort()

    def get_percentile(data, percentile):
        k = (len(data) - 1) * percentile
        f = int(k)
        c = int(k) + 1 if k > int(k) else int(k)
        if f == c:
            return data[f]
        return data[f] * (c - k) + data[c] * (k - f)

    q1 = get_percentile(non_zero_amounts, 0.25)
    q2 = get_percentile(non_zero_amounts, 0.50)
    q3 = get_percentile(non_zero_amounts, 0.75)

    heatmap = []
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
        heatmap.append({
            "date": d["date"], 
            "amount": round(amt, 2), 
            "level": lvl,
            "top_item": d["top_item"],
        })

    return heatmap
