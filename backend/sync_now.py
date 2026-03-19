import asyncio
import logging
from app.core.database import async_session_maker
from app.models.user import User
from sqlalchemy import select
from app.services.connection_service import get_connections, sync_connection

logging.basicConfig(level=logging.INFO)

async def run():
    async with async_session_maker() as session:
        result = await session.execute(select(User).where(User.email == "lucianowmgf@gmail.com"))
        user = result.scalar_one_or_none()
        if not user:
            print("User not found")
            return
        
        conns = await get_connections(session, user.id)
        for conn in conns:
            print(f"Syncing connection {conn.id} for user {user.email}")
            await sync_connection(session, conn.id, user.id)
        
        print("Done syncing.")

if __name__ == "__main__":
    asyncio.run(run())
