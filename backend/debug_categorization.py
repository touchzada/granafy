import asyncio
import uuid
from sqlalchemy import select, func
from app.core.database import async_session_maker
from app.models.transaction import Transaction
from app.models.category import Category
from app.services.rule_service import apply_all_rules

async def debug_categorization():
    async with async_session_maker() as session:
        # Get a user who has transactions (likely only one in local dev)
        user_id_result = await session.execute(select(Transaction.user_id).limit(1))
        user_id = user_id_result.scalar_one_or_none()
        
        if not user_id:
            print("No user found with transactions.")
            return

        print(f"Debugging categorization for user: {user_id}")
        
        # List categories
        cats_result = await session.execute(select(Category).where(Category.user_id == user_id))
        cats = cats_result.scalars().all()
        print("\nExisting Categories:")
        for c in cats:
            print(f"- {c.name} ({c.id})")

        # Run re-apply
        print("\nRunning apply_all_rules...")
        count = await apply_all_rules(session, user_id)
        print(f"Processed {count} transactions.")

        # Check top uncategorized
        un_result = await session.execute(
            select(Transaction)
            .where(Transaction.user_id == user_id, Transaction.category_id.is_(None))
            .limit(10)
        )
        un = un_result.scalars().all()
        print("\nTop 10 still Uncategorized:")
        for tx in un:
            print(f"ID: {tx.id} | Desc: {tx.description} | Raw: {tx.raw_data.get('category') if (tx.raw_data and isinstance(tx.raw_data, dict)) else 'N/A'}")

if __name__ == "__main__":
    asyncio.run(debug_categorization())
