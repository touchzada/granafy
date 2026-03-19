from typing import Optional

from pydantic import BaseModel


class CreditCardOverview(BaseModel):
    total_used: float = 0.0
    current_bill: float = 0.0
    available_limit: float = 0.0


class DashboardSummary(BaseModel):
    total_balance: dict[str, float]  # currency -> amount
    cash_balance: dict[str, float]
    credit_balance: dict[str, CreditCardOverview]
    balance_date: str  # ISO date string, e.g. "2026-03-02"
    monthly_income: float
    monthly_expenses: float
    accounts_count: int
    pending_categorization: int
    pending_categorization_amount: float
    assets_value: dict[str, float] = {}  # currency -> total asset value


class SpendingByCategory(BaseModel):
    category_id: Optional[str]
    category_name: str
    category_icon: str
    category_color: str
    total: float
    percentage: float


class MonthlyTrend(BaseModel):
    month: str  # "2026-01"
    income: float
    expenses: float


class DailyBalance(BaseModel):
    day: int
    balance: Optional[float]  # None for future days beyond cutoff
    projected_balance: Optional[float] = None


class BalanceHistory(BaseModel):
    current: list[DailyBalance]
    previous: list[DailyBalance]


class ProjectedTransaction(BaseModel):
    recurring_id: str
    description: str
    amount: float
    currency: str
    type: str  # debit, credit
    date: str  # YYYY-MM-DD
    category_id: Optional[str]
    category_name: Optional[str]
    category_icon: Optional[str]
    category_color: Optional[str] = None

class FinancialScore(BaseModel):
    score: int
    health_level: str
    savings_rate: float
    commitment_index: float

class HeatmapDay(BaseModel):
    date: str
    amount: float
    level: int
