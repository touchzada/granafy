import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Brain, Save, Settings2, Sliders, Key, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'

export default function AdvisorConfigPage() {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Load config on mount
  useEffect(() => {
    fetch('/api/ai/config', {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        setConfig(data)
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        toast.error('Erro ao carregar configurações.')
        setLoading(false)
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          name: config.name,
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
          systemPrompt: config.systemPrompt,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          tonePreference: config.tonePreference,
        }),
      })

      if (!res.ok) throw new Error('Falha ao salvar')
      toast.success('Configurações salvas com sucesso!')
    } catch (e) {
      toast.error('Erro ao salvar as configurações.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="flex items-center gap-4 mb-8">
        <Link
          to="/advisor"
          className="p-2 -ml-2 rounded-lg hover:bg-secondary text-secondary-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings2 className="w-8 h-8 text-primary" />
            Configurações da IA
          </h1>
          <p className="text-muted-foreground mt-1">
            Ajuste o comportamento do Conselheiro Financeiro Pessoal.
          </p>
        </div>
        <div className="ml-auto">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
          <div className="bg-card border rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                Personalidade e Diretrizes
              </h2>
            </div>

            <div className="space-y-6">
              <div className="grid gap-3">
                <Label htmlFor="name">Nome do Agente</Label>
                <Input
                  id="name"
                  value={config?.name || ''}
                  onChange={(e) => setConfig({ ...config, name: e.target.value })}
                  placeholder="Ex: Consultor Financeiro Pessoal"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="systemPrompt">Prompt do Sistema (System Prompt)</Label>
                <p className="text-xs text-muted-foreground">
                  Estas são as instruções base que governam o comportamento do agente. Defina regras, tom e formatos de resposta.
                </p>
                <Textarea
                  id="systemPrompt"
                  value={config?.systemPrompt || ''}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setConfig({ ...config, systemPrompt: e.target.value })}
                  className="min-h-[400px] font-mono text-xs leading-relaxed"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border rounded-xl p-6 shadow-sm space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sliders className="w-5 h-5 text-primary" />
              Modelo e Parâmetros
            </h2>

            {/* Provider selector */}
            <div className="grid gap-3">
              <Label className="flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />
                Provedor de IA
              </Label>
              <select
                value={config?.provider || 'abacusai'}
                onChange={(e) => setConfig({ ...config, provider: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="abacusai">AbacusAI (Gateway Multi-Modelo)</option>
                <option value="openai">OpenAI (Direto)</option>
                <option value="anthropic">Anthropic / Claude (Direto)</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                {config?.provider === 'abacusai' && 'O AbacusAI funciona como proxy e aceita modelos de vários provedores (GPT, Claude, Gemini, etc.).'}
                {config?.provider === 'openai' && 'Conecta diretamente na API da OpenAI. Requer sua API key da OpenAI.'}
                {config?.provider === 'anthropic' && 'Conecta diretamente na API da Anthropic. Requer sua API key do Claude.'}
              </p>
            </div>

            {/* API Key input */}
            <div className="grid gap-3 pt-4 border-t">
              <Label className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5" />
                Chave de API (API Key)
              </Label>
              <Input
                type="password"
                value={config?.apiKey || ''}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder={config?.provider === 'abacusai' ? 'Deixe vazio para usar a key padrão' : `Cole sua ${config?.provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key aqui`}
              />
              <p className="text-[11px] text-muted-foreground">
                {config?.provider === 'abacusai'
                  ? 'Opcional. Se vazio, usa a chave padrão do AbacusAI gratuitamente.'
                  : `Obrigatório. Obtenha em ${config?.provider === 'openai' ? 'platform.openai.com' : 'console.anthropic.com'}.`
                }
              </p>
            </div>

            <div className="grid gap-3">
              <Label htmlFor="model">Modelo de Linguagem (LLM)</Label>
              <select
                id="model"
                value={config?.model || ''}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {(config?.provider === 'abacusai' || config?.provider === 'openai') && (
                  <optgroup label="OpenAI">
                    <option value="gpt-4o-2024-11-20">GPT-4o (2024-11-20)</option>
                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                    <option value="o4-mini">o4 Mini</option>
                    <option value="o3-pro">o3 Pro</option>
                    <option value="o3">o3</option>
                    <option value="o3-mini">o3 Mini</option>
                    <option value="gpt-4.1">GPT-4.1</option>
                    <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                    <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                    <option value="gpt-5">GPT-5</option>
                    <option value="gpt-5-mini">GPT-5 Mini</option>
                    <option value="gpt-5-nano">GPT-5 Nano</option>
                    <option value="gpt-5-codex">GPT-5 Codex</option>
                    <option value="gpt-5.1">GPT-5.1</option>
                    <option value="gpt-5.1-codex">GPT-5.1 Codex</option>
                    <option value="gpt-5.1-codex-max">GPT-5.1 Codex Max</option>
                    <option value="gpt-5.1-chat-latest">GPT-5.1 Chat Latest</option>
                    <option value="gpt-5.2">GPT-5.2</option>
                    <option value="gpt-5.2-chat-latest">GPT-5.2 Chat Latest</option>
                    <option value="gpt-5.2-codex">GPT-5.2 Codex</option>
                    <option value="gpt-5.3-chat-latest">GPT-5.3 Chat Latest</option>
                    <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                    <option value="gpt-5.3-codex-xhigh">GPT-5.3 Codex XHigh</option>
                    <option value="gpt-5.4">GPT-5.4</option>
                    <option value="openai/gpt-oss-120b">GPT-OSS 120B</option>
                  </optgroup>
                )}
                {(config?.provider === 'abacusai' || config?.provider === 'anthropic') && (
                  <optgroup label="Anthropic">
                    <option value="claude-3-7-sonnet-20250219">Claude 3.7 Sonnet</option>
                    <option value="claude-sonnet-4-20250514">Claude 4 Sonnet</option>
                    <option value="claude-opus-4-20250514">Claude 4 Opus</option>
                    <option value="claude-opus-4-1-20250805">Claude 4.1 Opus</option>
                    <option value="claude-sonnet-4-5-20250929">Claude 4.5 Sonnet</option>
                    <option value="claude-haiku-4-5-20251001">Claude 4.5 Haiku</option>
                    <option value="claude-opus-4-5-20251101">Claude 4.5 Opus</option>
                    <option value="claude-opus-4-6">Claude 4.6 Opus</option>
                    <option value="claude-sonnet-4-6">Claude 4.6 Sonnet</option>
                  </optgroup>
                )}
                {config?.provider === 'abacusai' && (
                  <>
                    <optgroup label="RouteLLM">
                      <option value="route-llm">RouteLLM (Auto-routing)</option>
                    </optgroup>
                    <optgroup label="Meta (LLaMA)">
                      <option value="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8">Llama 4 Maverick 17B</option>
                      <option value="meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo">Llama 3.1 405B Instruct</option>
                      <option value="meta-llama/Meta-Llama-3.1-8B-Instruct">Llama 3.1 8B Instruct</option>
                      <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile</option>
                    </optgroup>
                    <optgroup label="Google (Gemini)">
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                      <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                      <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite Preview</option>
                    </optgroup>
                    <optgroup label="Alibaba (Qwen)">
                      <option value="qwen-2.5-coder-32b">Qwen 2.5 Coder 32B</option>
                      <option value="Qwen/Qwen2.5-72B-Instruct">Qwen 2.5 72B Instruct</option>
                      <option value="Qwen/QwQ-32B">QwQ 32B</option>
                      <option value="Qwen/Qwen3-235B-A22B-Instruct-2507">Qwen 3 235B</option>
                      <option value="Qwen/Qwen3-32B">Qwen 3 32B</option>
                      <option value="qwen/qwen3-coder-480b-a35b-instruct">Qwen 3 Coder 480B</option>
                      <option value="qwen3-max">Qwen 3 Max</option>
                    </optgroup>
                    <optgroup label="xAI (Grok)">
                      <option value="grok-4-0709">Grok 4</option>
                      <option value="grok-4-fast-non-reasoning">Grok 4 Fast</option>
                      <option value="grok-4-1-fast-non-reasoning">Grok 4.1 Fast</option>
                      <option value="grok-4.20-beta-0309-non-reasoning">Grok 4.2 Beta</option>
                  <option value="grok-code-fast-1">Grok Code Fast 1</option>
                </optgroup>
                <optgroup label="Moonshot (Kimi)">
                  <option value="kimi-k2-turbo-preview">Kimi K2 Turbo</option>
                  <option value="kimi-k2.5">Kimi K2.5</option>
                </optgroup>
                <optgroup label="DeepSeek">
                  <option value="deepseek/deepseek-v3.1">DeepSeek V3.1</option>
                  <option value="deepseek-ai/DeepSeek-V3.1-Terminus">DeepSeek V3.1 Terminus</option>
                  <option value="deepseek-ai/DeepSeek-R1">DeepSeek R1</option>
                  <option value="deepseek-ai/DeepSeek-V3.2">DeepSeek V3.2</option>
                </optgroup>
                <optgroup label="Z.AI (GLM)">
                  <option value="zai-org/glm-4.5">GLM-4.5</option>
                  <option value="zai-org/glm-4.6">GLM-4.6</option>
                  <option value="zai-org/glm-4.7">GLM-4.7</option>
                  <option value="zai-org/glm-5">GLM-5</option>
                    </optgroup>
                  </>
                )}
              </select>
            </div>

            <div className="grid gap-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <Label>Temperatura (Criatividade)</Label>
                <span className="text-sm font-mono bg-secondary px-2 py-0.5 rounded text-secondary-foreground">
                  {config?.temperature?.toFixed(2) || '0.00'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Valores menores ({'< 0.3'}) são mais precisos e consistentes. Útil para análises numéricas.
              </p>
              <Slider
                value={[Number(config?.temperature || 0)]}
                min={0}
                max={2}
                step={0.01}
                onValueChange={([val]: number[]) => setConfig({ ...config, temperature: val })}
                className="mt-2"
              />
            </div>

            <div className="grid gap-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <Label>Máximo de Tokens</Label>
                <span className="text-sm font-mono bg-secondary px-2 py-0.5 rounded text-secondary-foreground">
                  {config?.maxTokens || 0}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Limite máximo do tamanho da resposta gerada.
              </p>
              <Slider
                value={[Number(config?.maxTokens || 0)]}
                min={100}
                max={32000}
                step={100}
                onValueChange={([val]: number[]) => setConfig({ ...config, maxTokens: val })}
                className="mt-2"
              />
            </div>

            <div className="grid gap-3 pt-4 border-t">
              <Label>Tom Preferido</Label>
              <select
                value={config?.tonePreference || 'equilibrado'}
                onChange={(e) => setConfig({ ...config, tonePreference: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="formal">Formal e Direto</option>
                <option value="equilibrado">Equilibrado (Firme e Empático)</option>
                <option value="agressivo">Agressivo (Forte redução de custos)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
