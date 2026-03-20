import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DatePickerGranafyProps {
    value: string;
    onChange: (v: string) => void;
    label?: string;
    compact?: boolean;
    alignPopover?: 'left' | 'right' | 'center';
    disabled?: boolean;
}

export function DatePickerGranafy({ value, onChange, label, compact = false, alignPopover = 'left', disabled = false }: DatePickerGranafyProps) {
    const { i18n } = useTranslation();
    const isPt = i18n.language?.startsWith('pt');
    const MONTHS = isPt ? MONTHS_PT : MONTHS_EN;
    const DAYS = isPt ? DAYS_PT : DAYS_EN;
    const presets = isPt
        ? [{ k: 'today', l: 'Hoje' }, { k: 'week', l: 'Semana' }, { k: 'month', l: 'Mês' }, { k: 'year', l: 'Ano' }, { k: 'all', l: 'Tudo' }]
        : [{ k: 'today', l: 'Today' }, { k: 'week', l: 'Week' }, { k: 'month', l: 'Month' }, { k: 'year', l: 'Year' }, { k: 'all', l: 'All' }];
    const backLabel = isPt ? '← Voltar para hoje' : '← Back to today';
    const selectLabel = isPt ? 'Selecionar data' : 'Select date';
    const presetsLabel = isPt ? 'Atalhos' : 'Shortcuts';

    const [open, setOpen] = useState(false);
    const parsed = value ? new Date(value + 'T00:00:00') : new Date();
    const [viewMonth, setViewMonth] = useState(parsed.getMonth());
    const [viewYear, setViewYear] = useState(parsed.getFullYear());

    useEffect(() => {
        if (value) {
            const d = new Date(value + 'T00:00:00');
            if (open) { // Update view when value changes if open
              setViewMonth(d.getMonth());
              setViewYear(d.getFullYear());
            }
        }
    }, [value, open]);

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const todayStr = new Date().toISOString().split('T')[0];

    const prevMonth = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
        else setViewMonth(viewMonth - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
        else setViewMonth(viewMonth + 1);
    };
    const select = (day: number) => {
        const m = String(viewMonth + 1).padStart(2, '0');
        const d = String(day).padStart(2, '0');
        onChange(`${viewYear}-${m}-${d}`);
        setOpen(false);
    };
    const applyPreset = (preset: string) => {
        const now = new Date();
        const fmt = (d: Date) => d.toISOString().split('T')[0];
        if (preset === 'today') onChange(fmt(now));
        else if (preset === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); onChange(label === 'De' || label === 'From' ? fmt(d) : fmt(now)); }
        else if (preset === 'month') { const d = new Date(now.getFullYear(), now.getMonth(), 1); onChange(label === 'De' || label === 'From' ? fmt(d) : fmt(now)); }
        else if (preset === 'year') { const d = new Date(now.getFullYear(), 0, 1); onChange(label === 'De' || label === 'From' ? fmt(d) : fmt(now)); }
        else if (preset === 'all') { onChange(label === 'De' || label === 'From' ? '2010-01-01' : fmt(now)); }
        setOpen(false);
    };

    const displayDate = value ? (() => {
        const d = new Date(value + 'T00:00:00');
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    })() : selectLabel;

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const alignMap = { left: 'start' as const, right: 'end' as const, center: 'center' as const };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    disabled={disabled}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-300 cursor-pointer select-none border ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${open
                        ? 'bg-card border-primary/50 text-foreground shadow-lg'
                        : value
                            ? 'bg-card/60 border-border text-foreground/80 hover:border-primary/40 hover:text-foreground'
                            : 'bg-card/40 border-border text-muted-foreground hover:border-primary/40 hover:text-foreground/80'
                        } ${compact ? 'w-full' : ''}`}
                >
                    <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z" />
                    </svg>
                    {!compact && label && <span className="text-[11px] text-muted-foreground font-medium">{label}</span>}
                    <span className="font-medium tabular-nums flex-1 text-left">{displayDate}</span>
                </button>
            </PopoverTrigger>

            <PopoverContent 
                align={alignMap[alignPopover]} 
                className="p-0 border-none bg-transparent shadow-none w-auto"
                onInteractOutside={(e) => {
                    // Critical: prevent interaction from propogating to Dialog outside-click handlers
                    e.preventDefault();
                }}
            >
                <div className="bg-popover/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl shadow-black/20 overflow-hidden flex">
                    {/* Presets sidebar */}
                    <div className="w-24 border-r border-border/60 py-3 px-2 flex flex-col gap-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold px-1.5 mb-1">{presetsLabel}</p>
                        {presets.map(p => (
                            <button key={p.k} onClick={() => applyPreset(p.k)}
                                className="text-left text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg px-2 py-1.5 transition-all duration-150">
                                {p.l}
                            </button>
                        ))}
                    </div>

                    {/* Calendar */}
                    <div className="p-3 w-[260px]">
                        <div className="flex items-center justify-between mb-3">
                            <button onClick={prevMonth} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-all">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                            </button>
                            <span className="text-sm font-semibold text-foreground">{MONTHS[viewMonth]} {viewYear}</span>
                            <button onClick={nextMonth} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-all">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            </button>
                        </div>

                        <div className="grid grid-cols-7 gap-0.5 mb-1">
                            {DAYS.map(d => (
                                <div key={d} className="text-center text-[10px] text-muted-foreground font-semibold py-1">{d}</div>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 gap-0.5">
                            {cells.map((day, i) => {
                                if (day === null) return <div key={`e${i}`} />;
                                const m = String(viewMonth + 1).padStart(2, '0');
                                const dd = String(day).padStart(2, '0');
                                const dateStr = `${viewYear}-${m}-${dd}`;
                                const isToday = dateStr === todayStr;
                                const isSelected = dateStr === value;
                                return (
                                    <button key={day} onClick={() => select(day)}
                                        className={`w-8 h-8 rounded-lg text-[13px] font-medium transition-all duration-150 ${isSelected
                                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                                            : isToday
                                                ? 'bg-primary/15 text-primary ring-1 ring-primary/40'
                                                : 'text-foreground/80 hover:bg-accent hover:text-foreground'
                                            }`}
                                    >
                                        {day}
                                    </button>
                                );
                            })}
                        </div>

                        <button onClick={() => { const t = new Date(); setViewMonth(t.getMonth()); setViewYear(t.getFullYear()); }}
                            className="mt-2 w-full text-center text-[11px] text-muted-foreground hover:text-primary transition-colors py-1 rounded-lg hover:bg-accent/50">
                            {backLabel}
                        </button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
