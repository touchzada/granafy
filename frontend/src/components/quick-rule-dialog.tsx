import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rules, categories, transactions as apiTransactions } from '@/lib/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Wand2, Info } from 'lucide-react'
import type { Transaction } from '@/types'

interface QuickRuleDialogProps {
  open: boolean
  onClose: () => void
  transaction: Transaction | null
}

export function QuickRuleDialog({ open, onClose, transaction }: QuickRuleDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [matchValue, setMatchValue] = useState('')
  const [existingRuleId, setExistingRuleId] = useState('')
  const [applyAll, setApplyAll] = useState(true)
  const [isRuleEnabled, setIsRuleEnabled] = useState(false)
  const [ruleName, setRuleName] = useState('')

  const { data: categoriesList } = useQuery({
    queryKey: ['categories'],
    queryFn: categories.list,
  })

  const { data: rulesList } = useQuery({
    queryKey: ['rules'],
    queryFn: rules.list,
  })

  useEffect(() => {
    if (transaction) {
      setSelectedCategoryId(transaction.category_id || '')
      setMatchValue(transaction.description)
      setExistingRuleId('')
      setApplyAll(true)
      setIsRuleEnabled(false)
      setRuleName('')
    }
  }, [transaction])

  const updateTxMutation = useMutation({
    mutationFn: (payload: { category_id: string }) =>
      apiTransactions.update(transaction!.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('transactions.updateSuccess', 'Transação categorizada com sucesso!'))
      onClose()
    },
    onError: (error: any) => {
      const msg = error.response?.data?.detail || t('common.error')
      toast.error(msg)
    },
  })

  const quickCreateMutation = useMutation({
    mutationFn: (payload: { name?: string; description: string; category_id: string; existing_rule_id?: string; apply_all: boolean }) =>
      rules.quickCreate(payload as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['rules'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('rules.quickCreateSuccess', 'Regra criada e aplicada com sucesso!'))
      onClose()
    },
    onError: (error: any) => {
      const msg = error.response?.data?.detail || t('common.error')
      toast.error(msg)
    },
  })

  if (!transaction) return null

  const handleCreate = () => {
    if (!selectedCategoryId) {
      toast.error(t('rules.selectCategoryError', 'Por favor, selecione uma categoria'))
      return
    }

    if (!isRuleEnabled) {
      updateTxMutation.mutate({ category_id: selectedCategoryId })
      return
    }

    if (!matchValue.trim()) {
      toast.error('O texto de busca não pode estar vazio')
      return
    }

    quickCreateMutation.mutate({
      name: ruleName.trim() || undefined,
      description: matchValue.trim(),
      category_id: selectedCategoryId,
      existing_rule_id: existingRuleId || undefined,
      apply_all: applyAll,
    })
  }

  const isPending = quickCreateMutation.isPending || updateTxMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Wand2 className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle>Categorizar Transação</DialogTitle>
          </div>
          <DialogDescription>
            Defina uma categoria para esta transação. Você também pode criar uma regra para categorizar transações futuras automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="flex items-center justify-between">
              Texto para identificar a transação
              <span className="text-[10px] text-muted-foreground font-normal">A regra buscará por lançamentos que contenham este texto</span>
            </Label>
            <Input 
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              placeholder="Ex: IFOOD, Uber, Netflix..."
              className="font-medium"
            />
          </div>

          <div className="space-y-2">
            <Label>Categoria Destino</Label>

            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
            >
              <option value="">Selecione uma categoria...</option>
              {categoriesList?.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2 pb-1 border-t border-border mt-4">
            <input
              type="checkbox"
              id="isRuleEnabled"
              checked={isRuleEnabled}
              onChange={(e) => setIsRuleEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
            />
            <Label htmlFor="isRuleEnabled" className="text-sm font-medium cursor-pointer">
              Criar uma regra automática com base nesta transação
            </Label>
          </div>

          {isRuleEnabled && (
            <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  Nome da Regra <span className="text-[10px] text-muted-foreground font-normal">(Opcional)</span>
                </Label>
                <Input 
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Ex: Assinaturas de Streaming"
                  className="font-medium"
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center justify-between">
                  Texto de identificação
                  <span className="text-[10px] text-muted-foreground font-normal">Irá buscar lançamentos com este texto</span>
                </Label>
                <Input 
                  value={matchValue}
                  onChange={(e) => setMatchValue(e.target.value)}
                  placeholder="Ex: IFOOD, Uber, Netflix..."
                  className="font-medium"
                />
              </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Adicionar a uma regra existente
              <span className="text-[10px] text-muted-foreground font-normal">(Opcional)</span>
            </Label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              value={existingRuleId}
              onChange={(e) => setExistingRuleId(e.target.value)}
            >
              <option value="">Criar nova regra</option>
              {rulesList?.filter(r => r.is_active).map((rule) => (
                <option key={rule.id} value={rule.id}>{rule.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1 mt-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Se selecionado, a descrição será adicionada como uma nova condição à regra escolhida.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="applyAll"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
            />
            <Label htmlFor="applyAll" className="text-sm font-normal cursor-pointer">
              Re-aplicar regras a todas as transações agora
            </Label>
          </div>
          </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={isPending}>
            {isPending ? t('common.loading') : (isRuleEnabled ? 'Criar Regra' : 'Salvar Categoria')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
