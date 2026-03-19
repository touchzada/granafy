import asyncio
import sys
import uuid
import os
from sqlalchemy import select
from sqlalchemy.orm import selectinload

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import async_session_maker
from app.models.user import User
from app.models.transaction import Transaction
from app.services.rule_service import apply_all_rules, create_default_rules

async def main():
    email = "lucianowmgf@gmail.com"
    async with async_session_maker() as session:
        result = await session.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if not user:
            print(f"User {email} not found")
            return

        print(f"Applying default rules for {user.email}...")
        
        # 1. Create default rules (which were missing)
        await create_default_rules(session, user.id, "pt-BR")
        
        # 2. Apply all rules to past transactions
        affected = await apply_all_rules(session, user.id)
        
        print(f"Rules created and applied! Categorized {affected} past transactions.")

if __name__ == "__main__":
    asyncio.run(main())
