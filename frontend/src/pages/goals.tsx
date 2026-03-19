import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { goals as goalsApi, accounts as accountsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, PiggyBank, CalendarDays, ArrowUpRight, Target, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/contexts/auth-context'
import type { Goal } from '@/types'

function formatCurrency(value: number, currency = 'BRL', locale = 'pt-BR') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

function daysUntil(dateStr: string | null) {
  if (!dateStr) return null
  const target = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff
}

const EMOJI_OPTIONS = ['🎯', '🏠', '✈️', '🚗', '💍', '📱', '🎓', '💰', '🏖️', '🎮', '👶', '🐶', '💪', '🎸', '📦']
const COLOR_OPTIONS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7']

export default function GoalsPage() {
  const { user } = useAuth()
  const userCurrency = user?.preferences?.currency_display ?? 'BRL'
  const queryClient = useQueryClient()

  const [showModal, setShowModal] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [depositGoalId, setDepositGoalId] = useState<string | null>(null)
  const [depositAmount, setDepositAmount] = useState('')

  // Form state
  const [formName, setFormName] = useState('')
  const [formTarget, setFormTarget] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formIcon, setFormIcon] = useState('🎯')
  const [formColor, setFormColor] = useState('#6366f1')

  const { data: goalsList, isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: goalsApi.list,
  })

  const { data: accountsList } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const createMutation = useMutation({
    mutationFn: goalsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Meta criada com sucesso!')
      closeModal()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: Partial<Goal> & { id: string }) => goalsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Meta atualizada!')
      closeModal()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: goalsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Meta excluída')
    },
  })

  const depositMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => goalsApi.deposit(id, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Depósito registrado!')
      setDepositGoalId(null)
      setDepositAmount('')
    },
  })

  function openCreate() {
    setEditingGoal(null)
    setFormName('')
    setFormTarget('')
    setFormDate('')
    setFormAccountId('')
    setFormIcon('🎯')
    setFormColor('#6366f1')
    setShowModal(true)
  }

  function openEdit(goal: Goal) {
    setEditingGoal(goal)
    setFormName(goal.name)
    setFormTarget(String(goal.target_amount))
    setFormDate(goal.target_date || '')
    setFormAccountId(goal.account_id || '')
    setFormIcon(goal.icon)
    setFormColor(goal.color)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingGoal(null)
  }

  function handleSave() {
    if (!formName.trim() || !formTarget) return
    const payload = {
      name: formName.trim(),
      target_amount: parseFloat(formTarget),
      currency: userCurrency,
      target_date: formDate || undefined,
      account_id: formAccountId || undefined,
      icon: formIcon,
      color: formColor,
    }
    if (editingGoal) {
      updateMutation.mutate({ id: editingGoal.id, ...payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const activeGoals = goalsList?.filter(g => !g.is_completed) || []
  const completedGoals = goalsList?.filter(g => g.is_completed) || []

  return (
    <div className="min-h-screen relative">
      {/* Ambient background blobs */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-indigo-500/8 blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-1/2 -left-40 w-[500px] h-[500px] rounded-full bg-violet-500/6 blur-3xl animate-pulse" style={{ animationDuration: '12s' }} />
        <div className="absolute -bottom-40 right-1/4 w-[400px] h-[400px] rounded-full bg-fuchsia-500/5 blur-3xl animate-pulse" style={{ animationDuration: '10s' }} />
      </div>

      <PageHeader
        section="Financeiro"
        title="Metas"
        action={
          <Button
            onClick={openCreate}
            className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-lg shadow-indigo-500/25 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/30 hover:-translate-y-0.5"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nova Meta
          </Button>
        }
      />

      <div className="px-8 pb-12">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-72 rounded-3xl bg-card/30 backdrop-blur-xl border border-border/40 animate-pulse" />
            ))}
          </div>
        ) : activeGoals.length === 0 && completedGoals.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-500/20 backdrop-blur-xl border border-indigo-500/20 flex items-center justify-center mb-6 animate-bounce" style={{ animationDuration: '3s' }}>
              <Target className="w-10 h-10 text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Nenhuma meta criada</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">
              Crie metas de economia para acompanhar seu progresso financeiro. Defina um valor-alvo e uma data para alcançar seus objetivos!
            </p>
            <Button
              onClick={openCreate}
              className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Criar primeira meta
            </Button>
          </div>
        ) : (
          <>
            {/* Active Goals */}
            {activeGoals.length > 0 && (
              <div className="mb-10">
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-5 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Metas Ativas ({activeGoals.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {activeGoals.map((goal, i) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      currency={userCurrency}
                      delay={i * 80}
                      onEdit={() => openEdit(goal)}
                      onDelete={() => deleteMutation.mutate(goal.id)}
                      depositGoalId={depositGoalId}
                      depositAmount={depositAmount}
                      setDepositGoalId={setDepositGoalId}
                      setDepositAmount={setDepositAmount}
                      onDeposit={() => {
                        if (!depositAmount || parseFloat(depositAmount) <= 0) return
                        depositMutation.mutate({ id: goal.id, amount: parseFloat(depositAmount) })
                      }}
                      depositPending={depositMutation.isPending}
                      accountsList={accountsList}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed Goals */}
            {completedGoals.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-5 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  Metas Concluídas ({completedGoals.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {completedGoals.map((goal, i) => (
                    <GoalCard
                      key={goal.id}
                      goal={goal}
                      currency={userCurrency}
                      delay={i * 80}
                      onEdit={() => openEdit(goal)}
                      onDelete={() => deleteMutation.mutate(goal.id)}
                      depositGoalId={depositGoalId}
                      depositAmount={depositAmount}
                      setDepositGoalId={setDepositGoalId}
                      setDepositAmount={setDepositAmount}
                      onDeposit={() => {}}
                      depositPending={false}
                      accountsList={accountsList}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
          <div
            className="relative w-full max-w-lg mx-4 bg-card/80 backdrop-blur-2xl border border-border/50 rounded-3xl shadow-2xl shadow-black/20 p-8 animate-in fade-in zoom-in-95 duration-300"
          >
            <h3 className="text-lg font-bold text-foreground mb-6 flex items-center gap-3">
              <span className="text-2xl">{formIcon}</span>
              {editingGoal ? 'Editar Meta' : 'Nova Meta'}
            </h3>

            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Nome da Meta
                </label>
                <Input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Ex: Viagem para o Japão"
                  className="bg-background/50 border-border/50 focus:border-indigo-500/50 transition-colors"
                />
              </div>

              {/* Target Amount */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Valor-alvo (R$)
                </label>
                <Input
                  type="number"
                  value={formTarget}
                  onChange={e => setFormTarget(e.target.value)}
                  placeholder="10000.00"
                  className="bg-background/50 border-border/50 focus:border-indigo-500/50 transition-colors"
                />
              </div>

              {/* Target Date */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Data-alvo (Opcional)
                </label>
                <Input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="bg-background/50 border-border/50 focus:border-indigo-500/50 transition-colors"
                />
              </div>

              {/* Linked Account */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Vincular a uma conta (Opcional)
                </label>
                <select
                  value={formAccountId}
                  onChange={e => setFormAccountId(e.target.value)}
                  className="w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm text-foreground focus:border-indigo-500/50 outline-none transition-colors"
                >
                  <option value="">Global (sem vínculo)</option>
                  {accountsList?.filter(a => a.type !== 'credit_card').map(a => (
                    <option key={a.id} value={a.id}>{a.custom_name || a.name}</option>
                  ))}
                </select>
              </div>

              {/* Icon Selection */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Ícone
                </label>
                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => setFormIcon(emoji)}
                      className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all duration-200 ${
                        formIcon === emoji
                          ? 'bg-indigo-500/20 border-2 border-indigo-500 scale-110 shadow-lg shadow-indigo-500/20'
                          : 'bg-muted/40 border border-border/40 hover:bg-muted/60 hover:scale-105'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Selection */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Cor
                </label>
                <div className="flex gap-2">
                  {COLOR_OPTIONS.map(color => (
                    <button
                      key={color}
                      onClick={() => setFormColor(color)}
                      className={`w-8 h-8 rounded-full transition-all duration-200 ${
                        formColor === color
                          ? 'scale-125 ring-2 ring-offset-2 ring-offset-background'
                          : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-8">
              <Button variant="outline" onClick={closeModal} className="flex-1 border-border/50">
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={!formName.trim() || !formTarget || createMutation.isPending || updateMutation.isPending}
                className="flex-1 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white shadow-lg shadow-indigo-500/25"
              >
                {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : editingGoal ? 'Salvar' : 'Criar Meta'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── GOAL CARD ─── */
function GoalCard({
  goal,
  currency,
  delay,
  onEdit,
  onDelete,
  depositGoalId,
  depositAmount,
  setDepositGoalId,
  setDepositAmount,
  onDeposit,
  depositPending,
  accountsList,
}: {
  goal: Goal
  currency: string
  delay: number
  onEdit: () => void
  onDelete: () => void
  depositGoalId: string | null
  depositAmount: string
  setDepositGoalId: (id: string | null) => void
  setDepositAmount: (v: string) => void
  onDeposit: () => void
  depositPending: boolean
  accountsList: any
}) {
  const progress = Math.min(goal.progress, 100)
  const remaining = Math.max(0, Number(goal.target_amount) - Number(goal.current_amount))
  const days = daysUntil(goal.target_date)
  const linkedAccount = accountsList?.find((a: any) => a.id === goal.account_id)

  return (
    <div
      className="group relative bg-card/30 backdrop-blur-xl border border-border/40 rounded-3xl overflow-hidden shadow-sm hover:shadow-xl hover:shadow-black/5 hover:-translate-y-1 transition-all duration-500"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Colored top accent */}
      <div
        className="h-1.5 w-full"
        style={{ background: `linear-gradient(90deg, ${goal.color}, ${goal.color}88)` }}
      />

      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-3xl"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${goal.color}15 0%, transparent 60%)`,
        }}
      />

      <div className="p-6 relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
              style={{
                background: `linear-gradient(135deg, ${goal.color}30, ${goal.color}15)`,
                boxShadow: `0 4px 14px ${goal.color}20`,
              }}
            >
              {goal.icon}
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground leading-tight">{goal.name}</h3>
              {linkedAccount && (
                <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
                  <PiggyBank className="w-3 h-3" />
                  {linkedAccount.custom_name || linkedAccount.name}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xl font-bold tabular-nums text-foreground">
              {formatCurrency(Number(goal.current_amount), currency)}
            </span>
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: goal.color }}
            >
              {progress.toFixed(0)}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-muted/40 overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden"
              style={{
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${goal.color}, ${goal.color}cc)`,
              }}
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[11px] text-muted-foreground">
              faltam {formatCurrency(remaining, currency)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              de {formatCurrency(Number(goal.target_amount), currency)}
            </span>
          </div>
        </div>

        {/* Date countdown */}
        {days !== null && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
            <CalendarDays className="w-3.5 h-3.5" />
            {days > 0 ? (
              <span>{days} dias restantes</span>
            ) : days === 0 ? (
              <span className="text-amber-500 font-semibold">Hoje é o dia!</span>
            ) : (
              <span className="text-rose-500 font-semibold">{Math.abs(days)} dias atrasado</span>
            )}
          </div>
        )}

        {/* Deposit area */}
        {!goal.is_completed && (
          depositGoalId === goal.id ? (
            <div className="flex gap-2 animate-in slide-in-from-bottom-2 duration-200">
              <Input
                type="number"
                placeholder="R$ 0,00"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                className="flex-1 h-9 text-sm bg-background/50 border-border/50"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && onDeposit()}
              />
              <Button
                size="sm"
                onClick={onDeposit}
                disabled={depositPending || !depositAmount}
                className="h-9 px-4 text-xs font-semibold text-white shadow-lg"
                style={{ background: `linear-gradient(135deg, ${goal.color}, ${goal.color}cc)` }}
              >
                {depositPending ? '...' : 'Depositar'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setDepositGoalId(null); setDepositAmount('') }}
                className="h-9 px-2 text-xs"
              >
                ✕
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setDepositGoalId(goal.id)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 hover:shadow-lg border border-border/40 hover:border-transparent"
              style={{
                color: goal.color,
                background: `${goal.color}08`,
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = `${goal.color}15` }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = `${goal.color}08` }}
            >
              <ArrowUpRight className="w-4 h-4" />
              Depositar
            </button>
          )
        )}

        {goal.is_completed && (
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-emerald-600 bg-emerald-500/10 border border-emerald-500/20">
            <Sparkles className="w-4 h-4" />
            Meta concluída! 🎉
          </div>
        )}
      </div>
    </div>
  )
}
