import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, Bar, ComposedChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, PieChart as PieChartIcon, Sparkles, CreditCard, Layers,
  ChevronDown, Wallet, Building2, Calendar,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { useAuth } from '@/contexts/auth-context'
import { reports, accounts as accountsApi } from '@/lib/api'
import type { InstallmentsResponse } from '@/types'
import { TransactionDrillDown, type DrillDownFilter } from '@/components/transaction-drill-down'

/* ── PT-BR translation map for backend labels ─────────────── */
const LABEL_PT: Record<string, string> = {
  Accounts: 'Contas', accounts: 'Contas',
  Assets: 'Ativos', assets: 'Ativos',
  Liabilities: 'Passivos', liabilities: 'Passivos',
  Income: 'Receitas', income: 'Receitas',
  Expenses: 'Despesas', expenses: 'Despesas',
  'Net Income': 'Receita Líquida', netIncome: 'Receita Líquida',
  Spending: 'Gastos', spending: 'Gastos',
  Payments: 'Pagamentos', payments: 'Pagamentos',
  Net: 'Líquido', Uncategorized: 'Sem categoria',
  Other: 'Outros',
}
function tLabel(label: string, lang: string) {
  if (lang === 'en') return label
  return LABEL_PT[label] || label
}

/* ── Helpers ──────────────────────────────────────────────────── */
function formatCurrency(value: number, currency = 'BRL', locale = 'pt-BR') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(value)
}
function formatCompact(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(0)
}

/* ── Tab definitions ──────────────────────────────────────────── */
const TABS = [
  { id: 'netWorth', icon: TrendingUp, labelPt: 'Patrimônio Líquido', label: 'Net Worth' },
  { id: 'incomeExpenses', icon: Sparkles, labelPt: 'Receitas vs Despesas', label: 'Income vs Expenses' },
  { id: 'creditCard', icon: CreditCard, labelPt: 'Cartão de Crédito', label: 'Credit Card' },
  { id: 'installments', icon: Layers, labelPt: 'Parcelamentos', label: 'Installments' },
] as const
type TabId = (typeof TABS)[number]['id']

const RANGES = [
  { months: 6, label: '6M' },
  { months: 12, label: '1A' },
  { months: 24, label: '2A' },
]
const INTERVALS = [
  { value: 'daily', label: 'Dia' },
  { value: 'weekly', label: 'Sem' },
  { value: 'monthly', label: 'Mês' },
  { value: 'yearly', label: 'Ano' },
]

/* ── Tooltip style ────────────────────────────────────────────── */
const tooltipStyle: React.CSSProperties = {
  backgroundColor: '#0f172a',
  color: '#f1f5f9',
  border: '1px solid #334155',
  borderRadius: '10px',
  fontSize: '12px',
  boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
}
const tooltipWrap = { zIndex: 9999, pointerEvents: 'none' as const }

/* ── Account type icon ────────────────────────────────────────── */
function AccountIcon({ type }: { type: string }) {
  if (type === 'credit_card') return <CreditCard className="w-3.5 h-3.5" />
  if (type === 'savings' || type === 'investment') return <Building2 className="w-3.5 h-3.5" />
  return <Wallet className="w-3.5 h-3.5" />
}

/* ── Chart Colors ─────────────────────────────────────────────── */
const HEATMAP_COLORS = ['#1e293b', '#2f4858', '#f97316', '#ef4444', '#dc2626']
const CHART_COLORS = [
  '#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#0ea5e9', '#14b8a6', '#f97316', '#6366f1'
]

/* ══════════════════════════════════════════════════════════════
   HEATMAP COMPONENT (GitHub-style contribution graph)
   ══════════════════════════════════════════════════════════════ */
function SpendingHeatmap({
  data,
  isLoading,
  isPrivate,
  userCurrency,
  locale,
  MASK: _HEATMAPMASK,
  blurClass: _blurClass,
  title,
  onDayClick,
}: {
  data: { date: string; amount: number; level: number; top_item?: string }[] | undefined
  isLoading: boolean
  isPrivate: boolean
  userCurrency: string
  locale: string
  MASK: string
  blurClass: string
  title: string
  onDayClick?: (date: string) => void
}) {
  const [tooltip, setTooltip] = useState<{ day: any; x: number; y: number } | null>(null)

  if (isLoading) return <div className="px-4"><Skeleton className="h-32 rounded-xl" /></div>
  if (!data || data.length === 0) return null

  // Group by weeks (columns) × days (rows 0-6)
  const weeks: { date: string; amount: number; level: number; top_item?: string }[][] = []
  let currentWeek: typeof weeks[0] = []

  // Pad start to align with day of week
  const firstDate = new Date(data[0].date + 'T00:00:00')
  const startDow = firstDate.getDay()
  for (let i = 0; i < startDow; i++) currentWeek.push({ date: '', amount: 0, level: -1 })

  for (const d of data) {
    currentWeek.push(d)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)

  // Month labels
  const monthLabels: { name: string; weekIdx: number }[] = []
  let lastMonth = -1
  for (let wi = 0; wi < weeks.length; wi++) {
    for (const d of weeks[wi]) {
      if (d.date) {
        const dt = new Date(d.date + 'T00:00:00')
        if (dt.getMonth() !== lastMonth) {
          lastMonth = dt.getMonth()
          monthLabels.push({
            name: dt.toLocaleDateString(locale, { month: 'short' }),
            weekIdx: wi,
          })
        }
        break
      }
    }
  }

  return (
    <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10 relative">
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-primary" />
        <p className="text-sm font-bold text-foreground">{title}</p>
      </div>
      <div className="px-4 pb-4 overflow-x-auto">
        {/* Month labels */}
        <div className="flex mb-1 ml-6" style={{ gap: 0 }}>
          {monthLabels.map((ml, i) => (
            <div
              key={i}
              className="text-[10px] text-muted-foreground"
              style={{ position: 'relative', left: ml.weekIdx * 13 + 'px', whiteSpace: 'nowrap' }}
            >
              {i === 0 || ml.weekIdx - (monthLabels[i - 1]?.weekIdx ?? 0) > 2 ? ml.name : ''}
            </div>
          ))}
        </div>
        {/* Grid */}
        <div className="flex items-start gap-1 relative">
          {/* Day labels */}
          <div className="flex flex-col gap-[2px] mr-1 mt-0">
            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
              <div key={i} className="w-3 h-[11px] text-[8px] text-muted-foreground flex items-center justify-center">
                {i % 2 === 1 ? d : ''}
              </div>
            ))}
          </div>
          {/* Weeks */}
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {week.map((day, di) => (
                <div
                  key={`${wi}-${di}`}
                  className={`w-[11px] h-[11px] rounded-[2px] transition-colors ${day.level !== -1 ? 'cursor-pointer hover:ring-1 hover:ring-foreground/30' : ''}`}
                  style={{
                    backgroundColor: day.level === -1 ? 'transparent' : HEATMAP_COLORS[day.level],
                  }}
                  onMouseEnter={(e) => {
                    if (day.level !== -1) {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setTooltip({ day, x: rect.left + rect.width / 2, y: rect.top })
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => {
                    if (day.level !== -1 && onDayClick) {
                      onDayClick(day.date)
                    }
                  }}
                />
              ))}
              {/* Pad remaining cells */}
              {week.length < 7 && Array.from({ length: 7 - week.length }).map((_, pi) => (
                <div key={`pad-${pi}`} className="w-[11px] h-[11px]" />
              ))}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-1 mt-3 justify-end">
          <span className="text-[9px] text-muted-foreground mr-1">Menos</span>
          {HEATMAP_COLORS.map((c, i) => (
            <div key={i} className="w-[11px] h-[11px] rounded-[2px]" style={{ backgroundColor: c }} />
          ))}
          <span className="text-[9px] text-muted-foreground ml-1">Mais</span>
        </div>
      </div>
      
      {/* Floating tooltip like dashboard */}
      {tooltip && createPortal(
        <div
          className="fixed z-50 px-3 py-2 rounded-xl bg-[#0f172a] border border-[#334155] shadow-2xl text-xs pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 56, transform: 'translateX(-50%)' }}
        >
          <p className="font-semibold text-foreground mb-1">
            {new Date(tooltip.day.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short' })},{' '}
            {new Date(tooltip.day.date + 'T00:00:00').toLocaleDateString(locale)}
          </p>
          <p className="text-[#e2e8f0] mb-0.5">
            {isPrivate ? '••••' : formatCurrency(tooltip.day.amount, userCurrency, locale)}
          </p>
          {tooltip.day.top_item && (
            <p className="text-[10px] text-muted-foreground mt-1 px-1.5 py-0.5 bg-white/5 rounded w-max max-w-[150px] truncate">
              {tooltip.day.top_item}
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function ReportsPage() {
  const { i18n } = useTranslation()
  const { privacyMode, blurClass, MASK } = usePrivacyMode()
  const { user } = useAuth()
  const userCurrency = user?.preferences?.currency_display ?? 'BRL'
  const locale = i18n.language === 'en' ? 'en-US' : i18n.language
  const lang = i18n.language

  const isPrivate = privacyMode !== 'visible'
  const isBlurred = privacyMode === 'blurred'
  const isHidden = privacyMode === 'hidden'

  const [activeTab, setActiveTab] = useState<TabId>('netWorth')
  const [months, setMonths] = useState(12)
  const [interval, setInterval] = useState('monthly')
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined)
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)
  const [drillDown, setDrillDown] = useState<DrillDownFilter | null>(null)

  const { data: accountsList } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })
  const selectedAccount = accountsList?.find(a => a.id === selectedAccountId)
  const currentTab = TABS.find(tab => tab.id === activeTab)!

  // Data queries
  const reportQuery = useQuery({
    queryKey: ['reports', activeTab, months, interval, selectedAccountId],
    queryFn: () => {
      switch (activeTab) {
        case 'netWorth': return reports.netWorth(months, interval, selectedAccountId)
        case 'incomeExpenses': return reports.incomeExpenses(months, interval, selectedAccountId)
        case 'creditCard': return reports.creditCard(months, interval, selectedAccountId)
        default: return reports.netWorth(months, interval, selectedAccountId)
      }
    },
    enabled: activeTab !== 'installments',
  })

  const installmentsQuery = useQuery({
    queryKey: ['reports', 'installments', selectedAccountId],
    queryFn: () => reports.installments(selectedAccountId),
    enabled: activeTab === 'installments',
  })

  // Heatmap query - for income/expenses and credit card tabs
  const heatmapType = activeTab === 'creditCard' ? 'credit_card' : 'all'
  const heatmapQuery = useQuery({
    queryKey: ['reports', 'heatmap', months, heatmapType, selectedAccountId],
    queryFn: () => reports.heatmap(Math.min(months, 6), heatmapType, selectedAccountId),
    enabled: activeTab === 'incomeExpenses' || activeTab === 'creditCard',
  })

  const data = reportQuery.data
  const isLoading = activeTab === 'installments' ? installmentsQuery.isLoading : reportQuery.isLoading
  const summary = data?.summary
  const trend = data?.trend ?? []
  const meta = data?.meta
  const composition = data?.composition ?? []
  const categoryTrend = data?.category_trend ?? []

  // Chart data
  const chartData = trend.map((dp) => ({ date: dp.date, value: dp.value, ...dp.breakdowns } as Record<string, string | number>))

  const breakdownLabels: Record<string, string> = {}
  const colorMap: Record<string, string> = {}
  for (const b of summary?.breakdowns ?? []) {
    breakdownLabels[b.key] = tLabel(b.label, lang)
    colorMap[b.key] = b.color
  }
  const breakdownData = (summary?.breakdowns ?? []).filter(b => b.value > 0)

  const changePrefix = (summary?.change_amount ?? 0) >= 0 ? '+' : ''
  const changeColor = (summary?.change_amount ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'

  // Composition — always show individual categories for all tab types
  // We use visually distinct vibrant colors globally to fix the "too similar" issue
  const donutData = useMemo(() => {
    return composition.map((c, i) => ({
      ...c,
      name: tLabel(c.label, lang),
      color: CHART_COLORS[i % CHART_COLORS.length]
    }))
  }, [composition, lang])

  // Category trends (for sparklines)
  const filteredCategoryTrend = useMemo(() => {
    if (meta?.type === 'income_expenses') {
      return categoryTrend.filter(ct => ct.group === 'expenses')
    }
    return categoryTrend
  }, [categoryTrend, meta?.type])

  // Donut tooltip
  const renderDonutTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload
      const total = donutData.reduce((s, i) => s + i.value, 0)
      const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0'
      const color = d.color || '#6366F1'
      return (
        <div className="bg-[#0f172a] border border-[#334155] rounded-xl p-3 shadow-2xl min-w-[180px]" style={{ zIndex: 9999 }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[#94a3b8] font-medium text-sm">{d.name || d.label}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-[#f1f5f9] font-bold text-[15px]">
              {isPrivate ? MASK : formatCurrency(d.value, userCurrency, locale)}
            </span>
            <span style={{ color, backgroundColor: `${color}1A` }} className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded">
              {pct}%
            </span>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      {/* ═══ Header with filters ═══════════════════════════════ */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">
          {lang === 'en' ? 'Reports' : 'Relatórios'}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Account selector */}
          <div className="relative">
            <button
              onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-foreground"
            >
              {selectedAccount ? (
                <>
                  <AccountIcon type={selectedAccount.type} />
                  <span className="max-w-[120px] truncate">{selectedAccount.custom_name || selectedAccount.name}</span>
                </>
              ) : (
                <>
                  <Wallet className="w-3.5 h-3.5" />
                  <span>{lang === 'en' ? 'All Accounts' : 'Todas as Contas'}</span>
                </>
              )}
              <ChevronDown className="w-3.5 h-3.5 opacity-50" />
            </button>
            {accountDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAccountDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#0f172a] border border-[#334155] rounded-xl shadow-2xl py-1 max-h-64 overflow-y-auto">
                  <button
                    onClick={() => { setSelectedAccountId(undefined); setAccountDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2 ${!selectedAccountId ? 'text-primary font-medium' : 'text-[#e2e8f0]'}`}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    {lang === 'en' ? 'All Accounts' : 'Todas as Contas'}
                  </button>
                  {accountsList?.filter(a => !a.is_closed).map(acc => (
                    <button
                      key={acc.id}
                      onClick={() => { setSelectedAccountId(acc.id); setAccountDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center gap-2 ${selectedAccountId === acc.id ? 'text-primary font-medium' : 'text-[#e2e8f0]'}`}
                    >
                      <AccountIcon type={acc.type} />
                      <span className="truncate">{acc.custom_name || acc.name}</span>
                      <span className="ml-auto text-[10px] text-[#64748b] capitalize">{acc.type.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Period + Interval selectors */}
          {activeTab !== 'installments' && (
            <>
              <div className="flex items-center rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                {RANGES.map(r => (
                  <button key={r.months} onClick={() => setMonths(r.months)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${months === r.months ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >{r.label}</button>
                ))}
              </div>
              <div className="flex items-center rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                {INTERVALS.map(iv => (
                  <button key={iv.value} onClick={() => setInterval(iv.value)}
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${interval === iv.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >{iv.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Tabs ═══════════════════════════════════ */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-primary text-primary-foreground shadow-lg' : 'text-muted-foreground hover:text-foreground hover:bg-white/5'}`}
            >
              <Icon className="w-4 h-4" />
              {lang === 'en' ? tab.label : tab.labelPt}
            </button>
          )
        })}
      </div>

      {/* ═══ Installments Tab ═══════════════════════════════ */}
      {activeTab === 'installments' ? (
        <InstallmentsView
          data={installmentsQuery.data} isLoading={installmentsQuery.isLoading}
          isPrivate={isPrivate} blurClass={blurClass} MASK={MASK}
          userCurrency={userCurrency} locale={locale} language={lang}
        />
      ) : (
        <>
          {/* ═══ Hero Summary Cards ═══════════════════════════ */}
          <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10 p-6">
            {isLoading ? (
              <div className="space-y-3"><Skeleton className="h-10 w-48" /><Skeleton className="h-6 w-32" /></div>
            ) : (
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                    {lang === 'en' ? currentTab.label : currentTab.labelPt}
                  </p>
                  <p className={`text-3xl font-bold tabular-nums ${isBlurred ? blurClass : ''}`}>
                    {isHidden ? MASK : formatCurrency(summary?.primary_value ?? 0, userCurrency, locale)}
                  </p>
                  {summary?.change_percent != null && (
                    <p className={`text-sm mt-1 ${changeColor}`}>
                      <span className={isBlurred ? blurClass : ''}>
                        {isHidden ? MASK : `${changePrefix}${formatCurrency(summary.change_amount, userCurrency, locale)}`}
                      </span>
                      <span className="ml-1 text-xs opacity-70">({changePrefix}{summary.change_percent.toFixed(1)}%)</span>
                    </p>
                  )}
                </div>
                {/* Breakdown pills */}
                <div className="flex items-center gap-3 flex-wrap">
                  {breakdownData.map(b => (
                    <div key={b.key} className="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{tLabel(b.label, lang)}</span>
                      </div>
                      <span className={`text-sm font-bold ${isBlurred ? blurClass : ''}`}>
                        {isHidden ? MASK : formatCurrency(b.value, userCurrency, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ═══ Main Trend Chart ═══════════════════════════ */}
          <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10">
            <div className="px-5 pt-4 pb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <p className="text-sm font-bold text-foreground">
                {lang === 'en' ? 'Evolution' : 'Evolução'}
              </p>
            </div>
            <div className="px-1 pb-4" style={{ height: 320 }}>
              {isLoading ? (
                <div className="px-4 h-full"><Skeleton className="h-full w-full rounded-xl" /></div>
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  {meta?.type === 'income_expenses' || meta?.type === 'credit_card' ? (
                    <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis
                        tickFormatter={(v: number) => isPrivate ? '' : v === 0 ? '0' : formatCompact(v)}
                        tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={56} tickCount={5}
                      />
                      <Tooltip
                        formatter={(value?: number, name?: string) => [
                          isPrivate ? MASK : formatCurrency(value ?? 0, userCurrency, locale),
                          breakdownLabels[name ?? ''] || tLabel(name ?? '', lang),
                        ]}
                        contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#e2e8f0' }}
                        wrapperStyle={tooltipWrap}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                      {meta?.type === 'income_expenses' ? (
                        <>
                          <Bar dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={24} name={tLabel('Income', lang)} />
                          <Bar dataKey="expenses" fill="#F43F5E" radius={[4, 4, 0, 0]} maxBarSize={24} name={tLabel('Expenses', lang)} />
                          <Line type="monotone" dataKey="value" stroke="#6366F1" strokeWidth={2} dot={false} name={tLabel('Net', lang)} />
                        </>
                      ) : (
                        <>
                          <Bar dataKey="spending" fill="#F43F5E" radius={[4, 4, 0, 0]} maxBarSize={24} name={tLabel('Spending', lang)} />
                          <Bar dataKey="payments" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={24} name={tLabel('Payments', lang)} />
                        </>
                      )}
                      <Legend wrapperStyle={{ color: '#94a3b8', paddingTop: '8px' }} />
                    </ComposedChart>
                  ) : (
                    <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366F1" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis
                        tickFormatter={(v: number) => isPrivate ? '' : v === 0 ? '0' : formatCompact(v)}
                        tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={56} tickCount={5}
                      />
                      <Tooltip
                        formatter={(value?: number) => [
                          isPrivate ? MASK : formatCurrency(value ?? 0, userCurrency, locale),
                          lang === 'en' ? currentTab.label : currentTab.labelPt,
                        ]}
                        contentStyle={tooltipStyle} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#e2e8f0' }}
                        wrapperStyle={tooltipWrap}
                      />
                      <Area type="monotone" dataKey="value" stroke="#6366F1" strokeWidth={2} fill="url(#netWorthGrad)" dot={false} activeDot={{ r: 3, fill: '#6366F1' }} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-16">{lang === 'en' ? 'No data for this period.' : 'Sem dados para o período.'}</p>
              )}
            </div>
          </div>

          {/* ═══ Composition (Donut) + Category Legend ═══════ */}
          {donutData.length > 0 && (
            <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10 overflow-visible relative z-10">
              <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                <PieChartIcon className="w-4 h-4 text-primary" />
                <p className="text-sm font-bold text-foreground">
                  {lang === 'en' ? 'Composition' : 'Composição'}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-5 pb-5">
                {/* Donut Chart */}
                <div className="flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie 
                        data={donutData} 
                        cx="50%" cy="50%" 
                        innerRadius={55} outerRadius={85} 
                        dataKey="value" nameKey="name" 
                        paddingAngle={2} stroke="none"
                        labelLine={false}
                        label={({ cx, cy, midAngle = 0, innerRadius, outerRadius, percent = 0 }) => {
                          if (percent < 0.04) return null; // Hide text for slices < 4%
                          const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                          const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
                          const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);
                          return (
                            <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight="bold" style={{ pointerEvents: 'none', textShadow: '0px 1px 2px rgba(0,0,0,0.8)' }}>
                              {`${(percent * 100).toFixed(0)}%`}
                            </text>
                          );
                        }}
                      >
                        {donutData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip content={renderDonutTooltip} isAnimationActive={false} wrapperStyle={tooltipWrap} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend as sidebar list */}
                <div className="flex flex-col justify-center gap-1.5 max-h-[220px] overflow-y-auto pr-2">
                  {donutData
                    .sort((a, b) => b.value - a.value)
                    .map((item, i) => {
                    const total = donutData.reduce((s, x) => s + x.value, 0)
                    const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0'
                    return (
                      <div key={i} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-white/5 transition">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="text-xs text-foreground truncate flex-1">{item.name}</span>
                        <span className={`text-xs font-mono text-muted-foreground ${isBlurred ? blurClass : ''}`}>
                          {isHidden ? '•••' : formatCurrency(item.value, userCurrency, locale)}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground/60 w-10 text-right">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ Heatmap (for income/expenses and credit card) ═══ */}
          {(activeTab === 'incomeExpenses' || activeTab === 'creditCard') && (
            <SpendingHeatmap
              data={heatmapQuery.data}
              isLoading={heatmapQuery.isLoading}
              isPrivate={isPrivate}
              userCurrency={userCurrency}
              locale={locale}
              MASK={MASK}
              blurClass={blurClass}
              title={
                activeTab === 'creditCard'
                  ? (lang === 'en' ? 'Credit Card Spending Heatmap' : 'Heatmap de Gastos no Cartão')
                  : (lang === 'en' ? 'Spending Heatmap' : 'Heatmap de Gastos')
              }
              onDayClick={(date) => {
                setDrillDown({
                  title: `Transações em ${new Date(date + 'T00:00:00').toLocaleDateString(locale)}`,
                  from: date,
                  to: date,
                  account_id: selectedAccountId,
                  isSpendingOnly: true,
                })
              }}
            />
          )}

          {/* ═══ Category Sparklines ═══════════════════════════ */}
          {filteredCategoryTrend.length > 0 && (
            <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10">
              <div className="px-5 pt-4 pb-2">
                <p className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  {lang === 'en' ? 'Category Trends' : 'Tendência por Categoria'}
                </p>
              </div>
              <div className="px-4 pb-4">
                {isLoading ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {filteredCategoryTrend.map(item => (
                      <div key={item.key} className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground truncate max-w-[70%]">{item.label}</span>
                          <span className={`text-xs font-semibold ${isBlurred ? blurClass : ''}`} style={{ color: item.color }}>
                            {isHidden ? MASK : formatCompact(item.total)}
                          </span>
                        </div>
                        <div style={{ height: 44 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={item.series} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                              <defs>
                                <linearGradient id={`spark_${item.key}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor={item.color} stopOpacity={0.25} />
                                  <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="date" hide />
                              <Tooltip
                                formatter={(value?: number) => [
                                  isPrivate ? MASK : formatCurrency(value ?? 0, userCurrency, locale),
                                  item.label,
                                ]}
                                contentStyle={{ ...tooltipStyle, padding: '4px 8px' }}
                                labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#e2e8f0' }}
                                wrapperStyle={tooltipWrap}
                              />
                              <Area type="monotone" dataKey="value" stroke={item.color} strokeWidth={1.5} fill={`url(#spark_${item.key})`} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ DrillDown Modal ═════════════════════════════ */}
      {drillDown && (
        <TransactionDrillDown filter={drillDown} onClose={() => setDrillDown(null)} />
      )}
    </div>
  )
}


/* ══════════════════════════════════════════════════════════════
   INSTALLMENTS VIEW
   ══════════════════════════════════════════════════════════════ */
function InstallmentsView({
  data, isLoading, isPrivate, blurClass, MASK, userCurrency, locale, language,
}: {
  data: InstallmentsResponse | undefined
  isLoading: boolean
  isPrivate: boolean
  blurClass: string
  MASK: string
  userCurrency: string
  locale: string
  language: string
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const isBlurred = blurClass.includes('blur')

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!data || data.count === 0) {
    return (
      <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10 p-12 text-center">
        <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-30" />
        <p className="text-muted-foreground">
          {language === 'en' ? 'No active installments found.' : 'Nenhum parcelamento ativo encontrado.'}
        </p>
      </div>
    )
  }

  function buildTimeline(item: InstallmentsResponse['items'][0]) {
    const lines = []
    const baseDate = item.date ? new Date(item.date + 'T00:00:00') : null
    for (let n = 1; n <= item.total_installments; n++) {
      let estimatedDate: Date | null = null
      if (baseDate) {
        estimatedDate = new Date(baseDate)
        estimatedDate.setMonth(estimatedDate.getMonth() + (n - item.current_installment))
      }
      lines.push({ number: n, isPaid: n <= item.current_installment, date: estimatedDate, amount: item.installment_amount })
    }
    return lines
  }

  function fmtDate(d: Date | null) {
    if (!d) return '—'
    return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {language === 'en' ? 'Active Installments' : 'Parcelamentos Ativos'}
          </p>
          <p className="text-2xl font-bold text-foreground">{data.count}</p>
        </div>
        <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {language === 'en' ? 'Monthly Commitment' : 'Comprometimento Mensal'}
          </p>
          <p className={`text-2xl font-bold text-rose-400 ${isBlurred ? blurClass : ''}`}>
            {isPrivate && !isBlurred ? MASK : formatCurrency(data.total_monthly, userCurrency, locale)}
          </p>
        </div>
        <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {language === 'en' ? 'Total Remaining' : 'Total Restante'}
          </p>
          <p className={`text-2xl font-bold text-amber-400 ${isBlurred ? blurClass : ''}`}>
            {isPrivate && !isBlurred ? MASK : formatCurrency(data.total_remaining, userCurrency, locale)}
          </p>
        </div>
      </div>

      {/* Installment Table */}
      <div className="bg-card/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl shadow-black/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10">
          <p className="text-sm font-bold text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            {language === 'en' ? 'Active Installments' : 'Parcelamentos Ativos'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {language === 'en' ? 'Click a row to see installment timeline' : 'Clique para ver cronograma das parcelas'}
          </p>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-5 py-3">{language === 'en' ? 'Description' : 'Descrição'}</th>
                <th className="text-left px-4 py-3">{language === 'en' ? 'Account' : 'Conta'}</th>
                <th className="text-right px-4 py-3">{language === 'en' ? 'Installment' : 'Parcela'}</th>
                <th className="text-center px-4 py-3">{language === 'en' ? 'Progress' : 'Progresso'}</th>
                <th className="text-right px-4 py-3">{language === 'en' ? 'Remaining' : 'Restante'}</th>
                <th className="text-right px-5 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => {
                const progress = (item.current_installment / item.total_installments) * 100
                const isExpanded = expandedIndex === i
                const timeline = isExpanded ? buildTimeline(item) : []
                return (
                  <> 
                    <tr key={`r-${i}`}
                      className={`border-b border-white/5 hover:bg-white/5 transition cursor-pointer ${isExpanded ? 'bg-white/5' : ''}`}
                      onClick={() => setExpandedIndex(isExpanded ? null : i)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          {item.category_color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.category_color }} />}
                          <span className="font-medium text-foreground">{item.description}</span>
                          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                        {item.category_name && <p className="text-[10px] text-muted-foreground mt-0.5">{item.category_name}</p>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" />{item.account_name}</span>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${isBlurred ? blurClass : ''}`}>
                        {isPrivate && !isBlurred ? MASK : formatCurrency(item.installment_amount, userCurrency, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground font-mono">{item.current_installment}/{item.total_installments}</span>
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-amber-400 ${isBlurred ? blurClass : ''}`}>
                        {isPrivate && !isBlurred ? MASK : formatCurrency(item.remaining_amount, userCurrency, locale)}
                      </td>
                      <td className={`px-5 py-3 text-right font-mono text-muted-foreground ${isBlurred ? blurClass : ''}`}>
                        {isPrivate && !isBlurred ? MASK : formatCurrency(item.total_amount, userCurrency, locale)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`d-${i}`}><td colSpan={6} className="p-0">
                        <div className="bg-white/[0.02] border-b border-white/10 px-8 py-4">
                          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                            {timeline.map(t => (
                              <div key={t.number}
                                className={`rounded-lg p-2 text-center text-xs border ${
                                  t.isPaid
                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                    : t.number === item.current_installment + 1
                                      ? 'bg-primary/10 border-primary/30 text-primary ring-1 ring-primary/30'
                                      : 'bg-white/5 border-white/5 text-muted-foreground'
                                }`}
                              >
                                <div className="font-bold">{t.number}/{item.total_installments}</div>
                                <div className="text-[10px] mt-0.5 opacity-70">{fmtDate(t.date)}</div>
                                <div className={`text-[10px] font-mono mt-0.5 ${isBlurred ? blurClass : ''}`}>
                                  {isPrivate && !isBlurred ? '•••' : formatCurrency(t.amount, userCurrency, locale)}
                                </div>
                                <div className="mt-1">{t.isPaid ? <span className="text-emerald-400">✓</span> : <span className="opacity-30">○</span>}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile */}
        <div className="md:hidden p-4 space-y-3">
          {data.items.map((item, i) => {
            const progress = (item.current_installment / item.total_installments) * 100
            const isExpanded = expandedIndex === i
            const timeline = isExpanded ? buildTimeline(item) : []
            return (
              <div key={i} className="bg-white/5 rounded-xl border border-white/5 overflow-hidden">
                <div className="p-4 space-y-3 cursor-pointer" onClick={() => setExpandedIndex(isExpanded ? null : i)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {item.category_color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.category_color }} />}
                      <span className="font-medium text-foreground text-sm">{item.description}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">{item.current_installment}/{item.total_installments}</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1"><CreditCard className="w-3 h-3" />{item.account_name}</span>
                    <span className={`font-mono text-amber-400 ${isBlurred ? blurClass : ''}`}>
                      {isPrivate && !isBlurred ? MASK : formatCurrency(item.remaining_amount, userCurrency, locale)}
                    </span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-white/10 bg-white/[0.02] px-4 py-3">
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {timeline.map(t => (
                        <div key={t.number}
                          className={`rounded-lg p-2 text-center text-xs border ${
                            t.isPaid
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                              : t.number === item.current_installment + 1
                                ? 'bg-primary/10 border-primary/30 text-primary'
                                : 'bg-white/5 border-white/5 text-muted-foreground'
                          }`}
                        >
                          <div className="font-bold">{t.number}/{item.total_installments}</div>
                          <div className="text-[10px] mt-0.5 opacity-70">{fmtDate(t.date)}</div>
                          <div className="mt-1">{t.isPaid ? <span className="text-emerald-400">✓</span> : <span className="opacity-30">○</span>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
