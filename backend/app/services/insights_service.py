"""Anomaly / Insights detection service for Granafy dashboard."""
import uuid
from datetime import date, timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.transaction import Transaction
from app.models.category import Category


async def get_anomaly_alerts(
    session: AsyncSession, user_id: uuid.UUID, month: date | None = None
) -> list[dict]:
    """Compare current month category spending with 3-month rolling average.
    Returns alerts for categories where spending exceeds the average by >= 30%.
    """
    if not month:
        month = date.today().replace(day=1)

    month_start = month.replace(day=1)
    if month.month == 12:
        month_end = month.replace(year=month.year + 1, month=1, day=1)
    else:
        month_end = month.replace(month=month.month + 1, day=1)

    # Current month spending by category
    current_result = await session.execute(
        select(
            Category.id,
            Category.name,
            Category.icon,
            Category.color,
            func.sum(Transaction.amount),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.type == "debit",
            Transaction.date >= month_start,
            Transaction.date < month_end,
            Transaction.transfer_pair_id.is_(None),
            Transaction.source != "opening_balance",
        )
        .group_by(Category.id, Category.name, Category.icon, Category.color)
    )
    current_spending = {
        row[0]: {
            "name": row[1],
            "icon": row[2],
            "color": row[3],
            "amount": abs(float(row[4] or 0)),
        }
        for row in current_result.all()
    }

    if not current_spending:
        return []

    # 3-month average spending by category (the 3 months BEFORE the selected month)
    avg_start = (month_start - timedelta(days=90)).replace(day=1)
    avg_end = month_start  # up to start of current month

    avg_result = await session.execute(
        select(
            Category.id,
            func.sum(Transaction.amount),
            func.count(func.distinct(func.to_char(Transaction.date, 'YYYY-MM'))),
        )
        .select_from(Transaction)
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.user_id == user_id,
            Account.is_closed == False,
            Transaction.type == "debit",
            Transaction.date >= avg_start,
            Transaction.date < avg_end,
            Transaction.transfer_pair_id.is_(None),
            Transaction.source != "opening_balance",
        )
        .group_by(Category.id)
    )
    avg_spending = {}
    for row in avg_result.all():
        total = abs(float(row[1] or 0))
        num_months = int(row[2] or 1) or 1
        avg_spending[row[0]] = total / num_months

    # Find anomalies
    alerts = []
    for cat_id, info in current_spending.items():
        avg = avg_spending.get(cat_id, 0)
        if avg <= 0:
            continue
        pct_over = ((info["amount"] - avg) / avg) * 100
        if pct_over >= 30:
            severity = "critical" if pct_over >= 80 else "warning"
            alerts.append({
                "category_id": str(cat_id),
                "category_name": info["name"],
                "category_icon": info["icon"],
                "category_color": info["color"],
                "current_amount": round(info["amount"], 2),
                "average_amount": round(avg, 2),
                "percentage_over": round(pct_over, 1),
                "severity": severity,
            })

    # Sort by percentage_over descending
    alerts.sort(key=lambda x: x["percentage_over"], reverse=True)
    return alerts[:5]  # Top 5 anomalies
