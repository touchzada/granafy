import { useState, useRef, useEffect } from 'react'
import { Brain, FileBarChart, Send, Sparkles, Loader2, Settings, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export default function AdvisorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const item = localStorage.getItem('advisor_messages')
      return item ? JSON.parse(item) : []
    } catch (e) {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [analysisMode, setAnalysisMode] = useState<'chat' | 'auto'>('chat')
  const [confirmClear, setConfirmClear] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
    localStorage.setItem('advisor_messages', JSON.stringify(messages))
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading) return

    const userMessage: ChatMessage = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.ok) throw new Error('Falha na requisição')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('Stream não disponível')

      const decoder = new TextDecoder()
      let assistantMessage = ''
      let partialRead = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        partialRead += decoder.decode(value, { stream: true })
        const lines = partialRead.split('\n')
        partialRead = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content ?? ''
              if (content) {
                assistantMessage += content
                setMessages((prev) => {
                  const newMessages = [...prev]
                  if (newMessages.length > 0) {
                    newMessages[newMessages.length - 1] = {
                      role: 'assistant',
                      content: assistantMessage,
                    }
                  }
                  return newMessages
                })
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro:', error)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Desculpe, ocorreu um erro de conexão com a API Inteligência Artificial.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const runAutoAnalysis = async () => {
    setLoading(true)
    setMessages([])

    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({}),
      })

      if (!response.ok) throw new Error('Falha na requisição')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('Stream não disponível')

      const decoder = new TextDecoder()
      let analysisContent = ''
      let partialRead = ''

      setMessages([{ role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        partialRead += decoder.decode(value, { stream: true })
        const lines = partialRead.split('\n')
        partialRead = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const content = parsed.choices?.[0]?.delta?.content ?? ''
              if (content) {
                analysisContent += content
                setMessages([{ role: 'assistant', content: analysisContent }])
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro:', error)
      setMessages([
        {
          role: 'assistant',
          content: 'Erro ao analisar os dados financeiros. Tente novamente.',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl mx-auto w-full">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Brain className="w-8 h-8 text-primary" />
            Conselheiro IA
          </h1>
          <p className="text-muted-foreground">
            Converse com seu assistente financeiro pessoal ou execute uma varredura completa.
          </p>
        </div>
        <Link
          to="/advisor/config"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
        >
          <Settings className="w-4 h-4" />
          Configurar IA
        </Link>
      </div>

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setAnalysisMode('chat')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            analysisMode === 'chat'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Chat Pessoal
        </button>
        <button
          onClick={() => {
            setAnalysisMode('auto')
            if (messages.length === 0) runAutoAnalysis()
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            analysisMode === 'auto'
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          <FileBarChart className="w-4 h-4" />
          Diagnóstico Geral
        </button>

        {messages.length > 0 && (
          <button
            onClick={() => {
              if (confirmClear) {
                setMessages([])
                localStorage.removeItem('advisor_messages')
                setConfirmClear(false)
              } else {
                setConfirmClear(true)
                setTimeout(() => setConfirmClear(false), 3000)
              }
            }}
            onBlur={() => setConfirmClear(false)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ml-auto ${
              confirmClear
                ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
                : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            {confirmClear ? 'Confirmar limpeza?' : 'Limpar Histórico'}
          </button>
        )}
      </div>

      <div className="flex-1 bg-card border rounded-xl overflow-hidden shadow-sm flex flex-col min-h-0">
        <div className="flex-1 p-6 overflow-y-auto">
          {messages.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Brain className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-center font-medium max-w-sm">
                {analysisMode === 'chat'
                  ? 'Olá! Eu sou seu conselheiro financeiro de elite. Como posso ajudar com sua estratégia financeira hoje?'
                  : 'Clique abaixo para que eu analise seu patrimônio, fluxo de caixa e orçamentos automaticamente.'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground ml-auto'
                      : 'bg-secondary/40 border mr-auto'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1 text-sm md:text-base leading-relaxed">
                      {msg.role === 'assistant' ? (
                        <AnalysisRenderer content={msg.content} />
                      ) : (
                        <p>{msg.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-3 text-primary font-medium py-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Processando...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="p-4 bg-muted/20 border-t">
          {analysisMode === 'chat' ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Pergunte sobre seus gastos, ouça recomendações..."
                className="flex-1 bg-background border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-primary w-full disabled:opacity-50"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed px-5 rounded-lg flex items-center justify-center transition-colors shrink-0"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          ) : (
            <button
              onClick={runAutoAnalysis}
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Executando varredura financeira...
                </>
              ) : (
                <>
                  <FileBarChart className="w-5 h-5" />
                  Executar Diagnóstico Automático
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// AnalysisRenderer - Formats Markdown, handles specific sections
// ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { keywords: ['RESUMO EXECUTIVO'], color: 'cyan', label: 'Resumo' },
  { keywords: ['INDICADORES QUANTITATIVOS'], color: 'blue', label: 'Métricas' },
  { keywords: ['MAPA DE GASTOS', 'GASTOS'], color: 'amber', label: 'Distribuição' },
  { keywords: ['ANÁLISE DE CENÁRIOS'], color: 'violet', label: 'Cenários' },
  { keywords: ['CLASSIFICAÇÃO FINAL', 'CLASSIFICAÇÃO DE RISCO'], color: 'rose', label: 'Classificação' },
  { keywords: ['SINAIS DE ALERTA'], color: 'orange', label: 'Alertas' },
  { keywords: ['POSIÇÃO PATRIMONIAL'], color: 'teal', label: 'Patrimônio' },
  { keywords: ['RECOMENDAÇÕES', 'AÇÕES'], color: 'emerald', label: 'Estratégia' },
  { keywords: ['PROJEÇÃO'], color: 'indigo', label: 'Projeção' },
]

const COLOR_MAP: Record<string, { text: string; bg: string; border: string; headerBg: string }> = {
  cyan: { text: 'text-cyan-500', bg: 'bg-cyan-500/5', border: 'border-cyan-500/20', headerBg: 'bg-cyan-500/10' },
  blue: { text: 'text-blue-500', bg: 'bg-blue-500/5', border: 'border-blue-500/20', headerBg: 'bg-blue-500/10' },
  amber: { text: 'text-amber-500', bg: 'bg-amber-500/5', border: 'border-amber-500/20', headerBg: 'bg-amber-500/10' },
  violet: { text: 'text-violet-500', bg: 'bg-violet-500/5', border: 'border-violet-500/20', headerBg: 'bg-violet-500/10' },
  rose: { text: 'text-rose-500', bg: 'bg-rose-500/5', border: 'border-rose-500/20', headerBg: 'bg-rose-500/10' },
  orange: { text: 'text-orange-500', bg: 'bg-orange-500/5', border: 'border-orange-500/20', headerBg: 'bg-orange-500/10' },
  teal: { text: 'text-teal-500', bg: 'bg-teal-500/5', border: 'border-teal-500/20', headerBg: 'bg-teal-500/10' },
  emerald: { text: 'text-emerald-500', bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', headerBg: 'bg-emerald-500/10' },
  indigo: { text: 'text-indigo-500', bg: 'bg-indigo-500/5', border: 'border-indigo-500/20', headerBg: 'bg-indigo-500/10' },
  gray: { text: 'text-muted-foreground', bg: 'bg-muted/30', border: 'border-border', headerBg: 'bg-muted' },
}

function stripEmoji(str: string): string {
  return str
    .replace(/[\u{1F300}-\u{1FAD6}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .trim()
}

function findSectionStyle(rawTitle: string) {
  const upper = stripEmoji(rawTitle).toUpperCase()
  for (const sec of SECTIONS) {
    if (sec.keywords.some(kw => upper.includes(kw))) {
      return { color: sec.color, label: sec.label }
    }
  }
  return { color: 'gray', label: stripEmoji(rawTitle) }
}

function AnalysisRenderer({ content }: { content: string }) {
  // Pre-process content: safely inject newlines before markdown lists/headers if AI squashed them
  // Only inject if immediately following a punctuation mark to avoid destroying "** " tags
  let normalizedContent = content.replace(/(?<=[.!?:])\s+(#{1,4}\s|\*\s|\d+\.\s)/g, '\n\n$1');

  const lines = normalizedContent.split('\n');
  const sections: { title: string; bodyLines: string[] }[] = [];
  let currentTitle = '';
  let currentBody: string[] = [];
  let preambleLines: string[] = [];
  let foundFirst = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!foundFirst) preambleLines.push(line);
      else currentBody.push(line);
      continue;
    }

    // Extract raw text only (without markdown tokens, numbering, and punctuation)
    // Example: "**3. MAPA DE GASTOS**" -> "MAPA DE GASTOS"
    const pureText = stripEmoji(trimmed)
      .replace(/^#{1,4}\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .replace(/^\*\*|^\*|^\-|^\>|^\~/, '')
      .replace(/\*\*$/, '')
      .replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    // Check if it exactly matches or starts with the keyword + space
    const isKnownSection = trimmed.length < 80 && SECTIONS.some(sec => 
      sec.keywords.some(kw => pureText === kw || pureText.startsWith(kw + ' '))
    );

    if (isKnownSection) {
      if (foundFirst && currentTitle) {
        sections.push({ title: currentTitle, bodyLines: currentBody });
      }
      if (!foundFirst) {
        preambleLines = [...currentBody];
        foundFirst = true;
      }
      currentTitle = trimmed;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  
  if (currentTitle) {
    sections.push({ title: currentTitle, bodyLines: currentBody });
  }

  // Filter out empty sections or sections with only dashes (like "--" or "-")
  const validSections = sections.filter(sec => {
    const validLines = sec.bodyLines.filter(l => {
      const t = l.trim();
      return t && t !== '-' && t !== '--';
    });
    return validLines.length > 0;
  });

  if (validSections.length === 0 && preambleLines.filter(l => l.trim()).length === 0) {
    return <div className="leading-relaxed whitespace-pre-wrap space-y-2">{content}</div>;
  }

  const preamble = preambleLines.map(l => l.trim()).filter(Boolean).join('\n');

  return (
    <div className="space-y-4">
      {preamble && <p className="text-sm leading-relaxed whitespace-pre-wrap">{preamble}</p>}
      {validSections.map((section, i) => {
        const { color, label } = findSectionStyle(section.title)
        const c = COLOR_MAP[color] || COLOR_MAP.gray
        return (
          <div key={i} className={`${c.bg} ${c.border} border rounded-xl overflow-hidden`}>
            {/* Header */}
            <div className={`${c.headerBg} px-4 py-2 flex items-center gap-2 border-b ${c.border}`}>
              <h4 className={`text-xs font-bold ${c.text} uppercase tracking-wider`}>{label}</h4>
            </div>
            {/* Body */}
            <div className="px-4 py-3">
              <SectionBody lines={section.bodyLines} accent={c.text} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SectionBody({ lines, accent }: { lines: string[]; accent: string }) {
  return (
    <div className="space-y-2 pb-1">
      {lines.map((rawLine, i) => {
        const line = rawLine.trim()
        if (!line) return null

        const cleanLine = stripEmoji(line)

        const subHeaderMatch = cleanLine.match(/^#{1,3}\s+(.+)/)
        if (subHeaderMatch) {
          const subTitle = subHeaderMatch[1].replace(/\*\*/g, '')
          return (
            <div key={i} className="mt-4 mb-2 flex items-center gap-2 pb-1 border-b border-border/40">
              <span className={`text-base font-bold ${accent} uppercase tracking-wider`}>{stripEmoji(subTitle)}</span>
            </div>
          )
        }

        // Bullet points (now catching * )
        const bulletMatch = line.match(/^[\s]*([→▸•\-└\*])\s*(.*)/)
        if (bulletMatch) {
          const bulletText = bulletMatch[2].trim()
          if (!bulletText || bulletText === '-' || bulletText === '--') return null
          
          return (
            <div key={i} className="flex gap-2.5 text-[0.925rem] pl-1 my-1.5 opacity-90">
              <span className={`${accent} shrink-0 mt-[2px]`}>▸</span>
              <span className="flex-1 leading-relaxed"><FormatLine text={bulletMatch[2]} accent={accent} /></span>
            </div>
          )
        }

        // Numbered list
        const numMatch = cleanLine.match(/^(\d+)\.\s*(.*)/)
        if (numMatch) {
          return (
            <div key={i} className="flex gap-2.5 text-[0.925rem] pl-1 my-1.5 opacity-90">
              <span className={`${accent} font-bold shrink-0 w-6 text-right mt-[2px]`}>{numMatch[1]}.</span>
              <span className="flex-1 leading-relaxed"><FormatLine text={numMatch[2]} accent={accent} /></span>
            </div>
          )
        }

        // Bold standalone sub-header
        if (cleanLine.startsWith('**') && cleanLine.endsWith('**')) {
          return <p key={i} className={`text-sm font-semibold ${accent} mt-4 mb-2 tracking-wide uppercase`}>{cleanLine.replace(/\*\*/g, '')}</p>
        }

        // Regular line
        return (
          <p key={i} className="text-[0.925rem] leading-[1.7] opacity-90 my-2">
            <FormatLine text={cleanLine} accent={accent} />
          </p>
        )
      })}
    </div>
  )
}

function FormatLine({ text, accent }: { text: string; accent: string }) {
  // Catch bold **text** or *text* and currency markers
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|R\$\s*-?[\d.,]+[kKmM]?)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className={`font-semibold ${accent}`}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <strong key={i} className={`font-semibold ${accent}`}>{part.slice(1, -1)}</strong>
        }
        if (/^R\$\s*-?[\d.,]+[kKmM]?$/.test(part)) {
          return <span key={i} className="font-mono font-bold opacity-90">{part}</span>
        }
        return <span key={i} className="opacity-90">{part}</span>
      })}
    </>
  )
}
