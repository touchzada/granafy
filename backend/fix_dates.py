"""
Fix dates of existing synced transactions.
Reads raw_data.date (UTC) and converts to America/Sao_Paulo timezone.
"""
import asyncio
from datetime import datetime
try:
    import zoneinfo
except ImportError:
    from backports import zoneinfo

from sqlalchemy import select, update
from app.core.database import async_session_maker
from app.models.transaction import Transaction

BR_TZ = zoneinfo.ZoneInfo("America/Sao_Paulo")


async def fix_dates():
    async with async_session_maker() as session:
        # Get all synced transactions that have raw_data with a date field
        query = select(Transaction).where(
            Transaction.source == "sync",
            Transaction.raw_data.isnot(None),
        )
        result = await session.execute(query)
        transactions = result.scalars().all()

        fixed = 0
        skipped = 0
        for tx in transactions:
            raw_date_str = tx.raw_data.get("date") if tx.raw_data else None
            if not raw_date_str:
                skipped += 1
                continue

            try:
                # Parse the UTC date string
                if raw_date_str.endswith("Z"):
                    raw_date_str = raw_date_str.replace("Z", "+00:00")
                utc_dt = datetime.fromisoformat(raw_date_str)
                correct_date = utc_dt.astimezone(BR_TZ).date()

                if tx.date != correct_date:
                    old_date = tx.date
                    tx.date = correct_date
                    fixed += 1
                    print(f"  FIXED: {tx.description[:40]:<40} | {old_date} → {correct_date}")
                else:
                    skipped += 1
            except (ValueError, TypeError) as e:
                print(f"  SKIP: {tx.description[:40]} — parse error: {e}")
                skipped += 1

        await session.commit()
        print(f"\n--- Resultado ---")
        print(f"Corrigidas: {fixed}")
        print(f"Sem alteração: {skipped}")
        print(f"Total processadas: {fixed + skipped}")


if __name__ == "__main__":
    asyncio.run(fix_dates())
