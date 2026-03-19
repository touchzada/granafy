import asyncio, logging
logging.disable(logging.CRITICAL)
from datetime import date
from sqlalchemy import select, func
from app.core.database import async_session_maker
from app.models.account import Account
from app.models.transaction import Transaction

async def main():
    async with async_session_maker() as session:
        result = await session.execute(select(Account).order_by(Account.type))
        accs = result.scalars().all()
        
        for a in accs:
            cr = await session.execute(
                select(func.sum(Transaction.amount))
                .where(
                    Transaction.account_id == a.id,
                    Transaction.type == "credit",
                    Transaction.date >= date(2026, 3, 1),
                    Transaction.date < date(2026, 4, 1),
                    Transaction.source != "opening_balance",
                    Transaction.transfer_pair_id.is_(None),
                )
            )
            credit_sum = float(cr.scalar() or 0)
            print(f"TYPE={a.type}")
            print(f"  NAME={a.name}")
            print(f"  ID={a.id}")
            print(f"  CONN={a.connection_id}")
            print(f"  CREDIT_TOTAL={credit_sum}")
            print()

asyncio.run(main())
