import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dashboard, transactions, budgets, categories as categoriesApi, accounts as accountsApi, goals as goalsApi } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { DatePickerGranafy } from '@/components/date-picker-granafy'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Check,
  ChevronDown,
  Wallet,
  Building2,
  Wand2,
  CheckCircle2,
  Target,
  Store
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { CategoryIcon } from '@/components/category-icon'
import { TransactionDrillDown, type DrillDownFilter } from '@/components/transaction-drill-down'
import { TransactionDialog, extractApiError } from '@/components/transaction-dialog'
import { QuickRuleDialog } from '@/components/quick-rule-dialog'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { useAuth } from '@/contexts/auth-context'
import type { Transaction, HeatmapDay, Goal } from '@/types'

function formatCurrency(value: number, currency = 'BRL', locale = 'pt-BR') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

const HEATMAP_COLORS = [
  'bg-muted/30',                    // level 0 - no spending
  'bg-emerald-200 dark:bg-emerald-900/60', // level 1 - low
  'bg-amber-200 dark:bg-amber-700/60',     // level 2 - medium
  'bg-orange-300 dark:bg-orange-600/70',   // level 3 - high
  'bg-rose-400 dark:bg-rose-500/80',       // level 4 - very high
]

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function getFriendlyAccountName(rawName: string): string {
  const BANK_NAMES: Record<string, string> = {
    'nu': 'Nubank', 'nubank': 'Nubank', 'nu pagamentos': 'Nubank',
    'itau': 'Itaú', 'itaú': 'Itaú',
    'bradesco': 'Bradesco', 'santander': 'Santander',
    'caixa': 'Caixa', 'bb': 'Banco do Brasil', 'inter': 'Inter',
    'c6': 'C6 Bank', 'btg': 'BTG Pactual', 'neon': 'Neon',
    'picpay': 'PicPay', 'mercadopago': 'Mercado Pago',
  }
  const lowerName = rawName.toLowerCase()
  const friendlyName = Object.entries(BANK_NAMES).find(([key]) => lowerName.includes(key))?.[1]
  return friendlyName || rawName
}

function HeatmapGrid({ data, locale = 'pt-BR', currency = 'BRL', privacyMode = false, onDayClick }: { data: HeatmapDay[], locale?: string, currency?: string, privacyMode?: boolean | string, onDayClick?: (date: string) => void }) {
  const weeks: (HeatmapDay | null)[][] = []
  let currentWeek: (HeatmapDay | null)[] = []

  if (data.length > 0) {
    const firstDow = new Date(data[0].date + 'T00:00:00').getDay()
    for (let i = 0; i < firstDow; i++) currentWeek.push(null)
  }

  for (const day of data) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    weeks.push(currentWeek)
  }

  const [tooltip, setTooltip] = useState<{ day: HeatmapDay; x: number; y: number } | null>(null)

  return (
    <div className="relative">
      <div className="flex gap-[3px]">
        {/* Weekday labels */}
        <div className="flex flex-col gap-[3px] pr-1.5 justify-start">
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} className="h-[12px] flex items-center text-[9px] text-muted-foreground leading-none font-medium">
              {label}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex gap-[3px] overflow-x-auto" style={{ minWidth: weeks.length * 15 }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day, di) => (
                <div
                  key={`${wi}-${di}`}
                  className={`w-[12px] h-[12px] rounded-[2px] transition-colors ${day ? HEATMAP_COLORS[day.level] : 'bg-transparent'} ${day ? 'cursor-pointer hover:ring-1 hover:ring-foreground/30' : ''}`}
                  onMouseEnter={(e) => {
                    if (day) {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setTooltip({ day, x: rect.left + rect.width / 2, y: rect.top })
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => {
                    if (day && onDayClick) onDayClick(day.date)
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground ml-[30px]">
        <span>Menos</span>
        {HEATMAP_COLORS.map((c, i) => (
          <div key={i} className={`w-[12px] h-[12px] rounded-[2px] ${c}`} />
        ))}
        <span>Mais</span>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg bg-popover border border-border shadow-lg text-xs pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 48, transform: 'translateX(-50%)' }}
        >
          <p className="font-semibold text-foreground">
            {WEEKDAY_LABELS[new Date(tooltip.day.date + 'T00:00:00').getDay()]}, {new Date(tooltip.day.date + 'T00:00:00').toLocaleDateString(locale)}
          </p>
          <p className="text-muted-foreground">{privacyMode !== 'visible' ? '••••' : formatCurrency(tooltip.day.amount, currency, locale)}</p>
        </div>
      )}
    </div>
  )
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(yearMonth: string, delta: number) {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLastDay(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

function monthLabel(yearMonth: string, locale = 'pt-BR') {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(y, m - 1, 2).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

function formatDate(dateStr: string, locale = 'pt-BR') {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(locale)
}


export default function DashboardPage() {
  const { t, i18n } = useTranslation()
  const { mask, blurClass, privacyMode, MASK } = usePrivacyMode()
  const { user } = useAuth()
  const userCurrency = user?.preferences?.currency_display ?? 'BRL'
  const displayName = user?.preferences?.display_name || ''
  const locale = i18n.language === 'en' ? 'en-US' : i18n.language

  const greeting = (() => {
    const hour = new Date().getHours()
    const key = hour < 12 ? 'greetingMorning' : hour < 18 ? 'greetingAfternoon' : 'greetingEvening'
    const base = t(`dashboard.${key}`)
    return displayName ? `${base}, ${displayName}` : base
  })()
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [balanceDate, setBalanceDate] = useState<string | undefined>()
  const [drillDown, setDrillDown] = useState<DrillDownFilter | null>(null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [quickRuleOpen, setQuickRuleOpen] = useState(false)
  const [quickRuleTx, setQuickRuleTx] = useState<Transaction | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [uncategorizedDismissed, setUncategorizedDismissed] = useState(false)
  const apiAccountId = selectedAccountId === 'all' ? undefined : selectedAccountId
  const queryClient = useQueryClient()
  const [hoveredDay, setHoveredDay] = useState<number | null>(null)
  const monthParam = `${selectedMonth}-01`
  const monthStart = `${selectedMonth}-01`
  const monthEnd = `${selectedMonth}-${String(monthLastDay(selectedMonth)).padStart(2, '0')}`
  const monthLabelStr = monthLabel(selectedMonth, locale)

  const handleMonthChange = (newMonth: string) => {
    setSelectedMonth(newMonth)
    setBalanceDate(undefined)
  }

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboard', 'summary', selectedMonth, balanceDate, apiAccountId],
    queryFn: () => dashboard.summary(monthParam, balanceDate, apiAccountId),
  })

  const { data: spending, isLoading: spendingLoading } = useQuery({
    queryKey: ['dashboard', 'spending', selectedMonth, apiAccountId],
    queryFn: () => dashboard.spendingByCategory(monthParam, apiAccountId),
  })

  const prevMonth = shiftMonth(selectedMonth, -1)

  const { data: balanceHistory, isLoading: balanceHistoryLoading } = useQuery({
    queryKey: ['dashboard', 'balance-history', selectedMonth],
    queryFn: () => dashboard.balanceHistory(monthParam),
  })

  const { data: currentMonthTxs, isLoading: currentTxLoading } = useQuery({
    queryKey: ['transactions', 'cumulative', selectedMonth],
    queryFn: () => transactions.list({
      from: `${selectedMonth}-01`,
      to: `${selectedMonth}-${String(monthLastDay(selectedMonth)).padStart(2, '0')}`,
      limit: 500,
    }),
  })

  const { data: projectedTxs, isLoading: projectedTxLoading } = useQuery({
    queryKey: ['dashboard', 'projected-transactions', selectedMonth],
    queryFn: () => dashboard.projectedTransactions(monthParam),
  })

  const { data: scoreData, isLoading: scoreLoading } = useQuery({
    queryKey: ['dashboard', 'score', selectedMonth],
    queryFn: () => dashboard.score(monthParam),
  })

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery({
    queryKey: ['dashboard', 'heatmap'],
    queryFn: () => dashboard.heatmap(6),
  })

  const { data: budgetComparison } = useQuery({
    queryKey: ['budgets', 'comparison', selectedMonth],
    queryFn: () => budgets.comparison(monthParam),
  })

  const { data: categoriesList } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
  })

  const { data: accountsList } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const { data: goalsList } = useQuery({
    queryKey: ['goals'],
    queryFn: goalsApi.list,
  })

  // Account grouping for custom selector
  const accountGroups = useMemo(() => {
    if (!accountsList) return {}
    // First pass: group accounts by connection_id (or fallback key)
    const rawGroups: Record<string, typeof accountsList> = {}
    
    accountsList.forEach(account => {
      const key = account.connection_id || account.name.split(' ')[0] || 'manual'
      if (!rawGroups[key]) rawGroups[key] = []
      rawGroups[key].push(account)
    })
    
    // Second pass: build structured groups with proper names
    const groups: Record<string, { name: string; mainAccounts: typeof accountsList; creditCards: typeof accountsList }> = {}
    
    Object.entries(rawGroups).forEach(([key, accs]) => {
      const mainAccounts = accs.filter(a => a.type !== 'credit_card')
      const creditCards = accs.filter(a => a.type === 'credit_card')
      
      // Derive a sensible group name:
      // 1. Prefer the name of a checking/savings account (not a card)
      // 2. Fall back to extracting institution name before " - " from any account
      // 3. Last resort: first word of any account name
      let groupName = 'Contas Manuais'
      const mainAcc = mainAccounts[0]
      const anyAcc = accs[0]
      if (mainAcc) {
        groupName = mainAcc.name.includes(' - ') ? mainAcc.name.split(' - ')[0].trim() : mainAcc.name.split(' ')[0]
      } else if (anyAcc) {
        groupName = anyAcc.name.includes(' - ') ? anyAcc.name.split(' - ')[0].trim() : anyAcc.name.split(' ')[0]
      }
      
      const friendlyName = getFriendlyAccountName(groupName)
      if (friendlyName !== groupName) groupName = friendlyName
      
      groups[key] = {
        name: anyAcc?.connection_id ? groupName.toUpperCase() : 'Contas Manuais',
        mainAccounts,
        creditCards,
      }
    })
    return groups
  }, [accountsList])

  const [selectorOpen, setSelectorOpen] = useState(false)
  const selectorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(ev.target as Node)) {
        setSelectorOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectedAccountLabel = useMemo(() => {
    if (selectedAccountId === 'all' || !accountsList) return t('dashboard.allAccounts')
    const acc = accountsList.find(a => a.id === selectedAccountId)
    return acc ? getFriendlyAccountName(acc.name) : t('dashboard.allAccounts')
  }, [selectedAccountId, accountsList, t])

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: Partial<Transaction> & { id: string }) =>
      transactions.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['budgets'] })
      queryClient.invalidateQueries({ queryKey: ['drill-down'] })
      setDialogOpen(false)
      setEditingTx(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => transactions.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['budgets'] })
      queryClient.invalidateQueries({ queryKey: ['drill-down'] })
      setDialogOpen(false)
      setEditingTx(null)
    },
  })

  const cumulativeData = useMemo(() => {
    if (!balanceHistory) return []
    const daysInMonth = monthLastDay(selectedMonth)
    const result: { day: number; current: number | null; projected: number | null; previous: number }[] = []
    for (let day = 1; day <= daysInMonth; day++) {
      const cur = balanceHistory.current.find(d => d.day === day)
      const prev = balanceHistory.previous.find(d => d.day === day)
      result.push({
        day,
        current: cur?.balance ?? null,
        projected: cur?.projected_balance ?? null,
        previous: prev?.balance ?? 0,
      })
    }
    return result
  }, [balanceHistory, selectedMonth])

  const lastCurrentPoint = [...cumulativeData].reverse().find(d => d.current !== null)
  const lastDay = lastCurrentPoint?.day ?? 0
  const currentStartBalance = balanceHistory?.current.find(d => d.day === 1)?.balance ?? 0
  const currentLatestBalance = lastCurrentPoint?.current ?? 0
  const monthVariation = currentLatestBalance - currentStartBalance

  const totalBalance = Object.values(summary?.total_balance ?? {}).reduce((a, b) => a + Number(b), 0)
  const cashBalance = Object.values(summary?.cash_balance ?? {}).reduce((a, b) => a + Number(b), 0)
  const creditOverview = Object.values(summary?.credit_balance ?? {}).reduce(
    (acc, curr) => ({
      total_used: acc.total_used + Number(curr.total_used),
      current_bill: acc.current_bill + Number(curr.current_bill),
      available_limit: acc.available_limit + Number(curr.available_limit),
    }),
    { total_used: 0, current_bill: 0, available_limit: 0 }
  )


  // Savings rate & projection
  const income = Number(summary?.monthly_income ?? 0)
  const expenses = Number(summary?.monthly_expenses ?? 0)
  const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0
  const isCurrentMonth = selectedMonth === currentMonth()
  const daysElapsed = isCurrentMonth ? new Date().getDate() : monthLastDay(selectedMonth)
  const daysInMonth = monthLastDay(selectedMonth)
  const projectedSpend = expenses > 0 && isCurrentMonth && daysElapsed > 0
    ? (expenses / daysElapsed) * daysInMonth
    : null

  // Uncategorized data
  const uncategorizedCount = summary?.pending_categorization ?? 0


  // Merged category bars data
  const mergedCategories = useMemo(() => {
    if (!spending) return []
    const budgetMap = new Map<string, (typeof budgetComparison extends (infer T)[] | undefined ? T : never)>()
    if (budgetComparison) {
      for (const b of budgetComparison) {
        budgetMap.set(b.category_id, b)
      }
    }
    return spending
      .filter(s => s.category_id !== null)
      .map(s => {
        const budget = s.category_id ? budgetMap.get(s.category_id) : undefined
        const actual = s.total
        const prevAmount = budget ? Number(budget.prev_month_amount) : 0
        let momPct: number | null = null
        if (prevAmount > 0) {
          momPct = ((actual - prevAmount) / prevAmount) * 100
        } else if (actual > 0) {
          momPct = 100
        }
        return {
          category_id: s.category_id!,
          category_name: s.category_name,
          category_icon: s.category_icon,
          category_color: s.category_color,
          actual,
          budget_amount: budget ? Number(budget.budget_amount) : null,
          percentage_used: budget?.percentage_used ?? null,
          momPct,
        }
      })
      .sort((a, b) => b.actual - a.actual)
  }, [spending, budgetComparison])

  const [txPage, setTxPage] = useState(1)
  useEffect(() => setTxPage(1), [selectedMonth])

  type DisplayRow = {
    key: string
    description: string
    date: string
    type: 'debit' | 'credit'
    amount: number
    currency: string
    categoryIcon: string | null
    categoryName: string | null
    categoryColor: string | null
    isProjected: boolean
  }

  const TX_PER_PAGE = 10
  const allDisplayRows = useMemo(() => {
    const rows: DisplayRow[] = []
    for (const tx of currentMonthTxs?.items ?? []) {
      rows.push({
        key: tx.id,
        description: tx.description,
        date: tx.date,
        type: tx.type,
        amount: Number(tx.amount),
        currency: tx.currency,
        categoryIcon: tx.category?.icon ?? null,
        categoryName: tx.category?.name ?? null,
        categoryColor: tx.category?.color ?? null,
        isProjected: false,
      })
    }
    for (const pt of projectedTxs ?? []) {
      rows.push({
        key: `proj-${pt.recurring_id}-${pt.date}`,
        description: pt.description,
        date: pt.date,
        type: pt.type,
        amount: pt.amount,
        currency: pt.currency,
        categoryIcon: pt.category_icon,
        categoryName: pt.category_name,
        categoryColor: pt.category_color ?? null,
        isProjected: true,
      })
    }
    rows.sort((a, b) => a.date.localeCompare(b.date))
    return rows
  }, [currentMonthTxs, projectedTxs])

  const txTotalPages = Math.ceil(allDisplayRows.length / TX_PER_PAGE)
  const pagedRows = allDisplayRows.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE)
  const txListLoading = currentTxLoading || projectedTxLoading

  // Savings rate display
  const savingsRateColor = income === 0 && expenses > 0
    ? 'text-rose-500'
    : savingsRate > 0
      ? 'text-emerald-600'
      : savingsRate < 0
        ? 'text-rose-500'
        : 'text-muted-foreground'

  const savingsRateDisplay = income === 0 && expenses > 0
    ? '---'
    : `${savingsRate.toFixed(0)}%`

  return (
    <div>
      {/* Header */}
      <PageHeader
        section={greeting}
        title={new Date(selectedMonth + '-02').toLocaleDateString(locale, { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase())}
        action={
          <div className="flex items-center gap-1">
            <button
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-border hover:text-foreground transition-all text-base"
              onClick={() => handleMonthChange(shiftMonth(selectedMonth, -1))}
            >&#8249;</button>
            <DatePickerGranafy
              value={balanceDate || `${selectedMonth}-01`}
              onChange={(v) => {
                const newMonth = v.substring(0, 7)
                setSelectedMonth(newMonth)
                setBalanceDate(v)
              }}
              compact
              alignPopover="center"
            />

            <button
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-border hover:text-foreground transition-all text-base"
              onClick={() => handleMonthChange(shiftMonth(selectedMonth, 1))}
            >&#8250;</button>
          </div>
        }
      />

      {/* Account Selector (Glassmorphism UI) */}
      {(accountsList && accountsList.length > 0) && (
        <div className="flex items-center gap-2 mb-4 -mt-2 z-30 relative">
          <div ref={selectorRef} className="relative z-40">
            <button
              onClick={() => setSelectorOpen(!selectorOpen)}
              className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-300 cursor-pointer select-none border ${
                selectorOpen
                  ? 'bg-primary/10 border-primary/50 text-foreground shadow-lg shadow-primary/5'
                  : selectedAccountId !== 'all'
                  ? 'bg-gradient-to-r from-primary/10 to-transparent border-primary/30 text-foreground hover:border-primary/50 hover:shadow-lg'
                  : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-card/80'
              }`}
            >
              <Building2 className={`w-4 h-4 flex-shrink-0 transition-colors ${selectedAccountId !== 'all' ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="max-w-[200px] truncate">{selectedAccountLabel}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-300 ${selectorOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Panel */}
            <div
              className={`absolute left-0 top-full mt-2 w-72 transition-all duration-200 origin-top-left ${
                selectorOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
              }`}
            >
              <div className="bg-card/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl shadow-black/10 overflow-hidden dark:shadow-black/40">
                <div className="px-3.5 py-2.5 border-b border-border/50">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Selecionar Conta</p>
                </div>
                <div className="py-1.5 max-h-[320px] overflow-y-auto scrollbar-thin">
                  <button
                    onClick={() => { setSelectedAccountId('all'); setSelectorOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm transition-all duration-150 ${
                      selectedAccountId === 'all'
                        ? 'bg-primary/15 text-foreground font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                      selectedAccountId === 'all' ? 'bg-primary/20 text-primary' : 'bg-accent text-transparent'
                    }`}>
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </div>
                    <span className="flex-1 text-left">{t('dashboard.allAccounts')}</span>
                  </button>

                  {Object.entries(accountGroups).map(([key, group]) => (
                    <div key={key} className="mt-1">
                      <div className="px-3 py-1.5 bg-accent/30 border-y border-border/30">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 truncate">{group.name}</p>
                      </div>
                      {/* Main accounts only - credit cards shown in hero mini-cards */}
                      {group.mainAccounts.map((acc) => {
                        const isActive = selectedAccountId === acc.id;
                        return (
                          <button
                            key={acc.id}
                            onClick={() => { setSelectedAccountId(acc.id); setSelectorOpen(false); }}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm transition-all duration-150 ${
                              isActive
                                ? 'bg-primary/10 font-medium'
                                : 'hover:bg-accent/70'
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
                              isActive 
                                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                : 'bg-accent/50 text-muted-foreground'
                            }`}>
                              <Wallet className="w-4 h-4" />
                            </div>
                            <div className="flex-1 text-left min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <span className="truncate font-semibold text-xs text-foreground">
                                  {acc.custom_name || acc.name}
                                </span>
                                {isActive && <Check className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={3} />}
                              </div>
                              <div className={`text-[10px] mt-0.5 tabular-nums font-medium ${Number(acc.current_balance) < 0 ? 'text-rose-500' : 'text-emerald-600'} ${blurClass}`}>
                                {mask(formatCurrency(Number(acc.current_balance), acc.currency, locale))}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hero Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 relative z-10">
          
          {/* Health Score */}
          <div className="col-span-2 md:col-span-1 bg-card/40 backdrop-blur-xl border border-border/60 hover:border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between group relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-xs font-medium text-muted-foreground mb-1 group-hover:text-foreground transition-colors">{t('dashboard.healthScore')}</p>
              {scoreLoading ? (
                <Skeleton className="h-10 w-28 mt-2" />
              ) : (
                <div className="flex items-end gap-3 mt-1.5">
                  <p className={`text-5xl font-black tabular-nums tracking-tighter leading-none ${scoreData?.score && scoreData.score >= 80 ? 'text-emerald-500' : scoreData?.score && scoreData.score >= 50 ? 'text-amber-500' : 'text-rose-500'}`}>
                    {scoreData?.score ?? 0}
                  </p>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-1 ${scoreData?.score && scoreData.score >= 80 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : scoreData?.score && scoreData.score >= 50 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'}`}>
                    {scoreData?.health_level ?? ''}
                  </span>
                </div>
              )}
            </div>
            {/* Subtle background glow based on score */}
            <div className={`absolute -bottom-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 dark:opacity-10 pointer-events-none transition-colors duration-1000 ${scoreData?.score && scoreData.score >= 80 ? 'bg-emerald-500' : scoreData?.score && scoreData.score >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} />
          </div>

          {/* Savings Rate */}
          <div className="col-span-1 bg-card/40 backdrop-blur-xl border border-border/60 hover:border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between group">
            <p className="text-xs font-medium text-muted-foreground mb-2 group-hover:text-foreground transition-colors">{t('dashboard.savingsRate')}</p>
            {summaryLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${savingsRateColor}`}>
                {savingsRateDisplay}
              </p>
            )}
          </div>

          {/* Cash Balance */}
          <div className="col-span-1 bg-card/40 backdrop-blur-xl border border-border/60 hover:border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between group">
            <p className="text-xs font-medium text-muted-foreground mb-2 group-hover:text-foreground transition-colors">{t('dashboard.cashBalance')}</p>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className={`text-2xl font-bold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-500 ${blurClass}`}>
                {mask(formatCurrency(cashBalance, userCurrency, locale))}
              </p>
            )}
          </div>

          {/* Credit Balance */}
          <div className="col-span-1 bg-card/40 backdrop-blur-xl border border-border/60 hover:border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between group">
            <p className="text-xs font-medium text-muted-foreground mb-2 group-hover:text-foreground transition-colors">{t('dashboard.creditBalance')}</p>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div>
                <p className={`text-2xl font-bold tabular-nums tracking-tight text-rose-500 ${blurClass}`}>
                  {mask(formatCurrency(creditOverview.total_used, userCurrency, locale))}
                </p>
                {creditOverview.available_limit > 0 && (
                  <p className={`text-[10px] text-muted-foreground mt-1 truncate ${blurClass}`}>
                    Limite disp: {mask(formatCurrency(creditOverview.available_limit, userCurrency, locale))}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Income */}
          <div
            className="col-span-1 bg-card/40 backdrop-blur-xl border border-border/60 hover:border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between group cursor-pointer"
            onClick={() => setDrillDown({
              title: t('dashboard.drillDownIncome', { month: monthLabelStr }),
              type: 'credit',
              from: monthStart,
              to: monthEnd,
              account_id: apiAccountId,
            })}
          >
            <p className="text-xs font-medium text-muted-foreground mb-2 group-hover:text-foreground transition-colors">{t('dashboard.monthlyIncome')}</p>
            {summaryLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className={`text-2xl font-bold tabular-nums tracking-tight text-emerald-600 ${blurClass}`}>
                +{mask(formatCurrency(income, userCurrency, locale))}
              </p>
            )}
          </div>

          {/* Expenses & Projection */}
          <div
            className="col-span-2 md:col-span-1 bg-card/40 backdrop-blur-xl border border-border/60 hover:border-border/80 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between group cursor-pointer relative overflow-hidden"
            onClick={() => setDrillDown({
              title: t('dashboard.drillDownExpenses', { month: monthLabelStr }),
              type: 'debit',
              from: monthStart,
              to: monthEnd,
              account_id: apiAccountId,
            })}
          >
            <div className="relative z-10">
              <p className="text-xs font-medium text-muted-foreground mb-2 group-hover:text-foreground transition-colors">{t('dashboard.monthlyExpenses')}</p>
              {summaryLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div>
                  <p className={`text-2xl font-bold tabular-nums tracking-tight text-rose-500 ${blurClass}`}>
                    -{mask(formatCurrency(expenses, userCurrency, locale))}
                  </p>
                  {projectedSpend !== null && (
                    <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">
                      Projeção: <span className="font-bold">{mask(formatCurrency(projectedSpend, userCurrency, locale))}</span>
                    </p>
                  )}
                </div>
              )}
          </div>
        </div>

      </div> {/* <-- Closes Metrics Bento Grid */}

      {/* Credit Card Panel - Positioned Underneath */}
      <div className="w-full mb-6">
        {/* Dismissible categorization notification */}
        {uncategorizedCount > 0 && !uncategorizedDismissed && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs hover:border-amber-500/40 transition-colors group mb-4">
            <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full min-w-[22px] text-center shadow-sm">{uncategorizedCount}</span>
            <button
              className="flex-1 text-left text-amber-600 dark:text-amber-400 font-medium group-hover:underline"
              onClick={() => setDrillDown({
                title: t('dashboard.drillDownUncategorized'),
                uncategorized: true,
              })}
            >
              {t('dashboard.categorizeNow')} →
            </button>
            <button
              onClick={() => setUncategorizedDismissed(true)}
              className="text-amber-600/50 hover:text-amber-600 dark:text-amber-400/50 dark:hover:text-amber-400 transition-colors p-1 rounded-md hover:bg-amber-500/10"
            >
              ✕
            </button>
          </div>
        )}

        {/* Credit Card Mini-Cards */}
        {(() => {
          const allCards = (accountsList ?? []).filter(a => {
            if (a.type !== 'credit_card') return false
            if (selectedAccountId === 'all') return true
            
            const selectedAcc = accountsList?.find(acc => acc.id === selectedAccountId)
            if (!selectedAcc || !selectedAcc.connection_id) return true
            
            return a.connection_id === selectedAcc.connection_id
          })

          if (allCards.length === 0) {
            if (uncategorizedCount <= 0 || uncategorizedDismissed) {
              return (
                <div className="flex flex-col items-center justify-center p-8 bg-card/40 backdrop-blur-xl border border-border/60 rounded-2xl shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-sm font-semibold text-foreground text-center">{t('dashboard.allCategorized')}</p>
                  <p className="text-xs text-muted-foreground mt-1 text-center">{t('dashboard.allCategorizedDesc')}</p>
                </div>
              )
            }
            return null
          }
          return (
            <div className="flex flex-col w-full">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1 mb-3">💳 Cartões de Crédito</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {allCards.map(card => {
                  const usedAmount = Math.abs(Number(card.current_balance))
                  const totalLimit = (card.credit_data?.creditLimit ?? Number(card.balance)) || 0
                  const availableLimit = Math.max(0, totalLimit - usedAmount)
                  const progress = totalLimit > 0 ? (usedAmount / totalLimit) * 100 : 0
                  const cardBrandName = card.custom_name || card.name.replace(/cartão/i, '').trim()
                  return (
                    <div key={card.id} className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card/80 to-muted/30 p-4 shadow-sm hover:shadow-md transition-all duration-300">
                      <div className="flex justify-between items-start mb-4 relative z-10">
                        <div>
                          <Link to={`/accounts/${card.id}`} className="text-xs font-bold text-foreground truncate max-w-[160px] uppercase tracking-wide hover:text-primary transition-colors hover:underline">
                            {cardBrandName}
                          </Link>
                          <p className="text-[9px] text-muted-foreground font-medium uppercase mt-0.5 tracking-wider">
                            {card.credit_level ? `${card.credit_data?.brand || ''} ${card.credit_level}` : (card.credit_data?.brand || card.name.split(' ')[0] || 'Cartão de Crédito')}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {card.account_number && (
                            <div className="px-1.5 py-0.5 rounded bg-muted/50 border border-border/50 text-[9px] font-mono text-muted-foreground flex items-center gap-1">
                              <span className="opacity-50">••••</span> {card.account_number}
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Ativo</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3 mb-3 relative z-10">
                        <div>
                          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Fatura Atual</p>
                          <p className={`text-sm font-black tabular-nums tracking-tight text-foreground ${blurClass}`}>
                            {mask(formatCurrency(usedAmount, card.currency, locale))}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Limite Disp.</p>
                          <p className={`text-sm font-black tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 ${blurClass}`}>
                            {mask(formatCurrency(availableLimit, card.currency, locale))}
                          </p>
                        </div>
                      </div>

                      <div className="w-full bg-muted/50 rounded-full h-1.5 overflow-hidden border border-border/30 relative z-10">
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ease-out ${progress > 90 ? 'bg-rose-500' : progress > 70 ? 'bg-amber-500' : 'bg-primary'}`}
                          style={{ width: `${Math.min(100, progress)}%` }}
                        />
                      </div>
                      {totalLimit > 0 && (
                        <div className="mt-1 text-right">
                          <span className="text-[8px] font-medium text-muted-foreground">{Math.round(progress)}% USADO</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </div>
      {/* Anomaly Alerts (Temporarily removed per user request) */}

      {/* Charts: Category Spending Bars + Balance Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5" style={{ gridAutoRows: 'minmax(380px, auto)' }}>
        {/* Category Spending Bars */}
        <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col max-h-[420px]">
          <div className="px-5 py-4 border-b border-border shrink-0">
            <p className="text-sm font-semibold text-foreground">{t('dashboard.spendingByCategory')}</p>
          </div>
          <div className="p-3 overflow-y-auto flex-1">
            {spendingLoading ? (
              <div className="space-y-3 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : mergedCategories.length > 0 ? (
              <div className="space-y-1.5">
                {mergedCategories.map((item) => {
                  const hasBudget = item.budget_amount != null && item.budget_amount > 0
                  const pct = item.percentage_used
                  const barColor = hasBudget
                    ? pct! > 100 ? 'bg-rose-500' : pct! >= 80 ? 'bg-amber-400' : 'bg-emerald-500'
                    : 'bg-muted-foreground/20'

                  return (
                    <div
                      key={item.category_id}
                      className="rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setDrillDown({
                        title: t('dashboard.drillDownCategory', { category: item.category_name, month: monthLabelStr }),
                        category_id: item.category_id,
                        type: 'debit',
                        from: monthStart,
                        to: monthEnd,
                      })}
                    >
                      <div className="flex items-center gap-3">
                        <CategoryIcon icon={item.category_icon} color={item.category_color} size="lg" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-semibold text-foreground truncate">{item.category_name}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-bold tabular-nums text-foreground">{mask(formatCurrency(item.actual, userCurrency, locale))}</span>
                              {item.momPct !== null && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                                  item.momPct > 0 ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400' : item.momPct < 0 ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                                }`}>
                                  {item.momPct > 0 ? '\u2191' : item.momPct < 0 ? '\u2193' : '='}{Math.abs(item.momPct).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                          {hasBudget && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${barColor}`}
                                  style={{ width: `${Math.min(pct!, 100)}%` }}
                                />
                              </div>
                              <span className={`text-[11px] tabular-nums font-medium shrink-0 ${
                                pct! > 100 ? 'text-rose-500' : pct! >= 80 ? 'text-amber-500' : 'text-muted-foreground'
                              }`}>
                                {mask(t('dashboard.ofBudget', { budget: formatCurrency(item.budget_amount!, userCurrency, locale) }))}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">{t('dashboard.noData')}</p>
            )}
          </div>
        </div>

        {/* Goals Widget */}
        {goalsList && goalsList.filter((g: Goal) => !g.is_completed).length > 0 && (
          <div className="bg-card/40 backdrop-blur-xl border border-border/50 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
                  <Target className="w-4 h-4 text-indigo-500" />
                </div>
                <h3 className="text-sm font-bold text-foreground">Metas Ativas</h3>
              </div>
              <Link to="/goals" className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                Ver todas →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {goalsList.filter((g: Goal) => !g.is_completed).slice(0, 3).map((goal: Goal) => {
                const progress = Math.min(goal.progress, 100)
                return (
                  <Link
                    key={goal.id}
                    to="/goals"
                    className="group flex items-center gap-3 p-3 rounded-xl bg-card/30 backdrop-blur-md border border-border/30 hover:border-border/60 hover:bg-card/50 transition-all duration-300 hover:shadow-md"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 transition-transform duration-300 group-hover:scale-110"
                      style={{ background: `linear-gradient(135deg, ${goal.color}25, ${goal.color}10)` }}
                    >
                      {goal.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{goal.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{ width: `${progress}%`, background: goal.color }}
                          />
                        </div>
                        <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color: goal.color }}>
                          {progress.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Cumulative Spending Comparison */}
        <div className="bg-card rounded-xl border border-border shadow-sm max-h-[420px] flex flex-col">
          <div className="px-5 pt-5 pb-3 shrink-0">
            <div className="flex items-start justify-between mb-0.5">
              <div>
                <p className="text-base font-bold text-foreground">{t('dashboard.balanceFlow')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(`${selectedMonth}-01T00:00:00`).toLocaleDateString(locale)} → {new Date(`${selectedMonth}-${String(lastCurrentPoint?.day ?? monthLastDay(selectedMonth)).padStart(2, '0')}T00:00:00`).toLocaleDateString(locale)}
                </p>
              </div>
              {!balanceHistoryLoading && lastCurrentPoint && (
                <span className={`text-lg font-bold tabular-nums ${monthVariation >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {mask(`${monthVariation > 0 ? '+' : ''}${formatCurrency(monthVariation, userCurrency, locale)}`)}
                </span>
              )}
            </div>
          </div>
          <div className="px-1 pb-4 flex-1 min-h-0">
            {balanceHistoryLoading ? (
              <Skeleton className="h-full w-full" />
            ) : cumulativeData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={cumulativeData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  className="cursor-pointer"
                  onMouseMove={(state) => {
                    const idx = state?.activeTooltipIndex
                    if (typeof idx === 'number') {
                      const point = cumulativeData[idx]
                      if (point) setHoveredDay(point.day)
                    }
                  }}
                  onMouseLeave={() => setHoveredDay(null)}
                  onClick={(_state) => {
                    // Access activePayload from the underlying native event target chart state
                    const chartState = _state as unknown as { activePayload?: Array<{ payload: { day: number } }> }
                    const payload = chartState?.activePayload ?? []
                    if (payload[0]) {
                      const day = String(payload[0].payload.day).padStart(2, '0')
                      const dateStr = `${selectedMonth}-${day}`
                      setDrillDown({
                        title: t('dashboard.drillDownDay', { date: new Date(dateStr + 'T00:00:00').toLocaleDateString(locale) }),
                        from: dateStr,
                        to: dateStr,
                        isSpendingOnly: true,
                      })
                    }
                  }}
                >
                  <defs>
                    <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={3}
                  />
                  <YAxis
                    tickFormatter={(v) => {
                      if (privacyMode) return ''
                      if (v === 0) return '0'
                      return formatCurrency(v, userCurrency, locale).replace(/,00$/, '').replace(/\.00$/, '')
                    }}
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    width={56}
                    tickCount={5}
                    domain={[
                      (dataMin: number) => dataMin < 0 ? Math.floor(dataMin / 100) * 100 : 0,
                      (dataMax: number) => Math.ceil(dataMax / 100) * 100,
                    ]}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      value !== null ? (privacyMode !== 'visible' ? MASK : formatCurrency(Number(value), userCurrency, locale)) : '\u2014',
                      name === 'current' ? monthLabel(selectedMonth, locale).split(' ')[0] : name === 'projected' ? `${monthLabel(selectedMonth, locale).split(' ')[0]} (Proj)` : monthLabel(prevMonth, locale).split(' ')[0],
                    ]}
                    labelFormatter={(day) => t('dashboard.day', { day })}
                    contentStyle={{
                      background: 'var(--card)',
                      color: 'var(--foreground)',
                      border: '1px solid var(--border)',
                      borderRadius: '0.75rem',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke="#10B981"
                    strokeWidth={2}
                    fill="url(#cumGrad)"
                    dot={false}
                    activeDot={{ r: 3, fill: '#10B981' }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="projected"
                    stroke="#10B981"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{ r: 3, fill: '#10B981' }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="previous"
                    stroke="#94A3B8"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    dot={false}
                    activeDot={{ r: 3, fill: '#94A3B8' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-12">{t('dashboard.noData')}</p>
            )}
          </div>
          {!balanceHistoryLoading && lastCurrentPoint && (() => {
            const footerDay = hoveredDay ?? lastDay
            const footerPrev = balanceHistory?.previous.find(d => d.day === footerDay)?.balance ?? 0
            const footerCurrent = cumulativeData.find(d => d.day === footerDay)?.current ?? totalBalance
            const footerPct = footerPrev !== 0 ? ((footerCurrent - footerPrev) / Math.abs(footerPrev)) * 100 : null
            if (footerPrev === 0 || footerPct === null) return null
            return (
              <div className="px-5 pb-4 pt-0 shrink-0">
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.balanceFlowVsPrev', {
                    month: monthLabel(prevMonth, locale).split(' ')[0],
                    day: footerDay,
                    amount: mask(formatCurrency(footerPrev, userCurrency, locale)),
                    delta: `${footerPct >= 0 ? '+' : ''}${footerPct.toFixed(1)}%`,
                  })}
                  {' '}
                  <span className={footerPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}>
                    {footerPct >= 0 ? '\u25B2' : '\u25BC'}
                  </span>
                </p>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Period Transactions */}
      <div>
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <p className="text-sm font-semibold text-foreground">{t('dashboard.periodTransactions')}</p>
          </div>
          {txListLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : pagedRows.length > 0 ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="pl-5 text-xs font-medium text-muted-foreground">{t('transactions.description')}</TableHead>
                    <TableHead className="pr-5 text-right text-xs font-medium text-muted-foreground">{t('transactions.amount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRows.map((row) => (
                    <TableRow
                      key={row.key}
                      className={`border-b border-border last:border-0 ${!row.isProjected ? 'cursor-pointer hover:bg-muted' : ''}`}
                      onClick={() => {
                        if (row.isProjected) return
                        const tx = currentMonthTxs?.items.find((t) => t.id === row.key)
                        if (tx) { setEditingTx(tx); setDialogOpen(true) }
                      }}
                    >
                      <TableCell className="py-2.5 pl-5">
                        <div className="flex items-center gap-3">
                          <CategoryIcon icon={row.categoryIcon} color={row.categoryColor} size="lg" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground truncate">{row.description}</p>
                              {row.isProjected && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-600 shrink-0">
                                  {t('transactions.recurringBadge')}
                                </span>
                              )}
                              {!row.isProjected && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const tx = currentMonthTxs?.items.find((t) => t.id === row.key)
                                    if (tx) {
                                      setQuickRuleTx(tx)
                                      setQuickRuleOpen(true)
                                    }
                                  }}
                                  className="p-1 text-muted-foreground/40 hover:text-primary hover:bg-primary/5 rounded transition-colors"
                                  title="Criar regra para esta transação"
                                >
                                  <Wand2 size={12} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <p className="text-xs text-muted-foreground">{formatDate(row.date, locale)}</p>
                              {(() => {
                                const tx = currentMonthTxs?.items.find((t) => t.id === row.key)
                                if (tx?.merchant_cnpj) {
                                  return (
                                    <span 
                                      className="text-[8px] font-medium tracking-wide text-muted-foreground bg-accent border border-border px-1 py-0 rounded cursor-help flex items-center gap-1 shrink-0"
                                      title={tx.merchant_name ? `${tx.merchant_name} (${tx.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")})` : `CNPJ: ${tx.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")}`}
                                    >
                                      <Store size={8} />
                                      {tx.merchant_name ? (tx.merchant_name.length > 12 ? tx.merchant_name.substring(0, 12) + '...' : tx.merchant_name) : 'Loja'}
                                    </span>
                                  )
                                }
                                return null
                              })()}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 pr-5 text-right">
                        <span className={`text-sm font-semibold tabular-nums ${row.type === 'credit' ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {mask(`${row.type === 'credit' ? '+' : '-'}${formatCurrency(Math.abs(row.amount), row.currency, locale)}`)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {txTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 py-4 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={txPage <= 1}
                    onClick={() => setTxPage(txPage - 1)}
                  >
                    {t('dashboard.previous')}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {txPage} / {txTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={txPage >= txTotalPages}
                    onClick={() => setTxPage(txPage + 1)}
                  >
                    {t('dashboard.next')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">{t('dashboard.noTransactions')}</p>
          )}
        </div>
      </div>

      {/* Spending Heatmap */}
      <div className="bg-card rounded-xl border border-border shadow-sm mt-5 overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">{t('dashboard.heatmapTitle')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t('dashboard.heatmapDesc')}</p>
        </div>
        <div className="p-4 overflow-x-auto">
          {heatmapLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : heatmapData && heatmapData.length > 0 ? (
            <HeatmapGrid data={heatmapData} locale={locale} currency={userCurrency} privacyMode={privacyMode}
              onDayClick={(date) => setDrillDown({
                title: t('dashboard.drillDownDay', { date: new Date(date + 'T00:00:00').toLocaleDateString(locale) }),
                from: date,
                to: date,
                isSpendingOnly: true,
              })}
            />
          ) : (
            <p className="text-muted-foreground text-sm text-center py-8">{t('dashboard.noData')}</p>
          )}
        </div>
      </div>

      <TransactionDrillDown
        filter={drillDown}
        onClose={() => setDrillDown(null)}
        onTransactionClick={(tx) => { setEditingTx(tx); setDialogOpen(true) }}
      />

      <TransactionDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingTx(null) }}
        transaction={editingTx}
        categories={(categoriesList ?? []).map((c: { id: string; name: string; icon: string }) => ({ id: c.id, name: c.name, icon: c.icon }))}
        accounts={(accountsList ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))}
        onSave={(data) => {
          if (editingTx) updateMutation.mutate({ id: editingTx.id, ...data })
        }}
        onDelete={() => {
          if (editingTx) deleteMutation.mutate(editingTx.id)
        }}
        loading={updateMutation.isPending || deleteMutation.isPending}
        error={updateMutation.error ? extractApiError(updateMutation.error) : deleteMutation.error ? extractApiError(deleteMutation.error) : null}
        isSynced={!!editingTx?.external_id}
      />

      <QuickRuleDialog
        open={quickRuleOpen}
        onClose={() => { setQuickRuleOpen(false); setQuickRuleTx(null) }}
        transaction={quickRuleTx}
      />
    </div>
  )
}
