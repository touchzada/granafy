
import asyncio
import os
from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import async_session_maker
from app.models.transaction import Transaction
from app.models.account import Account
from app.models.category import Category

async def inspect():
    async with async_session_maker() as session:
        target_date = date(2026, 2, 23)
        
        query = (
            select(Transaction)
            .options(selectinload(Transaction.account), selectinload(Transaction.category))
            .where(Transaction.date == target_date)
            .order_by(Transaction.amount.desc())
        )
        
        result = await session.execute(query)
        transactions = result.scalars().all()
        
        print(f"\n--- Inspecionando Transações em {target_date} ---\n")
        print(f"{'Descrição':<45} | {'Conta':<15} | {'Tipo':<8} | {'Valor (R$)':<10} | {'Categoria'}")
        print("-" * 110)
        
        total_spending = 0
        for tx in transactions:
            acc_name = tx.account.name if tx.account else "Desconhecida"
            cat_name = tx.category.name if tx.category else "Sem Categoria"
            signed_amount = tx.amount if tx.type == 'debit' else -tx.amount
            
            # Match heatmap spending logic: exclude Salary/Investments
            is_spending = cat_name not in ["Salário", "Investimentos"]
            if is_spending:
                total_spending += signed_amount
                
            print(f"{tx.description[:45]:<45} | {acc_name[:15]:<15} | {tx.type:<8} | {tx.amount:>10.2f} | {cat_name}")
            
        print("-" * 110)
        print(f"Total Gasto Líquido (Heatmap do Bruno): R$ {total_spending:.2f}")

if __name__ == "__main__":
    asyncio.run(inspect())
