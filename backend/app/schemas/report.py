from pydantic import BaseModel


class ReportBreakdown(BaseModel):
    key: str
    label: str
    value: float
    color: str


class ReportSummary(BaseModel):
    primary_value: float
    change_amount: float
    change_percent: float | None
    breakdowns: list[ReportBreakdown]


class ReportDataPoint(BaseModel):
    date: str
    value: float
    breakdowns: dict[str, float]


class ReportMeta(BaseModel):
    type: str
    series_keys: list[str]
    currency: str
    interval: str


class ReportCompositionItem(BaseModel):
    key: str
    label: str
    value: float
    color: str
    group: str


class CategoryTrendItem(BaseModel):
    key: str
    label: str
    color: str
    total: float
    group: str
    series: list[ReportDataPoint]


class ReportResponse(BaseModel):
    summary: ReportSummary
    trend: list[ReportDataPoint]
    meta: ReportMeta
    composition: list[ReportCompositionItem] = []
    category_trend: list[CategoryTrendItem] = []


class InstallmentItem(BaseModel):
    description: str
    account_name: str
    total_amount: float
    installment_amount: float
    current_installment: int
    total_installments: int
    remaining_amount: float
    category_name: str | None = None
    category_color: str | None = None
    date: str


class InstallmentsResponse(BaseModel):
    items: list[InstallmentItem]
    total_remaining: float
    total_monthly: float
    count: int
