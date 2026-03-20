import { useState, useCallback } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/auth-context'
import { auth as authApi } from '@/lib/api'
import { OnboardingTour } from '@/components/onboarding-tour'
import { MiniAiChat } from '@/components/mini-ai-chat'
import { useTheme } from 'next-themes'
import { accounts as accountsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ShellLogo } from '@/components/shell-logo'
import {
  LayoutDashboard,
  ArrowLeftRight,
  Building2,
  SlidersHorizontal,
  Upload,
  LogOut,
  Menu,
  ChevronRight,
  Tag,
  PiggyBank,
  Eye,
  EyeOff,
  Repeat,
  Landmark,
  Sun,
  Moon,
  Brain,
  Wallet,
  CreditCard,
  Undo2,
  GripVertical,
  Target,
  BarChart3,
} from 'lucide-react'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ... 

const navItems = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard },
  { key: 'transactions', path: '/transactions', icon: ArrowLeftRight },
  { key: 'accounts', path: '/accounts', icon: Building2 },
  { key: 'categories', path: '/categories', icon: Tag },
  { key: 'budgets', path: '/budgets', icon: PiggyBank },
  { key: 'assets', path: '/assets', icon: Landmark },
  { key: 'goals', path: '/goals', icon: Target },
  { key: 'reports', path: '/reports', icon: BarChart3 },
  { key: 'recurring', path: '/recurring', icon: Repeat },
  { key: 'rules', path: '/rules', icon: SlidersHorizontal },
  { key: 'import', path: '/import', icon: Upload },
  { key: 'advisor', path: '/advisor', icon: Brain },
] as const

function formatCurrency(value: number, currency = 'BRL', locale = 'pt-BR') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value)
}

export function AppLayout() {
  const { t, i18n } = useTranslation()
  const { user, logout, updateUser } = useAuth()
  const locale = i18n.language === 'en' ? 'en-US' : i18n.language
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { privacyMode, togglePrivacyMode, mask, blurClass } = usePrivacyMode()

  const showTour = user && !user.preferences?.onboarding_completed && !localStorage.getItem('onboarding_completed')

  const handleTourComplete = useCallback(async () => {
    localStorage.setItem('onboarding_completed', 'true')
    try {
      const prefs = { ...(user?.preferences || {}), onboarding_completed: true }
      const updated = await authApi.updateMe({ preferences: prefs })
      updateUser(updated)
    } catch {
      // localStorage fallback is already set
    }
  }, [user, updateUser])

  const userInitial = user?.email?.charAt(0).toUpperCase() ?? '?'
  const currentLang = i18n.language

  const { data: accountsList } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  const allAccounts = accountsList ?? []

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 bg-sidebar border-b border-sidebar-border px-4 lg:hidden">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-sidebar-muted hover:text-sidebar-foreground transition-colors"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <ShellLogo size={22} className="text-primary shrink-0" />
          <span className="font-bold text-sidebar-foreground">{t('app.name')}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={togglePrivacyMode}
            className="text-sidebar-muted hover:text-sidebar-foreground transition-colors p-1"
            title={privacyMode !== 'visible' ? t('privacy.show') : t('privacy.hide')}
          >
            {privacyMode !== 'visible' ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <UserMenu userInitial={userInitial} logout={logout} dark />
        </div>
      </header>

      <div className="flex">
        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-60 bg-sidebar border-r border-sidebar-border flex flex-col transform transition-transform lg:translate-x-0 shrink-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo */}
          <div className="flex h-16 items-center justify-between px-5 border-b border-sidebar-border shrink-0">
            <div className="flex items-center gap-2.5">
              <ShellLogo size={24} className="text-primary shrink-0" />
              <span className="font-bold text-lg text-sidebar-foreground tracking-tight shrink-0">{t('app.name')}</span>
            </div>
            <button
              onClick={togglePrivacyMode}
              className="text-sidebar-muted hover:text-sidebar-foreground transition-colors p-1 rounded-md hover:bg-sidebar-accent"
              title={privacyMode !== 'visible' ? t('privacy.show') : t('privacy.hide')}
            >
              {privacyMode !== 'visible' ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex flex-col gap-1 p-3" data-tour="sidebar">
            {navItems.map((item) => {
              const isActive = item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path)
              const Icon = item.icon
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  data-tour={`nav-${item.key}`}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    'flex items-center gap-3 text-[15px] font-medium transition-all',
                    isActive
                      ? 'bg-primary/[0.08] text-primary rounded-lg border-l-[3px] border-primary pl-[9px] pr-3 py-2'
                      : 'rounded-lg px-3 py-2 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  )}
                >
                  <Icon
                    size={20}
                    className={cn('shrink-0', isActive ? 'text-primary' : 'text-sidebar-muted')}
                  />
                  <span>{t(`nav.${item.key}`)}</span>
                </Link>
              )
            })}
          </nav>

          {/* Account list in sidebar */}
          <SidebarAccounts 
            accounts={allAccounts} 
            locale={locale} 
            setSidebarOpen={setSidebarOpen} 
            mask={mask} 
            formatCurrency={formatCurrency} 
            blurClass={blurClass}
          />

          <div className="flex-1" />

          {/* Language & Theme toggles */}
          <div className="group/toggles px-3 pb-2 border-b border-sidebar-border">
            <div className="flex items-center justify-between gap-2 px-1 py-2">
              {/* Language toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => i18n.changeLanguage('pt-BR')}
                  className={cn(
                    'px-2 py-1 rounded text-[11px] font-semibold transition-all duration-300',
                    currentLang === 'pt-BR'
                      ? 'bg-primary/15 text-primary group-hover/toggles:bg-primary/25'
                      : 'text-sidebar-muted/40 group-hover/toggles:text-sidebar-muted group-hover/toggles:hover:text-sidebar-foreground'
                  )}
                >
                  PT
                </button>
                <button
                  onClick={() => i18n.changeLanguage('en')}
                  className={cn(
                    'px-2 py-1 rounded text-[11px] font-semibold transition-all duration-300',
                    currentLang === 'en'
                      ? 'bg-primary/15 text-primary group-hover/toggles:bg-primary/25'
                      : 'text-sidebar-muted/40 group-hover/toggles:text-sidebar-muted group-hover/toggles:hover:text-sidebar-foreground'
                  )}
                >
                  EN
                </button>
              </div>
              {/* Theme toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    'p-1.5 rounded transition-all duration-300',
                    theme === 'light'
                      ? 'bg-primary/15 text-primary group-hover/toggles:bg-primary/25'
                      : 'text-sidebar-muted/40 group-hover/toggles:text-sidebar-muted group-hover/toggles:hover:text-sidebar-foreground'
                  )}
                >
                  <Sun size={14} />
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'p-1.5 rounded transition-all duration-300',
                    theme === 'dark'
                      ? 'bg-primary/15 text-primary group-hover/toggles:bg-primary/25'
                      : 'text-sidebar-muted/40 group-hover/toggles:text-sidebar-muted group-hover/toggles:hover:text-sidebar-foreground'
                  )}
                >
                  <Moon size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* User section */}
          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm hover:bg-sidebar-accent transition-colors text-left">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                      {userInitial}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-sidebar-muted truncate flex-1">{user?.email}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48" side="top">
                <DropdownMenuItem
                  onClick={logout}
                  className="flex items-center gap-2 text-rose-600 focus:text-rose-600"
                >
                  <LogOut size={14} />
                  {t('auth.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-screen overflow-x-hidden lg:ml-60">
          <div className="p-6 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {showTour && <OnboardingTour onComplete={handleTourComplete} />}
      <MiniAiChat />
    </div>
  )
}

function UserMenu({ userInitial, logout, dark }: { userInitial: string; logout: () => void; dark?: boolean }) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full p-0">
          <Avatar className="h-8 w-8">
            <AvatarFallback className={dark ? 'bg-primary/20 text-primary text-xs font-semibold' : 'bg-primary/10 text-primary text-xs font-semibold'}>
              {userInitial}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
          {t('auth.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarAccounts({ accounts, locale, setSidebarOpen, mask, formatCurrency, blurClass }: any) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const queryClient = useQueryClient()

  // build groups
  const groupsMap: Record<string, any> = {}

  accounts.forEach((account: any) => {
    const isCard = account.type === 'credit_card'
    if (!isCard) {
      // Logic for non-card accounts
    }
    
    let groupName = 'Contas Manuais'
    if (account.connection_id) {
       groupName = account.name.split(' - ')[0] || account.name.split(' ')[0] || 'Conexão Bancária'
       if (groupName.toLowerCase().includes('pagamentos')) groupName = 'Instituição de Pagamento'
       groupName = account.name.includes('-') ? account.name.split('-')[0].trim() : groupName
    } else {
       groupName = account.name.split(' ')[0]
    }
    
    const key = account.connection_id || groupName
    
    if (!groupsMap[key]) {
      groupsMap[key] = {
         id: key,
         name: groupName,
         cashAccts: [],
         creditAccts: [],
         sortOrder: account.sort_order || 0
      }
    } else {
      groupsMap[key].sortOrder = Math.min(groupsMap[key].sortOrder, account.sort_order || 0)
      // Prefer checking/savings account name over credit card name for the group label
      if (!isCard && account.connection_id) {
        groupsMap[key].name = groupName
      }
    }
    
    if (isCard) groupsMap[key].creditAccts.push(account)
    else groupsMap[key].cashAccts.push(account)
  })

  const groupList = Object.values(groupsMap).sort((a: any, b: any) => a.sortOrder - b.sortOrder)
  
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const updateOrderMutation = useMutation({
    mutationFn: async (updates: { id: string, sort_order: number }[]) => {
      await Promise.all(updates.map(u => accountsApi.update(u.id, { sort_order: u.sort_order })))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] })
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = groupList.findIndex(g => g.id === active.id)
      const newIndex = groupList.findIndex(g => g.id === over.id)
      const newList = arrayMove(groupList, oldIndex, newIndex)
      
      const updates: {id: string, sort_order: number}[] = []
      newList.forEach((g: any, index) => {
        g.cashAccts.forEach((a: any) => updates.push({ id: a.id, sort_order: index }))
        g.creditAccts.forEach((a: any) => updates.push({ id: a.id, sort_order: index }))
      })
      
      updateOrderMutation.mutate(updates)
    }
  }

  const isGroupExpanded = (groupId: string) => expandedGroups[groupId] === true

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !isGroupExpanded(groupId) }))
  }

  const toggleCards = (groupId: string) => {
    setExpandedCards(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  if (accounts.length === 0) return null

  return (
    <div className="px-3 pb-2 mt-2 space-y-2">
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between w-full px-3 py-2 hover:text-sidebar-foreground transition-colors group"
        >
          <div className="flex items-center gap-2">
            <Wallet size={14} className="text-sidebar-muted group-hover:text-primary transition-colors" />
            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-sidebar-muted group-hover:text-sidebar-foreground transition-colors">{t('accounts.title')}</span>
          </div>
          <ChevronRight
            size={14}
            className={cn('text-sidebar-muted transition-transform duration-300', expanded && 'rotate-90')}
          />
        </button>
        
        {/* Animated expand for entire accounts section */}
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="mt-1 space-y-1">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={groupList.map((g: any) => g.id)} strategy={verticalListSortingStrategy}>
                  {groupList.map((group: any) => {
                    const groupOpen = isGroupExpanded(group.id)

                    return (
                      <SortableGroup key={group.id} group={group}>
                        {/* Bank header with dropdown arrow */}
                        <button 
                          onClick={() => toggleGroup(group.id)}
                          className="flex items-center justify-between w-full px-2 py-1.5 rounded-md hover:bg-sidebar-accent/50 transition-colors group/bank"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <ChevronRight
                              size={11}
                              className={cn(
                                'text-sidebar-muted shrink-0 transition-transform duration-300 ease-out',
                                groupOpen && 'rotate-90'
                              )}
                            />
                            <span className="text-[10px] font-bold text-sidebar-muted uppercase tracking-widest truncate group-hover/bank:text-sidebar-foreground transition-colors">
                              {group.name}
                            </span>
                          </div>
                        </button>

                        {/* Animated bank body */}
                        <div
                          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                          style={{ gridTemplateRows: groupOpen ? '1fr' : '0fr' }}
                        >
                          <div className="overflow-hidden">
                            <div className="space-y-0.5 pl-2 border-l border-sidebar-border/30 ml-1.5">
                              {/* Conta Corrente sub-label */}
                              {group.cashAccts.length > 0 && (
                                <p className="text-[9px] font-semibold text-sidebar-muted/50 uppercase tracking-widest px-2 pt-1.5 pb-0.5">
                                  Conta Corrente
                                </p>
                              )}
                              {group.cashAccts.map((acc: any) => (
                                <EditableAccountLink 
                                  key={acc.id} 
                                  acc={acc} 
                                  balance={Number(acc.current_balance)} 
                                  isCreditCard={false}
                                  setSidebarOpen={setSidebarOpen}
                                  mask={mask}
                                  formatCurrency={formatCurrency}
                                  locale={locale}
                                  blurClass={blurClass}
                                />
                              ))}
                              
                              {/* Credit Cards sub-section */}
                              {group.creditAccts.length > 0 && (
                                <div className="mt-1">
                                  <button
                                    onClick={() => toggleCards(group.id)}
                                    className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-sidebar-muted/50 hover:text-sidebar-foreground transition-colors w-full group/cards"
                                  >
                                    <CreditCard size={10} />
                                    <span>Cartões ({group.creditAccts.length})</span>
                                    <ChevronRight
                                      size={10}
                                      className={cn('ml-auto text-sidebar-muted transition-transform duration-300 ease-out', expandedCards[group.id] && 'rotate-90')}
                                    />
                                  </button>
                                  
                                  {/* Animated cards expand */}
                                  <div
                                    className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                                    style={{ gridTemplateRows: expandedCards[group.id] ? '1fr' : '0fr' }}
                                  >
                                    <div className="overflow-hidden">
                                      <div className="space-y-0.5 mt-0.5">
                                        {group.creditAccts.map((acc: any) => (
                                          <EditableAccountLink 
                                            key={acc.id} 
                                            acc={acc} 
                                            balance={Number(acc.current_balance)} 
                                            isCreditCard={true}
                                            setSidebarOpen={setSidebarOpen}
                                            mask={mask}
                                            formatCurrency={formatCurrency}
                                            locale={locale}
                                            blurClass={blurClass}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </SortableGroup>
                    )
                  })}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SortableGroup({ group, children }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg bg-sidebar-accent/15 border border-sidebar-border/20 p-1">
      <div className="flex items-center group/header">
        <div className="flex-1 min-w-0">{children}</div>
        <button 
          {...attributes} 
          {...listeners}
          className="opacity-0 group-hover/header:opacity-100 cursor-grab active:cursor-grabbing text-sidebar-muted hover:text-sidebar-foreground self-start mt-2 mr-1 shrink-0"
        >
          <GripVertical size={12} />
        </button>
      </div>
    </div>
  )
}

function EditableAccountLink({ acc, balance, isCreditCard, setSidebarOpen, mask, formatCurrency, locale, blurClass }: any) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(acc.custom_name || acc.name)
  const queryClient = useQueryClient()
  
  const usedAmount = isCreditCard ? Math.abs(Number(acc.current_balance)) : 0;
  const totalLimit = isCreditCard ? ((acc.credit_data?.creditLimit ?? Number(acc.balance)) || 0) : 0;
  const progress = totalLimit > 0 ? (usedAmount / totalLimit) * 100 : 0;
  
  const updateMutation = useMutation({
    mutationFn: (data: any) => accountsApi.update(acc.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setIsEditing(false)
    }
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      if (name.trim() !== acc.custom_name && name.trim() !== acc.name) updateMutation.mutate({ custom_name: name.trim() })
      else setIsEditing(false)
    }
    if (e.key === 'Escape') {
      setName(acc.custom_name || acc.name)
      setIsEditing(false)
    }
  }

  const handleRestore = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    updateMutation.mutate({ custom_name: null })
  }

  return (
    <div className={`group/account flex ${isCreditCard ? 'flex-col items-stretch' : 'items-center justify-between'} px-2 py-1.5 rounded-lg text-xs hover:bg-sidebar-accent transition-all relative`}>
      <div className="flex items-center justify-between w-full">
        {isEditing ? (
          <input 
            autoFocus
            className="bg-background/80 border border-primary/50 rounded px-1.5 py-0.5 text-xs text-sidebar-foreground w-[130px] outline-none"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (name.trim() !== acc.custom_name && name.trim() !== acc.name) updateMutation.mutate({ custom_name: name.trim() })
              else setIsEditing(false)
            }}
          />
        ) : (
          <Link
            to={`/accounts/${acc.id}`}
            onClick={() => setSidebarOpen(false)}
            onDoubleClick={(e) => { e.preventDefault(); setIsEditing(true); }}
            className="truncate flex-1 text-sidebar-muted hover:text-sidebar-foreground flex items-center gap-1.5 min-w-0"
            title="Duplo clique para editar o nome"
          >
            <span className="truncate">{acc.custom_name || acc.name}</span>
            {isCreditCard && acc.credit_level && (
              <span className="ml-1.5 px-1 py-[1px] rounded-[3px] text-[7px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                {acc.credit_level}
              </span>
            )}
            {isCreditCard && acc.account_number && (
              <span className="text-[9px] tabular-nums font-mono text-sidebar-muted/80 bg-sidebar-accent/50 px-1 py-0.5 rounded border border-sidebar-border/50 shrink-0">
                •••• {acc.account_number}
              </span>
            )}
          </Link>
        )}
        
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {!isEditing && acc.custom_name && acc.custom_name !== acc.name && (
            <button 
              onClick={handleRestore}
              className="opacity-0 group-hover/account:opacity-100 p-0.5 text-sidebar-muted hover:text-primary transition-all bg-sidebar-accent rounded-sm"
              title="Restaurar nome original do banco"
            >
              <Undo2 size={12} />
            </button>
          )}
          {!isCreditCard && (
            <Link
              to={`/accounts/${acc.id}`}
              onClick={() => setSidebarOpen(false)}
              className={`tabular-nums font-medium ${balance < 0 ? 'text-rose-400' : 'text-sidebar-foreground'} ${blurClass}`}
            >
              {mask(formatCurrency(balance, acc.currency, locale))}
            </Link>
          )}
        </div>
      </div>

      {isCreditCard && (
        <Link to={`/accounts/${acc.id}`} onClick={() => setSidebarOpen(false)} className="mt-1.5 flex items-center justify-between gap-2 opacity-80 group-hover/account:opacity-100 transition-opacity">
          <div className="flex-1 h-1 bg-sidebar-border/50 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${progress > 90 ? 'bg-rose-500' : progress > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
          <div className="flex items-center gap-1 justify-end shrink-0">
            <span className={`text-[9px] tabular-nums font-medium text-rose-400 ${blurClass}`}>
              {mask(formatCurrency(usedAmount, acc.currency, locale))}
            </span>
            <span className="text-[8px] text-sidebar-muted/60">/</span>
            <span className={`text-[9px] tabular-nums font-medium text-sidebar-muted ${blurClass}`}>
              {mask(formatCurrency(totalLimit, acc.currency, locale))}
            </span>
          </div>
        </Link>
      )}
    </div>
  )
}
