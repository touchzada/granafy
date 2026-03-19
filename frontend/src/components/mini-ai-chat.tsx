import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Send, Loader2, X, MessageCircle } from 'lucide-react'

interface MiniMessage {
  role: 'user' | 'assistant'
  content: string
}

export function MiniAiChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<MiniMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [open])

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const sendMessage = async () => {
    if (!input.trim() || loading) return
    const userMsg: MiniMessage = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
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
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
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
                  const updated = [...prev]
                  if (updated.length > 0) {
                    updated[updated.length - 1] = { role: 'assistant', content: assistantMessage }
                  }
                  return updated
                })
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch (error) {
      console.error('Mini-chat error:', error)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '❌ Erro ao conectar com a IA. Tente novamente.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating Action Button — always visible bottom-right */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        id="mini-ai-fab"
        className={`
          fixed bottom-6 right-6 z-[9999]
          w-14 h-14 rounded-full
          flex items-center justify-center
          shadow-xl transition-all duration-300 ease-out
          ${open
            ? 'bg-rose-500 hover:bg-rose-600 rotate-90 scale-95'
            : 'bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 hover:scale-110 hover:shadow-emerald-500/30'
          }
          text-white
        `}
        style={{ boxShadow: open ? undefined : '0 8px 32px rgba(16,185,129,0.35)' }}
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {/* Backdrop overlay when open (dim background slightly) */}
      {open && (
        <div
          className="fixed inset-0 z-[9990] bg-black/20 backdrop-blur-[2px] transition-opacity duration-300"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Chat Panel — fixed position, floats above everything */}
      <div
        ref={panelRef}
        className={`
          fixed z-[9995]
          bottom-24 right-6
          w-[380px] max-w-[calc(100vw-2rem)]
          transition-all duration-300 ease-out
          ${open
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
            : 'opacity-0 translate-y-4 scale-95 pointer-events-none'
          }
        `}
      >
        <div
          className="
            rounded-2xl overflow-hidden
            border border-white/15 dark:border-white/10
            shadow-2xl
          "
          style={{
            background: 'rgba(15,23,42,0.85)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(20,184,166,0.08) 100%)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90 leading-none">Flavinho do Pneu</p>
                <p className="text-[10px] text-emerald-400/80 mt-0.5">Online · Calibrando suas finanças 🛞</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white/90"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages area */}
          <div className="h-[340px] overflow-y-auto p-4 space-y-3" style={{ scrollbarWidth: 'thin' }}>
            {messages.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                  <Brain className="w-8 h-8 text-emerald-500/40" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-sm font-medium text-white/60">Como posso ajudar?</p>
                  <p className="text-xs text-white/35 max-w-[240px] leading-relaxed">
                    Diga algo como <span className="text-emerald-400/70 font-medium">"Gastei R$ 35 no iFood na Nubank"</span> e eu registro na hora!
                  </p>
                </div>
                {/* Quick actions */}
                <div className="flex flex-wrap gap-1.5 justify-center mt-2">
                  {['Quanto gastei esse mês?', 'Registrar um gasto', 'Meu saldo atual'].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); inputRef.current?.focus() }}
                      className="
                        text-[11px] px-3 py-1.5 rounded-full
                        bg-white/[0.06] border border-white/10
                        text-white/50 hover:text-white/80 hover:bg-white/[0.1]
                        transition-all duration-200
                      "
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`
                      max-w-[82%] px-3.5 py-2.5 text-[13px] leading-relaxed
                      transition-all duration-200
                      ${msg.role === 'user'
                        ? 'ml-auto bg-emerald-600/90 text-white rounded-2xl rounded-br-md shadow-sm'
                        : 'mr-auto bg-white/[0.07] border border-white/[0.08] text-white/85 rounded-2xl rounded-bl-md'
                      }
                    `}
                  >
                    {msg.content || (
                      <span className="flex items-center gap-2 text-white/40">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span className="text-xs">Pensando...</span>
                      </span>
                    )}
                  </div>
                ))}
                {loading && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="mr-auto px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white/[0.07] border border-white/[0.08]">
                    <span className="flex items-center gap-2 text-white/40">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span className="text-xs">Pensando...</span>
                    </span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input area */}
          <div
            className="px-3 py-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}
          >
            <div className="flex gap-2 items-center">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder="Registre um gasto ou pergunte algo..."
                className="
                  flex-1 bg-white/[0.06] border border-white/[0.08] rounded-xl
                  px-4 py-2.5 text-sm text-white outline-none
                  placeholder:text-white/30
                  focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500/30
                  transition-all duration-200
                "
                disabled={loading}
                id="mini-ai-chat-input"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="
                  p-2.5 rounded-xl shrink-0
                  bg-emerald-600 hover:bg-emerald-500
                  text-white shadow-lg shadow-emerald-600/20
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-all duration-200 hover:scale-105 active:scale-95
                "
                id="mini-ai-chat-send"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
